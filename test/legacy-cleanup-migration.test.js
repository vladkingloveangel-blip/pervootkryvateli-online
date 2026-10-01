'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CURRENT_DIGITAL_MODEL_SCHEMA_VERSION,
  PENDING_ORCHESTRATION_DIGITAL_MODEL_SCHEMA_VERSION,
  LEGACY_CLEANUP_DIGITAL_MODEL_SCHEMA_VERSION,
  migrateRoomState,
} = require('../save-migrations');
const {
  SAILING_EVENT_DEFINITIONS,
  POLITICAL_EFFECT_DEFINITIONS,
  EXPEDITION_DEFINITIONS,
} = require('../game-data');
const { normalizeAssignmentCompatibility } = require('../game-logic');
const { getPendingResolution, getPreTurnResolutionFlow } = require('../domain-state');

function schema7(extra = {}) {
  return {
    code: 'M78',
    digitalModelSchemaVersion: PENDING_ORCHESTRATION_DIGITAL_MODEL_SCHEMA_VERSION,
    players: [],
    islands: [],
    order: [],
    ...extra,
  };
}

test('7 -> 8 removes retired decks/state and canonicalizes assignment-replace without changing active target state', () => {
  const activeEvent = {
    family: 'event',
    state: 'pending',
    id: 'active-event',
    actorPlayerId: 'p1',
    payload: { marker: { keep: true } },
  };
  const raw = schema7({
    treasureDeck: { drawPile: [{ id: 'retired-treasure' }] },
    legendaryDeck: { drawPile: [{ id: 'retired-legendary' }] },
    pendingStatePrize: { retired: true },
    pendingBattle: { id: 'battle', captureMode: 'legacy', futureBattleField: { keep: true } },
    pendingResolutions: {
      event: structuredClone(activeEvent),
      feud: null,
      'assignment-choice': { family: 'assignment-choice', state: 'pending', id: 'paid-replace', kind: 'replace-paid' },
      'legendary-reaction': {
        family: 'legendary-reaction',
        state: 'pending',
        payload: { captureMode: 'legacy', futureReactionField: { keep: true } },
      },
    },
    preTurnResolutionFlow: {
      active: true,
      stage: 'assignment-replace',
      queues: { assignment: [{ playerId: 'p1' }], replacement: ['p1'], futureQueue: ['keep'] },
      indexes: { assignment: 0, replacement: 0, futureIndex: 9 },
      futureFlowField: { keep: true },
    },
    players: [{
      id: 'p1',
      consumableAbilities: [],
      replacedAssignmentConditions: ['retired'],
      futurePlayerField: { keep: true },
    }],
    unknownRoot: { keep: ['future'] },
  });
  const before = structuredClone(raw);
  const migrated = migrateRoomState(raw);

  assert.deepEqual(raw, before);
  assert.equal(migrated.state.digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(migrated.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  for (const field of ['treasureDeck', 'legendaryDeck', 'pendingStatePrize']) {
    assert.equal(Object.hasOwn(migrated.state, field), false, field);
  }
  assert.equal(Object.hasOwn(migrated.state.pendingBattle, 'captureMode'), false);
  assert.deepEqual(migrated.state.pendingBattle.futureBattleField, { keep: true });
  assert.deepEqual(getPendingResolution(migrated.state, 'event').payload.marker, { keep: true });
  assert.equal(getPendingResolution(migrated.state, 'assignment-choice'), null);
  assert.equal(Object.hasOwn(migrated.state.pendingResolutions['legendary-reaction'].payload, 'captureMode'), false);
  assert.deepEqual(migrated.state.pendingResolutions['legendary-reaction'].payload.futureReactionField, { keep: true });

  const flow = getPreTurnResolutionFlow(migrated.state);
  assert.equal(flow.stage, 'assignment');
  assert.equal(flow.indexes.assignment, 1);
  assert.equal(Object.hasOwn(flow.indexes, 'replacement'), false);
  assert.equal(Object.hasOwn(flow.queues, 'replacement'), false);
  assert.deepEqual(flow.queues.futureQueue, ['keep']);
  assert.deepEqual(migrated.state.preTurnResolutionFlow.futureFlowField, { keep: true });
  assert.equal(migrated.state.preTurnResolutionFlow.migrationResumeEventPhase, true);
  assert.equal(Object.hasOwn(migrated.state.players[0], 'replacedAssignmentConditions'), false);
  assert.deepEqual(migrated.state.players[0].futurePlayerField, { keep: true });
  assert.deepEqual(migrated.state.unknownRoot, before.unknownRoot);
});

test('pendingLegendary becomes a deterministic target grant count; migration itself makes zero RNG calls', () => {
  const raw = schema7({
    randomSourceState: { assignmentPool: {} },
    players: [{
      id: 'p-grant',
      consumableAbilities: [],
      pendingLegendary: 2,
      activeAssignmentTask: null,
    }],
  });
  const before = structuredClone(raw);
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; throw new Error('migration must not use RNG'); };
  let migrated;
  try {
    migrated = migrateRoomState(raw).state;
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(calls, 0);
  assert.deepEqual(raw, before);
  assert.equal(Object.hasOwn(migrated.players[0], 'pendingLegendary'), false);
  assert.equal(migrated.players[0].pendingConsumableAbilityGrants, 2);

  const normalized = normalizeAssignmentCompatibility(migrated, () => 0.5);
  assert.equal(normalized.changed, true);
  assert.equal(Object.hasOwn(migrated.players[0], 'pendingConsumableAbilityGrants'), false);
  assert.equal(migrated.players[0].consumableAbilities.length, 2);
});

test('known consumed masterCardId payloads become canonical ids while unknown/future payloads are preserved', () => {
  const sailing = SAILING_EVENT_DEFINITIONS[0];
  const [factionId, politicalDefinitions] = Object.entries(POLITICAL_EFFECT_DEFINITIONS)
    .find(([, definitions]) => Array.isArray(definitions) && definitions.length) || [];
  const political = politicalDefinitions?.[0];
  assert.ok(sailing && factionId && political);

  const raw = schema7({
    pendingResolutions: {
      event: {
        family: 'event', state: 'pending',
        payload: { eventCard: { masterCardId: sailing.id, copy: 2, marker: 'event' } },
      },
      feud: {
        family: 'feud', state: 'pending',
        payload: { factionId, feudCard: { masterCardId: political.id, copy: 3, marker: 'feud' } },
      },
      'assignment-choice': null,
      'legendary-reaction': null,
    },
    players: [{
      id: 'p1',
      storedBenefits: [
        { source: { deck: 'event', occurrence: { masterCardId: sailing.id, copy: 4, marker: 'benefit' } } },
        { source: { deck: 'event', occurrence: { masterCardId: 'future-event-v99', copy: 1, marker: 'future' } } },
      ],
    }],
  });
  const migrated = migrateRoomState(raw).state;

  const eventCard = migrated.pendingResolutions.event.payload.eventCard;
  assert.equal(eventCard.id, sailing.id);
  assert.equal(Object.hasOwn(eventCard, 'masterCardId'), false);
  assert.equal(eventCard.marker, 'event');

  const feudCard = migrated.pendingResolutions.feud.payload.feudCard;
  assert.equal(feudCard.id, political.id);
  assert.equal(Object.hasOwn(feudCard, 'masterCardId'), false);
  assert.equal(feudCard.marker, 'feud');

  const benefitOccurrence = migrated.players[0].storedBenefits[0].source.occurrence;
  assert.equal(benefitOccurrence.id, sailing.id);
  assert.equal(Object.hasOwn(benefitOccurrence, 'masterCardId'), false);
  assert.equal(benefitOccurrence.marker, 'benefit');

  assert.deepEqual(
    migrated.players[0].storedBenefits[1].source.occurrence,
    raw.players[0].storedBenefits[1].source.occurrence
  );
});

test('retired Atlantia/Adia/Skull expedition entries are removed but valid and unknown/future entries survive', () => {
  const valid = EXPEDITION_DEFINITIONS[0];
  assert.ok(valid);
  const future = { expeditionId: 'future-expedition-v99', placeId: 'future-place-v99', future: true };
  const raw = schema7({
    randomSourceState: {
      expeditionPool: {
        available: [
          { id: 'expedition-atlantia', placeId: 'atlantia' },
          { id: valid.id, placeId: valid.placeId, marker: 'valid' },
          structuredClone(future),
        ],
        reserved: [
          { id: 'expedition-skull', placeId: 'skull' },
          { id: valid.id, placeId: valid.placeId, marker: 'reserved-valid' },
        ],
        futurePoolField: { keep: true },
      },
    },
    players: [
      {
        id: 'retired-active',
        activeExpeditionTask: { expeditionId: 'expedition-adia', placeId: 'adia', acceptedRound: 4 },
        expeditionCompletions: [
          { expeditionId: 'expedition-atlantia', placeId: 'atlantia' },
          { expeditionId: valid.id, placeId: valid.placeId, marker: 'valid-history' },
          structuredClone(future),
        ],
        expeditionAccessUsage: { round: 4, draws: 1 },
      },
      {
        id: 'valid-active',
        activeExpeditionTask: { expeditionId: valid.id, placeId: valid.placeId, acceptedRound: 5, futureTaskField: { keep: true } },
        expeditionCompletions: [],
        expeditionAccessUsage: { round: 5, draws: 1 },
      },
    ],
  });
  const migrated = migrateRoomState(raw).state;
  const pool = migrated.randomSourceState.expeditionPool;

  assert.deepEqual(pool.available.map(item => item.id || item.expeditionId), [valid.id, future.expeditionId]);
  assert.deepEqual(pool.reserved.map(item => item.id), [valid.id]);
  assert.deepEqual(pool.futurePoolField, { keep: true });
  assert.equal(migrated.players[0].activeExpeditionTask, null);
  assert.deepEqual(
    migrated.players[0].expeditionCompletions.map(item => item.expeditionId),
    [valid.id, future.expeditionId]
  );
  assert.deepEqual(migrated.players[1].activeExpeditionTask, raw.players[1].activeExpeditionTask);
});

test('proven-consumed compatibility duplicates are removed only when their target backing exists', () => {
  const raw = schema7({
    anchorDecks: { legacyOnlyBecauseTargetMissing: true },
    eventDeck: { drawPile: [{ id: 'stale-event' }] },
    feudDecks: { stale: true },
    assignmentDecks: { stale: true },
    expeditionDeck: { drawPile: [{ id: 'stale-expedition' }] },
    randomSourceState: {
      sailingEvent: { available: [], recyclable: [], reserved: [] },
      politicalEffect: {},
      assignmentPool: {},
      expeditionPool: { available: [], reserved: [] },
      // Deliberately no seaEncounter target: anchorDecks must be preserved.
    },
    pendingEvent: { stale: true },
    pendingExpeditionRewards: [{ stale: true }],
    eventPhase: { stale: true },
    pendingResolutions: { event: null, feud: null, 'assignment-choice': null, 'legendary-reaction': null },
    resolutionQueue: { kind: 'resolution-queue', items: [] },
    preTurnResolutionFlow: null,
    discoveries: {},
    legendaryPlacesExplored: { stale: true },
    players: [{
      id: 'p1',
      activeAssignmentTask: null,
      activeAssignment: { stale: true },
      consumableAbilities: [],
      legendaryCards: [{ stale: true }],
      specialCards: ['stale'],
      // No storedBenefits target: this legacy field is not proven consumed and must remain.
      savedEventCards: [{ preserve: true }],
      namedPlaceCards: [{ stale: true }],
      temporaryEffects: { active: [], scheduled: [] },
      activeTurnEffects: { stale: true },
      nextTurnEffects: [{ stale: true }],
      legendaryEffects: { stale: true },
    }],
  });
  const migrated = migrateRoomState(raw).state;

  assert.deepEqual(migrated.anchorDecks, raw.anchorDecks);
  for (const field of ['eventDeck', 'feudDecks', 'assignmentDecks', 'expeditionDeck', 'pendingEvent', 'pendingExpeditionRewards', 'eventPhase', 'legendaryPlacesExplored']) {
    assert.equal(Object.hasOwn(migrated, field), false, field);
  }
  const player = migrated.players[0];
  for (const field of ['activeAssignment', 'legendaryCards', 'specialCards', 'namedPlaceCards', 'activeTurnEffects', 'nextTurnEffects', 'legendaryEffects']) {
    assert.equal(Object.hasOwn(player, field), false, field);
  }
  assert.deepEqual(player.savedEventCards, [{ preserve: true }]);
});

test('7 -> 8 cleanup is pure, zero-RNG and second migration is content-exact no-op', () => {
  const raw = schema7({
    treasureDeck: { inert: true },
    legendaryDeck: { inert: true },
    players: [{ id: 'p1', consumableAbilities: [], pendingLegendary: 0 }],
    unknownRoot: { nested: { keep: [1, 2, 3] } },
  });
  const before = structuredClone(raw);
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; throw new Error('migration must not use RNG'); };
  let first;
  try {
    first = migrateRoomState(raw);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(calls, 0);
  assert.deepEqual(raw, before);
  assert.equal(first.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(first.state.unknownRoot, before.unknownRoot);

  const snapshot = structuredClone(first.state);
  const second = migrateRoomState(first.state);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.state, snapshot);
});
