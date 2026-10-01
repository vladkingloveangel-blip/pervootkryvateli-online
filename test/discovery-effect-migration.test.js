'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CURRENT_DIGITAL_MODEL_SCHEMA_VERSION,
  PLAYER_TASK_INVENTORY_DIGITAL_MODEL_SCHEMA_VERSION,
  DISCOVERY_EFFECT_DIGITAL_MODEL_SCHEMA_VERSION,
  migrateRoomState,
} = require('../save-migrations');
const {
  getDiscovery,
  claimDiscovery,
  getShipVeilEffect,
  listSeaCurseEffects,
  getIslandVeilEffect,
  getIslandVeilReaction,
  getActiveTurnEffectValue,
  scheduledTurnEffectsSnapshot,
  activateNextTurnEffects,
  tickSeaCurseEffects,
  tickIslandVeilEffect,
} = require('../domain-state');
const { claimLegendaryPlaceDiscovery, legendaryMovementPenalty } = require('../game-logic');
const { NAMED_PLACE_CARDS } = require('../game-data');

function fixture() {
  return {
    code: 'FX66',
    digitalModelSchemaVersion: PLAYER_TASK_INVENTORY_DIGITAL_MODEL_SCHEMA_VERSION,
    players: [
      {
        id: 'p1',
        namedPlaceCards: [structuredClone(NAMED_PLACE_CARDS.find(card => card.placeId === 'kraken'))],
        activeAssignmentTask: null,
        consumableAbilities: [],
        consumableAbilitySequence: 0,
        storedBenefits: [],
        activeTurnEffects: { movePenalty: 2 },
        nextTurnEffects: { moveBonus: 3 },
        legendaryEffects: {
          shipVeil: { remaining: 2, sourcePlayerId: 'p1', ignoreTurnNo: 7, futureVeilField: { keep: true } },
          seaCurses: [
            { remaining: 2, penalty: 1, sourcePlayerId: 'enemy-a', futureCurseField: 'a' },
            { remaining: 3, penalty: 2, sourcePlayerId: 'enemy-b', futureCurseField: 'b' },
          ],
          shipVeilReaction: { expiry: 'end-of-current-turn', expiresOnPlayerId: 'enemy-a' },
          futureLegendaryField: { keep: true },
        },
        futurePlayerField: { keep: true },
      },
      {
        id: 'p2',
        namedPlaceCards: [structuredClone(NAMED_PLACE_CARDS.find(card => card.placeId === 'kraken'))],
        activeAssignmentTask: null,
        consumableAbilities: [],
        consumableAbilitySequence: 0,
        storedBenefits: [],
        activeTurnEffects: {},
        nextTurnEffects: {},
        legendaryEffects: { seaCurses: [] },
      },
    ],
    islands: [{
      id: 'island-1',
      ownerId: 'p1',
      legendaryVeil: { remaining: 2, sourcePlayerId: 'p1', ignoreTurnNo: 7, futureIslandVeilField: 9 },
      legendaryVeilReaction: { expiry: 'end-of-current-turn', sourcePlayerId: 'p1', expiresOnPlayerId: 'enemy-a' },
      futureIslandField: { keep: true },
    }],
    order: ['p1', 'p2'],
    legendaryPlacesExplored: { kraken: 'p1' },
    pendingExpeditionRewards: [{ id: 'untouched' }],
    pendingEvent: { id: 'pending-event' },
    pendingLegendaryReaction: { id: 'pending-reaction' },
    eventPhase: { active: true, stage: 'political' },
    unknownRoot: { keep: true },
  };
}

