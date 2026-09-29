const { BALANCE, RULESET, RUNTIME_PROFILE } = require('./game-data');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const { RoomStore, isUnfinished } = require('./room-store');
const { MAP_META, CITADEL, HAZARDS, SHIPS, SHIP_LEVELS, SHIP_UPGRADES, ESCORTS, COLORS, BUILDINGS, CHARACTERS, GOODS, CITADEL_CELLS, ANCHORS, FACTIONS, POLITICAL_FACTION_ORDER, ASSIGNMENT_CARDS, FEUD_CARDS, LEGENDARY_PLACES, LEGENDARY_PLACE_RULES, NAMED_PLACE_CARDS } = require('./game-data');
const {
  cloneIslands,
  reachableCells,
  mistPathReachableCells,
  isShipProtected,
  isIslandProtected,
  applySeaVeilToShip,
  applySeaVeilToIsland,
  applySeaVeilHostileReactionToShip,
  applySeaVeilHostileReactionToIsland,
  clearSeaVeilHostileReactionsAtTurnEnd,
  applySeaCurse,
  legendaryMovementPenalty,
  tickLegendaryEffectsForPlayer,
  applyHellfire,
  build,
  upgradeBuilding,
  buildingDisplayName,
  islandConstraintReport,
  islandCorrectionOptions,
  removeIslandBuildingForCorrection,
  capturedBuildingRetentionOptions,
  removeCapturedBuildingForRetention,
  finalizeCapturedBuildingRetention,
  normalizeIslandGarrison,
  stoneworksSupportCapacity,
  bastionSupportSummary,
  bastionSupportChoiceNeeds,
  setInactiveBastions,
  buildBastion,
  buyCityGuard,
  buyPermanentGarrison,
  formLandCompany,
  canDismissLandCompany,
  dismissLandCompany,
  marketIncomeForPlayer,
  hasOwnedBuilding,
  lighthouseDepartureBonus,
  bestAdmiraltyLevelAtPlayer,
  characterOptionsAtAdmiralty,
  takeCharacter,
  replaceCharacter,
  consumeCharacter,
  cartographerAnchorOptions,
  claimFreeIslandsAt,
  publicIsland,
  shipStats,
  readableShipLevel,
  shipUpgradeSlotLimit,
  shipUpgradeStatuses,
  fleetAdjustmentNeeds,
  setDisabledUpgrades,
  setLevelInactiveEscorts,
  buyShipLevel,
  buyShipUpgrade,
  removeShipUpgrade,
  shipyardSlotsForPlayer,
  ordinaryEscortExcess,
  removeEscortsForShipyard,
  replaceEscortWithLandin,
  escortUseLimit,
  escortPurchasePrice,
  escortStatuses,
  buyEscort,
  loadCargo,
  sellCargo,
  cargoSaleValue,
  contractBonusForRevenue,
  isCitadelCell,
  isCitadelPeaceCell,
  seaAttackPositionAllowed,
  attackTargetsThisRound,
  canAttackPlayerThisRound,
  registerPlayerAttack,
  fleetArtillery,
  islandDefenseArmy,
  loseShipLevel,
  areAllies,
  alliancePartnerId,
  addAlliance,
  removeAlliance,
  playerOnIsland,
  jointSeaBattle,
  seaBattle,
  jointAssaultIsland,
  assaultIsland,
  createAnchorDecks,
  resolveAnchorEncounter,
  creditDucats,
  createSailingEventDeck,
  drawSailingEventCard,
  createTreasureDeck,
  drawTreasureCard,
  createExpeditionDeck,
  createFeudDecks,
  drawFeudCard,
  createAssignmentDecks,
  normalizeAssignmentCompatibility,
  issueAssignment,
  offerAssignmentCards,
  chooseAssignmentOffer,
  assignmentEventMatches,
  assignmentRequiredAction,
  noteMoriAssignmentDeparture,
  advanceMoriAssignmentNavigation,
  completeAssignment,
  settleVassalTax,
  legendaryPlaceAt,
  legendaryPlaceRule,
  legendaryPlaceForIsland,
  claimLegendaryPlaceDiscovery,
  canTakeExpedition,
  takeExpedition,
  completeExpeditionAtArrival,
  factionIdForIsland,
  stateExists,
  refreshFactionExistence,
  addEnmity,
  canEnterVassalage,
  enterVassalage,
  rebelFromSuzerain,
  politicalBuildingOptions,
  removePlayerBuilding,
  politicalUpgradeOptions,
  politicalCargoOptions,
  discardRandomHeldCard,
  drawLegendaryCard,
  discardDeckCard,
  emptyCargoHolds,
  fillCargoDirect,
  resolveMoneyTreasure,
  installShipUpgradeFree,
  buildFree,
  raidBuildingOptions,
  applyRaidDowngrade,
  applyFeudBuildingDowngrade,
  boardingUpgradeOptions,
  applyBoardingLoss,
  stormCellOptions,
} = require('./game-logic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const rooms = new Map();

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const AUTH_SECRET = String(process.env.AUTH_SECRET || '').trim() || crypto.randomBytes(48).toString('hex');
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || '').trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const db = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : undefined,
}) : null;
const roomStore = new RoomStore(db);
let shuttingDown = false;
let eventWrites = null;
let dbReady = false;
let dbInitError = null;

function normalizeUsername(value) {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}
function validUsername(value) {
  const s = String(value || '').trim();
  return /^[\p{L}\p{N}_-]{3,24}$/u.test(s);
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return ['scrypt', salt, hash].join('$');
}
function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    const kind = parts[0];
    const salt = parts[1];
    const expectedHex = parts[2];
    if (kind !== 'scrypt' || !salt || !expectedHex) return false;
    const actual = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
function signAccountToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    displayName: user.display_name || user.displayName || user.username,
    role: user.role || 'player',
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyAccountToken(tokenValue) {
  try {
    const parts = String(tokenValue || '').split('.');
    const body = parts[0];
    const sig = parts[1];
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest();
    const actual = Buffer.from(sig, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.sub || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
function bearerToken(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
function socketAccount(data) {
  return verifyAccountToken(data && data.accountToken);
}
function requireSocketAccount(data, ack) {
  if (!db) return null;
  const user = socketAccount(data);
  if (!user) ackSafe(ack, { ok: false, error: 'Войдите в аккаунт.' });
  return user;
}
function requireAdminAccount(data, ack) {
  const user = socketAccount(data);
  if (!user || user.role !== 'admin') {
    ackSafe(ack, { ok: false, error: 'Нужны права администратора.' });
    return null;
  }
  return user;
}
async function initDatabase() {
  if (!db) return;
  await db.query('CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'player\', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login_at TIMESTAMPTZ)');
  if (ADMIN_USERNAME && ADMIN_PASSWORD) {
    const username = normalizeUsername(ADMIN_USERNAME);
    const existing = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (!existing.rowCount) {
      await db.query(
        'INSERT INTO users (id, username, display_name, password_hash, role) VALUES ($1,$2,$3,$4,$5)',
        [crypto.randomUUID(), username, ADMIN_USERNAME, hashPassword(ADMIN_PASSWORD), 'admin']
      );
    } else {
      await db.query('UPDATE users SET role = $2 WHERE username = $1', [username, 'admin']);
    }
  }
  await roomStore.init(rooms);
  for (const room of rooms.values()) {
    const compatibility = normalizeAssignmentCompatibility(room);
    if (compatibility.resumeEventPhase) processEventPhase(room);
    if (compatibility.changed || compatibility.resumeEventPhase) await roomStore.save(room);
  }
  dbReady = true;
  dbInitError = null;
  console.log('Accounts database ready.');
}
app.use(express.json({ limit: '64kb' }));

app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/auth/status', (_req, res) => {
  res.json({ accountsEnabled: Boolean(db), databaseReady: dbReady, error: dbInitError ? 'database-unavailable' : null });
});

app.post('/api/auth/register', async (req, res) => {
  if (!db || !dbReady) return res.status(503).json({ ok: false, error: 'База аккаунтов ещё не подключена.' });
  const rawUsername = String(req.body?.username || '').trim();
  const username = normalizeUsername(rawUsername);
  const password = String(req.body?.password || '');
  const displayName = cleanName(req.body?.displayName || rawUsername);
  if (!validUsername(rawUsername)) return res.status(400).json({ ok: false, error: 'Логин: 3–24 символа, буквы, цифры, _ или -.' });
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'Пароль должен быть не короче 6 символов.' });
  try {
    const user = {
      id: crypto.randomUUID(),
      username,
      display_name: displayName,
      role: 'player',
    };
    await db.query(
      'INSERT INTO users (id, username, display_name, password_hash, role) VALUES ($1,$2,$3,$4,$5)',
      [user.id, user.username, user.display_name, hashPassword(password), user.role]
    );
    return res.json({ ok: true, token: signAccountToken(user), user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } });
  } catch (err) {
    if (err?.code === '23505') return res.status(409).json({ ok: false, error: 'Такой логин уже занят.' });
    console.error('Register error:', err);
    return res.status(500).json({ ok: false, error: 'Не удалось создать аккаунт.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!db || !dbReady) return res.status(503).json({ ok: false, error: 'База аккаунтов ещё не подключена.' });
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  try {
    const result = await db.query('SELECT id, username, display_name, password_hash, role FROM users WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ ok: false, error: 'Неверный логин или пароль.' });
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    return res.json({ ok: true, token: signAccountToken(user), user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ ok: false, error: 'Не удалось войти.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const auth = verifyAccountToken(bearerToken(req));
  if (!auth) return res.status(401).json({ ok: false, error: 'Сессия истекла.' });
  if (!db || !dbReady) return res.json({ ok: true, user: { id: auth.sub, username: auth.username, displayName: auth.displayName, role: auth.role } });
  try {
    const result = await db.query('SELECT id, username, display_name, role FROM users WHERE id = $1', [auth.sub]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ ok: false, error: 'Аккаунт не найден.' });
    return res.json({ ok: true, user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } });
  } catch (err) {
    console.error('Account read error:', err);
    return res.status(500).json({ ok: false, error: 'Не удалось загрузить профиль.' });
  }
});

app.post('/api/auth/profile', async (req, res) => {
  if (!db || !dbReady) return res.status(503).json({ ok: false, error: 'База аккаунтов недоступна.' });
  const auth = verifyAccountToken(bearerToken(req));
  if (!auth) return res.status(401).json({ ok: false, error: 'Сессия истекла.' });
  const rawName = String(req.body?.displayName || '').trim().replace(/\s+/g, ' ');
  if (rawName.length < 2 || rawName.length > 24) return res.status(400).json({ ok: false, error: 'Имя должно содержать от 2 до 24 символов.' });
  try {
    const result = await db.query(
      'UPDATE users SET display_name = $2 WHERE id = $1 RETURNING id, username, display_name, role',
      [auth.sub, rawName]
    );
    const user = result.rows[0];
    if (!user) return res.status(404).json({ ok: false, error: 'Аккаунт не найден.' });
    const token = signAccountToken(user);
    return res.json({ ok: true, token, user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } });
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ ok: false, error: 'Не удалось сохранить профиль.' });
  }
});

app.post('/api/auth/change-password', async (req, res) => {
  if (!db || !dbReady) return res.status(503).json({ ok: false, error: 'База аккаунтов недоступна.' });
  const auth = verifyAccountToken(bearerToken(req));
  if (!auth) return res.status(401).json({ ok: false, error: 'Сессия истекла.' });
  const oldPassword = String(req.body?.oldPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 6) return res.status(400).json({ ok: false, error: 'Новый пароль должен быть не короче 6 символов.' });
  const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [auth.sub]);
  if (!result.rowCount || !verifyPassword(oldPassword, result.rows[0].password_hash)) return res.status(401).json({ ok: false, error: 'Текущий пароль неверен.' });
  await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [auth.sub, hashPassword(newPassword)]);
  return res.json({ ok: true });
});

function myRooms(accountId) {
  return [...rooms.values()]
    .filter(room => isUnfinished(room) && room.players.some(p => p.accountId === accountId))
    .map(room => ({
      code: room.code, started: Boolean(room.started), round: room.round, circle: room.circle,
      playerCount: room.players.length, activePlayerName: currentPlayer(room)?.name || null,
      isYourTurn: currentPlayer(room)?.accountId === accountId,
      players: room.players.map(p => ({ name: p.name, connected: Boolean(p.connected) })),
    }));
}

app.get('/api/my-games', (req, res) => {
  const auth = verifyAccountToken(bearerToken(req));
  if (!auth) return res.status(401).json({ ok: false, error: 'Войдите в аккаунт.' });
  res.json({ ok: true, rooms: myRooms(auth.sub) });
});

function persistRoom(operation) {
  if (eventWrites) eventWrites.push(operation);
}

// Existing game handlers remain synchronous. Send acknowledgements only after
// their snapshots/deletions reach Postgres, including handlers that ack first.
function onSocketEvent(socket, event, handler) {
  socket.on(event, (...args) => {
    const ack = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    if (event !== 'disconnect' && (shuttingDown || roomStore.lastError)) {
      return ackSafe(ack, { ok: false, error: 'Сохранение игры временно недоступно. Повторите позже.' });
    }
    const priorityError = assignmentPriorityError(socket, event, args[0]);
    if (priorityError) return ackSafe(ack, { ok: false, error: priorityError });
    const writes = [];
    const responses = [];
    eventWrites = writes;
    try {
      handler(...args, payload => responses.push(payload));
    } finally {
      eventWrites = null;
    }
    Promise.all(writes).then(() => responses.forEach(payload => ackSafe(ack, payload)));
  });
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(4).toString('hex').slice(0, 5).toUpperCase();
}

function token() { return crypto.randomBytes(18).toString('base64url'); }
function cleanName(name) {
  const s = String(name || '').trim().replace(/\s+/g, ' ');
  return s.slice(0, 24) || 'Мореплаватель';
}
function getRoom(code) { return rooms.get(String(code || '').trim().toUpperCase()); }
function rollD6() { return 1 + Math.floor(Math.random() * BALANCE.session.dieSides); }
function ackSafe(ack, payload) { if (typeof ack === 'function') ack(payload); }
const ROMAN_SERVER = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function currentPlayer(room) {
  if (!room?.started || !room.order.length) return null;
  return room.players.find(p => p.id === room.order[room.turnIndex]) || null;
}

function ownerIslandCount(room, playerId) {
  return room.islands.filter(i => i.ownerId === playerId).length;
}

