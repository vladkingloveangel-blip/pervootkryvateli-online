'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ELIGIBILITY,
  selectIndependent,
  consumeCyclic,
  peekOrderedCyclic,
  reserveRecyclableOccurrence,
  releaseReservedOccurrence,
  selectFilteredTasks,
  reserveRandomEntry,
  releaseReservedEntry,
} = require('../random-sources');
const {
  selectTreasureOutcome,
  selectLegendaryAbility,
  selectTreasureCandidates,
} = require('../digital-random-sources');
const { BALANCE, TREASURE_CARDS, LEGENDARY_CARDS } = require('../game-data');
const { drawTreasureCard, drawLegendaryCard } = require('../game-logic');

function sequenceRng(values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, `RNG sequence exhausted at call ${index + 1}`);
    return values[index++];
  };
}

test('independent selection allows repeats and does not remember previous outcomes', () => {
  const rng = sequenceRng([0.1, 0.1, 0.9]);
  const values = ['A', 'B'];
  assert.equal(selectIndependent(values, rng), 'A');
  assert.equal(selectIndependent(values, rng), 'A');
  assert.equal(selectIndependent(values, rng), 'B');
});

test('cyclic source does not repeat an occurrence before cycle refresh', () => {
  const available = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const recyclable = [];
  const firstCycle = [
    consumeCyclic(available, recyclable),
    consumeCyclic(available, recyclable),
    consumeCyclic(available, recyclable),
  ];
  assert.deepEqual(firstCycle.map(item => item.id), ['a', 'b', 'c']);
  assert.equal(new Set(firstCycle.map(item => item.id)).size, 3);
  const next = consumeCyclic(available, recyclable, sequenceRng([0, 0]));
  assert.ok(firstCycle.some(item => item.id === next.id));
});

test('ordered cyclic peek is stable, non-consuming, and matches next consume', () => {
  const available = [{ id: 'next' }, { id: 'later' }];
  const recyclable = [];
  const before = [...available];
  const first = peekOrderedCyclic(available, recyclable);
  const second = peekOrderedCyclic(available, recyclable);
  assert.equal(first.id, 'next');
  assert.strictEqual(second, first);
  assert.deepEqual(available, before);
  assert.deepEqual(recyclable, []);
  assert.strictEqual(consumeCyclic(available, recyclable), first);
});

test('reserved cyclic occurrence stays unavailable until release', () => {
  const keyOf = item => item.id;
  const available = [{ id: 'a' }, { id: 'b' }];
  const recyclable = [];
  const reserved = [];

  const a = consumeCyclic(available, recyclable);
  assert.equal(a.id, 'a');
  assert.equal(reserveRecyclableOccurrence(recyclable, reserved, a, keyOf), true);
  assert.deepEqual(reserved.map(keyOf), ['a']);

  assert.equal(consumeCyclic(available, recyclable).id, 'b');
  assert.equal(consumeCyclic(available, recyclable, () => 0).id, 'b');
  assert.deepEqual(reserved.map(keyOf), ['a']);

  assert.equal(releaseReservedOccurrence(reserved, recyclable, 'a', keyOf), true);
  assert.deepEqual(reserved, []);
  assert.ok(recyclable.some(item => item.id === 'a'));
});

test('filtered pool distinguishes eligible, temporary skip, and permanent remove', () => {
  const available = [
    { id: 'later', status: ELIGIBILITY.SKIP },
    { id: 'invalid', status: ELIGIBILITY.REMOVE },
    { id: 'now', status: ELIGIBILITY.ELIGIBLE },
  ];
  const recyclable = [];
  const removed = [];
  const chosen = selectFilteredTasks(available, recyclable, removed, {
    count: 1,
    classify: entry => entry.status,
    rng: () => 0,
  });

  assert.deepEqual(chosen.map(item => item.id), ['now']);
  assert.deepEqual(removed.map(item => item.id), ['invalid']);
  assert.deepEqual(available.map(item => item.id), ['later']);
  assert.deepEqual(recyclable, []);
});

test('reservable random pool cannot issue the same entry twice concurrently', () => {
  const keyOf = item => item.id;
  const available = [{ id: 'a' }, { id: 'b' }];
  const reserved = [];

  const first = reserveRandomEntry(available, reserved, { keyOf, rng: () => 0 });
  const second = reserveRandomEntry(available, reserved, { keyOf, rng: () => 0 });
  assert.equal(first.id, 'a');
  assert.equal(second.id, 'b');
  assert.deepEqual(available, []);
  assert.deepEqual(reserved.map(keyOf), ['a', 'b']);

  assert.equal(releaseReservedEntry(reserved, available, 'a', { keyOf }), true);
  assert.deepEqual(available.map(keyOf), ['a']);
  assert.deepEqual(reserved.map(keyOf), ['b']);
  assert.equal(reserveRandomEntry(available, reserved, { keyOf, rng: () => 0 }).id, 'a');
});

