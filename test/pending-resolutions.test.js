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
  PendingResolution,
  PENDING_RESOLUTION_FAMILIES,
  pendingResolutionFromLegacy,
  pendingResolutionToLegacy,
  getPendingResolution,
  setPendingResolution,
  clearPendingResolution,
  hasPendingResolution,
  listResolutionQueue,
} = require('../domain-state');
const {
  prepareTreasureHunterChoice,
  resolveMoneyTreasure,
  cloneIslands,
} = require('../game-logic');
const { TREASURE_CARDS, ASSIGNMENT_CARDS } = require('../game-data');
const { projectOpponentFacingRoomView } = require('../state-projection');

const ROOT = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(ROOT, name), 'utf8');

function sequenceRng(values) {
  let index = 0;
  const rng = () => {
    assert.ok(index < values.length, 'RNG sequence exhausted');
    return values[index++];
  };
  rng.calls = () => index;
  return rng;
}

test('PendingResolution maps exactly four legacy families with detached actor/options/payload and exact round-trip', () => {
  const samples = {
    event: {
      field: 'pendingEvent', actor: 'p-event',
      legacy: { id: 'e1', playerId: 'p-event', kind: 'storm', cardName: 'Storm', options: [{ id: 'a', name: 'A', nested: { x: 1 } }], eventCard: { id: 'card-1' }, unknown: { keep: true } },
    },
    feud: {
      field: 'pendingFeud', actor: 'p-feud',
      legacy: { id: 'f1', playerId: 'p-feud', kind: 'downgrade-building', factionId: 'kadingir', remaining: 2, options: [{ islandId: 'i1', buildingIndex: 0 }], excludedOptions: ['i0:0'], feudCard: { id: 'feud-1' }, unknown: 7 },
    },
    'assignment-choice': {
      field: 'pendingAssignmentChoice', actor: 'p-assignment',
      legacy: { id: 'a1', playerId: 'p-assignment', kind: 'embassy', factionId: 'mori', options: [{ id: 'task-a' }, { id: 'task-b' }], canReplace: false, unknown: 'keep' },
    },
    'legendary-reaction': {
      field: 'pendingLegendaryReaction', actor: 'target',
      legacy: { id: 'l1', kind: 'assault', sourcePlayerId: 'source', targetPlayerId: 'target', islandId: 'i1', inviteAllies: true, shipCarpenterPlayerIds: ['source'], unknown: { keep: true } },
    },
  };

  assert.deepEqual(Object.keys(PENDING_RESOLUTION_FAMILIES), ['event', 'feud', 'assignment-choice', 'legendary-reaction']);
  for (const [family, sample] of Object.entries(samples)) {
    const legacy = structuredClone(sample.legacy);
    const resolution = pendingResolutionFromLegacy(family, legacy);
    assert.equal(PendingResolution.is(resolution), true);
    assert.equal(resolution.family, family);
    assert.equal(resolution.kind, legacy.kind);
    assert.equal(resolution.id, legacy.id);
    assert.equal(resolution.actorPlayerId, sample.actor);
    assert.equal(resolution.actorId, sample.actor);
    assert.equal(resolution.state, 'pending');
    assert.equal(resolution.source.backing, sample.field);
    assert.deepEqual(pendingResolutionToLegacy(resolution), legacy);

    if (resolution.options?.[0]) resolution.options[0].id = 'changed';
    resolution.payload.unknown = 'changed';
    resolution.source.backing = 'changed';
    resolution.actorPlayerId = 'changed';
    assert.deepEqual(legacy, sample.legacy);
  }
});

