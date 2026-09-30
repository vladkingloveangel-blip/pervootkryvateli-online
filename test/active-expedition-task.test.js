'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Task,
  HistoryRecord,
  activeExpeditionTaskToLegacy,
  getActiveExpeditionTask,
  assignExpeditionTask,
  completeExpeditionTask,
  getExpeditionHistoryRecords,
  setExpeditionHistoryRecords,
  expeditionHistoryRecordToLegacy,
  addCompletedExpeditionRecord,
  countExpeditionCompletions,
  getExpeditionUsage,
  expeditionTakenThisRound,
  recordExpeditionTaken,
  resetExpeditionRoundUsage,
} = require('../domain-state');
const { EXPEDITION_CARDS, LEGENDARY_PLACES } = require('../game-data');
const {
  cloneIslands,
  normalizeStage6Compatibility,
  canTakeExpedition,
  takeExpedition,
  completeExpeditionAtArrival,
  expeditionCompletionCount,
  expeditionCardEligibleForPlayer,
} = require('../game-logic');
const { projectOpponentFacingRoomView } = require('../state-projection');

function canonicalCard(index = 0, copy = 1) {
  const definition = EXPEDITION_CARDS[index];
  assert.ok(definition, 'Missing canonical expedition definition.');
  return { ...definition, copy };
}

function makePlayer(id = 'p1') {
  return {
    id,
    name: id,
    row: 0,
    col: 0,
    activeExpedition: null,
    expeditionHistory: [],
    expeditionDrawRound: null,
    expeditionsDrawnThisRound: 0,
  };
}

function cartographySetup(cards, player = makePlayer()) {
  const islands = cloneIslands();
  const home = islands[0];
  home.ownerId = player.id;
  home.buildings = [{ type: 'cartography', level: 1 }];
  const [row, col] = home.cells[0];
  player.row = row;
  player.col = col;
  return {
    room: {
      round: 3,
      islands,
      players: [player],
      expeditionDeck: { drawPile: cards.map(card => ({ ...card })) },
    },
    player,
    home,
  };
}

function taskFor(player, card, options = {}) {
  return Task.view({
    kind: 'expedition',
    id: card.id,
    ownerId: player.id,
    state: 'active',
    source: {
      name: card.name,
      placeId: card.placeId,
      acceptedRound: options.acceptedRound || 3,
    },
    payload: { ...card },
    progress: {
      startedAtTarget: Boolean(options.startedAtTarget),
      departedAfterIssue: Boolean(options.departedAfterIssue),
    },
  });
}

test('ActiveExpeditionTask is detached and pure round-trip preserves the exact legacy shape', () => {
  const legacy = {
    card: { id: 'exp-1', name: 'One', placeId: 'kraken', copy: 2, extraCardField: 'keep' },
    cardId: 'exp-1',
    name: 'One',
    placeId: 'kraken',
    acceptedRound: 7,
    startedAtTarget: true,
    departedAfterIssue: false,
    legacyOnly: { keep: true },
  };
  const player = { id: 'p1', activeExpedition: structuredClone(legacy) };
  const beforeJson = JSON.stringify(player);
  const task = getActiveExpeditionTask(player);

  assert.equal(Task.is(task), true);
  assert.equal(task.kind, 'expedition');
  assert.equal(task.id, 'exp-1');
  assert.equal(task.ownerId, 'p1');
  assert.equal(task.state, 'active');
  assert.deepEqual(task.source, { name: 'One', placeId: 'kraken', acceptedRound: 7 });
  assert.equal(task.payload.copy, 2);
  assert.deepEqual(task.progress, { startedAtTarget: true, departedAfterIssue: false });
  assert.deepEqual(activeExpeditionTaskToLegacy(task), legacy);
  assert.equal(JSON.stringify(player), beforeJson);
  assert.equal(Object.getOwnPropertySymbols(task).every(symbol => Object.getOwnPropertyDescriptor(task, symbol).enumerable === false), true);

  task.payload.name = 'Detached';
  assert.equal(player.activeExpedition.card.name, 'One');

  const freshTask = getActiveExpeditionTask(player);
  assignExpeditionTask(player, freshTask);
  assert.deepEqual(player.activeExpedition, legacy);
  for (const key of ['task', 'tasks', 'activeTask', 'expeditions', 'historyRecords', 'expeditionUsage']) {
    assert.equal(Object.hasOwn(player, key), false, key);
  }
});

