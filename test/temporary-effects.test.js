'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  listActiveTurnEffects,
  getActiveTurnEffect,
  getActiveTurnEffectValue,
  activeTurnEffectsSnapshot,
  addActiveTurnEffect,
  clearActiveTurnEffects,
  getShipVeilEffect,
  addShipVeilEffect,
  removeShipVeilEffect,
  tickShipVeilEffect,
  listSeaCurseEffects,
  addSeaCurseEffect,
  tickSeaCurseEffects,
  getShipVeilReaction,
  addShipVeilReaction,
  removeShipVeilReaction,
  getIslandVeilEffect,
  addIslandVeilEffect,
  removeIslandVeilEffect,
  tickIslandVeilEffect,
  getIslandVeilReaction,
  addIslandVeilReaction,
  removeIslandVeilReaction,
} = require('../domain-state');
const {
  cloneIslands,
  applySeaVeilToShip,
  applySeaVeilToIsland,
  applySeaVeilHostileReactionToShip,
  applySeaVeilHostileReactionToIsland,
  clearSeaVeilHostileReactionsAtTurnEnd,
  applySeaCurse,
  legendaryMovementPenalty,
  tickLegendaryEffectsForPlayer,
  isShipProtected,
  isIslandProtected,
} = require('../game-logic');
const { BALANCE } = require('../game-data');

test('active-turn legacy backing maps to detached TemporaryEffect views and preserves exact legacy shape', () => {
  const player = {
    id: 'p1',
    activeTurnEffects: { moveBonus: 2, movePenalty: 1, bestOfTwo: true, noIncome: true, noNavigation: true },
    nextTurnEffects: { moveBonus: 7 },
  };
  const before = structuredClone(player);
  const effects = listActiveTurnEffects(player);
  assert.deepEqual(effects.map(effect => effect.kind), [
    'active-turn:moveBonus',
    'active-turn:movePenalty',
    'active-turn:bestOfTwo',
    'active-turn:noIncome',
    'active-turn:noNavigation',
  ]);
  assert.equal(getActiveTurnEffectValue(player, 'moveBonus'), 2);
  const view = getActiveTurnEffect(player, 'moveBonus');
  view.payload.value = 99;
  view.source.key = 'changed';
  view.duration.scope = 'changed';
  assert.deepEqual(player, before);
  assert.deepEqual(activeTurnEffectsSnapshot(player), before.activeTurnEffects);

  addActiveTurnEffect(player, 'moveBonus', 3);
  addActiveTurnEffect(player, 'movePenalty', 4);
  addActiveTurnEffect(player, 'bestOfTwo', true);
  addActiveTurnEffect(player, 'bestOfTwo', true);
  assert.deepEqual(player.activeTurnEffects, {
    moveBonus: 5, movePenalty: 5, bestOfTwo: true, noIncome: true, noNavigation: true,
  });
  assert.deepEqual(player.nextTurnEffects, { moveBonus: 7 });
  assert.equal(Object.hasOwn(player, 'effects'), false);
  assert.equal(Object.hasOwn(player, 'temporaryEffects'), false);
  assert.equal(JSON.stringify(player).includes('"kind":"active-turn'), false);

  clearActiveTurnEffects(player);
  assert.deepEqual(player.activeTurnEffects, {});
  assert.deepEqual(player.nextTurnEffects, { moveBonus: 7 });
});

test('ship veil mapping is detached, refreshes by overwrite, skips same turn, then expires on exact configured ticks', () => {
  const player = { id: 'p1', personalTurnNo: 5, legendaryEffects: { seaCurses: [] } };
  const duration = BALANCE.legendaryEffects['sea-veil'].durationPersonalTurns;
  applySeaVeilToShip(player, { sourcePlayerId: 'p1', ignoreCurrentTurn: true });
  assert.deepEqual(player.legendaryEffects.shipVeil, { remaining: duration, sourcePlayerId: 'p1', ignoreTurnNo: 5 });

  const detached = getShipVeilEffect(player);
  detached.duration.remaining = 1;
  detached.source.sourcePlayerId = 'changed';
  assert.deepEqual(player.legendaryEffects.shipVeil, { remaining: duration, sourcePlayerId: 'p1', ignoreTurnNo: 5 });

  let tick = tickShipVeilEffect(player, 5);
  assert.equal(tick.skipped, true);
  assert.equal(player.legendaryEffects.shipVeil.remaining, duration);
  assert.equal(player.legendaryEffects.shipVeil.ignoreTurnNo, null);

  addShipVeilEffect(player, { remaining: 1, sourcePlayerId: 'refresh-source', ignoreTurnNo: null });
  assert.deepEqual(player.legendaryEffects.shipVeil, { remaining: 1, sourcePlayerId: 'refresh-source', ignoreTurnNo: null });
  tick = tickShipVeilEffect(player, 6);
  assert.equal(tick.expired, true);
  assert.equal(player.legendaryEffects.shipVeil, undefined);

  applySeaVeilToShip(player, { sourcePlayerId: 'persisted-source', ignoreCurrentTurn: false });
  const restored = structuredClone(player);
  assert.equal(getShipVeilEffect(restored).source.sourcePlayerId, 'persisted-source');
  for (let i = 0; i < duration; i++) {
    restored.personalTurnNo += 1;
    tickLegendaryEffectsForPlayer({ islands: [] }, restored);
  }
  assert.equal(getShipVeilEffect(restored), null);
});

