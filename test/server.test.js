const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { io } = require('socket.io-client');
const { CURRENT_DIGITAL_MODEL_SCHEMA_VERSION, migrateRoomState } = require('../save-migrations');
const { getPendingResolution, pendingResolutionToLegacy } = require('../domain-state');

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
  const assertCurrentPersistedShape = state => {
    assert.equal(state.digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
    for (const field of ['anchorDecks','eventDeck','feudDecks','assignmentDecks','expeditionDeck','treasureDeck','legendaryDeck','pendingEvent','pendingFeud','pendingAssignmentChoice','pendingLegendaryReaction','pendingExpeditionRewards','eventPhase','legendaryPlacesExplored','pendingStatePrize']) {
      assert.equal(Object.hasOwn(state, field), false, field);
    }
    for (const player of state.players || []) {
      for (const field of ['activeAssignment','activeExpedition','expeditionHistory','expeditionDrawRound','expeditionsDrawnThisRound','legendaryCards','specialCards','savedEventCards','namedPlaceCards','activeTurnEffects','nextTurnEffects','legendaryEffects','pendingLegendary','replacedAssignmentConditions']) {
        assert.equal(Object.hasOwn(player, field), false, field);
      }
    }
    for (const island of state.islands || []) {
      assert.equal(Object.hasOwn(island, 'legendaryVeil'), false, 'legendaryVeil');
      assert.equal(Object.hasOwn(island, 'legendaryVeilReaction'), false, 'legendaryVeilReaction');
    }
  };
  t.after(async () => { sockets.forEach(s => s.disconnect()); if (child?.exitCode === null) await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await start();
  const canonical = await (await fetch(base + '/api/rules')).json();
  assert.equal(canonical.metadata.schemaVersion, 1);
  assert.equal(canonical.politics.factions.kadingir.fullConquestPrize.ducats, 50);
  assert.equal(canonical.islands.length, 28);
  assert.equal(canonical.implementation.activeProfile, 'stage-6-events-legends-6.7');
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
  let firstView, secondView;
  first.on('roomState', view => { firstView=view; });
  second.on('roomState', view => { secondView=view; });
  const created = await emit(first, 'createRoom', { accountToken: a.token, name: 'One' });
  assert.equal(created.ok, true); assert.equal(rows().length, 1); // ack means durable
  const code = created.code;
  assert.equal(rows()[0].state.digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assertCurrentPersistedShape(rows()[0].state);
  assert.ok(rows()[0].state.randomSourceState);
  assert.ok(rows()[0].state.randomSourceState.assignmentPool);
  assert.ok(rows()[0].state.randomSourceState.expeditionPool);
  assert.equal(Object.hasOwn(rows()[0].state, 'expeditionDeck'), false);
  const createdPlayerState = rows()[0].state.players.find(player => player.id === created.playerId);
  assert.deepEqual(createdPlayerState.activeExpeditionTask, null);
  assert.deepEqual(createdPlayerState.expeditionCompletions, []);
  assert.deepEqual(createdPlayerState.expeditionAccessUsage, { round: null, draws: 0 });
  assert.deepEqual(createdPlayerState.activeAssignmentTask, null);
  assert.deepEqual(createdPlayerState.consumableAbilities, []);
  assert.equal(createdPlayerState.consumableAbilitySequence, 0);
  assert.deepEqual(createdPlayerState.storedBenefits, []);
  for (const legacyField of ['activeExpedition', 'expeditionHistory', 'expeditionDrawRound', 'expeditionsDrawnThisRound', 'activeAssignment', 'legendaryCards', 'specialCards', 'savedEventCards']) {
    assert.equal(Object.hasOwn(createdPlayerState, legacyField), false, legacyField);
  }
  for (const legacySourceField of ['anchorDecks', 'eventDeck', 'feudDecks', 'assignmentDecks']) {
    assert.equal(Object.hasOwn(rows()[0].state, legacySourceField), false, legacySourceField);
  }
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
  await new Promise(resolve=>setTimeout(resolve,50));
  for(const [view,ownerId] of [[firstView,created.playerId],[secondView,joinedSecond.playerId]]) {
    assert.ok(view);
    assert.equal(Object.hasOwn(view,'log'),false);
    assert.equal(Object.hasOwn(view,'digitalModelSchemaVersion'),false);
    assert.equal(Object.hasOwn(view,'randomSourceState'),false);
    for(const key of ['eventDecks','feudDecks','assignmentDecks']) assert.equal(Object.hasOwn(view,key),false,key);
    for(const p of view.players) {
      if(p.id===ownerId) {
        assert.equal(p.ducats,canonical.session.startingDucats);
        assert.ok(Object.hasOwn(p,'characterAcquisitionOptions'));
        assert.ok(Object.hasOwn(p,'nextTurnEffects'));
      } else for(const key of ['ducats','debt','character','activeAssignment','hasActiveAssignment','assignmentPriority','specialCards','specialCardCount','legendaryCards','legendaryCardCount','playableLegendaryCards','savedEventCards','savedEventCardCount','activeExpedition','hasActiveExpedition','nextTurnEffects']) assert.equal(Object.hasOwn(p,key),false,key);
    }
  }
  const started = rows()[0].state;
  assert.equal(started.started, true);
  assertCurrentPersistedShape(started);
  assert.ok(started.randomSourceState.assignmentPool);
  assert.ok(started.randomSourceState.expeditionPool);
  assert.equal(Object.hasOwn(started, 'assignmentDecks'), false);
  assert.equal(Object.hasOwn(started, 'expeditionDeck'), false);
  assert.equal(started.players.every(p => p.activeExpeditionTask === null), true);
  assert.equal(started.players.every(p => Array.isArray(p.expeditionCompletions) && p.expeditionCompletions.length === 0), true);
  assert.equal(started.players.every(p => p.expeditionAccessUsage?.round === null && p.expeditionAccessUsage?.draws === 0), true);
  assert.equal(started.players.every(p => p.activeAssignmentTask === null), true);
  assert.equal(started.players.every(p => Array.isArray(p.consumableAbilities) && p.consumableAbilities.length === 0), true);
  assert.equal(started.players.every(p => p.consumableAbilitySequence === 0), true);
  assert.equal(started.players.every(p => Array.isArray(p.storedBenefits) && p.storedBenefits.length === 0), true);
  assert.equal(started.players.every(p => ['activeAssignment','legendaryCards','specialCards','savedEventCards'].every(key => !Object.hasOwn(p,key))), true);
  assert.equal(started.players.find(p=>p.id===joinedSecond.playerId).shipClass,'carrack');
  assert.deepEqual(started.order,[joinedSecond.playerId,joinedFourth.playerId,created.playerId,joinedThird.playerId]);
  assert.equal(started.players.every(p=>p.ducats===canonical.session.startingDucats),true);
  assert.equal(started.players.every(p=>p.row===0 && p.col===0),true);
  const lockedClass = started.players.find(p=>p.id===created.playerId).shipClass;
  const attemptedClass = lockedClass === 'brigantine' ? 'frigate' : 'brigantine';
  assert.equal((await emit(first, 'changeShip', { shipClass: attemptedClass })).ok, false);
  assert.equal(rows()[0].state.players.find(p=>p.id===created.playerId).shipClass, lockedClass);
  const active = second;
  const navigationScout = await emit(active, 'useScout', { mode: 'money', targetPlayerId: created.playerId });
  assert.equal(navigationScout.ok, false);
  const wrongTurnScout = await emit(first, 'useScout', { mode: 'money', targetPlayerId: joinedSecond.playerId });
  assert.equal(wrongTurnScout.ok, false);
  assert.equal((await emit(active, 'skipNavigation')).ok, true);
  const beforeScoutFailure = structuredClone(rows()[0].state);
  const missingScout = await emit(active, 'useScout', { mode: 'money', targetPlayerId: created.playerId, viewerPlayerId: created.playerId, debt: true });
  assert.equal(missingScout.ok, false);
  const afterScoutFailure = rows()[0].state;
  assert.equal(afterScoutFailure.actionsLeft, beforeScoutFailure.actionsLeft);
  assert.deepEqual(afterScoutFailure.players.find(p=>p.id===joinedSecond.playerId).character, beforeScoutFailure.players.find(p=>p.id===joinedSecond.playerId).character);
  assert.deepEqual(afterScoutFailure.scoutRevealGrants, beforeScoutFailure.scoutRevealGrants);
  assert.equal((await emit(active, 'endTurn')).ok, true);
  assertCurrentPersistedShape(rows()[0].state);
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
  for(const key of ['eventDecks','feudDecks','assignmentDecks']) assert.ok(Object.hasOwn(watch.room,key),key);
  assert.equal(watch.room.ruleset.rulesetVersion, canonical.metadata.rulesetVersion);
  assert.equal(watch.room.balanceCatalog.bastion.price, canonical.economy.buildings.bastion.price);
  assert.equal(watch.room.balanceCatalog.bastion.defense, canonical.economy.buildings.bastion.defense);
  assert.equal(watch.room.runtimeProfile, 'stage-6-events-legends-6.7');
  assert.equal(watch.room.shipCatalog.brigantine.artillery, canonical.fleet.ships.brigantine.artillery);
  assert.deepEqual(watch.room.balanceCatalog.landCompany, canonical.economy.landCompany);
  assert.deepEqual(watch.room.balanceCatalog.garrisons, canonical.economy.garrisons);
  assert.equal(watch.room.balanceCatalog.loadingLimitPerIslandPerRound, canonical.economy.loadingLimitPerIslandPerRound);
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
  assert.equal(watch.room.legendaryPlaces.every(place=>place.reward==='legendary' && place.rewardCount===1),true);
  assert.equal(watch.room.map.legendaryPlaces.length,7);
  assert.equal(watch.room.namedPlaceCards.length,10);
  assert.equal(watch.room.namedPlaceCards.every(card=>card.visibility==='public' && card.claimedBy===null),true);
  assert.equal(watch.room.eventDecks.expeditions.remaining,7);
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
  assert.deepEqual(watch.room.characterCatalog.scout.effect, {
    type: 'inspect-hidden-cards', range: 4, distance: 'manhattan',
    modes: ['garrison', 'money'], revealCount: 1, duration: 'current-personal-turn',
  });
  assert.equal(watch.room.characterCatalog.scout.useActionCost, 1);
  await stop(); // Abrupt restart: pending state must survive without disconnect handlers.
  // Emulate a persisted room created before rulesDataVersion existed. Keep the complete
  // pre-stage-1 decks and an unfinished fleet decision instead of rebuilding them.
  const savedDatabase = JSON.parse(fs.readFileSync(file,'utf8'));
  const legacyRoom = savedDatabase.game_rooms[0].state;
  const migratedSources = legacyRoom.randomSourceState;
  legacyRoom.anchorDecks = Object.fromEntries(Object.entries(migratedSources.seaEncounter).map(([color, source]) => [color, {
    drawPile: structuredClone(source.available),
    discard: structuredClone(source.recyclable),
  }]));
  legacyRoom.eventDeck = {
    drawPile: structuredClone(migratedSources.sailingEvent.available),
    discard: structuredClone(migratedSources.sailingEvent.recyclable),
  };
  legacyRoom.feudDecks = Object.fromEntries(Object.entries(migratedSources.politicalEffect).map(([id, source]) => [id, {
    drawPile: structuredClone(source.available),
    discard: structuredClone(source.recyclable),
  }]));
  legacyRoom.assignmentDecks = Object.fromEntries(Object.entries(migratedSources.assignmentPool).map(([id, source]) => [id, {
    drawPile: structuredClone(source.available),
    discard: structuredClone(source.recyclable),
    removed: structuredClone(source.permanentlyExcluded),
  }]));
  legacyRoom.expeditionDeck = {
    drawPile: structuredClone(migratedSources.expeditionPool.available),
  };
  delete legacyRoom.randomSourceState;
  delete legacyRoom.digitalModelSchemaVersion;
  delete legacyRoom.rulesDataVersion; delete legacyRoom.rulesSchemaVersion; delete legacyRoom.runtimeProfile;
  for (const legacyPlayer of legacyRoom.players) {
    legacyPlayer.activeAssignment = null;
    legacyPlayer.legendaryCards = [];
    legacyPlayer.specialCards = [];
    legacyPlayer.savedEventCards = [];
    delete legacyPlayer.activeAssignmentTask;
    delete legacyPlayer.consumableAbilities;
    delete legacyPlayer.consumableAbilitySequence;
    delete legacyPlayer.storedBenefits;
  }
  const oldPlayer = legacyRoom.players.find(p => p.id === created.playerId);
  Object.assign(oldPlayer,{ shipClass:'brigantine',level:7,upgrades:['foreStengha','foreMarsel'],
    escorts:[{id:'old-landin',type:'landin',special:true,cargo:{goodId:'ore',quantity:5}}],nextEscortId:1 });
  const oldIsland = legacyRoom.islands.find(i => i.id === 'asigoriy');
  Object.assign(oldIsland,{area:4,army:12,resources:['Рудная жила']});
  legacyRoom.anchorDecks.red.drawPile[0].artillery = 23;
  legacyRoom.treasureDeck = {drawPile:[{id:'full-ore-hold',name:'Полный трюм руды',cargoGoodId:'ore',copy:1}],discard:[]};
  const restartPendingFeudCard = legacyRoom.feudDecks.kadingir.drawPile.shift();
  const restartNextFeudKey = legacyRoom.feudDecks.kadingir.drawPile[0]
    ? `${legacyRoom.feudDecks.kadingir.drawPile[0].masterCardId || legacyRoom.feudDecks.kadingir.drawPile[0].id}:${legacyRoom.feudDecks.kadingir.drawPile[0].copy ?? 'legacy'}`
    : null;
  legacyRoom.pendingFeud = {
    id:'restart-pending-feud',
    playerId:oldPlayer.id,
    factionId:'kadingir',
    cardName:restartPendingFeudCard.name,
    kind:'remove-building',
    options:[],
    feudCard:{...restartPendingFeudCard},
  };
  assert.equal(legacyRoom.feudDecks.kadingir.discard.length,0);
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
  oldPlayer.character = 'cartographer';
  oldPlayer.nextTurnEffects = { moveBonus:1, sourceCard:'SECRET_NEXT_TURN_SOURCE' };
  oldPlayer.ownerFutureField = 'SECRET_OWNER_FUTURE';
  oldPlayer.activeAssignment = { factionId:'mori', card:legacyMoriCard, issuedRound:3 };
  oldPlayer.replacedAssignmentConditions = ['old-paid-condition'];
  legacyRoom.pendingAssignmentChoice = { id:'old-paid-assignment-choice', playerId:oldPlayer.id, factionId:'mori' };
  const logSecrets=['SECRET_CHARACTER_LOG','SECRET_ASSIGNMENT_LOG','SECRET_EXPEDITION_LOG','SECRET_HIDDEN_CARD_LOG'];
  legacyRoom.log.push(...logSecrets.map(text=>({t:Date.now(),text})));
  fs.writeFileSync(file,JSON.stringify(savedDatabase));
  beforeRestart = structuredClone(legacyRoom);
  await start();
  assert.match(output, /Restored 1 unfinished rooms/);
  const health = (await api('/health')).data;
  assert.equal(health.databaseReady, true); assert.equal(health.roomPersistence.restored, 1);
  const newDevice = await connect(); const restoredWatcher = await connect();
  const restored = await emit(restoredWatcher, 'adminWatchRoom', { code, accountToken: admin.token });
  for(const secret of logSecrets) assert.equal(restored.room.log.some(entry=>entry.text===secret),true);
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
  const ownerDelivery=once(newDevice,'roomState');
  const resumed = await emit(newDevice, 'resumeRoom', { code, accountToken: a.token });
  assert.equal(resumed.ok, true); assert.equal(resumed.playerId, created.playerId);
  const [ownerState]=await ownerDelivery;
  const secondDevice=await connect();
  const secondDelivery=once(secondDevice,'roomState');
  assert.equal((await emit(secondDevice,'resumeRoom',{code,accountToken:b.token})).ok,true);
  const [secondState]=await secondDelivery;
  const ownerContract=ownerState.players.find(p=>p.id===created.playerId);
  assert.equal(ownerContract.isYou,true);
  assert.equal(ownerContract.character.id,'cartographer');
  assert.equal(ownerContract.character.effect.type,'peek-sea-deck');
  assert.equal(ownerContract.character.effect.range,4);
  assert.deepEqual(ownerContract.nextTurnEffects,{moveBonus:1});
  assert.equal(ownerContract.activeAssignment.factionId,'mori');
  assert.equal(ownerContract.activeAssignment.progress.kind,'mori-service');
  assert.ok(Array.isArray(ownerContract.characterReplacementOptions));
  assert.ok(Array.isArray(ownerContract.cartographerAnchorOptions));
  assert.ok(Object.hasOwn(ownerContract,'canTakeExpedition'));
  assert.ok(Object.hasOwn(ownerContract,'attackedPlayerIdsThisRound'));
  assert.ok(Object.hasOwn(ownerContract,'palaceUsed'));
  assert.equal(Object.hasOwn(ownerContract,'ownerFutureField'),false);
  const opponentContract=secondState.players.find(p=>p.id===created.playerId);
  for(const key of ['character','activeAssignment','hasActiveAssignment','nextTurnEffects','characterReplacementOptions']) assert.equal(Object.hasOwn(opponentContract,key),false,key);
  for(const view of [ownerState,secondState]) for(const secret of ['SECRET_NEXT_TURN_SOURCE','SECRET_OWNER_FUTURE']) assert.equal(JSON.stringify(view).includes(secret),false);
  for(const view of [ownerState,secondState]) {
    assert.equal(Object.hasOwn(view,'log'),false);
    for(const secret of logSecrets) assert.equal(JSON.stringify(view).includes(secret),false);
  }
  const afterRestart = rows()[0].state;
  assertCurrentPersistedShape(afterRestart);
  assert.equal(Object.hasOwn(afterRestart,'log'),true);
  for(const secret of logSecrets) assert.equal(afterRestart.log.some(entry=>entry.text===secret),true);
  const afterOldPlayer = afterRestart.players.find(p => p.id === created.playerId);
  const restartPendingFeudKey = `${restartPendingFeudCard.masterCardId || restartPendingFeudCard.id}:${restartPendingFeudCard.copy ?? 'legacy'}`;
  const restoredPendingFeud = pendingResolutionToLegacy(getPendingResolution(afterRestart, 'feud'));
  assert.equal(restoredPendingFeud.id, 'restart-pending-feud');
  assert.equal(restoredPendingFeud.feudCard.id, restartPendingFeudCard.id);
  const restoredPoliticalSource = afterRestart.randomSourceState.politicalEffect.kadingir;
  assert.equal(restoredPoliticalSource.available.length, 9);
  assert.equal(restoredPoliticalSource.recyclable.length, 0);
  assert.equal(restoredPoliticalSource.reserved.length, 1);
  assert.equal(
    restoredPoliticalSource.available[0]
      ? `${restoredPoliticalSource.available[0].masterCardId || restoredPoliticalSource.available[0].id}:${restoredPoliticalSource.available[0].copy ?? 'legacy'}`
      : null,
    restartNextFeudKey
  );
  assert.equal(restoredPoliticalSource.available.some(card =>
    `${card.masterCardId || card.id}:${card.copy ?? 'legacy'}` === restartPendingFeudKey
  ), false);
  assert.equal(restoredPoliticalSource.reserved.some(card =>
    `${card.masterCardId || card.id}:${card.copy ?? 'legacy'}` === restartPendingFeudKey
  ), true);
  const restoredAssignmentPool = afterRestart.randomSourceState.assignmentPool;
  assert.deepEqual(Object.keys(restoredAssignmentPool), ['lionia','kadingir','suniksiya','pirates','mori']);
  assert.equal(restoredAssignmentPool.mori.available.length, 9); // активная карта не возвращается в восстановленный pool
  assert.equal(restoredAssignmentPool.mori.reserved.length, 1);
  assert.equal(restoredAssignmentPool.mori.reserved[0].id, legacyMoriCard.id);
  assert.deepEqual(restoredAssignmentPool.lionia.permanentlyExcluded, []);
  assert.equal(getPendingResolution(afterRestart, 'assignment-choice'), null);
  assert.equal(Object.hasOwn(afterOldPlayer,'replacedAssignmentConditions'), false);
  assert.equal(Object.hasOwn(afterOldPlayer, 'activeAssignment'), false);
  assert.match(afterOldPlayer.activeAssignmentTask.instanceId, /^legacy:/);
  assert.equal(afterOldPlayer.activeAssignmentTask.definitionId, legacyMoriCard.id);
  assert.equal(afterOldPlayer.activeAssignmentTask.factionId, 'mori');
  assert.equal(afterOldPlayer.activeAssignmentTask.progress.kind, 'mori-service');
  assert.equal(afterOldPlayer.activeAssignmentTask.progress.departureRequired, true);
  assert.equal(afterOldPlayer.activeAssignmentTask.progress.departureSatisfied, false);
  const stripAssignmentMigration = value => {
    const copy = structuredClone(value);
    if (copy.randomSourceState) delete copy.randomSourceState.assignmentPool;
    delete copy.assignmentDecks; delete copy.pendingAssignmentChoice;
    if (copy.pendingResolutions) copy.pendingResolutions['assignment-choice'] = null;
    for (const player of copy.players) { delete player.activeAssignment; delete player.activeAssignmentTask; delete player.replacedAssignmentConditions; }
    return copy;
  };
  assert.deepEqual(stripAssignmentMigration(afterRestart), stripAssignmentMigration(migrateRoomState(beforeRestart).state));
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


test('Scout reveal lifecycle survives reconnect, device replacement and same-turn restart but expires after the personal turn', { timeout: 45000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pervo-scout-lifecycle-'));
  const file = path.join(dir, 'database.json');
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = 'http://127.0.0.1:' + port;
  let child;
  let output = '';
  const sockets = [];

  async function start() {
    output = '';
    child = spawn(process.execPath, ['--require', './test/fixtures/postgres.cjs', 'server.js'], {
      cwd: path.join(__dirname, '..'), windowsHide: true,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATABASE_URL: 'postgres://test', AUTH_SECRET: 'scout-lifecycle-secret', TEST_DB_FILE: file },
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  }
  const database = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = () => database().game_rooms;
  const writeDatabase = value => fs.writeFileSync(file, JSON.stringify(value));

  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    if (child?.exitCode === null) await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await start();
  const accounts = [];
  for (let i = 1; i <= 4; i++) {
    const account = await api('/api/auth/register', { username: 'scoutlife' + i, password: 'password' + i });
    assert.equal(account.ok, true);
    accounts.push(account);
  }

  const initialSockets = await Promise.all(accounts.map(() => connect()));
  const created = await emit(initialSockets[0], 'createRoom', { accountToken: accounts[0].token, name: 'Scout One' });
  const joined = [];
  for (let i = 1; i < 4; i++) {
    joined.push(await emit(initialSockets[i], 'joinRoom', { code: created.code, accountToken: accounts[i].token, name: 'Scout ' + (i + 1) }));
  }
  const members = [
    { playerId: created.playerId, account: accounts[0], socket: initialSockets[0] },
    ...joined.map((entry, index) => ({ playerId: entry.playerId, account: accounts[index + 1], socket: initialSockets[index + 1] })),
  ];

  assert.equal((await emit(initialSockets[0], 'setSeatingOrder', { playerIds: members.map(member => member.playerId) })).ok, true);
  assert.equal((await emit(initialSockets[0], 'setLeader', { playerId: members[0].playerId })).ok, true);
  for (const member of members) assert.equal((await emit(member.socket, 'setReady', { ready: true })).ok, true);
  assert.equal((await emit(initialSockets[0], 'startGame')).ok, true);
  await new Promise(resolve => setTimeout(resolve, 50));

  await stop();
  let savedDatabase = database();
  let savedRoom = savedDatabase.game_rooms[0].state;
  const activeId = savedRoom.order[savedRoom.turnIndex];
  const activeMember = members.find(member => member.playerId === activeId);
  const targetMember = members.find(member => member.playerId !== activeId);
  const observerMember = members.find(member => member.playerId !== activeId && member.playerId !== targetMember.playerId);
  const activePlayer = savedRoom.players.find(player => player.id === activeId);
  const targetPlayer = savedRoom.players.find(player => player.id === targetMember.playerId);
  const observerPlayer = savedRoom.players.find(player => player.id === observerMember.playerId);
  assert.ok(activeMember && targetMember && observerMember && activePlayer && targetPlayer && observerPlayer);
  const scoutTurnNo = activePlayer.personalTurnNo;
  assert.ok(scoutTurnNo > 0);

  savedRoom.phase = 'actions';
  savedRoom.actionsLeft = 2;
  activePlayer.character = 'scout';
  activePlayer.row = 10; activePlayer.col = 10;
  targetPlayer.row = 10; targetPlayer.col = 14;
  targetPlayer.debt = 4321;
  savedRoom.scoutRevealGrants = [];
  writeDatabase(savedDatabase);

  await start();
  const activeSocket = await connect();
  const targetSocket = await connect();
  const observerSocket = await connect();
  let delivery = once(activeSocket, 'roomState');
  assert.equal((await emit(activeSocket, 'resumeRoom', { code: created.code, accountToken: activeMember.account.token })).ok, true);
  await delivery;
  assert.equal((await emit(targetSocket, 'resumeRoom', { code: created.code, accountToken: targetMember.account.token })).ok, true);
  assert.equal((await emit(observerSocket, 'resumeRoom', { code: created.code, accountToken: observerMember.account.token })).ok, true);

  const activeRevealDelivery = once(activeSocket, 'roomState');
  const observerRevealDelivery = once(observerSocket, 'roomState');
  const used = await emit(activeSocket, 'useScout', { mode: 'money', targetPlayerId: targetMember.playerId, debt: true, ducats: 999 });
  assert.equal(used.ok, true);
  const [activeReveal] = await activeRevealDelivery;
  const [observerReveal] = await observerRevealDelivery;
  const activeTarget = activeReveal.players.find(player => player.id === targetMember.playerId);
  const observerTarget = observerReveal.players.find(player => player.id === targetMember.playerId);
  assert.equal(activeTarget.ducats, rows()[0].state.players.find(player => player.id === targetMember.playerId).ducats);
  assert.equal(Object.hasOwn(activeTarget, 'debt'), false);
  assert.equal(Object.hasOwn(observerTarget, 'ducats'), false);
  assert.equal(Object.hasOwn(activeReveal, 'scoutRevealGrants'), false);
  let persistedGrant = rows()[0].state.scoutRevealGrants;
  assert.deepEqual(persistedGrant, [
    { viewerPlayerId: activeId, mode: 'money', targetPlayerId: targetMember.playerId, personalTurnNo: scoutTurnNo },
  ]);
  assert.equal(Object.hasOwn(persistedGrant[0], 'socketId'), false);
  assert.equal(Object.hasOwn(persistedGrant[0], 'ducats'), false);
  assert.equal(Object.hasOwn(persistedGrant[0], 'debt'), false);

  activeSocket.disconnect();
  await new Promise(resolve => setTimeout(resolve, 100));
  persistedGrant = rows()[0].state.scoutRevealGrants;
  assert.deepEqual(persistedGrant, [
    { viewerPlayerId: activeId, mode: 'money', targetPlayerId: targetMember.playerId, personalTurnNo: scoutTurnNo },
  ]);

  const reconnected = await connect();
  const reconnectDelivery = once(reconnected, 'roomState');
  const observerReconnectDelivery = once(observerSocket, 'roomState');
  assert.equal((await emit(reconnected, 'resumeRoom', { code: created.code, accountToken: activeMember.account.token })).ok, true);
  const [reconnectState] = await reconnectDelivery;
  const [observerReconnectState] = await observerReconnectDelivery;
  assert.equal(reconnectState.players.find(player => player.id === targetMember.playerId).ducats, targetPlayer.ducats);
  assert.equal(Object.hasOwn(reconnectState.players.find(player => player.id === targetMember.playerId), 'debt'), false);
  assert.equal(Object.hasOwn(observerReconnectState.players.find(player => player.id === targetMember.playerId), 'ducats'), false);
  assert.equal(rows()[0].state.players.find(player => player.id === activeId).personalTurnNo, scoutTurnNo);

  const replacement = await connect();
  const removed = once(reconnected, 'removedFromRoom');
  const replacementDelivery = once(replacement, 'roomState');
  assert.equal((await emit(replacement, 'resumeRoom', { code: created.code, accountToken: activeMember.account.token })).ok, true);
  const [removedPayload] = await removed;
  const [replacementState] = await replacementDelivery;
  assert.equal(removedPayload.reason, 'Игра открыта на другом устройстве.');
  assert.equal(replacementState.players.find(player => player.id === targetMember.playerId).ducats, targetPlayer.ducats);
  assert.equal(rows()[0].state.scoutRevealGrants.length, 1);

  let detachedDeliveries = 0;
  reconnected.on('roomState', () => { detachedDeliveries += 1; });
  const observerAfterReplacement = once(observerSocket, 'roomState');
  assert.equal((await emit(targetSocket, 'goHome')).ok, true);
  const [observerAfterReplacementState] = await observerAfterReplacement;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(detachedDeliveries, 0);
  assert.equal(Object.hasOwn(observerAfterReplacementState.players.find(player => player.id === targetMember.playerId), 'ducats'), false);

  await stop();
  savedDatabase = database();
  savedRoom = savedDatabase.game_rooms[0].state;
  const savedActive = savedRoom.players.find(player => player.id === activeId);
  const savedTarget = savedRoom.players.find(player => player.id === targetMember.playerId);
  const savedObserver = savedRoom.players.find(player => player.id === observerMember.playerId);
  savedTarget.ducats = 777;
  savedTarget.debt = 888;
  const validIslandId = savedRoom.islands[0].id;
  savedRoom.scoutRevealGrants = [
    { viewerPlayerId: 'unknown-viewer', mode: 'money', targetPlayerId: targetMember.playerId, personalTurnNo: scoutTurnNo },
    { viewerPlayerId: activeId, mode: 'money', targetPlayerId: targetMember.playerId, personalTurnNo: scoutTurnNo - 1 },
    { viewerPlayerId: activeId, mode: 'invalid-mode', targetPlayerId: targetMember.playerId, personalTurnNo: scoutTurnNo },
    { viewerPlayerId: activeId, mode: 'money', personalTurnNo: scoutTurnNo },
    { viewerPlayerId: activeId, mode: 'money', targetPlayerId: 'missing-target', personalTurnNo: scoutTurnNo },
    { viewerPlayerId: activeId, mode: 'money', targetPlayerId: activeId, personalTurnNo: scoutTurnNo },
    { viewerPlayerId: activeId, mode: 'garrison', islandId: validIslandId, personalTurnNo: scoutTurnNo },
    {
      viewerPlayerId: activeId,
      mode: 'money',
      targetPlayerId: targetMember.playerId,
      personalTurnNo: scoutTurnNo,
      ducats: 999,
      debt: true,
      garrison: { defenseArmy: 999 },
      socketId: 'forbidden',
    },
    { viewerPlayerId: observerMember.playerId, mode: 'money', targetPlayerId: targetMember.playerId, personalTurnNo: savedObserver.personalTurnNo },
  ];
  assert.equal(savedActive.personalTurnNo, scoutTurnNo);
  writeDatabase(savedDatabase);

  await start();
  persistedGrant = rows()[0].state.scoutRevealGrants;
  assert.deepEqual(persistedGrant, [
    { viewerPlayerId: activeId, mode: 'money', targetPlayerId: targetMember.playerId, personalTurnNo: scoutTurnNo },
  ]);
  const afterRestartSocket = await connect();
  const restartDelivery = once(afterRestartSocket, 'roomState');
  assert.equal((await emit(afterRestartSocket, 'resumeRoom', { code: created.code, accountToken: activeMember.account.token })).ok, true);
  const [restartState] = await restartDelivery;
  const liveTarget = restartState.players.find(player => player.id === targetMember.playerId);
  assert.equal(liveTarget.ducats, 777);
  assert.equal(Object.hasOwn(liveTarget, 'debt'), false);
  assert.equal(JSON.stringify(restartState).includes('999'), false);
  assert.equal(Object.hasOwn(restartState, 'scoutRevealGrants'), false);
  assert.equal(rows()[0].state.players.find(player => player.id === activeId).personalTurnNo, scoutTurnNo);

  assert.equal((await emit(afterRestartSocket, 'endTurn')).ok, true);
  assert.deepEqual(rows()[0].state.scoutRevealGrants, []);

  await stop();
  savedDatabase = database();
  savedRoom = savedDatabase.game_rooms[0].state;
  savedRoom.scoutRevealGrants = [{
    viewerPlayerId: activeId,
    mode: 'money',
    targetPlayerId: targetMember.playerId,
    personalTurnNo: scoutTurnNo - 1,
    ducats: 999,
  }];
  writeDatabase(savedDatabase);

  await start();
  assert.deepEqual(rows()[0].state.scoutRevealGrants, []);
  const expiredSocket = await connect();
  const expiredDelivery = once(expiredSocket, 'roomState');
  assert.equal((await emit(expiredSocket, 'resumeRoom', { code: created.code, accountToken: activeMember.account.token })).ok, true);
  const [expiredState] = await expiredDelivery;
  assert.equal(Object.hasOwn(expiredState.players.find(player => player.id === targetMember.playerId), 'ducats'), false);
  assert.equal(Object.hasOwn(expiredState, 'scoutRevealGrants'), false);
});



test('4.4 corrective: general gameplay gate reports private pending generically',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
  const match=source.match(/function pendingDecisionError\(room\) \{([\s\S]*?)\n\}/);
  assert.ok(match,'pendingDecisionError source');
  const { hasPendingResolution } = require('../domain-state');
  const evaluatePendingDecisionError=new Function('room','hasPendingResolution',match[1]);
  const pendingDecisionError=room=>evaluatePendingDecisionError(room,hasPendingResolution);
  const families=['pendingEvent','pendingFeud','pendingAssignmentChoice','pendingIslandCorrection','pendingFleetAdjustment','pendingLegendaryReaction'];
  for(const key of families) {
    const error=pendingDecisionError({[key]:{kind:'SECRET_KIND'}});
    assert.equal(error,'Ожидается обязательное решение игрока.');
    assert.doesNotMatch(error,/Покров|Посольств|поручен|легендар|событ|вражд/i);
  }
  assert.equal(pendingDecisionError({pendingBattle:{}}),'Сначала завершите текущий совместный бой.');
  assert.equal(pendingDecisionError({pendingAlliance:{}}),'Сначала завершите предложение союза.');
});
