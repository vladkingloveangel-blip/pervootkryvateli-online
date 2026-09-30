'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Task,
  getActiveAssignmentTask,
  assignTask,
  completeAssignmentTask,
} = require('../domain-state');
const {
  cloneIslands,
  issueAssignment,
  offerAssignmentCards,
  chooseAssignmentOffer,
  assignmentRequiredAction,
  noteMoriAssignmentDeparture,
  advanceMoriAssignmentNavigation,
  completeAssignment,
  fillCargoDirect,
  rebelFromSuzerain,
} = require('../game-logic');
const {
  ASSIGNMENT_CARDS,
  FACTIONS,
  GOODS,
  SHIPS,
  CITADEL_CELLS,
} = require('../game-data');
const { projectPlayerForViewer } = require('../state-projection');

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function assignmentTask(player, { id = 'task-1', factionId = 'mori', card, issuedRound = 3, progress } = {}) {
  const semantic = {
    kind: 'assignment',
    id,
    ownerId: player.id,
    state: 'active',
    source: { factionId, issuedRound },
    payload: { ...(card || { id: 'card-1', type: 'ship-level', text: 'Test assignment', reward: 20 }) },
  };
  if (progress !== undefined) semantic.progress = structuredClone(progress);
  return Task.view(semantic);
}

function storageFor(cards = []) {
  return { drawPile: cards.map(card => ({ ...card })), discard: [], removed: [] };
}

function stopCell(room, stop) {
  if (stop?.islandId) {
    const island = room.islands.find(item => item.id === stop.islandId);
    assert.ok(island?.cells?.length, `missing island stop ${stop.islandId}`);
    return island.cells[0];
  }
  if (stop?.mapObjectId === 'citadel') return CITADEL_CELLS[0];
  throw new Error('Unknown Mori route stop.');
}

test('ActiveAssignmentTask maps legacy shape to detached Task and round-trips byte-equivalent JSON', () => {
  const legacy = {
    instanceId: 'mori:mori-9:123:456',
    factionId: 'mori',
    card: {
      id: 'mori-9',
      type: 'visit-route',
      text: 'Route',
      reward: 30,
      route: [{ islandId: 'i1' }, { mapObjectId: 'citadel' }],
    },
    issuedRound: 4,
    progress: {
      kind: 'mori-service',
      nextStopIndex: 1,
      completedStopCount: 1,
      departureRequired: false,
      departureSatisfied: true,
      completedStops: [{ index: 0, islandId: 'i1', label: 'I1' }],
    },
  };
  const player = { id: 'p1', activeAssignment: structuredClone(legacy), marker: { untouched: true } };
  const beforeJson = JSON.stringify(player);

  const task = getActiveAssignmentTask(player);
  assert.equal(Task.is(task), true);
  assert.equal(task.kind, 'assignment');
  assert.equal(task.id, legacy.instanceId);
  assert.equal(task.ownerId, 'p1');
  assert.equal(task.state, 'active');
  assert.deepEqual(task.source, { factionId: 'mori', issuedRound: 4 });
  assert.equal(task.payload.id, 'mori-9');
  assert.notEqual(task.id, task.payload.id);
  assert.notStrictEqual(task.payload, player.activeAssignment.card);
  assert.notStrictEqual(task.progress, player.activeAssignment.progress);

  task.payload.route[0].islandId = 'changed';
  task.progress.completedStops[0].label = 'changed';
  assert.deepEqual(player.activeAssignment, legacy);

  const fresh = getActiveAssignmentTask(player);
  assignTask(player, fresh);
  assert.deepEqual(player.activeAssignment, legacy);
  assert.equal(JSON.stringify(player), beforeJson);
  assert.deepEqual(Object.keys(player.activeAssignment), ['instanceId', 'factionId', 'card', 'issuedRound', 'progress']);
  for (const forbidden of ['kind', 'ownerId', 'state', 'source', 'payload']) assert.equal(has(player.activeAssignment, forbidden), false);
  assert.deepEqual(Object.getOwnPropertySymbols(player.activeAssignment), []);
});

test('ActiveAssignmentTask keeps absent/null reads distinct and completion clears with legacy null convention', () => {
  const absent = { id: 'p1' };
  assert.equal(getActiveAssignmentTask(absent), undefined);
  assert.equal(completeAssignmentTask(absent), undefined);
  assert.equal(absent.activeAssignment, null);

  const nullable = { id: 'p2', activeAssignment: null };
  assert.equal(getActiveAssignmentTask(nullable), null);
  assert.equal(completeAssignmentTask(nullable), null);
  assert.equal(nullable.activeAssignment, null);
});