function publicRoom(room, viewerId = null) {
  const active = room.phase === 'event' ? null : currentPlayer(room);
  const viewerIsActive = active && active.id === viewerId;
  const reachable = viewerIsActive && room.phase === 'navigation' && room.roll !== null
    ? reachableCells(active, room.movePoints)
    : [];
  const mistReachable = viewerIsActive && room.phase === 'actions' && (Number(room.actionsLeft) || 0) > 0 && playerHasLegendaryKind(active, 'mist-path')
    ? mistPathReachableCells(active)
    : [];

  return {
    version: '0.33.0',
    code: room.code,
    started: room.started,
    hostId: room.hostId,
    leaderId: room.leaderId || null,
    seatingOrder: (room.seatingOrder || room.players.map(p => p.id)).filter(id => room.players.some(p => p.id === id)),
    round: room.round,
    circle: room.circle,
    turnIndex: room.turnIndex,
    activePlayerId: active?.id || null,
    eventPhase: room.eventPhase ? {
      active: Boolean(room.eventPhase.active),
      personalTurn: Boolean(room.eventPhase.personalTurn),
      currentPlayerId: room.eventPhase.currentPlayerId || null,
      playerIndex: Number(room.eventPhase.playerIndex) || 0,
      totalPlayers: room.eventPhase.personalTurn ? 1 : room.order.length,
      stage: room.eventPhase.stage || 'sailing',
      observatoryReplacementsUsed: Math.max(0, Number(room.eventPhase.observatoryReplacementsUsed) || 0),
      feudIndex: Number(room.eventPhase.feudIndex) || 0,
      feudTotal: room.eventPhase.feudQueue?.length || 0,
      assignmentIndex: Number(room.eventPhase.assignmentIndex) || 0,
      assignmentTotal: room.eventPhase.assignmentQueue?.length || 0,
      replacementIndex: Number(room.eventPhase.replacementIndex) || 0,
      replacementTotal: room.eventPhase.replacementQueue?.length || 0,
      lastCard: room.eventPhase.lastCard ? { ...room.eventPhase.lastCard } : null,
    } : null,
    pendingEvent: room.pendingEvent ? {
      id: room.pendingEvent.id,
      playerId: room.pendingEvent.playerId,
      kind: room.pendingEvent.kind,
      cardName: room.pendingEvent.cardName,
      viewerCanRespond: room.pendingEvent.playerId === viewerId,
      options: room.pendingEvent.playerId === viewerId ? (room.pendingEvent.options || []).map(o => ({ ...o })) : [],
      goodId: room.pendingEvent.playerId === viewerId ? (room.pendingEvent.goodId || null) : null,
      islandId: room.pendingEvent.playerId === viewerId ? (room.pendingEvent.islandId || null) : null,
    } : null,
    pendingFeud: room.pendingFeud ? {
      id: room.pendingFeud.id,
      playerId: room.pendingFeud.playerId,
      factionId: room.pendingFeud.factionId,
      factionName: FACTIONS[room.pendingFeud.factionId]?.name || room.pendingFeud.factionId,
      cardName: room.pendingFeud.cardName,
      kind: room.pendingFeud.kind,
      remaining: Number(room.pendingFeud.remaining) || 0,
      viewerCanRespond: room.pendingFeud.playerId === viewerId,
      options: room.pendingFeud.playerId === viewerId ? (room.pendingFeud.options || []).map(o => ({ ...o })) : [],
    } : null,
    pendingAssignmentChoice: room.pendingAssignmentChoice?.kind === 'embassy' ? {
      id: room.pendingAssignmentChoice.id,
      kind: 'embassy',
      playerId: room.pendingAssignmentChoice.playerId,
      factionId: room.pendingAssignmentChoice.factionId,
      factionName: FACTIONS[room.pendingAssignmentChoice.factionId]?.name || room.pendingAssignmentChoice.factionId,
      options: room.pendingAssignmentChoice.playerId === viewerId ? (room.pendingAssignmentChoice.options || []).map(card => ({
        id: card.id, text: card.text, reward: Number(card.reward) || 0, type: card.type,
      })) : [],
      viewerCanRespond: room.pendingAssignmentChoice.playerId === viewerId,
    } : null,
    pendingIslandCorrection: room.pendingIslandCorrection ? {
      id: room.pendingIslandCorrection.id,
      kind: room.pendingIslandCorrection.kind || 'constraints',
      playerId: room.pendingIslandCorrection.playerId,
      islandId: room.pendingIslandCorrection.islandId,
      islandName: room.pendingIslandCorrection.islandName,
      reason: room.pendingIslandCorrection.reason || 'После потери статуса остров нужно привести к допустимым ограничениям.',
      report: room.pendingIslandCorrection.report ? {
        ...room.pendingIslandCorrection.report,
        branchViolations: (room.pendingIslandCorrection.report.branchViolations || []).map(v => ({ ...v })),
      } : null,
      initialBuildingCount: Number(room.pendingIslandCorrection.initialBuildingCount) || 0,
      keepCount: Number(room.pendingIslandCorrection.keepCount) || 0,
      remainingRemovals: Number(room.pendingIslandCorrection.remainingRemovals) || 0,
      viewerCanRespond: room.pendingIslandCorrection.playerId === viewerId,
      options: room.pendingIslandCorrection.playerId === viewerId ? (room.pendingIslandCorrection.options || []).map(o => ({ ...o })) : [],
      removed: room.pendingIslandCorrection.playerId === viewerId ? [...(room.pendingIslandCorrection.removed || [])] : [],
    } : null,
    pendingFleetAdjustment: room.pendingFleetAdjustment ? {
      id: room.pendingFleetAdjustment.id,
      playerId: room.pendingFleetAdjustment.playerId,
      stage: room.pendingFleetAdjustment.stage,
      reason: room.pendingFleetAdjustment.reason || 'Требуется обязательное решение по составу флотилии.',
      required: Number(room.pendingFleetAdjustment.required) || 0,
      viewerCanRespond: room.pendingFleetAdjustment.playerId === viewerId,
      options: room.pendingFleetAdjustment.playerId === viewerId ? (room.pendingFleetAdjustment.options || []).map(o => ({ ...o })) : [],
    } : null,
    pendingLegendaryReaction: room.pendingLegendaryReaction ? {
      id: room.pendingLegendaryReaction.id,
      kind: room.pendingLegendaryReaction.kind,
      sourcePlayerId: room.pendingLegendaryReaction.sourcePlayerId,
      targetPlayerId: room.pendingLegendaryReaction.targetPlayerId || null,
      islandId: room.pendingLegendaryReaction.islandId || null,
      viewerCanRespond: room.pendingLegendaryReaction.targetPlayerId === viewerId,
      veilOptions: room.pendingLegendaryReaction.targetPlayerId === viewerId ? legendaryCardRefs(playerById(room, viewerId), 'sea-veil') : [],
    } : null,
    eventDecks: {
      sailing: { remaining: room.eventDeck?.drawPile?.length || 0, discard: room.eventDeck?.discard?.length || 0 },
      treasure: { remaining: room.treasureDeck?.drawPile?.length || 0, discard: room.treasureDeck?.discard?.length || 0 },
      expeditions: { remaining: room.expeditionDeck?.drawPile?.length || 0 },
    },
    legendaryPool: {
      mode: BALANCE.legendaryPool?.mode || 'random-with-replacement',
      selection: BALANCE.legendaryPool?.selection || 'uniform',
      typeIds: [...(BALANCE.legendaryPool?.typeIds || [])],
    },
    factions: POLITICAL_FACTION_ORDER.map(factionId => {
      const f = FACTIONS[factionId];
      const vassal = room.players.find(p => p.suzerainId === factionId);
      const gift = f.giftIslandId ? room.islands.find(i => i.id === f.giftIslandId) : null;
      const viewer = room.players.find(p => p.id === viewerId);
      const canJoin = viewer && room.started && active?.id === viewerId && room.phase === 'actions' && (Number(room.actionsLeft) || 0) > 0
        ? canEnterVassalage(room, viewer, factionId)
        : { ok: false };
      return {
        id: factionId, name: f.name, exists: stateExists(room, factionId), canHaveVassal: Boolean(f.canHaveVassal),
        giftIslandId: f.giftIslandId || null, giftIslandName: gift?.name || null, vassalPlayerId: vassal?.id || null,
        tax: Number(f.tax) || 0, rewardShare: Number(f.rewardShare) || 0, canJoin: Boolean(canJoin.ok),
        fullConquestPrize: f.fullConquestPrize ? {
          ducats: f.fullConquestPrize.amountUnresolved ? null : Math.max(0, Number(f.fullConquestPrize.ducats) || 0),
          amountUnresolved: Boolean(f.fullConquestPrize.amountUnresolved),
          trigger: f.fullConquestPrize.trigger || null,
        } : null,
        fullConquestClaimed: Boolean(room.factionState?.[factionId]?.fullConquestClaimed),
        fullConquestPlayerId: room.factionState?.[factionId]?.fullConquestPlayerId || null,
        ceasedRound: room.factionState?.[factionId]?.ceasedRound || null,
      };
    }),
    feudDecks: Object.fromEntries(POLITICAL_FACTION_ORDER.map(id => [id, { remaining: room.feudDecks?.[id]?.drawPile?.length || 0, discard: room.feudDecks?.[id]?.discard?.length || 0 }])),
    assignmentDecks: Object.fromEntries(Object.keys(ASSIGNMENT_CARDS).map(id => [id, { remaining: room.assignmentDecks?.[id]?.drawPile?.length || 0, discard: room.assignmentDecks?.[id]?.discard?.length || 0, removed: room.assignmentDecks?.[id]?.removed?.length || 0 }])),
    legendaryPlaces: LEGENDARY_PLACE_RULES.map(place => ({
      id: place.id,
      name: place.name,
      kind: place.kind,
      mapPlaceId: place.mapPlaceId || null,
      islandId: place.islandId || null,
      reward: place.unresolved ? null : (place.reward?.type || null),
      rewardStatus: place.rewardStatus || null,
      unresolved: place.unresolved || null,
      exploredBy: room.legendaryPlacesExplored?.[place.id] || null,
    })),
    namedPlaceCards: NAMED_PLACE_CARDS.map(card => ({
      id: card.id,
      name: card.name,
      placeId: card.placeId,
      visibility: card.visibility,
      iconKey: card.iconKey || null,
      claimedBy: room.legendaryPlacesExplored?.[card.placeId] || null,
    })),
    alliances: (room.alliances || []).map(pair => [...pair]),
    pendingAlliance: room.pendingAlliance && (room.pendingAlliance.fromId === viewerId || room.pendingAlliance.toId === viewerId)
      ? { ...room.pendingAlliance, viewerRole: room.pendingAlliance.fromId === viewerId ? 'sender' : 'recipient' }
      : null,
    pendingBattle: room.pendingBattle ? {
      id: room.pendingBattle.id,
      kind: room.pendingBattle.kind,
      attackerId: room.pendingBattle.attackerId,
      targetPlayerId: room.pendingBattle.targetPlayerId || null,
      islandId: room.pendingBattle.islandId || null,
      invites: room.pendingBattle.invites.map(inv => ({
        playerId: inv.playerId,
        side: inv.side,
        status: inv.response === true ? 'joined' : inv.response === false ? 'declined' : 'pending',
      })),
      viewerInvite: room.pendingBattle.invites.some(inv => inv.playerId === viewerId && inv.response == null),
    } : null,
    log: room.log.slice(-100),
    reachableCells: reachable,
    mistReachableCells: mistReachable,
    map: {
      id: MAP_META.id,
      revision: MAP_META.revision,
      rows: MAP_META.rows,
      cols: MAP_META.cols,
      artMode: 'canonical-config-v1',
      visualLayers: { ...MAP_META.visualLayers },
      hazards: Object.entries(HAZARDS).flatMap(([type, cells]) =>
        cells.map(([row, col]) => ({ type, row, col }))
      ),
      legendaryPlaces: Object.values(LEGENDARY_PLACES).map(place => ({
        id: place.id,
        name: place.name,
        type: place.type || 'legendary-sea-place',
        row: place.row,
        col: place.col,
        reward: place.reward || null,
        exploredBy: room.legendaryPlacesExplored?.[place.id] || null,
      })),
      citadel: {
        id: CITADEL.id,
        name: CITADEL.name,
        type: CITADEL.type,
        ownable: CITADEL.ownable,
        combatAllowed: CITADEL.combatAllowed,
        services: [...CITADEL.services],
      },
    },
    citadelCells: CITADEL_CELLS,
    anchorCells: Object.entries(ANCHORS).flatMap(([color, def]) => def.cells.map(([row, col]) => ({ color, row, col, name: def.name, fleetPoints: def.fleetPoints }))),
    anchorDecks: Object.fromEntries(Object.entries(room.anchorDecks || {}).map(([color, deck]) => [color, { remaining: deck.drawPile?.length || 0, discard: deck.discard?.length || 0 }])),
    buildingCatalog: Object.fromEntries(Object.entries(BUILDINGS).filter(([, b]) => b.buildable !== false).map(([id, b]) => [id, {
      id: b.id,
      name: buildingDisplayName({ type: id, level: 1 }),
      price: b.price,
      area: b.area,
      category: b.category || null,
      resource: b.resource || null,
      produces: b.produces || null,
    }])),
    characterCatalog: Object.fromEntries(Object.entries(CHARACTERS).map(([id, character]) => [id, {
      id: character.id, name: character.name, admiraltyLevel: character.admiraltyLevel,
      acquireActionCost: character.acquireActionCost, useActionCost: character.useActionCost,
      effect: { ...character.effect },
    }])),
    ruleset: RULESET,
    runtimeProfile: RUNTIME_PROFILE,
    balanceCatalog: { session: BALANCE.session, maxShipLevel: BALANCE.maxShipLevel,
      combat: BALANCE.combat, fleetScoring: BALANCE.fleetScoring, armyScoring: BALANCE.armyScoring,
      garrisons: BALANCE.garrisons, bastion: { price: BUILDINGS.bastion.price, defense: BUILDINGS.bastion.defense },
      maxEscorts: BALANCE.maxEscorts, contractBonusRatio: BALANCE.contractBonusRatio,
      loadingLimitPerIslandPerRound: BALANCE.loadingLimitPerIslandPerRound,
      landCompany: BALANCE.landCompany, legendaryEffects: BALANCE.legendaryEffects,
      expeditionLimits: { ...BALANCE.expeditionLimits } },
    shipCatalog: Object.fromEntries(Object.entries(SHIPS).map(([id, ship]) => [id, { ...ship }])),
    goodsCatalog: Object.fromEntries(Object.entries(GOODS).map(([id, g]) => [id, {
      id: g.id, name: g.name, price: g.price,
    }])),
    shipLevelCatalog: Object.fromEntries(Object.entries(SHIP_LEVELS).filter(([, d]) => !d.retired).map(([level, d]) => [level, { ...d }])),
    shipUpgradeCatalog: Object.fromEntries(Object.entries(SHIP_UPGRADES).filter(([, u]) => !u.retired).map(([id, u]) => [id, {
      id: u.id, name: u.name, branch: u.branch, order: u.order, price: u.price, requires: u.requires || null,
      artillery: u.artillery || 0, army: u.army || 0, cargo: u.cargo || 0, movement: u.movement || 0,
      passability: u.passability || null,
    }])),
    escortCatalog: Object.fromEntries(Object.entries(ESCORTS).map(([id, e]) => [id, { ...e }])),
    islands: room.islands.map(i => {
      const view = publicIsland(i, room);
      const defense = islandDefenseArmy(room, i);
      return { ...view, defenseArmy: defense.total, defenseBreakdown: defense };
    }),
    players: room.players.map(p => {
      const stats = shipStats(p);
      const escorts = escortStatuses(room, p).map(e => ({
        id: e.id,
        type: e.type,
        special: Boolean(e.special),
        active: Boolean(e.active),
        inactiveReason: e.inactiveReason || null,
        cargo: e.cargo ? { ...e.cargo, value: cargoSaleValue(p, e.id) } : null,
      }));
      const cargoEscortCapacity = escorts.filter(e => e.active).reduce((sum, e) => sum + (Number(ESCORTS[e.type]?.cargo) || 0), 0);
      const level = readableShipLevel(p);
      const nextLevel = level < BALANCE.maxShipLevel ? SHIP_LEVELS[level + 1] : null;
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        shipClass: p.shipClass,
        ducats: p.ducats,
        debt: Number(p.debt) || 0,
        glory: Number(p.glory) || 0,
        fleetPoints: Number(p.fleetPoints) || 0,
        armyPoints: Number(p.armyPoints) || 0,
        level,
        row: p.row,
        col: p.col,
        connected: p.connected,
        ready: Boolean(p.ready),
        islandCount: ownerIslandCount(room, p.id),
        suzerainId: p.suzerainId || null,
        vassalGiftIslandId: p.vassalGiftIslandId || null,
        enemyFactionIds: [...(p.enemyFactionIds || [])],
        attackedPlayerIdsThisRound: p.id === viewerId ? attackTargetsThisRound(room, p) : [],
        activeAssignment: p.id === viewerId ? assignmentPublic(p.activeAssignment) : null,
        hasActiveAssignment: Boolean(p.activeAssignment),
        assignmentPriority: p.id === viewerId && active?.id === p.id && room.phase === 'actions' && !hasPendingDecision(room)
          ? (() => { const required = assignmentRequiredAction(room, p, room.actionsLeft); return required ? { kind: required.kind, text: required.text } : null; })()
          : null,
        nextActionLimit: p.id === viewerId ? (p.nextActionLimit || null) : null,
        specialCards: p.id === viewerId ? [...(p.specialCards || [])] : [],
        specialCardCount: (p.specialCards || []).length,
        namedPlaceCards: (p.namedPlaceCards || []).map(card => ({ id: card.id, name: card.name, placeId: card.placeId })),
        namedPlaceCardCount: (p.namedPlaceCards || []).length,
        activeExpedition: p.activeExpedition ? {
          cardId: p.activeExpedition.cardId,
          name: p.activeExpedition.name,
          placeId: p.activeExpedition.placeId,
          acceptedRound: Number(p.activeExpedition.acceptedRound) || null,
          requiresLeaveAndReturn: p.id === viewerId
            ? Boolean(p.activeExpedition.startedAtTarget && !p.activeExpedition.departedAfterIssue)
            : undefined,
        } : null,
        hasActiveExpedition: Boolean(p.activeExpedition),
        expeditionHistory: p.id === viewerId ? (p.expeditionHistory || []).map(item => ({ ...item })) : [],
        expeditionHistoryCount: (p.expeditionHistory || []).length,
        expeditionTakenThisRound: p.id === viewerId ? Number(p.expeditionDrawRound) === Number(room.round) : false,
        canTakeExpedition: p.id === viewerId && active?.id === p.id && !room.eventPhase?.active && !hasPendingDecision(room)
          ? canTakeExpedition(room, p).ok : false,
        legendaryCards: p.id === viewerId ? (p.legendaryCards || []).map((c, handIndex) => ({ id: c.id, name: c.name, handIndex })) : [],
        legendaryCardCount: (p.legendaryCards || []).length,
        playableLegendaryCards: p.id === viewerId ? allLegendaryCardRefs(p) : [],
        legendaryStatus: {
          shipVeilTurns: Number(p.legendaryEffects?.shipVeil?.remaining) || 0,
          seaCurseTurns: (p.legendaryEffects?.seaCurses || []).map(e => Number(e.remaining) || 0),
          seaCursePenalty: legendaryMovementPenalty(p),
        },
        savedEventCards: p.id === viewerId ? (p.savedEventCards || []).map(c => ({ id: c.id, kind: c.kind, name: c.name, goodId: c.goodId || null })) : [],
        savedEventCardCount: (p.savedEventCards || []).length,
        nextTurnEffects: p.id === viewerId ? { ...(p.nextTurnEffects || {}) } : {},
        activeTurnEffects: p.id === viewerId ? { ...(p.activeTurnEffects || {}) } : {},
        landCompany: p.landCompany ? { ...p.landCompany } : null,
        canDismissLandCompanyHere: p.id === viewerId ? canDismissLandCompany(room, p).ok : false,
        character: p.id === viewerId && p.character ? { ...(CHARACTERS[typeof p.character === 'string' ? p.character : p.character.id] || {}), id: typeof p.character === 'string' ? p.character : p.character.id } : null,
        characterReplacedThisRound: p.id === viewerId ? Number(p.characterReplacedRound) === Number(room.round) : false,
        admiraltyLevelHere: p.id === viewerId ? bestAdmiraltyLevelAtPlayer(room, p) : 0,
        characterAcquisitionOptions: p.id === viewerId && !p.character ? characterOptionsAtAdmiralty(room, p).map(c => ({ id: c.id, name: c.name, admiraltyLevel: c.admiraltyLevel, effect: { ...c.effect } })) : [],
        characterReplacementOptions: p.id === viewerId && p.character && Number(p.characterReplacedRound) !== Number(room.round)
          ? characterOptionsAtAdmiralty(room, p, { replacing: true }).map(c => ({ id: c.id, name: c.name, admiraltyLevel: c.admiraltyLevel, effect: { ...c.effect } })) : [],
        cartographerAnchorOptions: p.id === viewerId && (typeof p.character === 'string' ? p.character : p.character?.id) === 'cartographer' ? cartographerAnchorOptions(p) : [],
        palaceUsed: p.id === viewerId ? Boolean(p.palaceUsed) : false,
        bastionSupportCapacity: stoneworksSupportCapacity(room, p.id),
        bastionCount: bastionSupportSummary(room, p.id).count,
        supportedBastionIslandIds: bastionSupportSummary(room, p.id).supported,
        inactiveBastionIslandIds: p.id === viewerId ? [...bastionSupportSummary(room, p.id).selectedInactive] : [],
        bastionSupportChoiceRequired: bastionSupportSummary(room, p.id).choiceRequired,
        cargo: p.cargo ? { ...p.cargo, value: cargoSaleValue(p, 'main') } : null,
        cargoCapacity: stats.cargo,
        stats,
        assaultArmy: (stats.army || 0) + (Number(p.landCompany?.army) || 0),
        fleetArtillery: fleetArtillery(room, p),
        totalCargoCapacity: stats.cargo + cargoEscortCapacity,
        upgrades: shipUpgradeStatuses(p),
        disabledUpgradeIds: p.id === viewerId ? [...(p.disabledUpgradeIds || [])] : [],
        upgradeSlots: shipUpgradeSlotLimit(p),
        escorts,
        levelInactiveEscortIds: p.id === viewerId ? [...(p.levelInactiveEscortIds || [])] : [],
        shipyardSlots: shipyardSlotsForPlayer(room, p.id),
        escortUseLimit: escortUseLimit(p),
        nextEscortPrice: escortPurchasePrice(p),
        nextLevel: nextLevel ? { level: nextLevel.level, price: nextLevel.price } : null,
        atCitadel: isCitadelCell(p.row, p.col),
        inPeaceZone: isCitadelPeaceCell(p.row, p.col),
        skipTurns: Number(p.skipTurns) || 0,
        pendingLandinEscort: Boolean(p.pendingLandinEscort),
        visitedAnchors: [...(p.visitedAnchors || [])],
        lastAnchorEncounter: p.lastAnchorEncounter ? { ...p.lastAnchorEncounter } : null,
        phase: p.id === active?.id ? room.phase : 'waiting',
        roll: p.id === active?.id ? room.roll : null,
        movePoints: p.id === active?.id ? room.movePoints : null,
        actionsLeft: p.id === active?.id ? room.actionsLeft : null,
        allyIds: (room.alliances || []).flatMap(pair => pair[0] === p.id ? [pair[1]] : pair[1] === p.id ? [pair[0]] : []),
        brokenAlliesThisTurn: p.id === viewerId ? [...(p.brokenAlliesThisTurn || [])] : [],
        isYou: p.id === viewerId,
      };
    }),
    order: room.order,
  };
}


function adminRoomSummary(room) {
  const active = currentPlayer(room);
  return {
    code: room.code,
    started: Boolean(room.started),
    round: Number(room.round) || 1,
    circle: Number(room.circle) || 1,
    activePlayerId: active?.id || null,
    activePlayerName: active?.name || null,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      username: p.accountUsername || null,
      connected: Boolean(p.connected),
      ready: Boolean(p.ready),
      shipClass: p.shipClass,
    })),
    createdBy: room.players.find(p => p.id === room.hostId)?.accountUsername || null,
  };
}
function adminRoomState(room) {
  const snapshot = publicRoom(room, null);
  snapshot.adminSpectator = true;
  snapshot.players = snapshot.players.map(p => {
    const raw = room.players.find(x => x.id === p.id);
    return { ...p, accountUsername: raw?.accountUsername || null };
  });
  return snapshot;
}
function closeRoomInternal(room, reason = 'Комната закрыта.') {
  if (!room) return;
  const code = room.code;
  for (const player of room.players) {
    const clientSocket = player.socketId ? io.sockets.sockets.get(player.socketId) : null;
    if (!clientSocket) continue;
    clientSocket.emit('roomClosed', { code, reason });
    clientSocket.leave(code);
    clientSocket.data.roomCode = null;
    clientSocket.data.playerId = null;
  }
  io.to(`admin-watch:${code}`).emit('adminRoomClosed', { code, reason });
  rooms.delete(code);
  persistRoom(roomStore.remove(code));
}

function emitRoom(room) {
  queueIslandCorrectionIfNeeded(room);
  queueEscortCapacityDecisionsIfNeeded(room);
  persistRoom(roomStore.save(room));
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('roomState', publicRoom(room, p.id));
  }
  io.to(`admin-watch:${room.code}`).emit('adminRoomState', adminRoomState(room));
}

function log(room, text) {
  room.log.push({ t: Date.now(), text });
  if (room.log.length > 240) room.log.shift();
}

function playerById(room, id) {
  return room?.players?.find(p => p.id === String(id || '')) || null;
}



function assignmentPublic(assignment) {
  if (!assignment?.card) return null;
  const card = assignment.card;
  return {
    instanceId: assignment.instanceId,
    factionId: assignment.factionId,
    id: card.id,
    conditionKey: card.conditionKey,
    text: card.text,
    reward: Number(card.reward) || 0,
    type: card.type,
    issuedRound: Number(assignment.issuedRound) || null,
    progress: assignment.progress ? {
      kind: assignment.progress.kind || null,
      nextStopIndex: Number(assignment.progress.nextStopIndex) || 0,
      completedStopCount: Number(assignment.progress.completedStopCount) || 0,
      totalStops: card.type === 'visit-route' ? Math.max(0, card.route?.length || 0) : (card.type === 'visit-island' ? 1 : 0),
      departureRequired: Boolean(assignment.progress.departureRequired),
      departureSatisfied: Boolean(assignment.progress.departureSatisfied),
      completedStops: (assignment.progress.completedStops || []).filter(Boolean).map(stop => ({ ...stop })),
    } : null,
  };
}

function trackAssignment(room, player, event) {
  if (!room || !player?.activeAssignment) return null;
  const result = completeAssignment(room, player, event);
  if (!result?.ok) return null;
  const factionName = FACTIONS[result.assignment.factionId]?.name || result.assignment.factionId;
  const withheldText = result.withheld ? ` ${factionName} удерживает ${result.withheld}; игроку причитается ${result.paid}.` : '';
  const debtText = result.credit?.debtPaid ? ` Из выплаты ${result.credit.debtPaid} ушло в погашение долга; в казну ${result.credit.net}.` : '';
  log(room, `${player.name} выполняет поручение «${result.assignment.card.text}». Награда ${result.gross} дукатов.${withheldText}${debtText}`);
  return result;
}

function trackMoriNavigation(room, player, from = null) {
  const result = advanceMoriAssignmentNavigation(room, player, from);
  if (!result?.ok || !result.active) return result;
  if (result.progressed && !result.completed && result.stop) {
    log(room, `${player.name}: поручение Мори — первый пункт «${result.stop.label}» отмечен; маршрут продолжается.`);
  }
  if (result.completionEvent) result.completion = trackAssignment(room, player, result.completionEvent);
  return result;
}
function assignmentBuildingEvent(island, building, previousBuilding = null) {
  const def = BUILDINGS[building?.type];
  return {
    type: 'building-action',
    islandId: island?.id || null,
    islandResources: [...(island?.resources || [])],
    buildingType: building?.type || null,
    previousBuildingType: previousBuilding?.type || null,
    branch: def?.branch || null,
  };
}

function deliveryAssignmentMatch(player, result) {
  if (!player?.activeAssignment || !result) return false;
  return assignmentEventMatches(player, {
    type: 'delivery',
    goodId: result.good?.id,
    assignmentInstanceId: result.assignmentInstanceId || null,
    fullHold: Number(result.quantity) === Number(result.capacity),
  });
}

const ASSIGNMENT_PRIORITY_EVENTS = new Set([
  'fightAnchor', 'takeCharacter', 'replaceCharacter', 'usePalace',
  'build', 'upgradeBuilding', 'buildBastion', 'formLandCompany',
  'buyCityGuard', 'buyPermanentGarrison', 'buyShipLevel', 'buyShipUpgrade',
  'removeShipUpgrade', 'buyEscort', 'loadCargo', 'sellCargo',
  'useSavedCargo', 'useShipMaster', 'useBlueprint', 'playLegendary', 'takeExpedition',
  'requestAlliance', 'enterVassalage', 'rebelVassalage',
  'attackShip', 'assaultIsland', 'endTurn',
]);

function sameAssignmentOption(option, data, fields) {
  return fields.every(field => String(option?.[field] ?? '') === String(data?.[field] ?? ''));
}

function assignmentPriorityAllows(requirement, event, data = {}) {
  if (!requirement) return true;

  if (requirement.kind === 'building') {
    if (event === 'build') {
      return (requirement.buildOptions || []).some(option =>
        sameAssignmentOption(option, { islandId: data?.islandId, buildingType: data?.buildingType }, ['islandId', 'buildingType']));
    }
    if (event === 'upgradeBuilding') {
      return (requirement.upgradeOptions || []).some(option =>
        option.islandId === String(data?.islandId || '') && option.buildingIndex === Number(data?.buildingIndex));
    }
    if (event === 'buildBastion') {
      const islandId = String(data?.islandId || '');
      const rawIndex = data?.buildingIndex;
      return (requirement.bastionOptions || []).some(option =>
        option.islandId === islandId && (rawIndex == null || rawIndex === '' || option.buildingIndex === Number(rawIndex)));
    }
    if (event === 'useBlueprint') {
      return (requirement.blueprintOptions || []).some(option =>
        option.islandId === String(data?.islandId || '') && option.savedCardId === String(data?.savedCardId || ''));
    }
    return false;
  }

  if (requirement.kind === 'ship-level') return event === 'buyShipLevel';

  if (requirement.kind === 'ship-upgrade') {
    if (event === 'buyShipUpgrade') return (requirement.upgradeIds || []).includes(String(data?.upgradeId || ''));
    if (event === 'useShipMaster') {
      return (requirement.shipMasterIds || []).includes(String(data?.savedCardId || ''))
        && (requirement.freeUpgradeIds || []).includes(String(data?.upgradeId || ''));
    }
    return false;
  }

  if (requirement.kind === 'anchor') return event === 'fightAnchor';

  if (requirement.kind === 'delivery') {
    const holdId = String(data?.holdId || 'main');
    return event === 'sellCargo' && (requirement.holdIds || []).includes(holdId);
  }

  if (requirement.kind === 'assault') {
    return event === 'assaultIsland' && (requirement.islandIds || []).includes(String(data?.islandId || ''));
  }

  if (requirement.kind === 'treasure') {
    return event === 'useSavedCargo' && (requirement.savedCardIds || []).includes(String(data?.savedCardId || ''));
  }

  return true;
}

function assignmentPriorityError(socket, event, data) {
  if (!ASSIGNMENT_PRIORITY_EVENTS.has(event)) return null;
  const room = getRoom(socket.data.roomCode);
  const player = currentPlayer(room);
  if (!room || !player || player.id !== socket.data.playerId || room.phase !== 'actions') return null;
  if (hasPendingDecision(room)) return null;
  const requirement = assignmentRequiredAction(room, player, room.actionsLeft);
  if (!requirement || assignmentPriorityAllows(requirement, event, data)) return null;
  return 'Сначала выполните доступное активное поручение «' + requirement.text + '». По правилам поручение имеет приоритет перед другими добровольными действиями.';
}

function buildAssignmentQueue(room, snapshot) {
  const queue = [];
  for (const playerId of room.order || []) {
    const snap = snapshot?.[playerId];
    if (!snap?.suzerainId || snap.hadAssignment) continue;
    if (!ASSIGNMENT_CARDS[snap.suzerainId]) continue;
    queue.push({ playerId, factionId: snap.suzerainId });
  }
  return queue;
}

function refreshPoliticsWithLog(room) {
  const changes = refreshFactionExistence(room);
  for (const change of changes) {
    if (change.before === true && change.exists === false) log(room, `${FACTIONS[change.factionId]?.name || change.factionId} прекращает существование. Вражда с ним у всех игроков прекращается.`);
  }
  return changes;
}

function markEnmity(room, player, factionId, reason = '') {
  if (!player || !factionId) return false;
  const result = addEnmity(room, player, factionId);
  if (result.added) log(room, `${player.name} становится врагом государства ${result.faction.name}${reason ? `: ${reason}` : '.'}`);
  return Boolean(result.added);
}

function hostilityFactionForPlayer(target) {
  return target?.suzerainId || null;
}

function hostilityFactionForIsland(room, island) {
  if (!island) return null;
  if (island.ownerId) return hostilityFactionForPlayer(playerById(room, island.ownerId));
  return factionIdForIsland(island);
}

function autoRebelBeforeStateAttack(room, attacker, island) {
  const factionId = island && !island.ownerId ? factionIdForIsland(island) : null;
  if (!factionId || attacker?.suzerainId !== factionId) return null;
  const result = rebelFromSuzerain(room, attacker);
  if (result.ok) {
    const returned = result.returned ? ` Подаренный остров ${result.gift.name} возвращён государству.` : '';
    log(room, `${attacker.name} нападает на собственного сюзерена и автоматически объявляет мятеж.${returned}`);
  }
  return result;
}

function markAttackHostilityAgainstPlayer(room, attacker, target, reason = 'нападение на вассала') {
  const factionId = hostilityFactionForPlayer(target);
  if (factionId) markEnmity(room, attacker, factionId, reason);
}

function markAttackHostilityAgainstIsland(room, attacker, island, reason = 'нападение на владение государства или вассала') {
  const factionId = hostilityFactionForIsland(room, island);
  if (factionId) markEnmity(room, attacker, factionId, reason);
}

function hasPendingDecision(room) {
  return Boolean(room?.pendingAlliance || room?.pendingBattle || room?.pendingEvent || room?.pendingFeud || room?.pendingAssignmentChoice || room?.pendingIslandCorrection || room?.pendingFleetAdjustment || room?.pendingLegendaryReaction);
}

function pendingDecisionError(room) {
  if (room?.pendingAlliance) return 'Сначала завершите предложение союза.';
  if (room?.pendingBattle) return 'Сначала завершите текущий совместный бой.';
  if (room?.pendingEvent) return 'Сначала разрешите карту события.';
  if (room?.pendingFeud) return 'Сначала разрешите карту вражды.';
  if (room?.pendingAssignmentChoice) return 'Сначала выберите поручение через Посольство.';
  if (room?.pendingIslandCorrection) return room.pendingIslandCorrection.kind === 'capture-retention' ? 'Сначала выберите постройки, которые будут уничтожены после захвата острова.' : 'Сначала удалите лишние постройки с острова после потери статуса.';
  if (room?.pendingFleetAdjustment) return 'Сначала завершите обязательный выбор по флотилии или поддержке бастионов.';
  if (room?.pendingLegendaryReaction) return 'Сначала разрешите реакцию «Покров моря».';
  return null;
}

function fleetAdjustmentOptions(room, player, stage) {
  if (stage === 'bastions') {
    const owned = new Set(bastionSupportChoiceNeeds(room, player).owned);
    return (room?.islands || []).filter(island => owned.has(island.id)).map(island => ({
      id: island.id,
      name: `Бастион — ${island.name}`,
      islandId: island.id,
    }));
  }
  if (stage === 'upgrades') {
    return shipUpgradeStatuses(player).map(u => ({
      id: u.id,
      name: u.name,
      missingRequirement: Boolean(u.missingRequirement),
    }));
  }
  if (stage === 'escorts' || stage === 'landin-replace' || stage === 'shipyard-remove') {
    const catalog = ESCORTS;
    return escortStatuses(room, player)
      .filter(e => stage !== 'shipyard-remove' || !e.special)
      .map(e => ({
        id: e.id,
        name: catalog[e.type]?.name || e.type,
        type: e.type,
        special: Boolean(e.special),
        hasCargo: Boolean(e.cargo),
        cargoText: e.cargo ? `${GOODS[e.cargo.goodId]?.name || e.cargo.goodId} ×${e.cargo.quantity}` : null,
        artillery: Number(catalog[e.type]?.artillery) || 0,
        cargoCapacity: Number(catalog[e.type]?.cargo) || 0,
      }));
  }
  return [];
}

