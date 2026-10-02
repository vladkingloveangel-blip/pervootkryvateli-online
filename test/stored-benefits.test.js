'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { io } = require('socket.io-client');
const {
  StoredBenefit,
  storedBenefitFromLegacy,
  storedBenefitToLegacy,
  listStoredBenefits,
  peekStoredBenefit,
  storeBenefit,
  consumeStoredBenefit,
  discardStoredBenefit,
} = require('../domain-state');
const {
  discardRandomHeldCard,
  assignmentRequiredAction,
  canInstallShipUpgradeFree,
} = require('../game-logic');
const {
  sailingEventSource,
  releaseStoredBenefitReservation,
} = require('../sailing-event-source');
const {
  CITADEL_CELLS,
  SHIP_UPGRADES,
  GOODS,
  ASSIGNMENT_CARDS,
} = require('../game-data');
const rules = require('../rules');

function legacyBenefit(overrides = {}) {
  return {
    id: 'saved-1',
    kind: 'found-cargo',
    name: 'Held benefit',
    sourceDeck: 'event',
    sourceCard: {
      id: 'event-definition',
      masterCardId: 'event-definition',
      copy: 2,
      name: 'Source occurrence',
      nested: { keep: true },
    },
    goodId: Object.keys(GOODS)[0],
    legacyExtra: { untouched: true },
    ...overrides,
  };
}

test('legacy saved event maps to detached StoredBenefit and pure round-trip preserves exact legacy JSON', () => {
  const legacy = legacyBenefit({
    assignmentInstanceId: 'assignment-7',
    unknownArray: [{ value: 1 }],
  });
  const player = { id: 'p1', savedEventCards: [structuredClone(legacy)] };
  const before = JSON.stringify(player);
  const benefit = listStoredBenefits(player)[0];

  assert.equal(StoredBenefit.is(benefit), true);
  assert.equal(benefit.id, legacy.id);
  assert.equal(benefit.kind, legacy.kind);
  assert.equal(benefit.ownerId, 'p1');
  assert.equal(benefit.state, 'stored');
  assert.deepEqual(benefit.source, {
    deck: 'event',
    occurrence: legacy.sourceCard,
  });
  assert.deepEqual(benefit.payload, {
    name: legacy.name,
    goodId: legacy.goodId,
    assignmentInstanceId: 'assignment-7',
  });
  assert.deepEqual(storedBenefitToLegacy(benefit), legacy);

  benefit.source.occurrence.copy = 99;
  benefit.source.occurrence.nested.keep = false;
  benefit.payload.goodId = 'changed';
  assert.equal(JSON.stringify(player), before);
  assert.deepEqual(player.savedEventCards[0].sourceCard, legacy.sourceCard);
  assert.equal(Object.getOwnPropertySymbols(benefit).every(symbol => Object.getOwnPropertyDescriptor(benefit, symbol).enumerable === false), true);
});

test('StoredBenefit list preserves absent/null/empty semantics, duplicates, unknown kinds and explicit id identity', () => {
  assert.equal(listStoredBenefits({ id: 'p1' }), undefined);
  assert.equal(listStoredBenefits({ id: 'p1', savedEventCards: null }), null);
  assert.deepEqual(listStoredBenefits({ id: 'p1', savedEventCards: [] }), []);

  const player = {
    id: 'p1',
    savedEventCards: [
      legacyBenefit({ id: 'a', kind: 'legacy-unknown', name: 'Same', sourceCard: { id: 'same', copy: 1 } }),
      legacyBenefit({ id: 'b', kind: 'legacy-unknown', name: 'Same', sourceCard: { id: 'same', copy: 2 } }),
    ],
  };
  assert.equal(listStoredBenefits(player).length, 2);
  assert.equal(peekStoredBenefit(player, 'b').source.occurrence.copy, 2);
  assert.equal(peekStoredBenefit(player, 'missing'), null);
  const beforeFailed = structuredClone(player);
  assert.equal(consumeStoredBenefit(player, 'missing'), null);
  assert.deepEqual(player, beforeFailed);

  const removed = consumeStoredBenefit(player, 'a');
  assert.equal(removed.id, 'a');
  assert.equal(removed.source.occurrence.copy, 1);
  assert.deepEqual(player.savedEventCards.map(card => [card.id, card.sourceCard.copy]), [['b', 2]]);
});

