'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { RoomStore } = require('../room-store');
const {
  CURRENT_DIGITAL_MODEL_SCHEMA_VERSION,
  LEGACY_CLEANUP_DIGITAL_MODEL_SCHEMA_VERSION,
  migrateRoomState,
} = require('../save-migrations');
const { FINISHED_GAMEPLAY_ERROR, finishedGameEventError } = require('../finished-game-lock');

const logger = { log() {}, error() {} };

function schema8(overrides = {}) {
  return {
    code: 'SAVE9',
    started: true,
    players: [
      { id: 'p1', accountId: 'a1', connected: true, socketId: 'socket-p1', ducats: 11 },
      { id: 'p2', accountId: 'a2', connected: true, socketId: 'socket-p2', ducats: 7 },
    ],
    islands: [{ id: 'island-a', ownerId: 'p1', army: 4 }],
    order: ['p1', 'p2'],
    round: 6,
    circle: 2,
    turnIndex: 1,
    phase: 'actions',
    actionsLeft: 2,
    roll: 5,
    movePoints: 3,
    digitalModelSchemaVersion: LEGACY_CLEANUP_DIGITAL_MODEL_SCHEMA_VERSION,
    ...overrides,
  };
}

function makeDb() {
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  return new Pool();
}

test('8 -> 9 ordinary active save stays neutral and preserves gameplay state', () => {
  const raw = schema8();
  const before = structuredClone(raw);
  const result = migrateRoomState(raw);

  assert.equal(result.fromVersion, 8);
  assert.equal(result.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(result.state.digitalModelSchemaVersion, 9);
  assert.equal(result.migrated, true);
  assert.deepEqual(raw, before);
  assert.deepEqual(
    {
      round: result.state.round,
      circle: result.state.circle,
      turnIndex: result.state.turnIndex,
      phase: result.state.phase,
      actionsLeft: result.state.actionsLeft,
      roll: result.state.roll,
      movePoints: result.state.movePoints,
      players: result.state.players,
      islands: result.state.islands,
    },
    {
      round: before.round,
      circle: before.circle,
      turnIndex: before.turnIndex,
      phase: before.phase,
      actionsLeft: before.actionsLeft,
      roll: before.roll,
      movePoints: before.movePoints,
      players: before.players,
      islands: before.islands,
    }
  );
  for (const field of ['endGameConsensus', 'finished', 'finalResult']) {
    assert.equal(Object.hasOwn(result.state, field), false, field);
  }
});

test('8 -> 9 preserves pending and accepted consensus without finalizing accepted gameplay', () => {
  const pendingConsensus = {
    status: 'proposed',
    proposedById: 'p1',
    confirmedPlayerIds: ['p1'],
    finishAfterRound: null,
  };
  const pending = migrateRoomState(schema8({ endGameConsensus: pendingConsensus })).state;
  assert.deepEqual(pending.endGameConsensus, pendingConsensus);

  const acceptedConsensus = {
    status: 'accepted',
    proposedById: 'p1',
    confirmedPlayerIds: ['p1', 'p2'],
    finishAfterRound: 6,
  };
  const accepted = migrateRoomState(schema8({ endGameConsensus: acceptedConsensus })).state;
  assert.deepEqual(accepted.endGameConsensus, acceptedConsensus);
  assert.equal(accepted.phase, 'actions');
  assert.equal(Object.hasOwn(accepted, 'finished'), false);
  assert.equal(Object.hasOwn(accepted, 'finalResult'), false);

  const reloaded = migrateRoomState(JSON.parse(JSON.stringify(accepted)));
  assert.equal(reloaded.migrated, false);
  assert.deepEqual(reloaded.state, accepted);
});

test('finished room survives save/restart with immutable finalResult and remains gameplay-locked', async () => {
  const db = makeDb();
  const firstStore = new RoomStore(db, { logger });
  await firstStore.init(new Map());

  const finalResult = {
    finishedRound: 6,
    playerMetrics: [
      { playerId: 'p1', score: 91, nested: { exact: ['keep', 1] } },
      { playerId: 'p2', score: 83 },
    ],
    titles: [{ titleId: 'merchant', winnerPlayerIds: ['p1'] }],
  };
  const finished = schema8({
    finished: true,
    phase: 'finished',
    finalResult,
    endGameConsensus: {
      status: 'accepted',
      proposedById: 'p1',
      confirmedPlayerIds: ['p1', 'p2'],
      finishAfterRound: 6,
    },
  });
  const expectedRound = finished.round;
  const expectedCircle = finished.circle;
  const expectedPlayers = structuredClone(finished.players);
  const expectedIslands = structuredClone(finished.islands);

  await firstStore.save(finished);
  assert.equal((await db.query('SELECT * FROM game_rooms WHERE code = $1', [finished.code])).rowCount, 1);

  const restoredRooms = new Map();
  await new RoomStore(db, { logger }).init(restoredRooms);
  const restored = restoredRooms.get(finished.code);

  assert.ok(restored);
  assert.equal(restored.digitalModelSchemaVersion, 9);
  assert.equal(restored.finished, true);
  assert.equal(restored.phase, 'finished');
  assert.deepEqual(restored.finalResult, finalResult);
  assert.equal(restored.round, expectedRound);
  assert.equal(restored.circle, expectedCircle);
  assert.deepEqual(
    restored.players.map(({ socketId, connected, ...player }) => player),
    expectedPlayers.map(({ socketId, connected, ...player }) => player)
  );
  assert.deepEqual(restored.islands, expectedIslands);
  assert.equal(finishedGameEventError(restored, 'roll'), FINISHED_GAMEPLAY_ERROR);
  assert.equal(finishedGameEventError(restored, 'resumeRoom'), null);

  await new RoomStore(db, { logger }).remove(finished.code);
  assert.equal((await db.query('SELECT * FROM game_rooms WHERE code = $1', [finished.code])).rowCount, 0);
  await db.end();
});

test('8 -> 9 and repeated reload are pure, idempotent and never alter final snapshot or RNG state', () => {
  const raw = schema8({
    finished: true,
    phase: 'finished',
    finalResult: {
      finishedRound: 6,
      playerMetrics: [{ playerId: 'p1', score: 55 }],
      titles: [{ titleId: 'explorer', winnerPlayerIds: ['p1'] }],
    },
    endGameConsensus: {
      status: 'accepted',
      proposedById: 'p1',
      confirmedPlayerIds: ['p1', 'p2'],
      finishAfterRound: 6,
    },
    randomSourceState: {
      sailingEvent: {
        available: [{ id: 'next-card', copy: 1 }],
        recyclable: [{ id: 'used-card', copy: 2 }],
        reserved: [],
      },
    },
  });
  const before = structuredClone(raw);
  const originalRandom = Math.random;
  let rngCalls = 0;
  Math.random = () => {
    rngCalls += 1;
    throw new Error('migration must not use RNG');
  };

  let first;
  let second;
  try {
    first = migrateRoomState(raw);
    second = migrateRoomState(JSON.parse(JSON.stringify(first.state)));
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(rngCalls, 0);
  assert.deepEqual(raw, before);
  assert.deepEqual(first.state.finalResult, before.finalResult);
  assert.deepEqual(first.state.endGameConsensus, before.endGameConsensus);
  assert.deepEqual(first.state.randomSourceState, before.randomSourceState);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.state, first.state);
  assert.deepEqual(second.state.finalResult, before.finalResult);
  assert.deepEqual(second.state.endGameConsensus.confirmedPlayerIds, ['p1', 'p2']);
});

test('legacy chain still reaches v9 and unsupported future schemas still fail', () => {
  const legacy = schema8({ legacyCompatibilitySentinel: { keep: true } });
  delete legacy.digitalModelSchemaVersion;
  const migrated = migrateRoomState(legacy);
  assert.equal(migrated.fromVersion, 0);
  assert.equal(migrated.toVersion, 9);
  assert.equal(migrated.state.digitalModelSchemaVersion, 9);
  assert.deepEqual(migrated.state.legacyCompatibilitySentinel, { keep: true });

  assert.throws(
    () => migrateRoomState({ ...schema8(), digitalModelSchemaVersion: CURRENT_DIGITAL_MODEL_SCHEMA_VERSION + 1 }),
    /Unsupported future digital model schema version/
  );
});
