'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { io } = require('socket.io-client');
const {
  listResolutionQueue,
  peekResolutionQueue,
  enqueueResolution,
  dequeueResolution,
  resolutionQueueLength,
  getPendingResolution,
  setPendingResolution,
  pendingResolutionFromLegacy,
  pendingResolutionToLegacy,
} = require('../domain-state');
const { ASSIGNMENT_CARDS, TREASURE_CARDS } = require('../game-data');
const { projectOpponentFacingRoomView, projectRoomForViewer } = require('../state-projection');

const ROOT = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('ResolutionQueue absent/empty behavior is non-mutating and invalid backing is left to compatibility normalization', () => {
  const absent = {};
  assert.deepEqual(listResolutionQueue(absent), []);
  assert.equal(peekResolutionQueue(absent), undefined);
  assert.equal(dequeueResolution(absent), undefined);
  assert.equal(resolutionQueueLength(absent), 0);
  assert.equal(Object.hasOwn(absent, 'pendingExpeditionRewards'), false);

  const empty = { pendingExpeditionRewards: [] };
  assert.deepEqual(listResolutionQueue(empty), []);
  assert.equal(peekResolutionQueue(empty), undefined);
  assert.equal(dequeueResolution(empty), undefined);
  assert.equal(resolutionQueueLength(empty), 0);

  assert.throws(() => listResolutionQueue({ pendingExpeditionRewards: null }), /compatibility normalization/i);
  assert.throws(() => resolutionQueueLength({ pendingExpeditionRewards: {} }), /compatibility normalization/i);
});

test('ResolutionQueue list and peek are detached and preserve unknown legacy fields', () => {
  const original = {
    playerId: 'p1',
    expeditionName: 'Экспедиция A',
    treasureAssignmentInstanceId: 'task-1',
    futureLegacyField: { x: 1, nested: ['keep'] },
  };
  const room = { pendingExpeditionRewards: [structuredClone(original)] };
  const list = listResolutionQueue(room);
  const peek = peekResolutionQueue(room);
  assert.deepEqual(list, [original]);
  assert.deepEqual(peek, original);
  assert.notStrictEqual(list[0], room.pendingExpeditionRewards[0]);
  assert.notStrictEqual(peek, room.pendingExpeditionRewards[0]);

  list[0].playerId = 'changed';
  list[0].futureLegacyField.x = 99;
  peek.expeditionName = 'changed';
  peek.futureLegacyField.nested.push('changed');
  assert.deepEqual(room.pendingExpeditionRewards, [original]);
});

test('ResolutionQueue enqueue appends and dequeue removes only head in exact FIFO order', () => {
  const room = {};
  const entries = [
    { playerId: 'p1', expeditionName: 'A', treasureAssignmentInstanceId: 'task-a' },
    { playerId: 'p2', expeditionName: 'B', treasureAssignmentInstanceId: null, unknown: { b: 2 } },
    { playerId: 'p1', expeditionName: 'C', treasureAssignmentInstanceId: 'task-c' },
  ];
  for (const entry of entries) enqueueResolution(room, entry);

  assert.deepEqual(room.pendingExpeditionRewards, entries);
  assert.equal(resolutionQueueLength(room), 3);
  assert.deepEqual(peekResolutionQueue(room), entries[0]);

  const first = dequeueResolution(room);
  assert.deepEqual(first, entries[0]);
  first.expeditionName = 'mutated after dequeue';
  assert.deepEqual(room.pendingExpeditionRewards, entries.slice(1));
  assert.deepEqual(dequeueResolution(room), entries[1]);
  assert.deepEqual(dequeueResolution(room), entries[2]);
  assert.equal(dequeueResolution(room), undefined);
  assert.deepEqual(room.pendingExpeditionRewards, []);
  assert.equal(Object.hasOwn(room, 'resolutionQueue'), false);
  assert.equal(Object.hasOwn(room, 'rewardQueue'), false);
  assert.equal(Object.hasOwn(room, 'pendingRewardQueue'), false);
});

