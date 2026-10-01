'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { ANCHOR_CARDS, POLITICAL_FACTION_ORDER, EXPEDITION_DEFINITIONS, LEGENDARY_PLACES } = require('../game-data');
const {
  CURRENT_DIGITAL_MODEL_SCHEMA_VERSION,
  SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION,
  ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION,
  EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION,
  RANDOM_SOURCE_STATE_FIELD,
  migrateRoomState,
} = require('../save-migrations');
const { RoomStore } = require('../room-store');
const { seaEncounterSource } = require('../sea-encounter-source');
const { sailingEventSource } = require('../sailing-event-source');
const { politicalEffectSource } = require('../political-effect-source');
const { assignmentPool } = require('../assignment-pool');
const { expeditionPool } = require('../expedition-pool');
const {
  completeExpeditionAtArrival,
  expeditionCardEligibleForPlayer,
  expeditionTakenThisRound,
  getActiveExpeditionTask,
} = require('../game-logic');

const logger = { log() {}, error() {} };
const anchorColor = Object.keys(ANCHOR_CARDS)[0];
const politicalFactionId = POLITICAL_FACTION_ORDER[0];
const assignmentFactionId = 'lionia';

function pool() {
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  return new Pool();
}

function occurrenceKey(occurrence) {
  return `${occurrence?.id || occurrence?.conditionKey}:${occurrence?.copy ?? 'legacy'}`;
}

function sequence(values) {
  let index = 0;
  const rng = () => values[index++] ?? 0;
  rng.calls = () => index;
  return rng;
}

function v1Fixture() {
  const held = { id: 'held-event', copy: 7, unknownHeld: { keep: true } };
  return {
    code: 'ABCDE',
    digitalModelSchemaVersion: 1,
    rulesDataVersion: 'legacy-rules-data',
    rulesSchemaVersion: 77,
    runtimeProfile: 'legacy-runtime-profile',
    started: true,
    phase: 'actions',
    players: [{
      id: 'p1',
      socketId: 'stale-socket',
      connected: true,
      savedEventCards: [{
        id: 'held-benefit',
        kind: 'ship-master',
        sourceDeck: 'event',
        sourceCard: held,
      }],
      activeAssignment: null,
      activeExpedition: { instanceId: 'expedition-1', card: { id: 'exp-a' } },
      expeditionHistory: [{ definitionId: 'exp-old', completedRound: 2 }],
      legendaryCards: [{ id: 'sea-veil', copy: 2 }],
      specialCards: ['treasure-hunter'],
      namedPlaceCards: [{ placeId: 'place-1', claimedBy: 'p1' }],
      legendaryPlacesExplored: ['place-1'],
      activeTurnEffects: { movement: [{ id: 'effect-1', amount: 1 }] },
      nextTurnEffects: { moveBonus: 2 },
      futurePlayerField: { nested: ['keep', { exactly: true }] },
    }],
    islands: [{ id: 'island-1', ownerId: 'p1', futureIslandField: { keep: 9 } }],
    order: ['p1'],
    anchorDecks: {
      [anchorColor]: {
        drawPile: [{ id: 'sea-next', copy: 1 }, { id: 'sea-tail', copy: 2 }],
        discard: [{ id: 'sea-used', copy: 3 }],
        futureBucketField: { keep: 'sea' },
      },
    },
    eventDeck: {
      drawPile: [{ id: 'sail-next', copy: 1 }, { id: 'sail-tail', copy: 2 }],
      discard: [{ id: 'sail-used', copy: 3 }],
      futureBucketField: { keep: 'sailing' },
    },
    feudDecks: {
      [politicalFactionId]: {
        drawPile: [{ id: 'political-next', copy: 1 }, { id: 'political-tail', copy: 2 }],
        discard: [{ id: 'political-used', copy: 3 }],
        futureBucketField: { keep: 'political' },
      },
    },
    assignmentDecks: {
      [assignmentFactionId]: {
        drawPile: [{ id: 'assignment-next', copy: 1 }],
        discard: [{ id: 'assignment-used', copy: 2 }],
        removed: [{ id: 'assignment-removed', copy: 3 }],
        futureBucketField: { keep: 'assignment' },
      },
    },
    expeditionDeck: { drawPile: [{ id: 'expedition-a' }] },
    pendingExpeditionRewards: [{ id: 'reward-1' }],
    pendingEvent: null,
    pendingFeud: null,
    pendingAssignmentChoice: null,
    pendingLegendaryReaction: { id: 'pending-legendary', playerId: 'p1' },
    eventPhase: { active: true, stage: 'assignment', assignmentIndex: 1 },
    unknownLegacyRoot: { nested: { array: [1, 2, { keep: 'yes' }] } },
  };
}

