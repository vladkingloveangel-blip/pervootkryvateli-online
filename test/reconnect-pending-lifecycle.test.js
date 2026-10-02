const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { io } = require('socket.io-client');
const rules = require('../rules');
const { clearPendingResolution } = require('../domain-state');

test('mandatory assault Sea Veil decision survives disconnect and resumes before combat resolves', { timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pervo-reconnect-pending-'));
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
      cwd: path.join(__dirname, '..'),
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        DATABASE_URL: 'postgres://test',
        AUTH_SECRET: 'reconnect-pending-test-secret',
        TEST_DB_FILE: file,
      },
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

  async function waitForDb(predicate, label) {
    for (let i = 0; i < 60; i++) {
      const db = JSON.parse(fs.readFileSync(file, 'utf8'));
      const value = predicate(db);
      if (value) return { db, value };
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Timed out waiting for persisted state: ' + label);
  }

  const readDb = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const writeDb = value => fs.writeFileSync(file, JSON.stringify(value));

  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await start();
  const sourceAccount = await api('/api/auth/register', { username: 'pending_source', password: 'password1' });
  const targetAccount = await api('/api/auth/register', { username: 'pending_target', password: 'password1' });
  const sourceInitial = await connect();
  const targetInitial = await connect();

  const created = await emit(sourceInitial, 'createRoom', { accountToken: sourceAccount.token, name: 'Source' });
  const joined = await emit(targetInitial, 'joinRoom', { code: created.code, accountToken: targetAccount.token, name: 'Target' });
  await emit(sourceInitial, 'setReady', { ready: true });
  await emit(targetInitial, 'setReady', { ready: true });
  assert.equal((await emit(sourceInitial, 'startGame')).ok, true);

  await stop();
  sourceInitial.disconnect();
  targetInitial.disconnect();

  const db = readDb();
  const room = db.game_rooms[0].state;
  const sourceId = created.playerId;
  const targetId = joined.playerId;
  const source = room.players.find(player => player.id === sourceId);
  const target = room.players.find(player => player.id === targetId);
  const island = room.islands.find(item => item.id === 'bogamia') || room.islands[0];
  assert.ok(source && target && island);

  room.round = 2;
  room.circle = 2;
  room.turnIndex = room.order.indexOf(sourceId);
  room.phase = 'actions';
  room.actionsLeft = rules.session.actionsPerTurn;
  room.roll = null;
  room.movePoints = null;
  room.preTurnResolutionFlow = null;
  for (const family of ['event', 'feud', 'assignment-choice', 'legendary-reaction']) clearPendingResolution(room, family);
  room.pendingIslandCorrection = null;
  room.pendingFleetAdjustment = null;
  room.pendingBattle = null;
  room.pendingAlliance = null;
  room.alliances = [];
  room.endGameConsensus = null;

  source.row = island.cells[0][0];
  source.col = island.cells[0][1];
  source.level = 6;
  source.upgrades = [];
  source.landCompany = { army: 20 };
  source.attackLimitRound = 2;
  source.attackCountsThisRound = {};
  source.brokenAlliesThisTurn = [];
  source.activeAssignmentTask = null;
  source.character = null;
  source.temporaryEffects = { active: [], scheduled: [] };

  target.row = 0;
  target.col = 0;
  target.suzerainId = null;
  target.consumableAbilities = [{
    instanceId: 'mandatory-assault-veil',
    abilityId: 'sea-veil',
    origin: { kind: 'legendary' },
    data: { copy: 1 },
  }];
  target.consumableAbilitySequence = 1;
  delete target.legendaryCards;
  target.temporaryEffects = { active: [], scheduled: [] };

  island.ownerId = targetId;
  island.kind = 'independent';
  island.factionId = null;
  island.buildings = [];
  island.garrisonType = null;
  island.garrisonName = null;
  island.garrisonDefense = 0;
  island.reward = null;

  writeDb(db);

  await start();
  const sourceSocket = await connect();
  const targetSocket = await connect();
  assert.equal((await emit(sourceSocket, 'resumeRoom', { code: created.code, accountToken: sourceAccount.token })).ok, true);
  assert.equal((await emit(targetSocket, 'resumeRoom', { code: created.code, accountToken: targetAccount.token })).ok, true);

  const pendingStatePromise = once(targetSocket, 'roomState');
  const attack = await emit(sourceSocket, 'assaultIsland', { islandId: island.id, inviteAllies: false });
  assert.equal(attack.ok, true, attack.error || '');
  assert.equal(attack.pending, true);
  const pendingState = (await pendingStatePromise)[0];
  const reaction = pendingState.pendingLegendaryReaction;
  assert.ok(reaction);
  assert.equal(reaction.kind, 'assault');
  assert.equal(reaction.targetPlayerId, targetId);
  assert.equal(reaction.viewerCanRespond, true);
  assert.equal(reaction.veilOptions.some(option => option.id === 'sea-veil'), true);
  const reactionId = reaction.id;

  let persisted = readDb().game_rooms[0].state;
  const pendingBeforeDisconnect = persisted.pendingResolutions['legendary-reaction'];
  assert.equal(pendingBeforeDisconnect.id, reactionId);
  assert.equal(persisted.islands.find(item => item.id === island.id).ownerId, targetId);
  const actionsAfterAttack = persisted.actionsLeft;

  const disconnectStatePromise = once(sourceSocket, 'roomState');
  targetSocket.disconnect();
  const sourceAfterDisconnect = (await disconnectStatePromise)[0];
  assert.equal(Object.hasOwn(sourceAfterDisconnect, 'pendingLegendaryReaction'), false);
  assert.deepEqual(sourceAfterDisconnect.pendingDecision, { waiting: true, actorPlayerId: targetId });
  assert.equal(sourceAfterDisconnect.islands.find(item => item.id === island.id).ownerId, targetId);

  const disconnectedPersisted = await waitForDb(current => {
    const state = current.game_rooms?.[0]?.state;
    const pending = state?.pendingResolutions?.['legendary-reaction'];
    const player = state?.players?.find(item => item.id === targetId);
    return pending?.id === reactionId && player?.connected === false ? state : null;
  }, 'mandatory Sea Veil pending after disconnect');
  persisted = disconnectedPersisted.value;
  assert.equal(persisted.pendingResolutions['legendary-reaction'].id, reactionId);
  assert.equal(persisted.islands.find(item => item.id === island.id).ownerId, targetId);
  assert.equal(persisted.actionsLeft, actionsAfterAttack);
  assert.equal(persisted.log.some(entry => entry.text.includes('не использует «Покров моря» из-за отключения')), false);
  assert.equal(persisted.log.some(entry => entry.text.includes('Решение сохранено до переподключения')), true);

  const resumedTarget = await connect();
  const reconnectStatePromise = once(resumedTarget, 'roomState');
  const resumed = await emit(resumedTarget, 'resumeRoom', { code: created.code, accountToken: targetAccount.token });
  assert.equal(resumed.ok, true, resumed.error || '');
  const reconnectState = (await reconnectStatePromise)[0];
  assert.equal(reconnectState.pendingLegendaryReaction.id, reactionId);
  assert.equal(reconnectState.pendingLegendaryReaction.kind, 'assault');
  assert.equal(reconnectState.pendingLegendaryReaction.viewerCanRespond, true);
  assert.equal(reconnectState.pendingLegendaryReaction.veilOptions.some(option => option.id === 'sea-veil'), true);
  assert.equal(reconnectState.islands.find(item => item.id === island.id).ownerId, targetId);

  const resolvedStatePromise = once(sourceSocket, 'roomState');
  const answer = await emit(resumedTarget, 'respondLegendaryReaction', {
    reactionId,
    useVeil: false,
  });
  assert.equal(answer.ok, true, answer.error || '');
  const resolvedState = (await resolvedStatePromise)[0];
  assert.equal(Object.hasOwn(resolvedState, 'pendingDecision'), false);
  assert.equal(Object.hasOwn(resolvedState, 'pendingLegendaryReaction'), false);
  assert.equal(resolvedState.islands.find(item => item.id === island.id).ownerId, sourceId);

  const finalPersisted = await waitForDb(current => {
    const state = current.game_rooms?.[0]?.state;
    return state?.pendingResolutions?.['legendary-reaction'] === null
      && state?.islands?.find(item => item.id === island.id)?.ownerId === sourceId ? state : null;
  }, 'assault resolution after explicit answer');
  assert.equal(finalPersisted.value.actionsLeft, actionsAfterAttack);
});

test('disconnect policy keeps optional alliance and battle invitation behavior separate from mandatory legendary pending', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = server.indexOf("onSocketEvent(socket, 'disconnect'");
  const end = server.indexOf('\n  });\n});', start);
  assert.ok(start >= 0 && end > start);
  const handler = server.slice(start, end);

  assert.match(handler, /room\.pendingAlliance = null/);
  assert.match(handler, /invite\.response = false/);
  assert.match(handler, /pendingLegacy\(room, 'legendary-reaction'\)/);
  assert.doesNotMatch(handler, /resolvePendingLegendaryReaction\(room, false, null\)/);
});