test('5 -> 6 migrates discoveries and typed effects purely; duplicate named-place state cannot steal ownership', () => {
  const raw = fixture();
  const before = structuredClone(raw);
  let calls = 0;
  const oldRandom = Math.random;
  Math.random = () => { calls += 1; throw new Error('migration RNG forbidden'); };
  let result;
  try {
    result = migrateRoomState(raw);
  } finally {
    Math.random = oldRandom;
  }

  assert.equal(calls, 0);
  assert.equal(result.fromVersion, PLAYER_TASK_INVENTORY_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(result.toVersion, DISCOVERY_EFFECT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(result.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(raw, before);
  assert.equal(result.state.discoveries.kraken.ownerId, 'p1');
  assert.equal(result.state.discoveries.kraken.rewardGranted, true);
  assert.equal(Object.hasOwn(result.state, 'legendaryPlacesExplored'), false);
  assert.equal(Object.hasOwn(result.state.players[0], 'namedPlaceCards'), false);
  assert.equal(Object.hasOwn(result.state.players[1], 'namedPlaceCards'), false);
  assert.equal(getDiscovery(result.state, 'kraken').ownerId, 'p1');
  assert.deepEqual(result.state.pendingExpeditionRewards, before.pendingExpeditionRewards);
  assert.deepEqual(result.state.pendingEvent, before.pendingEvent);
  assert.deepEqual(result.state.pendingLegendaryReaction, before.pendingLegendaryReaction);
  assert.deepEqual(result.state.eventPhase, before.eventPhase);
  assert.deepEqual(result.state.unknownRoot, before.unknownRoot);
  assert.deepEqual(result.state.players[0].futurePlayerField, before.players[0].futurePlayerField);
  assert.deepEqual(result.state.islands[0].futureIslandField, before.islands[0].futureIslandField);
});

test('mid-effect restart preserves ship veil timing, stacked curses and unknown legacy effect data', () => {
  const restored = JSON.parse(JSON.stringify(migrateRoomState(fixture()).state));
  const player = restored.players[0];

  assert.equal(getShipVeilEffect(player).duration.remaining, 2);
  assert.equal(getShipVeilEffect(player).duration.ignoreTurnNo, 7);
  assert.deepEqual(listSeaCurseEffects(player).map(effect => effect.duration.remaining), [2, 3]);
  assert.deepEqual(listSeaCurseEffects(player).map(effect => effect.payload.penalty), [1, 2]);
  assert.equal(legendaryMovementPenalty(player), 3);
  assert.equal(player.temporaryEffects.compatibility.legendaryEffects.futureLegendaryField.keep, true);
  assert.equal(player.temporaryEffects.active.find(effect => effect.kind === 'ship-veil').legacyData.futureVeilField.keep, true);
  assert.equal(player.temporaryEffects.active.filter(effect => effect.kind === 'sea-curse')[0].legacyData.futureCurseField, 'a');

  const ticked = tickSeaCurseEffects(player);
  assert.equal(ticked.expired.length, 0);
  assert.deepEqual(listSeaCurseEffects(player).map(effect => effect.duration.remaining), [1, 2]);
});

test('island veil/reaction retain target linkage and exact timing across migration/restart', () => {
  const restored = JSON.parse(JSON.stringify(migrateRoomState(fixture()).state));
  const island = restored.islands[0];
  const veil = getIslandVeilEffect(island);
  const reaction = getIslandVeilReaction(island);

  assert.equal(veil.targetType, 'island');
  assert.equal(veil.targetId, 'island-1');
  assert.equal(veil.source.sourcePlayerId, 'p1');
  assert.equal(veil.duration.remaining, 2);
  assert.equal(reaction.targetId, 'island-1');
  assert.equal(reaction.source.sourcePlayerId, 'p1');
  assert.equal(reaction.duration.expiresOnPlayerId, 'enemy-a');
  assert.equal(island.temporaryEffects.active.find(effect => effect.kind === 'island-veil').legacyData.futureIslandVeilField, 9);

  const skipped = tickIslandVeilEffect(island, 'p1', 7);
  assert.equal(skipped.skipped, true);
  assert.equal(getIslandVeilEffect(island).duration.remaining, 2);
  assert.equal(getIslandVeilEffect(island).duration.ignoreTurnNo, null);
});

test('legacy next-turn event remains scheduled until exactly the next activation', () => {
  const restored = JSON.parse(JSON.stringify(migrateRoomState(fixture()).state));
  const player = restored.players[0];

  assert.deepEqual(scheduledTurnEffectsSnapshot(player), { moveBonus: 3 });
  assert.equal(getActiveTurnEffectValue(player, 'movePenalty'), 2);
  assert.equal(getActiveTurnEffectValue(player, 'moveBonus'), undefined);

  activateNextTurnEffects(player);
  assert.equal(getActiveTurnEffectValue(player, 'movePenalty'), undefined);
  assert.equal(getActiveTurnEffectValue(player, 'moveBonus'), 3);
  assert.deepEqual(scheduledTurnEffectsSnapshot(player), {});

  activateNextTurnEffects(player);
  assert.equal(getActiveTurnEffectValue(player, 'moveBonus'), undefined);
});

test('discovery restart cannot replay random reward after migration', () => {
  const restored = JSON.parse(JSON.stringify(migrateRoomState(fixture()).state));
  const p2 = restored.players[1];
  let calls = 0;
  const repeated = claimLegendaryPlaceDiscovery(restored, p2, 'kraken', () => { calls += 1; return 0; });

  assert.equal(repeated.first, false);
  assert.equal(repeated.exploredBy, 'p1');
  assert.equal(calls, 0);
  assert.deepEqual(repeated.legendaryCards, []);
  assert.equal(restored.discoveries.kraken.rewardGranted, true);

  const direct = claimDiscovery(restored, 'kraken', 'p2');
  assert.equal(direct.first, false);
  assert.equal(direct.ownerId, 'p1');
});

test('schema 6 second migration is a content-exact no-op', () => {
  const first = migrateRoomState(fixture()).state;
  const before = structuredClone(first);
  const second = migrateRoomState(first);

  assert.equal(second.migrated, false);
  assert.equal(second.fromVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(second.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(second.state, before);
});
