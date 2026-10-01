'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getDiscovery,
  listDiscoveries,
  listPlayerDiscoveries,
  hasDiscovery,
  claimDiscovery,
} = require('../domain-state');
const {
  cloneIslands,
  normalizeStage6Compatibility,
  claimLegendaryPlaceDiscovery,
  jointAssaultIsland,
  discardRandomHeldCard,
  legendaryPlaceAt,
} = require('../game-logic');
const {
  LEGENDARY_PLACE_RULES,
  NAMED_PLACE_CARDS,
} = require('../game-data');

const namedCard = placeId => NAMED_PLACE_CARDS.find(card => card.placeId === placeId);

function compatibilityPlayer(id, cards = []) {
  return {
    id,
    namedPlaceCards: structuredClone(cards),
    legendaryCards: [],
    legendaryEffects: { seaCurses: [] },
    savedEventCards: [],
    expeditionHistory: [],
    activeExpedition: null,
    expeditionDrawRound: null,
    expeditionsDrawnThisRound: 0,
  };
}

test('Discovery registry facade maps authoritative entries to detached semantic views', () => {
  const room = { legendaryPlacesExplored: { kraken: 'p1', abyss: 'p2' } };
  const before = structuredClone(room);
  const krakenDefinition = LEGENDARY_PLACE_RULES.find(place => place.id === 'kraken');
  const discovery = getDiscovery(room, 'kraken', LEGENDARY_PLACE_RULES);

  assert.equal(discovery.kind, 'legendary-place');
  assert.equal(discovery.id, 'kraken');
  assert.equal(discovery.ownerId, 'p1');
  assert.equal(discovery.claimedById, 'p1');
  assert.equal(discovery.state, 'claimed');
  assert.equal(discovery.source.registry, 'legendaryPlacesExplored');
  assert.equal(discovery.source.placeId, 'kraken');
  assert.equal(discovery.source.placeKind, 'sea');
  assert.equal(discovery.source.mapPlaceId, 'kraken');
  assert.deepEqual(discovery.payload, krakenDefinition);
  assert.equal(hasDiscovery(room, 'kraken'), true);
  assert.equal(hasDiscovery(room, 'rose'), false);
  assert.deepEqual(listDiscoveries(room, LEGENDARY_PLACE_RULES).map(item => item.id), ['kraken', 'abyss']);
  assert.deepEqual(listPlayerDiscoveries(room, 'p1', LEGENDARY_PLACE_RULES).map(item => item.id), ['kraken']);

  discovery.source.mapPlaceId = 'changed';
  discovery.payload.name = 'changed';
  discovery.payload.reward.count = 99;
  assert.deepEqual(room, before);
  assert.equal(krakenDefinition.name, 'Кракен');
  assert.equal(krakenDefinition.reward.count, 1);
});

test('claimDiscovery writes only exact legacy registry shape and never overwrites first owner', () => {
  const room = {};
  const first = claimDiscovery(room, 'kraken', 'p1', LEGENDARY_PLACE_RULES);
  assert.equal(first.first, true);
  assert.equal(first.existingOwnerId, null);
  assert.equal(first.discovery.ownerId, 'p1');
  assert.deepEqual(room, { legendaryPlacesExplored: { kraken: 'p1' } });

  const repeat = claimDiscovery(room, 'kraken', 'p2', LEGENDARY_PLACE_RULES);
  assert.equal(repeat.first, false);
  assert.equal(repeat.existingOwnerId, 'p1');
  assert.equal(repeat.ownerId, 'p1');
  assert.equal(repeat.discovery.ownerId, 'p1');
  assert.deepEqual(room, { legendaryPlacesExplored: { kraken: 'p1' } });
  assert.equal(Object.hasOwn(room, 'discoveries'), false);
});

