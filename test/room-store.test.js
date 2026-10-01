const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { RoomStore, roomSnapshot } = require('../room-store');
const { CURRENT_DIGITAL_MODEL_SCHEMA_VERSION, migrateRoomState } = require('../save-migrations');
const { normalizeScoutRevealGrants } = require('../scout-runtime');
const logger = { log() {}, error() {} };
const room = () => ({ code: 'ABCDE', started: true, players: [{ id: 'p1', accountId: 'a1', socketId: 'stale', connected: true, token: 'private', ducats: 42 }], islands: [{ ownerId: 'p1' }], order: ['p1'], phase: 'action', pendingBattle: { invites: [{ response: null }] }, legendaryDeck: ['secret'], round: 3 });
function pool() { const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg(); return new Pool(); }

test('unversioned rooms retain retired content, old deck copies, islands and pending decisions', async () => {
  const original = room();
  Object.assign(original.players[0], { level: 7, shipClass: 'carrack', upgrades: ['foreStengha','foreMarsel'],
    escorts: [{ id: 'landin-old', type: 'landin', special: true, cargo: { goodId: 'ore', quantity: 5 } }],
    pendingLandinEscort: true, replacedAssignmentConditions: ['ship-level'] });
  original.islands = [{ id: 'asigoriy', army: 12, area: 4, resources: ['Рудная жила'], ownerId: null, buildings: [] }];
  original.anchorDecks = { red: { drawPile: [{ id: 'abyss-armada', artillery: 23, reward: 34 }], discard: [] } };
  original.eventDeck = { drawPile: [{ id: 'old-tailwind', type: 'next-turn', effect: 'moveBonus', value: 2 }], discard: [] };
  original.treasureDeck = { drawPile: [{ id: 'full-ore-hold', cargoGoodId: 'ore' }], discard: [] };
  original.legendaryDeck = { drawPile: [{ id: 'sea-veil', copy: 2 }], discard: [] };
  original.feudDecks = { lionia: { drawPile: [{ id: 'treasury-50', type: 'treasury-percent', percent: 50 }], discard: [] } };
  original.pendingAssignmentChoice = { playerId: 'p1', id: 'old-choice' };
  const db = pool(); const store = new RoomStore(db, { logger });
  await store.init(new Map()); await store.save(original);
  const restored = new Map(); await new RoomStore(db, { logger }).init(restored);
  const saved = restored.get(original.code);
  const expectedMigrated = migrateRoomState(original).state;
  expectedMigrated.players[0].connected = false;
  expectedMigrated.players[0].socketId = null;
  assert.deepEqual(saved, expectedMigrated);
  assert.equal(saved.rulesDataVersion, undefined);
  const { shipStats, drawAnchorCard, drawSailingEventCard, drawTreasureCard, drawLegendaryCard, drawFeudCard } = require('../game-logic');
  const { SHIPS, SHIP_LEVELS, SHIP_UPGRADES } = require('../game-data');
  assert.doesNotThrow(() => shipStats(saved.players[0]));
  assert.equal(saved.players[0].level, 7);
  assert.equal(shipStats(saved.players[0]).artillery, SHIPS.carrack.artillery + SHIP_LEVELS[7].statBonus);
  assert.equal(shipStats(saved.players[0]).moveMod, SHIPS.carrack.moveMod + SHIP_LEVELS[7].moveBonus + SHIP_UPGRADES.foreStengha.movement + SHIP_UPGRADES.foreMarsel.movement);
  const playable = structuredClone(saved);
  assert.equal(drawAnchorCard(playable,'red').card.artillery,23);
  assert.equal(drawSailingEventCard(playable).id,'old-tailwind');
  assert.equal(drawTreasureCard(playable,()=>0.75).id,'full-diamonds-hold');
  assert.equal(drawLegendaryCard(playable,()=>0).id,'sea-veil');
  assert.equal(playable.legendaryDeck.drawPile.length,1); // цифровой выбор не потребляет старую физическую колоду; её удалит серверная нормализация
  assert.equal(drawFeudCard(playable,'lionia').percent,50);
  assert.equal(playable.pendingAssignmentChoice.id,'old-choice');
});

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
  const expected = migrateRoomState(original).state;
  expected.players[0].connected = false;
  expected.players[0].socketId = null;
  assert.deepEqual(restored.get('ABCDE'), expected);
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

test('roomSnapshot preserves the active Scout capability shape while clearing socket delivery fields', () => {
  const original = room();
  original.players[0].personalTurnNo = 4;
  original.scoutRevealGrants = [{ viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: 4 }];
  original.players.push({ id: 'p2', socketId: 'other-socket', connected: true, personalTurnNo: 1, ducats: 17 });
  original.order.push('p2');

  const snapshot = roomSnapshot(original);
  assert.equal(snapshot.players[0].socketId, null);
  assert.equal(snapshot.players[0].connected, false);
  assert.equal(snapshot.players[1].socketId, null);
  assert.equal(snapshot.players[1].connected, false);
  assert.deepEqual(snapshot.scoutRevealGrants, [
    { viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: 4 },
  ]);
  assert.equal(Object.hasOwn(snapshot.scoutRevealGrants[0], 'socketId'), false);
  assert.equal(Object.hasOwn(snapshot.scoutRevealGrants[0], 'ducats'), false);
  assert.equal(original.players[0].socketId, 'stale');
  assert.equal(original.players[0].connected, true);
});

test('legacy restored room without Scout grants normalizes to an empty runtime-safe capability list only', async () => {
  const db = pool();
  const store = new RoomStore(db, { logger });
  await store.init(new Map());
  const original = room();
  delete original.scoutRevealGrants;
  original.legacySentinel = { keep: true };
  await store.save(original);

  const restored = new Map();
  await new RoomStore(db, { logger }).init(restored);
  const saved = restored.get(original.code);
  assert.equal(Object.hasOwn(saved, 'scoutRevealGrants'), false);
  const result = normalizeScoutRevealGrants(saved);
  assert.equal(result.changed, true);
  assert.deepEqual(saved.scoutRevealGrants, []);
  assert.deepEqual(saved.legacySentinel, { keep: true });
  assert.equal(saved.rulesDataVersion, undefined);
  assert.equal(saved.digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
});

test('guest mode works without a database', async () => {
  const store = new RoomStore(null);
  await store.init(new Map()); await store.save(room()); await store.remove('ABCDE'); await store.flush();
});
