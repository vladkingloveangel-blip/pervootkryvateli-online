const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { io } = require('socket.io-client');

test('accounts, moves, restart recovery, private My Games, reattachment and admin observation', { timeout: 40000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pervo-rooms-'));
  const file = path.join(dir, 'database.json');
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  let output = '';
  const sockets = [];
  async function start() {
    output = '';
    child = spawn(process.execPath, ['--require', './test/fixtures/postgres.cjs', 'server.js'], {
      cwd: path.join(__dirname, '..'), windowsHide: true,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: 'postgres://test', AUTH_SECRET: 'integration-test-secret', ADMIN_USERNAME: 'testadmin', ADMIN_PASSWORD: 'testpassword', TEST_DB_FILE: file },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw Error(output);
      try { if ((await fetch(base + '/health')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Server did not start: ' + output);
  }
  async function stop() { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
  async function connect() { const socket = io(base, { transports: ['websocket'], reconnection: false }); sockets.push(socket); await once(socket, 'connect'); return socket; }
  const emit = (socket, name, data = {}) => new Promise((resolve, reject) => socket.timeout(5000).emit(name, data, (err, value) => err ? reject(err) : resolve(value)));
  async function api(route, token, body) {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { response, data: await response.json() };
  }
  const rows = () => JSON.parse(fs.readFileSync(file, 'utf8')).game_rooms;
  t.after(async () => { sockets.forEach(s => s.disconnect()); if (child?.exitCode === null) await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await start();
  const a = (await api('/api/auth/register', null, { username: 'playerone', password: 'password1' })).data;
  const b = (await api('/api/auth/register', null, { username: 'playertwo', password: 'password2' })).data;
  const stranger = (await api('/api/auth/register', null, { username: 'stranger', password: 'password3' })).data;
  const admin = (await api('/api/auth/login', null, { username: 'testadmin', password: 'testpassword' })).data;
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(admin.ok, true);
  const first = await connect(); const second = await connect(); const watcher = await connect();
  const created = await emit(first, 'createRoom', { accountToken: a.token, name: 'One' });
  assert.equal(created.ok, true); assert.equal(rows().length, 1); // ack means durable
  const code = created.code;
  assert.equal((await emit(second, 'joinRoom', { code, accountToken: b.token, name: 'Two' })).ok, true);
  assert.equal((await emit(first, 'startGame')).ok, true);
  const started = rows()[0].state;
  assert.equal(started.started, true);
  const active = started.order[0] === created.playerId ? first : second;
  assert.equal((await emit(active, 'skipNavigation')).ok, true);
  assert.equal((await emit(active, 'endTurn')).ok, true);
  const beforeRestart = rows()[0].state;
  const list = await api('/api/my-games?accountId=' + b.user.id, a.token);
  assert.equal(list.response.headers.get('cache-control'), 'no-store');
  assert.equal(list.data.rooms[0].code, code);
  assert.equal(JSON.stringify(list.data).includes('playerToken'), false);
  assert.equal(JSON.stringify(list.data).includes('legendaryDeck'), false);
  assert.equal((await api('/api/my-games', stranger.token)).data.rooms.length, 0);
  assert.equal((await api('/api/my-games')).response.status, 401);
  assert.equal((await emit(watcher, 'listMyRooms', { accountToken: stranger.token, accountId: a.user.id })).rooms.length, 0);
  assert.equal((await emit(watcher, 'adminWatchRoom', { accountToken: stranger.token, code })).ok, false);
  const watch = await emit(watcher, 'adminWatchRoom', { accountToken: admin.token, code });
  assert.equal(watch.room.adminSpectator, true); assert.equal(watch.room.players.length, 2);
  await stop(); // Abrupt restart: pending state must survive without disconnect handlers.
  await start();
  assert.match(output, /Restored 1 unfinished rooms/);
  const health = (await api('/health')).data;
  assert.equal(health.databaseReady, true); assert.equal(health.roomPersistence.restored, 1);
  const newDevice = await connect(); const restoredWatcher = await connect();
  const restored = await emit(restoredWatcher, 'adminWatchRoom', { code, accountToken: admin.token });
  assert.equal(restored.room.players.every(p => !p.connected), true);
  assert.equal((await emit(newDevice, 'resumeRoom', { code, accountToken: stranger.token, playerToken: created.playerToken })).ok, false);
  const resumed = await emit(newDevice, 'resumeRoom', { code, accountToken: a.token });
  assert.equal(resumed.ok, true); assert.equal(resumed.playerId, created.playerId);
  const afterRestart = rows()[0].state;
  assert.deepEqual(afterRestart, beforeRestart);
  const anotherDevice = await connect();
  assert.equal((await emit(anotherDevice, 'resumeRoom', { code, accountToken: a.token })).ok, true);
  assert.equal((await emit(newDevice, 'closeRoom')).ok, true); // detached socket cannot close another device's room
  assert.equal(rows().length, 1);
  assert.equal((await emit(anotherDevice, 'goHome')).ok, true);
  assert.equal((await api('/api/my-games', a.token)).data.rooms.length, 1);
  const update = once(restoredWatcher, 'adminRoomState');
  await emit(anotherDevice, 'resumeRoom', { code, accountToken: a.token }); await update;
  assert.equal((await emit(restoredWatcher, 'adminCloseRoom', { code, accountToken: admin.token })).ok, true);
  assert.equal(rows().length, 0);
  assert.equal((await api('/api/my-games', a.token)).data.rooms.length, 0);
  const lobby = await emit(anotherDevice, 'createRoom', { accountToken: a.token });
  const guest = await connect();
  const joined = await emit(guest, 'joinRoom', { code: lobby.code, accountToken: b.token });
  assert.equal((await api('/api/my-games', b.token)).data.rooms.length, 1);
  assert.equal((await emit(anotherDevice, 'kickPlayer', { playerId: joined.playerId })).ok, true);
  assert.equal((await api('/api/my-games', b.token)).data.rooms.length, 0);
  await emit(guest, 'joinRoom', { code: lobby.code, accountToken: b.token });
  assert.equal((await emit(guest, 'leaveRoom')).ok, true);
  assert.equal((await api('/api/my-games', b.token)).data.rooms.length, 0);
  assert.equal((await emit(anotherDevice, 'closeRoom')).ok, true);
  assert.equal(rows().length, 0);
  await stop(); await start();
  assert.equal((await api('/health')).data.rooms, 0);
});