test('PendingResolution get/set/clear preserves absent vs null and never creates unified room state', () => {
  const room = {};
  assert.equal(getPendingResolution(room, 'event'), undefined);
  assert.equal(hasPendingResolution(room, 'event'), false);
  room.pendingEvent = null;
  assert.equal(getPendingResolution(room, 'event'), null);
  assert.equal(hasPendingResolution(room, 'event'), false);

  const legacy = { id: 'evt', playerId: 'p1', kind: 'cargo', options: [{ id: 'main' }], goodId: 'diamonds', privateFutureField: { x: 1 } };
  setPendingResolution(room, 'event', pendingResolutionFromLegacy('event', legacy));
  assert.deepEqual(room.pendingEvent, legacy);
  assert.equal(hasPendingResolution(room, 'event'), true);
  assert.equal(Object.hasOwn(room, 'pendingResolution'), false);
  assert.equal(Object.hasOwn(room, 'pendingResolutions'), false);

  clearPendingResolution(room, 'event');
  assert.equal(room.pendingEvent, null);
  setPendingResolution(room, 'event', undefined);
  assert.equal(Object.hasOwn(room, 'pendingEvent'), false);
});

test('JSON restart keeps pending ids, actors, option order and unknown fields without RNG', () => {
  const room = {
    pendingEvent: { id: 'e', playerId: 'p1', kind: 'observatory', options: [{ id: 'keep' }, { id: 'replace' }], eventCard: { id: 'first' } },
    pendingFeud: { id: 'f', playerId: 'p2', kind: 'remove-forts', remaining: 2, options: [{ id: 'x' }, { id: 'y' }], excludedOptions: ['old'], feudCard: { id: 'feud' } },
    pendingAssignmentChoice: { id: 'a', playerId: 'p3', kind: 'embassy', options: [{ id: 'one' }, { id: 'two' }] },
    pendingLegendaryReaction: { id: 'l', kind: 'sea-attack', sourcePlayerId: 'p4', targetPlayerId: 'p1', inviteAllies: true, shipCarpenterPlayerIds: ['p4'] },
  };
  const restored = JSON.parse(JSON.stringify(room));
  for (const family of Object.keys(PENDING_RESOLUTION_FAMILIES)) {
    const view = getPendingResolution(restored, family);
    assert.ok(view);
    const legacy = pendingResolutionToLegacy(view);
    const field = PENDING_RESOLUTION_FAMILIES[family].field;
    assert.deepEqual(legacy, room[field]);
  }
  assert.doesNotMatch(getPendingResolution.toString(), /Math\.random|rng|draw|sample/i);
});

test('Treasure Hunter preparation samples exactly two independent positions, preserves duplicates/order and captures assignment instance', () => {
  const card = ASSIGNMENT_CARDS.suniksiya.find(entry => entry.id === 'suniksiya-treasure');
  const player = { id: 'p1', activeAssignment: { instanceId: 'treasure-assignment', factionId: 'suniksiya', card: { ...card } } };

  const duplicateRng = sequenceRng([0, 0]);
  const duplicate = prepareTreasureHunterChoice(player, duplicateRng);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicateRng.calls(), 2);
  assert.deepEqual(duplicate.candidates.map(candidate => candidate.id), [TREASURE_CARDS[0].id, TREASURE_CARDS[0].id]);
  assert.deepEqual(duplicate.options, [{ id: '0', name: TREASURE_CARDS[0].name }, { id: '1', name: TREASURE_CARDS[0].name }]);
  assert.equal(duplicate.assignmentInstanceId, 'treasure-assignment');
  assert.notStrictEqual(duplicate.candidates[0], duplicate.candidates[1]);

  const orderedRng = sequenceRng([0, 0.999999]);
  const ordered = prepareTreasureHunterChoice(player, orderedRng);
  assert.equal(orderedRng.calls(), 2);
  assert.deepEqual(ordered.candidates.map(candidate => candidate.id), [TREASURE_CARDS[0].id, TREASURE_CARDS[3].id]);
  assert.deepEqual(ordered.options.map(option => option.id), ['0', '1']);
});

