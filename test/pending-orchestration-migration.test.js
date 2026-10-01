'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CURRENT_DIGITAL_MODEL_SCHEMA_VERSION,
  DISCOVERY_EFFECT_DIGITAL_MODEL_SCHEMA_VERSION,
  PENDING_ORCHESTRATION_DIGITAL_MODEL_SCHEMA_VERSION,
  LEGACY_CLEANUP_DIGITAL_MODEL_SCHEMA_VERSION,
  migrateRoomState,
} = require('../save-migrations');
const {
  getPendingResolution,
  setPendingResolution,
  pendingResolutionToLegacy,
  getPreTurnResolutionFlow,
  preTurnResolutionFlowToLegacy,
  listResolutionQueue,
  peekResolutionQueue,
  dequeueResolution,
  resolutionQueueLength,
  adoptLegacyPendingOrchestration,
} = require('../domain-state');

const pendingVariants = [
  {
    family: 'event',
    field: 'pendingEvent',
    legacy: {
      id: 'event-1',
      playerId: 'p1',
      kind: 'observatory',
      cardName: 'Observed event',
      options: [{ id: 'keep' }, { id: 'replace' }],
      eventCard: { id: 'event-card', copy: 2, sampled: true },
      choiceState: { cursor: 1 },
      futurePendingField: { keep: 'event' },
    },
  },
  {
    family: 'feud',
    field: 'pendingFeud',
    legacy: {
      id: 'feud-1',
      playerId: 'p2',
      kind: 'downgrade-building',
      factionId: 'mori',
      remaining: 2,
      options: [{ islandId: 'i2', buildingIndex: 1 }, { islandId: 'i1', buildingIndex: 0 }],
      excludedOptions: ['i0:0'],
      feudCard: { id: 'feud-card', copy: 3, sampled: true },
      futurePendingField: { keep: 'feud' },
    },
  },
  {
    family: 'assignment-choice',
    field: 'pendingAssignmentChoice',
    legacy: {
      id: 'assignment-1',
      playerId: 'p3',
      kind: 'embassy',
      factionId: 'lionia',
      options: [{ id: 'task-b', copy: 2 }, { id: 'task-a', copy: 1 }],
      continuation: { queueIndex: 4 },
      futurePendingField: { keep: 'assignment' },
    },
  },
  {
    family: 'legendary-reaction',
    field: 'pendingLegendaryReaction',
    legacy: {
      id: 'legendary-1',
      kind: 'sea-attack',
      sourcePlayerId: 'p4',
      targetPlayerId: 'p1',
      islandId: 'island-7',
      inviteAllies: true,
      shipCarpenterPlayerIds: ['p4', 'p2'],
      options: [{ id: 'decline' }, { id: 'veil' }],
      futurePendingField: { keep: 'legendary' },
    },
  },
];

function schema6Room(extra = {}) {
  return {
    code: 'M67',
    digitalModelSchemaVersion: DISCOVERY_EFFECT_DIGITAL_MODEL_SCHEMA_VERSION,
    players: [],
    islands: [],
    order: [],
    discoveries: {},
    ...extra,
  };
}

