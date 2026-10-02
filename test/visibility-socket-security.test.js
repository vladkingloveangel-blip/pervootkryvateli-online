const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { io } = require('socket.io-client');
const { projectOpponentFacingRoomView } = require('../state-projection');
const { pendingResolutionFromLegacy, setPendingResolution } = require('../domain-state');

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const PRIVATE_PLAYER_KEYS = [
  'ducats', 'debt', 'character', 'activeAssignment', 'hasActiveAssignment', 'assignmentPriority',
  'specialCards', 'specialCardCount', 'legendaryCards', 'legendaryCardCount', 'playableLegendaryCards',
  'savedEventCards', 'savedEventCardCount', 'activeExpedition', 'hasActiveExpedition', 'nextTurnEffects',
];
const PRIVATE_GARRISON_KEYS = ['garrisonType', 'garrisonName', 'garrisonDefense', 'defenseArmy', 'defenseBreakdown'];
const ROOT_SIDE_CHANNELS = ['log', 'eventDecks', 'feudDecks', 'assignmentDecks', 'scoutRevealGrants'];

function assertKeysAbsent(object, keys, label = 'object') {
  for (const key of keys) assert.equal(has(object, key), false, `${label}.${key} must be omitted`);
}
function assertOpponentPrivateAbsent(view, targetId) {
  const player = view.players.find(item => item.id === targetId);
  assert.ok(player, `missing target player ${targetId}`);
  assertKeysAbsent(player, PRIVATE_PLAYER_KEYS, `player:${targetId}`);
  return player;
}
function assertOwnerPrivateVisible(view, ownerId) {
  const player = view.players.find(item => item.id === ownerId);
  assert.ok(player, `missing owner player ${ownerId}`);
  for (const key of ['ducats', 'debt', 'character', 'activeAssignment', 'specialCards', 'specialCardCount', 'legendaryCards', 'legendaryCardCount', 'playableLegendaryCards', 'savedEventCards', 'savedEventCardCount', 'activeExpedition', 'nextTurnEffects']) {
    assert.equal(has(player, key), true, `owner must receive ${key}`);
  }
  return player;
}
function assertPrivateGarrisonAbsent(view, islandId) {
  const island = view.islands.find(item => item.id === islandId);
  assert.ok(island, `missing island ${islandId}`);
  assertKeysAbsent(island, PRIVATE_GARRISON_KEYS, `island:${islandId}`);
  return island;
}
function assertNoRootSideChannels(view) {
  assertKeysAbsent(view, ROOT_SIDE_CHANNELS, 'room');
}
function assertSecretStringsAbsent(view, secrets) {
  const json = JSON.stringify(view);
  for (const secret of secrets) assert.equal(json.includes(secret), false, `${secret} leaked`);
}
function assertPublicPlayerState(view, playerId) {
  const player = view.players.find(item => item.id === playerId);
  assert.ok(player);
  for (const key of ['id', 'name', 'color', 'row', 'col', 'shipClass', 'level', 'stats', 'cargo', 'upgrades', 'escorts', 'glory', 'fleetPoints','armyPoints', 'suzerainId', 'allyIds', 'landCompany', 'legendaryStatus', 'activeTurnEffects', 'expeditionHistory']) {
    assert.equal(has(player, key), true, `public player field ${key} missing`);
  }
  return player;
}
function assertPublicIslandState(view, islandId) {
  const island = view.islands.find(item => item.id === islandId);
  assert.ok(island);
  for (const key of ['id', 'name', 'ownerId', 'status', 'resources', 'buildings', 'constraints']) {
    assert.equal(has(island, key), true, `public island field ${key} missing`);
  }
  assert.equal(island.buildings.some(building => building.type === 'fort'), true, 'public fort state missing');
  return island;
}