test('money treasure keeps minimum and debt handling through existing resolver', () => {
  const player = { id: 'p1', ducats: 0, debt: 5 };
  const room = { islands: cloneIslands() };
  const card = TREASURE_CARDS.find(entry => entry.id === 'income-x2');
  const result = resolveMoneyTreasure(room, player, card);
  assert.equal(result.ok, true);
  assert.equal(result.amount >= card.minimum, true);
  assert.equal(result.credit.gross, result.amount);
  assert.equal(result.credit.debtPaid, Math.min(5, result.amount));
  assert.equal(player.debt, Math.max(0, 5 - result.amount));
});

test('Treasure Hunter pending projection exposes only safe positional options to actor and generic waiting to others', () => {
  const pending = {
    id: 'treasure-pending',
    playerId: 'p1',
    kind: 'treasure-choice',
    cardName: 'Искатель сокровищ',
    options: [{ id: '0', name: 'Доход ×2' }, { id: '1', name: 'Полный трюм алмазов' }],
    treasureCandidates: [
      { id: 'SECRET_TREASURE_A', name: 'Доход ×2', multiplier: 2, minimum: 4 },
      { id: 'SECRET_TREASURE_B', name: 'Полный трюм алмазов', cargoGoodId: 'diamonds' },
    ],
    treasureAssignmentInstanceId: 'SECRET_ASSIGNMENT',
    origin: 'treasure-hunter',
  };
  const room = {
    version: '0.33.0', code: 'ABCDE', started: true, round: 2, circle: 1, turnIndex: 0, activePlayerId: 'p1',
    players: [{ id: 'p1', name: 'One', phase: 'actions', actionsLeft: 1 }, { id: 'p2', name: 'Two' }],
    islands: [],
    pendingEvent: pending,
  };

  const actor = projectOpponentFacingRoomView(room, { viewerId: 'p1' });
  assert.equal(actor.pendingEvent.kind, 'treasure-choice');
  assert.deepEqual(actor.pendingEvent.options, pending.options);
  assert.equal(Object.hasOwn(actor.pendingEvent, 'treasureCandidates'), false);
  assert.equal(JSON.stringify(actor).includes('SECRET_TREASURE_'), false);
  assert.equal(JSON.stringify(actor).includes('SECRET_ASSIGNMENT'), false);

  const opponent = projectOpponentFacingRoomView(room, { viewerId: 'p2' });
  assert.equal(Object.hasOwn(opponent, 'pendingEvent'), false);
  assert.deepEqual(opponent.pendingDecision, { waiting: true, actorPlayerId: 'p1' });
  assert.equal(JSON.stringify(opponent).includes('Доход ×2'), false);
  assert.equal(JSON.stringify(opponent).includes('Полный трюм алмазов'), false);

  const observer = projectOpponentFacingRoomView(room, { viewerId: null });
  assert.equal(Object.hasOwn(observer, 'pendingEvent'), false);
  assert.deepEqual(observer.pendingDecision, { waiting: true, actorPlayerId: 'p1' });
});