test('ResolutionQueue survives JSON restart with exact legacy item shape, order and assignment linkage', () => {
  const queue = [
    { playerId: 'p1', expeditionName: 'A', treasureAssignmentInstanceId: 'old-a', futureLegacyField: { x: 1 } },
    { playerId: 'p2', expeditionName: 'B', treasureAssignmentInstanceId: null },
    { playerId: 'p1', expeditionName: 'C', treasureAssignmentInstanceId: 'old-c' },
  ];
  const restored = JSON.parse(JSON.stringify({ pendingExpeditionRewards: queue }));
  assert.deepEqual(listResolutionQueue(restored), queue);
  assert.deepEqual(dequeueResolution(restored), queue[0]);
  assert.deepEqual(listResolutionQueue(restored), queue.slice(1));
});

test('5.9 server consumers use facade, capture assignment at expedition completion and do not sample on enqueue', () => {
  const server = source('server.js');
  const arrivalStart = server.indexOf('function handleExpeditionArrival');
  const arrivalEnd = server.indexOf('function handleArrival', arrivalStart);
  const arrival = server.slice(arrivalStart, arrivalEnd);
  assert.ok(arrivalStart >= 0 && arrivalEnd > arrivalStart);
  assert.match(arrival, /enqueueResolution\(room, \{/);
  assert.match(arrival, /playerId: player\.id/);
  assert.match(arrival, /expeditionName: name/);
  assert.match(arrival, /treasureAssignmentInstanceId: getActiveAssignmentTask\(player\)\?\.id \|\| null/);
  assert.match(arrival, /if \(!hasPendingResolution\(room, 'event'\)\) drainExpeditionTreasureRewards\(room\)/);
  assert.doesNotMatch(arrival, /drawTreasureCard|selectTreasure|Math\.random|rng/);

  const drainStart = server.indexOf('function drainExpeditionTreasureRewards');
  const drainEnd = server.indexOf('function handleExpeditionArrival', drainStart);
  const drain = server.slice(drainStart, drainEnd);
  assert.match(drain, /if \(hasPendingResolution\(room, 'event'\)\) return true/);
  assert.match(drain, /while \(resolutionQueueLength\(room\) > 0\)/);
  assert.match(drain, /const queued = dequeueResolution\(room\)/);
  assert.match(drain, /const player = playerById\(room, queued\.playerId\)/);
  assert.match(drain, /if \(!player\) continue/);
  assert.match(drain, /resolveExpeditionTreasureReward\(room, player, queued\)/);
  assert.match(drain, /if \(result\.pending\) return true/);
  assert.ok(drain.indexOf('dequeueResolution(room)') < drain.indexOf('resolveExpeditionTreasureReward(room, player, queued)'));

  const finishStart = server.indexOf('function finishPendingEvent');
  const finishEnd = server.indexOf('function resolveTreasureHunterChoice', finishStart);
  const finish = server.slice(finishStart, finishEnd);
  assert.match(finish, /if \(origin === 'expedition'\) drainExpeditionTreasureRewards\(room\)/);
  assert.doesNotMatch(finish, /origin !== 'treasure-hunter'/);
});

test('normal server runtime uses target resolutionQueue while legacy pendingExpeditionRewards remains compatibility-only', () => {
  const server = source('server.js');
  const legacyDirect = server.split('\n').filter(line => line.includes('pendingExpeditionRewards'));
  assert.equal(legacyDirect.length, 0, legacyDirect.join('\n'));
  const targetDirect = server.split('\n').filter(line => line.includes('resolutionQueue'));
  assert.equal(targetDirect.length >= 2, true);
  assert.equal(targetDirect.some(line => /\.push|\.shift|for\s*\(|for\s+.*of/.test(line)), false);

  const game = source('game-logic.js');
  const gameDirect = game.split('\n').filter(line => line.includes('pendingExpeditionRewards'));
  assert.equal(gameDirect.length >= 1, true);
  assert.match(gameDirect.join('\n'), /!Array\.isArray\(room\.pendingExpeditionRewards\)/);

  const domain = source('domain-state.js');
  assert.match(domain, /const RESOLUTION_QUEUE_FIELD = 'resolutionQueue'/);
  assert.match(domain, /const LEGACY_RESOLUTION_QUEUE_FIELD = 'pendingExpeditionRewards'/);
  assert.doesNotMatch(domain, /drawTreasureCard|selectTreasureOutcome|Math\.random|rng/);
});

test('ResolutionQueue stays private from ordinary projected roomState', () => {
  const room = {
    version: '0.33.0',
    code: 'ABCDE',
    started: true,
    players: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }],
    islands: [],
    pendingExpeditionRewards: [{
      playerId: 'SECRET_PLAYER',
      expeditionName: 'SECRET_EXPEDITION',
      treasureAssignmentInstanceId: 'SECRET_ASSIGNMENT',
    }],
  };
  for (const viewerId of ['p1', 'p2', null]) {
    const view = projectRoomForViewer(room, { viewerId });
    assert.equal(Object.hasOwn(view, 'pendingExpeditionRewards'), false);
    const json = JSON.stringify(view);
    assert.equal(json.includes('SECRET_PLAYER'), false);
    assert.equal(json.includes('SECRET_EXPEDITION'), false);
    assert.equal(json.includes('SECRET_ASSIGNMENT'), false);
  }
});

test('restart mid expedition pending keeps queued B blocked, then cargo response resumes B exactly once with saved assignment linkage', { timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pervo-resolution-queue-'));
  const file = path.join(dir, 'database.json');
  const rngCounter = path.join(dir, 'rng-count.txt');
  const randomPreload = path.join(dir, 'fixed-random.cjs');
  fs.writeFileSync(randomPreload, `
    const fs = require('fs');
    const Module = require('module');
    const file = process.env.TEST_RANDOM_COUNT_FILE;
    const originalLoad = Module._load;
    let calls = 0;
    let wrapped = false;
    fs.writeFileSync(file, '0');
    Module._load = function(request, parent, isMain) {
      const loaded = originalLoad.apply(this, arguments);
      if (!wrapped && request === './digital-random-sources' && parent?.filename?.endsWith('game-logic.js')) {
        wrapped = true;
        const originalSelectTreasureOutcome = loaded.selectTreasureOutcome;
        loaded.selectTreasureOutcome = () => {
          calls += 1;
          fs.writeFileSync(file, String(calls));
          return originalSelectTreasureOutcome(() => 0);
        };
      }
      return loaded;
    };
  `);

  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  let output = '';
  const sockets = [];

  async function start(options = {}) {
    output = '';
    const args = ['--require', './test/fixtures/postgres.cjs'];
    if (options.fixedRandom) args.push('--require', randomPreload);
    args.push('server.js');
    child = spawn(process.execPath, args, {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        DATABASE_URL: 'postgres://test',
        AUTH_SECRET: 'resolution-queue-secret',
        TEST_DB_FILE: file,
        TEST_RANDOM_COUNT_FILE: rngCounter,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw Error(output);
      try {
        if ((await fetch(base + '/health')).ok) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Server did not start: ' + output);
  }

  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;
  }

  async function connect() {
    const socket = io(base, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await once(socket, 'connect');
    return socket;
  }

  const emit = (socket, name, data = {}) => new Promise((resolve, reject) =>
    socket.timeout(5000).emit(name, data, (err, value) => err ? reject(err) : resolve(value))
  );

  async function api(route, body) {
    const response = await fetch(base + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.json();
  }

  const readDb = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const writeDb = db => fs.writeFileSync(file, JSON.stringify(db));
  const rngCalls = () => Number(fs.readFileSync(rngCounter, 'utf8')) || 0;

  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await start();
  const accounts = [];
  for (let i = 0; i < 4; i++) {
    accounts.push(await api('/api/auth/register', { username: `queue59p${i + 1}`, password: 'password1' }));
  }
  const initial = await Promise.all(Array.from({ length: 4 }, () => connect()));
  const created = await emit(initial[0], 'createRoom', { accountToken: accounts[0].token, name: 'One' });
  const ids = [created.playerId];
  for (let i = 1; i < 4; i++) {
    ids.push((await emit(initial[i], 'joinRoom', {
      code: created.code,
      accountToken: accounts[i].token,
      name: `P${i + 1}`,
    })).playerId);
  }
  await emit(initial[0], 'setLeader', { playerId: ids[0] });
  for (let i = 0; i < 4; i++) await emit(initial[i], 'setReady', { ready: true });
  assert.equal((await emit(initial[0], 'startGame')).ok, true);
  await stop();
  initial.forEach(socket => socket.disconnect());

  let db = readDb();
  let room = db.game_rooms[0].state;
  const activeId = room.order[0];
  const active = room.players.find(player => player.id === activeId);
  const activeAccount = accounts[ids.indexOf(activeId)];
  const treasureAssignment = ASSIGNMENT_CARDS.suniksiya.find(card => card.id === 'suniksiya-treasure');
  const diamonds = TREASURE_CARDS.find(card => card.id === 'full-diamonds-hold');

  room.round = 2;
  room.circle = 1;
  room.turnIndex = 0;
  room.completedTurns = room.order.length * 6;
  room.phase = 'actions';
  room.actionsLeft = 2;
  room.preTurnResolutionFlow = null;
  active.cargo = null;
  active.escorts = [];
  active.activeAssignment = {
    instanceId: 'new-current-assignment',
    factionId: 'suniksiya',
    card: structuredClone(treasureAssignment),
    issuedRound: 2,
  };
  setPendingResolution(room, 'event', pendingResolutionFromLegacy('event', {
    id: 'expedition-A-pending',
    playerId: activeId,
    kind: 'cargo',
    cardName: 'Экспедиция «A»: Полный трюм алмазов',
    options: [{ id: 'main', name: 'Основной трюм', capacity: 2 }],
    goodId: diamonds.cargoGoodId,
    treasureCard: structuredClone(diamonds),
    treasureAssignmentInstanceId: null,
    origin: 'expedition',
  }));
  room.resolutionQueue = { kind: 'resolution-queue', items: [{
    playerId: activeId,
    expeditionName: 'B queued reward',
    treasureAssignmentInstanceId: 'old-captured-assignment',
  }] };
  writeDb(db);

  await start({ fixedRandom: true });
  const socket = await connect();
  const resumedStatePromise = once(socket, 'roomState');
  assert.equal((await emit(socket, 'resumeRoom', { code: created.code, accountToken: activeAccount.token })).ok, true);
  const resumedState = (await resumedStatePromise)[0];

  db = readDb();
  room = db.game_rooms[0].state;
  const restoredPending = pendingResolutionToLegacy(getPendingResolution(room, 'event'));
  assert.equal(restoredPending.id, 'expedition-A-pending');
  assert.deepEqual(listResolutionQueue(room), [{
    playerId: activeId,
    expeditionName: 'B queued reward',
    treasureAssignmentInstanceId: 'old-captured-assignment',
  }]);
  assert.equal(Object.hasOwn(resumedState, 'pendingExpeditionRewards'), false);
  const beforeResponseRng = rngCalls();

  const response = await emit(socket, 'respondEvent', { eventId: 'expedition-A-pending', holdId: 'main' });
  assert.equal(response.ok, true);

  db = readDb();
  room = db.game_rooms[0].state;
  const afterResponseRng = rngCalls();
  assert.equal(afterResponseRng - beforeResponseRng, 1, 'only queued B treasure is sampled after persisted A continuation resolves');
  assert.equal(getPendingResolution(room, 'event'), null);
  assert.deepEqual(listResolutionQueue(room), []);
  assert.equal(room.players.find(player => player.id === activeId).activeAssignment.instanceId, 'new-current-assignment');

  const texts = room.log.map(entry => entry.text);
  assert.equal(texts.filter(text => text.includes('B queued reward')).length, 1);
  assert.equal(texts.filter(text => text.includes('Экспедиция «A»: Полный трюм алмазов')).length, 1);
  assert.equal(Object.hasOwn(room, 'resolutionQueue'), true);
  assert.equal(Object.hasOwn(room, 'pendingExpeditionRewards'), false);
  assert.equal(Object.hasOwn(room, 'rewardQueue'), false);
});