test('sea curses stay separate, stack penalties, tick independently, and survive restart with source identity', () => {
  const player = { id: 'target', personalTurnNo: 1, legendaryEffects: { seaCurses: [] } };
  applySeaCurse(player, 'source-a');
  applySeaCurse(player, 'source-b');
  assert.equal(player.legendaryEffects.seaCurses.length, 2);
  assert.equal(legendaryMovementPenalty(player), BALANCE.legendaryEffects['sea-curse'].amount * 2);

  const views = listSeaCurseEffects(player);
  views[0].duration.remaining = 99;
  views[0].payload.penalty = 99;
  views[0].source.sourcePlayerId = 'changed';
  assert.equal(player.legendaryEffects.seaCurses[0].remaining, BALANCE.legendaryEffects['sea-curse'].durationPersonalTurns);
  assert.equal(player.legendaryEffects.seaCurses[0].sourcePlayerId, 'source-a');

  player.legendaryEffects.seaCurses[0].remaining = 1;
  player.legendaryEffects.seaCurses[1].remaining = 2;
  const firstTick = tickSeaCurseEffects(player);
  assert.equal(firstTick.expired.length, 1);
  assert.deepEqual(player.legendaryEffects.seaCurses, [{
    remaining: 1,
    penalty: BALANCE.legendaryEffects['sea-curse'].amount,
    sourcePlayerId: 'source-b',
  }]);

  const restored = structuredClone(player);
  assert.equal(listSeaCurseEffects(restored)[0].source.sourcePlayerId, 'source-b');
  const secondTick = tickSeaCurseEffects(restored);
  assert.equal(secondTick.expired.length, 1);
  assert.deepEqual(restored.legendaryEffects.seaCurses, []);
  assert.equal(legendaryMovementPenalty(restored), 0);
});

test('island veil ticks only on persisted source player turns and expiry writes null', () => {
  const island = cloneIslands().find(item => item.id === 'bogamia');
  const source = { id: 'source', personalTurnNo: 4 };
  applySeaVeilToIsland(island, source, { ignoreCurrentTurn: true });
  const duration = BALANCE.legendaryEffects['sea-veil'].durationPersonalTurns;
  assert.deepEqual(island.legendaryVeil, { remaining: duration, sourcePlayerId: 'source', ignoreTurnNo: 4 });

  let tick = tickIslandVeilEffect(island, 'other', 4);
  assert.equal(tick.matchedSource, false);
  assert.equal(island.legendaryVeil.remaining, duration);

  tick = tickIslandVeilEffect(island, 'source', 4);
  assert.equal(tick.skipped, true);
  assert.equal(island.legendaryVeil.remaining, duration);
  assert.equal(island.legendaryVeil.ignoreTurnNo, null);

  const restored = structuredClone(island);
  assert.equal(getIslandVeilEffect(restored).source.sourcePlayerId, 'source');
  for (let turn = 5; turn < 5 + duration; turn++) tickLegendaryEffectsForPlayer({ islands: [restored] }, { id: 'source', personalTurnNo: turn, legendaryEffects: { seaCurses: [] } });
  assert.equal(restored.legendaryVeil, null);
});

