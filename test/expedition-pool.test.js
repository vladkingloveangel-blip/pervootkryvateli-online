'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EXPEDITION_CARDS, LEGENDARY_PLACES } = require('../game-data');
const {
  cloneIslands,
  createExpeditionDeck,
  canTakeExpedition,
  takeExpedition,
  completeExpeditionAtArrival,
} = require('../game-logic');
const {
  expandExpeditionDefinitions,
  createExpeditionStorage,
  expeditionPool,
} = require('../expedition-pool');

function occurrenceKey(card) {
  return `${card.id || card.placeId}:${card.copy ?? 'legacy'}`;
}

function canonicalCard(id) {
  const definition = EXPEDITION_CARDS.find(card => card.id === id);
  assert.ok(definition, `Missing canonical expedition ${id}`);
  return { ...definition, copy: 1 };
}

function poolRoom(drawPile = []) {
  return {
    round: 1,
    players: [],
    expeditionDeck: { drawPile: drawPile.map(card => ({ ...card })) },
  };
}

function makePlayer(id, history = []) {
  return {
    id,
    name: id,
    row: 0,
    col: 0,
    activeExpedition: null,
    expeditionHistory: history.map(item => ({ ...item })),
    expeditionDrawRound: null,
    expeditionsDrawnThisRound: 0,
  };
}

function gameplaySetup(drawPile, players) {
  const islands = cloneIslands();
  const homes = {};
  players.forEach((player, index) => {
    const island = islands[index];
    assert.ok(island, 'Not enough islands for expedition test setup.');
    island.ownerId = player.id;
    island.buildings = [{ type: 'cartography', level: 1 }];
    const [row, col] = island.cells[0];
    player.row = row;
    player.col = col;
    homes[player.id] = { row, col };
  });
  return {
    room: {
      round: 1,
      islands,
      players,
      expeditionDeck: { drawPile: drawPile.map(card => ({ ...card })) },
    },
    homes,
  };
}

function completedSingleCardSetup() {
  const kraken = canonicalCard('expedition-kraken');
  const p1 = makePlayer('p1');
  const p2 = makePlayer('p2');
  const { room, homes } = gameplaySetup([kraken], [p1, p2]);
  const taken = takeExpedition(room, p1, () => 0);
  assert.equal(taken.ok, true);
  assert.equal(taken.expedition.cardId, kraken.id);
  const target = LEGENDARY_PLACES[kraken.placeId];
  assert.ok(target);
  p1.row = target.row;
  p1.col = target.col;
  const completed = completeExpeditionAtArrival(room, p1, () => 0);
  assert.equal(completed.completed, true);
  return { room, homes, p1, p2, kraken };
}

test('ExpeditionPool initial storage has the exact canonical composition', () => {
  const expected = expandExpeditionDefinitions(EXPEDITION_CARDS).map(occurrenceKey).sort();
  const storage = createExpeditionStorage(() => 0.5);
  assert.deepEqual(storage.drawPile.map(occurrenceKey).sort(), expected);
  assert.deepEqual(Object.keys(storage), ['drawPile']);

  const compatibility = createExpeditionDeck(() => 0.5);
  assert.deepEqual(compatibility.drawPile.map(occurrenceKey).sort(), expected);
});

test('hasEligible(player) does not consume or reorder an outcome', () => {
  const room = poolRoom([
    { id: 'a', placeId: 'a', copy: 1 },
    { id: 'b', placeId: 'b', copy: 1 },
  ]);
  const before = JSON.parse(JSON.stringify(room.expeditionDeck.drawPile));
  const pool = expeditionPool(room, () => 0, { isEligible: (_player, card) => card.id === 'b' });

  assert.equal(pool.hasEligible(makePlayer('p1')), true);
  assert.deepEqual(room.expeditionDeck.drawPile, before);
});

