const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { newDb } = require('pg-mem');
const {
  CURRENT_DIGITAL_MODEL_SCHEMA_VERSION,
  migrateRoomState,
} = require('../save-migrations');
const { RoomStore } = require('../room-store');

const logger = { log() {}, error() {} };

function pool() {
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  return new Pool();
}

function unversionedFixture() {
  return {
    code: 'ABCDE',
    rulesDataVersion: 'legacy-rules-data',
    rulesSchemaVersion: 77,
    runtimeProfile: 'legacy-runtime-profile',
    started: true,
    phase: 'actions',
    players: [{
      id: 'p1',
      socketId: 'stale-socket',
      connected: true,
      activeAssignment: { instanceId: 'assignment-1', card: { id: 'mori-a' }, progress: { kind: 'mori-service', count: 2 } },
      activeExpedition: { instanceId: 'expedition-1', card: { id: 'exp-a' }, startedAtTarget: false },
      expeditionHistory: [{ definitionId: 'exp-old', completedRound: 2 }],
      legendaryCards: [{ id: 'sea-veil', copy: 2 }],
      specialCards: ['treasure-hunter'],
      savedEventCards: [{ id: 'saved-1', sourceCard: { id: 'tailwind', copy: 3 } }],
      namedPlaceCards: [{ placeId: 'place-1', claimedBy: 'p1' }],
      legendaryPlacesExplored: ['place-1'],
      activeTurnEffects: { movement: [{ id: 'effect-1', amount: 1 }] },
      nextTurnEffects: { moveBonus: 2 },
      futurePlayerField: { nested: ['keep', { exactly: true }] },
    }],
    islands: [{ id: 'island-1', ownerId: 'p1', futureIslandField: { keep: 9 } }],
    order: ['p1'],
    anchorDecks: { red: { drawPile: [{ id: 'anchor-a', copy: 1 }], discard: [{ id: 'anchor-b', copy: 2 }] } },
    eventDeck: { drawPile: [{ id: 'event-a', copy: 1 }], discard: [{ id: 'event-b', copy: 2 }] },
    feudDecks: { lionia: { drawPile: [{ id: 'feud-a', copy: 1 }], discard: [] } },
    assignmentDecks: { mori: { drawPile: [{ id: 'assignment-a', copy: 1 }], discard: [], removed: [] } },
    expeditionDeck: { drawPile: [{ id: 'expedition-a', copy: 1 }], discard: [] },
    pendingExpeditionRewards: [{ id: 'reward-1', playerId: 'p1', assignmentInstanceId: 'assignment-1' }],
    pendingEvent: { id: 'pending-event', playerId: 'p1', card: { id: 'event-a', copy: 1 } },
    pendingFeud: { id: 'pending-feud', playerId: 'p1', feudCard: { id: 'feud-a', copy: 1 } },
    pendingAssignmentChoice: { id: 'pending-assignment', playerId: 'p1', options: [{ id: 'assignment-a', copy: 1 }] },
    pendingLegendaryReaction: { id: 'pending-legendary', playerId: 'p1', card: { id: 'sea-veil', copy: 2 } },
    eventPhase: { active: true, stage: 'assignment', assignmentIndex: 1 },
    unknownLegacyRoot: { nested: { array: [1, 2, { keep: 'yes' }] } },
  };
}