test('legendary claim creates named-card mirror once and grants random-with-replacement reward exactly once', () => {
  const room = { legendaryPlacesExplored: {} };
  const firstPlayer = { id: 'p1', namedPlaceCards: [], legendaryCards: [] };
  const secondPlayer = { id: 'p2', namedPlaceCards: [], legendaryCards: [] };
  let rngCalls = 0;
  const rng = () => { rngCalls += 1; return 0; };

  const first = claimLegendaryPlaceDiscovery(room, firstPlayer, 'kraken', rng);
  assert.equal(first.ok, true);
  assert.equal(first.first, true);
  assert.equal(first.exploredBy, 'p1');
  assert.equal(first.legendaryCards.length, 1);
  assert.equal(first.legendaryCard.id, 'sea-veil');
  assert.equal(rngCalls, 1);
  assert.deepEqual(firstPlayer.namedPlaceCards, [namedCard('kraken')]);
  assert.deepEqual(firstPlayer.legendaryCards.map(card => card.id), ['sea-veil']);

  let repeatRngCalls = 0;
  const repeat = claimLegendaryPlaceDiscovery(room, secondPlayer, 'kraken', () => { repeatRngCalls += 1; return 0.75; });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.first, false);
  assert.equal(repeat.exploredBy, 'p1');
  assert.deepEqual(repeat.legendaryCards, []);
  assert.equal(repeatRngCalls, 0);
  assert.deepEqual(secondPlayer.namedPlaceCards, []);
  assert.deepEqual(secondPlayer.legendaryCards, []);
  assert.deepEqual(firstPlayer.namedPlaceCards, [namedCard('kraken')]);

  const secondFirst = claimLegendaryPlaceDiscovery(room, firstPlayer, 'abyss', rng);
  assert.equal(secondFirst.first, true);
  assert.equal(rngCalls, 2);
  assert.deepEqual(firstPlayer.legendaryCards.map(card => card.id), ['sea-veil', 'sea-veil']);
  assert.equal(firstPlayer.namedPlaceCards.length, 2);
  assert.equal(Object.hasOwn(firstPlayer, 'discoveries'), false);
  assert.equal(Object.hasOwn(secondPlayer, 'discoveries'), false);
});

test('normalization repairs legacy named-card mirror in both directions and registry wins conflicts', () => {
  const ownerA = compatibilityPlayer('p1');
  const roomA = { round: 2, players: [ownerA], legendaryPlacesExplored: { kraken: 'p1' } };
  normalizeStage6Compatibility(roomA, () => 0.5);
  assert.deepEqual(ownerA.namedPlaceCards, [namedCard('kraken')]);
  assert.deepEqual(ownerA.legendaryCards, []);

  const ownerB = compatibilityPlayer('p1', [namedCard('abyss')]);
  const roomB = { round: 2, players: [ownerB] };
  normalizeStage6Compatibility(roomB, () => 0.5);
  assert.equal(roomB.legendaryPlacesExplored.abyss, 'p1');
  assert.deepEqual(ownerB.namedPlaceCards, [namedCard('abyss')]);
  assert.deepEqual(ownerB.legendaryCards, []);

  const registryOwner = compatibilityPlayer('p1');
  const wrongMirrorOwner = compatibilityPlayer('p2', [namedCard('kraken'), namedCard('kraken')]);
  const roomC = { round: 2, players: [registryOwner, wrongMirrorOwner], legendaryPlacesExplored: { kraken: 'p1' } };
  normalizeStage6Compatibility(roomC, () => 0.5);
  assert.equal(roomC.legendaryPlacesExplored.kraken, 'p1');
  assert.deepEqual(registryOwner.namedPlaceCards, [namedCard('kraken')]);
  assert.deepEqual(wrongMirrorOwner.namedPlaceCards, []);
  assert.deepEqual(registryOwner.legendaryCards, []);
  assert.deepEqual(wrongMirrorOwner.legendaryCards, []);
  assert.equal(listPlayerDiscoveries(roomC, 'p1', LEGENDARY_PLACE_RULES).length, 1);
  assert.equal(listPlayerDiscoveries(roomC, 'p2', LEGENDARY_PLACE_RULES).length, 0);
});

