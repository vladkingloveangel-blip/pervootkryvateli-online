const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { Server } = require('socket.io');
const { io: clientIo } = require('socket.io-client');

const {
  islandManhattanDistance,
  playerManhattanDistance,
  applyScoutUse,
  activeScoutRevealGrants,
  normalizeScoutRevealGrants,
  scoutViewerContext,
  clearScoutRevealGrants,
} = require('../scout-runtime');
const {
  projectOpponentFacingRoomView,
  SCOUT_RUNTIME_ENABLED,
} = require('../state-projection');

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const scoutRule = { id: 'scout', useActionCost: 1, effect: { range: 4 } };

function player(id, row, col) {
  return {
    id,
    name: id,
    row,
    col,
    connected: true,
    ready: true,
    personalTurnNo: id === 'p1' ? 7 : 3,
    ducats: id === 'p2' ? 'SECRET_SCOUT_DUCATS' : id === 'p3' ? 'SECRET_SECOND_DUCATS' : 10,
    debt: id === 'p2' ? 'SECRET_SCOUT_DEBT' : 0,
    character: id === 'p1' ? { id: 'scout', name: 'Scout' } : { id: 'navigator', name: 'SECRET_OTHER_CHARACTER' },
    activeAssignment: id === 'p2' ? { instanceId: 'SECRET_ASSIGNMENT', text: 'SECRET_ASSIGNMENT' } : null,
    hasActiveAssignment: id === 'p2',
    specialCards: id === 'p2' ? ['SECRET_SPECIAL'] : [],
    specialCardCount: id === 'p2' ? 1 : 0,
    legendaryCards: id === 'p2' ? [{ id: 'secret', name: 'SECRET_LEGENDARY', handIndex: 0 }] : [],
    legendaryCardCount: id === 'p2' ? 1 : 0,
    savedEventCards: id === 'p2' ? [{ id: 'secret', kind: 'cargo', name: 'SECRET_SAVED' }] : [],
    savedEventCardCount: id === 'p2' ? 1 : 0,
    activeExpedition: id === 'p2' ? { cardId: 'secret', name: 'SECRET_EXPEDITION', placeId: 'secret' } : null,
    hasActiveExpedition: id === 'p2',
    nextTurnEffects: id === 'p2' ? { noIncome: true } : {},
    phase: id === 'p1' ? 'actions' : 'waiting',
    actionsLeft: id === 'p1' ? 2 : null,
  };
}

function island(id, ownerId, cells, sentinel = 'SECRET_SCOUT_GARRISON') {
  return {
    id,
    name: id,
    ownerId,
    cells,
    resources: [],
    buildings: [],
    area: 4,
    army: 1,
    usedArea: 0,
    effectiveArea: 4,
    status: 'Поселение',
    garrisonType: sentinel,
    garrisonName: sentinel,
    garrisonDefense: 4,
    defenseArmy: 9,
    defenseBreakdown: { total: 9, garrison: 1, hiredGarrison: 4, fortifications: 4, bastions: 0, ownerShip: 0, ownerShipPresent: false },
  };
}

function room() {
  return {
    version: '0.33.0',
    code: 'SCOUT',
    started: true,
    round: 2,
    order: ['p1', 'p2', 'p3'],
    turnIndex: 0,
    activePlayerId: 'p1',
    phase: 'actions',
    actionsLeft: 2,
    players: [player('p1', 10, 10), player('p2', 10, 14), player('p3', 14, 10)],
    islands: [
      island('i1', 'p2', [[20, 20], [10, 14]]),
      island('i2', 'p3', [[14, 10]], 'SECRET_SECOND_GARRISON'),
    ],
    scoutRevealGrants: [],
    eventDecks: { sailing: { remaining: 9, discard: 1 }, expeditions: { remaining: 7 } },
    feudDecks: { mori: { remaining: 8, discard: 2 } },
    assignmentDecks: { mori: { remaining: 6, discard: 3, removed: 1 } },
  };
}

