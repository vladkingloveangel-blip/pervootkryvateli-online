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
  const canonical = await (await fetch(base + '/api/rules')).json();
  assert.equal(canonical.metadata.schemaVersion, 1);
  assert.equal(canonical.politics.factions.kadingir.fullConquestPrize.ducats, 50);
  assert.equal(canonical.islands.length, 28);
  assert.equal(canonical.implementation.activeProfile, 'stage-6-events-legends-6.6');
  assert.equal(canonical.implementation.pendingConsumers.some(item => item.consumerStage <= 5), false);
  const a = (await api('/api/auth/register', null, { username: 'playerone', password: 'password1' })).data;
  const b = (await api('/api/auth/register', null, { username: 'playertwo', password: 'password2' })).data;
  const c = (await api('/api/auth/register', null, { username: 'playerthree', password: 'password3' })).data;
  const d = (await api('/api/auth/register', null, { username: 'playerfour', password: 'password4' })).data;
  const stranger = (await api('/api/auth/register', null, { username: 'stranger', password: 'password3' })).data;
  const admin = (await api('/api/auth/login', null, { username: 'testadmin', password: 'testpassword' })).data;
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(admin.ok, true);
  const profileUpdate = await api('/api/auth/profile', a.token, { displayName: 'Captain One' });
  assert.equal(profileUpdate.data.ok, true);
  assert.equal(profileUpdate.data.user.displayName, 'Captain One');
  a.token = profileUpdate.data.token;
  assert.equal((await api('/api/auth/me', a.token)).data.user.displayName, 'Captain One');
  assert.equal((await api('/api/auth/change-password', a.token, { oldPassword: 'password1', newPassword: 'password1b' })).data.ok, true);
  assert.equal((await api('/api/auth/login', null, { username: 'playerone', password: 'password1b' })).data.ok, true);
  const first = await connect(); const second = await connect(); const third = await connect(); const fourth = await connect(); const watcher = await connect();
  const created = await emit(first, 'createRoom', { accountToken: a.token, name: 'One' });
  assert.equal(created.ok, true); assert.equal(rows().length, 1); // ack means durable
  const code = created.code;
  const joinedSecond = await emit(second, 'joinRoom', { code, accountToken: b.token, name: 'Two' });
  const joinedThird = await emit(third, 'joinRoom', { code, accountToken: c.token, name: 'Three' });
  const joinedFourth = await emit(fourth, 'joinRoom', { code, accountToken: d.token, name: 'Four' });
  assert.equal(joinedSecond.ok && joinedThird.ok && joinedFourth.ok, true);
  assert.equal((await emit(first, 'startGame')).ok, false);
  assert.equal((await emit(first, 'setSeatingOrder', { playerIds: [created.playerId,joinedThird.playerId,joinedSecond.playerId,joinedFourth.playerId] })).ok,true);
  assert.equal((await emit(first, 'setLeader', { playerId: joinedSecond.playerId })).ok,true);
  assert.equal((await emit(second, 'changeShip', { shipClass:'brigantine' })).ok,false);
  assert.equal((await emit(first, 'setReady', { ready: true })).ok, true);
  assert.equal((await emit(second, 'setReady', { ready: true })).ok, true);
  assert.equal((await emit(third, 'setReady', { ready: true })).ok, true);
  assert.equal((await emit(fourth, 'setReady', { ready: true })).ok, true);
  assert.equal((await emit(first, 'startGame')).ok, true);
  const started = rows()[0].state;
  assert.equal(started.started, true);
  assert.equal(started.players.find(p=>p.id===joinedSecond.playerId).shipClass,'carrack');
  assert.deepEqual(started.order,[joinedSecond.playerId,joinedFourth.playerId,created.playerId,joinedThird.playerId]);
  assert.equal(started.players.every(p=>p.ducats===canonical.session.startingDucats),true);
  assert.equal(started.players.every(p=>p.row===0 && p.col===0),true);
  const lockedClass = started.players.find(p=>p.id===created.playerId).shipClass;
  const attemptedClass = lockedClass === 'brigantine' ? 'frigate' : 'brigantine';
  assert.equal((await emit(first, 'changeShip', { shipClass: attemptedClass })).ok, false);
  assert.equal(rows()[0].state.players.find(p=>p.id===created.playerId).shipClass, lockedClass);
  const active = second;
  assert.equal((await emit(active, 'skipNavigation')).ok, true);
  assert.equal((await emit(active, 'endTurn')).ok, true);
  let beforeRestart = rows()[0].state;
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
  assert.equal(watch.room.adminSpectator, true); assert.equal(watch.room.players.length, 4);
  assert.equal(watch.room.ruleset.rulesetVersion, canonical.metadata.rulesetVersion);
  assert.equal(watch.room.balanceCatalog.bastion.price, canonical.economy.buildings.bastion.price);
  assert.equal(watch.room.balanceCatalog.bastion.defense, canonical.economy.buildings.bastion.defense);
  assert.equal(watch.room.runtimeProfile, 'stage-6-events-legends-6.6');
  assert.equal(watch.room.shipCatalog.brigantine.artillery, canonical.fleet.ships.brigantine.artillery);
  assert.deepEqual(watch.room.balanceCatalog.landCompany, canonical.economy.landCompany);
  assert.deepEqual(watch.room.balanceCatalog.garrisons, canonical.economy.garrisons);
  assert.equal(watch.room.balanceCatalog.loadingLimitPerIslandPerRound, canonical.economy.loadingLimitPerIslandPerRound);
  assert.equal(watch.room.balanceCatalog.contractBonusRatio, canonical.economy.contractBonusRatio);
  assert.deepEqual(watch.room.balanceCatalog.expeditionLimits, canonical.legends.expeditionLimits);
  assert.equal(watch.room.balanceCatalog.combat.attacksPerOpponentPerRound, canonical.scoring.combat.attacksPerOpponentPerRound);
  assert.deepEqual(watch.room.balanceCatalog.fleetScoring, canonical.scoring.fleet);
  assert.equal(watch.room.anchorCells.find(a=>a.color==='blue').fleetPoints, canonical.scoring.fleet.anchor.blue);
  assert.equal(watch.room.anchorCells.some(a=>Object.hasOwn(a,'glory')), false);
  assert.deepEqual(watch.room.balanceCatalog.armyScoring, canonical.scoring.army);
  assert.equal(watch.room.factions.length,6);
  assert.equal(watch.room.factions.find(f=>f.id==='mori').giftIslandId,'miyosi');
  assert.equal(watch.room.factions.find(f=>f.id==='mori').fullConquestPrize.ducats,40);
  assert.equal(watch.room.factions.find(f=>f.id==='kadingir').fullConquestPrize.ducats,50);
  assert.equal(watch.room.factions.find(f=>f.id==='kadingir').fullConquestPrize.amountUnresolved,false);
  assert.equal(watch.room.factions.find(f=>f.id==='lionia').fullConquestPrize.ducats,60);
  assert.equal(Object.hasOwn(watch.room.factions.find(f=>f.id==='lionia').fullConquestPrize,'preserveBuildings'),false);
  assert.equal(Object.hasOwn(watch.room,'pendingStatePrize'),false);
  assert.deepEqual(Object.keys(watch.room.feudDecks),['lionia','kadingir','mori','mayo','suniksiya','pirates']);
  for (const factionId of Object.keys(watch.room.feudDecks)) {
    assert.equal(watch.room.feudDecks[factionId].remaining,10,factionId);
    assert.equal(watch.room.feudDecks[factionId].discard,0,factionId);
  }
  assert.deepEqual(Object.keys(watch.room.assignmentDecks),['lionia','kadingir','mori','suniksiya','pirates']);
  assert.equal(Object.values(watch.room.assignmentDecks).reduce((sum,deck)=>sum+deck.remaining,0),49);
  assert.equal(watch.room.assignmentDecks.mori.remaining,10);
  assert.equal(watch.room.legendaryPlaces.length,10);
  assert.deepEqual([watch.room.legendaryPlaces.filter(p=>p.kind==='sea').length,watch.room.legendaryPlaces.filter(p=>p.kind==='island').length],[7,3]);
  assert.equal(watch.room.map.legendaryPlaces.length,7);
  assert.equal(watch.room.namedPlaceCards.length,10);
  assert.equal(watch.room.namedPlaceCards.every(card=>card.visibility==='public' && card.claimedBy===null),true);
  assert.equal(watch.room.eventDecks.expeditions.remaining,10);
  assert.equal(Object.hasOwn(watch.room.eventDecks,'legendary'),false);
  assert.deepEqual(watch.room.legendaryPool,{
    mode:'random-with-replacement',
    selection:'uniform',
    typeIds:['sea-veil','hellfire','mist-path','sea-curse'],
  });
  assert.equal(watch.room.players.every(player=>player.hasActiveExpedition===false && player.expeditionHistoryCount===0),true);
  assert.equal(Object.hasOwn(watch.room.balanceCatalog,'assignmentReplacementPrice'),false);
  assert.equal(watch.room.balanceCatalog.legendaryEffects['sea-curse'].amount, canonical.legends.legendary.find(c => c.id === 'sea-curse').effect.amount);
  assert.equal(watch.room.balanceCatalog.legendaryEffects['sea-veil'].durationPersonalTurns,3);
  assert.equal(watch.room.balanceCatalog.legendaryEffects['sea-veil'].reactionActionCost,0);
  assert.equal(watch.room.balanceCatalog.legendaryEffects['sea-veil'].hostileCardReactionExpiry,'end-of-current-turn');
  assert.equal(watch.room.shipLevelCatalog[7], undefined);
  assert.equal(watch.room.shipUpgradeCatalog.leadLine.price, canonical.fleet.upgrades.leadLine.price);
  assert.equal(watch.room.shipUpgradeCatalog.leadLine.passability, 'shoal');
  assert.equal(watch.room.shipUpgradeCatalog.reefPilot.passability, 'reef');
  assert.equal(watch.room.shipUpgradeCatalog.iceStem.passability, 'ice');
  assert.equal(watch.room.shipUpgradeCatalog.portageSleds.passability, 'land1');
  assert.equal(watch.room.shipUpgradeCatalog.foreMarsel, undefined);
  assert.equal(watch.room.escortCatalog.cargo.cargo, canonical.fleet.escorts.cargo.cargo);
  assert.equal(watch.room.escortCatalog.combat.artillery, canonical.fleet.escorts.combat.artillery);
  assert.equal(watch.room.escortCatalog.landin.retired, true);
  assert.equal(watch.room.buildingCatalog.admiralty.price, canonical.economy.buildings.admiralty.price);
  assert.equal(watch.room.buildingCatalog.lighthouse.price, canonical.economy.buildings.lighthouse.price);
  assert.equal(watch.room.characterCatalog.navigator.admiraltyLevel, 1);
  assert.equal(watch.room.characterCatalog.scout.effect.unresolved, 'R29');
  await stop(); // Abrupt restart: pending state must survive without disconnect handlers.
  // Emulate a persisted room created before rulesDataVersion existed. Keep the complete
  // pre-stage-1 decks and an unfinished fleet decision instead of rebuilding them.
  const savedDatabase = JSON.parse(fs.readFileSync(file,'utf8'));
  const legacyRoom = savedDatabase.game_rooms[0].state;
  delete legacyRoom.rulesDataVersion; delete legacyRoom.rulesSchemaVersion; delete legacyRoom.runtimeProfile;
  const oldPlayer = legacyRoom.players.find(p => p.id === created.playerId);
  Object.assign(oldPlayer,{ shipClass:'brigantine',level:7,upgrades:['foreStengha','foreMarsel'],
    escorts:[{id:'old-landin',type:'landin',special:true,cargo:{goodId:'ore',quantity:5}}],nextEscortId:1 });
  const oldIsland = legacyRoom.islands.find(i => i.id === 'asigoriy');
  Object.assign(oldIsland,{area:4,army:12,resources:['Рудная жила']});
  legacyRoom.anchorDecks.red.drawPile[0].artillery = 23;
  legacyRoom.treasureDeck.drawPile[0] = {id:'full-ore-hold',name:'Полный трюм руды',cargoGoodId:'ore',copy:1};
  legacyRoom.pendingFleetAdjustment = {id:'old-choice',playerId:oldPlayer.id,stage:'landin-replace',required:1,
    options:[{id:'old-landin',name:'Особое сопровождение Ландина'}]};
  // Stage 5.8 compatibility: emulate an old assignment save without Mori deck/progress
  // and with the removed paid-replacement state. Other legacy state must remain untouched.
  delete legacyRoom.assignmentDecks.mori;
  delete legacyRoom.assignmentDecks.lionia.removed;
  const legacyMoriCard = structuredClone(canonical.politics.assignments.mori[0]);
  const legacyMoriIsland = legacyRoom.islands.find(i => i.id === legacyMoriCard.islandId);
  oldPlayer.row = legacyMoriIsland.cells[0][0]; oldPlayer.col = legacyMoriIsland.cells[0][1];
  oldPlayer.suzerainId = 'mori';
  oldPlayer.activeAssignment = { factionId:'mori', card:legacyMoriCard, issuedRound:3 };
  oldPlayer.replacedAssignmentConditions = ['old-paid-condition'];
  legacyRoom.pendingAssignmentChoice = { id:'old-paid-assignment-choice', playerId:oldPlayer.id, factionId:'mori' };
  fs.writeFileSync(file,JSON.stringify(savedDatabase));
  beforeRestart = structuredClone(legacyRoom);
  await start();
  assert.match(output, /Restored 1 unfinished rooms/);
  const health = (await api('/health')).data;
  assert.equal(health.databaseReady, true); assert.equal(health.roomPersistence.restored, 1);
  const newDevice = await connect(); const restoredWatcher = await connect();
  const restored = await emit(restoredWatcher, 'adminWatchRoom', { code, accountToken: admin.token });
  assert.equal(restored.room.players.every(p => !p.connected), true);
  const restoredPlayer = restored.room.players.find(p => p.id === created.playerId);
  assert.equal(restoredPlayer.level,7);
  assert.equal(restoredPlayer.stats.artillery,canonical.fleet.ships.brigantine.artillery + 6);
  assert.equal(restoredPlayer.escorts[0].type,'landin');
  assert.equal(restored.room.pendingFleetAdjustment.id,'old-choice');
  assert.equal(restored.room.islands.find(i => i.id === 'asigoriy').area,4);
  assert.equal(restored.room.anchorDecks.red.remaining,legacyRoom.anchorDecks.red.drawPile.length);
  assert.equal(restored.room.ruleset.rulesetVersion,canonical.metadata.rulesetVersion);
  assert.equal((await emit(newDevice, 'resumeRoom', { code, accountToken: stranger.token, playerToken: created.playerToken })).ok, false);
  const resumed = await emit(newDevice, 'resumeRoom', { code, accountToken: a.token });
  assert.equal(resumed.ok, true); assert.equal(resumed.playerId, created.playerId);
  const afterRestart = rows()[0].state;
  const afterOldPlayer = afterRestart.players.find(p => p.id === created.playerId);
  assert.deepEqual(Object.keys(afterRestart.assignmentDecks), ['lionia','kadingir','suniksiya','pirates','mori']);
  assert.equal(afterRestart.assignmentDecks.mori.drawPile.length, 9); // активная карта не возвращается в восстановленную колоду
  assert.deepEqual(afterRestart.assignmentDecks.lionia.removed, []);
  assert.equal(afterRestart.pendingAssignmentChoice, null);
  assert.equal(Object.hasOwn(afterOldPlayer,'replacedAssignmentConditions'), false);
  assert.match(afterOldPlayer.activeAssignment.instanceId, /^legacy:/);
  assert.equal(afterOldPlayer.activeAssignment.progress.kind, 'mori-service');
  assert.equal(afterOldPlayer.activeAssignment.progress.departureRequired, true);
  assert.equal(afterOldPlayer.activeAssignment.progress.departureSatisfied, false);
  const stripAssignmentMigration = value => {
    const copy = structuredClone(value);
    delete copy.assignmentDecks; delete copy.pendingAssignmentChoice;
    for (const player of copy.players) { delete player.activeAssignment; delete player.replacedAssignmentConditions; }
    return copy;
  };
  assert.deepEqual(stripAssignmentMigration(afterRestart), stripAssignmentMigration(beforeRestart));
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