test('storeBenefit appends only legacy savedEventCards and never generates an id or parallel inventory', () => {
  const player = { id: 'p1' };
  const legacy = legacyBenefit({ id: 'explicit-id', kind: 'ship-master', goodId: undefined });
  const benefit = storedBenefitFromLegacy(player, legacy);
  const stored = storeBenefit(player, benefit);

  assert.equal(stored.id, 'explicit-id');
  assert.deepEqual(player.savedEventCards, [legacy]);
  for (const key of ['benefits', 'storedBenefits', 'inventory', 'reservedBenefits']) {
    assert.equal(Object.hasOwn(player, key), false, key);
  }

  const noId = StoredBenefit.view({
    kind: 'legacy-kind',
    ownerId: 'p1',
    state: 'stored',
    source: { deck: 'event', occurrence: { id: 'source', copy: 1 } },
    payload: { name: 'No id' },
  });
  storeBenefit(player, noId);
  assert.equal(Object.hasOwn(player.savedEventCards[1], 'id'), false);
});

test('found-cargo/save kinds and legacy treasure assignment linkage preserve exact source occurrence identity', () => {
  const player = {
    id: 'p1',
    savedEventCards: [
      legacyBenefit({ id: 'cargo', kind: 'found-cargo', goodId: 'wood' }),
      legacyBenefit({ id: 'ship', kind: 'ship-master', goodId: undefined }),
      legacyBenefit({ id: 'treasure', kind: 'treasure-cargo', assignmentInstanceId: 'legacy-assignment', sourceCard: { id: 'treasure-event', masterCardId: 'treasure-event', copy: 4, extraOccurrence: true } }),
    ],
  };
  const benefits = listStoredBenefits(player);
  assert.equal(benefits[0].payload.goodId, 'wood');
  assert.equal(benefits[1].kind, 'ship-master');
  assert.equal(benefits[2].payload.assignmentInstanceId, 'legacy-assignment');
  assert.deepEqual(benefits[2].source.occurrence, {
    id: 'treasure-event',
    masterCardId: 'treasure-event',
    copy: 4,
    extraOccurrence: true,
  });
  assert.deepEqual(storedBenefitToLegacy(benefits[2]), player.savedEventCards[2]);
});

test('reservation helper releases only persisted event occurrence and does nothing on read/peek', () => {
  const occurrence = { id: 'source-event', masterCardId: 'source-event', copy: 3, unknown: 'keep' };
  const player = { id: 'p1', savedEventCards: [legacyBenefit({ id: 'held', sourceCard: occurrence })] };
  const room = { eventDeck: { drawPile: [], discard: [] } };

  const listed = listStoredBenefits(player);
  const peeked = peekStoredBenefit(player, 'held');
  assert.equal(room.eventDeck.discard.length, 0);
  assert.equal(listed[0].source.occurrence.copy, 3);
  assert.equal(peeked.source.occurrence.copy, 3);

  const consumed = consumeStoredBenefit(player, 'held');
  assert.equal(room.eventDeck.discard.length, 0);
  assert.equal(releaseStoredBenefitReservation(room, consumed), true);
  assert.deepEqual(room.eventDeck.discard, [occurrence]);
});

