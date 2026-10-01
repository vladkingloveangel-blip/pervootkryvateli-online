'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { io } = require('socket.io-client');
const { newDb } = require('pg-mem');
const { RoomStore } = require('../room-store');
const {
  endGameConsensusView,
  proposeEndGameConsensus,
  confirmEndGameConsensus,
  rejectEndGameConsensus,
} = require('../end-game-consensus');

function makeRoom(ids = ['p1', 'p2'], overrides = {}) {
  return {
    code: 'ABCDE',
    started: true,
    players: ids.map(id => ({ id, connected: true, socketId: 'socket-' + id })),
    islands: [],
    order: [...ids],
    round: 4,
    circle: 2,
    turnIndex: 1,
    phase: 'actions',
    actionsLeft: 3,
    roll: 5,
    movePoints: 7,
    pendingResolutions: {
      event: { id: 'pending-event', actorId: 'p2', payload: { keep: true } },
    },
    resolutionQueue: {
      kind: 'resolution-queue',
      items: [{ id: 'queued-resolution', actorId: 'p2' }],
    },
    eventPhaseState: {
      kind: 'pre-turn-resolution-flow',
      active: true,
      actorId: 'p2',
    },
    ...overrides,
  };
}

function withoutConsensus(room) {
  const copy = structuredClone(room);
  delete copy.endGameConsensus;
  return copy;
}

test('two players accept unanimously and proposer is confirmed automatically', () => {
  const room = makeRoom();
  const proposed = proposeEndGameConsensus(room, 'p1');
  assert.equal(proposed.ok, true);
  assert.deepEqual(room.endGameConsensus, {
    status: 'proposed',
    proposedById: 'p1',
    confirmedPlayerIds: ['p1'],
    finishAfterRound: null,
  });

  const confirmed = confirmEndGameConsensus(room, 'p2');
  assert.equal(confirmed.ok, true);
  assert.equal(room.endGameConsensus.status, 'accepted');
  assert.deepEqual(room.endGameConsensus.confirmedPlayerIds, ['p1', 'p2']);
  assert.equal(room.endGameConsensus.finishAfterRound, 4);
});

test('several players remain proposed until every participant confirms', () => {
  const room = makeRoom(['p1', 'p2', 'p3']);
  proposeEndGameConsensus(room, 'p1');
  confirmEndGameConsensus(room, 'p2');
  assert.equal(room.endGameConsensus.status, 'proposed');
  assert.equal(room.endGameConsensus.finishAfterRound, null);

  confirmEndGameConsensus(room, 'p3');
  assert.equal(room.endGameConsensus.status, 'accepted');
  assert.equal(room.endGameConsensus.finishAfterRound, 4);
});

test('a pending proposal can be rejected and a later proposal can be created', () => {
  const room = makeRoom(['p1', 'p2', 'p3']);
  proposeEndGameConsensus(room, 'p1');
  const rejected = rejectEndGameConsensus(room, 'p2');
  assert.equal(rejected.ok, true);
  assert.equal(Object.hasOwn(room, 'endGameConsensus'), false);

  const reproposed = proposeEndGameConsensus(room, 'p3');
  assert.equal(reproposed.ok, true);
  assert.deepEqual(room.endGameConsensus.confirmedPlayerIds, ['p3']);
  assert.equal(room.endGameConsensus.status, 'proposed');
});

test('duplicate confirmation is idempotent and never duplicates a player id', () => {
  const room = makeRoom(['p1', 'p2', 'p3']);
  proposeEndGameConsensus(room, 'p1');
  confirmEndGameConsensus(room, 'p2');
  confirmEndGameConsensus(room, 'p2');
  assert.deepEqual(room.endGameConsensus.confirmedPlayerIds, ['p1', 'p2']);
  assert.equal(room.endGameConsensus.status, 'proposed');

  confirmEndGameConsensus(room, 'p3');
  const acceptedSnapshot = structuredClone(room.endGameConsensus);
  const duplicateAfterAcceptance = confirmEndGameConsensus(room, 'p2');
  assert.equal(duplicateAfterAcceptance.ok, true);
  assert.equal(duplicateAfterAcceptance.unchanged, true);
  assert.deepEqual(room.endGameConsensus, acceptedSnapshot);
});