function fleetDecisionActivationBlocked(room) {
  return Boolean(
    room?.pendingAlliance || room?.pendingBattle || room?.pendingEvent || room?.pendingFeud ||
    room?.pendingAssignmentChoice || room?.pendingIslandCorrection ||
    room?.pendingLegendaryReaction
  );
}

function enqueueFleetDecision(room, item) {
  room.fleetAdjustmentQueue ||= [];
  const stage = item.stage || 'level';
  const duplicate = room.fleetAdjustmentQueue.some(x => x.playerId === item.playerId && (x.stage || 'level') === stage);
  const pendingSame = room.pendingFleetAdjustment?.playerId === item.playerId && room.pendingFleetAdjustment?.stage === stage;
  if (!duplicate && !pendingSame) room.fleetAdjustmentQueue.push({ ...item, stage });
}

function activateNextFleetAdjustment(room) {
  if (room?.pendingFleetAdjustment) return true;
  if (fleetDecisionActivationBlocked(room)) return false;
  room.fleetAdjustmentQueue ||= [];
  while (room.fleetAdjustmentQueue.length) {
    const item = room.fleetAdjustmentQueue.shift();
    const player = playerById(room, item.playerId);
    if (!player) continue;

    if (item.stage === 'bastions') {
      const needs = bastionSupportChoiceNeeds(room, player);
      if (!needs.needsChoice) continue;
      room.pendingFleetAdjustment = {
        id: crypto.randomUUID(), playerId: player.id, stage: 'bastions', required: needs.requiredInactive,
        reason: item.reason || 'После потери мест поддержки выберите бастионы, которые временно не дают защиту.',
        options: fleetAdjustmentOptions(room, player, 'bastions'),
      };
      log(room, `${player.name}: нужно выбрать ${needs.requiredInactive} временно неактивных бастионов после потери поддержки каменотёсных дворов.`);
      return true;
    }

    if (item.stage === 'landin-replace') {
      if (!player.pendingLandinEscort) continue;
      if ((player.escorts || []).length < BALANCE.maxEscorts) {
        const granted = replaceEscortWithLandin(player, null);
        if (granted.ok) {
          player.pendingLandinEscort = false;
          log(room, `${player.name} получает особое сопровождение Ландина: +${ESCORTS.landin.artillery} артиллерии и отдельный трюм ${ESCORTS.landin.cargo}.`);
        }
        continue;
      }
      room.pendingFleetAdjustment = {
        id: crypto.randomUUID(), playerId: player.id, stage: 'landin-replace', required: 1,
        reason: item.reason || `Особое сопровождение Ландина должно заменить одно из ${BALANCE.maxEscorts} имеющихся судов сопровождения.`,
        options: fleetAdjustmentOptions(room, player, 'landin-replace'),
      };
      log(room, `${player.name}: выберите одно судно сопровождения, которое заменит особое сопровождение Ландина.`);
      return true;
    }

    if (item.stage === 'shipyard-remove') {
      const required = ordinaryEscortExcess(room, player);
      if (required <= 0) continue;
      room.pendingFleetAdjustment = {
        id: crypto.randomUUID(), playerId: player.id, stage: 'shipyard-remove', required,
        reason: item.reason || 'После потери мест верфи лишние обычные суда сопровождения должны быть удалены вместе с грузом.',
        options: fleetAdjustmentOptions(room, player, 'shipyard-remove'),
      };
      log(room, `${player.name}: после потери мест верфи нужно удалить ${required} обычных судов сопровождения.`);
      return true;
    }

    const needs = fleetAdjustmentNeeds(player);
    const stage = needs.upgradeChoiceNeeded ? 'upgrades' : (needs.escortChoiceNeeded ? 'escorts' : null);
    if (!stage) continue;
    const required = stage === 'upgrades' ? needs.upgradeCount : needs.escortCount;
    room.pendingFleetAdjustment = {
      id: crypto.randomUUID(), playerId: player.id, stage, required,
      reason: item.reason || 'После снижения уровня корабля нужно выбрать временно неактивные элементы флотилии.',
      options: fleetAdjustmentOptions(room, player, stage),
    };
    const what = stage === 'upgrades' ? 'улучшений' : 'судов сопровождения';
    log(room, `${player.name}: после снижения уровня корабля нужно выбрать ${required} временно неактивных ${what}.`);
    return true;
  }
  return false;
}

function queueFleetAdjustment(room, player, reason = '') {
  if (!room || !player) return false;
  const needs = fleetAdjustmentNeeds(player);
  if (!needs.needsChoice) return false;
  enqueueFleetDecision(room, { playerId: player.id, stage: 'level', reason });
  if (!room.pendingFleetAdjustment) activateNextFleetAdjustment(room);
  return true;
}

function queueBastionSupportDecision(room, player, reason = '') {
  if (!room || !player || !bastionSupportChoiceNeeds(room, player).needsChoice) return false;
  enqueueFleetDecision(room, { playerId: player.id, stage: 'bastions', reason });
  if (!room.pendingFleetAdjustment) activateNextFleetAdjustment(room);
  return true;
}

function queueShipyardEscortRemoval(room, player, reason = '') {
  if (!room || !player || ordinaryEscortExcess(room, player) <= 0) return false;
  enqueueFleetDecision(room, { playerId: player.id, stage: 'shipyard-remove', reason });
  if (!room.pendingFleetAdjustment) activateNextFleetAdjustment(room);
  return true;
}

function queueLandinEscortReplacement(room, player, reason = '') {
  if (!room || !player?.pendingLandinEscort) return false;
  enqueueFleetDecision(room, { playerId: player.id, stage: 'landin-replace', reason });
  if (!room.pendingFleetAdjustment) activateNextFleetAdjustment(room);
  return true;
}

function queueEscortCapacityDecisionsIfNeeded(room) {
  if (!room?.started) return false;
  let queued = false;
  for (const player of room.players || []) {
    if (bastionSupportChoiceNeeds(room, player).needsChoice) queued = queueBastionSupportDecision(room, player, 'После потери поддержки каменотёсных дворов владелец выбирает временно неактивные бастионы.') || queued;
    if (player.pendingLandinEscort) queued = queueLandinEscortReplacement(room, player, `Награда Ландина заменяет одно из судов сопровождения и не увеличивает общий предел сверх ${BALANCE.maxEscorts}.`) || queued;
    if (ordinaryEscortExcess(room, player) > 0) queued = queueShipyardEscortRemoval(room, player, 'После потери места верфи выберите лишнее обычное сопровождение для удаления; его груз будет потерян.') || queued;
    if (fleetAdjustmentNeeds(player).needsChoice) queued = queueFleetAdjustment(room, player, 'Текущий уровень основного корабля допускает меньше активных элементов флотилии.') || queued;
  }
  if (!room.pendingFleetAdjustment) activateNextFleetAdjustment(room);
  return Boolean(room.pendingFleetAdjustment || queued);
}

function queueFleetAdjustmentsForLosses(room, losses, reason = '') {
  let queued = false;
  for (const loss of losses || []) {
    const player = playerById(room, loss.playerId);
    if (player && queueFleetAdjustment(room, player, reason)) queued = true;
  }
  return queued;
}

function advanceFleetAdjustment(room) {
  const pending = room?.pendingFleetAdjustment;
  if (!pending) return false;
  const player = playerById(room, pending.playerId);
  if (!player) {
    room.pendingFleetAdjustment = null;
    return activateNextFleetAdjustment(room);
  }
  const needs = fleetAdjustmentNeeds(player);
  if (needs.upgradeChoiceNeeded) {
    pending.stage = 'upgrades';
    pending.required = needs.upgradeCount;
    pending.options = fleetAdjustmentOptions(room, player, 'upgrades');
    return true;
  }
  if (needs.escortChoiceNeeded) {
    pending.stage = 'escorts';
    pending.required = needs.escortCount;
    pending.options = fleetAdjustmentOptions(room, player, 'escorts');
    return true;
  }
  room.pendingFleetAdjustment = null;
  if (activateNextFleetAdjustment(room)) return true;
  if (queueEscortCapacityDecisionsIfNeeded(room)) return true;
  if (!queueIslandCorrectionIfNeeded(room, null, 'последствия боя или изменения флотилии') && room.eventPhase?.active) processEventPhase(room);
  return false;
}

function legendaryKindFromName(name) {
  const value = String(name || '');
  if (value === 'Покров моря') return 'sea-veil';
  if (value === 'Пламя Ада') return 'hellfire';
  if (value === 'Путь сквозь туман') return 'mist-path';
  if (value === 'Морское проклятие') return 'sea-curse';
  return null;
}

function allLegendaryCardRefs(player) {
  if (!player) return [];
  const out = [];
  (player.legendaryCards || []).forEach((card, index) => out.push({
    source: 'legendary', index, id: card.id, kind: card.id, name: card.name,
  }));
  (player.specialCards || []).forEach((name, index) => {
    const kind = legendaryKindFromName(name);
    if (kind) out.push({ source: 'special', index, id: kind, kind, name });
  });
  return out;
}

function legendaryCardRefs(player, kind) {
  return allLegendaryCardRefs(player).filter(ref => ref.kind === kind);
}

function playerHasLegendaryKind(player, kind) {
  return legendaryCardRefs(player, kind).length > 0;
}

function peekLegendaryCard(player, ref) {
  if (!player || !ref) return null;
  const source = String(ref.source || '');
  const index = Number(ref.index);
  if (!Number.isInteger(index) || index < 0) return null;
  if (source === 'legendary') {
    const card = player.legendaryCards?.[index];
    return card ? { source, index, kind: card.id, name: card.name, card } : null;
  }
  if (source === 'special') {
    const name = player.specialCards?.[index];
    const kind = legendaryKindFromName(name);
    return kind ? { source, index, kind, name, card: { id: kind, name } } : null;
  }
  return null;
}

function consumeLegendaryCard(_room, player, ref) {
  const found = peekLegendaryCard(player, ref);
  if (!found) return null;
  if (found.source === 'legendary') {
    const [card] = player.legendaryCards.splice(found.index, 1);
    return { ...found, card };
  }
  player.specialCards.splice(found.index, 1);
  return found;
}

function allianceNames(room, ids) {
  return (ids || []).map(id => playerById(room, id)?.name || 'Игрок').join(', ');
}