test('ActiveExpeditionTask preserves absent/null semantics and completion clears through legacy null', () => {
  assert.equal(getActiveExpeditionTask({ id: 'p1' }), undefined);
  assert.equal(getActiveExpeditionTask({ id: 'p1', activeExpedition: null }), null);

  const player = { id: 'p1', activeExpedition: { cardId: 'x', placeId: 'kraken' } };
  const completed = completeExpeditionTask(player);
  assert.deepEqual(completed, { cardId: 'x', placeId: 'kraken' });
  assert.equal(player.activeExpedition, null);
});

test('expedition history facade preserves unknown fields, order and exact legacy array shape', () => {
  const history = [
    { placeId: 'kraken', name: 'Kraken', cardId: 'a', completedRound: 2, legacyOnly: 'first' },
    { id: 'existing-id', placeId: 'sargasso', name: 'Sargasso', cardId: 'b', completedRound: 4 },
  ];
  const player = { id: 'p1', expeditionHistory: structuredClone(history) };
  const records = getExpeditionHistoryRecords(player);

  assert.equal(HistoryRecord.is(records[0]), true);
  assert.equal(records[0].kind, 'expedition-completion');
  assert.equal(records[0].ownerId, 'p1');
  assert.equal(records[0].source.placeId, 'kraken');
  assert.equal(records[0].source.cardId, 'a');
  assert.equal(records[0].payload.name, 'Kraken');
  assert.deepEqual(records[0].completedAt, { round: 2 });
  assert.equal(records[0].id, undefined);
  assert.equal(records[1].id, 'existing-id');
  assert.deepEqual(records.map(expeditionHistoryRecordToLegacy), history);

  setExpeditionHistoryRecords(player, records);
  assert.deepEqual(player.expeditionHistory, history);
  assert.deepEqual(player.expeditionHistory.map(item => item.placeId), ['kraken', 'sargasso']);
  assert.equal(countExpeditionCompletions(player, 'kraken'), 1);

  records[0].payload.name = 'Detached';
  assert.equal(player.expeditionHistory[0].name, 'Kraken');
});

test('adding a completed HistoryRecord writes only the old history shape without deduplication', () => {
  const player = { id: 'p1', expeditionHistory: [] };
  const record = HistoryRecord.view({
    kind: 'expedition-completion',
    ownerId: 'p1',
    state: 'completed',
    source: { placeId: 'kraken', cardId: 'expedition-kraken' },
    payload: { name: 'Kraken' },
    completedAt: { round: 5 },
  });
  addCompletedExpeditionRecord(player, record);
  addCompletedExpeditionRecord(player, record);
  assert.deepEqual(player.expeditionHistory, [
    { placeId: 'kraken', cardId: 'expedition-kraken', name: 'Kraken', completedRound: 5 },
    { placeId: 'kraken', cardId: 'expedition-kraken', name: 'Kraken', completedRound: 5 },
  ]);
});

test('usage facade keeps the two legacy fields and reset leaves expeditionDrawRound intact', () => {
  const player = {
    id: 'p1',
    expeditionDrawRound: null,
    expeditionsDrawnThisRound: 0,
    marker: 'keep',
  };
  const initial = getExpeditionUsage(player);
  initial.drawRound = 99;
  assert.equal(player.expeditionDrawRound, null);

  recordExpeditionTaken(player, 6);
  assert.equal(player.expeditionDrawRound, 6);
  assert.equal(player.expeditionsDrawnThisRound, 1);
  assert.equal(expeditionTakenThisRound(player, 6), 1);

  resetExpeditionRoundUsage(player);
  assert.equal(player.expeditionDrawRound, 6);
  assert.equal(player.expeditionsDrawnThisRound, 0);
  assert.equal(player.marker, 'keep');
  assert.equal(Object.hasOwn(player, 'usage'), false);
});