test('disconnect does not cancel a proposal or remove the disconnected participant from unanimity', () => {
  const room = makeRoom();
  proposeEndGameConsensus(room, 'p1');
  room.players[1].connected = false;
  room.players[1].socketId = null;

  confirmEndGameConsensus(room, 'p1');
  assert.equal(room.endGameConsensus.status, 'proposed');
  assert.deepEqual(room.endGameConsensus.confirmedPlayerIds, ['p1']);

  room.players[1].connected = true;
  room.players[1].socketId = 'reconnected';
  confirmEndGameConsensus(room, 'p2');
  assert.equal(room.endGameConsensus.status, 'accepted');
});

test('pending and accepted consensus survive JSON persistence and restart without a save migration', async () => {
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  const db = new Pool();
  const logger = { log() {}, error() {} };
  const firstStore = new RoomStore(db, { logger });
  await firstStore.init(new Map());

  const original = makeRoom();
  proposeEndGameConsensus(original, 'p1');
  await firstStore.save(original);

  const pendingRooms = new Map();
  await new RoomStore(db, { logger }).init(pendingRooms);
  const pending = pendingRooms.get('ABCDE');
  assert.deepEqual(endGameConsensusView(pending), {
    status: 'proposed',
    proposedById: 'p1',
    confirmedPlayerIds: ['p1'],
    finishAfterRound: null,
  });

  confirmEndGameConsensus(pending, 'p2');
  const acceptedState = endGameConsensusView(pending);
  await new RoomStore(db, { logger }).save(pending);

  const acceptedRooms = new Map();
  await new RoomStore(db, { logger }).init(acceptedRooms);
  assert.deepEqual(endGameConsensusView(acceptedRooms.get('ABCDE')), acceptedState);
  await db.end();
});

test('finishAfterRound uses the round in which unanimity is actually reached', () => {
  const room = makeRoom([], { players: [{ id: 'p1' }, { id: 'p2' }], order: ['p1', 'p2'], round: 6 });
  proposeEndGameConsensus(room, 'p1');
  room.round = 7;
  confirmEndGameConsensus(room, 'p2');
  assert.equal(room.endGameConsensus.finishAfterRound, 7);
});

test('consensus changes no gameplay state, including pending resolutions, turn, phase or actions', () => {
  const room = makeRoom(['p1', 'p2', 'p3']);
  const before = withoutConsensus(room);

  proposeEndGameConsensus(room, 'p1');
  assert.deepEqual(withoutConsensus(room), before);
  confirmEndGameConsensus(room, 'p2');
  assert.deepEqual(withoutConsensus(room), before);
  rejectEndGameConsensus(room, 'p3');
  assert.deepEqual(withoutConsensus(room), before);
});

test('accepted consensus neither finalizes the room nor creates a final result and cannot be rejected', () => {
  const room = makeRoom();
  proposeEndGameConsensus(room, 'p1');
  confirmEndGameConsensus(room, 'p2');

  assert.equal(room.endGameConsensus.status, 'accepted');
  assert.equal(Object.hasOwn(room, 'finished'), false);
  assert.equal(Object.hasOwn(room, 'endedAt'), false);
  assert.equal(Object.hasOwn(room, 'finalResult'), false);
  assert.notEqual(room.phase, 'finished');

  const before = structuredClone(room.endGameConsensus);
  const rejected = rejectEndGameConsensus(room, 'p2');
  assert.equal(rejected.ok, false);
  assert.deepEqual(room.endGameConsensus, before);
});