test('takeEligible(player) removes the first eligible outcome from the pool', () => {
  const room = poolRoom([
    { id: 'a', placeId: 'a', copy: 1 },
    { id: 'b', placeId: 'b', copy: 1 },
  ]);
  const pool = expeditionPool(room, () => 0, { isEligible: (_player, card) => card.id === 'a' });

  const taken = pool.takeEligible(makePlayer('p1'));
  assert.equal(taken.id, 'a');
  assert.equal(room.expeditionDeck.drawPile.some(card => card.id === 'a'), false);
  assert.equal(pool.remainingCount(), 1);
});

test('temporarily ineligible outcome remains global and can be taken by another player', () => {
  const room = poolRoom([{ id: 'shared', placeId: 'shared', copy: 1 }]);
  const pool = expeditionPool(room, () => 0, {
    isEligible: player => player.id === 'p2',
  });

  assert.equal(pool.takeEligible(makePlayer('p1')), null);
  assert.equal(room.expeditionDeck.drawPile.length, 1);
  assert.equal(pool.takeEligible(makePlayer('p2')).id, 'shared');
  assert.equal(room.expeditionDeck.drawPile.length, 0);
});

test('skipped entries are not lost after finding an eligible expedition', () => {
  const cards = [
    { id: 'skip', placeId: 'skip', copy: 1 },
    { id: 'take', placeId: 'take', copy: 1 },
    { id: 'tail', placeId: 'tail', copy: 1 },
  ];
  const room = poolRoom(cards);
  const pool = expeditionPool(room, () => 0, { isEligible: (_player, card) => card.id === 'take' });

  const taken = pool.takeEligible(makePlayer('p1'));
  assert.equal(taken.id, 'take');
  assert.deepEqual(
    room.expeditionDeck.drawPile.map(card => card.id).sort(),
    ['skip', 'tail']
  );
});

test('when no expedition is eligible the pool composition is preserved', () => {
  const cards = [
    { id: 'a', placeId: 'a', copy: 1 },
    { id: 'b', placeId: 'b', copy: 1 },
    { id: 'c', placeId: 'c', copy: 1 },
  ];
  const room = poolRoom(cards);
  const pool = expeditionPool(room, () => 0.75, { isEligible: () => false });

  assert.equal(pool.takeEligible(makePlayer('p1')), null);
  assert.deepEqual(
    room.expeditionDeck.drawPile.map(occurrenceKey).sort(),
    cards.map(occurrenceKey).sort()
  );
});

test('an active expedition occurrence is absent from the available pool', () => {
  const card = canonicalCard('expedition-kraken');
  const p1 = makePlayer('p1');
  const { room } = gameplaySetup([card], [p1]);

  const result = takeExpedition(room, p1, () => 0);
  assert.equal(result.ok, true);
  assert.equal(p1.activeExpedition.cardId, card.id);
  assert.equal(room.expeditionDeck.drawPile.some(item => item.id === card.id), false);
});

test('JSON restart keeps active expedition reserved and does not draw the same occurrence again', () => {
  const first = canonicalCard('expedition-kraken');
  const second = { ...EXPEDITION_CARDS.find(card => card.id !== first.id), copy: 1 };
  const p1 = makePlayer('p1');
  const p2 = makePlayer('p2');
  const { room } = gameplaySetup([first, second], [p1, p2]);

  const issued = takeExpedition(room, p1, () => 0);
  assert.equal(issued.ok, true);
  const restored = JSON.parse(JSON.stringify(room));
  const activeId = restored.players[0].activeExpedition.cardId;

  assert.equal(restored.expeditionDeck.drawPile.some(card => card.id === activeId), false);
  const totalCopies = restored.expeditionDeck.drawPile.filter(card => card.id === activeId).length
    + Number(restored.players[0].activeExpedition.cardId === activeId);
  assert.equal(totalCopies, 1);

  const secondDraw = takeExpedition(restored, restored.players[1], () => 0);
  assert.equal(secondDraw.ok, true);
  assert.notEqual(secondDraw.expedition.cardId, activeId);
});

test('completion returns the expedition to the pool in exactly one occurrence', () => {
  const { room, p1, kraken } = completedSingleCardSetup();

  assert.equal(p1.activeExpedition, null);
  assert.deepEqual(p1.expeditionHistory.map(item => item.placeId), [kraken.placeId]);
  assert.equal(room.expeditionDeck.drawPile.filter(card => card.id === kraken.id).length, 1);
});