test('ship and island hostile reactions are detached and expire only on matching source turn', () => {
  const target = { id: 'target', legendaryEffects: { seaCurses: [] } };
  const source = { id: 'source', legendaryEffects: { seaCurses: [] } };
  const unrelated = { id: 'other', legendaryEffects: { seaCurses: [] } };
  const island = cloneIslands().find(item => item.id === 'bogamia');
  island.ownerId = target.id;
  const room = { players: [source, target, unrelated], islands: [island] };

  applySeaVeilHostileReactionToShip(target, source.id);
  applySeaVeilHostileReactionToIsland(island, target, source.id);
  assert.equal(isShipProtected(target), true);
  assert.equal(isIslandProtected(island), true);

  const shipReaction = getShipVeilReaction(target);
  const islandReaction = getIslandVeilReaction(island);
  shipReaction.duration.expiresOnPlayerId = 'changed';
  islandReaction.source.sourcePlayerId = 'changed';
  assert.equal(target.legendaryEffects.shipVeilReaction.expiresOnPlayerId, 'source');
  assert.equal(island.legendaryVeilReaction.sourcePlayerId, 'target');

  assert.deepEqual(clearSeaVeilHostileReactionsAtTurnEnd(room, unrelated.id), []);
  assert.ok(getShipVeilReaction(target));
  assert.ok(getIslandVeilReaction(island));

  addShipVeilEffect(target, { remaining: 2, sourcePlayerId: target.id, ignoreTurnNo: null });
  addIslandVeilEffect(island, { remaining: 2, sourcePlayerId: target.id, ignoreTurnNo: null });
  const expired = clearSeaVeilHostileReactionsAtTurnEnd(room, source.id);
  assert.deepEqual(expired, [
    { kind: 'ship', playerId: 'target' },
    { kind: 'island', islandId: island.id, playerId: 'target' },
  ]);
  assert.equal(getShipVeilReaction(target), null);
  assert.equal(getIslandVeilReaction(island), null);
  assert.ok(getShipVeilEffect(target));
  assert.ok(getIslandVeilEffect(island));
});

test('exact legacy writes contain no domain metadata and restart continues persisted values without recalculation', () => {
  const player = {
    id: 'p1',
    activeTurnEffects: { moveBonus: 2, bestOfTwo: true },
    nextTurnEffects: { noIncome: true },
    legendaryEffects: { seaCurses: [] },
  };
  const island = { id: 'i1', ownerId: 'p1', legendaryVeil: null, legendaryVeilReaction: null };

  addShipVeilEffect(player, { remaining: 2, sourcePlayerId: 'p1', ignoreTurnNo: 8 });
  addSeaCurseEffect(player, { remaining: 2, penalty: 3, sourcePlayerId: 'enemy' });
  addShipVeilReaction(player, { expiry: 'end-of-current-turn', expiresOnPlayerId: 'enemy' });
  addIslandVeilEffect(island, { remaining: 2, sourcePlayerId: 'p1', ignoreTurnNo: 8 });
  addIslandVeilReaction(island, { expiry: 'end-of-current-turn', sourcePlayerId: 'p1', expiresOnPlayerId: 'enemy' });

  assert.deepEqual(player.legendaryEffects, {
    seaCurses: [{ remaining: 2, penalty: 3, sourcePlayerId: 'enemy' }],
    shipVeil: { remaining: 2, sourcePlayerId: 'p1', ignoreTurnNo: 8 },
    shipVeilReaction: { expiry: 'end-of-current-turn', expiresOnPlayerId: 'enemy' },
  });
  assert.deepEqual(island.legendaryVeil, { remaining: 2, sourcePlayerId: 'p1', ignoreTurnNo: 8 });
  assert.deepEqual(island.legendaryVeilReaction, { expiry: 'end-of-current-turn', sourcePlayerId: 'p1', expiresOnPlayerId: 'enemy' });

  const json = JSON.stringify({ player, island });
  for (const forbidden of ['temporaryEffects', '"targetType"', '"targetId"', '"state":"active"', '"payload"']) assert.equal(json.includes(forbidden), false);
  assert.deepEqual(player.nextTurnEffects, { noIncome: true });

  const restored = structuredClone({ player, island });
  assert.equal(getShipVeilEffect(restored.player).duration.remaining, 2);
  assert.equal(listSeaCurseEffects(restored.player)[0].duration.remaining, 2);
  assert.equal(getIslandVeilEffect(restored.island).duration.remaining, 2);
  assert.deepEqual(restored.player.activeTurnEffects, { moveBonus: 2, bestOfTwo: true });
  assert.deepEqual(restored.player.nextTurnEffects, { noIncome: true });
  assert.equal(Object.hasOwn(restored.player, 'effects'), false);
  assert.equal(Object.hasOwn(restored.island, 'effects'), false);

  removeShipVeilReaction(restored.player);
  removeIslandVeilReaction(restored.island);
  removeShipVeilEffect(restored.player);
  removeIslandVeilEffect(restored.island);
  assert.equal(restored.player.legendaryEffects.shipVeil, undefined);
  assert.equal(restored.player.legendaryEffects.shipVeilReaction, undefined);
  assert.equal(restored.island.legendaryVeil, null);
  assert.equal(restored.island.legendaryVeilReaction, null);
});
