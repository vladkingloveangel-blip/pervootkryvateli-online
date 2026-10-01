'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ConsumableAbility,
  legendaryConsumableAbilityFromLegacy,
  specialConsumableAbilityFromLegacy,
  consumableAbilityToLegacy,
  listLegendaryAbilities,
  listSpecialAbilities,
  listConsumableAbilities,
  grantConsumableAbility,
  grantLegendaryAbility,
  grantSpecialAbility,
  peekConsumableAbility,
  consumeConsumableAbility,
} = require('../domain-state');
const {
  allLegendaryCardRefs,
  legendaryCardRefs,
  playerHasLegendaryKind,
  peekLegendaryCard,
  consumeLegendaryCard,
  discardRandomHeldCard,
  claimLegendaryPlaceDiscovery,
} = require('../game-logic');
const { LEGENDARY_CARDS } = require('../game-data');

function legendary(id = 'sea-veil', copy = 1) {
  const card = LEGENDARY_CARDS.find(item => item.id === id);
  assert.ok(card, 'Missing legendary definition ' + id);
  return { ...structuredClone(card), copy, legacyOnly: { keep: true } };
}

test('legendary and special legacy entries map to detached ConsumableAbility views with exact round-trip', () => {
  const card = legendary('sea-veil', 2);
  const player = {
    id: 'p1',
    legendaryCards: [structuredClone(card)],
    specialCards: ['Покров моря'],
  };
  const before = structuredClone(player);

  const legendaryAbility = listLegendaryAbilities(player)[0];
  const specialAbility = listSpecialAbilities(player)[0];

  assert.equal(ConsumableAbility.is(legendaryAbility), true);
  assert.equal(legendaryAbility.kind, 'legendary');
  assert.equal(legendaryAbility.id, card.id);
  assert.equal(legendaryAbility.ownerId, 'p1');
  assert.deepEqual(legendaryAbility.source, { inventory: 'legendary', index: 0 });
  assert.deepEqual(legendaryAbility.payload, card);
  assert.deepEqual(consumableAbilityToLegacy(legendaryAbility), card);

  assert.equal(ConsumableAbility.is(specialAbility), true);
  assert.equal(specialAbility.kind, 'special');
  assert.equal(specialAbility.id, undefined);
  assert.equal(specialAbility.ownerId, 'p1');
  assert.deepEqual(specialAbility.source, { inventory: 'special', index: 0 });
  assert.deepEqual(specialAbility.payload, { name: 'Покров моря' });
  assert.equal(consumableAbilityToLegacy(specialAbility), 'Покров моря');

  legendaryAbility.payload.legacyOnly.keep = false;
  specialAbility.payload.name = 'Detached';
  legendaryAbility.source.index = 99;
  assert.deepEqual(player, before);
  assert.equal(Object.getOwnPropertySymbols(legendaryAbility).every(symbol => Object.getOwnPropertyDescriptor(legendaryAbility, symbol).enumerable === false), true);
  assert.equal(JSON.stringify(player), JSON.stringify(before));
});

test('list APIs preserve absent/null/empty backing semantics without mutation', () => {
  assert.equal(listLegendaryAbilities({ id: 'p1' }), undefined);
  assert.equal(listSpecialAbilities({ id: 'p1' }), undefined);
  assert.equal(listLegendaryAbilities({ id: 'p1', legendaryCards: null }), null);
  assert.equal(listSpecialAbilities({ id: 'p1', specialCards: null }), null);
  assert.deepEqual(listLegendaryAbilities({ id: 'p1', legendaryCards: [] }), []);
  assert.deepEqual(listSpecialAbilities({ id: 'p1', specialCards: [] }), []);
  assert.deepEqual(listConsumableAbilities({ id: 'p1' }), []);
});

test('duplicate legendary and special entries remain separate and consume by exact source/index', () => {
  const first = legendary('sea-veil', 1);
  const second = { ...legendary('sea-veil', 2), marker: 'second' };
  const player = {
    id: 'p1',
    legendaryCards: [first, second],
    specialCards: ['Покров моря', 'Покров моря'],
  };

  assert.equal(listConsumableAbilities(player).length, 4);
  const pickedLegendary = peekConsumableAbility(player, { source: 'legendary', index: 1 });
  assert.equal(pickedLegendary.payload.copy, 2);
  assert.equal(consumeConsumableAbility(player, { source: 'legendary', index: 1 }).payload.marker, 'second');
  assert.equal(player.legendaryCards.length, 1);
  assert.equal(player.legendaryCards[0].copy, 1);

  const pickedSpecial = peekConsumableAbility(player, { source: 'special', index: 0 });
  assert.equal(pickedSpecial.payload.name, 'Покров моря');
  consumeConsumableAbility(player, { source: 'special', index: 0 });
  assert.deepEqual(player.specialCards, ['Покров моря']);

  const beforeFailed = structuredClone(player);
  assert.equal(consumeConsumableAbility(player, { source: 'legendary', index: 9 }), null);
  assert.equal(consumeConsumableAbility(player, { source: 'unknown', index: 0 }), null);
  assert.deepEqual(player, beforeFailed);
});