function v2Fixture() {
  const raw = v1Fixture();
  const held = raw.players[0].savedEventCards[0].sourceCard;
  raw.digitalModelSchemaVersion = SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION;
  raw[RANDOM_SOURCE_STATE_FIELD] = {
    seaEncounter: {
      [anchorColor]: {
        available: structuredClone(raw.anchorDecks[anchorColor].drawPile),
        recyclable: structuredClone(raw.anchorDecks[anchorColor].discard),
        futureBucketField: { keep: 'sea' },
      },
    },
    sailingEvent: {
      available: structuredClone(raw.eventDeck.drawPile),
      recyclable: structuredClone(raw.eventDeck.discard),
      reserved: [structuredClone(held)],
      futureBucketField: { keep: 'sailing' },
    },
    politicalEffect: {
      [politicalFactionId]: {
        available: structuredClone(raw.feudDecks[politicalFactionId].drawPile),
        recyclable: structuredClone(raw.feudDecks[politicalFactionId].discard),
        reserved: [],
        futureBucketField: { keep: 'political' },
      },
    },
    unknownSourceFamily: { keep: ['yes'] },
  };
  delete raw.anchorDecks;
  delete raw.eventDeck;
  delete raw.feudDecks;
  return raw;
}

function assignmentFixture() {
  const raw = v2Fixture();
  const active = { id: 'active-card', copy: 2, status: 'eligible', unknownActive: true };
  const embassyA = { id: 'embassy-a', copy: 1, status: 'eligible', marker: 'A' };
  const embassyB = { id: 'embassy-b', copy: 3, status: 'eligible', marker: 'B' };
  const next = { id: 'next-card', copy: 1, status: 'eligible' };
  const skipped = { id: 'skip-card', copy: 4, status: 'skip' };
  const tail = { id: 'tail-card', copy: 1, status: 'eligible' };
  const recyclable = { id: 'recyclable-card', copy: 5, status: 'eligible' };
  const removed = { id: 'removed-card', copy: 6, status: 'eligible' };

  raw.players = [
    {
      ...raw.players[0],
      id: 'owner',
      activeAssignment: {
        instanceId: 'active-instance',
        factionId: assignmentFactionId,
        card: structuredClone(active),
        issuedRound: 2,
        futureTaskField: { keep: true },
      },
    },
    {
      id: 'embassy-owner',
      activeAssignment: null,
      savedEventCards: [],
      futurePlayerField: { embassy: true },
    },
  ];
  raw.order = raw.players.map(player => player.id);
  raw.pendingAssignmentChoice = {
    id: 'pending-embassy',
    kind: 'embassy',
    playerId: 'embassy-owner',
    factionId: assignmentFactionId,
    options: [structuredClone(embassyB), structuredClone(embassyA)],
    futurePendingField: { keep: 'pending' },
  };
  raw.assignmentDecks = {
    [assignmentFactionId]: {
      drawPile: [
        structuredClone(next),
        structuredClone(active),
        structuredClone(embassyA),
        structuredClone(skipped),
        structuredClone(embassyB),
        structuredClone(tail),
      ],
      discard: [structuredClone(recyclable)],
      removed: [structuredClone(removed)],
      futureBucketField: { keep: 'assignment' },
    },
    kadingir: {
      drawPile: [{ id: 'other-faction-next', copy: 1, status: 'eligible' }],
      discard: [],
      removed: [],
    },
    futureAssignmentGroupField: { preserve: true },
  };

  return { raw, active, embassyA, embassyB, next, skipped, tail, recyclable, removed };
}


