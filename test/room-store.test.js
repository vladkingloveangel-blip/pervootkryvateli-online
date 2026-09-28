const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { RoomStore } = require('../room-store');
const logger = { log() {}, error() {} };
const room = () => ({ code: 'ABCDE', started: true, players: [{ id: 'p1', accountId: 'a1', socketId: 'stale', connected: true, token: 'private', ducats: 42 }], islands: [{ ownerId: 'p1' }], order: ['p1'], phase: 'action', pendingBattle: { invites: [{ response: null }] }, legendaryDeck: ['secret'], round: 3 });
function pool() { const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg(); return new Pool(); }

test('JSONB round trip preserves full state, clears connections and skips finished games', async () => {
  const db = pool();
  const store = new RoomStore(db, { logger });
  await store.init(new Map());
  const original = room();
  await store.save(original);
  assert.equal(original.players[0].connected, true);
  await db.query('INSERT INTO game_rooms (code, state) VALUES ($1,$2::jsonb)', ['DONE', JSON.stringify({ ...room(), code: 'DONE', finished: true })]);
  const restored = new Map();
  await new RoomStore(db, { logger }).init(restored);
  assert.equal(restored.size, 1);
  assert.deepEqual(restored.get('ABCDE'), { ...original, players: [{ ...original.players[0], connected: false, socketId: null }] });
  await store.remove('ABCDE');
  assert.equal((await db.query('SELECT * FROM game_rooms WHERE code = $1', ['ABCDE'])).rowCount, 0);
});

test('in-flight saves cannot resurrect closed rooms; later snapshots are captured immediately', async () => {
  const db = pool();
  const store = new RoomStore(db, { logger });
  await store.init(new Map());
  const query = db.query.bind(db);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  db.query = async (...args) => { if (args[0].startsWith('INSERT')) await gate; return query(...args); };
  const first = store.save(room());
  const changed = room(); changed.round = 9;
  store.save(changed);
  changed.round = 999;
  release(); await first;
  assert.equal((await query('SELECT state FROM game_rooms')).rows[0].state.round, 9);
  await Promise.all([store.save(room()), store.remove('ABCDE')]);
  assert.equal((await query('SELECT * FROM game_rooms')).rowCount, 0);
});

test('failed writes retry and a pending deletion supersedes a failed snapshot', async () => {
  const db = pool();
  const store = new RoomStore(db, { logger, retryMs: 1 });
  await store.init(new Map());
  const query = db.query.bind(db);
  let fail = true;
  db.query = async (...args) => { if (fail) { fail = false; throw Error('Temporary outage'); } return query(...args); };
  const saving = store.save(room());
  await new Promise(resolve => setImmediate(resolve));
  store.remove('ABCDE');
  await saving;
  assert.equal(store.lastError, null);
  assert.equal((await query('SELECT * FROM game_rooms')).rowCount, 0);
});

test('invalid snapshots stop restoration instead of silently dropping games', async () => {
  const db = pool();
  const store = new RoomStore(db, { logger });
  await store.init(new Map());
  await db.query('INSERT INTO game_rooms (code, state) VALUES ($1,$2::jsonb)', ['BROKE', '{}']);
  await assert.rejects(store.init(new Map()), /Invalid saved room/);
});

test('guest mode works without a database', async () => {
  const store = new RoomStore(null);
  await store.init(new Map()); await store.save(room()); await store.remove('ABCDE'); await store.flush();
});