test('grant APIs write only the selected legacy backing and preserve element shapes', () => {
  const player = { id: 'p1' };
  const card = legendary('hellfire', 3);

  const grantedLegendary = grantLegendaryAbility(player, card);
  assert.deepEqual(player.legendaryCards, [card]);
  assert.equal(Object.hasOwn(player, 'specialCards'), false);
  assert.deepEqual(grantedLegendary.source, { inventory: 'legendary', index: 0 });

  const grantedSpecial = grantSpecialAbility(player, 'Пламя Ада');
  assert.deepEqual(player.specialCards, ['Пламя Ада']);
  assert.equal(typeof player.specialCards[0], 'string');
  assert.equal(typeof player.legendaryCards[0], 'object');
  assert.deepEqual(grantedSpecial.source, { inventory: 'special', index: 0 });

  const generic = specialConsumableAbilityFromLegacy(player, 'LEGACY_UNKNOWN', 1);
  grantConsumableAbility(player, generic);
  assert.deepEqual(player.specialCards, ['Пламя Ада', 'LEGACY_UNKNOWN']);
  for (const key of ['abilities', 'consumableAbilities', 'abilityRefs', 'inventoryEntries']) {
    assert.equal(Object.hasOwn(player, key), false, key);
  }
});

test('unknown special strings round-trip and stay non-playable while recognized refs preserve exact ordering and shape', () => {
  const card = legendary('sea-veil', 1);
  const player = {
    id: 'p1',
    legendaryCards: [card, legendary('mist-path', 2)],
    specialCards: ['UNKNOWN_LEGACY', 'Покров моря', 'Морское проклятие'],
  };

  assert.equal(consumableAbilityToLegacy(listSpecialAbilities(player)[0]), 'UNKNOWN_LEGACY');
  assert.deepEqual(allLegendaryCardRefs(player), [
    { source: 'legendary', index: 0, id: 'sea-veil', kind: 'sea-veil', name: card.name },
    { source: 'legendary', index: 1, id: 'mist-path', kind: 'mist-path', name: LEGENDARY_CARDS.find(item => item.id === 'mist-path').name },
    { source: 'special', index: 1, id: 'sea-veil', kind: 'sea-veil', name: 'Покров моря' },
    { source: 'special', index: 2, id: 'sea-curse', kind: 'sea-curse', name: 'Морское проклятие' },
  ]);
  assert.equal(allLegendaryCardRefs(player).some(ref => ref.name === 'UNKNOWN_LEGACY'), false);
  assert.equal(playerHasLegendaryKind(player, 'sea-veil'), true);
  assert.equal(legendaryCardRefs(player, 'sea-veil').length, 2);

  const specialPeek = peekLegendaryCard(player, { source: 'special', index: 1 });
  assert.deepEqual(specialPeek, {
    source: 'special',
    index: 1,
    kind: 'sea-veil',
    name: 'Покров моря',
    card: { id: 'sea-veil', name: 'Покров моря' },
  });
  const unknownBefore = structuredClone(player);
  assert.equal(peekLegendaryCard(player, { source: 'special', index: 0 }), null);
  assert.deepEqual(player, unknownBefore);
});

test('legendary play/reaction consumption helper removes exactly the selected origin and duplicate', () => {
  const player = {
    id: 'p1',
    legendaryCards: [legendary('sea-veil', 1), legendary('sea-veil', 2)],
    specialCards: ['Покров моря'],
  };

  const special = consumeLegendaryCard(null, player, { source: 'special', index: 0 });
  assert.equal(special.kind, 'sea-veil');
  assert.deepEqual(player.specialCards, []);
  assert.equal(player.legendaryCards.length, 2);

  const legendaryConsumed = consumeLegendaryCard(null, player, { source: 'legendary', index: 1 });
  assert.equal(legendaryConsumed.card.copy, 2);
  assert.equal(player.legendaryCards.length, 1);
  assert.equal(player.legendaryCards[0].copy, 1);
});