function v3ExpeditionFixture() {
  const activeDefinition = EXPEDITION_DEFINITIONS.find(definition => LEGENDARY_PLACES[definition.placeId])
    || EXPEDITION_DEFINITIONS[0];
  const remainingDefinitions = EXPEDITION_DEFINITIONS.filter(definition => definition.id !== activeDefinition.id);
  const active = { ...activeDefinition, copy: 1, futureOccurrenceField: { keep: 'active' } };
  const available = remainingDefinitions.map((definition, index) => ({
    ...definition,
    copy: 1,
    futureOccurrenceField: { order: index },
  }));
  const firstHistory = available[0];
  const secondHistory = available[1] || available[0];

  const raw = {
    code: 'EXP34',
    digitalModelSchemaVersion: ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION,
    started: true,
    phase: 'actions',
    round: 7,
    players: [
      {
        id: 'p1',
        row: 0,
        col: 0,
        activeAssignment: { instanceId: 'assignment-stays', factionId: 'lionia' },
        activeExpedition: {
          card: structuredClone(active),
          cardId: active.id,
          name: active.name,
          placeId: active.placeId,
          acceptedRound: 7,
          startedAtTarget: true,
          departedAfterIssue: false,
          futureActiveField: { keep: true },
        },
        expeditionHistory: [{
          placeId: firstHistory.placeId,
          cardId: firstHistory.id,
          name: firstHistory.name,
          completedRound: 6,
          futureHistoryField: { keep: 'p1' },
        }],
        expeditionDrawRound: 7,
        expeditionsDrawnThisRound: 1,
        legendaryCards: [{ id: 'sea-veil', copy: 2 }],
        specialCards: ['treasure-hunter'],
        savedEventCards: [{ id: 'benefit-stays' }],
        futurePlayerField: { keep: 'p1' },
      },
      {
        id: 'p2',
        row: 0,
        col: 0,
        activeAssignment: null,
        activeExpedition: null,
        expeditionHistory: [{
          placeId: secondHistory.placeId,
          cardId: secondHistory.id,
          name: secondHistory.name,
          completedRound: 5,
          futureHistoryField: { keep: 'p2' },
        }],
        expeditionDrawRound: 6,
        expeditionsDrawnThisRound: 0,
        legendaryCards: [],
        specialCards: [],
        savedEventCards: [],
        futurePlayerField: { keep: 'p2' },
      },
    ],
    order: ['p1', 'p2'],
    randomSourceState: {
      assignmentPool: { futureAssignmentPoolField: { keep: true } },
      unknownSourceFamily: { keep: ['source'] },
    },
    expeditionDeck: {
      drawPile: available.map(item => structuredClone(item)),
      futurePoolField: { keep: true },
    },
    pendingExpeditionRewards: [{ id: 'reward-stays' }],
    pendingLegendaryReaction: { id: 'reaction-stays' },
    eventPhase: { active: true, stage: 'political' },
    unknownRoot: { keep: ['root'] },
  };
  return { raw, active, available, firstHistory, secondHistory };
}