test('helpers mutate only explicitly supplied storage arrays and add no room fields', () => {
  const room = { marker: 'unchanged', anchorDecks: { blue: { drawPile: [{ id: 'a' }], discard: [] } } };
  const beforeRoomKeys = Object.keys(room);
  const beforeDeckKeys = Object.keys(room.anchorDecks.blue);

  assert.equal(consumeCyclic(room.anchorDecks.blue.drawPile, room.anchorDecks.blue.discard).id, 'a');

  assert.deepEqual(Object.keys(room), beforeRoomKeys);
  assert.deepEqual(Object.keys(room.anchorDecks.blue), beforeDeckKeys);
  assert.equal(room.marker, 'unchanged');
});


test('treasure selector maps deterministic RNG boundaries to all four canonical outcomes', () => {
  assert.equal(TREASURE_CARDS.length, 4);
  const cases = [
    [0, 0],
    [0.249999999, 0],
    [0.25, 1],
    [0.5, 2],
    [0.75, 3],
    [0.999999999, 3],
  ];
  for (const [roll, index] of cases) {
    assert.equal(selectTreasureOutcome(() => roll).id, TREASURE_CARDS[index].id);
  }
  assert.deepEqual(
    [0, 0.25, 0.5, 0.75].map(roll => selectTreasureOutcome(() => roll).id),
    TREASURE_CARDS.map(definition => definition.id)
  );
});

test('treasure candidates are independent with replacement and may repeat', () => {
  const repeated = selectTreasureCandidates(2, sequenceRng([0, 0]));
  assert.deepEqual(repeated.map(item => item.id), [TREASURE_CARDS[0].id, TREASURE_CARDS[0].id]);

  const independent = selectTreasureCandidates(2, sequenceRng([0, 0.75]));
  assert.deepEqual(independent.map(item => item.id), [TREASURE_CARDS[0].id, TREASURE_CARDS[3].id]);
});

test('treasure selection ignores legacy room.treasureDeck and wrapper delegates to stateless selector', () => {
  let reads = 0;
  const legacyDeck = Object.freeze({ drawPile: Object.freeze([{ id: 'legacy' }]), discard: Object.freeze([]) });
  const room = {};
  Object.defineProperty(room, 'treasureDeck', {
    enumerable: true,
    get() { reads += 1; return legacyDeck; },
  });

  const direct = selectTreasureOutcome(() => 0.5);
  const wrapped = drawTreasureCard(room, () => 0.5);
  assert.deepEqual(wrapped, direct);
  assert.equal(reads, 0);
  assert.deepEqual(legacyDeck, { drawPile: [{ id: 'legacy' }], discard: [] });
});

test('legendary selector allows repeats and follows BALANCE.legendaryPool.typeIds', () => {
  const originalIds = [...BALANCE.legendaryPool.typeIds];
  const customIds = [originalIds.at(-1), originalIds[0]];
  BALANCE.legendaryPool.typeIds = customIds;
  try {
    const first = selectLegendaryAbility(() => 0);
    const repeated = selectLegendaryAbility(() => 0);
    const second = selectLegendaryAbility(() => 0.75);
    assert.equal(first.id, customIds[0]);
    assert.equal(repeated.id, customIds[0]);
    assert.equal(second.id, customIds[1]);
  } finally {
    BALANCE.legendaryPool.typeIds = originalIds;
  }
});

test('legendary selection ignores legacy room.legendaryDeck and wrapper delegates to stateless selector', () => {
  let reads = 0;
  const legacyDeck = Object.freeze({ drawPile: Object.freeze([{ id: 'legacy' }]), discard: Object.freeze([]) });
  const room = {};
  Object.defineProperty(room, 'legendaryDeck', {
    enumerable: true,
    get() { reads += 1; return legacyDeck; },
  });

  const direct = selectLegendaryAbility(() => 0.75);
  const wrapped = drawLegendaryCard(room, () => 0.75);
  assert.deepEqual(wrapped, direct);
  assert.equal(reads, 0);
});

test('treasure and legendary results are detached clones of canonical definitions', () => {
  const treasureCanonical = JSON.parse(JSON.stringify(TREASURE_CARDS[0]));
  const legendaryId = BALANCE.legendaryPool.typeIds[0];
  const legendaryDefinition = LEGENDARY_CARDS.find(item => item.id === legendaryId);
  const legendaryCanonical = JSON.parse(JSON.stringify(legendaryDefinition));

  const treasure = selectTreasureOutcome(() => 0);
  const legendary = selectLegendaryAbility(() => 0);
  treasure.effect.type = 'mutated-treasure';
  legendary.effect.type = 'mutated-legendary';

  assert.deepEqual(TREASURE_CARDS[0], treasureCanonical);
  assert.deepEqual(legendaryDefinition, legendaryCanonical);
});