test('random held discard preserves special -> legendary -> saved-event ordering, candidate count and one RNG call', () => {
  function setup() {
    return {
      room: { eventDeck: { drawPile: [], discard: [] } },
      player: {
        id: 'p1',
        specialCards: ['UNKNOWN_SPECIAL', 'Покров моря'],
        legendaryCards: [legendary('hellfire', 1), legendary('mist-path', 1)],
        savedEventCards: [{
          id: 'held-event',
          name: 'Held event',
          sourceDeck: 'event',
          sourceCard: { id: 'event-source', copy: 1 },
        }],
        activeAssignment: { instanceId: 'assignment-1' },
        activeExpedition: { cardId: 'expedition-1' },
      },
    };
  }

  const expected = [
    ['special', 0, 'UNKNOWN_SPECIAL'],
    ['special', 1, 'Покров моря'],
    ['legendary', 0, LEGENDARY_CARDS.find(item => item.id === 'hellfire').name],
    ['legendary', 1, LEGENDARY_CARDS.find(item => item.id === 'mist-path').name],
    ['saved-event', 0, 'Held event'],
  ];

  expected.forEach(([source, index, name], candidateIndex) => {
    const { room, player } = setup();
    let calls = 0;
    const result = discardRandomHeldCard(room, player, () => {
      calls += 1;
      return (candidateIndex + 0.1) / expected.length;
    });
    assert.equal(calls, 1);
    assert.equal(result.discarded.source, source);
    assert.equal(result.discarded.index, index);
    assert.equal(result.discarded.name, name);
    assert.equal(player.activeAssignment.instanceId, 'assignment-1');
    assert.equal(player.activeExpedition.cardId, 'expedition-1');
    if (source === 'saved-event') {
      assert.equal(player.savedEventCards.length, 0);
      assert.deepEqual(room.eventDeck.discard, [{ id: 'event-source', copy: 1 }]);
    } else {
      assert.equal(player.savedEventCards.length, 1);
      assert.deepEqual(room.eventDeck.discard, []);
    }
  });

  const empty = { id: 'p2', specialCards: [], legendaryCards: [], savedEventCards: [] };
  let calls = 0;
  assert.deepEqual(discardRandomHeldCard({ eventDeck: { drawPile: [], discard: [] } }, empty, () => { calls += 1; return 0; }), { ok: true, discarded: null });
  assert.equal(calls, 0);
});

test('legendary-place grant keeps legendaryCards origin and JSON restart preserves duplicate ordering/backing', () => {
  const player = { id: 'p1', namedPlaceCards: [], legendaryCards: [], specialCards: [] };
  const room = { legendaryPlacesExplored: {} };

  const first = claimLegendaryPlaceDiscovery(room, player, 'kraken', () => 0);
  assert.equal(first.first, true);
  assert.equal(first.legendaryCard.id, 'sea-veil');
  assert.deepEqual(player.legendaryCards.map(card => card.id), ['sea-veil']);
  assert.deepEqual(player.specialCards, []);

  grantLegendaryAbility(player, legendary('sea-veil', 2));
  grantSpecialAbility(player, 'Покров моря');
  grantSpecialAbility(player, 'Покров моря');
  const restored = JSON.parse(JSON.stringify(player));
  assert.deepEqual(restored.legendaryCards.map(card => [card.id, card.copy]), [['sea-veil', undefined], ['sea-veil', 2]]);
  assert.deepEqual(restored.specialCards, ['Покров моря', 'Покров моря']);
  assert.equal(typeof restored.legendaryCards[0], 'object');
  assert.equal(typeof restored.specialCards[0], 'string');
  for (const key of ['abilities', 'consumableAbilities', 'abilityRefs', 'inventoryEntries']) {
    assert.equal(Object.hasOwn(restored, key), false, key);
  }
});

test('manual mapping helpers do not create unique instance ids for legacy entries', () => {
  const player = { id: 'p1' };
  const legendaryAbility = legendaryConsumableAbilityFromLegacy(player, legendary('sea-curse', 1), 4);
  const specialAbility = specialConsumableAbilityFromLegacy(player, 'Морское проклятие', 5);
  assert.equal(legendaryAbility.id, 'sea-curse');
  assert.equal(specialAbility.id, undefined);
  assert.deepEqual(legendaryAbility.source, { inventory: 'legendary', index: 4 });
  assert.deepEqual(specialAbility.source, { inventory: 'special', index: 5 });
});