function sameCell(a, b) {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

function eligibleSeaBattleInvites(room, attacker, defender, inviteAttackers = true) {
  const attackerInvites = [];
  const defenderInvites = [];
  for (const p of room.players || []) {
    if (!p.connected || p.id === attacker.id || p.id === defender.id) continue;
    if (!seaAttackPositionAllowed(p, defender)) continue;
    if (inviteAttackers && areAllies(room, attacker, p) && !areAllies(room, defender, p) && canAttackPlayerThisRound(room, p, defender.id).ok) {
      attackerInvites.push(p.id);
      continue;
    }
    if (areAllies(room, defender, p) && !areAllies(room, attacker, p)) {
      defenderInvites.push(p.id);
    }
  }
  return { attackerInvites, defenderInvites };
}

function eligibleAssaultInvites(room, attacker, island, inviteAttackers = true) {
  const defender = island.ownerId ? playerById(room, island.ownerId) : null;
  const attackerInvites = [];
  const defenderInvites = [];
  for (const p of room.players || []) {
    if (!p.connected || p.id === attacker.id || p.id === defender?.id) continue;
    if (!playerOnIsland(p, island)) continue;
    if (inviteAttackers && areAllies(room, attacker, p) && (!defender || !areAllies(room, defender, p))) {
      attackerInvites.push(p.id);
      continue;
    }
    if (defender && areAllies(room, defender, p) && !areAllies(room, attacker, p)) {
      defenderInvites.push(p.id);
    }
  }
  return { attackerInvites, defenderInvites };
}

function acceptedIds(pending, side) {
  return pending.invites.filter(inv => inv.side === side && inv.response === true).map(inv => inv.playerId);
}

function allBattleInvitesAnswered(pending) {
  return pending.invites.every(inv => inv.response === true || inv.response === false);
}

function describeLevelLoss(room, loss) {
  const player = playerById(room, loss.playerId);
  if (loss.preventedByCharacter === 'shipCarpenter') return `${player?.name || 'Игрок'}: Корабельный плотник предотвращает потерю уровня`;
  if (loss.returnedToStart) return `${player?.name || 'Игрок'}: I уровень → старт`;
  const cargo = loss.cargoDiscarded ? `, сброшено груза ${loss.cargoDiscarded}` : '';
  return `${player?.name || 'Игрок'}: ${loss.before} → ${loss.after}${cargo}`;
}

function shipCarpenterRequest(room, player, requested) {
  if (!requested) return { ok: true, playerIds: [] };
  if ((typeof player?.character === 'string' ? player.character : player?.character?.id) !== 'shipCarpenter') {
    return { ok: false, error: 'На основном корабле нет Корабельного плотника.' };
  }
  const cost = Math.max(0, Number(CHARACTERS.shipCarpenter?.useActionCost) || 0);
  if ((Number(room?.actionsLeft) || 0) < 1 + cost) {
    return { ok: false, error: `Для атаки с возможным применением Корабельного плотника нужно оставить ещё ${cost} действие.` };
  }
  return { ok: true, playerIds: [player.id], cost };
}

function chargeBattleCharacterCosts(room, result) {
  const activeId = currentPlayer(room)?.id;
  const used = (result?.levelLosses || []).filter(loss => loss.preventedByCharacter === 'shipCarpenter' && loss.playerId === activeId);
  if (!used.length) return 0;
  const cost = Math.max(0, Number(CHARACTERS.shipCarpenter?.useActionCost) || 0) * used.length;
  room.actionsLeft = Math.max(0, (Number(room.actionsLeft) || 0) - cost);
  result.characterActionCost = cost;
  return cost;
}

function logSeaBattleResult(room, attacker, defender, result) {
  const attackNames = allianceNames(room, result.attackerParticipantIds);
  const defenseNames = allianceNames(room, result.defenderParticipantIds);
  const score = `${result.attackerPower}:${result.defenderPower}`;
  if (result.outcome === 'tie') {
    log(room, `Морской бой ${attacker.name} против ${defender.name}: ${score}. Ничья. Участники атаки: ${attackNames}; защиты: ${defenseNames}. Уровни, дукаты и груз не меняются; пропуска хода нет.`);
  } else {
    const winners = result.outcome === 'attacker' ? attackNames : defenseNames;
    const losses = (result.levelLosses || []).map(loss => describeLevelLoss(room, loss)).join('; ') || 'без потери уровней';
    const shares = Object.entries(result.lootShares || {}).filter(([, amount]) => amount > 0).map(([id, amount]) => `${playerById(room, id)?.name || 'Игрок'} +${amount}`).join(', ');
    const points = (result.fleetPointAwards || []).map(a => `${playerById(room, a.playerId)?.name || 'Игрок'} +${a.points}`).join(', ');
    const carpenterCost = result.characterActionCost ? ` Корабельный плотник: −${result.characterActionCost} действие.` : '';
    log(room, `Морской бой ${attacker.name} против ${defender.name}: ${score}. Побеждают: ${winners}. Потери уровней: ${losses}. Добыча ${result.loot} дукатов${shares ? ` (${shares})` : ''}. Очки флота: ${points || 'без начисления'}.${carpenterCost}`);
  }
}


function otherPendingDecisionExists(room) {
  return Boolean(room?.pendingAlliance || room?.pendingBattle || room?.pendingEvent || room?.pendingFeud || room?.pendingAssignmentChoice || room?.pendingFleetAdjustment || room?.pendingLegendaryReaction);
}

function normalizeOwnedGarrisonsWithLog(room) {
  for (const island of room?.islands || []) {
    if (!island.ownerId || !island.garrisonType) continue;
    const before = island.garrisonType;
    const after = normalizeIslandGarrison(island);
    if (before === after) continue;
    const owner = playerById(room, island.ownerId);
    if (before === 'permanent' && after === 'guard') {
      log(room, `${owner?.name || 'Игрок'}: ${island.name} перестал быть крупным портом — постоянный гарнизон становится городской стражей (+${BALANCE.garrisons.guard.defense}).`);
    } else if (before && !after) {
      log(room, `${owner?.name || 'Игрок'}: ${island.name} потерял статус города — городской отряд распущен без возврата платы.`);
    }
  }
}

function firstIllegalOwnedIsland(room, preferredIslandId = null) {
  const owned = (room?.islands || []).filter(i => i.ownerId && playerById(room, i.ownerId));
  const ordered = preferredIslandId
    ? [...owned.filter(i => i.id === preferredIslandId), ...owned.filter(i => i.id !== preferredIslandId)]
    : owned;
  for (const island of ordered) {
    const report = islandConstraintReport(island);
    if (!report.legal) return { island, report, player: playerById(room, island.ownerId) };
  }
  return null;
}

function refreshPendingIslandCorrection(room) {
  const pending = room?.pendingIslandCorrection;
  if (!pending) return false;
  const island = room.islands?.find(i => i.id === pending.islandId);
  const player = playerById(room, pending.playerId);
  if (!island || !player || island.ownerId !== player.id) { room.pendingIslandCorrection = null; return false; }

  if ((pending.kind || 'constraints') === 'capture-retention') {
    pending.islandName = island.name;
    pending.report = islandConstraintReport(island);
    pending.options = capturedBuildingRetentionOptions(island);
    const remaining = Math.max(0, Number(pending.remainingRemovals) || 0);
    if (remaining > 0 && pending.options.length) return true;
    finalizeCapturedBuildingRetention(island);
    const deferredStatePrize = pending.deferredStatePrize || null;
    log(room, `${player.name} завершает последствия захвата ${island.name}: сохранено ${pending.keepCount} из ${pending.initialBuildingCount} захваченных построек.`);
    room.pendingIslandCorrection = null;
    if (deferredStatePrize?.triggered) queueStatePrizeFromAssault(room, player, { statePrize: deferredStatePrize });
    return false;
  }

  const report = islandConstraintReport(island);
  if (report.legal) {
    log(room, `${player.name}: ${island.name} снова соответствует ограничениям статуса «${report.status}»: площадь ${report.usedArea}/${report.effectiveArea}, предел ветви ${report.branchLimit}.`);
    room.pendingIslandCorrection = null;
    return false;
  }
  pending.islandName = island.name;
  pending.report = report;
  pending.options = islandCorrectionOptions(island);
  return true;
}

function queueIslandCorrectionIfNeeded(room, preferredIslandId = null, reason = '') {
  if (!room?.started) return false;
  normalizeOwnedGarrisonsWithLog(room);
  if (room.pendingIslandCorrection) return refreshPendingIslandCorrection(room);
  if (otherPendingDecisionExists(room)) return false;
  const found = firstIllegalOwnedIsland(room, preferredIslandId);
  if (!found) return false;
  room.pendingIslandCorrection = {
    id: crypto.randomUUID(),
    playerId: found.player.id,
    islandId: found.island.id,
    islandName: found.island.name,
    reason: reason || 'После потери статуса остров превысил доступную площадь или предел построек одной ветви.',
    report: found.report,
    options: islandCorrectionOptions(found.island),
    removed: [],
  };
  const branches = found.report.branchViolations.map(v => `${v.name}: ${v.count}/${v.limit}`).join(', ');
  const area = found.report.overArea > 0 ? ` площадь ${found.report.usedArea}/${found.report.effectiveArea}` : '';
  log(room, `${found.player.name}: ${found.island.name} требует немедленного исправления после потери статуса «${found.report.status}».${area}${branches ? `${area ? ';' : ''} ветви: ${branches}` : ''}. Владелец должен удалить постройки без компенсации.`);
  return true;
}

function continueAfterIslandCorrection(room) {
  if (hasPendingDecision(room)) return;
  if (queueIslandCorrectionIfNeeded(room)) return;
  if (room.eventPhase?.active) processEventPhase(room);
}

function queueStatePrizeFromAssault(room, attacker, result) {
  const prize = result?.statePrize;
  if (!prize?.triggered) return false;
  const factionName = prize.factionName || FACTIONS[prize.factionId]?.name || prize.factionId;
  if (prize.amountUnresolved) {
    log(room, `${attacker.name} военным штурмом берёт последний остров, которым владело государство ${factionName}. Получатель итогового приза зафиксирован, но сумма не выплачена: мастер-правила содержат нерешённое противоречие по этому призу.`);
    return false;
  }
  const c = prize.credit;
  const debtText = c?.debtPaid ? ` Из ${prize.ducats} дукатов ${c.debtPaid} погашают долг; в казну ${c.net}.` : '';
  log(room, `${attacker.name} получает итоговый приз ${factionName} за военный захват последнего острова государства: ${prize.ducats} дукатов.${debtText}`);
  return false;
}

function queueCaptureRetentionFromAssault(room, attacker, island, result) {
  const retention = result?.captureRetention;
  if (result?.outcome !== 'attacker' || !retention) return false;
  if (retention.removeCount <= 0) { finalizeCapturedBuildingRetention(island); return false; }
  room.pendingIslandCorrection = {
    id: crypto.randomUUID(), kind: 'capture-retention', playerId: attacker.id, islandId: island.id, islandName: island.name,
    reason: `После захвата сохраняется половина существовавшей инфраструктуры острова: нужно удалить ${retention.removeCount} построок.`,
    report: islandConstraintReport(island), initialBuildingCount: retention.initialCount, keepCount: retention.keepCount,
    remainingRemovals: retention.removeCount, options: capturedBuildingRetentionOptions(island), removed: [],
    deferredStatePrize: result.statePrize?.triggered ? result.statePrize : null,
  };
  log(room, `${attacker.name} должен выбрать ${retention.removeCount} построок на ${island.name}, которые будут уничтожены после захвата; сохранится ${retention.keepCount} из ${retention.initialCount}.`);
  return true;
}

function logAssaultResult(room, attacker, island, result) {
  const attackNames = allianceNames(room, result.attackerParticipantIds);
  const defenseNames = allianceNames(room, result.defenderParticipantIds);
  if (result.outcome === 'attacker') {
    const retentionText = result.captureRetention ? ` После захвата сохраняется ${result.captureRetention.keepCount} из ${result.captureRetention.initialCount} существовавших построек.` : '';
    const rewardText = result.rewardNotes.length ? ` Награда: ${result.rewardNotes.join(', ')}.` : '';
    const armyText = (result.armyPointAwards || []).map(a => `${playerById(room, a.playerId)?.name || 'Игрок'} +${a.points}`).join(', ');
    log(room, `${attacker.name} и союзники [${attackNames}] штурмуют ${island.name}: войско ${result.attackerPower} против защиты ${result.defense.total}. Остров получает инициатор ${attacker.name}.${retentionText} Очки армии: ${armyText || 'без начисления'}.${rewardText}`);
    if (result.legendaryDiscovery?.first) logLegendaryDiscovery(room, attacker, result.legendaryDiscovery);
    trackAssignment(room, attacker, { type: 'capture-island', islandId: island.id });
  } else if (result.outcome === 'defender') {
    const losses = (result.levelLosses || []).map(loss => describeLevelLoss(room, loss)).join('; ');
    const companies = (result.discardedLandCompanies || []).map(x => `${playerById(room, x.playerId)?.name || 'Игрок'} теряет роту +${x.army}`).join('; ');
    const armyText = (result.armyPointAwards || []).map(a => `${playerById(room, a.playerId)?.name || 'Игрок'} +${a.points}`).join(', ');
    log(room, `Штурм ${island.name}: ${result.attackerPower}:${result.defense.total}. Защита устояла${defenseNames ? ` [${defenseNames}]` : ''}. Очки армии: ${armyText || 'без начисления'}. Потери нападающих: ${[losses, companies].filter(Boolean).join('; ') || 'нет'}.`);
  } else {
    log(room, `Штурм ${island.name}: ${result.attackerPower}:${result.defense.total}. Ничья, контроль не меняется; уровни, роты и дукаты участников сохраняются.`);
  }
}

function beginSeaBattleResolution(room, attacker, target, inviteAllies, combatOptions = {}) {
  const eligible = eligibleSeaBattleInvites(room, attacker, target, Boolean(inviteAllies));
  const invites = [
    ...eligible.attackerInvites.map(playerId => ({ playerId, side: 'attacker', response: null })),
    ...eligible.defenderInvites.map(playerId => ({ playerId, side: 'defender', response: null })),
  ];
  if (!invites.length) {
    const result = jointSeaBattle(room, attacker, target, [], [], { ...combatOptions, skipAttackRegistrationIds: [attacker.id] });
    if (!result.ok) return result;
    chargeBattleCharacterCosts(room, result);
    logSeaBattleResult(room, attacker, target, result);
    const fleetPending = queueFleetAdjustmentsForLosses(room, result.levelLosses, 'Потеря уровня после морского боя.');
    if (!fleetPending) queueIslandCorrectionIfNeeded(room, null, 'последствия морского боя и бунта владений');
    log(room, `Осталось действий: ${room.actionsLeft}.`);
    return { ok: true, result, fleetPending };
  }
  room.pendingBattle = {
    id: crypto.randomUUID(), kind: 'sea', attackerId: attacker.id, targetPlayerId: target.id,
    invites, shipCarpenterPlayerIds: [...(combatOptions.shipCarpenterPlayerIds || [])],
  };
  const invitedAttackers = allianceNames(room, eligible.attackerInvites);
  const invitedDefenders = allianceNames(room, eligible.defenderInvites);
  log(room, `${attacker.name} объявляет морской бой против ${target.name}. ${invitedAttackers ? `К атаке приглашены: ${invitedAttackers}. ` : ''}${invitedDefenders ? `К защите приглашены: ${invitedDefenders}.` : ''}`);
  return { ok: true, pending: true };
}

function beginAssaultResolution(room, attacker, island, inviteAllies, combatOptions = {}) {
  const owner = island.ownerId ? playerById(room, island.ownerId) : null;
  const eligible = eligibleAssaultInvites(room, attacker, island, Boolean(inviteAllies));
  const invites = [
    ...eligible.attackerInvites.map(playerId => ({ playerId, side: 'attacker', response: null })),
    ...eligible.defenderInvites.map(playerId => ({ playerId, side: 'defender', response: null })),
  ];
  if (!invites.length) {
    const result = jointAssaultIsland(room, attacker, island, [], [], { ...combatOptions, skipAttackRegistrationIds: island.ownerId ? [attacker.id] : [] });
    if (!result.ok) return result;
    chargeBattleCharacterCosts(room, result);
    logAssaultResult(room, attacker, island, result);
    if (result.outcome === 'attacker') {
      const capturePending = queueCaptureRetentionFromAssault(room, attacker, island, result);
      if (!capturePending) queueStatePrizeFromAssault(room, attacker, result);
      refreshPoliticsWithLog(room);
    }
    const fleetPending = queueFleetAdjustmentsForLosses(room, result.levelLosses, `Потеря уровня после штурма ${island.name}.`);
    if (!fleetPending) queueIslandCorrectionIfNeeded(room, null, `последствия штурма ${island.name}`);
    log(room, `Осталось действий: ${room.actionsLeft}.`);
    return { ok: true, result, fleetPending };
  }
  room.pendingBattle = {
    id: crypto.randomUUID(), kind: 'assault', attackerId: attacker.id, islandId: island.id,
    invites, targetPlayerId: owner?.id || null,
    shipCarpenterPlayerIds: [...(combatOptions.shipCarpenterPlayerIds || [])],
  };
  const invitedAttackers = allianceNames(room, eligible.attackerInvites);
  const invitedDefenders = allianceNames(room, eligible.defenderInvites);
  log(room, `${attacker.name} объявляет штурм ${island.name}. ${invitedAttackers ? `К атаке приглашены: ${invitedAttackers}. ` : ''}${invitedDefenders ? `К защите приглашены: ${invitedDefenders}.` : ''}`);
  return { ok: true, pending: true };
}

function resolvePendingLegendaryReaction(room, useVeil, cardRef = null) {
  const pending = room?.pendingLegendaryReaction;
  if (!pending) return { ok: false, error: 'Реакция больше не ожидается.' };
  const target = playerById(room, pending.targetPlayerId);
  const source = playerById(room, pending.sourcePlayerId);
  if (!target || !source) return { ok: false, error: 'Участник реакции не найден.' };

  if (useVeil) {
    const found = peekLegendaryCard(target, cardRef);
    if (!found || found.kind !== 'sea-veil') return { ok: false, error: 'Выберите доступную карту «Покров моря».' };
    consumeLegendaryCard(room, target, cardRef);

    if (pending.kind === 'sea-curse') {
      applySeaVeilHostileReactionToShip(target, source.id);
      log(room, `${target.name} реакцией разыгрывает «Покров моря» против «Морского проклятия» ${source.name}. Обе легендарные карты расходованы; трёхходовая защита не начинается, реактивная защита действует только до конца текущего хода ${source.name}.`);
    } else if (pending.kind === 'hellfire') {
      const island = room.islands.find(i => i.id === pending.islandId);
      if (!island) return { ok: false, error: 'Остров реакции не найден.' };
      applySeaVeilHostileReactionToIsland(island, target, source.id);
      log(room, `${target.name} реакцией разыгрывает «Покров моря» против «Пламени Ада» ${source.name}. Обе легендарные карты расходованы; ${island.name} защищён только до конца текущего хода ${source.name}, без трёх следующих личных ходов.`);
    } else if (pending.kind === 'sea-attack') {
      applySeaVeilToShip(target, { sourcePlayerId: target.id, ignoreCurrentTurn: false });
      log(room, `${target.name} реакцией разыгрывает «Покров моря». Морская атака ${source.name} отменена; корабль защищён на ${BALANCE.legendaryEffects['sea-veil'].durationPersonalTurns} следующих личных хода ${target.name}.`);
    } else {
      const island = room.islands.find(i => i.id === pending.islandId);
      if (!island) return { ok: false, error: 'Остров реакции не найден.' };
      applySeaVeilToIsland(island, target, { ignoreCurrentTurn: false });
      log(room, `${target.name} реакцией разыгрывает «Покров моря». Штурм ${source.name} отменён; ${island.name} защищён на ${BALANCE.legendaryEffects['sea-veil'].durationPersonalTurns} следующих личных хода ${target.name}.`);
    }
    room.pendingLegendaryReaction = null;
    return { ok: true, canceled: true };
  }

  room.pendingLegendaryReaction = null;
  if (pending.kind === 'sea-attack') {
    return beginSeaBattleResolution(room, source, target, pending.inviteAllies, { shipCarpenterPlayerIds: pending.shipCarpenterPlayerIds || [] });
  }
  if (pending.kind === 'assault') {
    const island = room.islands.find(i => i.id === pending.islandId);
    return beginAssaultResolution(room, source, island, pending.inviteAllies, { shipCarpenterPlayerIds: pending.shipCarpenterPlayerIds || [] });
  }
  if (pending.kind === 'sea-curse') {
    const result = applySeaCurse(target, source.id);
    if (!result.ok) return result;
    log(room, `${source.name} накладывает «Морское проклятие» на ${target.name}: обычная дальность движения −${BALANCE.legendaryEffects['sea-curse'].amount} в каждом из ${BALANCE.legendaryEffects['sea-curse'].durationPersonalTurns} следующих личных ходов цели.`);
    return { ok: true, result };
  }
  if (pending.kind === 'hellfire') {
    const island = room.islands.find(i => i.id === pending.islandId);
    const result = applyHellfire(room, source, island);
    if (!result.ok) return result;
    const detail = result.changed
      ? result.changes.map(x => x.removed ? `${x.beforeName} → удалено` : `${x.beforeName} → ${x.afterName}`).join(', ')
      : 'построек нет';
    log(room, `${source.name}: «Пламя Ада» поражает ${island.name}: ${detail}.`);
    return { ok: true, result };
  }
  return { ok: false, error: 'Неизвестный тип реакции.' };
}

function resolvePendingBattle(room) {
  const pending = room.pendingBattle;
  if (!pending || !allBattleInvitesAnswered(pending)) return null;
  const attacker = playerById(room, pending.attackerId);
  let result;
  if (pending.kind === 'sea') {
    const defender = playerById(room, pending.targetPlayerId);
    const attackerIds = [attacker.id, ...acceptedIds(pending, 'attacker')];
    result = jointSeaBattle(room, attacker, defender, acceptedIds(pending, 'attacker'), acceptedIds(pending, 'defender'), {
      skipAttackRegistrationIds: attackerIds,
      shipCarpenterPlayerIds: pending.shipCarpenterPlayerIds || [],
    });
    if (result.ok) {
      chargeBattleCharacterCosts(room, result);
      logSeaBattleResult(room, attacker, defender, result);
    }
  } else {
    const island = room.islands.find(i => i.id === pending.islandId);
    const attackerIds = island.ownerId ? [attacker.id, ...acceptedIds(pending, 'attacker')] : [];
    result = jointAssaultIsland(room, attacker, island, acceptedIds(pending, 'attacker'), acceptedIds(pending, 'defender'), {
      skipAttackRegistrationIds: attackerIds,
      shipCarpenterPlayerIds: pending.shipCarpenterPlayerIds || [],
    });
    if (result.ok) {
      chargeBattleCharacterCosts(room, result);
      logAssaultResult(room, attacker, island, result);
      if (result.outcome === 'attacker') {
        const capturePending = queueCaptureRetentionFromAssault(room, attacker, island, result);
        if (!capturePending) queueStatePrizeFromAssault(room, attacker, result);
        refreshPoliticsWithLog(room);
      }
    }
  }
  if (!result?.ok) log(room, `Совместный бой не удалось разрешить: ${result?.error || 'неизвестная ошибка'}`);
  room.pendingBattle = null;
  if (result?.ok) {
    const reason = pending.kind === 'sea' ? 'Потеря уровня после совместного морского боя.' : 'Потеря уровня после совместного штурма.';
    const fleetPending = queueFleetAdjustmentsForLosses(room, result.levelLosses, reason);
    if (!fleetPending) queueIslandCorrectionIfNeeded(room, null, 'последствия совместного боя');
  }
  return result;
}

function handleAnchorAction(room, player) {
  const result = resolveAnchorEncounter(room, player);
  if (!result?.ok || !result.triggered) return result;
  room.actionsLeft = Math.max(0, (Number(room.actionsLeft) || 0) - (result.actionCost || 0));
  const card = result.card;
  if (result.outcome === 'quiet') {
    log(room, `${player.name} открывает карту ${result.anchor.name.toLowerCase()}: «${card.name}». Действие не расходуется.`);
    return result;
  }
  if (result.outcome === 'win') {
    const credit = result.reward;
    const debtText = credit?.debtPaid ? ` Из награды ${credit.debtPaid} уходит в погашение долга; в казну ${credit.net}.` : '';
    log(room, `${player.name}: ${result.anchor.name}, «${card.name}» (артиллерия ${card.artillery}). Флотилия ${result.fleetPower} — победа: награда ${card.reward} дукатов, очки флота +${result.fleetPoints}.${debtText} Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, player, { type: 'anchor-win', color: result.anchor.color || anchorAt(player.row, player.col)?.color });
  } else if (result.outcome === 'loss') {
    const p = result.penalty;
    const debtText = p.addedDebt ? ` Недостающие ${p.addedDebt} записаны в долг; общий долг ${p.debt}.` : '';
    log(room, `${player.name}: ${result.anchor.name}, «${card.name}» (артиллерия ${card.artillery}). Флотилия ${result.fleetPower} — поражение: штраф ${p.required} дукатов, уплачено ${p.paid}.${debtText} Уровень корабля не снижается. Осталось действий: ${room.actionsLeft}.`);
  } else {
    log(room, `${player.name}: ${result.anchor.name}, «${card.name}» — ничья ${result.fleetPower}:${card.artillery}. Награды и иных последствий нет. Осталось действий: ${room.actionsLeft}.`);
  }
  return result;
}


function saveHeldEventCard(player, card, kind, extra = {}) {
  player.savedEventCards ||= [];
  const saved = {
    id: crypto.randomUUID(),
    kind,
    name: card?.name || 'Сохранённая карта',
    sourceDeck: 'event',
    sourceCard: card ? { ...card } : null,
    assignmentInstanceId: kind === 'treasure-cargo' ? (player.activeAssignment?.instanceId || null) : undefined,
    ...extra,
  };
  player.savedEventCards.push(saved);
  return saved;
}

function applyCurrentTurnEffect(room, player, effect, value) {
  // Events and feud cards drawn in the sixth circle affect that same personal turn (§3.4).
  // The fallback remains only for compatibility with legacy non-personal event-phase saves.
  const target = room.eventPhase?.personalTurn ? (player.activeTurnEffects ||= {}) : (player.nextTurnEffects ||= {});
  if (effect === 'moveBonus' || effect === 'movePenalty') {
    target[effect] = (Number(target[effect]) || 0) + (Number(value) || 0);
  } else {
    target[effect] = Boolean(value);
  }
}

function queueEventDecision(room, player, card, kind, options, extra = {}) {
  room.pendingEvent = {
    id: crypto.randomUUID(),
    playerId: player.id,
    cardName: card.name,
    kind,
    options: (options || []).map(o => ({ ...o })),
    eventCard: { ...card },
    origin: 'event-phase',
    ...extra,
  };
  room.eventPhase.currentPlayerId = player.id;
  room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: card.name, pending: true };
}

function resolveSailingEventCard(room, player, card) {
  if (!card) return { pending: false, holdEventCard: false };
  const resultBase = { pending: false, holdEventCard: false };

  if (card.type === 'treasure') {
    const treasure = drawTreasureCard(room);
    const treasureAssignmentInstanceId = player.activeAssignment?.instanceId || null;
    if (!treasure) {
      log(room, `${player.name}: «${card.name}», но колода сокровищ пуста.`);
      return resultBase;
    }
    if (treasure.multiplier) {
      const result = resolveMoneyTreasure(room, player, treasure);
      discardDeckCard(room.treasureDeck, treasure);
      trackAssignment(room, player, { type: 'treasure-resolved', assignmentInstanceId: treasureAssignmentInstanceId });
      const debtText = result.credit.debtPaid ? `; ${result.credit.debtPaid} ушло в погашение долга` : '';
      log(room, `${player.name}: «${card.name}» → сокровище «${treasure.name}». Доход рынков/банков ${result.income}; получено ${result.amount} дукатов${debtText}.`);
      return resultBase;
    }
    const holds = emptyCargoHolds(room, player);
    if (!holds.length) {
      discardDeckCard(room.treasureDeck, treasure);
      trackAssignment(room, player, { type: 'treasure-resolved', assignmentInstanceId: treasureAssignmentInstanceId });
      log(room, `${player.name}: «${card.name}» → «${treasure.name}». Все трюмы заняты; карта сокровища сброшена без эффекта.`);
      return resultBase;
    }
    if (holds.length === 1) {
      const loaded = fillCargoDirect(room, player, treasure.cargoGoodId, holds[0].id);
      discardDeckCard(room.treasureDeck, treasure);
      trackAssignment(room, player, { type: 'treasure-resolved', assignmentInstanceId: treasureAssignmentInstanceId });
      log(room, `${player.name}: «${card.name}» → «${treasure.name}». ${loaded.holdName} заполнен товаром «${loaded.good.name}» ×${loaded.quantity}.`);
      return resultBase;
    }
    queueEventDecision(room, player, card, 'cargo', holds, { goodId: treasure.cargoGoodId, treasureCard: { ...treasure }, treasureAssignmentInstanceId });
    log(room, `${player.name}: «${card.name}» → «${treasure.name}». Нужно выбрать один пустой трюм.`);
    return { pending: true, holdEventCard: false };
  }

  if (card.type === 'legendary') {
    const legendary = drawLegendaryCard(room);
    if (legendary) {
      player.legendaryCards ||= [];
      player.legendaryCards.push(legendary);
      log(room, `${player.name}: «${card.name}». Случайно получена легендарная карта «${legendary.name}».`);
    }
    return resultBase;
  }

  if (card.type === 'found-cargo') {
    const holds = emptyCargoHolds(room, player);
    const goodName = GOODS[card.goodId]?.name || card.goodId;
    if (!holds.length) {
      saveHeldEventCard(player, card, 'found-cargo', { goodId: card.goodId });
      log(room, `${player.name}: «${card.name}». Пустого трюма нет; карта сохранена в закрытой руке.`);
      return { pending: false, holdEventCard: true };
    }
    if (holds.length === 1) {
      const loaded = fillCargoDirect(room, player, card.goodId, holds[0].id);
      log(room, `${player.name}: «${card.name}». ${loaded.holdName} заполнен товаром «${goodName}» ×${loaded.quantity}.`);
      return resultBase;
    }
    queueEventDecision(room, player, card, 'cargo', holds, { goodId: card.goodId });
    log(room, `${player.name}: «${card.name}». Нужно выбрать один пустой трюм.`);
    return { pending: true, holdEventCard: false };
  }

  if (card.type === 'save-card') {
    saveHeldEventCard(player, card, card.savedKind);
    log(room, `${player.name}: «${card.name}». Карта сохранена в закрытой руке для позднего применения.`);
    return { pending: false, holdEventCard: true };
  }

  if (card.type === 'special-card') {
    player.specialCards ||= [];
    player.specialCards.push(card.cardName);
    log(room, `${player.name}: «${card.name}». Получена одноразовая карта «${card.cardName}».`);
    return resultBase;
  }

  if (card.type === 'turn-effect') {
    applyCurrentTurnEffect(room, player, card.effect, card.value);
    const descriptions = {
      moveBonus: `к обычной навигации +${card.value}`,
      movePenalty: `к обычной навигации −${card.value}`,
      bestOfTwo: 'при навигации два d6, используется лучший',
      noNavigation: 'обычная навигация запрещена',
      noIncome: 'доход рынков и банков не начисляется',
    };
    log(room, `${player.name}: «${card.name}». В этом личном ходу: ${descriptions[card.effect] || 'временный эффект'}.`);
    return resultBase;
  }

  if (card.type === 'raid') {
    const options = raidBuildingOptions(room, player);
    if (!options.length) {
      log(room, `${player.name}: «${card.name}». Своих построек нет — карта ничего не делает.`);
      return resultBase;
    }
    queueEventDecision(room, player, card, 'raid', options);
    log(room, `${player.name}: «${card.name}». Нужно выбрать одну свою постройку для понижения на одну строительную ступень.`);
    return { pending: true, holdEventCard: false };
  }

  if (card.type === 'boarding') {
    const options = boardingUpgradeOptions(player);
    if (!options.length) {
      log(room, `${player.name}: «${card.name}». Установленных улучшений нет — карта ничего не делает.`);
      return resultBase;
    }
    queueEventDecision(room, player, card, 'boarding', options);
    log(room, `${player.name}: «${card.name}». Нужно снять одно установленное улучшение корабля.`);
    return { pending: true, holdEventCard: false };
  }

  if (card.type === 'storm') {
    const island = room.islands.find(i => i.id === card.islandId);
    const options = stormCellOptions(room, player, card.islandId);
    if (!options.length) {
      log(room, `${player.name}: «${card.name}». Для класса корабля нет допустимой клетки назначения.`);
      return resultBase;
    }
    if (options.length === 1) {
      player.row = options[0].row; player.col = options[0].col;
      handleArrival(room, player);
      log(room, `${player.name}: «${card.name}». Флотилия немедленно перенесена к берегу ${island?.name || 'острова'}.`);
      return resultBase;
    }
    queueEventDecision(room, player, card, 'storm', options, { islandId: card.islandId });
    log(room, `${player.name}: «${card.name}». Нужно выбрать допустимую клетку берега ${island?.name || 'острова'}.`);
    return { pending: true, holdEventCard: false };
  }

  if (card.type === 'treasury-loss') {
    const before = Math.max(0, Math.floor(Number(player.ducats) || 0));
    const loss = Math.floor(before * (Number(card.percent) || 0) / 100);
    player.ducats = before - loss;
    log(room, `${player.name}: «${card.name}». Потеряно ${loss} дукатов (${card.percent}% казны).`);
    return resultBase;
  }

  log(room, `${player.name}: «${card.name}». Эффект карты пока не распознан.`);
  return resultBase;
}


function eventPoliticalSnapshot(room) {
  const snapshot = {};
  for (const player of room.players || []) {
    snapshot[player.id] = {
      suzerainId: player.suzerainId || null,
      enemyFactionIds: [...(player.enemyFactionIds || [])],
      hadAssignment: Boolean(player.activeAssignment),
    };
  }
  return snapshot;
}

function applyVassalTaxForTurn(room, snapshot, playerId) {
  const player = playerById(room, playerId);
  const suzerainId = snapshot?.[playerId]?.suzerainId || null;
  if (!player || !suzerainId) return null;

  const result = settleVassalTax(player, suzerainId);
  if (!result?.applies) return result;

  if (result.underpaid) {
    log(room, `${player.name}: налог ${result.factionName} — уплачено ${result.paid} из ${result.due}. Долг не возникает; в этом личном ходу максимум ${result.actionLimit} действия.`);
  } else {
    log(room, `${player.name} платит налог ${result.factionName}: ${result.due} дуката.`);
  }
  return result;
}

function buildFeudQueue(room, snapshot) {
  const queue = [];
  for (const playerId of room.order || []) {
    for (const factionId of POLITICAL_FACTION_ORDER) {
      if ((snapshot?.[playerId]?.enemyFactionIds || []).includes(factionId)) queue.push({ playerId, factionId });
    }
  }
  return queue;
}

function queueFeudDecision(room, player, factionId, card, kind, options, extra = {}) {
  room.pendingFeud = {
    id: crypto.randomUUID(), playerId: player.id, factionId, cardName: card.name, kind,
    options: (options || []).map(o => ({ ...o })), feudCard: { ...card }, ...extra,
  };
  room.eventPhase.currentPlayerId = player.id;
  room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: card.name, factionId, factionName: FACTIONS[factionId]?.name, pending: true, source: 'feud' };
}

function removeCargoByHold(player, holdId) {
  if (holdId === 'main') {
    if (!player.cargo) return null;
    const cargo = player.cargo; player.cargo = null; return cargo;
  }
  const escort = (player.escorts || []).find(e => e.id === holdId);
  if (!escort?.cargo) return null;
  const cargo = escort.cargo; escort.cargo = null; return cargo;
}

function canonicalFeudCard(factionId, rawCard) {
  if (!rawCard) return null;
  const canonical = (FEUD_CARDS[factionId] || []).find(card =>
    card.id === rawCard.masterCardId || card.id === rawCard.id
  );
  return canonical ? { ...rawCard, ...canonical, masterCardId: canonical.id } : rawCard;
}

function feudBuildingOptions(room, player, card, excludedOptions = []) {
  const excluded = new Set(excludedOptions || []);
  return politicalBuildingOptions(room, player, { buildingTypes: card?.buildingTypes || null })
    .filter(option => !excluded.has(`${option.islandId}:${option.buildingIndex}`));
}

function feudDowngradeText(result) {
  return result.removed
    ? `${result.beforeName} на ${result.island.name} удалено как исходная форма I`
    : `${result.beforeName} на ${result.island.name} понижено до ${result.afterName}`;
}

function resolveFeudCard(room, player, factionId, rawCard) {
  const card = canonicalFeudCard(factionId, rawCard);
  const factionName = FACTIONS[factionId]?.name || factionId;
  const immediate = { pending: false };
  if (!card) return immediate;

  if (card.type === 'none') {
    log(room, `${player.name}: карта вражды ${factionName} — «${card.name}». Эффекта нет.`);
    return immediate;
  }
  if (card.type === 'treasury-percent') {
    const before = Math.max(0, Math.floor(Number(player.ducats) || 0));
    const loss = Math.floor(before * (Number(card.percent) || 0) / 100);
    player.ducats = before - loss;
    log(room, `${player.name}: карта вражды ${factionName} — потеря ${loss} дукатов (${card.percent}% казны).`);
    return immediate;
  }
  if (card.type === 'treasury-flat') {
    const before = Math.max(0, Math.floor(Number(player.ducats) || 0));
    const loss = Math.min(before, Math.max(0, Number(card.amount) || 0));
    player.ducats = before - loss;
    log(room, `${player.name}: карта вражды ${factionName} — потеря ${loss} дукатов.`);
    return immediate;
  }
  if (card.type === 'skip-income') {
    applyCurrentTurnEffect(room, player, 'noIncome', true);
    log(room, `${player.name}: карта вражды ${factionName} — в этом личном ходу доход рынков и банков пропускается.`);
    return immediate;
  }
  if (card.type === 'movement-penalty') {
    applyCurrentTurnEffect(room, player, 'movePenalty', Math.max(0, Number(card.amount) || 0));
    log(room, `${player.name}: карта вражды ${factionName} — максимум обычной навигации в этом личном ходу уменьшается на ${Math.max(0, Number(card.amount) || 0)}.`);
    return immediate;
  }
  if (card.type === 'ship-level-loss') {
    const loss = loseShipLevel(room, player);
    log(room, `${player.name}: карта вражды ${factionName} — ${describeLevelLoss(room, { playerId: player.id, ...loss })}.`);
    return immediate;
  }
  if (card.type === 'discard-random-held') {
    const result = discardRandomHeldCard(room, player);
    log(room, result.discarded
      ? `${player.name}: карта вражды ${factionName} — случайно сброшена удерживаемая карта «${result.discarded.name}».`
      : `${player.name}: карта вражды ${factionName} — нет карты, которую этот эффект может сбросить; активное поручение защищено.`);
    return immediate;
  }
  if (card.type === 'reclaim-island') {
    const originalIds = new Set(FACTIONS[factionId]?.originalIslandIds || []);
    const options = room.islands.filter(i => i.ownerId === player.id && originalIds.has(i.id)).map(i => ({ islandId: i.id, name: i.name }));
    if (!options.length) {
      const loss = Math.min(Math.max(0, Number(player.ducats) || 0), Number(card.fallbackDucats) || BALANCE.reclaimIslandFallback);
      player.ducats -= loss;
      log(room, `${player.name}: ${factionName} не может вернуть исходный остров; вместо этого потеряно ${loss} дукатов.`);
      return immediate;
    }
    if (options.length === 1) {
      const island = room.islands.find(i => i.id === options[0].islandId);
      island.ownerId = null;
      refreshFactionExistence(room);
      log(room, `${player.name}: ${factionName} возвращает себе ${island.name} вместе с постройками.`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'reclaim-island', options);
    log(room, `${player.name}: ${factionName} возвращает один исходный остров. Нужно выбрать остров.`);
    return { pending: true };
  }
  if (card.type === 'downgrade-building') {
    const options = feudBuildingOptions(room, player, card);
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — подходящих построек нет.`); return immediate; }
    const count = Math.min(Math.max(1, Number(card.count) || 1), options.length);
    if (options.length <= count) {
      const results = [];
      const ordered = [...options].sort((a, b) => a.islandId.localeCompare(b.islandId) || b.buildingIndex - a.buildingIndex);
      for (const option of ordered) {
        const result = applyFeudBuildingDowngrade(room, player, option.islandId, option.buildingIndex);
        if (result.ok) results.push(feudDowngradeText(result));
      }
      log(room, `${player.name}: карта вражды ${factionName} — ${results.join('; ') || 'эффект не применён'}.`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'downgrade-building', options, { remaining: count, excludedOptions: [] });
    return { pending: true };
  }
  if (card.type === 'remove-building') {
    const options = politicalBuildingOptions(room, player, { buildingTypes: card.buildingTypes || null });
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — подходящих построек нет.`); return immediate; }
    if (options.length === 1) {
      const result = removePlayerBuilding(room, player, options[0].islandId, options[0].buildingIndex);
      log(room, `${player.name}: карта вражды ${factionName} удаляет ${result.name} на ${result.island.name}.`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'remove-building', options);
    return { pending: true };
  }
  if (card.type === 'building-downgrade') {
    const options = politicalBuildingOptions(room, player, { aboveLevelOne: true });
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — зданий выше I уровня нет.`); return immediate; }
    if (options.length === 1) {
      const result = applyRaidDowngrade(room, player, options[0].islandId, options[0].buildingIndex);
      log(room, `${player.name}: ${result.beforeName} на ${result.island.name} понижено до ${result.afterName}.`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'building-downgrade', options);
    return { pending: true };
  }
  if (card.type === 'building-choice') {
    const options = politicalBuildingOptions(room, player);
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — построек нет.`); return immediate; }
    queueFeudDecision(room, player, factionId, card, 'building-choice', options);
    return { pending: true };
  }
  if (card.type === 'remove-forts') {
    const options = politicalBuildingOptions(room, player, { fortsOnly: true });
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — фортов и крепостей нет.`); return immediate; }
    const count = Math.min(Math.max(1, Number(card.count) || 1), options.length);
    if (options.length <= count) {
      const names = [];
      for (const option of [...options].sort((a,b) => b.buildingIndex - a.buildingIndex)) {
        const result = removePlayerBuilding(room, player, option.islandId, option.buildingIndex);
        if (result.ok) names.push(`${result.name} (${result.island.name})`);
      }
      log(room, `${player.name}: карта вражды ${factionName} удаляет ${names.join(', ')}.`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'remove-forts', options, { remaining: count });
    return { pending: true };
  }
  if (card.type === 'remove-upgrade') {
    const options = politicalUpgradeOptions(player, card.branch || null);
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — подходящих улучшений нет.`); return immediate; }
    if (options.length === 1) {
      const result = applyBoardingLoss(player, options[0].id);
      log(room, `${player.name}: карта вражды ${factionName} снимает улучшение «${result.name}».`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'remove-upgrade', options);
    return { pending: true };
  }
  if (card.type === 'remove-cargo') {
    const options = politicalCargoOptions(room, player);
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — груза нет.`); return immediate; }
    if (options.length === 1) {
      const cargo = removeCargoByHold(player, options[0].id);
      log(room, `${player.name}: карта вражды ${factionName} уничтожает груз ${GOODS[cargo.goodId]?.name || cargo.goodId} ×${cargo.quantity}.`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'remove-cargo', options);
    return { pending: true };
  }
  log(room, `${player.name}: карта вражды ${factionName} «${card.name}» не потребовала эффекта.`);
  return immediate;
}