test('assignTask writes only activeAssignment and never creates held inventory or parallel task fields', () => {
  const player = {
    id: 'p1',
    activeAssignment: null,
    specialCards: ['special-a'],
    legendaryCards: [{ id: 'legend-a' }],
    savedEventCards: [{ id: 'saved-a' }],
    neighbor: { untouched: true },
  };
  const beforeHeld = structuredClone({
    specialCards: player.specialCards,
    legendaryCards: player.legendaryCards,
    savedEventCards: player.savedEventCards,
    neighbor: player.neighbor,
  });
  const task = assignmentTask(player, {
    id: 'instance-7',
    factionId: 'mori',
    issuedRound: 5,
    card: { id: 'definition-3', type: 'ship-level', text: 'Level', reward: 25 },
  });

  const written = assignTask(player, task);
  assert.deepEqual(written, {
    instanceId: 'instance-7',
    factionId: 'mori',
    card: { id: 'definition-3', type: 'ship-level', text: 'Level', reward: 25 },
    issuedRound: 5,
  });
  assert.deepEqual({
    specialCards: player.specialCards,
    legendaryCards: player.legendaryCards,
    savedEventCards: player.savedEventCards,
    neighbor: player.neighbor,
  }, beforeHeld);
  for (const forbidden of ['task', 'tasks', 'activeTask', 'abilities']) assert.equal(has(player, forbidden), false);

  assert.throws(
    () => assignTask(player, Task.view({ kind: 'expedition', id: 'x', ownerId: 'p1', state: 'active', source: {}, payload: {} })),
    /active assignment Task/
  );
});

test('issueAssignment preserves legacy shape, Mori progress and exact instance RNG usage', () => {
  const card = ASSIGNMENT_CARDS.mori.find(item => item.id === 'mori-1');
  assert.ok(card);
  const occurrence = { ...card, copy: 1 };
  const player = {
    id: 'p1',
    level: 1,
    upgrades: [],
    activeAssignment: null,
    specialCards: [],
    legendaryCards: [],
    savedEventCards: [],
  };
  const room = {
    round: 3,
    islands: cloneIslands(),
    players: [player],
    assignmentDecks: { mori: storageFor([occurrence]) },
  };
  let calls = 0;
  const oldNow = Date.now;
  Date.now = () => 1700000000000;
  let result;
  try {
    result = issueAssignment(room, player, 'mori', () => {
      calls += 1;
      return 0.25;
    });
  } finally {
    Date.now = oldNow;
  }

  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(player.activeAssignment.instanceId, `mori:${card.id}:1700000000000:250000000`);
  assert.equal(player.activeAssignment.card.id, card.id);
  assert.equal(player.activeAssignment.factionId, 'mori');
  assert.equal(player.activeAssignment.issuedRound, 3);
  assert.equal(player.activeAssignment.progress.kind, 'mori-service');
  assert.deepEqual(Object.keys(player.activeAssignment), ['instanceId', 'factionId', 'card', 'issuedRound', 'progress']);
  assert.strictEqual(result.assignment, player.activeAssignment);
  for (const forbidden of ['task', 'tasks', 'activeTask']) assert.equal(has(player, forbidden), false);
  assert.deepEqual(player.specialCards, []);
  assert.deepEqual(player.legendaryCards, []);
  assert.deepEqual(player.savedEventCards, []);
});

