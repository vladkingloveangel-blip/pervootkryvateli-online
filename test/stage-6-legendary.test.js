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

test('stage 6.5: hostile legendary card + reactive Sea Veil discards both cards without three-turn protection', { timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pervo-stage6-legendary-'));
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
        AUTH_SECRET: 'stage-6-5-test-secret',
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

  async function change(socket, event, data = {}, viewSocket = socket) {
    const next = once(viewSocket, 'roomState');
    const result = await emit(socket, event, data);
    assert.equal(result.ok, true, `${event}: ${result.error || ''}`);
    return { result, state: (await next)[0] };
  }

  const readDb = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const writeDb = value => fs.writeFileSync(file, JSON.stringify(value));

  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await start();
  const accounts = [];
  for (let i = 0; i < 4; i++) accounts.push(await api('/api/auth/register', { username: `legend65p${i + 1}`, password: 'password1' }));
  const initial = await Promise.all(Array.from({ length: 4 }, () => connect()));
  const created = await emit(initial[0], 'createRoom', { accountToken: accounts[0].token, name: 'One' });
  const ids = [created.playerId];
  for (let i = 1; i < 4; i++) ids.push((await emit(initial[i], 'joinRoom', { code: created.code, accountToken: accounts[i].token, name: `Player ${i + 1}` })).playerId);
  await emit(initial[0], 'setLeader', { playerId: ids[0] });
  for (let i = 0; i < 4; i++) await emit(initial[i], 'setReady', { ready: true });
  assert.equal((await emit(initial[0], 'startGame')).ok, true);
  await stop();
  initial.forEach(socket => socket.disconnect());

  const db = readDb();
  const room = db.game_rooms[0].state;
  const sourceId = room.order[0];
  const targetId = room.order[1];
  const source = room.players.find(player => player.id === sourceId);
  const target = room.players.find(player => player.id === targetId);
  const sourceAccount = accounts[ids.indexOf(sourceId)];
  const targetAccount = accounts[ids.indexOf(targetId)];

  room.round = 2;
  room.circle = 1;
  room.turnIndex = 0;
  room.completedTurns = room.order.length * 6;
  room.phase = 'actions';
  room.actionsLeft = rules.session.actionsPerTurn;
  room.roll = null;
  room.movePoints = null;
  room.eventPhase = null;
  room.pendingEvent = null;
  room.pendingFeud = null;
  room.pendingAssignmentChoice = null;
  room.pendingIslandCorrection = null;
  room.pendingFleetAdjustment = null;
  room.pendingLegendaryReaction = null;
  room.pendingBattle = null;
  room.pendingAlliance = null;
  room.alliances = [];

  source.row = 24; source.col = 6;
  target.row = 24; target.col = 6;
  source.attackLimitRound = 2;
  source.attackCountsThisRound = {};
  source.legendaryCards = [{ ...structuredClone(rules.legends.legendary.find(card => card.id === 'sea-curse')), copy: 1 }];
  source.legendaryEffects = { seaCurses: [] };
  target.legendaryCards = [{ ...structuredClone(rules.legends.legendary.find(card => card.id === 'sea-veil')), copy: 1 }];
  target.legendaryEffects = { seaCurses: [] };
  source.enemyFactionIds = [];
  target.enemyFactionIds = [];
  writeDb(db);

  await start();
  const sourceSocket = await connect();
  const targetSocket = await connect();
  assert.equal((await emit(sourceSocket, 'resumeRoom', { code: created.code, accountToken: sourceAccount.token })).ok, true);
  assert.equal((await emit(targetSocket, 'resumeRoom', { code: created.code, accountToken: targetAccount.token })).ok, true);

  let changed = await change(sourceSocket, 'playLegendary', { source: 'legendary', index: 0, targetPlayerId: targetId }, targetSocket);
  assert.equal(changed.result.pending, true);
  let state = changed.state;
  assert.equal(state.pendingLegendaryReaction.kind, 'sea-curse');
  assert.equal(state.pendingLegendaryReaction.targetPlayerId, targetId);
  assert.equal(Object.hasOwn(state.eventDecks,'legendary'), false);
  assert.equal(state.players.find(player => player.id === sourceId).legendaryCardCount, 0);

  changed = await change(targetSocket, 'respondLegendaryReaction', {
    reactionId: state.pendingLegendaryReaction.id,
    useVeil: true,
    source: 'legendary',
    index: 0,
  }, sourceSocket);
  state = changed.state;
  const targetView = state.players.find(player => player.id === targetId);
  assert.equal(state.pendingLegendaryReaction, null);
  assert.equal(Object.hasOwn(state.eventDecks,'legendary'), false);
  assert.equal(targetView.legendaryCardCount, 0);
  assert.equal(targetView.legendaryStatus.shipVeilTurns, 0);
  assert.deepEqual(targetView.legendaryStatus.seaCurseTurns, []);
  assert.equal(targetView.legendaryStatus.seaCursePenalty, 0);
  assert.equal(state.log.some(entry => entry.text.includes('Обе легендарные карты расходованы') && entry.text.includes('трёхходовая защита не начинается')), true);

  const persisted = readDb().game_rooms[0].state;
  const persistedTarget = persisted.players.find(player => player.id === targetId);
  assert.equal(persistedTarget.legendaryEffects.shipVeil, undefined);
  assert.equal(persistedTarget.legendaryEffects.shipVeilReaction.expiry, 'end-of-current-turn');
  assert.equal(persistedTarget.legendaryEffects.shipVeilReaction.expiresOnPlayerId, sourceId);

  await change(sourceSocket, 'endTurn', {}, targetSocket);
  const afterTurn = readDb().game_rooms[0].state;
  const afterTarget = afterTurn.players.find(player => player.id === targetId);
  assert.equal(afterTarget.legendaryEffects.shipVeilReaction, undefined);

  // Уже действующий Покров не запрещает объявить враждебную карту: нападающий
  // тратит карту и действие, после чего защита отменяет только её эффект.
  await stop();
  sourceSocket.disconnect();
  targetSocket.disconnect();
  const protectedDb = readDb();
  const protectedRoom = protectedDb.game_rooms[0].state;
  const protectedSource = protectedRoom.players.find(player => player.id === sourceId);
  const protectedTarget = protectedRoom.players.find(player => player.id === targetId);
  protectedRoom.round = 2;
  protectedRoom.circle = 2;
  protectedRoom.turnIndex = protectedRoom.order.indexOf(sourceId);
  protectedRoom.phase = 'actions';
  protectedRoom.actionsLeft = rules.session.actionsPerTurn;
  protectedRoom.roll = null;
  protectedRoom.movePoints = null;
  protectedRoom.eventPhase = null;
  protectedRoom.pendingEvent = null;
  protectedRoom.pendingFeud = null;
  protectedRoom.pendingAssignmentChoice = null;
  protectedRoom.pendingIslandCorrection = null;
  protectedRoom.pendingFleetAdjustment = null;
  protectedRoom.pendingLegendaryReaction = null;
  protectedRoom.pendingBattle = null;
  protectedRoom.pendingAlliance = null;
  protectedRoom.alliances = [];
  protectedSource.row = 24; protectedSource.col = 6;
  protectedTarget.row = 24; protectedTarget.col = 6;
  protectedSource.attackLimitRound = 2;
  protectedSource.attackCountsThisRound = {};
  protectedSource.brokenAlliesThisTurn = [];
  protectedSource.legendaryCards = [{ ...structuredClone(rules.legends.legendary.find(card => card.id === 'sea-curse')), copy: 1 }];
  protectedTarget.legendaryCards = [];
  protectedTarget.legendaryEffects = {
    seaCurses: [],
    shipVeil: { remaining: 3, sourcePlayerId: targetId, ignoreTurnNo: null },
  };
  writeDb(protectedDb);

  await start();
  const protectedSourceSocket = await connect();
  const protectedTargetSocket = await connect();
  assert.equal((await emit(protectedSourceSocket, 'resumeRoom', { code: created.code, accountToken: sourceAccount.token })).ok, true);
  assert.equal((await emit(protectedTargetSocket, 'resumeRoom', { code: created.code, accountToken: targetAccount.token })).ok, true);

  changed = await change(protectedSourceSocket, 'playLegendary', {
    source: 'legendary', index: 0, targetPlayerId: targetId,
  }, protectedTargetSocket);
  assert.equal(changed.result.canceled, true);
  assert.equal(changed.result.protected, true);
  state = changed.state;
  const protectedSourceView = state.players.find(player => player.id === sourceId);
  const protectedTargetView = state.players.find(player => player.id === targetId);
  assert.equal(protectedSourceView.actionsLeft, rules.session.actionsPerTurn - 1);
  assert.equal(protectedSourceView.legendaryCardCount, 0);
  assert.equal(Object.hasOwn(state.eventDecks,'legendary'), false);
  assert.equal(state.pendingLegendaryReaction, null);
  assert.equal(protectedTargetView.legendaryStatus.shipVeilTurns, 3);
  assert.equal(protectedTargetView.legendaryStatus.seaCursePenalty, 0);
  assert.equal(state.log.some(entry => entry.text.includes('действующий «Покров моря» отменяет эффект') && entry.text.includes('Карта и действие потрачены')), true);

  // 6.6: легендарный остров открывается первым посещением, без военного захвата.
  await stop();
  protectedSourceSocket.disconnect();
  protectedTargetSocket.disconnect();
  const visitDb = readDb();
  const visitRoom = visitDb.game_rooms[0].state;
  const visitSource = visitRoom.players.find(player => player.id === sourceId);
  const atlantia = visitRoom.islands.find(island => island.id === 'atlantia');
  visitRoom.round = 2;
  visitRoom.circle = 3;
  visitRoom.turnIndex = visitRoom.order.indexOf(sourceId);
  visitRoom.phase = 'navigation';
  visitRoom.roll = null;
  visitRoom.movePoints = null;
  visitRoom.eventPhase = null;
  visitRoom.pendingEvent = null;
  visitRoom.pendingFeud = null;
  visitRoom.pendingAssignmentChoice = null;
  visitRoom.pendingIslandCorrection = null;
  visitRoom.pendingFleetAdjustment = null;
  visitRoom.pendingLegendaryReaction = null;
  visitRoom.pendingBattle = null;
  visitRoom.pendingAlliance = null;
  visitRoom.legendaryPlacesExplored ||= {};
  delete visitRoom.legendaryPlacesExplored.atlantia;
  visitSource.row = atlantia.cells[0][0];
  visitSource.col = atlantia.cells[0][1];
  visitSource.namedPlaceCards = [];
  visitSource.legendaryCards = [];
  visitSource.activeExpedition = null;
  writeDb(visitDb);

  await start();
  const visitSourceSocket = await connect();
  assert.equal((await emit(visitSourceSocket, 'resumeRoom', { code: created.code, accountToken: sourceAccount.token })).ok, true);
  changed = await change(visitSourceSocket, 'skipNavigation', {});
  state = changed.state;
  const visitSourceView = state.players.find(player => player.id === sourceId);
  assert.equal(state.legendaryPlaces.find(place => place.id === 'atlantia').exploredBy, sourceId);
  assert.equal(visitSourceView.namedPlaceCards.some(card => card.id === 'place-atlantia'), true);
  assert.equal(visitSourceView.legendaryCardCount, 1);
  assert.equal(state.islands.find(island => island.id === 'atlantia').ownerId, null);
  assert.equal(state.log.some(entry => entry.text.includes('первым открывает легендарный остров «Атлантия»') && entry.text.includes('случайная легендарная карта')), true);
});