function canUseObservatoryEventReplacement(room, player) {
  const effect = BUILDINGS.observatory?.effect;
  if (!room?.eventPhase?.active || !player || effect?.type !== 'replace-event') return false;
  const limit = Math.max(0, Number(effect.limit) || 0);
  const used = Math.max(0, Number(room.eventPhase.observatoryReplacementsUsed) || 0);
  if (limit < 1 || used >= limit) return false;
  return hasOwnedBuilding(room, player.id, 'observatory');
}

function processEventPhase(room) {
  if (!room.eventPhase?.active || room.pendingEvent || room.pendingFeud || room.pendingAssignmentChoice || room.pendingIslandCorrection || room.pendingFleetAdjustment) return;
  if (queueEscortCapacityDecisionsIfNeeded(room)) return;
  let safety = 0;
  while (room.eventPhase.active && !room.pendingEvent && !room.pendingFeud && !room.pendingAssignmentChoice && !room.pendingIslandCorrection && !room.pendingFleetAdjustment && safety++ < 160) {
    if (queueEscortCapacityDecisionsIfNeeded(room)) return;
    if (room.eventPhase.stage === 'sailing') {
      const index = Number(room.eventPhase.playerIndex) || 0;
      const playerIds = room.eventPhase.personalTurn ? [room.eventPhase.turnPlayerId] : room.order;
      if (index >= playerIds.length) {
        room.eventPhase.stage = 'feud';
        room.eventPhase.feudIndex = 0;
        room.eventPhase.currentPlayerId = room.eventPhase.feudQueue?.[0]?.playerId || null;
        log(room, 'Фаза событий: карты плавания разрешены. Начинается выдача карт вражды по статусам, зафиксированным в начале фазы.');
        continue;
      }
      const playerId = playerIds[index];
      const player = playerById(room, playerId);
      room.eventPhase.currentPlayerId = playerId;
      if (!player) { room.eventPhase.playerIndex += 1; continue; }
      const card = drawSailingEventCard(room);
      if (!card) { log(room, `Фаза событий: для ${player.name} не удалось взять карту события.`); room.eventPhase.playerIndex += 1; continue; }
      room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: card.name, pending: false, source: 'sailing' };
      log(room, `Фаза событий: ${player.name} открывает «${card.name}».`);
      if (canUseObservatoryEventReplacement(room, player)) {
        room.pendingEvent = {
          id: crypto.randomUUID(), playerId: player.id, kind: 'observatory', cardName: card.name,
          eventCard: { ...card }, origin: 'event-phase',
          options: [{ id: 'keep', name: 'Оставить карту' }, { id: 'replace', name: 'Сбросить и взять вторую' }],
        };
        room.eventPhase.lastCard.pending = true;
        log(room, `${player.name}: Обсерватория позволяет оставить первую карту или сбросить её без применения и взять обязательную вторую.`);
        return;
      }
      const resolved = resolveSailingEventCard(room, player, card);
      if (resolved.pending) return;
      if (!resolved.holdEventCard) discardDeckCard(room.eventDeck, card);
      room.eventPhase.playerIndex += 1;
      continue;
    }

    if (room.eventPhase.stage === 'feud') {
      const index = Number(room.eventPhase.feudIndex) || 0;
      const queue = room.eventPhase.feudQueue || [];
      if (index >= queue.length) {
        room.eventPhase.stage = 'assignment';
        room.eventPhase.assignmentIndex = 0;
        room.eventPhase.currentPlayerId = room.eventPhase.assignmentQueue?.[0]?.playerId || null;
        log(room, 'Фаза событий: карты вражды разрешены. Начинается выдача поручений сюзерена.');
        continue;
      }
      const item = queue[index];
      const player = playerById(room, item.playerId);
      room.eventPhase.currentPlayerId = item.playerId;
      if (!player || !stateExists(room, item.factionId)) { room.eventPhase.feudIndex += 1; continue; }
      const drawn = drawFeudCard(room, item.factionId);
      if (!drawn) { room.eventPhase.feudIndex += 1; continue; }
      const card = canonicalFeudCard(item.factionId, drawn);
      room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: card.name, factionId: item.factionId, factionName: FACTIONS[item.factionId]?.name, pending: false, source: 'feud' };
      log(room, `Фаза событий: ${player.name} получает карту вражды от ${FACTIONS[item.factionId]?.name}: «${card.name}».`);
      const resolved = resolveFeudCard(room, player, item.factionId, card);
      if (resolved.pending) return;
      discardDeckCard(room.feudDecks[item.factionId], card);
      room.eventPhase.feudIndex += 1;
      if (queueFleetAdjustment(room, player, `Карта вражды ${FACTIONS[item.factionId]?.name || item.factionId}: «${card.name}».`)) return;
      if (queueIslandCorrectionIfNeeded(room, null, `карта вражды ${FACTIONS[item.factionId]?.name || item.factionId}: «${card.name}»`)) return;
      continue;
    }

    if (room.eventPhase.stage === 'assignment') {
      const index = Number(room.eventPhase.assignmentIndex) || 0;
      const queue = room.eventPhase.assignmentQueue || [];
      if (index >= queue.length) {
        finishEventPhase(room);
        return;
      }
      const item = queue[index];
      const player = playerById(room, item.playerId);
      room.eventPhase.currentPlayerId = item.playerId;
      room.eventPhase.assignmentIndex += 1;
      if (!player || player.suzerainId !== item.factionId || player.activeAssignment || !stateExists(room, item.factionId)) continue;
      if (hasOwnedBuilding(room, player.id, 'embassy')) {
        const offered = offerAssignmentCards(room, player, item.factionId, 2);
        if (!offered.ok || !offered.cards.length) {
          log(room, `${player.name}: у ${FACTIONS[item.factionId]?.name || item.factionId} сейчас нет подходящего поручения.`);
          continue;
        }
        if (offered.cards.length === 1) {
          const issued = chooseAssignmentOffer(room, player, item.factionId, offered.cards, offered.cards[0].id);
          room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: issued.assignment.card.text, factionId: item.factionId, factionName: FACTIONS[item.factionId]?.name, pending: false, source: 'assignment' };
          log(room, `${player.name}: Посольство нашло только одно допустимое поручение ${FACTIONS[item.factionId]?.name}: «${issued.assignment.card.text}».`);
          continue;
        }
        room.pendingAssignmentChoice = {
          id: crypto.randomUUID(), kind: 'embassy', playerId: player.id, factionId: item.factionId,
          options: offered.cards.map(card => ({ ...card })), canReplace: false, replaceError: null,
        };
        room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: 'Выбор поручения Посольством', factionId: item.factionId, factionName: FACTIONS[item.factionId]?.name, pending: true, source: 'assignment' };
        log(room, `${player.name}: Посольство даёт выбор из двух допустимых поручений ${FACTIONS[item.factionId]?.name}.`);
        return;
      }

      const issued = issueAssignment(room, player, item.factionId);
      if (!issued.ok) {
        log(room, `${player.name}: у ${FACTIONS[item.factionId]?.name || item.factionId} сейчас нет подходящего поручения.`);
        continue;
      }
      room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: issued.assignment.card.text, factionId: item.factionId, factionName: FACTIONS[item.factionId]?.name, pending: false, source: 'assignment' };
      log(room, `${player.name} получает поручение ${FACTIONS[item.factionId]?.name}: «${issued.assignment.card.text}». Награда ${issued.assignment.card.reward} дукатов.`);
      continue;
    }

    finishEventPhase(room);
  }
}

function startEventPhase(room) {
  const player = currentPlayer(room);
  if (!player) return;
  room.phase = 'event';
  room.roll = null;
  room.movePoints = null;
  room.actionsLeft = 0;
  room.pendingAlliance = null;
  room.pendingBattle = null;
  room.pendingEvent = null;
  room.pendingFeud = null;
  room.pendingAssignmentChoice = null;
  room.pendingFleetAdjustment = null;
  room.fleetAdjustmentQueue = [];
  room.pendingLegendaryReaction = null;
  const snapshot = { [player.id]: eventPoliticalSnapshot(room)[player.id] };
  room.eventPhase = {
    active: true, personalTurn: true, turnPlayerId: player.id, stage: 'sailing', playerIndex: 0, currentPlayerId: player.id, lastCard: null,
    observatoryReplacementsUsed: 0,
    politicalSnapshot: snapshot,
    feudQueue: buildFeudQueue(room, snapshot), feudIndex: 0,
    assignmentQueue: buildAssignmentQueue(room, snapshot), assignmentIndex: 0,
    replacementQueue: [], replacementIndex: 0,
  };
  log(room, `Раунд ${room.round}, шестой круг: ${player.name} получает карты перед своим личным ходом.`);
  room.eventPhase.taxResult = applyVassalTaxForTurn(room, snapshot, player.id);
  processEventPhase(room);
}

function finishEventPhase(room) {
  if (room.eventPhase?.personalTurn) {
    room.eventPhase.active = false;
    room.eventPhase = null;
    room.pendingEvent = null;
    room.pendingFeud = null;
    room.pendingAssignmentChoice = null;
    continueTurnAfterCards(room);
    return;
  }
  if (room.eventPhase) room.eventPhase.active = false;
  room.pendingEvent = null;
  room.pendingFeud = null;
  room.pendingAssignmentChoice = null;
  advanceRound(room);
  beginTurn(room);
}

function advanceRound(room) {
  room.round += 1;
  room.circle = 1;
  for (const island of room.islands) island.loadedRound = null;
  for (const player of room.players) {
    player.visitedAnchors = [];
    player.characterReplacedRound = null;
    player.fleetPointRound = room.round;
    player.fleetPointOpponentIds = [];
    player.armyPointRound = room.round;
    player.armyPointOpponentIds = [];
    player.attackLimitRound = room.round;
    player.attackCountsThisRound = {};
    player.expeditionsDrawnThisRound = 0;
  }
  refreshFactionExistence(room);
  log(room, `Начинается раунд ${room.round}: ограничения погрузки, отметки посещённых якорей и пары нападений «нападающий — игрок-цель» сброшены.`);
}

function finishPendingFeudCard(room, pending) {
  discardDeckCard(room.feudDecks[pending.factionId], pending.feudCard);
  const player = playerById(room, pending.playerId);
  room.eventPhase.lastCard = { playerId: pending.playerId, playerName: player?.name || 'Игрок', cardName: pending.cardName, factionId: pending.factionId, factionName: FACTIONS[pending.factionId]?.name, pending: false, source: 'feud' };
  room.pendingFeud = null;
  room.eventPhase.feudIndex += 1;
  const reason = `карта вражды ${FACTIONS[pending.factionId]?.name || pending.factionId}: «${pending.cardName}»`;
  if (player && queueFleetAdjustment(room, player, reason)) return;
  if (!queueIslandCorrectionIfNeeded(room, null, reason)) processEventPhase(room);
}

function completePendingFeud(room, pending, choice) {
  const player = playerById(room, pending.playerId);
  if (!player) return { ok: false, error: 'Игрок карты вражды не найден.' };
  const factionName = FACTIONS[pending.factionId]?.name || pending.factionId;
  if (pending.kind === 'downgrade-building') {
    const selected = (pending.options || []).find(o => o.islandId === choice?.islandId && o.buildingIndex === Number(choice?.buildingIndex));
    if (!selected) return { ok: false, error: 'Недопустимая постройка.' };
    const result = applyFeudBuildingDowngrade(room, player, selected.islandId, selected.buildingIndex);
    if (!result.ok) return result;
    log(room, `${player.name}: карта вражды ${factionName} — ${feudDowngradeText(result)}.`);
    const remaining = Math.max(0, (Number(pending.remaining) || 1) - 1);
    pending.excludedOptions ||= [];
    if (!result.removed) pending.excludedOptions.push(`${selected.islandId}:${selected.buildingIndex}`);
    const options = feudBuildingOptions(room, player, pending.feudCard, pending.excludedOptions);
    if (remaining > 0 && options.length) {
      pending.remaining = Math.min(remaining, options.length);
      pending.options = options;
      return { ok: true, pending: true };
    }
  } else if (pending.kind === 'remove-building') {
    const selected = (pending.options || []).find(o => o.islandId === choice?.islandId && o.buildingIndex === Number(choice?.buildingIndex));
    if (!selected) return { ok: false, error: 'Недопустимая постройка.' };
    const result = removePlayerBuilding(room, player, selected.islandId, selected.buildingIndex);
    if (!result.ok) return result;
    log(room, `${player.name}: карта вражды ${factionName} удаляет ${result.name} на ${result.island.name}.`);
  } else if (pending.kind === 'reclaim-island') {
    const island = room.islands.find(i => i.id === choice?.islandId && i.ownerId === player.id && (FACTIONS[pending.factionId]?.originalIslandIds || []).includes(i.id));
    if (!island) return { ok: false, error: 'Недопустимый остров.' };
    island.ownerId = null; refreshFactionExistence(room);
    log(room, `${player.name}: ${factionName} возвращает себе ${island.name} вместе с постройками.`);
  } else if (pending.kind === 'building-downgrade') {
    const result = applyRaidDowngrade(room, player, choice?.islandId, choice?.buildingIndex);
    if (!result.ok) return result;
    log(room, `${player.name}: ${result.beforeName} на ${result.island.name} понижено до ${result.afterName}.`);
  } else if (pending.kind === 'building-choice') {
    const mode = String(choice?.mode || '');
    if (mode === 'delete') {
      const result = removePlayerBuilding(room, player, choice?.islandId, choice?.buildingIndex);
      if (!result.ok) return result;
      log(room, `${player.name}: карта вражды ${factionName} удаляет ${result.name} на ${result.island.name}.`);
    } else if (mode === 'downgrade') {
      const result = applyRaidDowngrade(room, player, choice?.islandId, choice?.buildingIndex);
      if (!result.ok) return result;
      log(room, `${player.name}: карта вражды ${factionName} понижает ${result.beforeName} на ${result.island.name} до ${result.afterName}.`);
    } else return { ok: false, error: 'Выберите удаление или понижение.' };
  } else if (pending.kind === 'remove-forts') {
    const option = (pending.options || []).find(o => o.islandId === choice?.islandId && o.buildingIndex === Number(choice?.buildingIndex));
    if (!option) return { ok: false, error: 'Недопустимое укрепление.' };
    const result = removePlayerBuilding(room, player, option.islandId, option.buildingIndex);
    if (!result.ok) return result;
    log(room, `${player.name}: карта вражды ${factionName} удаляет ${result.name} на ${result.island.name}.`);
    const remaining = Math.max(0, (Number(pending.remaining) || 1) - 1);
    const options = politicalBuildingOptions(room, player, { fortsOnly: true });
    if (remaining > 0 && options.length) {
      pending.remaining = Math.min(remaining, options.length);
      pending.options = options;
      return { ok: true, pending: true };
    }
  } else if (pending.kind === 'remove-upgrade') {
    const result = applyBoardingLoss(player, choice?.upgradeId);
    if (!result.ok) return result;
    log(room, `${player.name}: карта вражды ${factionName} снимает улучшение «${result.name}».`);
  } else if (pending.kind === 'remove-cargo') {
    const option = (pending.options || []).find(o => o.id === choice?.holdId);
    if (!option) return { ok: false, error: 'Недопустимый трюм.' };
    const cargo = removeCargoByHold(player, option.id);
    if (!cargo) return { ok: false, error: 'В выбранном трюме уже нет груза.' };
    log(room, `${player.name}: карта вражды ${factionName} уничтожает груз ${GOODS[cargo.goodId]?.name || cargo.goodId} ×${cargo.quantity}.`);
  } else return { ok: false, error: 'Неизвестное решение карты вражды.' };

  finishPendingFeudCard(room, pending);
  return { ok: true };
}


function continueAfterObservedSailingCard(room, player, card) {
  if (!card) {
    room.pendingEvent = null;
    room.eventPhase.playerIndex += 1;
    processEventPhase(room);
    return { ok: true, empty: true };
  }
  room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: card.name, pending: false, source: 'sailing' };
  const resolved = resolveSailingEventCard(room, player, card);
  if (resolved.pending) return { ok: true, pending: true };
  if (!resolved.holdEventCard) discardDeckCard(room.eventDeck, card);
  room.pendingEvent = null;
  room.eventPhase.playerIndex += 1;
  processEventPhase(room);
  return { ok: true, pending: false };
}

function finishPendingEvent(room, pending) {
  const origin = pending.origin || 'event-phase';
  if (origin === 'event-phase') {
    if (pending.eventCard) discardDeckCard(room.eventDeck, pending.eventCard);
    room.pendingEvent = null;
    if (room.eventPhase?.active) {
      room.eventPhase.lastCard = { playerId: pending.playerId, playerName: playerById(room, pending.playerId)?.name || 'Игрок', cardName: pending.cardName, pending: false, source: 'sailing' };
      room.eventPhase.playerIndex += 1;
      if (!queueIslandCorrectionIfNeeded(room, null, `событие плавания «${pending.cardName}»`)) processEventPhase(room);
    }
  } else {
    room.pendingEvent = null;
    drainExpeditionTreasureRewards(room);
  }
}

function completePendingEvent(room, pending) {
  const player = playerById(room, pending.playerId);
  if (!player) return { ok: false, error: 'Игрок карты события не найден.' };
  const choice = pending.choice || {};
  if (pending.kind === 'cargo') {
    const result = fillCargoDirect(room, player, pending.goodId, choice.holdId);
    if (!result.ok) return result;
    if (pending.treasureCard) {
      discardDeckCard(room.treasureDeck, pending.treasureCard);
      trackAssignment(room, player, { type: 'treasure-resolved', assignmentInstanceId: pending.treasureAssignmentInstanceId || null });
    }
    log(room, `${player.name}: «${pending.cardName}». ${result.holdName} заполнен товаром «${result.good.name}» ×${result.quantity}.`);
  } else if (pending.kind === 'raid') {
    const result = applyRaidDowngrade(room, player, choice.islandId, choice.buildingIndex);
    if (!result.ok) return result;
    log(room, result.removed
      ? `${player.name}: «${pending.cardName}». ${result.beforeName} на ${result.island.name} удалено как исходная форма I.`
      : `${player.name}: «${pending.cardName}». ${result.beforeName} на ${result.island.name} понижено до ${result.afterName}.`);
  } else if (pending.kind === 'boarding') {
    const result = applyBoardingLoss(player, choice.upgradeId);
    if (!result.ok) return result;
    const cargoText = result.cargoDiscarded ? ` Вместимость уменьшилась; потеряно единиц груза: ${result.cargoDiscarded}.` : '';
    log(room, `${player.name}: «${pending.cardName}». Снято улучшение «${result.name}».${cargoText}`);
  } else if (pending.kind === 'storm') {
    const option = (pending.options || []).find(o => o.row === choice.row && o.col === choice.col);
    if (!option) return { ok: false, error: 'Недопустимая клетка шторма.' };
    player.row = option.row; player.col = option.col;
    handleArrival(room, player);
    const island = room.islands.find(i => i.id === pending.islandId);
    log(room, `${player.name}: «${pending.cardName}». Флотилия немедленно перенесена к берегу ${island?.name || 'острова'}.`);
  } else return { ok: false, error: 'Неизвестный тип решения события.' };
  finishPendingEvent(room, pending);
  return { ok: true };
}

function discardSavedCardToDeck(room, saved) {
  if (!saved?.sourceCard) return;
  if (saved.sourceDeck === 'treasure') discardDeckCard(room.treasureDeck, saved.sourceCard);
  else discardDeckCard(room.eventDeck, saved.sourceCard);
}

function takeSavedCard(player, savedCardId) {
  const index = (player.savedEventCards || []).findIndex(c => c.id === savedCardId);
  if (index < 0) return null;
  return { card: player.savedEventCards[index], index };
}

function determineOrder(room) {
  const seats = room.seatingOrder || room.players.map(p => p.id);
  const leaderIndex = seats.indexOf(room.leaderId);
  return [...seats.slice(leaderIndex), ...seats.slice(0, leaderIndex)];
}

function beginTurn(room) {
  room.phase = 'navigation';
  room.roll = null;
  room.movePoints = null;
  room.actionsLeft = BALANCE.session.actionsPerTurn;
  const p = currentPlayer(room);
  if (!p) return;

  p.personalTurnNo = (Number(p.personalTurnNo) || 0) + 1;
  p.brokenAlliesThisTurn = [];
  p.activeTurnEffects = { ...(p.nextTurnEffects || {}) };
  p.nextTurnEffects = {};
  if (room.circle === BALANCE.session.eventCircle) {
    startEventPhase(room);
    return;
  }
  continueTurnAfterCards(room);
}

function continueTurnAfterCards(room) {
  const p = currentPlayer(room);
  if (!p) return;
  room.phase = 'navigation';
  room.roll = null;
  room.movePoints = null;
  const configuredActionLimit = Number(p.nextActionLimit);
  const actionLimit = Math.max(0, Math.min(
    BALANCE.session.actionsPerTurn,
    Number.isFinite(configuredActionLimit) && configuredActionLimit >= 0 ? configuredActionLimit : BALANCE.session.actionsPerTurn
  ));
  room.actionsLeft = actionLimit;
  p.nextActionLimit = null;
  if (actionLimit < BALANCE.session.actionsPerTurn) log(room, `${p.name}: из-за недоплаченного налога в этом личном ходу доступно максимум ${actionLimit} действия.`);

  if ((Number(p.skipTurns) || 0) > 0) {
    p.skipTurns -= 1;
    log(room, `${p.name} пропускает личный ход из-за ничьей в бою.`);
    endTurnInternal(room);
    return;
  }

  const noIncome = Boolean(p.activeTurnEffects?.noIncome);
  const income = marketIncomeForPlayer(room, p.id);
  if (noIncome) {
    log(room, `${p.name}: эффект текущего хода отменяет доход рынков и банков.`);
  } else if (income > 0) {
    const credit = creditDucats(p, income);
    const debtText = credit.debtPaid ? ` (${credit.debtPaid} в погашение долга, ${credit.net} в казну)` : '';
    log(room, `${p.name} получает ${income} дукатов дохода от рынков и банков${debtText}.`);
  }

  if (p.activeTurnEffects?.noNavigation) {
    room.phase = 'actions';
    room.movePoints = 0;
    log(room, `Ход: ${p.name}. Из-за «Поломки» обычная навигация недоступна; сразу начинается фаза действий.`);
    return;
  }

  const effects = [];
  if (p.activeTurnEffects?.moveBonus) effects.push(`попутный ветер +${p.activeTurnEffects.moveBonus}`);
  if (p.activeTurnEffects?.movePenalty) effects.push(`штраф движения −${p.activeTurnEffects.movePenalty}`);
  if (p.activeTurnEffects?.bestOfTwo) effects.push('Удача Фортуны: два d6');
  log(room, `Ход: ${p.name}. Навигация.${effects.length ? ` Эффекты: ${effects.join(', ')}.` : ''}`);
}