test('Embassy offer/choice source semantics stay unchanged and pendingAssignmentChoice is not migrated', () => {
  const first = ASSIGNMENT_CARDS.mori.find(item => item.id === 'mori-1');
  const second = ASSIGNMENT_CARDS.mori.find(item => item.id === 'mori-9');
  assert.ok(first && second && first.id !== second.id);
  const player = { id: 'p1', level: 1, upgrades: [], activeAssignment: null };
  const pending = { id: 'legacy-pending', kind: 'embassy', playerId: 'other', factionId: 'mori', options: [] };
  const room = {
    round: 2,
    islands: cloneIslands(),
    players: [player],
    pendingAssignmentChoice: pending,
    assignmentDecks: { mori: storageFor([{ ...first, copy: 1 }, { ...second, copy: 1 }]) },
  };
  const offered = offerAssignmentCards(room, player, 'mori', 2, () => 0.5);
  assert.equal(offered.ok, true);
  assert.deepEqual(offered.cards.map(card => card.id), [first.id, second.id]);
  assert.strictEqual(room.pendingAssignmentChoice, pending);

  const chosen = chooseAssignmentOffer(room, player, 'mori', offered.cards, first.id, () => 0.5);
  assert.equal(chosen.ok, true);
  assert.equal(chosen.assignment.card.id, first.id);
  assert.deepEqual(room.assignmentDecks.mori.discard, []);
  assert.deepEqual(room.assignmentDecks.mori.removed, []);
  assert.deepEqual(room.assignmentDecks.mori.drawPile.map(card => card.id), [second.id]);
  assert.strictEqual(room.pendingAssignmentChoice, pending);
});

test('Mori progress mutations explicitly write through facade and survive JSON serialization', () => {
  const card = ASSIGNMENT_CARDS.mori.find(item => item.id === 'mori-9');
  assert.ok(card);
  assert.equal(card.route.length, 2);
  const player = { id: 'p1', row: 99, col: 99, level: 1, upgrades: [], activeAssignment: null };
  const room = {
    round: 4,
    islands: cloneIslands(),
    players: [player],
    assignmentDecks: { mori: storageFor([{ ...card, copy: 1 }]) },
  };
  assert.equal(issueAssignment(room, player, 'mori', () => 0.4).ok, true);
  const instanceId = player.activeAssignment.instanceId;

  if (player.activeAssignment.progress.departureRequired) {
    player.row = 99;
    player.col = 99;
    const departure = noteMoriAssignmentDeparture(room, player);
    assert.equal(departure.changed, true);
    assert.equal(player.activeAssignment.progress.departureSatisfied, true);
  }

  const firstCell = stopCell(room, card.route[0]);
  const fromFirst = { row: player.row, col: player.col };
  [player.row, player.col] = firstCell;
  const first = advanceMoriAssignmentNavigation(room, player, fromFirst);
  assert.equal(first.progressed, true);
  assert.equal(first.completed, false);
  assert.equal(player.activeAssignment.progress.nextStopIndex, 1);
  assert.equal(player.activeAssignment.progress.completedStopCount, 1);
  assert.equal(player.activeAssignment.progress.completedStops.length, 1);

  const serializedPlayer = JSON.parse(JSON.stringify(player));
  assert.deepEqual(serializedPlayer.activeAssignment.progress, player.activeAssignment.progress);
  const resumedRoom = { ...room, players: [serializedPlayer] };
  const secondCell = stopCell(resumedRoom, card.route[1]);
  const fromSecond = { row: serializedPlayer.row, col: serializedPlayer.col };
  [serializedPlayer.row, serializedPlayer.col] = secondCell;
  const second = advanceMoriAssignmentNavigation(resumedRoom, serializedPlayer, fromSecond);
  assert.equal(second.completed, true);
  assert.equal(second.completionEvent.assignmentInstanceId, instanceId);
  assert.equal(serializedPlayer.activeAssignment.progress.nextStopIndex, 2);
  assert.equal(serializedPlayer.activeAssignment.progress.completedStopCount, 2);
});

test('required-action and cargo assignmentInstanceId linkage read through ActiveAssignmentTask', () => {
  const shipClass = Object.keys(SHIPS)[0];
  const goodId = Object.keys(GOODS)[0];
  assert.ok(shipClass && goodId && CITADEL_CELLS.length);
  const [row, col] = CITADEL_CELLS[0];
  const player = {
    id: 'p1',
    row,
    col,
    shipClass,
    level: 1,
    ducats: 999,
    debt: 0,
    upgrades: [],
    escorts: [],
    cargo: null,
    activeAssignment: null,
  };
  assignTask(player, assignmentTask(player, {
    id: 'link-instance',
    card: { id: 'level-card', type: 'ship-level', text: 'Raise level', reward: 10 },
  }));
  const room = { round: 2, islands: cloneIslands(), players: [player] };

  const required = assignmentRequiredAction(room, player, 1);
  assert.equal(required.kind, 'ship-level');
  assert.equal(required.assignmentInstanceId, 'link-instance');

  const loaded = fillCargoDirect(room, player, goodId);
  assert.equal(loaded.ok, true);
  assert.equal(player.cargo.assignmentInstanceId, 'link-instance');
});