test('returnCompleted uses the previous expedition shuffle behavior', () => {
  const a = { id: 'a', placeId: 'a', copy: 1 };
  const b = { id: 'b', placeId: 'b', copy: 1 };
  const returned = { id: 'returned', placeId: 'returned', copy: 1 };
  const samples = [0.9, 0.1];
  let actualIndex = 0;
  let expectedIndex = 0;
  const actualRng = () => samples[actualIndex++];
  const expectedRng = () => samples[expectedIndex++];

  function oldShuffle(cards, rng) {
    const out = cards.map(card => ({ ...card }));
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.max(0, Math.min(0.999999999, Number(rng()) || 0)) * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  const room = poolRoom([a, b]);
  const pool = expeditionPool(room, actualRng, { isEligible: () => true });
  pool.returnCompleted(returned);

  assert.deepEqual(room.expeditionDeck.drawPile, oldShuffle([a, b, returned], expectedRng));
});

test('a player does not receive an expedition for a place already completed', () => {
  const blocked = canonicalCard('expedition-kraken');
  const allowed = { ...EXPEDITION_CARDS.find(card => card.id !== blocked.id), copy: 1 };
  const p1 = makePlayer('p1', [{ placeId: blocked.placeId, cardId: blocked.id, completedRound: 1 }]);
  const { room } = gameplaySetup([blocked, allowed], [p1]);

  const result = takeExpedition(room, p1, () => 0);
  assert.equal(result.ok, true);
  assert.equal(result.expedition.cardId, allowed.id);
  assert.equal(room.expeditionDeck.drawPile.some(card => card.id === blocked.id), true);
});

test('another player can still receive an expedition returned after completion', () => {
  const { room, p2, kraken } = completedSingleCardSetup();

  const result = takeExpedition(room, p2, () => 0);
  assert.equal(result.ok, true);
  assert.equal(result.expedition.cardId, kraken.id);
});

test('the completing player cannot immediately receive the same completed place again', () => {
  const { room, homes, p1, kraken } = completedSingleCardSetup();
  room.round = 2;
  p1.row = homes[p1.id].row;
  p1.col = homes[p1.id].col;

  const allowed = canTakeExpedition(room, p1);
  assert.equal(allowed.ok, false);
  assert.match(allowed.error, /нет доступной экспедиции/i);
  assert.equal(room.expeditionDeck.drawPile.filter(card => card.id === kraken.id).length, 1);
});

test('createExpeditionDeck keeps the legacy return shape', () => {
  const deck = createExpeditionDeck(() => 0.5);
  assert.deepEqual(Object.keys(deck), ['drawPile']);
  assert.ok(Array.isArray(deck.drawPile));
});

test('ExpeditionPool adds no new room fields', () => {
  const room = poolRoom([{ id: 'a', placeId: 'a', copy: 1 }]);
  room.marker = 'same';
  const beforeKeys = Object.keys(room).sort();
  const pool = expeditionPool(room, () => 0, { isEligible: () => false });

  pool.hasEligible(makePlayer('p1'));
  pool.takeEligible(makePlayer('p1'));

  assert.deepEqual(Object.keys(room).sort(), beforeKeys);
  assert.equal(Object.hasOwn(room, 'expeditionPools'), false);
  assert.equal(Object.hasOwn(room, 'reserved'), false);
  assert.equal(Object.hasOwn(room, 'discard'), false);
});

test('room.expeditionDeck remains exactly { drawPile } through take and return', () => {
  const card = { id: 'a', placeId: 'a', copy: 1 };
  const room = poolRoom([card]);
  const pool = expeditionPool(room, () => 0, { isEligible: () => true });

  const taken = pool.takeEligible(makePlayer('p1'));
  assert.deepEqual(Object.keys(room.expeditionDeck), ['drawPile']);
  pool.returnCompleted(taken);
  assert.deepEqual(Object.keys(room.expeditionDeck), ['drawPile']);
  assert.equal(room.expeditionDeck.drawPile.filter(item => item.id === card.id).length, 1);
});