function consumeCharacter(p, expectedId, round) {
  const id = typeof p.character === 'string' ? p.character : p.character?.id;
  if (id !== expectedId) return { ok: false, error: 'wrong character' };
  if (Number(p.characterUsedRound) === Number(round)) return { ok: false, error: 'already used' };
  p.characterUsedRound = Number(round);
  return { ok: true };
}

function use(r, request, options = {}) {
  return applyScoutUse({
    room: r,
    playerId: options.playerId || 'p1',
    request,
    characterRule: scoutRule,
    hasBlockingPending: Boolean(options.pending),
    consumeCharacter: (player, expectedId) => consumeCharacter(player, expectedId, r.round),
  });
}

function privateKeysAbsent(view) {
  for (const key of ['debt','character','activeAssignment','hasActiveAssignment','specialCards','specialCardCount','legendaryCards','legendaryCardCount','savedEventCards','savedEventCardCount','activeExpedition','hasActiveExpedition','nextTurnEffects']) {
    assert.equal(has(view, key), false, key);
  }
}

test('Scout Manhattan range accepts 0-4, rejects 5, and multi-cell islands use the nearest cell', () => {
  const p = player('p1', 10, 10);
  for (let distance = 0; distance <= 4; distance++) {
    const r = room();
    r.islands[0].cells = [[99, 99], [10, 10 + distance]];
    assert.equal(islandManhattanDistance(p, r.islands[0]), distance);
    const result = use(r, { mode: 'garrison', islandId: 'i1' });
    assert.equal(result.ok, true, 'distance ' + distance);
    assert.equal(result.actionCost, 1);
    assert.equal(r.actionsLeft, 1);
    assert.equal(r.players[0].character.id, 'scout');
    assert.equal(r.players[0].characterUsedRound, r.round);
    assert.deepEqual(r.scoutRevealGrants, [{ viewerPlayerId: 'p1', mode: 'garrison', islandId: 'i1', personalTurnNo: 7 }]);
  }

  const r = room();
  r.islands[0].cells = [[99, 99], [10, 15]];
  const before = structuredClone(r);
  assert.equal(islandManhattanDistance(r.players[0], r.islands[0]), 5);
  assert.equal(use(r, { mode: 'garrison', islandId: 'i1' }).ok, false);
  assert.equal(r.actionsLeft, before.actionsLeft);
  assert.deepEqual(r.players[0].character, before.players[0].character);
  assert.deepEqual(r.scoutRevealGrants, []);
});

test('Scout money target accepts another player at distance <=4 and rejects distance 5/self/invalid/nonexistent', () => {
  let r = room();
  assert.equal(playerManhattanDistance(r.players[0], r.players[1]), 4);
  assert.equal(use(r, { mode: 'money', targetPlayerId: 'p2' }).ok, true);
  assert.deepEqual(r.scoutRevealGrants, [{ viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: 7 }]);

  for (const request of [
    { mode: 'money', targetPlayerId: 'p1' },
    { mode: 'bogus', targetPlayerId: 'p2' },
    { mode: 'money', targetPlayerId: 'missing' },
    { mode: 'garrison', islandId: 'missing' },
  ]) {
    r = room();
    const before = structuredClone(r);
    assert.equal(use(r, request).ok, false);
    assert.equal(r.actionsLeft, before.actionsLeft);
    assert.deepEqual(r.players[0].character, before.players[0].character);
    assert.deepEqual(r.scoutRevealGrants, []);
  }

  r = room();
  r.players[1].col = 15;
  assert.equal(playerManhattanDistance(r.players[0], r.players[1]), 5);
  const before = structuredClone(r);
  assert.equal(use(r, { mode: 'money', targetPlayerId: 'p2' }).ok, false);
  assert.equal(r.actionsLeft, before.actionsLeft);
  assert.deepEqual(r.players[0].character, before.players[0].character);
  assert.deepEqual(r.scoutRevealGrants, []);
});