async function createHarness(t, suffix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pervo-visibility-${suffix}-`));
  const file = path.join(dir, 'database.json');
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const sockets = [];
  let child = null;
  let output = '';

  async function start() {
    output = '';
    child = spawn(process.execPath, ['--require', './test/fixtures/postgres.cjs', 'server.js'], {
      cwd: path.join(__dirname, '..'),
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: 'postgres://test',
        AUTH_SECRET: `visibility-${suffix}-secret`, ADMIN_USERNAME: 'visibilityadmin', ADMIN_PASSWORD: 'testpassword',
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
    throw Error(`Server did not start: ${output}`);
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
    socket.timeout(5000).emit(name, data, (error, value) => error ? reject(error) : resolve(value))
  );
  async function api(route, body) {
    const response = await fetch(base + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return response.json();
  }
  const database = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const roomRow = () => database().game_rooms[0];
  const writeDatabase = value => fs.writeFileSync(file, JSON.stringify(value));

  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { start, stop, connect, emit, api, database, roomRow, writeDatabase };
}

async function bootstrapStartedRoom(h) {
  await h.start();
  const accounts = [];
  for (let i = 0; i < 4; i++) {
    const account = await h.api('/api/auth/register', { username: `visibilityp1${i + 1}`, password: `password${i + 1}` });
    assert.equal(account.ok, true);
    accounts.push(account);
  }
  const admin = await h.api('/api/auth/login', { username: 'visibilityadmin', password: 'testpassword' });
  assert.equal(admin.ok, true);
  const sockets = await Promise.all(accounts.map(() => h.connect()));
  const created = await h.emit(sockets[0], 'createRoom', { accountToken: accounts[0].token, name: 'Visibility One' });
  const joined = [];
  for (let i = 1; i < accounts.length; i++) {
    joined.push(await h.emit(sockets[i], 'joinRoom', { code: created.code, accountToken: accounts[i].token, name: `Visibility ${i + 1}` }));
  }
  const members = [
    { playerId: created.playerId, account: accounts[0] },
    ...joined.map((entry, index) => ({ playerId: entry.playerId, account: accounts[index + 1] })),
  ];
  for (let i = 0; i < sockets.length; i++) assert.equal((await h.emit(sockets[i], 'changeShip', { shipClass: 'brigantine' })).ok, true);
  for (let i = 0; i < sockets.length; i++) assert.equal((await h.emit(sockets[i], 'setReady', { ready: true })).ok, true);
  assert.equal((await h.emit(sockets[0], 'startGame')).ok, true);
  await h.stop();

  const db = h.database();
  const room = db.game_rooms[0].state;
  const activeId = room.order[room.turnIndex];
  const a = members.find(member => member.playerId === activeId);
  const others = members.filter(member => member.playerId !== activeId);
  assert.ok(a && others.length >= 3);
  return { code: created.code, admin, members, a, b: others[0], c: others[1], d: others[2], db, room };
}

function makeCityGarrison(island, ownerId, defense, unknownTag) {
  island.ownerId = ownerId;
  island.buildings = [
    { type: 'manor', level: 1 },
    { type: 'lumbermill', level: 1 },
    { type: 'quarry', level: 1 },
    { type: 'mine', level: 1 },
    { type: 'fort', level: 2, unknownBuildingField: `SECRET_${unknownTag}_BUILDING_UNKNOWN` },
  ];
  island.garrisonType = 'guard';
  island.garrisonDefense = defense;
  island.garrisonOrigin = 'guard';
  island.unknownIslandField = `SECRET_${unknownTag}_ISLAND_UNKNOWN`;
  island.unknownGarrisonField = `SECRET_${unknownTag}_GARRISON_UNKNOWN`;
}

function privateAssignment(tag) {
  return {
    instanceId: `SECRET_${tag}_ASSIGNMENT_ID`, factionId: 'mori', issuedRound: 1,
    card: {
      id: `SECRET_${tag}_ASSIGNMENT_CARD`, conditionKey: 'visit-island', text: `SECRET_${tag}_ASSIGNMENT_TEXT`,
      reward: tag === 'A' ? 31 : 41, type: 'visit-island', targetIslandId: 'SECRET_ASSIGNMENT_TARGET',
    },
    progress: { kind: 'visit-island', completedStopCount: 0, departureRequired: false, departureSatisfied: false, unknown: `SECRET_${tag}_ASSIGNMENT_PROGRESS_UNKNOWN` },
  };
}

function seedPrivatePlayer(player, tag, options = {}) {
  player.name = `Player ${tag}`;
  player.ducats = tag === 'A' ? 111 : tag === 'B' ? 222 : 333;
  player.debt = tag === 'A' ? 11 : tag === 'B' ? 22 : 33;
  player.character = options.character || (tag === 'A' ? 'scout' : 'navigator');
  const assignment = privateAssignment(tag);
  player.activeAssignmentTask = {
    instanceId: assignment.instanceId,
    definitionId: assignment.card.id,
    factionId: assignment.factionId,
    issuedRound: assignment.issuedRound,
    progress: assignment.progress,
    definitionData: assignment.card,
  };
  delete player.activeAssignment;
  player.consumableAbilities = [
    { instanceId: `ability-${tag}-legendary`, abilityId: 'mist-path', origin: { kind: 'legendary' }, data: { name: `SECRET_${tag}_LEGENDARY`, kind: 'mist-path' } },
    { instanceId: `ability-${tag}-special`, abilityId: null, origin: { kind: 'special', legacyName: `SECRET_${tag}_SPECIAL` } },
  ];
  player.consumableAbilitySequence = 2;
  delete player.specialCards;
  delete player.legendaryCards;
  player.storedBenefits = [{
    instanceId: `benefit-${tag}`,
    id: `saved-${tag}`,
    kind: 'cargo',
    source: {},
    payload: { name: `SECRET_${tag}_SAVED`, goodId: 'wood' },
  }];
  delete player.savedEventCards;
  const expeditionCard = options.expeditionCard;
  assert.ok(expeditionCard?.id && expeditionCard?.placeId, 'security fixture needs a canonical expedition card');
  player.activeExpeditionTask = { expeditionId: expeditionCard.id, placeId: expeditionCard.placeId, acceptedRound: 1, startedAtTarget: true, departedAfterIssue: false, futurePrivateField: `SECRET_${tag}_EXPEDITION` };
  delete player.activeExpedition;
  player.nextTurnEffects = { moveBonus: 2, bestOfTwo: true, source: `SECRET_${tag}_NEXT_SOURCE` };
  player.activeTurnEffects = { movePenalty: 1, source: `SECRET_${tag}_ACTIVE_SOURCE` };
  player.legendaryEffects = { seaCurses: [{ remaining: 2 }] };
  player.landCompany = { army: 3, arsenalLevel: 1, sourceIslandId: 'public-source', formedAt: 123, unknown: `SECRET_${tag}_LAND_UNKNOWN` };
  player.expeditionCompletions = [{ id: `history-${tag}`, expeditionId: expeditionCard.id, name: `Completed ${tag}`, placeId: expeditionCard.placeId, completedRound: 1 }];
  delete player.expeditionHistory;
  player.visitedAnchors = [`anchor-${tag}`];
  player.lastAnchorEncounter = { round: 1, row: 1, col: 1, color: 'red', anchorName: 'Red', cardName: 'Resolved', outcome: 'win', fleetPoints: 1, reward: { gross: 9, debtPaid: 2, net: 7, debtRemaining: 3 }, penalty: { required: 0, paid: 0, addedDebt: 0, debt: 3 } };
  player.unknownPlayerField = `SECRET_${tag}_PLAYER_UNKNOWN`;
  player.row = options.row ?? player.row;
  player.col = options.col ?? player.col;
}

function prepareSecurityState(room, ids) {
  room.phase = 'actions';
  room.actionsLeft = 4;
  room.eventPhase = null;
  room.pendingEvent = null;
  room.pendingFeud = null;
  room.pendingAssignmentChoice = null;
  room.pendingIslandCorrection = null;
  room.pendingFleetAdjustment = null;
  room.pendingLegendaryReaction = null;
  room.pendingBattle = null;
  room.pendingAlliance = null;
  room.scoutRevealGrants = [];
  const a = room.players.find(player => player.id === ids.a);
  const b = room.players.find(player => player.id === ids.b);
  const c = room.players.find(player => player.id === ids.c);
  const expeditionPool = room.randomSourceState?.expeditionPool;
  const expeditionCards = expeditionPool?.available?.splice(0, 3) || [];
  assert.ok(expeditionCards.length >= 3, 'security fixture needs three canonical expedition cards');
  expeditionPool.reserved.push(...expeditionCards);
  seedPrivatePlayer(a, 'A', { character: 'scout', row: 10, col: 10, expeditionCard: expeditionCards[0] });
  seedPrivatePlayer(b, 'B', { row: 10, col: 13, expeditionCard: expeditionCards[1] });
  seedPrivatePlayer(c, 'C', { row: 18, col: 18, expeditionCard: expeditionCards[2] });
  const eligibleIslands = room.islands.filter(island => Number(island.area) >= 4);
  assert.ok(eligibleIslands.length >= 2, 'security fixture needs two city-capable islands');
  const [bIsland, cIsland] = eligibleIslands;
  makeCityGarrison(bIsland, b.id, 1, 'B');
  makeCityGarrison(cIsland, c.id, 1, 'C');
  a.row = bIsland.cells[0][0];
  a.col = bIsland.cells[0][1];
  b.row = a.row;
  b.col = a.col + 3;
  return { a, b, c, bIsland, cIsland };
}

async function resumeWithState(h, code, member) {
  const socket = await h.connect();
  const delivery = once(socket, 'roomState');
  const result = await h.emit(socket, 'resumeRoom', { code, accountToken: member.account.token });
  assert.equal(result.ok, true);
  const [state] = await delivery;
  return { socket, state };
}

test('4.7 real sockets isolate owner/opponent/admin state and Scout grants across device, reconnect, restart, replacement and end-turn', { timeout: 90000 }, async t => {
  const h = await createHarness(t, 'clients');
  const boot = await bootstrapStartedRoom(h);
  const seeded = prepareSecurityState(boot.room, { a: boot.a.playerId, b: boot.b.playerId, c: boot.c.playerId });
  h.writeDatabase(boot.db);
  await h.start();

  const aResume = await resumeWithState(h, boot.code, boot.a);
  const bResume = await resumeWithState(h, boot.code, boot.b);
  const cResume = await resumeWithState(h, boot.code, boot.c);
  let aSocket = aResume.socket;
  const bSocket = bResume.socket;
  const cSocket = cResume.socket;
  const aView = aResume.state;
  const bView = bResume.state;
  const cView = cResume.state;

  const aOwn = assertOwnerPrivateVisible(aView, boot.a.playerId);
  const bOwn = assertOwnerPrivateVisible(bView, boot.b.playerId);
  assert.equal(aOwn.ducats, 111);
  assert.equal(aOwn.debt, 11);
  assert.equal(aOwn.activeAssignment.text, 'SECRET_A_ASSIGNMENT_TEXT');
  assert.equal(aOwn.specialCards[0], 'SECRET_A_SPECIAL');
  assert.equal(aOwn.legendaryCards[0].name, 'SECRET_A_LEGENDARY');
  assert.equal(aOwn.savedEventCards[0].name, 'SECRET_A_SAVED');
  assert.equal(aOwn.activeExpedition.cardId, seeded.a.activeExpeditionTask.expeditionId);
  assert.ok(aOwn.activeExpedition.name);
  assert.equal(aOwn.activeExpedition.name.includes('SECRET_'), false);
  assert.equal(has(aOwn, 'unknownPlayerField'), false);
  assert.equal(JSON.stringify(aOwn).includes('SECRET_A_PLAYER_UNKNOWN'), false);
  assert.equal(bOwn.ducats, 222);
  assert.equal(bOwn.activeAssignment.text, 'SECRET_B_ASSIGNMENT_TEXT');
  assertOpponentPrivateAbsent(aView, boot.b.playerId);
  assertOpponentPrivateAbsent(bView, boot.a.playerId);
  assertOpponentPrivateAbsent(cView, boot.a.playerId);
  assertNoRootSideChannels(aView);
  assertNoRootSideChannels(bView);
  assertPublicPlayerState(aView, boot.b.playerId);
  assert.equal(has(aView, 'alliances'), true);
  assertPublicPlayerState(bView, boot.a.playerId);
  assertPublicIslandState(aView, seeded.bIsland.id);
  assertPublicIslandState(bView, seeded.bIsland.id);
  assertPrivateGarrisonAbsent(aView, seeded.bIsland.id);
  assert.equal(bView.islands.find(island => island.id === seeded.bIsland.id).garrisonType, 'guard');
  assert.equal(bView.islands.find(island => island.id === seeded.bIsland.id).garrisonDefense, 1);
  assert.equal(has(bView.islands.find(island => island.id === seeded.bIsland.id), 'unknownIslandField'), false);
  assert.equal(has(bView.islands.find(island => island.id === seeded.bIsland.id).buildings[0], 'unknownBuildingField'), false);
  assert.equal(has(aView.players.find(player => player.id === boot.b.playerId).lastAnchorEncounter, 'reward'), false);
  assert.equal(has(aView.players.find(player => player.id === boot.b.playerId).lastAnchorEncounter, 'penalty'), false);
  assert.equal(has(bView.players.find(player => player.id === boot.b.playerId).lastAnchorEncounter, 'reward'), true);
  assertSecretStringsAbsent(aView, ['SECRET_B_ASSIGNMENT_TEXT', 'SECRET_B_SPECIAL', 'SECRET_B_LEGENDARY', 'SECRET_B_SAVED', 'SECRET_B_EXPEDITION', 'SECRET_B_PLAYER_UNKNOWN', 'SECRET_B_ISLAND_UNKNOWN', 'SECRET_B_GARRISON_UNKNOWN', 'SECRET_B_BUILDING_UNKNOWN']);
  assertSecretStringsAbsent(bView, ['SECRET_A_ASSIGNMENT_TEXT', 'SECRET_A_SPECIAL', 'SECRET_A_LEGENDARY', 'SECRET_A_SAVED', 'SECRET_A_EXPEDITION', 'SECRET_A_PLAYER_UNKNOWN']);

  const adminSocket = await h.connect();
  const adminWatch = await h.emit(adminSocket, 'adminWatchRoom', { code: boot.code, accountToken: boot.admin.token });
  assert.equal(adminWatch.ok, true);
  assert.equal(has(adminWatch.room, 'log'), true);
  assert.equal(has(adminWatch.room, 'eventDecks'), true);
  assert.equal(has(adminWatch.room, 'feudDecks'), true);
  assert.equal(has(adminWatch.room, 'assignmentDecks'), true);
  assert.equal(adminWatch.room.players.find(player => player.id === boot.b.playerId).ducats, 222);

  await h.stop();
  let db = h.database();
  let room = db.game_rooms[0].state;
  const active = room.players.find(player => player.id === boot.a.playerId);
  active.activeAssignmentTask = null; delete active.activeAssignment; // avoid assignment-priority middleware during Scout lifecycle actions.
  active.character = 'scout';
  const selectedIsland = room.islands.find(island => island.id === seeded.bIsland.id);
  active.row = selectedIsland.cells[0][0];
  active.col = selectedIsland.cells[0][1];
  const target = room.players.find(player => player.id === boot.b.playerId);
  target.row = active.row;
  target.col = active.col + 3;
  room.phase = 'actions';
  room.actionsLeft = 4;
  h.writeDatabase(db);
  await h.start();

  const aMoneyResume = await resumeWithState(h, boot.code, boot.a);
  const bMoneyResume = await resumeWithState(h, boot.code, boot.b);
  const cMoneyResume = await resumeWithState(h, boot.code, boot.c);
  aSocket = aMoneyResume.socket;
  const moneyA = once(aSocket, 'roomState');
  const moneyB = once(bMoneyResume.socket, 'roomState');
  const moneyC = once(cMoneyResume.socket, 'roomState');
  const moneyAck = await h.emit(aSocket, 'useScout', {
    mode: 'money', targetPlayerId: boot.b.playerId,
    viewerPlayerId: boot.c.playerId, debt: true, garrison: { defenseArmy: 999 },
    scoutRevealGrants: [{ viewerPlayerId: boot.c.playerId }], secondTargetId: boot.c.playerId,
    arbitrarySecretScope: 'all-private',
  });
  assert.deepEqual(Object.keys(moneyAck).sort(), ['actionCost', 'actionsLeft', 'mode', 'ok']);
  const [[aMoney], [bMoney], [cMoney]] = await Promise.all([moneyA, moneyB, moneyC]);
  const aMoneyTarget = aMoney.players.find(player => player.id === boot.b.playerId);
  assert.equal(aMoneyTarget.ducats, 222);
  assertKeysAbsent(aMoneyTarget, PRIVATE_PLAYER_KEYS.filter(key => key !== 'ducats'), 'Scout-money target');
  assertOpponentPrivateAbsent(bMoney, boot.a.playerId);
  assert.equal(has(cMoney.players.find(player => player.id === boot.b.playerId), 'ducats'), false);
  assertNoRootSideChannels(aMoney);
  assertNoRootSideChannels(bMoney);
  assertNoRootSideChannels(cMoney);
  assertSecretStringsAbsent(aMoney, ['SECRET_B_ASSIGNMENT_TEXT', 'SECRET_B_SPECIAL', 'SECRET_B_LEGENDARY', 'SECRET_B_SAVED', 'SECRET_B_EXPEDITION']);
  let persisted = h.roomRow().state;
  assert.deepEqual(persisted.scoutRevealGrants, [{ viewerPlayerId: boot.a.playerId, mode: 'money', targetPlayerId: boot.b.playerId, personalTurnNo: persisted.players.find(player => player.id === boot.a.playerId).personalTurnNo }]);

  const replacement = await h.connect();
  const removed = once(aSocket, 'removedFromRoom');
  const replacementDelivery = once(replacement, 'roomState');
  assert.equal((await h.emit(replacement, 'resumeRoom', { code: boot.code, accountToken: boot.a.account.token })).ok, true);
  const [[removedPayload], [replacementState]] = await Promise.all([removed, replacementDelivery]);
  assert.equal(removedPayload.reason, 'Игра открыта на другом устройстве.');
  assert.equal(replacementState.players.find(player => player.id === boot.b.playerId).ducats, 222);
  let detachedDeliveries = 0;
  aSocket.on('roomState', () => { detachedDeliveries += 1; });
  const bRefresh = once(bMoneyResume.socket, 'roomState');
  await h.emit(bMoneyResume.socket, 'resumeRoom', { code: boot.code, accountToken: boot.b.account.token });
  await bRefresh;
  assert.equal(detachedDeliveries, 0);

  const bAfterDisconnect = once(bMoneyResume.socket, 'roomState');
  replacement.disconnect();
  // Disconnecting the current A endpoint does not transfer A's grant to B/C.
  const [bDisconnectedView] = await bAfterDisconnect;
  assert.equal(has(bDisconnectedView.players.find(player => player.id === boot.a.playerId), 'ducats'), false);
  assert.equal(has(bDisconnectedView.players.find(player => player.id === boot.b.playerId), 'ducats'), true); // B still owns B.
  const reconnect = await resumeWithState(h, boot.code, boot.a);
  assert.equal(reconnect.state.players.find(player => player.id === boot.b.playerId).ducats, 222);
  assert.equal(h.roomRow().state.players.find(player => player.id === boot.a.playerId).personalTurnNo,
    persisted.players.find(player => player.id === boot.a.playerId).personalTurnNo);

  // Same-turn restart preserves only the capability; revealed value is recomputed from live authoritative state.
  await h.stop();
  db = h.database();
  room = db.game_rooms[0].state;
  const restartA = room.players.find(player => player.id === boot.a.playerId);
  const restartB = room.players.find(player => player.id === boot.b.playerId);
  const turnNo = restartA.personalTurnNo;
  restartB.ducats = 919;
  restartB.debt = 929;
  restartA.character = 'scout'; // test-fixture rearm so a second real use can replace the current grant.
  room.actionsLeft = 4;
  h.writeDatabase(db);
  await h.start();
  const afterRestartA = await resumeWithState(h, boot.code, boot.a);
  const afterRestartB = await resumeWithState(h, boot.code, boot.b);
  const afterRestartC = await resumeWithState(h, boot.code, boot.c);
  assert.equal(afterRestartA.state.players.find(player => player.id === boot.b.playerId).ducats, 919);
  assert.equal(has(afterRestartA.state.players.find(player => player.id === boot.b.playerId), 'debt'), false);
  assert.equal(has(afterRestartB.state.players.find(player => player.id === boot.a.playerId), 'ducats'), false);
  assert.equal(has(afterRestartC.state.players.find(player => player.id === boot.b.playerId), 'ducats'), false);
  assert.equal(h.roomRow().state.players.find(player => player.id === boot.a.playerId).personalTurnNo, turnNo);
  assert.deepEqual(h.roomRow().state.scoutRevealGrants, [{ viewerPlayerId: boot.a.playerId, mode: 'money', targetPlayerId: boot.b.playerId, personalTurnNo: turnNo }]);

  // A second real Scout use replaces money with one selected garrison and exposes no owner-private player data.
  const garrisonA = once(afterRestartA.socket, 'roomState');
  const garrisonB = once(afterRestartB.socket, 'roomState');
  const garrisonC = once(afterRestartC.socket, 'roomState');
  const garrisonAck = await h.emit(afterRestartA.socket, 'useScout', {
    mode: 'garrison', islandId: seeded.bIsland.id,
    viewerPlayerId: boot.c.playerId, debt: true, garrison: { garrisonDefense: 999 }, secondTargetId: seeded.cIsland.id,
  });
  assert.deepEqual(Object.keys(garrisonAck).sort(), ['actionCost', 'actionsLeft', 'mode', 'ok']);
  const [[aGarrison], [bGarrison], [cGarrison]] = await Promise.all([garrisonA, garrisonB, garrisonC]);
  assert.equal(has(aGarrison.players.find(player => player.id === boot.b.playerId), 'ducats'), false, 'money grant must be replaced');
  const revealedIsland = aGarrison.islands.find(island => island.id === seeded.bIsland.id);
  assert.equal(revealedIsland.garrisonType, 'guard');
  assert.equal(revealedIsland.garrisonDefense, 1);
  assert.equal(has(revealedIsland, 'defenseBreakdown'), true);
  assertPrivateGarrisonAbsent(aGarrison, seeded.cIsland.id);
  assertOpponentPrivateAbsent(aGarrison, boot.b.playerId);
  assertPrivateGarrisonAbsent(cGarrison, seeded.bIsland.id);
  assert.equal(bGarrison.islands.find(island => island.id === seeded.bIsland.id).garrisonType, 'guard');
  assertSecretStringsAbsent(aGarrison, ['SECRET_B_ASSIGNMENT_TEXT', 'SECRET_B_SPECIAL', 'SECRET_B_LEGENDARY', 'SECRET_B_SAVED', 'SECRET_B_EXPEDITION']);
  assert.deepEqual(h.roomRow().state.scoutRevealGrants, [{ viewerPlayerId: boot.a.playerId, mode: 'garrison', islandId: seeded.bIsland.id, personalTurnNo: turnNo }]);

  // End turn clears the capability and no next player inherits it.
  const endA = once(afterRestartA.socket, 'roomState');
  const endB = once(afterRestartB.socket, 'roomState');
  const endC = once(afterRestartC.socket, 'roomState');
  assert.equal((await h.emit(afterRestartA.socket, 'endTurn')).ok, true);
  const [[aEnded], [bEnded], [cEnded]] = await Promise.all([endA, endB, endC]);
  assert.deepEqual(h.roomRow().state.scoutRevealGrants, []);
  assertPrivateGarrisonAbsent(aEnded, seeded.bIsland.id);
  assert.equal(has(cEnded.players.find(player => player.id === boot.b.playerId), 'ducats'), false);
  assertNoRootSideChannels(aEnded);
  assertNoRootSideChannels(bEnded);

  // Real restart rejects stale/malformed persisted grants.
  await h.stop();
  db = h.database();
  room = db.game_rooms[0].state;
  room.scoutRevealGrants = [
    { viewerPlayerId: boot.a.playerId, mode: 'money', targetPlayerId: boot.b.playerId, personalTurnNo: turnNo - 1, ducats: 999 },
    { viewerPlayerId: boot.a.playerId, mode: 'bogus', targetPlayerId: boot.b.playerId, personalTurnNo: turnNo, arbitrarySecretScope: 'all' },
  ];
  h.writeDatabase(db);
  await h.start();
  assert.deepEqual(h.roomRow().state.scoutRevealGrants, []);
  const staleA = await resumeWithState(h, boot.code, boot.a);
  assert.equal(has(staleA.state.players.find(player => player.id === boot.b.playerId), 'ducats'), false);
  assert.equal(has(staleA.state, 'scoutRevealGrants'), false);
});

function pendingFixture(family, actorId, otherId, islandId) {
  const common = { id: `pending-${family}`, unknownPending: 'SECRET_PENDING_UNKNOWN' };
  if (family === 'pendingEvent') return { ...common, playerId: actorId, kind: 'SECRET_PENDING_KIND', cardName: 'SECRET_PENDING_CARD', goodId: 'wood', options: [{ id: 'event-opt', name: 'SECRET_PENDING_OPTION', row: 3, col: 4, unknown: 'SECRET_PENDING_OPTION_UNKNOWN' }] };
  if (family === 'pendingFeud') return { ...common, playerId: actorId, kind: 'SECRET_PENDING_KIND', cardName: 'SECRET_PENDING_CARD', factionId: 'mori', remaining: 1, options: [{ id: 'feud-opt', name: 'SECRET_PENDING_OPTION', islandId, canDowngrade: true }] };
  if (family === 'pendingAssignmentChoice') return { ...common, playerId: actorId, kind: 'embassy', factionId: 'mori', options: [{ id: 'assignment-opt', text: 'SECRET_PENDING_OPTION', reward: 17, type: 'visit-island' }] };
  if (family === 'pendingIslandCorrection') return { ...common, playerId: actorId, kind: 'constraints', islandId, islandName: 'SECRET_PENDING_ISLAND', reason: 'SECRET_PENDING_REASON', initialBuildingCount: 2, keepCount: 1, remainingRemovals: 1, removed: ['SECRET_PENDING_REMOVED'], report: { legal: false, status: 'Город', usedArea: 9, effectiveArea: 8, overArea: 1, branchLimit: 2, branchViolations: [] }, options: [{ buildingIndex: 0, name: 'SECRET_PENDING_OPTION', type: 'fort', level: 1, area: 1, branch: 'fort', branchName: 'Fort' }] };
  if (family === 'pendingFleetAdjustment') return { ...common, playerId: actorId, stage: 'escorts', reason: 'SECRET_PENDING_REASON', required: 1, options: [{ id: 'escort-opt', name: 'SECRET_PENDING_OPTION', type: 'merchant', missingRequirement: false, special: false, artillery: 0, cargoCapacity: 2, hasCargo: false, cargoText: '' }] };
  if (family === 'pendingLegendaryReaction') return { ...common, targetPlayerId: actorId, sourcePlayerId: otherId, islandId, kind: 'SECRET_PENDING_KIND', source: 'SECRET_PENDING_SOURCE', options: ['SECRET_PENDING_OPTION'] };
  throw Error(`unknown pending family ${family}`);
}

test('4.7 personal pending families and event phase are actor-only over real roomState delivery', { timeout: 90000 }, async t => {
  const h = await createHarness(t, 'pending');
  const boot = await bootstrapStartedRoom(h);
  const families = ['pendingEvent', 'pendingFeud', 'pendingAssignmentChoice', 'pendingIslandCorrection', 'pendingFleetAdjustment', 'pendingLegendaryReaction'];
  boot.room.phase = 'actions';
  boot.room.preTurnResolutionFlow = {
    active: true,
    personalTurn: true,
    currentPlayerId: boot.a.playerId,
    stage: 'SECRET_EVENT_STAGE',
    indexes: { sailing: 2, political: 1, assignment: 1 },
    queues: { political: ['SECRET_FEUD_QUEUE'], assignment: ['SECRET_ASSIGNMENT_QUEUE'] },
    counters: { observatoryReplacementsUsed: 1 },
    lastCard: { playerId: boot.a.playerId, playerName: 'Player A', cardName: 'SECRET_EVENT_CARD', factionId: 'mori', factionName: 'SECRET_EVENT_FACTION', pending: true, source: 'SECRET_EVENT_SOURCE' },
  };
  const correctionIsland = boot.room.islands[0];
  correctionIsland.ownerId = boot.a.playerId;
  correctionIsland.buildings = [
    { type: 'fort', level: 1 },
    { type: 'fort', level: 1 },
  ]; // Deliberately illegal settlement branch count so emitRoom keeps/refreshes this real pending family.
  const targetFamilies = {
    pendingEvent: 'event',
    pendingFeud: 'feud',
    pendingAssignmentChoice: 'assignment-choice',
    pendingLegendaryReaction: 'legendary-reaction',
  };
  for (const family of families) {
    const fixture = pendingFixture(family, boot.a.playerId, boot.b.playerId, correctionIsland.id);
    const targetFamily = targetFamilies[family];
    if (targetFamily) setPendingResolution(boot.room, targetFamily, pendingResolutionFromLegacy(targetFamily, fixture));
    else boot.room[family] = fixture;
  }
  boot.room.pendingBattle = { id: 'public-battle', kind: 'sea', attackerId: boot.b.playerId, targetPlayerId: boot.c.playerId, islandId: null, invites: [] };
  boot.room.pendingAlliance = null;
  boot.room.log.push({ t: 1, text: 'SECRET_JOURNAL_ENTRY' });
  h.writeDatabase(boot.db);
  await h.start();

  const a = await resumeWithState(h, boot.code, boot.a);
  const b = await resumeWithState(h, boot.code, boot.b);
  const c = await resumeWithState(h, boot.code, boot.c);
  for (const family of families) {
    assert.equal(has(a.state, family), true, `actor missing ${family}`);
    assert.equal(a.state[family].viewerCanRespond, true, `${family} actor cannot respond`);
    assert.equal(has(b.state, family), false, `non-actor received ${family}`);
    assert.equal(has(c.state, family), false, `non-actor received ${family}`);
  }
  assert.deepEqual(b.state.pendingDecision, { waiting: true, actorPlayerId: boot.a.playerId });
  assert.deepEqual(Object.keys(b.state.pendingDecision).sort(), ['actorPlayerId', 'waiting']);
  for (const forbidden of ['kind', 'source', 'card', 'faction', 'island', 'options', 'target', 'mechanic']) assert.equal(has(b.state.pendingDecision, forbidden), false);
  assert.equal(b.state.eventPhase.active, true);
  assert.equal(b.state.eventPhase.personalTurn, true);
  assert.equal(b.state.eventPhase.currentPlayerId, boot.a.playerId);
  assert.deepEqual(Object.keys(b.state.eventPhase).sort(), ['active', 'currentPlayerId', 'personalTurn']);
  assert.equal(a.state.eventPhase.lastCard.cardName, 'SECRET_EVENT_CARD');
  assert.equal(has(b.state.eventPhase, 'lastCard'), false);
  assert.equal(has(c.state.eventPhase, 'lastCard'), false);
  assert.equal(has(b.state, 'pendingBattle'), true, 'approved public battle must remain visible');
  assert.equal(JSON.stringify(a.state).includes('SECRET_PENDING_UNKNOWN'), false);
  assert.equal(JSON.stringify(a.state).includes('SECRET_PENDING_OPTION_UNKNOWN'), false);
  assertNoRootSideChannels(a.state);
  assertNoRootSideChannels(b.state);
  assertSecretStringsAbsent(b.state, ['SECRET_PENDING_CARD', 'SECRET_PENDING_OPTION', 'SECRET_PENDING_KIND', 'SECRET_PENDING_SOURCE', 'SECRET_EVENT_CARD', 'SECRET_EVENT_STAGE', 'SECRET_EVENT_SOURCE', 'SECRET_JOURNAL_ENTRY']);
  assertSecretStringsAbsent(c.state, ['SECRET_PENDING_CARD','SECRET_PENDING_OPTION', 'SECRET_PENDING_KIND', 'SECRET_PENDING_SOURCE', 'SECRET_EVENT_CARD', 'SECRET_EVENT_STAGE', 'SECRET_EVENT_SOURCE', 'SECRET_JOURNAL_ENTRY']);
});

test('4.7 pure public observer receives approved public state and no private/unknown fields or Scout grant', () => {
  const room = {
    version: '0.33.0', code: 'ABCDE', started: true, hostId: 'p1', round: 2, circle: 1, turnIndex: 0, activePlayerId: 'p1', seatingOrder: ['p1', 'p2'], order: ['p1', 'p2'],
    log: [{ text: 'SECRET_LOG' }], eventDecks: { sailing: { remaining: 9 } }, feudDecks: { mori: { remaining: 8 } }, assignmentDecks: { mori: { remaining: 7 } }, scoutRevealGrants: [{ viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', arbitrary: 'SECRET_SCOUT_RAW' }],
    players: [{
      id: 'p1', name: 'Alice', color: 'red', shipClass: 'frigate', level: 3, row: 5, col: 7, connected: true, ready: true,
      glory: 9, fleetPoints: 8, armyPoints: 7, islandCount: 1, suzerainId: 'mori', allyIds: ['p2'],
      stats: { artillery: 4, army: 3, cargo: 5, moveMod: 1, unknown: 'SECRET_STATS_UNKNOWN' }, cargo: { goodId: 'wood', name: 'Wood', quantity: 1, value: 2 }, upgrades: [], escorts: [],
      legendaryStatus: { shipVeilTurns: 1, seaCurseTurns: [], seaCursePenalty: 0 }, activeTurnEffects: { moveBonus: 1 }, landCompany: { army: 3, arsenalLevel: 1, sourceIslandId: 'i1', formedAt: 1 },
      visitedAnchors: ['a'], lastAnchorEncounter: { outcome: 'win', reward: { gross: 9, debtRemaining: 3 } }, expeditionHistory: [{ id: 'done', name: 'Done', completedRound: 1 }],
      ducats: 101, debt: 11, character: { id: 'scout', name: 'SECRET_CHARACTER', effect: { type: 'secret', unknown: 'SECRET_CHARACTER_EFFECT_UNKNOWN' } },
      activeAssignment: { instanceId: 'SECRET_ASSIGNMENT_ID', text: 'SECRET_ASSIGNMENT_TEXT', reward: 20, progress: { kind: 'visit', unknown: 'SECRET_PROGRESS_UNKNOWN' } }, hasActiveAssignment: true,
      specialCards: ['SECRET_SPECIAL'], specialCardCount: 1, legendaryCards: [{ id: 'x', name: 'SECRET_LEGENDARY' }], legendaryCardCount: 1, playableLegendaryCards: [{ id: 'x', name: 'SECRET_LEGENDARY' }], savedEventCards: [{ id: 's', name: 'SECRET_SAVED' }], savedEventCardCount: 1,
      activeExpedition: { cardId: 'x', name: 'SECRET_EXPEDITION' }, hasActiveExpedition: true, nextTurnEffects: { noIncome: true }, unknownPlayerField: 'SECRET_UNKNOWN_PLAYER',
    }],
    islands: [{ id: 'i1', name: 'Island', kind: 'island', faction: 'mori', area: 8, army: 1, resources: ['wood'], cells: [[5, 7]], ownerId: 'p1', buildings: [{ index: 0, type: 'fort', level: 2, name: 'Fort II', supported: null, unknown: 'SECRET_BUILDING_UNKNOWN' }], usedArea: 1, effectiveArea: 8, status: 'Город', constraints: { legal: true, status: 'Город', usedArea: 1, effectiveArea: 8, overArea: 0, branchLimit: 2, branchViolations: [] }, garrisonType: 'guard', garrisonName: 'SECRET_GARRISON', garrisonDefense: 1, defenseArmy: 6, defenseBreakdown: { total: 6 }, unknownIslandField: 'SECRET_UNKNOWN_ISLAND' }],
    pendingEvent: { id: 'pending', playerId: 'p1', kind: 'SECRET_PENDING_KIND', cardName: 'SECRET_PENDING_CARD', options: [{ id: 'x', name: 'SECRET_PENDING_OPTION' }], unknown: 'SECRET_PENDING_UNKNOWN' },
  };
  const out = projectOpponentFacingRoomView(room, null);
  assertNoRootSideChannels(out);
  assertOpponentPrivateAbsent(out, 'p1');
  assertPrivateGarrisonAbsent(out, 'i1');
  assertPublicPlayerState(out, 'p1');
  assertPublicIslandState(out, 'i1');
  assert.deepEqual(out.pendingDecision, { waiting: true, actorPlayerId: 'p1' });
  assertSecretStringsAbsent(out, ['SECRET_LOG', 'SECRET_SCOUT_RAW', 'SECRET_CHARACTER', 'SECRET_ASSIGNMENT_TEXT', 'SECRET_SPECIAL', 'SECRET_LEGENDARY', 'SECRET_SAVED', 'SECRET_EXPEDITION', 'SECRET_GARRISON', 'SECRET_PENDING_CARD', 'SECRET_PENDING_OPTION', 'SECRET_UNKNOWN_PLAYER', 'SECRET_UNKNOWN_ISLAND', 'SECRET_BUILDING_UNKNOWN']);
});
