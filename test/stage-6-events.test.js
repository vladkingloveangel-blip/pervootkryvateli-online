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

test('stage 6.1: Observatory resolves one sailing card before feud, Embassy assignment and ordinary turn', { timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pervo-stage6-'));
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
        AUTH_SECRET: 'stage-6-1-test-secret',
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
    return (await next)[0];
  }

  const saveRows = value => fs.writeFileSync(file, JSON.stringify(value));

  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await start();
  const accounts = [];
  for (let i = 0; i < 4; i++) {
    accounts.push(await api('/api/auth/register', { username: `stage6p${i + 1}`, password: 'password1' }));
  }
  const initialSockets = await Promise.all(Array.from({ length: 4 }, () => connect()));
  const created = await emit(initialSockets[0], 'createRoom', { accountToken: accounts[0].token, name: 'One' });
  const ids = [created.playerId];
  for (let i = 1; i < 4; i++) {
    ids.push((await emit(initialSockets[i], 'joinRoom', { code: created.code, accountToken: accounts[i].token, name: `Player ${i + 1}` })).playerId);
  }
  await change(initialSockets[0], 'setLeader', { playerId: ids[0] });
  for (let i = 0; i < 4; i++) await change(initialSockets[i], 'setReady', { ready: true });
  await change(initialSockets[0], 'startGame');
  await stop();
  initialSockets.forEach(socket => socket.disconnect());

  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const room = db.game_rooms[0].state;
  const targetId = room.order[0];
  const priorId = room.order[room.order.length - 1];
  const targetIndex = room.players.findIndex(player => player.id === targetId);
  const priorIndex = room.players.findIndex(player => player.id === priorId);
  const targetAccount = accounts[ids.indexOf(targetId)];
  const priorAccount = accounts[ids.indexOf(priorId)];
  const target = room.players[targetIndex];

  room.round = 1;
  room.circle = 5;
  room.turnIndex = room.order.length - 1;
  room.completedTurns = room.order.length * 5 - 1;
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
  room.players[priorIndex].activeTurnEffects = {};

  target.enemyFactionIds = ['kadingir'];
  target.suzerainId = 'lionia';
  target.activeAssignment = null;
  target.activeTurnEffects = {};
  target.nextTurnEffects = {};
  target.skipTurns = 0;
  target.ducats = 15;

  const bogamia = room.islands.find(island => island.id === 'bogamia');
  const renaika = room.islands.find(island => island.id === 'renaika');
  bogamia.ownerId = targetId;
  bogamia.buildings = [{ type: 'farm', level: 1 }, { type: 'observatory', level: 1 }, { type: 'embassy', level: 1 }];
  renaika.ownerId = targetId;
  renaika.buildings = [{ type: 'farm', level: 1 }, { type: 'observatory', level: 1 }];

  room.eventDeck = {
    drawPile: [
      { id: 'stage6-first', name: 'Первое событие', type: 'turn-effect', effect: 'moveBonus', value: 1, timing: 'current-personal-turn', copy: 1 },
      { id: 'stage6-second', name: 'Второе событие', type: 'turn-effect', effect: 'moveBonus', value: 2, timing: 'current-personal-turn', copy: 1 },
    ],
    discard: [],
  };
  room.feudDecks.kadingir = {
    drawPile: [{ id: 'stage6-feud-none', name: 'Нет события', type: 'none', copy: 1 }],
    discard: [],
  };
  const assignmentIds = ['lionia-ship-level', 'lionia-yellow-a'];
  room.assignmentDecks.lionia = {
    drawPile: assignmentIds.map(id => structuredClone(rules.politics.assignments.lionia.find(card => card.id === id))),
    discard: [],
    removed: [],
  };
  saveRows(db);

  await start();
  const targetSocket = await connect();
  const priorSocket = await connect();
  assert.equal((await emit(targetSocket, 'resumeRoom', { code: created.code, accountToken: targetAccount.token })).ok, true);
  assert.equal((await emit(priorSocket, 'resumeRoom', { code: created.code, accountToken: priorAccount.token })).ok, true);

  let state = await change(priorSocket, 'endTurn', {}, targetSocket);
  assert.deepEqual([state.round, state.circle], [1, 6]);
  assert.equal(state.eventPhase.stage, 'sailing');
  assert.equal(state.eventPhase.currentPlayerId, targetId);
  assert.equal(state.eventPhase.observatoryReplacementsUsed, 0);
  assert.equal(state.pendingEvent.kind, 'observatory');
  assert.equal(state.pendingEvent.cardName, 'Первое событие');
  assert.equal(state.pendingEvent.options.length, 2);

  state = await change(targetSocket, 'respondEvent', { eventId: state.pendingEvent.id, choice: 'replace' });
  const targetView = state.players.find(player => player.id === targetId);
  assert.equal(Object.hasOwn(state,'pendingEvent'), false);
  assert.equal(state.eventPhase.stage, 'assignment');
  assert.equal(state.eventPhase.observatoryReplacementsUsed, 1);
  assert.equal(targetView.activeTurnEffects.moveBonus, 2); // first (+1) was not applied; mandatory second (+2) was.
  for(const key of ['eventDecks','feudDecks','assignmentDecks']) assert.equal(Object.hasOwn(state,key),false,key);
  const persistedAfterEvent = JSON.parse(fs.readFileSync(file,'utf8')).game_rooms[0].state;
  assert.equal(persistedAfterEvent.eventDeck.drawPile.length, 0);
  assert.equal(persistedAfterEvent.eventDeck.discard.length, 2); // first rejected + second resolved, each returned exactly once.
  assert.equal(persistedAfterEvent.feudDecks.kadingir.discard.length, 1);
  assert.equal(state.pendingAssignmentChoice.kind, 'embassy');
  assert.equal(state.pendingAssignmentChoice.options.length, 2);

  const texts = JSON.parse(fs.readFileSync(file,'utf8')).game_rooms[0].state.log.map(entry => entry.text);
  const opened = texts.findIndex(text => text.includes('открывает «Первое событие»'));
  const replaced = texts.findIndex(text => text.includes('Обсерватория сбрасывает «Первое событие»'));
  const feud = texts.findIndex(text => text.includes('получает карту вражды') && text.includes('Кадингир'));
  const embassy = texts.findIndex(text => text.includes('Посольство даёт выбор'));
  assert.ok(opened >= 0 && replaced > opened && feud > replaced && embassy > feud);

  const choice = state.pendingAssignmentChoice.options[0];
  state = await change(targetSocket, 'respondAssignmentChoice', { choiceId: state.pendingAssignmentChoice.id, assignmentId: choice.id });
  const afterAssignment = state.players.find(player => player.id === targetId);
  assert.equal(state.eventPhase, null);
  assert.equal(Object.hasOwn(state,'pendingAssignmentChoice'), false);
  assert.equal(state.activePlayerId, targetId);
  assert.equal(afterAssignment.phase, 'navigation');
  assert.equal(afterAssignment.actionsLeft, rules.session.actionsPerTurn);
  assert.equal(afterAssignment.activeAssignment.id, choice.id);
  assert.equal(afterAssignment.activeTurnEffects.moveBonus, 2);
  const finalTexts = JSON.parse(fs.readFileSync(file,'utf8')).game_rooms[0].state.log.map(entry => entry.text);
  const embassyChosen = finalTexts.findIndex(text => text.includes('выбирает через Посольство'));
  const ordinaryTurn = finalTexts.findIndex(text => text.includes(`Ход: ${afterAssignment.name}. Навигация.`) && text.includes('попутный ветер +2'));
  assert.ok(embassyChosen >= 0 && ordinaryTurn > embassyChosen);

  await stop();
  targetSocket.disconnect();
  priorSocket.disconnect();
  const keepDb = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keepRoom = keepDb.game_rooms[0].state;
  const keepTarget = keepRoom.players.find(player => player.id === targetId);
  keepRoom.round = 2;
  keepRoom.circle = 5;
  keepRoom.turnIndex = keepRoom.order.length - 1;
  keepRoom.completedTurns = keepRoom.order.length * 11 - 1;
  keepRoom.phase = 'actions';
  keepRoom.actionsLeft = rules.session.actionsPerTurn;
  keepRoom.roll = null;
  keepRoom.movePoints = null;
  keepRoom.eventPhase = null;
  keepRoom.pendingEvent = null;
  keepRoom.pendingFeud = null;
  keepRoom.pendingAssignmentChoice = null;
  keepRoom.pendingIslandCorrection = null;
  keepRoom.pendingFleetAdjustment = null;
  keepRoom.pendingLegendaryReaction = null;
  keepTarget.enemyFactionIds = [];
  keepTarget.suzerainId = null;
  keepTarget.activeAssignment = null;
  keepTarget.activeTurnEffects = {};
  keepTarget.nextTurnEffects = {};
  keepTarget.skipTurns = 0;
  keepRoom.eventDeck = {
    drawPile: [
      { id: 'stage6-keep-first', name: 'Оставленное событие', type: 'turn-effect', effect: 'moveBonus', value: 1, timing: 'current-personal-turn', copy: 1 },
      { id: 'stage6-keep-second', name: 'Не взятое событие', type: 'turn-effect', effect: 'moveBonus', value: 2, timing: 'current-personal-turn', copy: 1 },
    ],
    discard: [],
  };
  saveRows(keepDb);

  await start();
  const keepTargetSocket = await connect();
  const keepPriorSocket = await connect();
  assert.equal((await emit(keepTargetSocket, 'resumeRoom', { code: created.code, accountToken: targetAccount.token })).ok, true);
  assert.equal((await emit(keepPriorSocket, 'resumeRoom', { code: created.code, accountToken: priorAccount.token })).ok, true);
  state = await change(keepPriorSocket, 'endTurn', {}, keepTargetSocket);
  assert.equal(state.pendingEvent.kind, 'observatory');
  assert.equal(state.pendingEvent.cardName, 'Оставленное событие');
  state = await change(keepTargetSocket, 'respondEvent', { eventId: state.pendingEvent.id, choice: 'keep' });
  const keptTarget = state.players.find(player => player.id === targetId);
  assert.equal(state.eventPhase, null);
  assert.equal(state.activePlayerId, targetId);
  assert.equal(keptTarget.phase, 'navigation');
  assert.equal(keptTarget.activeTurnEffects.moveBonus, 1);
  assert.equal(Object.hasOwn(state,'eventDecks'), false);
  const persistedAfterKeep = JSON.parse(fs.readFileSync(file,'utf8')).game_rooms[0].state;
  assert.equal(persistedAfterKeep.eventDeck.discard.length, 1);
  assert.equal(persistedAfterKeep.eventDeck.drawPile.length, 1); // keep must not consume the second outcome.


});