test('random held discard preserves special -> legendary -> stored benefit order, count and RNG calls, releasing selected stored source once', () => {
  function setup() {
    return {
      room: { eventDeck: { drawPile: [], discard: [] } },
      player: {
        id: 'p1',
        specialCards: ['Покров моря'],
        legendaryCards: [{ id: 'hellfire', name: 'Пламя Ада' }],
        savedEventCards: [
          legacyBenefit({ id: 'saved-a', name: 'Saved A', sourceCard: { id: 'event-a', copy: 1 } }),
          legacyBenefit({ id: 'saved-b', name: 'Saved B', sourceCard: { id: 'event-b', copy: 2 } }),
        ],
        activeAssignment: { instanceId: 'assignment-1' },
        activeExpedition: { cardId: 'expedition-1' },
      },
    };
  }
  const expected = [
    ['special', 0, 'Покров моря'],
    ['legendary', 0, 'Пламя Ада'],
    ['saved-event', 0, 'Saved A'],
    ['saved-event', 1, 'Saved B'],
  ];
  expected.forEach(([sourceName, index, name], candidateIndex) => {
    const { room, player } = setup();
    let calls = 0;
    const result = discardRandomHeldCard(room, player, () => {
      calls += 1;
      return (candidateIndex + 0.1) / expected.length;
    });
    assert.equal(calls, 1);
    assert.equal(result.discarded.source, sourceName);
    assert.equal(result.discarded.index, index);
    assert.equal(result.discarded.name, name);
    assert.equal(player.activeAssignment.instanceId, 'assignment-1');
    assert.equal(player.activeExpedition.cardId, 'expedition-1');
    if (sourceName === 'saved-event') {
      assert.equal(player.savedEventCards.length, 1);
      assert.equal(room.eventDeck.discard.length, 1);
      assert.equal(room.eventDeck.discard[0].copy, index === 0 ? 1 : 2);
    } else {
      assert.equal(player.savedEventCards.length, 2);
      assert.equal(room.eventDeck.discard.length, 0);
    }
  });

  const empty = { id: 'p2', specialCards: [], legendaryCards: [], savedEventCards: [] };
  let calls = 0;
  assert.deepEqual(discardRandomHeldCard({ eventDeck: { drawPile: [], discard: [] } }, empty, () => { calls += 1; return 0; }), { ok: true, discarded: null });
  assert.equal(calls, 0);
});

test('assignment saved-benefit reads preserve ship-master and treasure linkage semantics', () => {
  const [row, col] = CITADEL_CELLS[0];
  const player = {
    id: 'p1',
    row,
    col,
    shipClass: 'brigantine',
    level: 3,
    ducats: 100,
    upgrades: [],
    escorts: [],
    cargo: null,
    savedEventCards: [legacyBenefit({ id: 'ship-benefit', kind: 'ship-master' })],
    activeAssignment: {
      instanceId: 'assignment-instance',
      factionId: 'mori',
      card: {
        id: 'stat-card',
        type: 'stat-upgrade',
        branch: 'artillery',
        text: 'Upgrade',
        reward: 10,
      },
      issuedRound: 2,
    },
  };
  const room = { round: 2, islands: [], players: [player] };
  const requirement = assignmentRequiredAction(room, player, 1);
  assert.equal(requirement.kind, 'ship-upgrade');
  assert.deepEqual(requirement.shipMasterIds, ['ship-benefit']);

  const treasurePlayer = {
    ...player,
    savedEventCards: [legacyBenefit({
      id: 'treasure-benefit',
      kind: 'treasure-cargo',
      assignmentInstanceId: 'assignment-instance',
    })],
    activeAssignment: {
      instanceId: 'assignment-instance',
      factionId: 'mori',
      card: { id: 'treasure-card', type: 'treasure-resolved', text: 'Treasure', reward: 10 },
      issuedRound: 2,
    },
  };
  const treasureRoom = { round: 2, islands: [], players: [treasurePlayer] };
  assert.deepEqual(assignmentRequiredAction(treasureRoom, treasurePlayer, 1).savedCardIds, ['treasure-benefit']);
});

test('JSON restart preserves held occurrence/order without release until explicit consume', () => {
  const player = {
    id: 'p1',
    savedEventCards: [
      legacyBenefit({ id: 'one', sourceCard: { id: 'event', masterCardId: 'event', copy: 1 } }),
      legacyBenefit({ id: 'two', sourceCard: { id: 'event', masterCardId: 'event', copy: 2 } }),
    ],
  };
  const restored = JSON.parse(JSON.stringify(player));
  assert.deepEqual(restored.savedEventCards.map(card => [card.id, card.sourceCard.copy]), [['one', 1], ['two', 2]]);
  const room = { eventDeck: { drawPile: [], discard: [] } };
  assert.equal(room.eventDeck.discard.length, 0);
  const consumed = discardStoredBenefit(restored, 'two');
  releaseStoredBenefitReservation(room, consumed);
  assert.deepEqual(restored.savedEventCards.map(card => card.id), ['one']);
  assert.deepEqual(room.eventDeck.discard, [{ id: 'event', masterCardId: 'event', copy: 2 }]);
});