function endTurnInternal(room) {
  const n = room.order.length;
  if (!n) return;
  const ending = currentPlayer(room);
  if (ending) {
    ending.activeTurnEffects = {};
    clearSeaVeilHostileReactionsAtTurnEnd(room, ending.id);
    const tick = tickLegendaryEffectsForPlayer(room, ending);
    for (const expired of tick.expired || []) log(room, `${ending.name}: заканчивается эффект «${expired}».`);
  }
  room.completedTurns += 1;
  room.turnIndex = (room.turnIndex + 1) % n;
  if (room.completedTurns % n === 0) {
    room.circle += 1;
    if (room.circle > BALANCE.session.circlesPerRound) {
      advanceRound(room);
    }
  }
  beginTurn(room);
}

function applyFreeClaimReward(room, player, island) {
  if (island.rewardClaimed) return;
  const rules = require('./rules');
  const reward = rules.islands.find(def => def.id === island.id)?.reward;
  if (!reward || reward.trigger !== 'first-acquisition') return;
  if (reward.legendaryCardId) {
    const card = rules.legends.legendary.find(def => def.id === reward.legendaryCardId);
    player.specialCards ||= [];
    player.specialCards.push(card.name);
    island.rewardClaimed = true;
    log(room, `${player.name} получает одноразовую карту «${card.name}» за ${island.name}.`);
  }
  for (const spec of reward.buildings || []) {
    island.buildings.push({ ...spec, createdAt: Date.now(), reward: true });
    island.rewardClaimed = true;
    log(room, `${player.name} получает ${buildingDisplayName(spec)} на острове ${island.name}.`);
  }
}


function logLegendaryDiscovery(room, player, discovery) {
  if (!discovery?.first) return;
  const placeKind = discovery.place.kind === 'island' ? 'легендарный остров' : 'легендарное морское место';
  const named = discovery.namedCard ? ` Именная карта «${discovery.namedCard.name}» остаётся у первооткрывателя ${player.name}.` : '';
  const legendary = discovery.legendaryCard ? ` За первое открытие получена случайная легендарная карта «${discovery.legendaryCard.name}».` : '';
  log(room, `${player.name} первым открывает ${placeKind} «${discovery.place.name}».${named}${legendary}`);
}

function handleLegendaryPlaceStop(room, player) {
  const mapPlace = legendaryPlaceAt(player.row, player.col);
  let place = mapPlace ? legendaryPlaceRule(mapPlace.id) : null;
  if (!place) {
    const island = (room.islands || []).find(item => playerOnIsland(player, item) && legendaryPlaceForIsland(item.id));
    if (island) place = legendaryPlaceForIsland(island.id);
  }
  if (!place) return null;

  if (place.kind === 'sea') trackAssignment(room, player, { type: 'visit-place', placeId: place.id });
  const discovery = claimLegendaryPlaceDiscovery(room, player, place.id);
  if (!discovery?.first) return { place, first: false, discovery };
  logLegendaryDiscovery(room, player, discovery);
  return { place, first: true, discovery };
}

function resolveExpeditionTreasureReward(room, player, reward) {
  const label = reward?.expeditionName || 'экспедиция';
  const treasureAssignmentInstanceId = reward?.treasureAssignmentInstanceId || null;
  const treasure = drawTreasureCard(room);
  if (!treasure) {
    log(room, `${player.name}: экспедиция «${label}» завершена, но колода сокровищ пуста.`);
    return { pending: false, empty: true };
  }
  if (treasure.multiplier) {
    const result = resolveMoneyTreasure(room, player, treasure);
    discardDeckCard(room.treasureDeck, treasure);
    trackAssignment(room, player, { type: 'treasure-resolved', assignmentInstanceId: treasureAssignmentInstanceId });
    log(room, `${player.name}: экспедиция «${label}» даёт сокровище «${treasure.name}», получено ${result.amount} дукатов.`);
    return { pending: false, treasure };
  }

  const holds = emptyCargoHolds(room, player);
  if (!holds.length) {
    discardDeckCard(room.treasureDeck, treasure);
    trackAssignment(room, player, { type: 'treasure-resolved', assignmentInstanceId: treasureAssignmentInstanceId });
    log(room, `${player.name}: экспедиция «${label}» даёт «${treasure.name}». Все трюмы заняты; карта сокровища сброшена без эффекта.`);
    return { pending: false, treasure };
  }
  if (holds.length === 1) {
    const loaded = fillCargoDirect(room, player, treasure.cargoGoodId, holds[0].id);
    discardDeckCard(room.treasureDeck, treasure);
    trackAssignment(room, player, { type: 'treasure-resolved', assignmentInstanceId: treasureAssignmentInstanceId });
    log(room, `${player.name}: экспедиция «${label}» даёт «${treasure.name}». ${loaded.holdName} заполнен товаром «${loaded.good.name}» ×${loaded.quantity}.`);
    return { pending: false, treasure };
  }

  room.pendingEvent = {
    id: crypto.randomUUID(),
    playerId: player.id,
    kind: 'cargo',
    cardName: `Экспедиция «${label}»: ${treasure.name}`,
    options: holds.map(o => ({ ...o })),
    goodId: treasure.cargoGoodId,
    treasureCard: { ...treasure },
    treasureAssignmentInstanceId,
    origin: 'expedition',
  };
  log(room, `${player.name}: экспедиция «${label}» даёт «${treasure.name}». Нужно выбрать пустой трюм.`);
  return { pending: true, treasure };
}

function drainExpeditionTreasureRewards(room) {
  if (room.pendingEvent) return true;
  room.pendingExpeditionRewards ||= [];
  while (room.pendingExpeditionRewards.length) {
    const queued = room.pendingExpeditionRewards.shift();
    const player = playerById(room, queued.playerId);
    if (!player) continue;
    const result = resolveExpeditionTreasureReward(room, player, queued);
    if (result.pending) return true;
  }
  return false;
}

function handleExpeditionArrival(room, player) {
  const completion = completeExpeditionAtArrival(room, player);
  if (!completion?.completed) return completion;
  const name = completion.place?.name || completion.card?.name || 'экспедиция';
  log(room, `${player.name} завершает экспедицию «${name}» без расхода действия. Карта экспедиции возвращена в колоду; место добавлено в личную историю.`);
  room.pendingExpeditionRewards ||= [];
  room.pendingExpeditionRewards.push({
    playerId: player.id,
    expeditionName: name,
    treasureAssignmentInstanceId: player.activeAssignment?.instanceId || null,
  });
  if (!room.pendingEvent) drainExpeditionTreasureRewards(room);
  return completion;
}

function handleArrival(room, player) {
  noteMoriAssignmentDeparture(room, player);
  const claims = claimFreeIslandsAt(room, player);
  for (const island of claims) {
    log(room, `${player.name} открывает свободный остров ${island.name} и становится его владельцем.`);
    applyFreeClaimReward(room, player, island);
  }
  handleLegendaryPlaceStop(room, player);
  handleExpeditionArrival(room, player);
}

function attachPlayer(socket, room, player) {
  const previous = player.socketId && io.sockets.sockets.get(player.socketId);
  if (previous && previous.id !== socket.id) {
    previous.leave(room.code);
    previous.data.roomCode = null;
    previous.data.playerId = null;
    previous.emit('removedFromRoom', { code: room.code, reason: 'Игра открыта на другом устройстве.' });
  }
  const oldRoom = getRoom(socket.data.roomCode);
  const oldPlayer = oldRoom?.players.find(p => p.id === socket.data.playerId);
  if (oldPlayer && oldPlayer !== player && oldPlayer.socketId === socket.id) {
    oldPlayer.socketId = null;
    oldPlayer.connected = false;
    socket.leave(oldRoom.code);
    emitRoom(oldRoom);
  }
  for (const joined of [...socket.rooms]) {
    if (String(joined).startsWith('admin-watch:')) socket.leave(joined);
  }
  socket.data.adminWatching = null;
  player.socketId = socket.id;
  player.connected = true;
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  socket.join(room.code);
}

function newPlayer(socket, data, color) {
  const shipClass = SHIPS[data?.shipClass] ? data.shipClass : 'brigantine';
  return {
    id: crypto.randomUUID(),
    token: token(),
    socketId: socket.id,
    connected: true,
    ready: false,
    accountId: data?.accountUser?.sub || null,
    accountUsername: data?.accountUser?.username || null,
    name: cleanName(data?.name || data?.accountUser?.displayName || data?.accountUser?.username),
    color,
    shipClass,
    ducats: BALANCE.session.startingDucats,
    debt: 0,
    level: 1,
    row: MAP_META.startCell[0],
    col: MAP_META.startCell[1],
    specialCards: [],
    namedPlaceCards: [],
    activeExpedition: null,
    expeditionHistory: [],
    expeditionDrawRound: null,
    expeditionsDrawnThisRound: 0,
    cargo: null,
    upgrades: [],
    disabledUpgradeIds: [],
    escorts: [],
    levelInactiveEscortIds: [],
    nextEscortId: 0,
    landCompany: null,
    bastionPriority: [],
    inactiveBastionIslandIds: [],
    character: null,
    characterReplacedRound: null,
    palaceUsed: false,
    glory: 0,
    fleetPoints: 0,
    fleetPointRound: null,
    fleetPointOpponentIds: [],
    armyPoints: 0,
    armyPointRound: null,
    armyPointOpponentIds: [],
    skipTurns: 0,
    personalTurnNo: 0,
    attackLimitRound: null,
    attackCountsThisRound: {},
    brokenAlliesThisTurn: [],
    pendingLandinEscort: false,
    legendaryCards: [],
    legendaryEffects: { seaCurses: [] },
    savedEventCards: [],
    nextTurnEffects: {},
    activeTurnEffects: {},
    visitedAnchors: [],
    lastAnchorEncounter: null,
    suzerainId: null,
    vassalGiftIslandId: null,
    enemyFactionIds: [],
    nextActionLimit: null,
    activeAssignment: null,
  };
}