test('restart keeps original discovery owner and cannot grant reward or mirror a second time', () => {
  const p1 = compatibilityPlayer('p1');
  const p2 = compatibilityPlayer('p2');
  const room = { round: 2, players: [p1, p2], legendaryPlacesExplored: {} };
  let firstCalls = 0;
  const first = claimLegendaryPlaceDiscovery(room, p1, 'kraken', () => { firstCalls += 1; return 0.25; });
  assert.equal(first.first, true);
  assert.equal(firstCalls, 1);

  const restored = structuredClone(room);
  normalizeStage6Compatibility(restored, () => 0.5);
  const restoredP1 = restored.players.find(player => player.id === 'p1');
  const restoredP2 = restored.players.find(player => player.id === 'p2');
  let repeatCalls = 0;
  const repeat = claimLegendaryPlaceDiscovery(restored, restoredP2, 'kraken', () => { repeatCalls += 1; return 0.75; });

  assert.equal(repeat.first, false);
  assert.equal(repeat.exploredBy, 'p1');
  assert.equal(repeatCalls, 0);
  assert.equal(restored.legendaryPlacesExplored.kraken, 'p1');
  assert.deepEqual(restoredP1.namedPlaceCards, [namedCard('kraken')]);
  assert.deepEqual(restoredP2.namedPlaceCards, []);
  assert.equal(restoredP1.legendaryCards.length, 1);
  assert.equal(restoredP2.legendaryCards.length, 0);
});

test('island first-military-conquest discovery and non-first conquest behavior remain unchanged', () => {
  const islands = cloneIslands();
  const atlantia = islands.find(island => island.id === 'atlantia');
  atlantia.army = 0;
  const [row, col] = atlantia.cells[0];
  const firstPlayer = {
    id: 'p1', name: 'One', row, col, shipClass: 'brigantine', level: 1,
    upgrades: [], escorts: [], ducats: 0, debt: 0, armyPoints: 0,
    attackCountsThisRound: {}, namedPlaceCards: [], legendaryCards: [],
  };
  const room = {
    round: 2, islands, players: [firstPlayer], alliances: [], factionState: {},
    legendaryPlacesExplored: {},
  };

  const first = jointAssaultIsland(room, firstPlayer, atlantia, [], [], { rng: () => 0.25 });
  assert.equal(first.ok, true);
  assert.equal(first.outcome, 'attacker');
  assert.equal(first.legendaryDiscovery.first, true);
  assert.equal(room.legendaryPlacesExplored.atlantia, 'p1');

  firstPlayer.row = 0;
  firstPlayer.col = 0;
  const secondPlayer = {
    id: 'p2', name: 'Two', row, col, shipClass: 'brigantine', level: 1,
    upgrades: [], escorts: [], ducats: 0, debt: 0, armyPoints: 0,
    attackCountsThisRound: {}, namedPlaceCards: [], legendaryCards: [],
  };
  room.players.push(secondPlayer);
  const second = jointAssaultIsland(room, secondPlayer, atlantia);
  assert.equal(second.ok, true);
  assert.equal(second.outcome, 'attacker');
  assert.equal(second.legendaryDiscovery, undefined);
  assert.equal(room.legendaryPlacesExplored.atlantia, 'p1');
  assert.deepEqual(secondPlayer.namedPlaceCards, []);
  assert.deepEqual(secondPlayer.legendaryCards, []);
});

test('sea place identity remains canonical and named discoveries never enter random held inventory', () => {
  assert.equal(legendaryPlaceAt(24, 6)?.id, 'kraken');
  const player = {
    id: 'p1',
    namedPlaceCards: [structuredClone(namedCard('kraken'))],
    specialCards: [],
    legendaryCards: [],
    savedEventCards: [],
  };
  let rngCalls = 0;
  const discarded = discardRandomHeldCard({}, player, () => { rngCalls += 1; return 0; });
  assert.equal(discarded.ok, true);
  assert.equal(discarded.discarded, null);
  assert.equal(rngCalls, 0);
  assert.deepEqual(player.namedPlaceCards, [namedCard('kraken')]);
});