test('Scout authoritative gate rejects navigation, another turn, pending, zero actions and missing Scout without mutation', () => {
  const cases = [
    r => { r.phase = 'navigation'; },
    r => { r.turnIndex = 1; },
    r => { r.actionsLeft = 0; },
    r => { r.players[0].character = null; },
  ];
  for (const mutate of cases) {
    const r = room(); mutate(r);
    const before = structuredClone(r);
    const result = use(r, { mode: 'money', targetPlayerId: 'p2' });
    assert.equal(result.ok, false);
    assert.deepEqual(r, before);
  }
  const r = room(), before = structuredClone(r);
  assert.equal(use(r, { mode: 'money', targetPlayerId: 'p2' }, { pending: true }).ok, false);
  assert.deepEqual(r, before);
});

test('forged client fields cannot expand the server-built grant scope', () => {
  const r = room();
  const result = use(r, {
    mode: 'money',
    targetPlayerId: 'p2',
    viewerPlayerId: 'p3',
    islandId: 'i2',
    debt: true,
    scoutRevealGrants: [{ mode: 'garrison', islandId: 'i2' }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(r.scoutRevealGrants[0]).sort(), ['mode','personalTurnNo','targetPlayerId','viewerPlayerId']);
  assert.deepEqual(r.scoutRevealGrants[0], { viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: 7 });
});

test('successful Scout use replaces the same viewer money grant with one garrison grant and preserves another viewer grant', () => {
  const r = room();
  assert.equal(use(r, { mode: 'money', targetPlayerId: 'p2' }).ok, true);

  const otherViewerGrant = { viewerPlayerId: 'p3', mode: 'money', targetPlayerId: 'p2', personalTurnNo: 3 };
  r.scoutRevealGrants.push(structuredClone(otherViewerGrant));
  r.round = 3;
  r.players[0].personalTurnNo = 8;
  r.players[0].characterUsedRound = null;
  r.actionsLeft = 2;

  const second = use(r, { mode: 'garrison', islandId: 'i2' });
  assert.equal(second.ok, true);
  assert.deepEqual(r.scoutRevealGrants, [
    otherViewerGrant,
    { viewerPlayerId: 'p1', mode: 'garrison', islandId: 'i2', personalTurnNo: 8 },
  ]);
  assert.equal(r.scoutRevealGrants.filter(grant => grant.viewerPlayerId === 'p1').length, 1);

  const out = projectOpponentFacingRoomView(r, scoutViewerContext(r, 'p1'));
  assert.equal(has(out.players.find(p => p.id === 'p2'), 'ducats'), false);
  assert.equal(has(out.islands.find(i => i.id === 'i1'), 'garrisonType'), false);
  assert.equal(out.islands.find(i => i.id === 'i2').garrisonType, 'SECRET_SECOND_GARRISON');
  assert.deepEqual(r.scoutRevealGrants.find(grant => grant.viewerPlayerId === 'p3'), otherViewerGrant);
});

test('successful Scout use replaces the same viewer garrison grant with one money grant', () => {
  const r = room();
  assert.equal(use(r, { mode: 'garrison', islandId: 'i1' }).ok, true);
  r.round = 3;
  r.players[0].personalTurnNo = 8;
  r.players[0].characterUsedRound = null;
  r.actionsLeft = 2;

  const second = use(r, { mode: 'money', targetPlayerId: 'p2' });
  assert.equal(second.ok, true);
  assert.deepEqual(r.scoutRevealGrants, [
    { viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: 8 },
  ]);

  const out = projectOpponentFacingRoomView(r, scoutViewerContext(r, 'p1'));
  assert.equal(out.players.find(p => p.id === 'p2').ducats, 'SECRET_SCOUT_DUCATS');
  for (const target of out.islands) {
    for (const key of ['garrisonType','garrisonName','garrisonDefense','defenseArmy','defenseBreakdown']) {
      assert.equal(has(target, key), false, key);
    }
  }
});

test('failed Scout replacement leaves the existing grant, actions and held character unchanged', () => {
  const r = room();
  assert.equal(use(r, { mode: 'money', targetPlayerId: 'p2' }).ok, true);
  r.players[0].character = { id: 'scout', name: 'Scout' };
  r.actionsLeft = 2;
  const before = structuredClone(r);

  const failed = use(r, { mode: 'garrison', islandId: 'missing' });
  assert.equal(failed.ok, false);
  assert.deepEqual(r, before);
});

test('selected garrison grant reveals exactly one island privateGarrison contract and no money/private owner state', () => {
  const r = room();
  assert.equal(use(r, { mode: 'garrison', islandId: 'i1' }).ok, true);
  const out = projectOpponentFacingRoomView(r, scoutViewerContext(r, 'p1'));
  assert.equal(out.islands[0].garrisonType, 'SECRET_SCOUT_GARRISON');
  assert.equal(out.islands[0].garrisonName, 'SECRET_SCOUT_GARRISON');
  assert.equal(out.islands[0].defenseArmy, 9);
  assert.equal(out.islands[0].defenseBreakdown.hiredGarrison, 4);
  for (const key of ['garrisonType','garrisonName','garrisonDefense','defenseArmy','defenseBreakdown']) assert.equal(has(out.islands[1], key), false, key);
  assert.equal(has(out.players[1], 'ducats'), false);
  privateKeysAbsent(out.players[1]);
  assert.equal(has(out, 'scoutRevealGrants'), false);
});

test('selected money grant reveals only current ducats; debt and every other private category remain omitted', () => {
  const r = room();
  assert.equal(use(r, { mode: 'money', targetPlayerId: 'p2' }).ok, true);
  const out = projectOpponentFacingRoomView(r, scoutViewerContext(r, 'p1'));
  const selected = out.players.find(p => p.id === 'p2');
  const second = out.players.find(p => p.id === 'p3');
  assert.equal(selected.ducats, 'SECRET_SCOUT_DUCATS');
  assert.equal(has(selected, 'debt'), false);
  privateKeysAbsent(selected);
  assert.equal(has(second, 'ducats'), false);
  for (const target of out.islands) for (const key of ['garrisonType','garrisonName','garrisonDefense','defenseArmy','defenseBreakdown']) assert.equal(has(target, key), false, key);
  assert.equal(JSON.stringify(out).includes('SECRET_SCOUT_DEBT'), false);
  assert.equal(JSON.stringify(out).includes('SECRET_ASSIGNMENT'), false);
  assert.equal(JSON.stringify(out).includes('SECRET_LEGENDARY'), false);
  assert.equal(JSON.stringify(out).includes('SECRET_SAVED'), false);
  assert.equal(JSON.stringify(out).includes('SECRET_EXPEDITION'), false);
});

test('same-turn projection keeps the grant after movement, reads live target state, and clear expires it', () => {
  const r = room();
  assert.equal(use(r, { mode: 'money', targetPlayerId: 'p2' }).ok, true);
  r.players[0].row = 0; r.players[0].col = 0;
  r.players[1].ducats = 'SECRET_SCOUT_DUCATS_UPDATED';
  let out = projectOpponentFacingRoomView(r, scoutViewerContext(r, 'p1'));
  assert.equal(out.players.find(p => p.id === 'p2').ducats, 'SECRET_SCOUT_DUCATS_UPDATED');
  assert.equal(clearScoutRevealGrants(r, 'p1'), 1);
  out = projectOpponentFacingRoomView(r, scoutViewerContext(r, 'p1'));
  assert.equal(has(out.players.find(p => p.id === 'p2'), 'ducats'), false);
});

test('grant validity is bound to viewer and personalTurnNo even before cleanup', () => {
  const r = room();
  r.scoutRevealGrants = [{ viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: 7 }];
  assert.equal(scoutViewerContext(r, 'p1').scoutRevealGrants.length, 1);
  r.players[0].personalTurnNo = 8;
  assert.equal(scoutViewerContext(r, 'p1').scoutRevealGrants.length, 0);
  r.players[0].personalTurnNo = 7;
  r.turnIndex = 1;
  assert.equal(scoutViewerContext(r, 'p1').scoutRevealGrants.length, 0);
});

test('restore normalization keeps only the last valid current Scout capability and strips arbitrary fields', () => {
  const r = room();
  const turnNo = r.players[0].personalTurnNo;
  r.scoutRevealGrants = [
    null,
    'bad-entry',
    { viewerPlayerId: 'missing-viewer', mode: 'money', targetPlayerId: 'p2', personalTurnNo: turnNo },
    { viewerPlayerId: 'p2', mode: 'money', targetPlayerId: 'p3', personalTurnNo: r.players[1].personalTurnNo },
    { viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: turnNo - 1 },
    { viewerPlayerId: 'p1', mode: 'bogus', targetPlayerId: 'p2', personalTurnNo: turnNo },
    { viewerPlayerId: 'p1', mode: 'money', personalTurnNo: turnNo },
    { viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'missing-target', personalTurnNo: turnNo },
    { viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p1', personalTurnNo: turnNo },
    { viewerPlayerId: 'p1', mode: 'garrison', islandId: 'missing-island', personalTurnNo: turnNo },
    { viewerPlayerId: 'p1', mode: 'garrison', islandId: 'i1', personalTurnNo: turnNo, garrison: { defenseArmy: 999 }, debt: true },
    { viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p3', personalTurnNo: turnNo, ducats: 999, debt: true, socketId: 'forbidden' },
    { viewerPlayerId: 'p3', mode: 'money', targetPlayerId: 'p2', personalTurnNo: r.players[2].personalTurnNo },
  ];

  const result = normalizeScoutRevealGrants(r);
  assert.equal(result.changed, true);
  assert.deepEqual(r.scoutRevealGrants, [
    { viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p3', personalTurnNo: turnNo },
  ]);
  assert.deepEqual(Object.keys(r.scoutRevealGrants[0]).sort(), ['mode','personalTurnNo','targetPlayerId','viewerPlayerId']);
});

test('legacy and malformed Scout grant containers normalize to runtime-safe empty state without extending lifetime', () => {
  for (const value of [undefined, null, {}, 'bad']) {
    const r = room();
    if (value === undefined) delete r.scoutRevealGrants;
    else r.scoutRevealGrants = value;
    const result = normalizeScoutRevealGrants(r);
    assert.equal(result.changed, true);
    assert.deepEqual(r.scoutRevealGrants, []);
  }

  const stale = room();
  const originalTurnNo = stale.players[0].personalTurnNo;
  stale.scoutRevealGrants = [{ viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: originalTurnNo - 1 }];
  normalizeScoutRevealGrants(stale);
  assert.equal(stale.players[0].personalTurnNo, originalTurnNo);
  assert.deepEqual(stale.scoutRevealGrants, []);

  const inactive = room();
  inactive.turnIndex = 1;
  inactive.scoutRevealGrants = [{ viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: originalTurnNo }];
  normalizeScoutRevealGrants(inactive);
  assert.deepEqual(inactive.scoutRevealGrants, []);
});

test('projection defense returns at most the last current valid grant without range, character, action or pending revalidation', () => {
  const r = room();
  const turnNo = r.players[0].personalTurnNo;
  r.players[0].row = 0;
  r.players[0].col = 0;
  r.players[0].character = null;
  r.actionsLeft = 0;
  r.pendingEvent = { playerId: 'p1', kind: 'SECRET_PENDING' };
  r.scoutRevealGrants = [
    { viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: turnNo },
    { viewerPlayerId: 'p1', mode: 'garrison', islandId: 'i1', personalTurnNo: turnNo },
    { viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'missing', personalTurnNo: turnNo },
  ];

  assert.deepEqual(activeScoutRevealGrants(r, 'p1'), [
    { viewerPlayerId: 'p1', mode: 'garrison', islandId: 'i1', personalTurnNo: turnNo },
  ]);
  const out = projectOpponentFacingRoomView(r, scoutViewerContext(r, 'p1'));
  assert.equal(out.islands.find(i => i.id === 'i1').garrisonType, 'SECRET_SCOUT_GARRISON');
  assert.equal(has(out.players.find(p => p.id === 'p2'), 'ducats'), false);
});

test('restored garrison capability reads live authoritative garrison state and never stores a snapshot', () => {
  const r = room();
  const turnNo = r.players[0].personalTurnNo;
  r.scoutRevealGrants = [{
    viewerPlayerId: 'p1',
    mode: 'garrison',
    islandId: 'i1',
    personalTurnNo: turnNo,
    garrisonDefense: 999,
    defenseBreakdown: { total: 999 },
  }];
  normalizeScoutRevealGrants(r);
  r.islands[0].garrisonType = 'LIVE_RESTORED_GARRISON';
  r.islands[0].defenseArmy = 17;
  r.islands[0].defenseBreakdown.hiredGarrison = 11;

  const out = projectOpponentFacingRoomView(r, scoutViewerContext(r, 'p1'));
  const target = out.islands.find(i => i.id === 'i1');
  assert.equal(target.garrisonType, 'LIVE_RESTORED_GARRISON');
  assert.equal(target.defenseArmy, 17);
  assert.equal(target.defenseBreakdown.hiredGarrison, 11);
  assert.deepEqual(r.scoutRevealGrants, [
    { viewerPlayerId: 'p1', mode: 'garrison', islandId: 'i1', personalTurnNo: turnNo },
  ]);
});

test('two real sockets receive isolated Scout projections and public observer receives no grant', { timeout: 10000 }, async t => {
  const r = room();
  assert.equal(use(r, { mode: 'money', targetPlayerId: 'p2' }).ok, true);

  const httpServer = http.createServer();
  const io = new Server(httpServer, { serveClient: false });
  io.on('connection', socket => {
    const viewerId = String(socket.handshake.auth?.viewerId || '');
    socket.emit('roomState', projectOpponentFacingRoomView(r, scoutViewerContext(r, viewerId)));
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const port = httpServer.address().port;
  const a = clientIo('http://127.0.0.1:' + port, { transports: ['websocket'], reconnection: false, auth: { viewerId: 'p1' }, autoConnect: false });
  const b = clientIo('http://127.0.0.1:' + port, { transports: ['websocket'], reconnection: false, auth: { viewerId: 'p3' }, autoConnect: false });
  const viewAPromise = once(a, 'roomState');
  const viewBPromise = once(b, 'roomState');
  a.connect(); b.connect();
  t.after(() => { a.disconnect(); b.disconnect(); io.close(); });
  const [viewA] = await viewAPromise;
  const [viewB] = await viewBPromise;

  assert.equal(viewA.players.find(p => p.id === 'p2').ducats, 'SECRET_SCOUT_DUCATS');
  assert.equal(has(viewA.players.find(p => p.id === 'p2'), 'debt'), false);
  assert.equal(has(viewB.players.find(p => p.id === 'p2'), 'ducats'), false);
  assert.equal(JSON.stringify(viewB).includes('SECRET_SCOUT_DUCATS'), false);

  const observer = projectOpponentFacingRoomView(r, scoutViewerContext(r, null));
  assert.equal(has(observer.players.find(p => p.id === 'p2'), 'ducats'), false);
  assert.equal(has(observer, 'scoutRevealGrants'), false);
});

test('Scout root grant and CHECKPOINT D source counters never pass ordinary projection', () => {
  const r = room();
  r.scoutRevealGrants = [{ viewerPlayerId: 'p1', mode: 'money', targetPlayerId: 'p2', personalTurnNo: 7 }];
  const out = projectOpponentFacingRoomView(r, scoutViewerContext(r, 'p1'));
  assert.equal(SCOUT_RUNTIME_ENABLED, true);
  for (const key of ['scoutRevealGrants','eventDecks','feudDecks','assignmentDecks']) assert.equal(has(out, key), false, key);
});

test('server expires Scout grants inside endTurnInternal before advancing the turn', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('function endTurnInternal(room)');
  const end = source.indexOf('\nfunction ', start + 1);
  const body = source.slice(start, end);
  const clearAt = body.indexOf('clearScoutRevealGrants(room, ending.id)');
  const advanceAt = body.indexOf('room.completedTurns += 1');
  assert.ok(clearAt > 0, 'Scout cleanup is present');
  assert.ok(advanceAt > clearAt, 'Scout cleanup happens before turn advancement');
});