test('takeExpedition keeps the legacy key set, card occurrence and RNG behavior', () => {
  const first = canonicalCard(0, 2);
  const second = canonicalCard(1, 1);
  const { room, player } = cartographySetup([first, second]);
  let rngCalls = 0;
  const result = takeExpedition(room, player, () => {
    rngCalls += 1;
    return 0.75;
  });

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.expedition).sort(), [
    'acceptedRound', 'card', 'cardId', 'departedAfterIssue', 'name', 'placeId', 'startedAtTarget',
  ]);
  assert.equal(result.expedition.cardId, first.id);
  assert.equal(result.expedition.card.copy, 2);
  assert.equal(result.expedition.acceptedRound, 3);
  assert.equal(result.actionCost, 1);
  assert.ok(result.islandId);
  assert.equal(room.expeditionDeck.drawPile.some(card => card.id === first.id && card.copy === 2), false);
  assert.equal(rngCalls, 0);
  assert.equal(player.expeditionDrawRound, 3);
  assert.equal(player.expeditionsDrawnThisRound, 1);
  for (const key of ['task', 'tasks', 'activeTask']) assert.equal(Object.hasOwn(player, key), false);
});

test('history eligibility and per-round usage remain unchanged across completion and reset', () => {
  const first = canonicalCard(0);
  const second = canonicalCard(1);
  const { room, player, home } = cartographySetup([first, second]);
  assert.equal(expeditionCardEligibleForPlayer(player, first), true);

  const taken = takeExpedition(room, player, () => 0);
  assert.equal(taken.ok, true);
  const target = LEGENDARY_PLACES[first.placeId];
  player.row = target.row;
  player.col = target.col;
  const completed = completeExpeditionAtArrival(room, player, () => 0);
  assert.equal(completed.completed, true);
  assert.equal(expeditionCompletionCount(player, first.placeId), 1);
  assert.equal(expeditionCardEligibleForPlayer(player, first), false);

  const [homeRow, homeCol] = home.cells[0];
  player.row = homeRow;
  player.col = homeCol;
  const sameRound = takeExpedition(room, player, () => 0);
  assert.equal(sameRound.ok, false);
  assert.match(sameRound.error, /раунде/i);

  room.round += 1;
  resetExpeditionRoundUsage(player);
  assert.equal(player.expeditionDrawRound, 3);
  assert.equal(canTakeExpedition(room, player).ok, true);
});

test('started-at-target requires leave, explicitly persists departure, survives JSON restart and completes on return', () => {
  const card = canonicalCard(0);
  const target = LEGENDARY_PLACES[card.placeId];
  const player = makePlayer('p1');
  player.row = target.row;
  player.col = target.col;
  assignExpeditionTask(player, taskFor(player, card, { startedAtTarget: true, acceptedRound: 4 }));
  const room = { round: 4, islands: [], players: [player], expeditionDeck: { drawPile: [] } };

  const immediate = completeExpeditionAtArrival(room, player, () => 0);
  assert.equal(immediate.completed, false);
  assert.equal(immediate.requiresLeaveAndReturn, true);
  assert.equal(player.activeExpedition.departedAfterIssue, false);

  player.row = Number(target.row) + 1;
  player.col = Number(target.col) + 1;
  const departed = completeExpeditionAtArrival(room, player, () => 0);
  assert.equal(departed.completed, false);
  assert.equal(departed.departedAfterIssue, true);
  assert.equal(player.activeExpedition.departedAfterIssue, true);

  const restored = JSON.parse(JSON.stringify(room));
  const restoredPlayer = restored.players[0];
  assert.equal(getActiveExpeditionTask(restoredPlayer).progress.departedAfterIssue, true);
  assert.deepEqual(Object.keys(restoredPlayer.activeExpedition).sort(), [
    'acceptedRound', 'card', 'cardId', 'departedAfterIssue', 'name', 'placeId', 'startedAtTarget',
  ]);

  restoredPlayer.row = target.row;
  restoredPlayer.col = target.col;
  const completed = completeExpeditionAtArrival(restored, restoredPlayer, () => 0);
  assert.equal(completed.ok, true);
  assert.equal(completed.active, false);
  assert.equal(completed.completed, true);
  assert.deepEqual(completed.card, card);
  assert.equal(completed.place.id, card.placeId);
  assert.deepEqual(completed.reward, card.reward ? { ...card.reward } : null);
  assert.equal(restoredPlayer.activeExpedition, null);
  assert.deepEqual(restoredPlayer.expeditionHistory, [{
    placeId: card.placeId,
    cardId: card.id,
    name: completed.place.name || card.name,
    completedRound: 4,
  }]);
  assert.equal(restored.expeditionDeck.drawPile.filter(item => item.id === card.id).length, 1);

  const repeated = completeExpeditionAtArrival(restored, restoredPlayer, () => 0);
  assert.equal(repeated.completed, false);
  assert.equal(restored.expeditionDeck.drawPile.filter(item => item.id === card.id).length, 1);
});