test('socket commands work outside turn ownership and survive disconnect/reconnect', { timeout: 20000 }, async t => {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  let output = '';
  const sockets = [];

  async function start() {
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        DATABASE_URL: '',
        AUTH_SECRET: 'end-game-consensus-test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try {
        if ((await fetch(base + '/health')).ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Server did not start: ' + output);
  }

  async function connect() {
    const socket = io(base, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await once(socket, 'connect');
    return socket;
  }

  const emit = (socket, event, data = {}) =>
    new Promise((resolve, reject) => socket.timeout(5000).emit(event, data, (err, value) => err ? reject(err) : resolve(value)));

  async function waitFor(predicate) {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for room state.');
  }

  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    if (child?.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  });

  await start();
  const first = await connect();
  const second = await connect();
  let firstView = null;
  let resumedSecondView = null;
  first.on('roomState', view => { firstView = view; });

  const created = await emit(first, 'createRoom', { name: 'One' });
  const joined = await emit(second, 'joinRoom', { code: created.code, name: 'Two' });
  assert.equal(created.ok && joined.ok, true);

  assert.equal((await emit(first, 'setSeatingOrder', { playerIds: [created.playerId, joined.playerId] })).ok, true);
  assert.equal((await emit(first, 'setLeader', { playerId: created.playerId })).ok, true);
  assert.equal((await emit(first, 'setReady', { ready: true })).ok, true);
  assert.equal((await emit(second, 'setReady', { ready: true })).ok, true);
  assert.equal((await emit(first, 'startGame')).ok, true);
  await waitFor(() => firstView?.started === true);

  const ownBefore = firstView.players.find(player => player.id === created.playerId);
  const gameplayBefore = {
    round: firstView.round,
    circle: firstView.circle,
    turnIndex: firstView.turnIndex,
    phase: ownBefore?.phase ?? null,
    roll: ownBefore?.roll ?? null,
    movePoints: ownBefore?.movePoints ?? null,
    actionsLeft: ownBefore?.actionsLeft ?? null,
    eventPhase: firstView.eventPhase ?? null,
    pendingDecision: firstView.pendingDecision ?? null,
  };

  const proposed = await emit(first, 'proposeEndGame');
  assert.equal(proposed.ok, true);
  assert.equal(proposed.endGameConsensus.status, 'proposed');
  assert.deepEqual(proposed.endGameConsensus.confirmedPlayerIds, [created.playerId]);

  second.disconnect();
  await new Promise(resolve => setTimeout(resolve, 40));
  const duplicate = await emit(first, 'confirmEndGame');
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.endGameConsensus.status, 'proposed');

  const resumedSecond = await connect();
  resumedSecond.on('roomState', view => { resumedSecondView = view; });
  const resumed = await emit(resumedSecond, 'resumeRoom', {
    code: created.code,
    playerToken: joined.playerToken,
  });
  assert.equal(resumed.ok, true);
  await waitFor(() => resumedSecondView?.endGameConsensus?.status === 'proposed');
  assert.deepEqual(resumedSecondView.endGameConsensus.confirmedPlayerIds, [created.playerId]);

  const accepted = await emit(resumedSecond, 'confirmEndGame');
  assert.equal(accepted.ok, true);
  assert.equal(accepted.endGameConsensus.status, 'accepted');
  assert.equal(accepted.endGameConsensus.finishAfterRound, gameplayBefore.round);

  await waitFor(() => firstView?.endGameConsensus?.status === 'accepted');
  const ownAfter = firstView.players.find(player => player.id === created.playerId);
  assert.deepEqual({
    round: firstView.round,
    circle: firstView.circle,
    turnIndex: firstView.turnIndex,
    phase: ownAfter?.phase ?? null,
    roll: ownAfter?.roll ?? null,
    movePoints: ownAfter?.movePoints ?? null,
    actionsLeft: ownAfter?.actionsLeft ?? null,
    eventPhase: firstView.eventPhase ?? null,
    pendingDecision: firstView.pendingDecision ?? null,
  }, gameplayBefore);
  assert.equal(Object.hasOwn(firstView, 'finalResult'), false);
});