test('server source routes four pending families through facade and leaves other pending models out of scope', () => {
  const server = source('server.js');
  const domain = source('domain-state.js');
  assert.match(server, /setPendingLegacy\(room, 'event'/);
  assert.match(server, /setPendingLegacy\(room, 'feud'/);
  assert.match(server, /setPendingLegacy\(room, 'assignment-choice'/);
  assert.match(server, /setPendingLegacy\(room, 'legendary-reaction'/);
  assert.match(server, /pendingLegacy\(room, 'event'\)/);
  assert.match(server, /pendingLegacy\(room, 'feud'\)/);
  assert.match(server, /pendingLegacy\(room, 'assignment-choice'\)/);
  assert.match(server, /pendingLegacy\(room, 'legendary-reaction'\)/);
  assert.equal((server.match(/setPendingLegacy\(room, 'feud', pending\);/g) || []).length >= 2, true);

  assert.doesNotMatch(domain, /pendingIslandCorrection|pendingFleetAdjustment|pendingBattle|pendingAlliance/);
  assert.match(server, /room\?\.pendingIslandCorrection|room\.pendingIslandCorrection/);
  assert.match(server, /room\?\.pendingFleetAdjustment|room\.pendingFleetAdjustment/);
  assert.match(server, /room\?\.pendingBattle|room\.pendingBattle/);
  assert.match(server, /room\?\.pendingAlliance|room\.pendingAlliance/);
  assert.match(domain, /const PENDING_RESOLUTION_FIELD = 'pendingResolutions'/);
  assert.match(domain, /const RESOLUTION_QUEUE_FIELD = 'resolutionQueue'/);
});

test('Treasure Hunter server flow uses persisted candidates only after activation and never drains expedition rewards for its origin', () => {
  const server = source('server.js');
  const activationStart = server.indexOf("onSocketEvent(socket, 'useTreasureHunter'");
  const activationEnd = server.indexOf("onSocketEvent(socket, 'useFirstMate'", activationStart);
  const activation = server.slice(activationStart, activationEnd);
  assert.ok(activationStart >= 0 && activationEnd > activationStart);
  assert.match(activation, /hasPendingDecision\(room\)/);
  assert.match(activation, /room\.phase !== 'actions'/);
  assert.match(activation, /character\?\.useActionCost/);
  assert.match(activation, /prepareTreasureHunterChoice\(p\)/);
  assert.match(activation, /consumeCharacter\(p, 'treasureHunter'\)/);
  assert.match(activation, /room\.actionsLeft -= actionCost/);
  assert.match(activation, /kind: 'treasure-choice'/);
  assert.match(activation, /treasureCandidates: prepared\.candidates/);
  assert.doesNotMatch(activation, /drawTreasureCard|treasureDeck|distinct|dedup|retry/);

  const resolveStart = server.indexOf('function resolveTreasureHunterChoice');
  const resolveEnd = server.indexOf('function completePendingEvent', resolveStart);
  const resolver = server.slice(resolveStart, resolveEnd);
  assert.match(resolver, /pending\.treasureCandidates\[index\]/);
  assert.match(resolver, /resolveMoneyTreasure\(room, player, treasure\)/);
  assert.match(resolver, /emptyCargoHolds\(room, player\)/);
  assert.match(resolver, /fillCargoDirect\(room, player, treasure\.cargoGoodId/);
  assert.match(resolver, /trackAssignment\(room, player, \{ type: 'treasure-resolved', assignmentInstanceId \}\)/);
  assert.match(resolver, /origin: 'treasure-hunter'/);
  assert.doesNotMatch(resolver, /Math\.random|treasureHunterCandidates|drawTreasureCard/);

  const finishStart = server.indexOf('function finishPendingEvent');
  const finishEnd = server.indexOf('function resolveTreasureHunterChoice', finishStart);
  const finish = server.slice(finishStart, finishEnd);
  assert.match(finish, /if \(origin === 'expedition'\) drainExpeditionTreasureRewards\(room\)/);
  assert.doesNotMatch(finish, /origin !== 'treasure-hunter'/);

  const priority = server.slice(server.indexOf('const ASSIGNMENT_PRIORITY_EVENTS'), server.indexOf('function sameAssignmentOption'));
  assert.match(priority, /useTreasureHunter/);
});

test('Treasure Hunter UI exposes activation and two positional choice buttons without candidate state client-side', () => {
  const app = source('public/app.js');
  assert.match(app, /Искатель сокровищ: выбрать 1 из 2 · 1 действие/);
  assert.match(app, /socket\.emit\('useTreasureHunter'/);
  assert.match(app, /pending\.kind === 'treasure-choice'/);
  assert.match(app, /Вариант \$\{Number\(option\.id\) \+ 1\}: \$\{option\.name\}/);
  assert.match(app, /respondEvent', \{ eventId: pending\.id, choice: option\.id \}/);
  assert.doesNotMatch(app, /treasureCandidates/);
  assert.doesNotMatch(app, /будет подключён вместе с синхронизацией колоды сокровищ/);
});

test('Treasure Hunter activation/restart/choice persists exact pending while character and action stay spent', { timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pervo-pending-58-'));
  const file = path.join(dir, 'database.json');
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
    output = '';
    child = spawn(process.execPath, ['--require', './test/fixtures/postgres.cjs', 'server.js'], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: 'postgres://test', AUTH_SECRET: 'pending-58-secret', TEST_DB_FILE: file },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw Error(output);
      try { if ((await fetch(base + '/health')).ok) return; } catch {}
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

  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await start();
  const accounts = [];
  for (let i = 0; i < 4; i++) accounts.push(await api('/api/auth/register', { username: `pending58p${i + 1}`, password: 'password1' }));
  const initial = await Promise.all(Array.from({ length: 4 }, () => connect()));
  const created = await emit(initial[0], 'createRoom', { accountToken: accounts[0].token, name: 'One' });
  const ids = [created.playerId];
  for (let i = 1; i < 4; i++) ids.push((await emit(initial[i], 'joinRoom', { code: created.code, accountToken: accounts[i].token, name: `Player ${i + 1}` })).playerId);
  await emit(initial[0], 'setLeader', { playerId: ids[0] });
  for (let i = 0; i < 4; i++) await emit(initial[i], 'setReady', { ready: true });
  assert.equal((await emit(initial[0], 'startGame')).ok, true);
  await stop();
  initial.forEach(socket => socket.disconnect());

  let db = readDb();
  let room = db.game_rooms[0].state;
  const activeId = room.order[0];
  const opponentId = room.order[1];
  const active = room.players.find(player => player.id === activeId);
  const activeAccount = accounts[ids.indexOf(activeId)];
  const opponentAccount = accounts[ids.indexOf(opponentId)];
  room.round = 2;
  room.circle = 1;
  room.turnIndex = 0;
  room.completedTurns = room.order.length * 6;
  room.phase = 'actions';
  room.actionsLeft = 2;
  room.preTurnResolutionFlow = null;
  for (const family of ['event', 'feud', 'assignment-choice', 'legendary-reaction']) clearPendingResolution(room, family);
  room.pendingIslandCorrection = null;
  room.pendingFleetAdjustment = null;
  room.pendingBattle = null;
  room.pendingAlliance = null;
  room.resolutionQueue = { kind: 'resolution-queue', items: [{ playerId: 'missing-player', expeditionName: 'must-not-drain' }] };
  active.character = { id: 'treasureHunter' };
  active.cargo = { goodId: 'wood', quantity: 1 };
  active.escorts = [];
  writeDb(db);

  await start();
  let actorSocket = await connect();
  let opponentSocket = await connect();
  assert.equal((await emit(actorSocket, 'resumeRoom', { code: created.code, accountToken: activeAccount.token })).ok, true);
  assert.equal((await emit(opponentSocket, 'resumeRoom', { code: created.code, accountToken: opponentAccount.token })).ok, true);

  const actorStatePromise = once(actorSocket, 'roomState');
  const opponentStatePromise = once(opponentSocket, 'roomState');
  const activation = await emit(actorSocket, 'useTreasureHunter', {});
  assert.deepEqual({ ok: activation.ok, pending: activation.pending, actionCost: activation.actionCost, actionsLeft: activation.actionsLeft }, { ok: true, pending: true, actionCost: 1, actionsLeft: 1 });
  const actorState = (await actorStatePromise)[0];
  const opponentState = (await opponentStatePromise)[0];
  assert.equal(actorState.pendingEvent.kind, 'treasure-choice');
  assert.equal(actorState.pendingEvent.options.length, 2);
  assert.deepEqual(actorState.pendingEvent.options.map(option => option.id), ['0', '1']);
  assert.equal(JSON.stringify(actorState).includes('treasureCandidates'), false);
  assert.equal(Object.hasOwn(opponentState, 'pendingEvent'), false);
  assert.deepEqual(opponentState.pendingDecision, { waiting: true, actorPlayerId: activeId });

  db = readDb();
  room = db.game_rooms[0].state;
  const persistedResolution = getPendingResolution(room, 'event');
  const persisted = pendingResolutionToLegacy(persistedResolution);
  const persistedCandidates = structuredClone(persisted.treasureCandidates);
  assert.equal(persisted.kind, 'treasure-choice');
  assert.equal(persisted.origin, 'treasure-hunter');
  assert.equal(persisted.treasureCandidates.length, 2);
  assert.deepEqual(persisted.options.map(option => option.id), ['0', '1']);
  assert.equal(room.actionsLeft, 1);
  assert.equal(room.players.find(player => player.id === activeId).character, null);
  assert.equal(Object.hasOwn(room, 'treasureDeck'), false);

  const invalid = await emit(actorSocket, 'respondEvent', { eventId: persisted.id, choice: '9' });
  assert.equal(invalid.ok, false);
  db = readDb();
  let pendingAfterInvalid = pendingResolutionToLegacy(getPendingResolution(db.game_rooms[0].state, 'event'));
  assert.equal(pendingAfterInvalid.id, persisted.id);
  assert.deepEqual(pendingAfterInvalid.treasureCandidates, persistedCandidates);
  assert.equal(db.game_rooms[0].state.actionsLeft, 1);

  const blockedEnd = await emit(actorSocket, 'endTurn', {});
  assert.equal(blockedEnd.ok, false);
  assert.match(blockedEnd.error, /обязательное решение/i);

  actorSocket.disconnect();
  await new Promise(resolve => setTimeout(resolve, 100));
  db = readDb();
  const pendingAfterDisconnect = pendingResolutionToLegacy(getPendingResolution(db.game_rooms[0].state, 'event'));
  assert.equal(pendingAfterDisconnect.id, persisted.id);
  assert.deepEqual(pendingAfterDisconnect.treasureCandidates, persistedCandidates);

  await stop();
  opponentSocket.disconnect();
  await start();
  actorSocket = await connect();
  opponentSocket = await connect();
  const resumedStatePromise = once(actorSocket, 'roomState');
  assert.equal((await emit(actorSocket, 'resumeRoom', { code: created.code, accountToken: activeAccount.token })).ok, true);
  const resumedState = (await resumedStatePromise)[0];
  assert.equal(resumedState.pendingEvent.id, persisted.id);
  assert.deepEqual(resumedState.pendingEvent.options, actorState.pendingEvent.options);
  assert.equal((await emit(opponentSocket, 'resumeRoom', { code: created.code, accountToken: opponentAccount.token })).ok, true);

  const resolved = await emit(actorSocket, 'respondEvent', { eventId: persisted.id, choice: '0' });
  assert.equal(resolved.ok, true);
  db = readDb();
  room = db.game_rooms[0].state;
  assert.equal(getPendingResolution(room, 'event'), null);
  assert.equal(room.actionsLeft, 1);
  assert.equal(room.players.find(player => player.id === activeId).character, null);
  assert.deepEqual(listResolutionQueue(room), [{ playerId: 'missing-player', expeditionName: 'must-not-drain' }]);
});

test('Treasure Hunter full-diamonds choice transitions to zero-cost persisted cargo choice and finishes it', { timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pervo-pending-cargo-'));
  const file = path.join(dir, 'database.json');
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
    output = '';
    child = spawn(process.execPath, ['--require', './test/fixtures/postgres.cjs', 'server.js'], {
      cwd: ROOT, windowsHide: true,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: 'postgres://test', AUTH_SECRET: 'pending-cargo-secret', TEST_DB_FILE: file },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw Error(output);
      try { if ((await fetch(base + '/health')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error(output);
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
  }
  async function connect() {
    const socket = io(base, { transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await once(socket, 'connect');
    return socket;
  }
  const emit = (socket, name, data = {}) => new Promise((resolve, reject) => socket.timeout(5000).emit(name, data, (err, value) => err ? reject(err) : resolve(value)));
  async function api(route, body) {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return response.json();
  }
  t.after(async () => {
    sockets.forEach(s => s.disconnect());
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await start();
  const accounts = [];
  for (let i = 0; i < 4; i++) accounts.push(await api('/api/auth/register', { username: `pendingc${i + 1}`, password: 'password1' }));
  const initial = await Promise.all(Array.from({ length: 4 }, () => connect()));
  const created = await emit(initial[0], 'createRoom', { accountToken: accounts[0].token, name: 'One' });
  const ids = [created.playerId];
  for (let i = 1; i < 4; i++) ids.push((await emit(initial[i], 'joinRoom', { code: created.code, accountToken: accounts[i].token, name: `P${i + 1}` })).playerId);
  await emit(initial[0], 'setLeader', { playerId: ids[0] });
  for (let i = 0; i < 4; i++) await emit(initial[i], 'setReady', { ready: true });
  assert.equal((await emit(initial[0], 'startGame')).ok, true);
  await stop();
  initial.forEach(s => s.disconnect());

  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const room = db.game_rooms[0].state;
  const activeId = room.order[0];
  const active = room.players.find(player => player.id === activeId);
  const account = accounts[ids.indexOf(activeId)];
  room.round = 2; room.circle = 1; room.turnIndex = 0; room.completedTurns = room.order.length * 6; room.phase = 'actions'; room.actionsLeft = 1; room.preTurnResolutionFlow = null;
  active.cargo = null;
  active.escorts = [{ id: 'test-escort', type: 'cargo', special: true, cargo: null }];
  const diamonds = structuredClone(TREASURE_CARDS.find(card => card.id === 'full-diamonds-hold'));
  const money = structuredClone(TREASURE_CARDS.find(card => card.id === 'income-x1'));
  setPendingResolution(room, 'event', pendingResolutionFromLegacy('event', {
    id: 'treasure-cargo-transition', playerId: activeId, kind: 'treasure-choice', cardName: 'Искатель сокровищ', origin: 'treasure-hunter',
    options: [{ id: '0', name: diamonds.name }, { id: '1', name: money.name }],
    treasureCandidates: [diamonds, money], treasureAssignmentInstanceId: null,
  }));
  room.resolutionQueue = { kind: 'resolution-queue', items: [{ playerId: 'missing-player', expeditionName: 'must-stay' }] };
  fs.writeFileSync(file, JSON.stringify(db));

  await start();
  const socket = await connect();
  assert.equal((await emit(socket, 'resumeRoom', { code: created.code, accountToken: account.token })).ok, true);
  const choice = await emit(socket, 'respondEvent', { eventId: 'treasure-cargo-transition', choice: '0' });
  assert.deepEqual({ ok: choice.ok, pending: choice.pending }, { ok: true, pending: true });

  let saved = JSON.parse(fs.readFileSync(file, 'utf8')).game_rooms[0].state;
  let savedPending = pendingResolutionToLegacy(getPendingResolution(saved, 'event'));
  assert.equal(savedPending.kind, 'cargo');
  assert.equal(savedPending.origin, 'treasure-hunter');
  assert.equal(savedPending.id, 'treasure-cargo-transition');
  assert.equal(savedPending.options.length >= 2, true);
  assert.equal(saved.actionsLeft, 1);
  assert.deepEqual(listResolutionQueue(saved), [{ playerId: 'missing-player', expeditionName: 'must-stay' }]);

  const holdId = savedPending.options[0].id;
  const finish = await emit(socket, 'respondEvent', { eventId: savedPending.id, holdId });
  assert.equal(finish.ok, true);
  saved = JSON.parse(fs.readFileSync(file, 'utf8')).game_rooms[0].state;
  assert.equal(getPendingResolution(saved, 'event'), null);
  assert.equal(saved.actionsLeft, 1);
  const player = saved.players.find(item => item.id === activeId);
  const cargo = holdId === 'main' ? player.cargo : player.escorts.find(escort => escort.id === holdId)?.cargo;
  assert.equal(cargo.goodId, 'diamonds');
  assert.deepEqual(listResolutionQueue(saved), [{ playerId: 'missing-player', expeditionName: 'must-stay' }]);
});