test('expedition issued away from target completes on the first arrival', () => {
  const card = canonicalCard(1);
  const target = LEGENDARY_PLACES[card.placeId];
  const player = makePlayer('p1');
  assignExpeditionTask(player, taskFor(player, card, { startedAtTarget: false }));
  const room = { round: 3, islands: [], players: [player], expeditionDeck: { drawPile: [] } };

  player.row = target.row;
  player.col = target.col;
  const completed = completeExpeditionAtArrival(room, player, () => 0);
  assert.equal(completed.completed, true);
  assert.equal(player.activeExpedition, null);
  assert.equal(player.expeditionHistory.length, 1);
  assert.equal(room.expeditionDeck.drawPile.filter(item => item.id === card.id).length, 1);
});

test('compatibility rebuild excludes the active reserved expedition occurrence', () => {
  const card = canonicalCard(0);
  const player = makePlayer('p1');
  assignExpeditionTask(player, taskFor(player, card, { startedAtTarget: false }));
  const room = {
    round: 2,
    players: [player],
    islands: cloneIslands(),
    legendaryPlacesExplored: {},
  };

  normalizeStage6Compatibility(room, () => 0.5);
  assert.ok(room.expeditionDeck);
  assert.equal(room.expeditionDeck.drawPile.some(item => item.id === card.id), false);
  assert.equal(player.activeExpedition.cardId, card.id);
});

test('visibility contract keeps active expedition owner-private and completed history public', () => {
  const card = canonicalCard(0);
  const roomView = {
    players: [
      {
        id: 'p1',
        activeExpedition: {
          cardId: card.id,
          name: card.name,
          placeId: card.placeId,
          acceptedRound: 2,
          requiresLeaveAndReturn: true,
        },
        hasActiveExpedition: true,
        expeditionHistory: [{ placeId: card.placeId, name: card.name, cardId: card.id, completedRound: 1 }],
        expeditionHistoryCount: 1,
      },
      { id: 'p2', expeditionHistory: [], expeditionHistoryCount: 0 },
    ],
  };

  const owner = projectOpponentFacingRoomView(roomView, { viewerId: 'p1' });
  const opponent = projectOpponentFacingRoomView(roomView, { viewerId: 'p2' });
  const ownerP1 = owner.players.find(player => player.id === 'p1');
  const opponentP1 = opponent.players.find(player => player.id === 'p1');

  assert.equal(ownerP1.activeExpedition.cardId, card.id);
  assert.equal(ownerP1.hasActiveExpedition, true);
  assert.equal(Object.hasOwn(opponentP1, 'activeExpedition'), false);
  assert.equal(Object.hasOwn(opponentP1, 'hasActiveExpedition'), false);
  assert.deepEqual(opponentP1.expeditionHistory, [{ cardId: card.id, name: card.name, placeId: card.placeId, completedRound: 1 }]);
  assert.equal(opponentP1.expeditionHistoryCount, 1);
});