test('completion keeps legacy result contract, pays reward/debt and recycles the card exactly once', () => {
  const factionId = 'mori';
  const card = { id: 'completion-card', type: 'ship-level', text: 'Complete me', reward: 40, copy: 1 };
  const player = { id: 'p1', ducats: 0, debt: 5, activeAssignment: null };
  assignTask(player, assignmentTask(player, { id: 'completion-instance', factionId, card, issuedRound: 6 }));
  const room = {
    round: 6,
    players: [player],
    assignmentDecks: { [factionId]: storageFor([]) },
  };
  const share = Math.max(0, Math.min(1, Number(FACTIONS[factionId]?.rewardShare) || 0));
  const withheld = Math.floor(card.reward * share);
  const paid = card.reward - withheld;
  const debtPaid = Math.min(5, paid);

  const result = completeAssignment(room, player, { type: 'ship-level' });
  assert.equal(result.ok, true);
  assert.equal(result.matched, true);
  assert.deepEqual(result.assignment, {
    instanceId: 'completion-instance',
    factionId,
    card,
    issuedRound: 6,
  });
  assert.equal(result.gross, 40);
  assert.equal(result.rewardShare, share);
  assert.equal(result.withheld, withheld);
  assert.equal(result.paid, paid);
  assert.deepEqual(result.credit, {
    gross: paid,
    debtPaid,
    net: paid - debtPaid,
    debtRemaining: 5 - debtPaid,
  });
  assert.equal(player.activeAssignment, null);
  assert.equal(room.assignmentDecks[factionId].discard.length, 1);
  assert.equal(room.assignmentDecks[factionId].discard[0].id, card.id);

  const again = completeAssignment(room, player, { type: 'ship-level' });
  assert.deepEqual(again, { ok: false, matched: false });
  assert.equal(room.assignmentDecks[factionId].discard.length, 1);
});

test('rebellion recycles the active assignment once and clears only legacy activeAssignment', () => {
  const factionId = 'mori';
  const card = { id: 'rebel-card', type: 'ship-level', text: 'Rebel task', reward: 10, copy: 1 };
  const player = {
    id: 'p1',
    suzerainId: factionId,
    vassalGiftIslandId: null,
    enemyFactionIds: [],
    activeAssignment: null,
    specialCards: ['keep-special'],
    legendaryCards: [{ id: 'keep-legendary' }],
    savedEventCards: [{ id: 'keep-saved' }],
  };
  assignTask(player, assignmentTask(player, { id: 'rebel-instance', factionId, card }));
  const room = {
    round: 3,
    players: [player],
    islands: cloneIslands(),
    factionState: {},
    assignmentDecks: { [factionId]: storageFor([]) },
  };
  const heldBefore = structuredClone([player.specialCards, player.legendaryCards, player.savedEventCards]);

  const result = rebelFromSuzerain(room, player);
  assert.equal(result.ok, true);
  assert.equal(player.activeAssignment, null);
  assert.equal(room.assignmentDecks[factionId].discard.length, 1);
  assert.equal(room.assignmentDecks[factionId].discard[0].id, card.id);
  assert.deepEqual([player.specialCards, player.legendaryCards, player.savedEventCards], heldBefore);
  assert.equal(has(player, 'tasks'), false);
});

test('owner/opponent assignment visibility contract remains unchanged', () => {
  const presentation = {
    id: 'p1',
    name: 'Owner',
    activeAssignment: {
      instanceId: 'assignment-instance',
      factionId: 'mori',
      id: 'mori-1',
      conditionKey: 'visit-island',
      text: 'Private assignment',
      reward: 20,
      type: 'visit-island',
      issuedRound: 3,
      progress: null,
    },
    hasActiveAssignment: true,
  };
  const owner = projectPlayerForViewer(presentation, { viewerId: 'p1' });
  const opponent = projectPlayerForViewer(presentation, { viewerId: 'p2' });

  assert.equal(owner.activeAssignment.instanceId, 'assignment-instance');
  assert.equal(owner.activeAssignment.id, 'mori-1');
  assert.equal(owner.hasActiveAssignment, true);
  assert.equal(has(opponent, 'activeAssignment'), false);
  assert.equal(has(opponent, 'hasActiveAssignment'), false);
});