for (const fixture of pendingVariants) {
  test('6 -> 7 migrates pending variant ' + fixture.family + ' with exact actor/options/selected state', () => {
    const raw = schema6Room({
      pendingEvent: null,
      pendingFeud: null,
      pendingAssignmentChoice: null,
      pendingLegendaryReaction: null,
      pendingExpeditionRewards: [],
      eventPhase: null,
      [fixture.field]: structuredClone(fixture.legacy),
      unknownRoot: { keep: fixture.family },
    });
    const before = structuredClone(raw);
    const result = migrateRoomState(raw);

    assert.deepEqual(raw, before);
    assert.equal(result.fromVersion, DISCOVERY_EFFECT_DIGITAL_MODEL_SCHEMA_VERSION);
    assert.equal(result.state.digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
    assert.equal(result.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
    assert.equal(Object.hasOwn(result.state, fixture.field), false);

    const persisted = result.state.pendingResolutions[fixture.family];
    assert.equal(persisted.family, fixture.family);
    assert.equal(persisted.state, 'pending');
    assert.equal(persisted.source.backing, 'pendingResolutions');
    assert.equal(persisted.source.legacyField, fixture.field);

    const semantic = getPendingResolution(result.state, fixture.family);
    assert.deepEqual(semantic.options, fixture.legacy.options);
    const actorField = fixture.family === 'legendary-reaction' ? 'targetPlayerId' : 'playerId';
    assert.equal(semantic.actorPlayerId, fixture.legacy[actorField]);
    assert.deepEqual(pendingResolutionToLegacy(semantic), fixture.legacy);
    assert.deepEqual(result.state.unknownRoot, before.unknownRoot);
  });
}

function flowFixture(stage) {
  return {
    active: true,
    personalTurn: true,
    turnPlayerId: 'p1',
    currentPlayerId: 'p2',
    stage,
    playerIndex: 2,
    feudIndex: 1,
    assignmentIndex: 3,
    replacementIndex: 4,
    feudQueue: [
      { playerId: 'p1', factionId: 'mori', sampled: true },
      { playerId: 'p2', factionId: 'lionia', sampled: true },
    ],
    assignmentQueue: [
      { playerId: 'p3', factionId: 'kadingir', taskId: 'task-3' },
      { playerId: 'p4', factionId: 'suniksiya', taskId: 'task-4' },
    ],
    replacementQueue: [{ legacy: true }],
    politicalSnapshot: { p1: { suzerainId: 'mori', enemyFactionIds: ['lionia'], hadAssignment: true } },
    observatoryReplacementsUsed: 2,
    lastCard: { playerId: 'p2', cardName: 'Already sampled', pending: true, source: 'feud' },
    taxResult: { due: 4, paid: 3, underpaid: 1 },
    futureFlowField: { preserve: stage },
  };
}

for (const legacyStage of ['sailing', 'feud', 'assignment']) {
  test('6 -> 7 migrates pre-turn flow stage ' + legacyStage + ' with exact queues/indexes/counters', () => {
    const eventPhase = flowFixture(legacyStage);
    const raw = schema6Room({
      pendingEvent: null,
      pendingFeud: null,
      pendingAssignmentChoice: null,
      pendingLegendaryReaction: null,
      pendingExpeditionRewards: [],
      eventPhase: structuredClone(eventPhase),
    });
    const migrated = migrateRoomState(raw).state;
    assert.equal(Object.hasOwn(migrated, 'eventPhase'), false);

    const flow = getPreTurnResolutionFlow(migrated);
    assert.equal(flow.stage, legacyStage === 'feud' ? 'political' : legacyStage);
    assert.deepEqual(flow.indexes, { sailing: 2, political: 1, assignment: 3 });
    assert.deepEqual(flow.queues.political, eventPhase.feudQueue);
    assert.deepEqual(flow.queues.assignment, eventPhase.assignmentQueue);
    assert.equal(Object.hasOwn(flow.queues, 'replacement'), false);
    assert.equal(flow.counters.observatoryReplacementsUsed, 2);
    assert.deepEqual(flow.lastCard, eventPhase.lastCard);
    assert.deepEqual(flow.taxResult, eventPhase.taxResult);
    assert.deepEqual(migrated.preTurnResolutionFlow.legacyData, { futureFlowField: { preserve: legacyStage } });
    const expectedLegacy = structuredClone(eventPhase);
    delete expectedLegacy.replacementIndex;
    delete expectedLegacy.replacementQueue;
    assert.deepEqual(preTurnResolutionFlowToLegacy(flow), expectedLegacy);
  });
}

test('ResolutionQueue migration/restart keeps FIFO and assignment linkage exactly', () => {
  const queue = [
    { playerId: 'p1', expeditionName: 'A', treasureAssignmentInstanceId: 'assignment-a', future: { order: 1 } },
    { playerId: 'p2', expeditionName: 'B', treasureAssignmentInstanceId: null, future: { order: 2 } },
    { playerId: 'p3', expeditionName: 'C', treasureAssignmentInstanceId: 'assignment-c', future: { order: 3 } },
  ];
  const migrated = migrateRoomState(schema6Room({
    pendingEvent: null,
    pendingFeud: null,
    pendingAssignmentChoice: null,
    pendingLegendaryReaction: null,
    pendingExpeditionRewards: structuredClone(queue),
    eventPhase: null,
  })).state;

  assert.equal(Object.hasOwn(migrated, 'pendingExpeditionRewards'), false);
  assert.equal(migrated.resolutionQueue.kind, 'resolution-queue');
  assert.deepEqual(migrated.resolutionQueue.items, queue);

  const restarted = JSON.parse(JSON.stringify(migrated));
  assert.deepEqual(listResolutionQueue(restarted), queue);
  assert.deepEqual(peekResolutionQueue(restarted), queue[0]);
  assert.equal(resolutionQueueLength(restarted), 3);
  assert.deepEqual(dequeueResolution(restarted), queue[0]);
  assert.deepEqual(dequeueResolution(restarted), queue[1]);
  assert.deepEqual(dequeueResolution(restarted), queue[2]);
  assert.equal(resolutionQueueLength(restarted), 0);
});

test('restart continuation resumes exact pending record and pre-turn cursor without redraw or reselection', () => {
  const selectedEvent = pendingVariants[0].legacy;
  const flow = flowFixture('feud');
  const migrated = migrateRoomState(schema6Room({
    pendingEvent: structuredClone(selectedEvent),
    pendingFeud: null,
    pendingAssignmentChoice: null,
    pendingLegendaryReaction: null,
    pendingExpeditionRewards: [{ playerId: 'p2', expeditionName: 'queued', treasureAssignmentInstanceId: 'old-task' }],
    eventPhase: structuredClone(flow),
  })).state;
  const restarted = JSON.parse(JSON.stringify(migrated));

  const pending = getPendingResolution(restarted, 'event');
  assert.equal(pending.id, selectedEvent.id);
  assert.deepEqual(pending.payload.eventCard, selectedEvent.eventCard);
  assert.deepEqual(pending.options, selectedEvent.options);
  pending.payload.choiceState.cursor = 2;
  setPendingResolution(restarted, 'event', pending);

  const afterWrite = getPendingResolution(restarted, 'event');
  assert.equal(afterWrite.id, selectedEvent.id);
  assert.deepEqual(afterWrite.payload.eventCard, selectedEvent.eventCard);
  assert.equal(afterWrite.payload.choiceState.cursor, 2);
  assert.deepEqual(afterWrite.options, selectedEvent.options);

  const resumedFlow = getPreTurnResolutionFlow(restarted);
  assert.equal(resumedFlow.stage, 'political');
  assert.equal(resumedFlow.indexes.political, 1);
  assert.equal(resumedFlow.currentPlayerId, 'p2');
  assert.deepEqual(resumedFlow.lastCard, flow.lastCard);
  assert.deepEqual(peekResolutionQueue(restarted), {
    playerId: 'p2',
    expeditionName: 'queued',
    treasureAssignmentInstanceId: 'old-task',
  });
});

test('6 -> 7 full migration is zero-RNG, pure and second migration is content-exact no-op', () => {
  const raw = schema6Room({
    pendingEvent: structuredClone(pendingVariants[0].legacy),
    pendingFeud: structuredClone(pendingVariants[1].legacy),
    pendingAssignmentChoice: structuredClone(pendingVariants[2].legacy),
    pendingLegendaryReaction: structuredClone(pendingVariants[3].legacy),
    pendingExpeditionRewards: [
      { playerId: 'p1', expeditionName: 'A', treasureAssignmentInstanceId: 'task-a' },
      { playerId: 'p2', expeditionName: 'B', treasureAssignmentInstanceId: null },
    ],
    eventPhase: flowFixture('assignment'),
    unknownRoot: { keep: ['all'] },
  });
  const before = structuredClone(raw);
  const originalRandom = Math.random;
  let rngCalls = 0;
  Math.random = () => { rngCalls += 1; throw new Error('migration must not use RNG'); };
  let first;
  try {
    first = migrateRoomState(raw);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(rngCalls, 0);
  assert.deepEqual(raw, before);
  assert.equal(first.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  const snapshot = structuredClone(first.state);
  const second = migrateRoomState(first.state);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.state, snapshot);
});

test('compatibility adoption moves injected legacy state only into empty target and target wins stale duplicates', () => {
  const room = {
    pendingResolutions: {
      event: null,
      feud: {
        family: 'feud', id: 'target-feud', actorPlayerId: 'p2', actorId: 'p2', state: 'pending',
        source: { backing: 'pendingResolutions', legacyField: 'pendingFeud' },
        payload: { factionId: 'mori' },
      },
      'assignment-choice': null,
      'legendary-reaction': null,
    },
    resolutionQueue: { kind: 'resolution-queue', items: [] },
    preTurnResolutionFlow: null,
    pendingEvent: structuredClone(pendingVariants[0].legacy),
    pendingFeud: { id: 'stale-feud', playerId: 'p9', kind: 'remove-forts' },
    pendingExpeditionRewards: [{ playerId: 'p1', expeditionName: 'legacy-q', treasureAssignmentInstanceId: null }],
    eventPhase: flowFixture('sailing'),
  };

  assert.equal(adoptLegacyPendingOrchestration(room), true);
  assert.equal(Object.hasOwn(room, 'pendingEvent'), false);
  assert.equal(Object.hasOwn(room, 'pendingFeud'), false);
  assert.equal(Object.hasOwn(room, 'pendingExpeditionRewards'), false);
  assert.equal(Object.hasOwn(room, 'eventPhase'), false);
  assert.equal(getPendingResolution(room, 'event').id, 'event-1');
  assert.equal(getPendingResolution(room, 'feud').id, 'target-feud');
  assert.equal(peekResolutionQueue(room).expeditionName, 'legacy-q');
  assert.equal(getPreTurnResolutionFlow(room).stage, 'sailing');
});