io.on('connection', socket => {
  onSocketEvent(socket, 'listMyRooms', (data, ack) => {
    const user = socketAccount(data);
    if (!user) return ackSafe(ack, { ok: false, error: 'Войдите в аккаунт.' });
    ackSafe(ack, { ok: true, rooms: myRooms(user.sub) });
  });

  onSocketEvent(socket, 'goHome', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId && p.socketId === socket.id);
    if (player) {
      player.socketId = null;
      player.connected = false;
      socket.leave(room.code);
      emitRoom(room);
    }
    socket.data.roomCode = null;
    socket.data.playerId = null;
    for (const joined of [...socket.rooms]) {
      if (String(joined).startsWith('admin-watch:')) socket.leave(joined);
    }
    socket.data.adminWatching = null;
    ackSafe(ack, { ok: true });
  });

  onSocketEvent(socket, 'adminListRooms', (data, ack) => {
    const admin = requireAdminAccount(data, ack);
    if (!admin) return;
    ackSafe(ack, { ok: true, rooms: [...rooms.values()].map(adminRoomSummary) });
  });

  onSocketEvent(socket, 'adminWatchRoom', (data, ack) => {
    const admin = requireAdminAccount(data, ack);
    if (!admin) return;
    const room = getRoom(data?.code);
    if (!room) return ackSafe(ack, { ok: false, error: 'Комната не найдена.' });
    for (const joined of [...socket.rooms]) {
      if (String(joined).startsWith('admin-watch:')) socket.leave(joined);
    }
    socket.join(`admin-watch:${room.code}`);
    socket.data.adminWatching = room.code;
    ackSafe(ack, { ok: true, room: adminRoomState(room) });
  });

  onSocketEvent(socket, 'adminStopWatching', (_data, ack) => {
    for (const joined of [...socket.rooms]) {
      if (String(joined).startsWith('admin-watch:')) socket.leave(joined);
    }
    socket.data.adminWatching = null;
    ackSafe(ack, { ok: true });
  });

  onSocketEvent(socket, 'adminCloseRoom', (data, ack) => {
    const admin = requireAdminAccount(data, ack);
    if (!admin) return;
    const room = getRoom(data?.code);
    if (!room) return ackSafe(ack, { ok: false, error: 'Комната не найдена.' });
    closeRoomInternal(room, 'Комната закрыта администратором.');
    ackSafe(ack, { ok: true });
  });

  onSocketEvent(socket, 'createRoom', (data, ack) => {
    const accountUser = requireSocketAccount(data, ack);
    if (db && !accountUser) return;
    const code = makeCode();
    const player = newPlayer(socket, { ...data, accountUser }, COLORS[0]);
    const room = {
      code,
      rulesDataVersion: RULESET.rulesetVersion,
      rulesSchemaVersion: RULESET.schemaVersion,
      runtimeProfile: RUNTIME_PROFILE,
      hostId: player.id,
      leaderId: null,
      seatingOrder: [player.id],
      players: [player],
      islands: cloneIslands(),
      started: false,
      order: [],
      turnIndex: 0,
      completedTurns: 0,
      round: 1,
      circle: 1,
      phase: 'lobby',
      roll: null,
      movePoints: null,
      actionsLeft: BALANCE.session.actionsPerTurn,
      alliances: [],
      pendingAlliance: null,
      pendingBattle: null,
      pendingEvent: null,
      pendingFeud: null,
      pendingAssignmentChoice: null,
      pendingIslandCorrection: null,
      pendingFleetAdjustment: null,
      fleetAdjustmentQueue: [],
      pendingLegendaryReaction: null,
      eventPhase: null,
      anchorDecks: createAnchorDecks(),
      eventDeck: createSailingEventDeck(),
      treasureDeck: createTreasureDeck(),
      expeditionDeck: createExpeditionDeck(),
      pendingExpeditionRewards: [],
      feudDecks: createFeudDecks(),
      assignmentDecks: createAssignmentDecks(),
      legendaryPlacesExplored: {},
      factionState: {},
      log: [],
    };
    refreshFactionExistence(room);
    rooms.set(code, room);
    attachPlayer(socket, room, player);
    log(room, `${player.name} создал комнату ${code}.`);
    ackSafe(ack, { ok: true, code, playerId: player.id, playerToken: player.token });
    emitRoom(room);
  });

  onSocketEvent(socket, 'joinRoom', (data, ack) => {
    const accountUser = requireSocketAccount(data, ack);
    if (db && !accountUser) return;
    const room = getRoom(data?.code);
    if (!room) return ackSafe(ack, { ok: false, error: 'Комната не найдена.' });

    const resumeToken = String(data?.playerToken || '');
    const existing = room.players.find(p => p.token === resumeToken) || (accountUser ? room.players.find(p => p.accountId === accountUser.sub) : null);
    if (existing) {
      if (accountUser && existing.accountId && existing.accountId !== accountUser.sub) return ackSafe(ack, { ok: false, error: 'Это место принадлежит другому аккаунту.' });
      attachPlayer(socket, room, existing);
      log(room, `${existing.name} вернулся в игру.`);
      ackSafe(ack, { ok: true, code: room.code, playerId: existing.id, playerToken: existing.token, resumed: true });
      emitRoom(room);
      return;
    }

    if (room.started) return ackSafe(ack, { ok: false, error: 'Партия уже началась.' });
    if (room.players.length >= BALANCE.session.players.max) return ackSafe(ack, { ok: false, error: `В комнате уже ${BALANCE.session.players.max} игроков.` });

    const availableColor = COLORS.find(color => !room.players.some(p => p.color === color)) || COLORS[room.players.length % COLORS.length];
    const player = newPlayer(socket, { ...data, accountUser }, availableColor);
    room.players.push(player);
    room.seatingOrder ||= room.players.filter(p => p.id !== player.id).map(p => p.id);
    room.seatingOrder.push(player.id);
    attachPlayer(socket, room, player);
    log(room, `${player.name} присоединился.`);
    ackSafe(ack, { ok: true, code: room.code, playerId: player.id, playerToken: player.token });
    emitRoom(room);
  });

  onSocketEvent(socket, 'resumeRoom', (data, ack) => {
    const accountUser = requireSocketAccount(data, ack);
    if (db && !accountUser) return;
    const room = getRoom(data?.code);
    if (!room) return ackSafe(ack, { ok: false, error: 'Комната больше не существует.' });
    const player = room.players.find(p => p.token === data?.playerToken) || (accountUser ? room.players.find(p => p.accountId === accountUser.sub) : null);
    if (!player) return ackSafe(ack, { ok: false, error: 'Не удалось восстановить игрока.' });
    if (accountUser && player.accountId && player.accountId !== accountUser.sub) return ackSafe(ack, { ok: false, error: 'Это место принадлежит другому аккаунту.' });
    attachPlayer(socket, room, player);
    ackSafe(ack, { ok: true, code: room.code, playerId: player.id, playerToken: player.token, resumed: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'changeShip', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.started) return ackSafe(ack, { ok: false, error: 'Сейчас класс корабля менять нельзя.' });
    if (!SHIPS[data?.shipClass]) return ackSafe(ack, { ok: false, error: 'Неизвестный класс корабля.' });
    if (p.id === room.leaderId && data.shipClass !== 'carrack') return ackSafe(ack, { ok: false, error: 'Ведущий играет за каракку.' });
    p.shipClass = data.shipClass;
    p.ready = false;
    log(room, `${p.name} выбрал: ${SHIPS[p.shipClass].name}. Готовность снята.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'setReady', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p) return ackSafe(ack, { ok: false, error: 'Комната не найдена.' });
    if (room.started) return ackSafe(ack, { ok: false, error: 'Партия уже началась.' });
    p.ready = Boolean(data?.ready);
    log(room, `${p.name}: ${p.ready ? 'готов к старту' : 'готовность снята'}.`);
    ackSafe(ack, { ok: true, ready: p.ready });
    emitRoom(room);
  });

  onSocketEvent(socket, 'setLeader', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || room.started || room.hostId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Ведущего выбирают до начала партии.' });
    const player = playerById(room, data?.playerId);
    if (!player) return ackSafe(ack, { ok: false, error: 'Игрок не найден.' });
    room.seatingOrder ||= room.players.map(p => p.id);
    room.leaderId = player.id;
    player.shipClass = 'carrack';
    for (const member of room.players) member.ready = false;
    log(room, `${player.name} выбран ведущим и играет за каракку.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'setSeatingOrder', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    if (!room || room.started || room.hostId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Порядок мест задают до начала партии.' });
    const ids = data?.playerIds;
    if (!Array.isArray(ids) || ids.length !== room.players.length || new Set(ids).size !== ids.length ||
      ids.some(id => !room.players.some(p => p.id === id))) return ackSafe(ack, { ok: false, error: 'Укажите всех игроков ровно по одному разу.' });
    room.seatingOrder = [...ids];
    for (const member of room.players) member.ready = false;
    log(room, 'Порядок мест по часовой стрелке обновлён.');
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'leaveRoom', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const playerId = socket.data.playerId;
    if (!room) return ackSafe(ack, { ok: true });
    if (room.started) return ackSafe(ack, { ok: false, error: 'После старта партии место игрока сохраняется. Хозяин комнаты может закрыть комнату целиком.' });
    if (room.hostId === playerId) return ackSafe(ack, { ok: false, error: 'Создатель комнаты закрывает комнату кнопкой «Закрыть комнату».' });

    const player = room.players.find(p => p.id === playerId);
    room.players = room.players.filter(p => p.id !== playerId);
    room.seatingOrder = (room.seatingOrder || []).filter(id => id !== playerId);
    if (room.leaderId === playerId) room.leaderId = null;
    socket.leave(room.code);
    socket.data.roomCode = null;
    socket.data.playerId = null;
    if (player) log(room, `${player.name} вышел из комнаты.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'kickPlayer', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return ackSafe(ack, { ok: false, error: 'Комната не найдена.' });
    if (room.started) return ackSafe(ack, { ok: false, error: 'Удалять игроков можно только до начала партии.' });
    if (room.hostId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Удалять игроков может только создатель комнаты.' });

    const targetId = String(data?.playerId || '');
    if (!targetId || targetId === room.hostId) return ackSafe(ack, { ok: false, error: 'Этого игрока удалить нельзя.' });
    const target = room.players.find(p => p.id === targetId);
    if (!target) return ackSafe(ack, { ok: false, error: 'Игрок не найден.' });

    room.players = room.players.filter(p => p.id !== targetId);
    room.seatingOrder = (room.seatingOrder || []).filter(id => id !== targetId);
    if (room.leaderId === targetId) room.leaderId = null;
    const targetSocket = target.socketId ? io.sockets.sockets.get(target.socketId) : null;
    if (targetSocket) {
      targetSocket.emit('removedFromRoom', { code: room.code, reason: 'Создатель комнаты удалил вас из лобби.' });
      targetSocket.leave(room.code);
      targetSocket.data.roomCode = null;
      targetSocket.data.playerId = null;
    }
    target.connected = false;
    target.socketId = null;
    log(room, `${target.name} удалён из комнаты создателем.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'closeRoom', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return ackSafe(ack, { ok: true });
    if (room.hostId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Закрыть комнату может только её создатель.' });
    closeRoomInternal(room, 'Создатель закрыл комнату.');
    ackSafe(ack, { ok: true });
  });

  onSocketEvent(socket, 'startGame', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return ackSafe(ack, { ok: false, error: 'Комната не найдена.' });
    if (room.hostId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Начать игру может только создатель комнаты.' });
    if (room.started) return ackSafe(ack, { ok: false, error: 'Игра уже началась.' });
    if (room.players.length < BALANCE.session.players.min || room.players.length > BALANCE.session.players.max) return ackSafe(ack, { ok: false, error: `Для старта нужно ${BALANCE.session.players.min}–${BALANCE.session.players.max} игроков.` });
    if (!room.leaderId || !room.players.some(p => p.id === room.leaderId)) return ackSafe(ack, { ok: false, error: 'Перед стартом выберите ведущего.' });
    if (playerById(room, room.leaderId)?.shipClass !== 'carrack') return ackSafe(ack, { ok: false, error: 'Ведущий должен играть за каракку.' });
    if (!Array.isArray(room.seatingOrder) || room.seatingOrder.length !== room.players.length ||
      new Set(room.seatingOrder).size !== room.players.length || room.seatingOrder.some(id => !playerById(room, id)))
      return ackSafe(ack, { ok: false, error: 'Проверьте порядок мест по часовой стрелке.' });
    if (!room.players.every(p => p.connected)) return ackSafe(ack, { ok: false, error: 'Перед стартом все игроки должны быть онлайн.' });
    if (!room.players.every(p => p.ready)) return ackSafe(ack, { ok: false, error: 'Перед стартом все игроки должны нажать «Готов».' });

    room.started = true;
    room.islands = cloneIslands();
    room.order = determineOrder(room);
    room.turnIndex = 0;
    room.completedTurns = 0;
    room.round = 1;
    room.circle = 1;
    room.alliances = [];
    room.pendingAlliance = null;
    room.pendingBattle = null;
    room.pendingEvent = null;
    room.pendingFeud = null;
    room.pendingAssignmentChoice = null;
    room.pendingIslandCorrection = null;
    room.pendingFleetAdjustment = null;
    room.fleetAdjustmentQueue = [];
    room.pendingLegendaryReaction = null;
    room.eventPhase = null;
    room.anchorDecks = createAnchorDecks();
    room.eventDeck = createSailingEventDeck();
    room.treasureDeck = createTreasureDeck();
    room.expeditionDeck = createExpeditionDeck();
    room.pendingExpeditionRewards = [];
    room.feudDecks = createFeudDecks();
    room.assignmentDecks = createAssignmentDecks();
    room.legendaryPlacesExplored = {};
    room.factionState = {};
    room.players.forEach(p => {
      p.row = 0; p.col = 0; p.ducats = BALANCE.session.startingDucats; p.debt = 0; p.level = 1; p.specialCards = []; p.cargo = null; p.upgrades = []; p.disabledUpgradeIds = []; p.escorts = []; p.levelInactiveEscortIds = []; p.nextEscortId = 0;
      p.glory = 0; p.fleetPoints = 0; p.fleetPointRound = room.round; p.fleetPointOpponentIds = []; p.armyPoints = 0; p.armyPointRound = room.round; p.armyPointOpponentIds = []; p.skipTurns = 0; p.personalTurnNo = 0; p.attackLimitRound = room.round; p.attackCountsThisRound = {}; p.brokenAlliesThisTurn = []; p.pendingLandinEscort = false; p.activeExpedition = null; p.expeditionHistory = []; p.expeditionDrawRound = null; p.expeditionsDrawnThisRound = 0; p.legendaryCards = []; p.legendaryEffects = { seaCurses: [] }; p.savedEventCards = []; p.nextTurnEffects = {}; p.activeTurnEffects = {}; p.visitedAnchors = []; p.lastAnchorEncounter = null; p.suzerainId = null; p.vassalGiftIslandId = null; p.enemyFactionIds = []; p.nextActionLimit = null; p.activeAssignment = null; p.landCompany = null; p.bastionPriority = []; p.inactiveBastionIslandIds = []; p.character = null; p.characterReplacedRound = null; p.palaceUsed = false;
    });
    refreshFactionExistence(room);
    log(room, `Партия началась. Порядок: ${room.order.map(id => room.players.find(p => p.id === id)?.name).join(' → ')}.`);
    beginTurn(room);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });


  onSocketEvent(socket, 'takeExpedition', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Экспедицию можно получить только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.eventPhase?.active) return ackSafe(ack, { ok: false, error: 'Сначала завершите обязательные карты шестого круга.' });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Получение экспедиции требует одного доступного действия.' });
    const result = takeExpedition(room, p);
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= result.actionCost;
    const returnText = result.requiresLeaveAndReturn ? ' Корабль уже находится в месте назначения: сначала нужно покинуть все клетки этого места, затем вернуться.' : '';
    log(room, `${p.name} получает экспедицию «${result.expedition.name}» на своём острове с Картографической палатой и тратит одно действие. Осталось действий: ${room.actionsLeft}.${returnText}`);
    ackSafe(ack, { ok: true, actionCost: result.actionCost, actionsLeft: room.actionsLeft, expedition: {
      cardId: result.expedition.cardId,
      name: result.expedition.name,
      placeId: result.expedition.placeId,
      acceptedRound: result.expedition.acceptedRound,
      requiresLeaveAndReturn: Boolean(result.requiresLeaveAndReturn),
    } });
    emitRoom(room);
  });

  onSocketEvent(socket, 'rollMove', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'navigation' || room.roll !== null) return ackSafe(ack, { ok: false, error: 'Кубик движения уже использован.' });
    const firstRoll = rollD6();
    const secondRoll = p.activeTurnEffects?.bestOfTwo ? rollD6() : null;
    room.roll = secondRoll == null ? firstRoll : Math.max(firstRoll, secondRoll);
    const ship = SHIPS[p.shipClass];
    const stats = shipStats(p);
    const bonus = Number(p.activeTurnEffects?.moveBonus) || 0;
    const lighthouseBonus = lighthouseDepartureBonus(room, p);
    const eventPenalty = Number(p.activeTurnEffects?.movePenalty) || 0;
    const cursePenalty = legendaryMovementPenalty(p);
    const penalty = eventPenalty + cursePenalty;
    room.movePoints = Math.max(0, room.roll + stats.moveMod + bonus + lighthouseBonus - penalty);
    const diceText = secondRoll == null ? `d6 = ${firstRoll}` : `d6 = ${firstRoll} и ${secondRoll}, выбран ${room.roll}`;
    const eventMod = bonus || eventPenalty ? `, событие ${bonus ? `+${bonus}` : ''}${eventPenalty ? `−${eventPenalty}` : ''}` : '';
    const lighthouseMod = lighthouseBonus ? `, Маяк +${lighthouseBonus}` : '';
    const curseMod = cursePenalty ? `, Морское проклятие −${cursePenalty}` : '';
    log(room, `${p.name}: ${diceText}; дальность ${room.movePoints} (${ship.name} ${p.level} ур., модификатор корабля ${stats.moveMod >= 0 ? '+' : ''}${stats.moveMod}${eventMod}${lighthouseMod}${curseMod}).`);
    ackSafe(ack, { ok: true, roll: room.roll, rolls: secondRoll == null ? [firstRoll] : [firstRoll, secondRoll], movePoints: room.movePoints });
    emitRoom(room);
  });

  onSocketEvent(socket, 'skipNavigation', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'navigation') return ackSafe(ack, { ok: false, error: 'Навигация уже завершена.' });
    const from = { row: p.row, col: p.col };
    room.roll = null;
    room.movePoints = 0;
    room.phase = 'actions';
    handleArrival(room, p);
    trackMoriNavigation(room, p, from);
    log(room, `${p.name} остался на месте.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'moveTo', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'navigation' || room.roll === null) return ackSafe(ack, { ok: false, error: 'Сначала бросьте кубик.' });

    const row = Number(data?.row);
    const col = Number(data?.col);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= MAP_META.rows || col < 0 || col >= MAP_META.cols) {
      return ackSafe(ack, { ok: false, error: 'Недопустимая клетка.' });
    }

    const allowed = reachableCells(p, room.movePoints).some(c => c.row === row && c.col === col);
    if (!allowed) return ackSafe(ack, { ok: false, error: 'До этой клетки нельзя доплыть данным кораблём за текущую навигацию.' });

    const from = { row: p.row, col: p.col };
    p.row = row;
    p.col = col;
    room.phase = 'actions';
    log(room, `${p.name} переместился на клетку ${col + 1}:${row + 1}.`);
    handleArrival(room, p);
    trackMoriNavigation(room, p, from);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'fightAnchor', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Морской бой на якоре объявляют в фазе действий.' });
    if ((Number(room.actionsLeft) || 0) <= 0) return ackSafe(ack, { ok: false, error: 'Для объявления боя на якоре нужно иметь доступное действие.' });
    const anchor = anchorAt(p.row, p.col);
    if (!anchor) return ackSafe(ack, { ok: false, error: 'Основной корабль не находится на клетке морского якоря.' });
    const visitKey = `${p.row},${p.col}`;
    if ((p.visitedAnchors || []).includes(visitKey)) return ackSafe(ack, { ok: false, error: 'Эта клетка якоря уже дала вам карту в текущем раунде.' });

    const result = handleAnchorAction(room, p);
    if (!result?.ok) return ackSafe(ack, result);
    if (!result.triggered) return ackSafe(ack, { ok: false, error: 'Бой на якоре сейчас недоступен.' });
    ackSafe(ack, { ok: true, result });
    emitRoom(room);
  });

  onSocketEvent(socket, 'takeCharacter', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Получение персонажа требует одного действия.' });
    const result = takeCharacter(room, p, String(data?.characterId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= result.character.acquireActionCost;
    log(room, `${p.name} берёт персонажа «${result.character.name}» в Адмиралтействе. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'replaceCharacter', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Замена персонажа требует одного действия.' });
    const result = replaceCharacter(room, p, String(data?.characterId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= result.character.acquireActionCost;
    log(room, `${p.name} заменяет неиспользованного персонажа на «${result.character.name}». Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'useNavigator', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'navigation' || room.roll === null) return ackSafe(ack, { ok: false, error: 'Штурман применяется после броска обычной навигации.' });
    const character = CHARACTERS.navigator;
    if ((Number(room.actionsLeft) || 0) < character.useActionCost) return ackSafe(ack, { ok: false, error: 'Для Штурмана нужен один доступный пункт действия.' });
    if ((typeof p.character === 'string' ? p.character : p.character?.id) !== 'navigator') return ackSafe(ack, { ok: false, error: 'На корабле нет Штурмана.' });
    const first = room.roll;
    const second = rollD6();
    room.roll = second;
    const stats = shipStats(p);
    const bonus = Number(p.activeTurnEffects?.moveBonus) || 0;
    const lighthouseBonus = lighthouseDepartureBonus(room, p);
    const penalty = (Number(p.activeTurnEffects?.movePenalty) || 0) + legendaryMovementPenalty(p);
    room.movePoints = Math.max(0, second + stats.moveMod + bonus + lighthouseBonus - penalty);
    room.actionsLeft -= character.useActionCost;
    consumeCharacter(p, 'navigator');
    log(room, `${p.name} использует Штурмана: d6 ${first} переброшен на ${second}; второй результат обязателен. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true, roll: second, movePoints: room.movePoints });
    emitRoom(room);
  });

  onSocketEvent(socket, 'useCartographer', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'navigation' || room.roll !== null) return ackSafe(ack, { ok: false, error: 'Картограф применяется до броска обычной навигации.' });
    const character = CHARACTERS.cartographer;
    if ((Number(room.actionsLeft) || 0) < character.useActionCost) return ackSafe(ack, { ok: false, error: 'Для Картографа нужен один доступный пункт действия.' });
    if ((typeof p.character === 'string' ? p.character : p.character?.id) !== 'cartographer') return ackSafe(ack, { ok: false, error: 'На корабле нет Картографа.' });
    const color = String(data?.color || '');
    const option = cartographerAnchorOptions(p).find(item => item.color === color);
    if (!option) return ackSafe(ack, { ok: false, error: 'Эта колода якоря находится дальше четырёх клеток.' });
    const card = room.anchorDecks?.[color]?.drawPile?.[0] || null;
    if (!card) return ackSafe(ack, { ok: false, error: 'В выбранной колоде якоря сейчас нет верхней карты.' });
    room.actionsLeft -= character.useActionCost;
    consumeCharacter(p, 'cartographer');
    log(room, `${p.name} использует Картографа и смотрит верхнюю карту колоды «${option.name}», не меняя порядок.`);
    ackSafe(ack, { ok: true, anchorName: option.name, card: { name: card.name, artillery: card.artillery, reward: card.reward, quiet: Boolean(card.quiet) } });
    emitRoom(room);
  });

  onSocketEvent(socket, 'useFirstMate', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Первый помощник применяется в фазе действий.' });
    if ((typeof p.character === 'string' ? p.character : p.character?.id) !== 'firstMate') return ackSafe(ack, { ok: false, error: 'На корабле нет Первого помощника.' });
    room.actionsLeft = Math.max(0, Number(room.actionsLeft) || 0) + Math.max(1, Number(CHARACTERS.firstMate.effect?.count) || 1);
    consumeCharacter(p, 'firstMate');
    log(room, `${p.name} использует Первого помощника и получает одно дополнительное действие сверх обычного лимита.`);
    ackSafe(ack, { ok: true, actionsLeft: room.actionsLeft });
    emitRoom(room);
  });

  onSocketEvent(socket, 'usePalace', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Дворец требует одного действия.' });
    if (p.palaceUsed) return ackSafe(ack, { ok: false, error: 'Дворец уже применялся этим игроком в этой партии.' });
    const island = room.islands.find(i => i.id === String(data?.islandId || '') && i.ownerId === p.id && playerOnIsland(p, i) && (i.buildings || []).some(b => b.type === 'palace'));
    if (!island) return ackSafe(ack, { ok: false, error: 'Нужно находиться у своего острова с Дворцом.' });
    const factionId = String(data?.factionId || '');
    if (!(p.enemyFactionIds || []).includes(factionId) || !stateExists(room, factionId)) return ackSafe(ack, { ok: false, error: 'Выберите существующее государство, с которым у вас идёт вражда.' });
    p.enemyFactionIds = (p.enemyFactionIds || []).filter(id => id !== factionId);
    p.palaceUsed = true;
    room.actionsLeft -= 1;
    log(room, `${p.name} использует Дворец на острове ${island.name} и прекращает вражду с государством ${FACTIONS[factionId]?.name || factionId}. Подданство и владения не восстанавливаются.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'build', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });

    const result = build(room, p, String(data?.islandId || ''), String(data?.buildingType || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} строит ${result.building.displayName || result.building.name} на острове ${result.island.name} за ${result.building.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, assignmentBuildingEvent(result.island, result.building));
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'upgradeBuilding', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });

    const result = upgradeBuilding(room, p, String(data?.islandId || ''), Number(data?.buildingIndex));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} улучшает ${result.beforeName} → ${result.afterName} на острове ${result.island.name} за ${result.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, assignmentBuildingEvent(result.island, result.building, result.previousBuilding));
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'buildBastion', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const result = buildBastion(room, p, String(data?.islandId || ''), data?.buildingIndex);
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} превращает крепость III в бастион на острове ${result.island.name} за ${result.price} дукатов. Поддержка каменотёсных дворов: ${result.support.supported.length}/${result.support.capacity}. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, assignmentBuildingEvent(result.island, result.building));
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'formLandCompany', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const result = formLandCompany(room, p, String(data?.islandId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    const cargoText = result.discardedCargo ? ' Прежний груз основного трюма сброшен без выручки.' : '';
    log(room, `${p.name} снаряжает роту ландскнехтов в арсенале ${ROMAN_SERVER[result.company.arsenalLevel] || result.company.arsenalLevel} на ${result.island.name}: +${result.company.army} войска при штурме. Основной трюм занят ротой.${cargoText} Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'dismissLandCompany', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Распустить роту можно в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (!['navigation', 'actions'].includes(room.phase)) return ackSafe(ack, { ok: false, error: 'Сейчас роту распустить нельзя.' });
    const result = dismissLandCompany(room, p);
    if (!result.ok) return ackSafe(ack, result);
    log(room, `${p.name} бесплатно возвращает роту ландскнехтов у арсенала на ${result.island.name} и освобождает основной трюм.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'buyCityGuard', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    if (!isCitadelCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'Это действие доступно только в Цитадели.' });
    const result = buyCityGuard(room, p, String(data?.islandId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} покупает городскую стражу для ${result.island.name}: +${result.defense} войска к защите за ${result.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'buyPermanentGarrison', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    if (!isCitadelCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'Это действие доступно только в Цитадели.' });
    const result = buyPermanentGarrison(room, p, String(data?.islandId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    const modeText = result.mode === 'upgrade' ? 'заменяет городскую стражу постоянным гарнизоном' : 'покупает постоянный гарнизон напрямую';
    log(room, `${p.name} ${modeText} для ${result.island.name}: +${result.defense} войска к защите за ${result.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'buyShipLevel', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    if (!isCitadelCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'Это действие доступно только в Цитадели.' });
    const result = buyShipLevel(p);
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} повышает основной корабль до уровня ${result.level} за ${result.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, { type: 'ship-level' });
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'buyShipUpgrade', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    if (!isCitadelCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'Это действие доступно только в Цитадели.' });
    const result = buyShipUpgrade(p, String(data?.upgradeId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} устанавливает «${result.upgrade.name}» за ${result.upgrade.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, { type: 'ship-upgrade', branch: result.upgrade.branch });
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'removeShipUpgrade', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    if (!isCitadelCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'Это действие доступно только в Цитадели.' });
    const result = removeShipUpgrade(p, String(data?.upgradeId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} снимает и сбрасывает «${result.upgrade.name}» без возврата дукатов. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'buyEscort', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    if (!isCitadelCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'Это действие доступно только в Цитадели.' });
    const result = buyEscort(room, p, String(data?.escortType || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} покупает ${result.def.name.toLowerCase()} за ${result.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'loadCargo', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });

    const result = loadCargo(room, p, String(data?.islandId || ''), String(data?.goodId || ''), String(data?.holdId || 'main'));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} загружает на ${result.island.name} в ${result.holdName.toLowerCase()}: ${result.good.name} × ${result.quantity}. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'sellCargo', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    if (!isCitadelCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'Это действие доступно только в Цитадели.' });

    const result = sellCargo(room, p, String(_data?.holdId || 'main'));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    const isContract = deliveryAssignmentMatch(p, result);
    let contractBonus = 0;
    let contractCredit = null;
    if (isContract) {
      contractBonus = contractBonusForRevenue(result.revenue);
      contractCredit = creditDucats(p, contractBonus);
    }
    const debtText = result.credit?.debtPaid ? ` Из обычной выручки ${result.credit.debtPaid} уходит в погашение долга; в казну ${result.credit.net}.` : '';
    const contractText = isContract ? ` Контракт сюзерена: премия +${contractBonus} дукатов${contractCredit?.debtPaid ? ` (${contractCredit.debtPaid} в погашение долга)` : ''}.` : '';
    log(room, `${p.name} продаёт в Цитадели из ${result.holdName.toLowerCase()}: ${result.good.name} × ${result.quantity} за ${result.revenue} дукатов.${debtText}${contractText} Осталось действий: ${room.actionsLeft}.`);
    if (isContract) trackAssignment(room, p, { type: 'delivery', goodId: result.good.id, assignmentInstanceId: result.assignmentInstanceId, fullHold: true });
    ackSafe(ack, { ok: true, revenue: result.revenue, contractBonus });
    emitRoom(room);
  });

  onSocketEvent(socket, 'respondEvent', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingEvent;
    if (!room || !pending || pending.id !== String(data?.eventId || '')) return ackSafe(ack, { ok: false, error: 'Эта карта события уже не ожидает решения.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Решение должен принять игрок, получивший карту.' });

    if (pending.kind === 'observatory') {
      const choice = String(data?.choice || '');
      if (!['keep', 'replace'].includes(choice)) return ackSafe(ack, { ok: false, error: 'Выберите, оставить первую карту или заменить её.' });
      const player = playerById(room, pending.playerId);
      if (!player) return ackSafe(ack, { ok: false, error: 'Игрок не найден.' });
      const first = pending.eventCard ? { ...pending.eventCard } : null;
      room.eventPhase.observatoryReplacementsUsed = Math.max(0, Number(room.eventPhase.observatoryReplacementsUsed) || 0) + 1;
      room.pendingEvent = null;
      let card = first;
      if (choice === 'replace') {
        if (first) discardDeckCard(room.eventDeck, first);
        card = drawSailingEventCard(room);
        log(room, card ? `${player.name}: Обсерватория сбрасывает «${first?.name || 'первую карту'}» и обязательно разыгрывает «${card.name}».`
          : `${player.name}: Обсерватория сбрасывает первую карту, но колода событий пуста.`);
      } else {
        log(room, `${player.name}: Обсерватория оставляет «${first?.name || 'первую карту'}».`);
      }
      const result = continueAfterObservedSailingCard(room, player, card);
      ackSafe(ack, result);
      emitRoom(room);
      return;
    }

    if (pending.kind === 'cargo') {
      const holdId = String(data?.holdId || '');
      if (!(pending.options || []).some(o => o.id === holdId)) return ackSafe(ack, { ok: false, error: 'Выберите доступный пустой трюм.' });
      pending.choice = { holdId };
    } else if (pending.kind === 'raid') {
      const islandId = String(data?.islandId || '');
      const buildingIndex = Number(data?.buildingIndex);
      if (!(pending.options || []).some(o => o.islandId === islandId && o.buildingIndex === buildingIndex)) return ackSafe(ack, { ok: false, error: 'Выберите доступную постройку.' });
      pending.choice = { islandId, buildingIndex };
    } else if (pending.kind === 'boarding') {
      const upgradeId = String(data?.upgradeId || '');
      if (!(pending.options || []).some(o => o.id === upgradeId)) return ackSafe(ack, { ok: false, error: 'Выберите установленное улучшение.' });
      pending.choice = { upgradeId };
    } else if (pending.kind === 'storm') {
      const row = Number(data?.row), col = Number(data?.col);
      if (!(pending.options || []).some(o => o.row === row && o.col === col)) return ackSafe(ack, { ok: false, error: 'Выберите одну из допустимых клеток берега.' });
      pending.choice = { row, col };
    } else return ackSafe(ack, { ok: false, error: 'Неизвестный тип решения события.' });

    const result = completePendingEvent(room, pending);
    ackSafe(ack, result);
    emitRoom(room);
  });

  onSocketEvent(socket, 'useSavedCargo', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сохранённую карту можно применить только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Для применения нужен один доступный пункт действия.' });
    const found = takeSavedCard(p, String(data?.savedCardId || ''));
    if (!found || !['found-cargo', 'treasure-cargo'].includes(found.card.kind)) return ackSafe(ack, { ok: false, error: 'Сохранённая грузовая карта не найдена.' });
    const result = fillCargoDirect(room, p, found.card.goodId, String(data?.holdId || 'main'));
    if (!result.ok) return ackSafe(ack, result);
    p.savedEventCards.splice(found.index, 1);
    discardSavedCardToDeck(room, found.card);
    room.actionsLeft -= 1;
    log(room, `${p.name} применяет сохранённую карту «${found.card.name}»: ${result.holdName} заполнен товаром «${result.good.name}» ×${result.quantity}. Осталось действий: ${room.actionsLeft}.`);
    if (found.card.kind === 'treasure-cargo') trackAssignment(room, p, { type: 'treasure-resolved', assignmentInstanceId: found.card.assignmentInstanceId || null });
    ackSafe(ack, { ok: true, result });
    emitRoom(room);
  });

  onSocketEvent(socket, 'useShipMaster', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Карту можно применить только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Для установки нужен один доступный пункт действия.' });
    if (!isCitadelCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: '«Судовой мастер» устанавливает улучшение бесплатно, но только в Цитадели по общему правилу установки улучшений.' });
    const found = takeSavedCard(p, String(data?.savedCardId || ''));
    if (!found || found.card.kind !== 'ship-master') return ackSafe(ack, { ok: false, error: 'Карта «Судовой мастер» не найдена.' });
    const result = installShipUpgradeFree(p, String(data?.upgradeId || ''));
    if (!result.ok) return ackSafe(ack, result);
    p.savedEventCards.splice(found.index, 1);
    discardSavedCardToDeck(room, found.card);
    room.actionsLeft -= 1;
    log(room, `${p.name} применяет «Судового мастера» и бесплатно устанавливает «${result.upgrade.name}». Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, { type: 'ship-upgrade', branch: result.upgrade.branch });
    ackSafe(ack, { ok: true, result });
    emitRoom(room);
  });

  onSocketEvent(socket, 'useBlueprint', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Чертёж можно применить только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Для строительства нужен один доступный пункт действия.' });
    const found = takeSavedCard(p, String(data?.savedCardId || ''));
    if (!found || !['market-blueprint', 'farm-blueprint'].includes(found.card.kind)) return ackSafe(ack, { ok: false, error: 'Подходящий чертёж не найден.' });
    const type = found.card.kind === 'market-blueprint' ? 'market' : 'farm';
    const result = buildFree(room, p, String(data?.islandId || ''), type);
    if (!result.ok) return ackSafe(ack, result);
    p.savedEventCards.splice(found.index, 1);
    discardSavedCardToDeck(room, found.card);
    room.actionsLeft -= 1;
    log(room, `${p.name} применяет «${found.card.name}» и бесплатно строит ${result.building.displayName} на ${result.island.name}. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, assignmentBuildingEvent(result.island, result.building));
    ackSafe(ack, { ok: true, result });
    emitRoom(room);
  });

  onSocketEvent(socket, 'playLegendary', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Легендарную карту можно применить только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Для легендарной карты нужен один доступный пункт действия.' });

    const ref = { source: String(data?.source || ''), index: Number(data?.index) };
    const found = peekLegendaryCard(p, ref);
    if (!found) return ackSafe(ack, { ok: false, error: 'Карта не найдена в вашей руке.' });

    if (found.kind === 'sea-veil') {
      const targetType = String(data?.targetType || 'ship');
      if (targetType === 'ship') {
        consumeLegendaryCard(room, p, ref);
        room.actionsLeft -= 1;
        applySeaVeilToShip(p, { sourcePlayerId: p.id, ignoreCurrentTurn: true });
        log(room, `${p.name} разыгрывает «Покров моря» на свою флотилию. Защита действует до конца ${BALANCE.legendaryEffects['sea-veil'].durationPersonalTurns} следующих личных ходов. Осталось действий: ${room.actionsLeft}.`);
        ackSafe(ack, { ok: true });
        emitRoom(room);
        return;
      }
      const island = room.islands.find(i => i.id === String(data?.islandId || '') && i.ownerId === p.id);
      if (!island) return ackSafe(ack, { ok: false, error: 'Для «Покрова моря» выберите свой остров.' });
      consumeLegendaryCard(room, p, ref);
      room.actionsLeft -= 1;
      applySeaVeilToIsland(island, p, { ignoreCurrentTurn: true });
      log(room, `${p.name} разыгрывает «Покров моря» на ${island.name}. Защита действует до конца ${BALANCE.legendaryEffects['sea-veil'].durationPersonalTurns} следующих личных ходов. Осталось действий: ${room.actionsLeft}.`);
      ackSafe(ack, { ok: true });
      emitRoom(room);
      return;
    }

    if (found.kind === 'mist-path') {
      const row = Number(data?.row), col = Number(data?.col);
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= MAP_META.rows || col < 0 || col >= MAP_META.cols) return ackSafe(ack, { ok: false, error: 'Выберите допустимую клетку для «Пути сквозь туман».' });
      const allowed = mistPathReachableCells(p).some(c => c.row === row && c.col === col);
      if (!allowed) return ackSafe(ack, { ok: false, error: 'К этой клетке ваш корабль не может проложить путь без запрещённых препятствий.' });
      consumeLegendaryCard(room, p, ref);
      room.actionsLeft -= 1;
      p.row = row; p.col = col;
      handleArrival(room, p);
      log(room, `${p.name} применяет «Путь сквозь туман» и переносит флотилию на клетку ${col + 1}:${row + 1}. Осталось действий: ${room.actionsLeft}.`);
      ackSafe(ack, { ok: true, row, col });
      emitRoom(room);
      return;
    }

    if (found.kind === 'sea-curse') {
      const target = playerById(room, data?.targetPlayerId);
      if (!target || target.id === p.id) return ackSafe(ack, { ok: false, error: 'Выберите другой основной корабль на своей клетке.' });
      if (!sameCell(p, target)) return ackSafe(ack, { ok: false, error: '«Морское проклятие» применяется на одной клетке с кораблём цели.' });
      if (room.round === 1) return ackSafe(ack, { ok: false, error: 'В первом раунде нельзя разыгрывать враждебные легендарные карты против игроков.' });
      if (isCitadelPeaceCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'В зоне мира Цитадели «Морское проклятие» запрещено.' });
      if (areAllies(room, p, target)) return ackSafe(ack, { ok: false, error: 'Союзники не применяют враждебные карты друг против друга.' });
      const attackLimit = registerPlayerAttack(room, p, target.id);
      if (!attackLimit.ok) return ackSafe(ack, attackLimit);
      markAttackHostilityAgainstPlayer(room, p, target, 'враждебное «Морское проклятие» против вассала');
      consumeLegendaryCard(room, p, ref);
      room.actionsLeft -= 1;
      if (isShipProtected(target)) {
        log(room, `${p.name} разыгрывает «Морское проклятие» против ${target.name}, но действующий «Покров моря» отменяет эффект. Карта и действие потрачены; защита цели сохраняется. Осталось действий: ${room.actionsLeft}.`);
        ackSafe(ack, { ok: true, canceled: true, protected: true });
        emitRoom(room);
        return;
      }
      if (target.connected && playerHasLegendaryKind(target, 'sea-veil')) {
        room.pendingLegendaryReaction = {
          id: crypto.randomUUID(), kind: 'sea-curse', sourcePlayerId: p.id, targetPlayerId: target.id,
        };
        log(room, `${p.name} разыгрывает «Морское проклятие» против ${target.name} и тратит действие. ${target.name} может бесплатно ответить «Покровом моря».`);
        ackSafe(ack, { ok: true, pending: true });
        emitRoom(room);
        return;
      }
      const result = applySeaCurse(target, p.id);
      log(room, `${p.name} накладывает «Морское проклятие» на ${target.name}: обычная дальность движения −${BALANCE.legendaryEffects['sea-curse'].amount} в каждом из ${BALANCE.legendaryEffects['sea-curse'].durationPersonalTurns} следующих личных ходов цели. Осталось действий: ${room.actionsLeft}.`);
      ackSafe(ack, { ok: true, result });
      emitRoom(room);
      return;
    }

    if (found.kind === 'hellfire') {
      const island = room.islands.find(i => i.id === String(data?.islandId || ''));
      if (!island || !playerOnIsland(p, island)) return ackSafe(ack, { ok: false, error: 'Для «Пламени Ада» выберите чужой остров на текущей клетке.' });
      if (island.ownerId === p.id) return ackSafe(ack, { ok: false, error: '«Пламя Ада» нельзя применять к своему острову.' });
      const owner = island.ownerId ? playerById(room, island.ownerId) : null;
      if (owner && room.round === 1) return ackSafe(ack, { ok: false, error: 'В первом раунде нельзя разыгрывать враждебные легендарные карты против игроков.' });
      if (owner && areAllies(room, p, owner)) return ackSafe(ack, { ok: false, error: 'Нельзя применять «Пламя Ада» к острову союзника.' });
      if (isCitadelPeaceCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'В зоне мира Цитадели «Пламя Ада» запрещено.' });
      if (owner) {
        const attackLimit = registerPlayerAttack(room, p, owner.id);
        if (!attackLimit.ok) return ackSafe(ack, attackLimit);
      }

      autoRebelBeforeStateAttack(room, p, island);
      markAttackHostilityAgainstIsland(room, p, island, 'враждебное «Пламя Ада» против государства или его вассала');
      consumeLegendaryCard(room, p, ref);
      room.actionsLeft -= 1;
      if (isIslandProtected(island)) {
        log(room, `${p.name} разыгрывает «Пламя Ада» против ${island.name}, но действующий «Покров моря» отменяет эффект. Карта и действие потрачены; защита острова сохраняется. Осталось действий: ${room.actionsLeft}.`);
        ackSafe(ack, { ok: true, canceled: true, protected: true });
        emitRoom(room);
        return;
      }
      if (owner?.connected && playerHasLegendaryKind(owner, 'sea-veil')) {
        room.pendingLegendaryReaction = {
          id: crypto.randomUUID(), kind: 'hellfire', sourcePlayerId: p.id, targetPlayerId: owner.id, islandId: island.id,
        };
        log(room, `${p.name} объявляет «Пламя Ада» против ${island.name} и тратит действие. ${owner.name} может ответить «Покровом моря».`);
        ackSafe(ack, { ok: true, pending: true });
        emitRoom(room);
        return;
      }
      const result = applyHellfire(room, p, island);
      if (!result.ok) return ackSafe(ack, result);
      const detail = result.changed
        ? result.changes.map(x => x.removed ? `${x.beforeName} → удалено` : `${x.beforeName} → ${x.afterName}`).join(', ')
        : 'построек нет';
      log(room, `${p.name}: «Пламя Ада» поражает ${island.name}: ${detail}. Осталось действий: ${room.actionsLeft}.`);
      ackSafe(ack, { ok: true, result });
      emitRoom(room);
      return;
    }

    ackSafe(ack, { ok: false, error: 'Этот вид легендарной карты пока не распознан.' });
  });

  onSocketEvent(socket, 'respondLegendaryReaction', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingLegendaryReaction;
    if (!room || !pending || pending.id !== String(data?.reactionId || '')) return ackSafe(ack, { ok: false, error: 'Эта реакция больше не ожидается.' });
    if (pending.targetPlayerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Реакция адресована другому игроку.' });
    const useVeil = Boolean(data?.useVeil);
    const cardRef = useVeil ? { source: String(data?.source || ''), index: Number(data?.index) } : null;
    const result = resolvePendingLegendaryReaction(room, useVeil, cardRef);
    ackSafe(ack, result);
    emitRoom(room);
  });

  onSocketEvent(socket, 'requestAlliance', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Предложить союз можно только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Союз заключают в фазе действий.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const target = playerById(room, data?.targetPlayerId);
    if (!target || target.id === p.id) return ackSafe(ack, { ok: false, error: 'Игрок для союза не найден.' });
    if (!target.connected) return ackSafe(ack, { ok: false, error: 'Этот игрок сейчас не подключён.' });
    if (!sameCell(p, target)) return ackSafe(ack, { ok: false, error: 'Для заключения союза основные корабли должны стоять на одной клетке.' });
    if (areAllies(room, p, target)) return ackSafe(ack, { ok: false, error: 'Вы уже союзники.' });
    if (alliancePartnerId(room, p.id)) return ackSafe(ack, { ok: false, error: 'У вас уже есть союзник. Одновременно разрешён только один союз.' });
    if (alliancePartnerId(room, target.id)) return ackSafe(ack, { ok: false, error: 'У этого игрока уже есть союзник.' });
    room.pendingAlliance = { id: crypto.randomUUID(), fromId: p.id, toId: target.id };
    log(room, `${p.name} предлагает союз игроку ${target.name}. Действие будет потрачено только при согласии.`);
    ackSafe(ack, { ok: true, pending: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'respondAlliance', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const request = room?.pendingAlliance;
    if (!room || !request || request.id !== String(data?.requestId || '')) return ackSafe(ack, { ok: false, error: 'Предложение союза больше не активно.' });
    if (request.toId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Это предложение адресовано другому игроку.' });
    const from = playerById(room, request.fromId);
    const to = playerById(room, request.toId);
    if (!from || !to) { room.pendingAlliance = null; return ackSafe(ack, { ok: false, error: 'Участник союза не найден.' }); }
    const accept = Boolean(data?.accept);
    if (accept) {
      const active = currentPlayer(room);
      if (!active || active.id !== from.id || room.phase !== 'actions' || room.actionsLeft <= 0 || !sameCell(from, to) || alliancePartnerId(room, from.id) || alliancePartnerId(room, to.id)) {
        room.pendingAlliance = null;
        ackSafe(ack, { ok: false, error: 'Условия заключения союза изменились или у одного из игроков уже появился союзник.' });
        emitRoom(room);
        return;
      }
      if (!addAlliance(room, from.id, to.id)) {
        room.pendingAlliance = null;
        ackSafe(ack, { ok: false, error: 'Заключить союз не удалось: одновременно разрешён только один союзник.' });
        emitRoom(room);
        return;
      }
      room.actionsLeft -= 1;
      log(room, `${from.name} и ${to.name} заключают союз. ${from.name} тратит одно действие; осталось ${room.actionsLeft}.`);
    } else {
      log(room, `${to.name} отклоняет предложение союза от ${from.name}. Действие не потрачено.`);
    }
    room.pendingAlliance = null;
    ackSafe(ack, { ok: true, accepted: accept });
    emitRoom(room);
  });

  onSocketEvent(socket, 'cancelAllianceRequest', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const request = room?.pendingAlliance;
    if (!room || !request || request.id !== String(data?.requestId || '')) return ackSafe(ack, { ok: false, error: 'Предложение союза больше не активно.' });
    if (request.fromId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Отменить предложение может только инициатор.' });
    const from = playerById(room, request.fromId);
    const to = playerById(room, request.toId);
    room.pendingAlliance = null;
    log(room, `${from?.name || 'Игрок'} отменяет предложение союза${to ? ` игроку ${to.name}` : ''}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'breakAlliance', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Разорвать союз можно только в начале своего личного хода.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'navigation' || room.roll !== null) return ackSafe(ack, { ok: false, error: 'Союз можно бесплатно разорвать только до навигации в начале личного хода.' });
    const target = playerById(room, data?.targetPlayerId);
    if (!target || !areAllies(room, p, target)) return ackSafe(ack, { ok: false, error: 'Союз с этим игроком не найден.' });
    removeAlliance(room, p.id, target.id);
    p.brokenAlliesThisTurn ||= [];
    if (!p.brokenAlliesThisTurn.includes(target.id)) p.brokenAlliesThisTurn.push(target.id);
    log(room, `${p.name} разрывает союз с ${target.name}. В этот личный ход ${p.name} не может атаковать бывшего союзника.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });



  onSocketEvent(socket, 'resolveFleetAdjustment', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingFleetAdjustment;
    if (!room || !pending || pending.id !== String(data?.adjustmentId || '')) return ackSafe(ack, { ok: false, error: 'Эта настройка флотилии больше не ожидается.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Настройку должен выполнить владелец корабля.' });
    const player = playerById(room, pending.playerId);
    if (!player) return ackSafe(ack, { ok: false, error: 'Игрок не найден.' });
    const ids = Array.isArray(data?.ids) ? data.ids.map(String) : [];
    let result;
    if (pending.stage === 'bastions') {
      result = setInactiveBastions(room, player, ids);
      if (!result.ok) return ackSafe(ack, result);
      const names = ids.map(id => room.islands.find(island => island.id === id)?.name || id).join(', ');
      log(room, `${player.name} оставляет временно без поддержки каменотёсных дворов: ${names || 'ничего'}. Эти бастионы дают 0 войска до восстановления поддержки.`);
    } else if (pending.stage === 'upgrades') {
      result = setDisabledUpgrades(player, ids);
      if (!result.ok) return ackSafe(ack, result);
      const names = ids.map(id => SHIP_UPGRADES[id]?.name || id).join(', ');
      const cargoText = result.cargoDiscarded ? ` Излишек груза в основном трюме сброшен: ${result.cargoDiscarded}.` : '';
      log(room, `${player.name} временно отключает после потери уровня: ${names || 'ничего'}.${cargoText}`);
    } else if (pending.stage === 'escorts') {
      result = setLevelInactiveEscorts(player, ids);
      if (!result.ok) return ackSafe(ack, result);
      const statusById = new Map(escortStatuses(room, player).map(e => [e.id, e]));
      const names = ids.map(id => {
        const e = statusById.get(id) || (player.escorts || []).find(x => x.id === id);
        return ESCORTS[e?.type]?.name || e?.type || id;
      }).join(', ');
      log(room, `${player.name} временно выводит из активной флотилии после потери уровня: ${names || 'ничего'}. Груз на неактивных эскортах сохраняется.`);
    } else if (pending.stage === 'shipyard-remove') {
      result = removeEscortsForShipyard(room, player, ids);
      if (!result.ok) return ackSafe(ack, result);
      const names = result.removed.map(x => ESCORTS[x.escort.type]?.name || x.escort.type);
      const lostCargo = result.removed.filter(x => x.cargoDiscarded).map(x => `${ESCORTS[x.escort.type]?.name || x.escort.type}: ${GOODS[x.cargoDiscarded.goodId]?.name || x.cargoDiscarded.goodId} ×${x.cargoDiscarded.quantity}`);
      log(room, `${player.name} теряет из-за нехватки мест верфи: ${names.join(', ')}.${lostCargo.length ? ` Вместе с судами потерян груз: ${lostCargo.join('; ')}.` : ''}`);
    } else if (pending.stage === 'landin-replace') {
      if (ids.length !== 1) return ackSafe(ack, { ok: false, error: 'Выберите ровно одно судно сопровождения для замены.' });
      result = replaceEscortWithLandin(player, ids[0]);
      if (!result.ok) return ackSafe(ack, result);
      player.pendingLandinEscort = false;
      const oldName = ESCORTS[result.replaced?.type]?.name || result.replaced?.type || 'судно сопровождения';
      const cargoText = result.cargoDiscarded ? ` Груз заменённого судна потерян: ${GOODS[result.cargoDiscarded.goodId]?.name || result.cargoDiscarded.goodId} ×${result.cargoDiscarded.quantity}.` : '';
      log(room, `${player.name} заменяет ${oldName} на особое сопровождение Ландина (+${ESCORTS.landin.artillery} артиллерии, трюм ${ESCORTS.landin.cargo}).${cargoText}`);
    } else {
      return ackSafe(ack, { ok: false, error: 'Неизвестный этап настройки флотилии.' });
    }
    advanceFleetAdjustment(room);
    ackSafe(ack, { ok: true, pending: Boolean(room.pendingFleetAdjustment) });
    emitRoom(room);
  });

  onSocketEvent(socket, 'resolveIslandCorrection', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingIslandCorrection;
    if (!room || !pending || pending.id !== String(data?.correctionId || '')) return ackSafe(ack, { ok: false, error: 'Это исправление острова больше не ожидается.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Лишние постройки должен выбрать владелец острова.' });
    const player = playerById(room, pending.playerId);
    if (!player) return ackSafe(ack, { ok: false, error: 'Владелец острова не найден.' });
    const captureRetention = (pending.kind || 'constraints') === 'capture-retention';
    const result = captureRetention
      ? removeCapturedBuildingForRetention(room, player, pending.islandId, data?.buildingIndex)
      : removeIslandBuildingForCorrection(room, player, pending.islandId, data?.buildingIndex);
    if (!result.ok) return ackSafe(ack, result);
    pending.removed ||= [];
    pending.removed.push(result.name);
    if (captureRetention) pending.remainingRemovals = Math.max(0, (Number(pending.remainingRemovals) || 0) - 1);
    log(room, captureRetention
      ? `${player.name} выбирает ${result.name} на ${result.island.name} для уничтожения после захвата.`
      : `${player.name} удаляет ${result.name} с острова ${result.island.name} без компенсации для восстановления допустимых ограничений.`);
    if (result.garrisonChanged) {
      if (result.oldGarrison === 'permanent' && result.newGarrison === 'guard') log(room, `${result.island.name}: постоянный гарнизон становится городской стражей (+${BALANCE.garrisons.guard.defense}).`);
      else if (result.oldGarrison && !result.newGarrison) log(room, `${result.island.name}: городской отряд распущен из-за потери статуса города.`);
    }
    const stillPending = refreshPendingIslandCorrection(room);
    if (!stillPending) continueAfterIslandCorrection(room);
    ackSafe(ack, { ok: true, legal: !room.pendingIslandCorrection });
    emitRoom(room);
  });

  onSocketEvent(socket, 'enterVassalage', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Вступление в подданство требует одного действия в фазе действий.' });
    const factionId = String(data?.factionId || '');
    const allowed = canEnterVassalage(room, p, factionId);
    if (!allowed.ok) return ackSafe(ack, allowed);
    const result = enterVassalage(room, p, factionId);
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} вступает в подданство государства ${result.faction.name}. ${result.gift.name} немедленно передан вассалу. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true, factionId, giftIslandId: result.gift.id });
    emitRoom(room);
  });

  onSocketEvent(socket, 'rebelVassalage', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Мятеж требует одного действия в фазе действий.' });
    const result = rebelFromSuzerain(room, p);
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} объявляет мятеж против ${result.faction.name} и становится его врагом.${result.returned ? ` ${result.gift.name} возвращён сюзерену со всеми постройками.` : ''} Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'respondFeud', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingFeud;
    if (!room || !pending || pending.id !== String(data?.feudId || '')) return ackSafe(ack, { ok: false, error: 'Эта карта вражды больше не ожидает решения.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Эту карту должен разрешить другой игрок.' });
    const result = completePendingFeud(room, pending, data || {});
    ackSafe(ack, result);
    emitRoom(room);
  });


  onSocketEvent(socket, 'respondAssignmentChoice', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingAssignmentChoice;
    if (!room || !pending || pending.id !== String(data?.choiceId || '')) return ackSafe(ack, { ok: false, error: 'Это решение по поручению больше не ожидается.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Решение адресовано другому игроку.' });
    if (pending.kind !== 'embassy') return ackSafe(ack, { ok: false, error: 'Платная замена поручения удалена действующими правилами.' });
    const player = playerById(room, pending.playerId);
    if (!player) return ackSafe(ack, { ok: false, error: 'Игрок не найден.' });

    const assignmentId = String(data?.assignmentId || '');
    const result = chooseAssignmentOffer(room, player, pending.factionId, pending.options || [], assignmentId);
    if (!result.ok) return ackSafe(ack, result);
    log(room, player.name + ' выбирает через Посольство поручение ' + (FACTIONS[pending.factionId]?.name || pending.factionId) + ': «' + result.assignment.card.text + '».');
    room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: result.assignment.card.text, factionId: pending.factionId, factionName: FACTIONS[pending.factionId]?.name, pending: false, source: 'assignment' };
    room.pendingAssignmentChoice = null;
    processEventPhase(room);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'attackShip', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const target = playerById(room, data?.targetPlayerId);
    if (!target) return ackSafe(ack, { ok: false, error: 'Корабль-цель не найден.' });
    if (areAllies(room, p, target)) return ackSafe(ack, { ok: false, error: 'Союзники не могут нападать друг на друга.' });
    if ((p.brokenAlliesThisTurn || []).includes(target.id)) return ackSafe(ack, { ok: false, error: 'В этот личный ход нельзя атаковать бывшего союзника.' });
    if (room.round === 1) return ackSafe(ack, { ok: false, error: 'В первом раунде игроки не нападают друг на друга.' });
    if (!seaAttackPositionAllowed(p, target)) return ackSafe(ack, { ok: false, error: 'Для морской атаки нужно находиться на клетке цели или на одной из восьми соседних клеток.' });
    if (isCitadelPeaceCell(p.row, p.col) || isCitadelPeaceCell(target.row, target.col)) return ackSafe(ack, { ok: false, error: 'В зоне мира Цитадели морские бои запрещены.' });
    if (isShipProtected(target)) return ackSafe(ack, { ok: false, error: `Флотилия ${target.name} защищена «Покровом моря» и сейчас не может быть атакована.` });
    const carpenter = shipCarpenterRequest(room, p, Boolean(data?.useShipCarpenter));
    if (!carpenter.ok) return ackSafe(ack, carpenter);
    const attackLimit = registerPlayerAttack(room, p, target.id);
    if (!attackLimit.ok) return ackSafe(ack, attackLimit);

    markAttackHostilityAgainstPlayer(room, p, target);
    room.actionsLeft -= 1;
    if (target.connected && playerHasLegendaryKind(target, 'sea-veil')) {
      room.pendingLegendaryReaction = {
        id: crypto.randomUUID(), kind: 'sea-attack', sourcePlayerId: p.id, targetPlayerId: target.id,
        inviteAllies: Boolean(data?.inviteAllies),
        shipCarpenterPlayerIds: carpenter.playerIds,
      };
      log(room, `${p.name} объявляет морскую атаку на ${target.name} и тратит действие. ${target.name} может ответить «Покровом моря».`);
      ackSafe(ack, { ok: true, pending: true });
      emitRoom(room);
      return;
    }

    const result = beginSeaBattleResolution(room, p, target, Boolean(data?.inviteAllies), { shipCarpenterPlayerIds: carpenter.playerIds });
    if (!result.ok) { room.actionsLeft += 1; return ackSafe(ack, result); }
    ackSafe(ack, result);
    emitRoom(room);
  });

  onSocketEvent(socket, 'assaultIsland', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const island = room.islands.find(i => i.id === String(data?.islandId || ''));
    if (!island) return ackSafe(ack, { ok: false, error: 'Остров не найден.' });
    const owner = island.ownerId ? playerById(room, island.ownerId) : null;
    if (!playerOnIsland(p, island)) return ackSafe(ack, { ok: false, error: 'Для штурма основной корабль должен находиться на клетке этого острова.' });
    if (island.ownerId === p.id) return ackSafe(ack, { ok: false, error: 'Нельзя штурмовать собственный остров.' });
    if (!island.ownerId && island.kind === 'free') return ackSafe(ack, { ok: false, error: 'Свободный остров получают без штурма.' });
    if (owner && areAllies(room, p, owner)) return ackSafe(ack, { ok: false, error: 'Нельзя штурмовать остров союзника.' });
    if (owner && (p.brokenAlliesThisTurn || []).includes(owner.id)) return ackSafe(ack, { ok: false, error: 'В этот личный ход нельзя атаковать остров бывшего союзника.' });
    if (owner && room.round === 1) return ackSafe(ack, { ok: false, error: 'В первом раунде нельзя нападать на острова других игроков.' });
    if (isCitadelPeaceCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'В зоне мира Цитадели штурм запрещён.' });
    if (isIslandProtected(island)) return ackSafe(ack, { ok: false, error: `${island.name} защищён «Покровом моря» и сейчас не может быть атакован.` });
    const carpenter = shipCarpenterRequest(room, p, Boolean(data?.useShipCarpenter));
    if (!carpenter.ok) return ackSafe(ack, carpenter);
    if (owner) {
      const attackLimit = registerPlayerAttack(room, p, owner.id);
      if (!attackLimit.ok) return ackSafe(ack, attackLimit);
    }

    autoRebelBeforeStateAttack(room, p, island);
    markAttackHostilityAgainstIsland(room, p, island);
    room.actionsLeft -= 1;
    if (owner) trackAssignment(room, p, { type: 'attack-player-island', islandId: island.id, ownerId: owner.id });
    if (owner?.connected && playerHasLegendaryKind(owner, 'sea-veil')) {
      room.pendingLegendaryReaction = {
        id: crypto.randomUUID(), kind: 'assault', sourcePlayerId: p.id, targetPlayerId: owner.id,
        islandId: island.id, inviteAllies: Boolean(data?.inviteAllies),
        shipCarpenterPlayerIds: carpenter.playerIds,
      };
      log(room, `${p.name} объявляет штурм ${island.name} и тратит действие. ${owner.name} может ответить «Покровом моря».`);
      ackSafe(ack, { ok: true, pending: true });
      emitRoom(room);
      return;
    }

    const result = beginAssaultResolution(room, p, island, Boolean(data?.inviteAllies), { shipCarpenterPlayerIds: carpenter.playerIds });
    if (!result.ok) { room.actionsLeft += 1; return ackSafe(ack, result); }
    ackSafe(ack, result);
    emitRoom(room);
  });

  onSocketEvent(socket, 'respondBattle', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingBattle;
    if (!room || !pending || pending.id !== String(data?.battleId || '')) return ackSafe(ack, { ok: false, error: 'Этот бой уже не ожидает решения.' });
    const invite = pending.invites.find(inv => inv.playerId === socket.data.playerId);
    if (!invite) return ackSafe(ack, { ok: false, error: 'Вы не приглашены в этот совместный бой.' });
    if (invite.response === true || invite.response === false) return ackSafe(ack, { ok: false, error: 'Ответ уже принят.' });
    const participate = Boolean(data?.participate);
    const player = playerById(room, invite.playerId);
    if (participate && invite.side === 'attacker' && player) {
      if (pending.kind === 'sea') {
        const target = playerById(room, pending.targetPlayerId);
        const attackLimit = registerPlayerAttack(room, player, target?.id);
        if (!attackLimit.ok) return ackSafe(ack, attackLimit);
        markAttackHostilityAgainstPlayer(room, player, target, 'участие в нападении на вассала');
      } else {
        const island = room.islands.find(i => i.id === pending.islandId);
        const owner = island?.ownerId ? playerById(room, island.ownerId) : null;
        if (owner) {
          const attackLimit = registerPlayerAttack(room, player, owner.id);
          if (!attackLimit.ok) return ackSafe(ack, attackLimit);
        }
        autoRebelBeforeStateAttack(room, player, island);
        markAttackHostilityAgainstIsland(room, player, island, 'участие в нападении на государство или его вассала');
      }
    }
    invite.response = participate;
    log(room, `${player?.name || 'Игрок'} ${invite.response ? 'присоединяется' : 'не участвует'} ${invite.side === 'attacker' ? 'в атаке' : 'в защите'}.`);
    const resolved = allBattleInvitesAnswered(pending) ? resolvePendingBattle(room) : null;
    if (resolved?.ok) log(room, `Совместный бой завершён. Осталось действий у инициатора: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true, resolved: Boolean(resolved) });
    emitRoom(room);
  });

  onSocketEvent(socket, 'endTurn', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || room.phase === 'event' || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    log(room, `${p.name} завершил личный ход.`);
    endTurnInternal(room);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  onSocketEvent(socket, 'disconnect', () => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return;
    const p = room.players.find(x => x.id === socket.data.playerId);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.socketId = null;
    if (shuttingDown) {
      persistRoom(roomStore.save(room));
      return;
    }
    if (room.pendingAlliance && (room.pendingAlliance.fromId === p.id || room.pendingAlliance.toId === p.id)) {
      room.pendingAlliance = null;
      log(room, `Незавершённое предложение союза отменено из-за отключения ${p.name}.`);
    }
    if (room.pendingLegendaryReaction && room.pendingLegendaryReaction.targetPlayerId === p.id) {
      log(room, `${p.name} не использует «Покров моря» из-за отключения.`);
      resolvePendingLegendaryReaction(room, false, null);
    }
    if (room.pendingBattle) {
      const invite = room.pendingBattle.invites.find(inv => inv.playerId === p.id && inv.response == null);
      if (invite) {
        invite.response = false;
        log(room, `${p.name} автоматически не участвует в совместном бою из-за отключения.`);
        if (allBattleInvitesAnswered(room.pendingBattle)) resolvePendingBattle(room);
      }
    }
    log(room, `${p.name} отключился. Его место сохранено.`);
    emitRoom(room);
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/rules', (_req, res) => res.json(require('./rules')));
app.get('/health', (_req, res) => res.json({ ok: true, version: '0.33.0', rooms: rooms.size, accountsEnabled: Boolean(db), databaseReady: dbReady, roomPersistence: { enabled: Boolean(db), restored: roomStore.restored, pending: roomStore.pending.size, healthy: !roomStore.lastError } }));

async function startServer() {
  // Never accept room creation before restoration or silently start empty on DB failure.
  await initDatabase();
  server.listen(PORT, HOST, () => {
    console.log(`Первооткрыватели Online MVP 0.33.0: http://${HOST}:${PORT}`);
  });
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline = setTimeout(() => process.exit(1), 25000);
  io.close();
  await roomStore.flush();
  if (db) await db.end();
  clearTimeout(deadline);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
startServer().catch(err => {
  console.error('Database startup failed:', err.message);
  process.exit(1);
});