test('1 -> 2 -> 3 -> 4 chains source migrations without mutating input or using RNG', () => {
  const raw = v1Fixture();
  const before = structuredClone(raw);
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; throw new Error('migration must not use RNG'); };
  let result;
  try {
    result = migrateRoomState(raw);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(calls, 0);
  assert.equal(result.migrated, true);
  assert.equal(result.fromVersion, 1);
  assert.equal(result.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(result.state.digitalModelSchemaVersion, EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(raw, before);

  for (const field of ['anchorDecks', 'eventDeck', 'feudDecks', 'assignmentDecks', 'expeditionDeck']) {
    assert.equal(Object.hasOwn(result.state, field), false, field);
  }

  const sources = result.state[RANDOM_SOURCE_STATE_FIELD];
  assert.deepEqual(sources.seaEncounter[anchorColor].available, before.anchorDecks[anchorColor].drawPile);
  assert.deepEqual(sources.seaEncounter[anchorColor].recyclable, before.anchorDecks[anchorColor].discard);
  assert.deepEqual(sources.sailingEvent.available, before.eventDeck.drawPile);
  assert.deepEqual(sources.sailingEvent.recyclable, before.eventDeck.discard);
  assert.deepEqual(sources.sailingEvent.reserved, [before.players[0].savedEventCards[0].sourceCard]);
  assert.deepEqual(sources.politicalEffect[politicalFactionId].available, before.feudDecks[politicalFactionId].drawPile);
  assert.deepEqual(sources.politicalEffect[politicalFactionId].recyclable, before.feudDecks[politicalFactionId].discard);

  const assignment = sources.assignmentPool[assignmentFactionId];
  assert.deepEqual(assignment.available, before.assignmentDecks[assignmentFactionId].drawPile);
  assert.deepEqual(assignment.recyclable, before.assignmentDecks[assignmentFactionId].discard);
  assert.deepEqual(assignment.permanentlyExcluded, before.assignmentDecks[assignmentFactionId].removed);
  assert.deepEqual(assignment.reserved, []);
  assert.deepEqual(assignment.futureBucketField, { keep: 'assignment' });

  assert.deepEqual(sources.expeditionPool.available, before.expeditionDeck.drawPile);
  assert.deepEqual(sources.expeditionPool.reserved, [{ id: 'exp-a' }]);
  for (const field of ['pendingExpeditionRewards','pendingEvent','pendingFeud','pendingAssignmentChoice','pendingLegendaryReaction','eventPhase']) {
    assert.deepEqual(result.state[field], before[field], field);
  }
  assert.deepEqual(result.state.players[0].legendaryCards, before.players[0].legendaryCards);
  assert.deepEqual(result.state.players[0].specialCards, before.players[0].specialCards);
  assert.deepEqual(result.state.players[0].savedEventCards, before.players[0].savedEventCards);
  assert.deepEqual(result.state.players[0].activeAssignment, before.players[0].activeAssignment);
  assert.deepEqual(result.state.unknownLegacyRoot, before.unknownLegacyRoot);
});

test('unversioned old save dispatches 0 -> 1 -> 2 -> 3 -> 4 with zero RNG calls', () => {
  const raw = v1Fixture();
  delete raw.digitalModelSchemaVersion;
  const before = structuredClone(raw);
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; throw new Error('migration must not use RNG'); };
  try {
    const result = migrateRoomState(raw);
    assert.equal(result.fromVersion, 0);
    assert.equal(result.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
    assert.equal(result.migrated, true);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(calls, 0);
  assert.deepEqual(raw, before);
});

test('2 -> 3 maps available/recyclable/removed and preserves partially spent order and unknown fields', () => {
  const { raw, next, skipped, tail, recyclable, removed } = assignmentFixture();
  const before = structuredClone(raw);
  const result = migrateRoomState(raw);

  assert.equal(result.fromVersion, SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(result.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(Object.hasOwn(result.state, 'assignmentDecks'), false);
  assert.deepEqual(raw, before);

  const storage = result.state[RANDOM_SOURCE_STATE_FIELD].assignmentPool[assignmentFactionId];
  assert.deepEqual(storage.available.map(occurrenceKey), [next, skipped, tail].map(occurrenceKey));
  assert.deepEqual(storage.recyclable.map(occurrenceKey), [occurrenceKey(recyclable)]);
  assert.deepEqual(storage.permanentlyExcluded.map(occurrenceKey), [occurrenceKey(removed)]);
  assert.deepEqual(storage.futureBucketField, { keep: 'assignment' });
  assert.deepEqual(result.state[RANDOM_SOURCE_STATE_FIELD].unknownSourceFamily, before[RANDOM_SOURCE_STATE_FIELD].unknownSourceFamily);
  assert.deepEqual(result.state[RANDOM_SOURCE_STATE_FIELD].assignmentPool.futureAssignmentGroupField, { preserve: true });
});

test('2 -> 3 restores active assignment occurrence into reserved without migrating activeAssignment shape', () => {
  const { raw, active } = assignmentFixture();
  const beforeActive = structuredClone(raw.players[0].activeAssignment);
  const migrated = migrateRoomState(raw).state;
  const storage = migrated[RANDOM_SOURCE_STATE_FIELD].assignmentPool[assignmentFactionId];

  assert.deepEqual(migrated.players[0].activeAssignment, beforeActive);
  assert.equal(storage.available.some(item => occurrenceKey(item) === occurrenceKey(active)), false);
  assert.equal(storage.recyclable.some(item => occurrenceKey(item) === occurrenceKey(active)), false);
  assert.equal(storage.permanentlyExcluded.some(item => occurrenceKey(item) === occurrenceKey(active)), false);
  assert.equal(storage.reserved.filter(item => occurrenceKey(item) === occurrenceKey(active)).length, 1);
});

test('2 -> 3 preserves Embassy option order and id+copy identity while reserving every option', () => {
  const { raw, active, embassyA, embassyB } = assignmentFixture();
  const beforePending = structuredClone(raw.pendingAssignmentChoice);
  const migrated = migrateRoomState(raw).state;
  const storage = migrated[RANDOM_SOURCE_STATE_FIELD].assignmentPool[assignmentFactionId];

  assert.deepEqual(migrated.pendingAssignmentChoice, beforePending);
  assert.deepEqual(
    migrated.pendingAssignmentChoice.options.map(occurrenceKey),
    [embassyB, embassyA].map(occurrenceKey)
  );
  assert.deepEqual(
    storage.reserved.map(occurrenceKey),
    [active, embassyB, embassyA].map(occurrenceKey)
  );
  for (const option of [embassyA, embassyB]) {
    assert.equal(storage.available.some(item => occurrenceKey(item) === occurrenceKey(option)), false);
    assert.equal(storage.recyclable.some(item => occurrenceKey(item) === occurrenceKey(option)), false);
  }
});

test('permanently removed assignment remains excluded and is never converted into a reservation', () => {
  const { raw, removed } = assignmentFixture();
  raw.players[0].activeAssignment = {
    instanceId: 'corrupt-active',
    factionId: assignmentFactionId,
    card: structuredClone(removed),
  };
  const migrated = migrateRoomState(raw).state;
  const storage = migrated[RANDOM_SOURCE_STATE_FIELD].assignmentPool[assignmentFactionId];

  assert.equal(storage.permanentlyExcluded.filter(item => occurrenceKey(item) === occurrenceKey(removed)).length, 1);
  assert.equal(storage.reserved.some(item => occurrenceKey(item) === occurrenceKey(removed)), false);
  assert.equal(storage.available.some(item => occurrenceKey(item) === occurrenceKey(removed)), false);
});

test('exact eligible continuation and RNG trace match schema 2 after migration', () => {
  const raw = v2Fixture();
  raw.players = [{ id: 'p1', activeAssignment: null }];
  raw.pendingAssignmentChoice = null;
  raw.assignmentDecks = {
    [assignmentFactionId]: {
      drawPile: [
        { id: 'skip-first', copy: 1, status: 'skip' },
        { id: 'remove-first', copy: 1, status: 'remove' },
        { id: 'eligible-a', copy: 1, status: 'eligible' },
        { id: 'eligible-b', copy: 2, status: 'eligible' },
      ],
      discard: [{ id: 'recycle-c', copy: 1, status: 'eligible' }],
      removed: [{ id: 'already-removed', copy: 1, status: 'eligible' }],
    },
  };

  const oldRoom = structuredClone(raw);
  const newRoom = migrateRoomState(raw).state;
  const oldRng = sequence([0.8, 0.2, 0.7, 0.1, 0.6, 0.3]);
  const newRng = sequence([0.8, 0.2, 0.7, 0.1, 0.6, 0.3]);
  const classify = (_room, _player, occurrence) => occurrence.status;
  const oldPool = assignmentPool(oldRoom, assignmentFactionId, oldRng, { classify });
  const newPool = assignmentPool(newRoom, assignmentFactionId, newRng, { classify });
  const player = oldRoom.players[0];

  const oldOffered = oldPool.offerEligible(player, 2);
  const newOffered = newPool.offerEligible(newRoom.players[0], 2);
  assert.deepEqual(newOffered.map(occurrenceKey), oldOffered.map(occurrenceKey));
  assert.equal(newRng.calls(), oldRng.calls());

  const oldChoice = oldPool.chooseOffered(oldOffered, oldOffered[0].id);
  const newChoice = newPool.chooseOffered(newOffered, newOffered[0].id);
  assert.deepEqual(occurrenceKey(newChoice.chosen), occurrenceKey(oldChoice.chosen));
  assert.equal(newChoice.returned, oldChoice.returned);
  assert.equal(newRng.calls(), oldRng.calls());

  const oldAvailable = oldRoom.assignmentDecks[assignmentFactionId].drawPile.map(occurrenceKey);
  const newAvailable = newRoom[RANDOM_SOURCE_STATE_FIELD].assignmentPool[assignmentFactionId].available.map(occurrenceKey);
  assert.deepEqual(newAvailable, oldAvailable);
  assert.deepEqual(
    newRoom[RANDOM_SOURCE_STATE_FIELD].assignmentPool[assignmentFactionId].permanentlyExcluded.map(occurrenceKey),
    oldRoom.assignmentDecks[assignmentFactionId].removed.map(occurrenceKey)
  );
});

test('SKIP remains temporary after migration and later becomes eligible without duplication', () => {
  const raw = v2Fixture();
  raw.players = [{ id: 'p1', activeAssignment: null }];
  raw.pendingAssignmentChoice = null;
  raw.assignmentDecks = {
    [assignmentFactionId]: {
      drawPile: [{ id: 'later', copy: 4 }],
      discard: [],
      removed: [],
    },
  };
  const migrated = migrateRoomState(raw).state;
  let eligible = false;
  const source = assignmentPool(migrated, assignmentFactionId, () => 0, {
    classify: () => eligible ? 'eligible' : 'skip',
  });

  assert.deepEqual(source.offerEligible(migrated.players[0], 1), []);
  let storage = migrated[RANDOM_SOURCE_STATE_FIELD].assignmentPool[assignmentFactionId];
  assert.deepEqual(storage.available.map(occurrenceKey), ['later:4']);
  assert.deepEqual(storage.reserved, []);
  assert.deepEqual(storage.permanentlyExcluded, []);

  eligible = true;
  const [offered] = source.offerEligible(migrated.players[0], 1);
  assert.equal(occurrenceKey(offered), 'later:4');
  storage = migrated[RANDOM_SOURCE_STATE_FIELD].assignmentPool[assignmentFactionId];
  assert.deepEqual(storage.available, []);
  assert.deepEqual(storage.reserved.map(occurrenceKey), ['later:4']);
});

test('active and Embassy reservations survive JSON restart without redraw or reselect', () => {
  const { raw, active, embassyA, embassyB } = assignmentFixture();
  const migrated = migrateRoomState(raw).state;
  const restored = JSON.parse(JSON.stringify(migrated));
  const storage = restored[RANDOM_SOURCE_STATE_FIELD].assignmentPool[assignmentFactionId];

  assert.deepEqual(storage.reserved.map(occurrenceKey), [active, embassyB, embassyA].map(occurrenceKey));
  assert.deepEqual(restored.pendingAssignmentChoice.options.map(occurrenceKey), [embassyB, embassyA].map(occurrenceKey));
  assert.equal(restored.players[0].activeAssignment.card.id, active.id);

  const other = { id: 'other', activeAssignment: null };
  restored.players.push(other);
  const source = assignmentPool(restored, assignmentFactionId, () => 0, {
    classify: () => 'eligible',
  });
  const offered = source.offerEligible(other, 10);
  const offeredKeys = new Set(offered.map(occurrenceKey));
  for (const reserved of [active, embassyA, embassyB]) {
    assert.equal(offeredKeys.has(occurrenceKey(reserved)), false);
  }
});

test('known next outcomes for 6.2 sources remain unchanged through the 2 -> 3 dispatcher step', () => {
  const legacy = v1Fixture();
  legacy.players[0].savedEventCards = [];
  const migrated = migrateRoomState(legacy).state;
  const noRng = () => { throw new Error('known next must not need RNG'); };

  assert.deepEqual(
    seaEncounterSource(migrated, anchorColor, noRng).peekNext(),
    legacy.anchorDecks[anchorColor].drawPile[0]
  );
  assert.deepEqual(
    sailingEventSource(migrated, noRng).consumeNext().id,
    legacy.eventDeck.drawPile[0].id
  );
  assert.deepEqual(
    politicalEffectSource(migrated, politicalFactionId, noRng).consumeNext().id,
    legacy.feudDecks[politicalFactionId].drawPile[0].id
  );
});


test('3 -> 4 migrates ExpeditionPool, active task, histories and usage with zero RNG and unknown-field preservation', () => {
  const { raw, active, available, firstHistory, secondHistory } = v3ExpeditionFixture();
  const before = structuredClone(raw);
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; throw new Error('migration must not use RNG'); };
  let result;
  try {
    result = migrateRoomState(raw);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(calls, 0);
  assert.equal(result.fromVersion, ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(result.toVersion, EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(result.state.digitalModelSchemaVersion, EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(raw, before);
  assert.equal(Object.hasOwn(result.state, 'expeditionDeck'), false);

  const storage = result.state[RANDOM_SOURCE_STATE_FIELD].expeditionPool;
  assert.deepEqual(storage.available.map(occurrenceKey), available.map(occurrenceKey));
  assert.equal(storage.available.some(item => item.id === active.id), false);
  assert.equal(storage.reserved.filter(item => item.id === active.id).length, 1);
  assert.equal(storage.reserved[0].copy, active.copy);
  assert.deepEqual(storage.futurePoolField, { keep: true });

  const p1 = result.state.players[0];
  assert.deepEqual(p1.activeExpeditionTask, {
    futureActiveField: { keep: true },
    expeditionId: active.id,
    placeId: active.placeId,
    acceptedRound: 7,
    startedAtTarget: true,
    departedAfterIssue: false,
  });
  assert.deepEqual(p1.expeditionCompletions, [{
    placeId: firstHistory.placeId,
    name: firstHistory.name,
    completedRound: 6,
    futureHistoryField: { keep: 'p1' },
    expeditionId: firstHistory.id,
  }]);
  assert.deepEqual(p1.expeditionAccessUsage, { round: 7, draws: 1 });
  for (const legacyField of ['activeExpedition', 'expeditionHistory', 'expeditionDrawRound', 'expeditionsDrawnThisRound']) {
    assert.equal(Object.hasOwn(p1, legacyField), false, legacyField);
  }

  const p2 = result.state.players[1];
  assert.equal(p2.activeExpeditionTask, null);
  assert.equal(p2.expeditionCompletions[0].expeditionId, secondHistory.id);
  assert.deepEqual(p2.expeditionAccessUsage, { round: 6, draws: 0 });

  assert.deepEqual(result.state.randomSourceState.unknownSourceFamily, before.randomSourceState.unknownSourceFamily);
  assert.deepEqual(result.state.unknownRoot, before.unknownRoot);
  assert.deepEqual(p1.activeAssignment, before.players[0].activeAssignment);
  assert.deepEqual(p1.legendaryCards, before.players[0].legendaryCards);
  assert.deepEqual(p1.specialCards, before.players[0].specialCards);
  assert.deepEqual(p1.savedEventCards, before.players[0].savedEventCards);
  assert.deepEqual(result.state.pendingExpeditionRewards, before.pendingExpeditionRewards);
  assert.deepEqual(result.state.pendingLegendaryReaction, before.pendingLegendaryReaction);
  assert.deepEqual(result.state.eventPhase, before.eventPhase);
});

test('migrated restart preserves startedAtTarget and current-round usage without redrawing the active occurrence', () => {
  const { raw, active } = v3ExpeditionFixture();
  const restored = JSON.parse(JSON.stringify(migrateRoomState(raw).state));
  const player = restored.players[0];
  const task = getActiveExpeditionTask(player);
  const storage = restored[RANDOM_SOURCE_STATE_FIELD].expeditionPool;

  assert.equal(task.id, active.id);
  assert.equal(task.progress.startedAtTarget, true);
  assert.equal(task.progress.departedAfterIssue, false);
  assert.equal(expeditionTakenThisRound(player, restored.round), 1);
  assert.equal(storage.available.some(item => item.id === active.id), false);
  assert.equal(storage.reserved.filter(item => item.id === active.id).length, 1);
});

test('exact eligible continuation survives migration for players with different histories and skip stays player-specific', () => {
  const definitions = EXPEDITION_DEFINITIONS.slice(0, 3);
  assert.equal(definitions.length, 3);
  const occurrences = definitions.map((definition, index) => ({ ...definition, copy: 1, marker: index }));
  const raw = {
    digitalModelSchemaVersion: ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION,
    round: 4,
    players: [
      {
        id: 'p1',
        activeExpedition: null,
        expeditionHistory: [{ placeId: occurrences[0].placeId, cardId: occurrences[0].id, completedRound: 2 }],
        expeditionDrawRound: null,
        expeditionsDrawnThisRound: 0,
      },
      {
        id: 'p2',
        activeExpedition: null,
        expeditionHistory: [{ placeId: occurrences[2].placeId, cardId: occurrences[2].id, completedRound: 3 }],
        expeditionDrawRound: null,
        expeditionsDrawnThisRound: 0,
      },
    ],
    randomSourceState: {},
    expeditionDeck: { drawPile: occurrences.map(item => structuredClone(item)) },
  };

  const oldRoom = structuredClone(raw);
  const newRoom = migrateRoomState(raw).state;
  const oldRng = sequence([0.75, 0.25, 0.5, 0.1]);
  const newRng = sequence([0.75, 0.25, 0.5, 0.1]);
  const oldPool = expeditionPool(oldRoom, oldRng, { isEligible: expeditionCardEligibleForPlayer });
  const newPool = expeditionPool(newRoom, newRng, { isEligible: expeditionCardEligibleForPlayer });

  const oldFirst = oldPool.takeEligible(oldRoom.players[0]);
  const newFirst = newPool.takeEligible(newRoom.players[0]);
  assert.equal(newFirst.id, oldFirst.id);
  assert.equal(newFirst.id, occurrences[1].id);
  assert.equal(newRng.calls(), oldRng.calls());
  assert.deepEqual(
    newRoom[RANDOM_SOURCE_STATE_FIELD].expeditionPool.available.map(occurrenceKey),
    oldRoom.expeditionDeck.drawPile.map(occurrenceKey)
  );

  const secondPlayerDraw = newPool.takeEligible(newRoom.players[1]);
  assert.equal(secondPlayerDraw.id, occurrences[0].id);
  const storage = newRoom[RANDOM_SOURCE_STATE_FIELD].expeditionPool;
  assert.equal(storage.reserved.filter(item => item.id === occurrences[1].id).length, 1);
  assert.equal(storage.reserved.filter(item => item.id === occurrences[0].id).length, 1);
  const allKeys = [...storage.available, ...storage.reserved].map(occurrenceKey);
  assert.equal(new Set(allKeys).size, allKeys.length);
});

test('completion releases a migrated active occurrence exactly once after restart', () => {
  const { raw, active } = v3ExpeditionFixture();
  const restored = JSON.parse(JSON.stringify(migrateRoomState(raw).state));
  const player = restored.players[0];
  const target = LEGENDARY_PLACES[active.placeId];
  assert.ok(target, 'target expedition must map to a sea place for this restart test');
  player.activeExpeditionTask.departedAfterIssue = true;
  player.row = target.row;
  player.col = target.col;

  const rng = sequence([0.8, 0.2, 0.7, 0.1, 0.6, 0.3, 0.4, 0.9]);
  const first = completeExpeditionAtArrival(restored, player, rng);
  assert.equal(first.completed, true);
  assert.equal(player.activeExpeditionTask, null);
  let storage = restored[RANDOM_SOURCE_STATE_FIELD].expeditionPool;
  assert.equal(storage.reserved.some(item => item.id === active.id), false);
  assert.equal(storage.available.filter(item => item.id === active.id).length, 1);
  const callsAfterFirst = rng.calls();

  const repeated = completeExpeditionAtArrival(restored, player, rng);
  assert.equal(repeated.completed, false);
  assert.equal(rng.calls(), callsAfterFirst);
  storage = restored[RANDOM_SOURCE_STATE_FIELD].expeditionPool;
  assert.equal(storage.available.filter(item => item.id === active.id).length, 1);
});

test('already-current schema 4 save is a content-exact no-op and second migration is idempotent', () => {
  const current = migrateRoomState(assignmentFixture().raw).state;
  const direct = migrateRoomState(current);
  assert.equal(direct.migrated, false);
  assert.equal(direct.fromVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(direct.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(direct.state, current);

  const second = migrateRoomState(direct.state);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.state, current);
});

test('malformed and future digital model schema versions are rejected', () => {
  for (const version of [-1, 0.5, '3', NaN]) {
    assert.throws(() => migrateRoomState({ ...v2Fixture(), digitalModelSchemaVersion: version }), /Invalid digital model schema version/);
  }
  assert.throws(
    () => migrateRoomState({ ...v2Fixture(), digitalModelSchemaVersion: CURRENT_DIGITAL_MODEL_SCHEMA_VERSION + 1 }),
    /Unsupported future digital model schema version/
  );
});

test('RoomStore.init migrates schema 2 AssignmentPool backing before validation without rewriting DB row immediately', async () => {
  const db = pool();
  const setup = new RoomStore(db, { logger });
  await setup.init(new Map());
  const { raw, active, embassyA, embassyB } = assignmentFixture();
  await db.query('INSERT INTO game_rooms (code, state) VALUES ($1,$2::jsonb)', [raw.code, JSON.stringify(raw)]);

  const rooms = new Map();
  await new RoomStore(db, { logger }).init(rooms);
  const restored = rooms.get(raw.code);
  assert.equal(restored.digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.ok(restored[RANDOM_SOURCE_STATE_FIELD].assignmentPool);
  assert.equal(Object.hasOwn(restored, 'assignmentDecks'), false);
  assert.deepEqual(
    restored[RANDOM_SOURCE_STATE_FIELD].assignmentPool[assignmentFactionId].reserved.map(occurrenceKey),
    [active, embassyB, embassyA].map(occurrenceKey)
  );
  assert.equal(restored.players[0].socketId, null);
  assert.equal(restored.players[0].connected, false);

  const persisted = (await db.query('SELECT state FROM game_rooms WHERE code = $1', [raw.code])).rows[0].state;
  assert.equal(persisted.digitalModelSchemaVersion, SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.ok(persisted.assignmentDecks);
  assert.equal(Object.hasOwn(persisted.randomSourceState, 'assignmentPool'), false);
});

test('invalid saved rooms keep Invalid saved room contract and guest/no-DB mode remains safe', async () => {
  const db = pool();
  const store = new RoomStore(db, { logger });
  await store.init(new Map());
  await db.query('INSERT INTO game_rooms (code, state) VALUES ($1,$2::jsonb)', ['BROKE', '{}']);
  await assert.rejects(store.init(new Map()), /Invalid saved room: BROKE/);

  const guest = new RoomStore(null, { logger });
  await guest.init(new Map());
  await guest.save(v2Fixture());
  await guest.remove('ABCDE');
  await guest.flush();
});

test('6.4 migration leaves 6.5+ assignment/inventory/discovery/effect/pending state untouched', () => {
  const { raw } = v3ExpeditionFixture();
  raw.players[0].namedPlaceCards = [{ id: 'named-stays' }];
  raw.players[0].legendaryPlacesExplored = ['place-stays'];
  raw.players[0].activeTurnEffects = { movement: [{ id: 'effect-stays' }] };
  raw.players[0].nextTurnEffects = { moveBonus: 2 };
  const before = structuredClone(raw);
  const migrated = migrateRoomState(raw).state;

  for (const field of ['activeAssignment', 'legendaryCards', 'specialCards', 'savedEventCards', 'namedPlaceCards', 'legendaryPlacesExplored', 'activeTurnEffects', 'nextTurnEffects']) {
    assert.deepEqual(migrated.players[0][field], before.players[0][field], field);
  }
  assert.deepEqual(migrated.pendingExpeditionRewards, before.pendingExpeditionRewards);
  assert.deepEqual(migrated.pendingLegendaryReaction, before.pendingLegendaryReaction);
  assert.deepEqual(migrated.eventPhase, before.eventPhase);
});