test('unversioned room migrates 0 -> 1 by adding only the digital model schema marker', () => {
  const raw = unversionedFixture();
  const before = structuredClone(raw);
  const beforeBytes = JSON.stringify(raw);

  const result = migrateRoomState(raw);

  assert.equal(result.migrated, true);
  assert.equal(result.fromVersion, 0);
  assert.equal(result.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(result.state.digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(JSON.stringify(raw), beforeBytes);
  assert.deepEqual(raw, before);

  const { digitalModelSchemaVersion, ...withoutMarker } = result.state;
  assert.equal(digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(withoutMarker, before);
  assert.deepEqual(result.state.unknownLegacyRoot, before.unknownLegacyRoot);
  assert.deepEqual(result.state.players[0].futurePlayerField, before.players[0].futurePlayerField);
  assert.deepEqual(result.state.anchorDecks, before.anchorDecks);
  assert.deepEqual(result.state.eventDeck, before.eventDeck);
  assert.deepEqual(result.state.feudDecks, before.feudDecks);
  assert.deepEqual(result.state.assignmentDecks, before.assignmentDecks);
  assert.deepEqual(result.state.expeditionDeck, before.expeditionDeck);
  assert.deepEqual(result.state.pendingExpeditionRewards, before.pendingExpeditionRewards);
  assert.deepEqual(result.state.pendingEvent, before.pendingEvent);
  assert.deepEqual(result.state.pendingFeud, before.pendingFeud);
  assert.deepEqual(result.state.pendingAssignmentChoice, before.pendingAssignmentChoice);
  assert.deepEqual(result.state.pendingLegendaryReaction, before.pendingLegendaryReaction);
  assert.deepEqual(result.state.eventPhase, before.eventPhase);
  assert.deepEqual(result.state.players[0].activeAssignment, before.players[0].activeAssignment);
  assert.deepEqual(result.state.players[0].activeExpedition, before.players[0].activeExpedition);
  assert.deepEqual(result.state.players[0].expeditionHistory, before.players[0].expeditionHistory);
  assert.equal(result.state.rulesDataVersion, before.rulesDataVersion);
  assert.equal(result.state.rulesSchemaVersion, before.rulesSchemaVersion);
  assert.equal(result.state.runtimeProfile, before.runtimeProfile);
});

test('already-current rooms are exact no-ops and repeated migration is idempotent', () => {
  const current = {
    ...unversionedFixture(),
    digitalModelSchemaVersion: CURRENT_DIGITAL_MODEL_SCHEMA_VERSION,
  };
  const direct = migrateRoomState(current);
  assert.equal(direct.migrated, false);
  assert.equal(direct.fromVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(direct.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(direct.state, current);

  const first = migrateRoomState(unversionedFixture());
  const second = migrateRoomState(first.state);
  assert.equal(second.migrated, false);
  assert.equal(second.fromVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(second.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(second.state, first.state);
});

test('malformed and future digital model schema versions are rejected', () => {
  for (const version of [-1, 0.5, '1', NaN]) {
    assert.throws(
      () => migrateRoomState({ ...unversionedFixture(), digitalModelSchemaVersion: version }),
      /Invalid digital model schema version/
    );
  }
  assert.throws(
    () => migrateRoomState({
      ...unversionedFixture(),
      digitalModelSchemaVersion: CURRENT_DIGITAL_MODEL_SCHEMA_VERSION + 1,
    }),
    /Unsupported future digital model schema version/
  );
});

test('RoomStore.init migrates before validation, clears only delivery fields, and does not rewrite the row just for the marker', async () => {
  const db = pool();
  const setup = new RoomStore(db, { logger });
  await setup.init(new Map());

  const raw = unversionedFixture();
  await db.query(
    'INSERT INTO game_rooms (code, state) VALUES ($1,$2::jsonb)',
    [raw.code, JSON.stringify(raw)]
  );

  const rooms = new Map();
  const store = new RoomStore(db, { logger });
  await store.init(rooms);

  const restored = rooms.get(raw.code);
  assert.equal(restored.digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(restored.players[0].socketId, null);
  assert.equal(restored.players[0].connected, false);

  const expected = structuredClone(raw);
  expected.digitalModelSchemaVersion = CURRENT_DIGITAL_MODEL_SCHEMA_VERSION;
  expected.players[0].socketId = null;
  expected.players[0].connected = false;
  assert.deepEqual(restored, expected);

  const persisted = (await db.query('SELECT state FROM game_rooms WHERE code = $1', [raw.code])).rows[0].state;
  assert.equal(Object.hasOwn(persisted, 'digitalModelSchemaVersion'), false);
  assert.deepEqual(persisted, raw);
});

test('invalid saved rooms keep the Invalid saved room contract after migration dispatch', async () => {
  const db = pool();
  const store = new RoomStore(db, { logger });
  await store.init(new Map());
  await db.query('INSERT INTO game_rooms (code, state) VALUES ($1,$2::jsonb)', ['BROKE', '{}']);
  await assert.rejects(store.init(new Map()), /Invalid saved room: BROKE/);
});

test('guest/no-DB RoomStore remains a no-op persistence path', async () => {
  const store = new RoomStore(null, { logger });
  const rooms = new Map();
  await store.init(rooms);
  await store.save(unversionedFixture());
  await store.remove('ABCDE');
  await store.flush();
  assert.equal(rooms.size, 0);
});

test('6.1 dispatcher contains no concrete gameplay-state migration families', () => {
  const source = fs.readFileSync(require.resolve('../save-migrations'), 'utf8');
  const forbiddenFamilies = [
    'anchorDecks',
    'eventDeck',
    'feudDecks',
    'assignmentDecks',
    'expeditionDeck',
    'pendingExpeditionRewards',
    'activeAssignment',
    'activeExpedition',
    'expeditionHistory',
    'legendaryCards',
    'specialCards',
    'savedEventCards',
    'namedPlaceCards',
    'legendaryPlacesExplored',
    'activeTurnEffects',
    'nextTurnEffects',
    'pendingEvent',
    'pendingFeud',
    'pendingAssignmentChoice',
    'pendingLegendaryReaction',
    'eventPhase',
  ];
  for (const field of forbiddenFamilies) assert.equal(source.includes(field), false, field);
});