test('socket use handlers keep failed uses atomic, release successful reservations once, preserve private presentation and survive restart mid-hold', { timeout: 50000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pervo-stored-benefits-'));
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
        AUTH_SECRET: 'stored-benefits-test-secret',
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
  for (let i = 0; i < 4; i++) accounts.push(await api('/api/auth/register', { username: `stored55p${i + 1}`, password: 'password1' }));
  const initial = await Promise.all(Array.from({ length: 4 }, () => connect()));
  const created = await emit(initial[0], 'createRoom', { accountToken: accounts[0].token, name: 'One' });
  const ids = [created.playerId];
  for (let i = 1; i < 4; i++) ids.push((await emit(initial[i], 'joinRoom', { code: created.code, accountToken: accounts[i].token, name: `Player ${i + 1}` })).playerId);
  for (let i = 0; i < 4; i++) await emit(initial[i], 'changeShip', { shipClass: 'brigantine' });
  for (let i = 0; i < 4; i++) await emit(initial[i], 'setReady', { ready: true });
  assert.equal((await emit(initial[0], 'startGame')).ok, true);
  await stop();
  initial.forEach(socket => socket.disconnect());

  let db = readDb();
  let room = db.game_rooms[0].state;
  const activeId = room.order[0];
  const otherId = room.order[1];
  const active = room.players.find(player => player.id === activeId);
  const activeAccount = accounts[ids.indexOf(activeId)];
  const otherAccount = accounts[ids.indexOf(otherId)];
  room.round = 2;
  room.circle = 1;
  room.turnIndex = 0;
  room.completedTurns = room.order.length * 6;
  room.phase = 'actions';
  room.actionsLeft = 6;
  room.eventPhase = null;
  room.pendingEvent = null;
  room.pendingFeud = null;
  room.pendingAssignmentChoice = null;
  room.pendingIslandCorrection = null;
  room.pendingFleetAdjustment = null;
  room.pendingLegendaryReaction = null;
  room.pendingBattle = null;
  room.pendingAlliance = null;
  active.activeAssignmentTask = null; delete active.activeAssignment;
  active.cargo = null;
  active.escorts = [];
  active.level = 3;
  active.upgrades = [];
  [active.row, active.col] = CITADEL_CELLS[0];
  const goodId = Object.keys(GOODS)[0];
  const sourceCargo = { id: 'source-cargo', masterCardId: 'source-cargo', copy: 1, marker: 'cargo' };
  const sourceShip = { id: 'source-ship', masterCardId: 'source-ship', copy: 2, marker: 'ship' };
  const sourceBlueprint = { id: 'source-blueprint', masterCardId: 'source-blueprint', copy: 3, marker: 'blueprint' };
  active.storedBenefits = [
    {
      instanceId: 'benefit-cargo',
      id: 'cargo-benefit',
      kind: 'treasure-cargo',
      source: { deck: 'event', occurrence: sourceCargo },
      payload: { name: 'Treasure cargo', assignmentInstanceId: 'legacy-treasure-link', goodId },
    },
    {
      instanceId: 'benefit-ship',
      id: 'ship-benefit',
      kind: 'ship-master',
      source: { deck: 'event', occurrence: sourceShip },
      payload: { name: 'Ship master' },
    },
    {
      instanceId: 'benefit-blueprint',
      id: 'blueprint-benefit',
      kind: 'farm-blueprint',
      source: { deck: 'event', occurrence: sourceBlueprint },
      payload: { name: 'Farm blueprint' },
    },
  ];
  delete active.savedEventCards;
  room.randomSourceState.sailingEvent = {
    available: [{ id: 'unrelated', copy: 1 }],
    recyclable: [],
    reserved: [structuredClone(sourceCargo), structuredClone(sourceShip), structuredClone(sourceBlueprint)],
  };
  const upgradeId = Object.keys(SHIP_UPGRADES).find(id => canInstallShipUpgradeFree(active, id).ok);
  assert.ok(upgradeId, 'Expected at least one free install candidate');
  writeDb(db);

  await start();
  let activeSocket = await connect();
  let otherSocket = await connect();
  assert.equal((await emit(activeSocket, 'resumeRoom', { code: created.code, accountToken: activeAccount.token })).ok, true);
  assert.equal((await emit(otherSocket, 'resumeRoom', { code: created.code, accountToken: otherAccount.token })).ok, true);

  let before = readDb().game_rooms[0].state;
  const cargoBeforeActions = before.actionsLeft;
  const cargoBeforeLog = before.log.length;
  const cargoFail = await emit(activeSocket, 'useSavedCargo', { savedCardId: 'cargo-benefit', holdId: 'missing-hold' });
  assert.equal(cargoFail.ok, false);
  await new Promise(resolve => setTimeout(resolve, 25));
  let persisted = readDb().game_rooms[0].state;
  let persistedActive = persisted.players.find(player => player.id === activeId);
  assert.equal(persisted.actionsLeft, cargoBeforeActions);
  assert.equal(persisted.log.length, cargoBeforeLog);
  assert.equal(persistedActive.storedBenefits.some(benefit => benefit.id === 'cargo-benefit'), true);
  assert.equal(persisted.randomSourceState.sailingEvent.recyclable.length, 0);

  let changed = await change(activeSocket, 'useSavedCargo', { savedCardId: 'cargo-benefit', holdId: 'main' });
  assert.equal(changed.result.result.ok, true);
  persisted = readDb().game_rooms[0].state;
  persistedActive = persisted.players.find(player => player.id === activeId);
  assert.equal(persisted.actionsLeft, cargoBeforeActions - 1);
  assert.equal(persistedActive.storedBenefits.some(benefit => benefit.id === 'cargo-benefit'), false);
  assert.equal(persisted.randomSourceState.sailingEvent.recyclable.filter(card => card.marker === 'cargo').length, 1);
  assert.deepEqual(persisted.randomSourceState.sailingEvent.recyclable.find(card => card.marker === 'cargo'), sourceCargo);

  before = persisted;
  const shipBeforeActions = before.actionsLeft;
  const shipBeforeLog = before.log.length;
  const shipFail = await emit(activeSocket, 'useShipMaster', { savedCardId: 'ship-benefit', upgradeId: 'missing-upgrade' });
  assert.equal(shipFail.ok, false);
  await new Promise(resolve => setTimeout(resolve, 25));
  persisted = readDb().game_rooms[0].state;
  persistedActive = persisted.players.find(player => player.id === activeId);
  assert.equal(persisted.actionsLeft, shipBeforeActions);
  assert.equal(persisted.log.length, shipBeforeLog);
  assert.equal(persistedActive.storedBenefits.some(benefit => benefit.id === 'ship-benefit'), true);
  assert.equal(persisted.randomSourceState.sailingEvent.recyclable.filter(card => card.marker === 'ship').length, 0);

  changed = await change(activeSocket, 'useShipMaster', { savedCardId: 'ship-benefit', upgradeId });
  assert.equal(changed.result.result.ok, true);
  persisted = readDb().game_rooms[0].state;
  persistedActive = persisted.players.find(player => player.id === activeId);
  assert.equal(persisted.actionsLeft, shipBeforeActions - 1);
  assert.equal(persistedActive.storedBenefits.some(benefit => benefit.id === 'ship-benefit'), false);
  assert.equal(persisted.randomSourceState.sailingEvent.recyclable.filter(card => card.marker === 'ship').length, 1);
  assert.deepEqual(persisted.randomSourceState.sailingEvent.recyclable.find(card => card.marker === 'ship'), sourceShip);

  await stop();
  activeSocket.disconnect();
  otherSocket.disconnect();

  db = readDb();
  room = db.game_rooms[0].state;
  const resumedActive = room.players.find(player => player.id === activeId);
  const bogamia = room.islands.find(island => island.id === 'bogamia') || room.islands[0];
  bogamia.ownerId = activeId;
  bogamia.buildings = [];
  [resumedActive.row, resumedActive.col] = bogamia.cells[0];
  room.turnIndex = room.order.indexOf(activeId);
  room.phase = 'actions';
  room.actionsLeft = 4;
  room.pendingEvent = null;
  room.pendingFeud = null;
  room.pendingAssignmentChoice = null;
  room.pendingIslandCorrection = null;
  room.pendingFleetAdjustment = null;
  room.pendingLegendaryReaction = null;
  room.pendingBattle = null;
  room.pendingAlliance = null;
  assert.equal(resumedActive.storedBenefits.some(benefit => benefit.id === 'blueprint-benefit'), true);
  assert.equal(room.randomSourceState.sailingEvent.recyclable.filter(card => card.marker === 'blueprint').length, 0);
  writeDb(db);

  await start();
  activeSocket = await connect();
  otherSocket = await connect();
  const activeStatePromise = once(activeSocket, 'roomState');
  assert.equal((await emit(activeSocket, 'resumeRoom', { code: created.code, accountToken: activeAccount.token })).ok, true);
  const activeState = (await activeStatePromise)[0];
  const otherStatePromise = once(otherSocket, 'roomState');
  assert.equal((await emit(otherSocket, 'resumeRoom', { code: created.code, accountToken: otherAccount.token })).ok, true);
  const otherState = (await otherStatePromise)[0];
  const ownerView = activeState.players.find(player => player.id === activeId);
  const opponentView = otherState.players.find(player => player.id === activeId);
  assert.deepEqual(ownerView.savedEventCards, [{ id: 'blueprint-benefit', kind: 'farm-blueprint', name: 'Farm blueprint', goodId: null }]);
  assert.equal(ownerView.savedEventCardCount, 1);
  assert.equal(Object.hasOwn(ownerView.savedEventCards[0], 'sourceCard'), false);
  assert.equal(Object.hasOwn(ownerView.savedEventCards[0], 'sourceDeck'), false);
  assert.equal(Object.hasOwn(ownerView.savedEventCards[0], 'assignmentInstanceId'), false);
  assert.equal(Object.hasOwn(opponentView, 'savedEventCards'), false);
  assert.equal(Object.hasOwn(opponentView, 'savedEventCardCount'), false);
  persisted = readDb().game_rooms[0].state;
  assert.equal(persisted.randomSourceState.sailingEvent.recyclable.filter(card => card.marker === 'blueprint').length, 0);

  before = persisted;
  const blueprintBeforeActions = before.actionsLeft;
  const blueprintBeforeLog = before.log.length;
  const blueprintFail = await emit(activeSocket, 'useBlueprint', { savedCardId: 'blueprint-benefit', islandId: 'missing-island' });
  assert.equal(blueprintFail.ok, false);
  await new Promise(resolve => setTimeout(resolve, 25));
  persisted = readDb().game_rooms[0].state;
  persistedActive = persisted.players.find(player => player.id === activeId);
  assert.equal(persisted.actionsLeft, blueprintBeforeActions);
  assert.equal(persisted.log.length, blueprintBeforeLog);
  assert.equal(persistedActive.storedBenefits.some(benefit => benefit.id === 'blueprint-benefit'), true);
  assert.equal(persisted.randomSourceState.sailingEvent.recyclable.filter(card => card.marker === 'blueprint').length, 0);

  changed = await change(activeSocket, 'useBlueprint', { savedCardId: 'blueprint-benefit', islandId: bogamia.id });
  assert.equal(changed.result.result.ok, true);
  persisted = readDb().game_rooms[0].state;
  persistedActive = persisted.players.find(player => player.id === activeId);
  assert.equal(persisted.actionsLeft, blueprintBeforeActions - 1);
  assert.equal(persistedActive.storedBenefits.some(benefit => benefit.id === 'blueprint-benefit'), false);
  assert.equal(persisted.randomSourceState.sailingEvent.recyclable.filter(card => card.marker === 'blueprint').length, 1);
  assert.deepEqual(persisted.randomSourceState.sailingEvent.recyclable.find(card => card.marker === 'blueprint'), sourceBlueprint);
  assert.equal(persisted.randomSourceState.sailingEvent.recyclable.filter(card => ['cargo', 'ship', 'blueprint'].includes(card.marker)).length, 3);
});
