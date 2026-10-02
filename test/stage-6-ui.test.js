const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('stage 6.7 UI exposes events, discoveries, expeditions and legendary reactions', () => {
  assert.match(index, /id="legendaryPlacesBadge"/);
  assert.match(index, /id="legendaryPlacesContent"/);
  assert.match(index, /id="legendaryPlacesActions"/);

  assert.match(app, /function renderLegendaryPlaces\(\)/);
  assert.match(app, /renderLegendaryPlaces\(\);/);
  assert.match(app, /r\.namedPlaceCards \|\| \[\]/);
  assert.match(app, /mine\.expeditionHistory \|\| \[\]/);
  assert.doesNotMatch(app, /filter\(player => player\.activeExpedition\)/);
  assert.match(app, /const activeExpedition = mine\.activeExpedition/);
  assert.match(app, /Object\.hasOwn\(p, 'ducats'\)/);
  assert.match(app, /socket\.emit\('takeExpedition'/);
  assert.match(app, /expedition-destination/);

  assert.doesNotMatch(app, /decks\.legendary/);
  assert.match(app, /цифровой случайный пул/);
  assert.match(app, /reaction\.kind === 'sea-curse'/);
  assert.match(app, /Покров отменит карту/);
  assert.match(app, /исходная I удаляется/);

  assert.match(styles, /\.named-place-grid/);
  assert.match(styles, /\.active-expedition/);
  assert.match(styles, /\.expedition-destination/);
});

test('ordinary player UI has no journal dependency or journal navigation', () => {
  assert.doesNotMatch(app, /state\.room\.log|renderLog|Журнал партии/);
  assert.doesNotMatch(index, /id="logPanel"|id="log"|data-mobile-nav="log"/);
});

// Execute existing renderers against projected data and click their actual callbacks.
// A minimal DOM suffices here: these actions create nodes, labels and click handlers.
const vm = require('node:vm');

test('4.4 corrective UI treats generic waiting as pending and has no source-counter dependency',()=>{
  assert.match(app,/state\.room\?\.pendingDecision/);
  assert.doesNotMatch(app,/eventDecks|feudDecks|assignmentDecks/);
  const start=app.indexOf('  function isDecisionPending()');
  const end=app.indexOf('\n',start);
  assert.ok(start>=0 && end>start);
  const context=vm.createContext({state:{room:{pendingDecision:{waiting:true,actorPlayerId:'p2'}}}});
  vm.runInContext(app.slice(start,end)+'\nresult=isDecisionPending();',context);
  assert.equal(context.result,true);
});

const { projectOpponentFacingRoomView } = require('../state-projection');
function uiHarness(legacy, renderer) {
  const nodes=new Map(), calls=[];
  function node(tag='div') {
    return {tag,children:[],events:{},textContent:'',disabled:false,
      set innerHTML(value) {this.html=value;this.children=[];}, get innerHTML(){return this.html || '';},
      appendChild(child){this.children.push(child);},addEventListener(event,callback){this.events[event]=callback;},
    };
  }
  const room=projectOpponentFacingRoomView(legacy,{viewerId:'p1'});
  const context=vm.createContext({
    state:{room,myId:'p1'}, ROMAN:['','I','II'], document:{createElement:node},
    $:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},
    me:()=>room.players.find(p=>p.id==='p1'), playerName:id=>id,
    escapeHtml:value=>String(value), handleGameAck:()=>{},
    isDecisionPending:()=>false, currentIslands:()=>room.islands || [],
    areAlliesClient:()=>false, socket:{emit:(event,payload)=>calls.push({event,payload})},
  });
  const start=app.indexOf(`  function ${renderer}(`), end=app.indexOf('\n  function ',start+1);
  assert.ok(start>=0 && end>start);
  vm.runInContext(app.slice(start,end)+`\n${renderer}();`,context);
  return {nodes,calls,room};
}
function uiRoom(pendingKey,pending) {
  return {started:true,round:2,activePlayerId:'p1',players:[{id:'p1',suzerainId:'mori',phase:'actions',actionsLeft:2}],islands:[],factions:[{id:'mori',name:'Mori'}],[pendingKey]:{id:'choice',playerId:'p1',...pending}};
}
function click(harness,panel,index=0) {
  const buttons=harness.nodes.get(panel).children.filter(node=>node.tag==='button');
  assert.ok(buttons[index],panel+' button exists');
  assert.equal(buttons[index].disabled,false);
  buttons[index].events.click();
  return harness.calls.length ? JSON.parse(JSON.stringify(harness.calls.at(-1))) : undefined;
}

test('4.4 projected pending choices render buttons with working command identifiers',()=>{
  let h=uiHarness(uiRoom('pendingEvent',{kind:'storm',cardName:'Storm',options:[{row:3,col:4}]}),'renderEvents');
  assert.deepEqual(click(h,'eventActions'),{event:'respondEvent',payload:{eventId:'choice',row:3,col:4}});
  h=uiHarness(uiRoom('pendingFeud',{kind:'building-choice',options:[{islandId:'port',islandName:'Port',buildingIndex:2,name:'Fort',canDowngrade:true}]}),'renderEvents');
  const feud=h.nodes.get('eventActions').children.find(n=>n.children.length).children;
  assert.equal(feud[1].disabled,false);feud[1].events.click();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))),{event:'respondFeud',payload:{feudId:'choice',islandId:'port',buildingIndex:2,mode:'downgrade'}});
  h=uiHarness(uiRoom('pendingAssignmentChoice',{kind:'embassy',factionId:'mori',options:[{id:'task',text:'Visit Port',reward:12,type:'visit-island'}]}),'renderAssignments');
  assert.deepEqual(click(h,'assignmentActions'),{event:'respondAssignmentChoice',payload:{choiceId:'choice',assignmentId:'task'}});
  h=uiHarness(uiRoom('pendingIslandCorrection',{kind:'constraints',islandName:'Port',report:{status:'city',usedArea:6,effectiveArea:4,overArea:2,branchViolations:[{name:'Trade',count:2,limit:1}]},options:[{buildingIndex:1,name:'Farm',area:2,branchName:'Trade'}]}),'renderIslandCorrection');
  assert.match(h.nodes.get('islandCorrectionContent').innerHTML,/6\/4/);
  assert.match(h.nodes.get('islandCorrectionContent').innerHTML,/Trade: 2\/1/);
  assert.deepEqual(click(h,'islandCorrectionActions'),{event:'resolveIslandCorrection',payload:{correctionId:'choice',buildingIndex:1}});
  h=uiHarness(uiRoom('pendingFleetAdjustment',{stage:'escorts',required:1,options:[{id:'escort',name:'Merchant',cargoCapacity:3,hasCargo:true,cargoText:'Tea ×2'}]}),'renderFleetAdjustment');
  assert.match(h.nodes.get('fleetAdjustmentActions').children[0].textContent,/Tea ×2/);
  click(h,'fleetAdjustmentActions',0);
  assert.deepEqual(click(h,'fleetAdjustmentActions',1),{event:'resolveFleetAdjustment',payload:{adjustmentId:'choice',ids:['escort']}});
  h=uiHarness(uiRoom('pendingLegendaryReaction',{targetPlayerId:'p1',sourcePlayerId:'p2',kind:'sea-curse',veilOptions:[{source:'legendary',index:0,id:'sea-veil'}]}),'renderLegendary');
  assert.deepEqual(click(h,'legendaryActions'),{event:'respondLegendaryReaction',payload:{reactionId:'choice',useVeil:true,source:'legendary',index:0}});
});

test('4.4 character options, abilities and expedition eligibility survive owner cutover',()=>{
  const base={started:true,round:2,activePlayerId:'p1',players:[{id:'p1',name:'Alice',level:1,phase:'actions',actionsLeft:2,atCitadel:false,characterAcquisitionOptions:[{id:'navigator',name:'Navigator',admiraltyLevel:1,effect:{type:'reroll-navigation'}}]}],islands:[]};
  let h=uiHarness(base,'renderFleet');
  const fleetPanel=[...h.nodes.keys()].find(key=>key==='fleetActions');
  assert.deepEqual(click(h,fleetPanel),{event:'takeCharacter',payload:{characterId:'navigator'}});
  base.players[0].character={id:'cartographer',name:'Cartographer',effect:{type:'peek-sea-deck',range:4}};
  base.players[0].characterAcquisitionOptions=[];
  base.players[0].characterReplacementOptions=[{id:'navigator',name:'Navigator',admiraltyLevel:1}];
  base.players[0].cartographerAnchorOptions=[{id:'red',color:'red',name:'Red',distance:2}];
  base.players[0].phase='navigation';base.players[0].roll=null;
  h=uiHarness(base,'renderFleet');
  assert.deepEqual(click(h,'fleetActions'),{event:'useCartographer',payload:{color:'red'}});
  base.players[0].phase='actions';h=uiHarness(base,'renderFleet');
  assert.deepEqual(click(h,'fleetActions',1),{event:'replaceCharacter',payload:{characterId:'navigator'}});
  base.players[0].canTakeExpedition=true;
  base.players[0].activeExpedition={cardId:'exp',name:'Voyage',placeId:'place',acceptedRound:2,requiresLeaveAndReturn:true};
  h=uiHarness(base,'renderLegendaryPlaces');
  assert.match(h.nodes.get('legendaryPlacesContent').innerHTML,/Voyage/);
  assert.match(h.nodes.get('legendaryPlacesContent').innerHTML,/Сначала покиньте место/);
  assert.deepEqual(click(h,'legendaryPlacesActions'),{event:'takeExpedition',payload:{}});
});


test('4.5 Scout UI offers only public-coordinate targets and emits one scoped mode/target',()=>{
  const base={
    started:true,round:2,activePlayerId:'p1',
    players:[
      {id:'p1',name:'Alice',row:10,col:10,level:1,phase:'actions',actionsLeft:2,atCitadel:false,character:{id:'scout',name:'Scout',effect:{type:'inspect-hidden-cards',range:4,distance:'manhattan',modes:['garrison','money'],revealCount:1,duration:'current-personal-turn'}}},
      {id:'p2',name:'Bob',row:10,col:14,level:1,ducats:'SECRET_SCOUT_DUCATS'},
      {id:'p3',name:'Carol',row:10,col:15,level:1,ducats:'SECRET_SECOND_DUCATS'},
    ],
    islands:[
      {id:'i1',name:'Near',ownerId:'p2',cells:[[10,14]],resources:[],buildings:[],area:4,army:1,usedArea:0,effectiveArea:4,status:'Поселение',garrisonName:'SECRET_SCOUT_GARRISON'},
      {id:'i2',name:'Far',ownerId:'p3',cells:[[10,15]],resources:[],buildings:[],area:4,army:1,usedArea:0,effectiveArea:4,status:'Поселение',garrisonName:'SECRET_SECOND_GARRISON'},
    ],
  };
  const h=uiHarness(base,'renderFleet');
  const buttons=h.nodes.get('fleetActions').children.filter(node=>node.tag==='button');
  const garrison=buttons.find(button=>/Гарнизон: Near/.test(button.textContent));
  const money=buttons.find(button=>/Деньги: Bob/.test(button.textContent));
  assert.ok(garrison);assert.ok(money);
  assert.equal(buttons.some(button=>/Far|Carol/.test(button.textContent)),false);
  garrison.events.click();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))),{event:'useScout',payload:{mode:'garrison',islandId:'i1'}});
  money.events.click();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))),{event:'useScout',payload:{mode:'money',targetPlayerId:'p2'}});
  assert.match(app,/Object\.hasOwn\(p, 'ducats'\)/);
  assert.match(app,/Object\.hasOwn\(island, 'defenseArmy'\)/);
  assert.doesNotMatch(app,/Разведчик сохранён на корабле, но просмотр закрытых карт не включён/);
});


test('7.7 end-game UI covers proposal, consensus, finished results and reconnect rendering', () => {
  assert.match(index, /id="endGamePanel"/);
  assert.match(index, /id="endGamePanel"[^>]*data-ui-tab="players"/);
  const sideStart = index.indexOf('id="gameSidePanel"');
  const endGameIndex = index.indexOf('id="endGamePanel"');
  const sideEnd = index.indexOf('</aside>', sideStart);
  assert.ok(sideStart >= 0 && endGameIndex > sideStart && endGameIndex < sideEnd, 'end-game consensus panel lives inside the Players side tab');
  assert.match(index, /id="finalResultsPanel"/);
  assert.match(app, /function renderEndGame\(\)/);
  assert.match(app, /proposeEndGame/);
  assert.match(app, /confirmEndGame/);
  assert.match(app, /rejectEndGame/);
  assert.match(app, /Предложить завершение партии/);
  assert.match(app, /Предложено завершить партию/);
  assert.match(app, /Партия завершится после окончания раунда \$\{consensus\.finishAfterRound\}/);
  assert.match(app, /confirmed\.has\(String\(player\.id\)\)/);
  assert.match(app, /if \(!state\.spectating && !mineConfirmed\)/);
  assert.match(app, /if \(r\.finished \|\| r\.phase === 'finished'\) return/);
  assert.match(app, /const finished = Boolean\(r\?\.finished \|\| r\?\.phase === 'finished'\)/);
  assert.match(app, /\(title\.winnerIds \|\| \[\]\)\.map\(playerName\)\.join\(', '\)/);
  assert.match(app, /\['islands', 'Владения'\]/);
  assert.match(app, /\['wealth', 'Казна'\]/);
  assert.match(app, /\['army', 'Армия'\]/);
  assert.match(app, /\['fleet', 'Флот'\]/);
  assert.match(app, /\['prestige', 'Престиж'\]/);
  assert.match(app, /\['legendaryPlaces', 'Легендарные места'\]/);
  assert.doesNotMatch(index, /Общий победитель|1 место|2 место|3 место|victory points/i);
  assert.match(styles, /\.game\.finished-state > \.layout/);
  assert.match(styles, /\.final-title-grid, \.final-player-grid \{ grid-template-columns: 1fr; \}/);
});

test('7.7 finished finalResult renderer keeps six canonical titles and shared holders', () => {
  const start = app.indexOf('  function renderEndGame()');
  const end = app.indexOf('\n  function render()', start);
  assert.ok(start >= 0 && end > start);
  const nodes = new Map();
  function node(tag = 'div') {
    return {
      tag, children: [], className: '', textContent: '', events: {}, classList: { toggle(){}, add(){}, remove(){} },
      set innerHTML(value) { this.html = value; this.children = []; }, get innerHTML() { return this.html || ''; },
      appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); },
      addEventListener(event, callback) { this.events[event] = callback; },
    };
  }
  const room = {
    started: true, finished: true, phase: 'finished', finalResult: {
      finishedRound: 4,
      titles: [
        { id:'islands', name:'Мастер владений', metric:'islands', maxValue:5, winnerIds:['p1','p2'] },
        { id:'wealth', name:'Мастер казны', metric:'wealth', maxValue:40, winnerIds:['p2'] },
        { id:'army', name:'Мастер армии', metric:'army', maxValue:8, winnerIds:['p1'] },
        { id:'fleet', name:'Мастер флота', metric:'fleet', maxValue:11, winnerIds:['p2'] },
        { id:'prestige', name:'Мастер престижа', metric:'prestige', maxValue:7, winnerIds:['p1'] },
        { id:'legendary', name:'Мастер легендарных мест', metric:'legendaryPlaces', maxValue:3, winnerIds:[] },
      ],
      playerMetrics: [
        { playerId:'p1', metrics:{ islands:5, wealth:30, army:8, fleet:9, prestige:7, legendaryPlaces:3 } },
        { playerId:'p2', metrics:{ islands:5, wealth:40, army:6, fleet:11, prestige:5, legendaryPlaces:2 } },
      ],
    },
    players:[{id:'p1',name:'Анна'},{id:'p2',name:'Борис'}],
  };
  const context = vm.createContext({
    state:{room,myId:'p1',spectating:false},
    document:{createElement:node},
    $:id=>{ if(!nodes.has(id)) nodes.set(id,node()); return nodes.get(id); },
    playerName:id=>room.players.find(p=>p.id===id)?.name || 'Игрок',
    escapeHtml:value=>String(value),
    socket:{emit(){}}, setError(){},
  });
  vm.runInContext(app.slice(start,end) + '\nrenderEndGame();', context);
  assert.equal(nodes.get('finalTitles').children.length, 6);
  assert.match(nodes.get('finalTitles').children[0].innerHTML, /Анна, Борис/);
  assert.match(nodes.get('finalTitles').children[5].innerHTML, /Нет обладателя/);
  assert.equal(nodes.get('finalPlayerMetrics').children.length, 2);
  assert.equal(nodes.get('finalPlayerMetrics').children[0].children[1].children.length, 12);
});


test('UI-4 mobile shell makes the map the permanent gameplay surface without deleting legacy controls', () => {
  assert.match(index, /id="gameWorldShell" class="layout game-world-shell"/);
  assert.match(index, /id="mapViewport" class="map-viewport"/);
  assert.match(index, /id="gameSidePanel"/);
  assert.match(index, /id="mobileGameNav"/);

  assert.match(styles, /UI-4 — mobile-first fullscreen map shell/);
  assert.match(styles, /body\.game-active \.game-world-shell \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/);
  assert.match(styles, /body\.game-active \.game-world-shell \.map-viewport \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;[\s\S]*?height: 100%;/);
  assert.match(styles, /body\.game-active \.game-hud \{[\s\S]*?position: absolute;[\s\S]*?z-index: 50;/);
  assert.match(styles, /body\.game-active \.game-world-shell \.map-toolbar \{[\s\S]*?position: absolute;[\s\S]*?z-index: 46;/);
  assert.match(styles, /body\.game-active \.finished-state \.game-world-shell \{\s*display: none;/);

  // UI-4 is shell-only: no mechanic panel or command path is removed yet.
  for (const id of ['eventContent','politicsContent','fleetContent','anchorContent','islandContent','combatContent','playersPanel','endGamePanel']) {
    assert.match(index, new RegExp('id="' + id + '"'), id + ' remains available during migration');
  }
});


test('UI-5 HUD separates live combat stats from scoring metrics and exposes phase navigation', () => {
  assert.doesNotMatch(index, /id="hudArmyPointsBtn"|id="hudFleetPointsBtn"|id="hudDebtBtn"/);
  assert.match(index, /id="hudArmyBtn"[^>]*aria-label="Войско"/);
  assert.match(index, /id="hudArtilleryBtn"[^>]*aria-label="Артиллерия"/);
  assert.match(index, /id="hudCargoBtn"/);
  assert.match(index, /id="hudPhase"/);
  assert.match(index, /id="hudMenuBtn"/);

  const start = app.indexOf('  function hudPhaseLabel(');
  const end = app.indexOf('\n\n  function updateContextualActionPanels()', start);
  assert.ok(start >= 0 && end > start);
  const hudCode = app.slice(start, end);
  assert.match(hudCode, /mine\.assaultArmy \?\? mine\.stats\?\.army/);
  assert.match(hudCode, /mine\.fleetArtillery \?\? mine\.stats\?\.artillery/);
  assert.doesNotMatch(hudCode, /mine\.armyPoints|mine\.fleetPoints|mine\.debt/);
  assert.match(hudCode, /НАВИГАЦИЯ/);
  assert.match(hudCode, /ДЕЙСТВИЯ/);
  assert.match(hudCode, /СОБЫТИЯ/);

  assert.match(app, /\$\('hudPlayerBtn'\)\.addEventListener\('click',[\s\S]*?openMobileTab\('ship'\)/);
  assert.match(app, /\$\('hudCargoBtn'\)\.addEventListener\('click',[\s\S]*?openMobileTab\('ship'\)/);
  assert.match(app, /\$\('hudMenuBtn'\)\.addEventListener\('click', \(\) => toggleGameAccountMenu\(\)\)/);
  assert.match(styles, /UI-5 — canonical mobile gameplay HUD/);
});


test('UI-6 provides one state-driven mobile action bar over the map', () => {
  assert.match(index, /id="gameActionBar" class="game-action-bar hidden"/);
  assert.match(index, /id="gameActionKicker"/);
  assert.match(index, /id="gameActionTitle"/);
  assert.match(index, /id="gameActionDetail"/);
  assert.match(index, /id="gameActionProgress"/);
  assert.match(index, /id="gameActionButtons"/);

  const start = app.indexOf('  function actionBarDecisionLabel(');
  const end = app.indexOf('\n  function renderControls()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /socket\.emit\('rollMove'/);
  assert.match(code, /socket\.emit\('skipNavigation'/);
  assert.match(code, /socket\.emit\('endTurn'/);
  assert.match(code, /r\.reachableCells/);
  assert.match(code, /mine\.actionsLeft/);
  assert.match(code, /eventStageLabel/);
  assert.match(code, /pendingDecision\?\.waiting/);
  assert.match(code, /Открыть решение/);
  assert.match(code, /Событие → Вражда → Поручение/);

  assert.match(app, /renderControls\(\);\s*renderGameActionBar\(\);\s*renderMapNavigation\(\);/);
  assert.match(styles, /UI-6 — state-driven mobile action bar/);
  assert.match(styles, /body\.game-active \.mobile-action-dock,[\s\S]*?body\.game-active \.map-nav-overlay \{\s*display: none !important;/);

  // Legacy mechanic panels are intentionally retained as fallback until their dedicated migrations.
  assert.match(index, /class="panel controls" data-ui-tab="actions"/);
  assert.match(index, /id="mobileActionDock"/);
});


test('UI-7 unifies authoritative pending choices in one mobile Decision Layer', () => {
  assert.match(index, /id="decisionLayer" class="decision-layer hidden"/);
  assert.match(index, /aria-modal="true"/);
  assert.match(index, /id="decisionTitle"/);
  assert.match(index, /id="decisionBody"/);
  assert.match(index, /id="decisionActions"/);

  const start = app.indexOf('  function mobileDecisionDescriptor(');
  const end = app.indexOf('\n  function renderControls()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  for (const key of [
    'pendingEvent','pendingFeud','pendingAssignmentChoice','pendingIslandCorrection',
    'pendingFleetAdjustment','pendingLegendaryReaction','pendingBattle','pendingAlliance','pendingDecision'
  ]) assert.match(code, new RegExp(key));

  // UI-7 deliberately reuses the already-tested legacy action callbacks rather than
  // duplicating socket payload construction in a second UI rules path.
  assert.match(code, /while \(sourceActions\.firstChild\) actions\.appendChild\(sourceActions\.firstChild\);/);
  assert.match(code, /room\.pendingEvent\?\.viewerCanRespond/);
  assert.match(code, /room\.pendingFeud\?\.viewerCanRespond/);
  assert.match(code, /room\.pendingAssignmentChoice\?\.viewerCanRespond/);
  assert.match(code, /room\.pendingIslandCorrection\?\.viewerCanRespond/);
  assert.match(code, /room\.pendingFleetAdjustment\?\.viewerCanRespond/);
  assert.match(code, /room\.pendingLegendaryReaction\?\.viewerCanRespond/);
  assert.match(code, /room\.pendingBattle\?\.viewerInvite/);
  assert.match(code, /room\.pendingAlliance\?\.viewerRole === 'recipient'/);
  assert.match(code, /room\.pendingDecision\?\.waiting/);

  assert.match(app, /renderCombat\(\);\s*refreshOpenSeaBattleFlow\(\);\s*refreshOpenAssaultFlow\(\);\s*renderDecisionLayer\(\);\s*renderResultLayer\(\);\s*renderToastStack\(\);\s*renderTargetingBar\(\);\s*renderMap\(\);/);
  assert.match(styles, /UI-7 — unified mandatory Decision Layer/);
  assert.match(styles, /body\.game-active \.decision-backdrop[\s\S]*?pointer-events: auto/);
  assert.doesNotMatch(index, /id="decisionClose"/);
});


test('UI-8 adds queued Result Cards without turning client diffs into game authority', () => {
  assert.match(index, /id="resultLayer" class="result-layer hidden"/);
  assert.match(index, /id="resultContinueBtn"/);
  assert.match(index, /id="toastStack"/);

  const start = app.indexOf('  function enqueueResultCard(');
  const end = app.indexOf('\n  function mobileDecisionDescriptor(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /state\.resultQueue\.push/);
  assert.match(code, /state\.resultQueue\.length > 5/);
  assert.match(code, /const decision = mobileDecisionDescriptor\(state\.room\)/);
  assert.match(code, /anchorResultCard/);
  assert.match(code, /seaBattleResultCard/);
  assert.match(code, /assaultResultCard/);
  assert.doesNotMatch(code, /previousRoom|diffRoom|inferEventResult/);

  assert.match(app, /fightAnchor', \{\}, handleAnchorResultAck/);
  assert.match(app, /handleSeaBattleResultAck\(res, target\.name\)/);
  assert.match(app, /handleAssaultResultAck\(res, island\.name\)/);
  assert.match(app, /kicker: 'КАРТОГРАФ'/);
  assert.match(app, /Разведан гарнизон:/);
  assert.match(app, /Разведана казна:/);

  // Decision Layer must remain above any queued result.
  assert.match(styles, /body\.game-active\.decision-layer-open \.result-layer \{\s*display: none !important;/);
  assert.match(styles, /UI-8 — result cards and lightweight feedback/);
});

test('UI-8 result acknowledgement is presentation-only', () => {
  const start = app.indexOf('  function dismissResultCard()');
  const end = app.indexOf('\n\n  function renderResultLayer()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /state\.activeResult = null/);
  assert.doesNotMatch(code, /socket\.emit/);
  assert.match(app, /\$\('resultContinueBtn'\)\.addEventListener\('click', dismissResultCard\)/);
});


test('UI-9 replaces the mobile map info popup with one reusable object bottom sheet', () => {
  assert.match(index, /id="objectSheet" class="object-sheet hidden"/);
  assert.match(index, /id="objectSheetKind"/);
  assert.match(index, /id="objectSheetTitle"/);
  assert.match(index, /id="objectSheetBody"/);
  assert.match(index, /id="objectSheetActions"/);
  assert.match(index, /id="objectSheetExpand"/);
  assert.match(index, /id="objectSheetClose"/);

  const start = app.indexOf('  function mapObjectKindLabel(');
  const end = app.indexOf('\n  function showMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /renderObjectSheetFromMapInfo/);
  assert.match(code, /toggleObjectSheetExpanded/);
  assert.match(code, /showPlayerMapInfo/);
  assert.match(code, /mapInfoMeta/);
  assert.match(code, /legacyAction\.onclick/);

  const showStart = app.indexOf('  function showMapInfo(');
  const showEnd = app.indexOf('\n  function ', showStart + 1);
  const showCode = app.slice(showStart, showEnd);
  assert.match(showCode, /matchMedia\('\(max-width: 900px\)'\)/);
  assert.match(showCode, /renderObjectSheetFromMapInfo\(kind, data\)/);
  assert.match(showCode, /positionMapInfoAt\(resolvedAnchor\.row, resolvedAnchor\.col\)/);

  assert.match(app, /document\.createElement\('button'\);[\s\S]*?showPlayerMapInfo\(p\)/);
  assert.match(app, /\$\('objectSheetClose'\)\.addEventListener\('click', closeMapInfo\)/);
  assert.match(app, /\$\('objectSheetExpand'\)\.addEventListener\('click', toggleObjectSheetExpanded\)/);
  assert.match(styles, /UI-9 — reusable map object bottom sheet/);
  assert.match(styles, /body\.game-active \.map-info-card \{\s*display: none !important;/);
  assert.match(styles, /body\.game-active \.object-sheet\.expanded/);
});

test('UI-9 mandatory decisions close voluntary object selection', () => {
  const start = app.indexOf('  function renderDecisionLayer()');
  const end = app.indexOf('\n  function renderControls()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /if \(descriptor && state\.mapSelection\) closeMapInfo\(\)/);
});


test('UI-10 own islands use compact map sheet plus expanded canonical management actions', () => {
  const start = app.indexOf('  function ownIslandCompactHtml(');
  const end = app.indexOf('\n  function showPlayerMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /ownIslandCompactHtml/);
  assert.match(code, /ownIslandQuickActions/);
  assert.match(code, /renderOwnIslandObjectSheet/);
  assert.match(code, /expandOwnIslandManagement/);
  assert.match(code, /ВАШ ОСТРОВ/);
  assert.match(code, /Управлять островом/);
  assert.match(code, /Погрузить/);
  assert.match(code, /Улучшить/);
  assert.match(code, /Построить/);

  // Expanded mobile management reuses the existing canonical renderer instead
  // of rebuilding legality/cost/socket payload rules in a second path.
  assert.match(code, /renderIsland\(\);/);
  assert.match(code, /while \(sourceActions\.firstChild\) actions\.appendChild\(sourceActions\.firstChild\);/);
  assert.doesNotMatch(code, /socket\.emit\('build'/);
  assert.doesNotMatch(code, /socket\.emit\('upgradeBuilding'/);
  assert.doesNotMatch(code, /socket\.emit\('loadCargo'/);

  assert.match(code, /defenseBreakdown/);
  assert.match(code, /building\.nextUpgrade/);
  assert.match(code, /loadedRound === state\.room\.round/);
  assert.match(styles, /UI-10 — own island compact and expanded management/);
});

test('UI-10 does not remove legacy island renderer before parity cleanup', () => {
  assert.match(app, /function renderIsland\(\)/);
  assert.match(index, /id="islandContent"/);
  assert.match(index, /id="islandActions"/);
});


test('UI-11 foreign island card never derives hidden defense from public army', () => {
  const start = app.indexOf('  function foreignIslandHasPrivateReveal(');
  const end = app.indexOf('\n  function renderObjectSheetFromMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /foreignIslandCompactHtml/);
  assert.match(code, /Гарнизон/);
  assert.match(code, /неизвестно/);
  assert.match(code, /Object\.hasOwn\(island, 'defenseArmy'\)/);
  assert.match(code, /РАЗВЕДАНО · до конца вашего хода/);
  assert.doesNotMatch(code, /defenseArmy \?\? island\.army/);
  assert.doesNotMatch(code, /Точная защита[^\n]*island\.army/);

  const showStart = app.indexOf('  function showMapInfo(');
  const showEnd = app.indexOf('\n  function ', showStart + 1);
  const showCode = app.slice(showStart, showEnd);
  assert.match(showCode, /foreignIslandCompactHtml\(data\)/);
  assert.doesNotMatch(showCode, /data\.defenseArmy \?\? data\.army/);
  assert.doesNotMatch(showCode, /Исходный гарнизон/);
});

test('UI-11 Scout reveal is inferred only from viewer-projected private island fields', () => {
  const start = app.indexOf('  function foreignIslandHasPrivateReveal(');
  const end = app.indexOf('\n  function foreignIslandCompactHtml(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /Object\.hasOwn\(island, 'garrisonName'\)/);
  assert.match(code, /Object\.hasOwn\(island, 'garrisonDefense'\)/);
  assert.match(code, /Object\.hasOwn\(island, 'defenseArmy'\)/);
  assert.match(code, /Object\.hasOwn\(island, 'defenseBreakdown'\)/);
  assert.doesNotMatch(code, /scoutRevealGrants|localStorage|state\.scout/);

  assert.match(app, /Разведан гарнизон: .*Откройте остров на карте/);
  assert.match(styles, /UI-11 — foreign island privacy and Scout reveal/);
});


test('UI-12 adds a compact mobile roster and public player/ship object sheets', () => {
  assert.match(index, /id="gameRoster" class="game-roster hidden"/);

  const rosterStart = app.indexOf('  function renderGameRoster()');
  const rosterEnd = app.indexOf('\n  function renderPlayers()', rosterStart);
  assert.ok(rosterStart >= 0 && rosterEnd > rosterStart);
  const rosterCode = app.slice(rosterStart, rosterEnd);
  assert.match(rosterCode, /r\.activePlayerId/);
  assert.match(rosterCode, /player\.connected/);
  assert.match(rosterCode, /areAlliesClient/);
  assert.match(rosterCode, /showPlayerMapInfo\(player\)/);

  const playerStart = app.indexOf('  function playerRelationLabel(');
  const playerEnd = app.indexOf('\n  function showPlayerMapInfo(', playerStart);
  assert.ok(playerStart >= 0 && playerEnd > playerStart);
  const playerCode = app.slice(playerStart, playerEnd);
  assert.match(playerCode, /playerPublicSheetHtml/);
  assert.match(playerCode, /renderPlayerObjectSheet/);
  assert.match(playerCode, /fleetArtillery/);
  assert.match(playerCode, /assaultArmy/);
  assert.match(playerCode, /Object\.hasOwn\(player, 'ducats'\)/);
  assert.match(playerCode, /РАЗВЕДАНО · до конца вашего хода/);
  assert.doesNotMatch(playerCode, /player\.character/);
  assert.doesNotMatch(playerCode, /activeAssignment|activeExpedition|player\.debt/);

  assert.match(app, /renderGameRoster\(\);\s*renderPlayers\(\);\s*renderControls\(\);/);
  assert.match(styles, /UI-12 — compact player roster and public player\/ship sheets/);
});

test('UI-12 player sheet only exposes direct alliance commands and delegates combat to existing flow', () => {
  const start = app.indexOf('  function renderPlayerObjectSheet(');
  const end = app.indexOf('\n  function showPlayerMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /socket\.emit\('requestAlliance'/);
  assert.match(code, /socket\.emit\('breakAlliance'/);
  assert.match(code, /renderSeaBattleFlowSheet\(player\.id\)/);
  assert.doesNotMatch(code, /socket\.emit\('attackShip'/);
  assert.match(code, /sameCell/);
  assert.match(code, /mine\.phase === 'navigation' && mine\.roll === null/);
});


test('UI-13 provides one reusable map targeting mode for Scout and Cartographer', () => {
  assert.match(index, /id="targetingBar" class="targeting-bar hidden"/);
  assert.match(index, /id="targetingTitle"/);
  assert.match(index, /id="targetingCancelBtn"/);

  const start = app.indexOf('  function isMobileGameplayUi()');
  const end = app.indexOf('\n  function renderFleet()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /scoutTargetOptions/);
  assert.match(code, /targetingOptions/);
  assert.match(code, /canStartTargeting/);
  assert.match(code, /startTargeting/);
  assert.match(code, /cancelTargeting/);
  assert.match(code, /completeTargeting/);
  assert.match(code, /renderTargetingMapTargets/);
  assert.match(code, /cartographerAnchorOptions/);
  assert.match(code, /mode === 'scout-garrison'/);
  assert.match(code, /mode === 'scout-money'/);
  assert.match(code, /socket\.emit\('useCartographer'/);
  assert.match(code, /socket\.emit\('useScout'/);

  assert.match(app, /if \(renderTargetingMapTargets\(highlightLayer\)\) return;/);
  assert.match(app, /renderToastStack\(\);\s*renderTargetingBar\(\);\s*renderMap\(\);/);
  assert.match(app, /\$\('targetingCancelBtn'\)\.addEventListener\('click', cancelTargeting\)/);
  assert.match(styles, /UI-13 — reusable map targeting mode/);
});

test('UI-13 keeps desktop character target lists as migration fallback', () => {
  const start = app.indexOf('  function renderFleet()');
  const end = app.indexOf('\n  function renderTrade()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /typeof window !== 'undefined'[\s\S]*?matchMedia\('\(max-width: 900px\)'\)/);
  assert.match(code, /Картограф: выбрать якорь на карте/);
  assert.match(code, /Разведчик: гарнизон на карте/);
  assert.match(code, /Разведчик: казна игрока на карте/);
  assert.match(code, /Гарнизон: \$\{island\.name\}/);
  assert.match(code, /Деньги: \$\{player\.name\}/);
});

test('UI-13 local target mode never survives a mandatory server decision', () => {
  const start = app.indexOf('  function renderDecisionLayer()');
  const end = app.indexOf('\n  function renderControls()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /if \(descriptor && state\.targeting\) state\.targeting = null/);
});


test('UI-14 gives the owner a dedicated private character sheet from the HUD', () => {
  assert.match(index, /id="hudCharacterBtn"/);
  assert.match(index, /id="hudCharacter"/);

  const start = app.indexOf('  const CHARACTER_UX = {');
  const end = app.indexOf('\n  function isMobileGameplayUi()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  for (const id of ['navigator','cartographer','scout','treasureHunter','firstMate','shipCarpenter']) {
    assert.match(code, new RegExp(id));
  }
  assert.match(code, /characterSheetHtml/);
  assert.match(code, /renderCharacterObjectSheet/);
  assert.match(code, /refreshOpenCharacterSheet/);
  assert.match(code, /state\.mapSelection = \{ kind: 'character'/);
  assert.match(code, /renderFleet\(\);/);
  assert.match(code, /moveCanonicalCharacterActions\(actions\)/);

  assert.match(app, /\$\('hudCharacterBtn'\)\.addEventListener\('click'/);
  assert.match(app, /renderFleet\(\);\s*refreshOpenCharacterSheet\(\);\s*renderTrade\(\);/);
  assert.match(styles, /UI-14 — dedicated private character UX/);
});

test('UI-14 character sheet reuses canonical character actions instead of duplicating commands', () => {
  const start = app.indexOf('  function moveCanonicalCharacterActions(');
  const end = app.indexOf('\n  function isMobileGameplayUi()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /fleetActions/);
  assert.match(code, /Персонаж Адмиралтейства/);
  assert.match(code, /target\.appendChild\(node\)/);
  assert.doesNotMatch(code, /socket\.emit\('useNavigator'/);
  assert.doesNotMatch(code, /socket\.emit\('useTreasureHunter'/);
  assert.doesNotMatch(code, /socket\.emit\('useFirstMate'/);
  assert.doesNotMatch(code, /socket\.emit\('takeCharacter'/);
  assert.doesNotMatch(code, /socket\.emit\('replaceCharacter'/);
});

test('UI-14 character information remains owner-only in the new path', () => {
  const start = app.indexOf('  function renderCharacterObjectSheet()');
  const end = app.indexOf('\n  function refreshOpenCharacterSheet()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /const mine = me\(\)/);
  assert.match(code, /if \(!mine \|\| state\.spectating\) return/);

  const playerStart = app.indexOf('  function playerPublicSheetHtml(');
  const playerEnd = app.indexOf('\n  function renderPlayerObjectSheet(', playerStart);
  const publicCode = app.slice(playerStart, playerEnd);
  assert.doesNotMatch(publicCode, /character|characterAcquisitionOptions|characterReplacementOptions/);
});


test('UI-15 gives Citadel its own mobile commerce and fleet-shop sheet', () => {
  const start = app.indexOf('  function citadelSheetHtml(');
  const end = app.indexOf('\n  function renderObjectSheetFromMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /citadelSheetHtml/);
  assert.match(code, /moveCanonicalCitadelFleetActions/);
  assert.match(code, /appendCanonicalCitadelTradeActions/);
  assert.match(code, /renderCitadelObjectSheet/);
  assert.match(code, /refreshOpenCitadelSheet/);
  assert.match(code, /Уровень основного корабля/);
  assert.match(code, /Торговля/);
  assert.match(code, /renderFleet\(\);/);
  assert.match(code, /renderTrade\(\);/);
  assert.match(code, /legacySell\.click\(\)/);

  assert.match(app, /if \(kind === 'citadel'\) \{\s*renderCitadelObjectSheet\(data\);/);
  assert.match(app, /renderTrade\(\);\s*refreshOpenCitadelSheet\(\);\s*renderAnchors\(\);/);
  assert.match(styles, /UI-15 — dedicated Citadel commerce and fleet shop/);
});

test('UI-15 Citadel sheet does not duplicate purchase or sale socket payloads', () => {
  const start = app.indexOf('  function citadelSheetHtml(');
  const end = app.indexOf('\n  function renderObjectSheetFromMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  for (const command of ['buyShipLevel','buyShipUpgrade','removeShipUpgrade','buyEscort','buyCityGuard','buyPermanentGarrison','sellCargo']) {
    assert.doesNotMatch(code, new RegExp("socket\\.emit\\('" + command));
  }
  assert.doesNotMatch(code, /emitDataAction\([^\n]*buyShip/);
  assert.match(code, /target\.appendChild\(children\[i\]\)/);
  assert.match(code, /while \(escortSource\.firstChild\) target\.appendChild\(escortSource\.firstChild\);/);
});

test('UI-15 remote Citadel inspection never enables commerce away from Citadel', () => {
  const start = app.indexOf('  function renderCitadelObjectSheet(');
  const end = app.indexOf('\n  function refreshOpenCitadelSheet()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /else if \(!mine\.atCitadel\)/);
  assert.match(code, /Приплывите в Цитадель/);
});


test('UI-16 exposes private digital cards from the HUD without recreating a deck model', () => {
  assert.match(index, /id="hudCardsBtn"/);
  assert.match(index, /id="hudCards"/);

  const start = app.indexOf('  function digitalCardEntries(');
  const end = app.indexOf('\n  const CHARACTER_UX = {', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /savedEventCards/);
  assert.match(code, /playableLegendaryCards/);
  assert.match(code, /source === 'special'/);
  assert.match(code, /cardsSheetHtml/);
  assert.match(code, /renderCardsObjectSheet/);
  assert.match(code, /refreshOpenCardsSheet/);
  assert.match(code, /Это цифровые игровые эффекты/);
  assert.doesNotMatch(code, /deckIndex|drawPile|discardPile|shuffle|physicalDeck/);

  assert.match(app, /\$\('hudCardsBtn'\)\.addEventListener\('click'/);
  assert.match(app, /renderLegendary\(\);\s*refreshOpenCardsSheet\(\);\s*renderFleet\(\);/);
  assert.match(styles, /UI-16 — digital Cards UX without restoring a physical deck model/);
});

test('UI-16 reuses canonical saved-event and legendary action handlers', () => {
  const start = app.indexOf('  function moveSavedEventActions(');
  const end = app.indexOf('\n  const CHARACTER_UX = {', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /eventActions/);
  assert.match(code, /saved-event-card/);
  assert.match(code, /legendaryActions/);
  assert.match(code, /legendary-card/);
  assert.match(code, /renderEvents\(\);/);
  assert.match(code, /renderLegendary\(\);/);

  for (const command of ['useSavedCargo','useShipMaster','useBlueprint','playLegendary','respondLegendaryReaction']) {
    assert.doesNotMatch(code, new RegExp("socket\\.emit\\('" + command));
  }
});

test('UI-16 cards stay private and cannot replace mandatory Decision Layer', () => {
  const start = app.indexOf('  function renderCardsObjectSheet()');
  const end = app.indexOf('\n  function refreshOpenCardsSheet()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /const mine = me\(\)/);
  assert.match(code, /state\.spectating/);
  assert.match(code, /isDecisionPending\(\)/);

  const playerStart = app.indexOf('  function playerPublicSheetHtml(');
  const playerEnd = app.indexOf('\n  function renderPlayerObjectSheet(', playerStart);
  const publicCode = app.slice(playerStart, playerEnd);
  assert.doesNotMatch(publicCode, /savedEventCards|legendaryCards|playableLegendaryCards|specialCards/);
});

test('UI-16 restores legacy action panels after closing the digital cards sheet', () => {
  const start = app.indexOf('  function closeMapInfo()');
  const end = app.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /closingCards/);
  assert.match(code, /renderEvents\(\)/);
  assert.match(code, /renderLegendary\(\)/);
});


test('UI-17 unifies assignment, expedition and legendary-place progress in one private Goals sheet', () => {
  assert.match(index, /id="hudGoalsBtn"/);
  assert.match(index, /id="hudGoals"/);

  const start = app.indexOf('  function activeGoalCount(');
  const end = app.indexOf('\n  function digitalCardEntries(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /activeAssignment/);
  assert.match(code, /activeExpedition/);
  assert.match(code, /assignmentGoalHtml/);
  assert.match(code, /expeditionGoalHtml/);
  assert.match(code, /legendaryGoalsHtml/);
  assert.match(code, /namedPlaceCards/);
  assert.match(code, /expeditionHistory/);
  assert.match(code, /renderGoalsObjectSheet/);
  assert.match(code, /refreshOpenGoalsSheet/);
  assert.match(code, /Это представление существующего состояния игры/);

  assert.match(app, /\$\('hudGoalsBtn'\)\.addEventListener\('click'/);
  assert.match(app, /renderLegendaryPlaces\(\);\s*refreshOpenGoalsSheet\(\);\s*renderLegendary\(\);/);
  assert.match(styles, /UI-17 — unified personal Goals UX/);
});

test('UI-17 reuses canonical assignment and expedition actions', () => {
  const start = app.indexOf('  function moveCanonicalGoalActions(');
  const end = app.indexOf('\n  function digitalCardEntries(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /assignmentActions/);
  assert.match(code, /legendaryPlacesActions/);
  assert.match(code, /renderAssignments\(\);/);
  assert.match(code, /renderLegendaryPlaces\(\);/);
  assert.doesNotMatch(code, /socket\.emit\('takeExpedition'/);
  assert.doesNotMatch(code, /socket\.emit\('respondAssignmentChoice'/);
});

test('UI-17 mandatory assignment choice stays in Decision Layer rather than Goals', () => {
  const start = app.indexOf('  function moveCanonicalGoalActions(');
  const end = app.indexOf('\n  function renderGoalsObjectSheet()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /!state\.room\?\.pendingAssignmentChoice\?\.viewerCanRespond/);

  const sheetStart = app.indexOf('  function renderGoalsObjectSheet()');
  const sheetEnd = app.indexOf('\n  function refreshOpenGoalsSheet()', sheetStart);
  const sheetCode = app.slice(sheetStart, sheetEnd);
  assert.match(sheetCode, /isDecisionPending\(\)/);
});

test('UI-17 restores legacy goal panels when Goals sheet closes', () => {
  const start = app.indexOf('  function closeMapInfo()');
  const end = app.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /closingGoals/);
  assert.match(code, /renderAssignments\(\)/);
  assert.match(code, /renderLegendaryPlaces\(\)/);
});


test('UI-18 turns marine anchors into a mobile encounter sheet without revealing the card early', () => {
  const start = app.indexOf('  function anchorColorLabel(');
  const end = app.indexOf('\n  function renderObjectSheetFromMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /anchorEncounterSheetHtml/);
  assert.match(code, /renderAnchorEncounterSheet/);
  assert.match(code, /refreshOpenAnchorSheet/);
  assert.match(code, /Карта встречи остаётся скрытой до объявления столкновения/);
  assert.match(code, /Ваша артиллерия/);
  assert.match(code, /anchor\.fleetPoints/);
  assert.match(code, /visitedAnchors/);
  assert.match(code, /lastAnchorEncounter/);

  assert.match(app, /if \(kind === 'anchor'\) \{\s*renderAnchorEncounterSheet\(data\);/);
  assert.match(app, /renderAnchors\(\);\s*refreshOpenAnchorSheet\(\);\s*renderIsland\(\);/);
  assert.match(styles, /UI-18 — marine anchor encounter flow/);
});

test('UI-18 reuses canonical anchor fight action instead of duplicating fightAnchor', () => {
  const start = app.indexOf('  function moveCanonicalAnchorActions(');
  const end = app.indexOf('\n  function renderObjectSheetFromMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /anchorActions/);
  assert.match(code, /renderAnchors\(\);/);
  assert.match(code, /while \(source\.firstChild\) target\.appendChild\(source\.firstChild\);/);
  assert.doesNotMatch(code, /socket\.emit\('fightAnchor'/);
});

test('UI-18 keeps hidden encounter contents out of pre-fight anchor presentation', () => {
  const start = app.indexOf('  function anchorEncounterSheetHtml(');
  const end = app.indexOf('\n  function moveCanonicalAnchorActions(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  // Encounter card fields are used only for the already-resolved last encounter.
  assert.match(code, /anchorEncounterForCell/);
  assert.match(code, /encounter\.cardName/);
  assert.doesNotMatch(code, /anchor\.cardName|anchor\.cardArtillery|anchor\.reward/);
  assert.doesNotMatch(code, /anchorDecks/);
});

test('UI-18 existing Result Card remains the authoritative post-encounter feedback', () => {
  assert.match(app, /function anchorResultCard\(res\)/);
  assert.match(app, /function handleAnchorResultAck\(res\)/);
  assert.match(app, /fightAnchor', \{\}, handleAnchorResultAck/);

  const start = app.indexOf('  function dismissResultCard()');
  const end = app.indexOf('\n\n  function renderResultLayer()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /state\.mapSelection\?\.kind === 'anchor'/);
  assert.match(code, /refreshOpenAnchorSheet\(\)/);
});


test('UI-19 turns sea combat into target preview plus canonical battle actions', () => {
  const start = app.indexOf('  function seaBattlePreviewHtml(');
  const end = app.indexOf('\n  function renderPlayerObjectSheet(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /renderSeaBattleFlowSheet/);
  assert.match(code, /refreshOpenSeaBattleFlow/);
  assert.match(code, /battleFlowStatusHtml/);
  assert.match(code, /fleetArtillery/);
  assert.match(code, /attackAllies/);
  assert.match(code, /defenseAllies/);
  assert.match(code, /renderCombat\(\);/);
  assert.match(code, /dataset\.combatKind === 'sea'/);
  assert.match(code, /actions\.appendChild\(canonical\)/);
  assert.doesNotMatch(code, /socket\.emit\('attackShip'/);

  assert.match(app, /combat\.addEventListener\('click', \(\) => renderSeaBattleFlowSheet\(player\.id\)\)/);
  assert.match(app, /renderCombat\(\);\s*refreshOpenSeaBattleFlow\(\);\s*refreshOpenAssaultFlow\(\);\s*renderDecisionLayer\(\);/);
  assert.match(styles, /UI-19 — player-vs-player sea battle flow/);
});

test('UI-19 pending joint battle uses Decision Layer as the authoritative waiting and invite step', () => {
  const start = app.indexOf('  function mobileDecisionDescriptor(');
  const end = app.indexOf('\n  function renderDecisionLayer()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /pendingBattle\?\.viewerInvite/);
  assert.match(code, /bodyHtml: battleFlowStatusHtml\(room\.pendingBattle\)/);
  assert.match(code, /kind: 'waiting'/);

  const decisionStart = app.indexOf('  function renderDecisionLayer()');
  const decisionEnd = app.indexOf('\n  function renderControls()', decisionStart);
  const decisionCode = app.slice(decisionStart, decisionEnd);
  assert.match(decisionCode, /if \(descriptor\.bodyHtml\) body\.innerHTML = descriptor\.bodyHtml/);
});

test('UI-19 server emits a sanitized authoritative result event for resolved joint sea battles', () => {
  assert.match(server, /function battlePresentationResult\(result, kind\)/);
  assert.match(server, /function emitResolvedBattlePresentation\(room, pending, result\)/);
  assert.match(server, /io\.to\(player\.socketId\)\.emit\('battleResolved', payload\)/);
  assert.match(server, /if \(result\?\.ok\) emitResolvedBattlePresentation\(room, pending, result\);\s*room\.pendingBattle = null;/);

  const start = server.indexOf('function battlePresentationResult(result, kind)');
  const end = server.indexOf('\nfunction resolvePendingBattle(', start);
  assert.ok(start >= 0 && end > start);
  const code = server.slice(start, end);
  assert.match(code, /attackerPower/);
  assert.match(code, /defenderPower/);
  assert.match(code, /lootShares/);
  assert.match(code, /fleetPointAwards/);
  assert.match(code, /levelLosses/);
  assert.doesNotMatch(code, /character|ducats|debt|cargo/);
});

test('UI-19 client converts joint battleResolved event into the existing Result Card contract', () => {
  assert.match(app, /socket\.on\('battleResolved', data =>/);
  assert.match(app, /if \(data\.kind === 'sea'\)/);
  assert.match(app, /seaBattleResultCard\(\{ ok: true, result: data\.result \}/);
  assert.match(app, /enqueueResultCard\(card\)/);
});


test('UI-20 turns foreign island assault into preview plus canonical combat actions', () => {
  const start = app.indexOf('  function assaultDefenseLabel(');
  const end = app.indexOf('\n  function seaBattlePreviewHtml(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /assaultPreviewHtml/);
  assert.match(code, /renderAssaultFlowSheet/);
  assert.match(code, /refreshOpenAssaultFlow/);
  assert.match(code, /jointAssaultResultCard/);
  assert.match(code, /Object\.hasOwn\(island, 'defenseArmy'\)/);
  assert.match(code, /скрытый гарнизон не раскрывается/);
  assert.match(code, /renderCombat\(\);/);
  assert.match(code, /dataset\.combatKind === 'assault'/);
  assert.match(code, /actions\.appendChild\(canonical\)/);
  assert.doesNotMatch(code, /socket\.emit\('assaultIsland'/);

  assert.match(app, /attackable \? 'Штурм острова' : 'Действия на острове'/);
  assert.match(app, /if \(attackable\) renderAssaultFlowSheet\(island\.id\)/);
  assert.match(app, /refreshOpenSeaBattleFlow\(\);\s*refreshOpenAssaultFlow\(\);\s*renderDecisionLayer\(\);/);
  assert.match(styles, /UI-20 — island assault orchestration flow/);
});

test('UI-20 assault preview respects foreign-island privacy before battle', () => {
  const start = app.indexOf('  function assaultDefenseLabel(');
  const end = app.indexOf('\n  function renderAssaultFlowSheet(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /if \(Object\.hasOwn\(island, 'defenseArmy'\)\) return String\(island\.defenseArmy\)/);
  assert.match(code, /return \`не менее \$\{island\.army \?\? 0\}\`/);
  assert.doesNotMatch(code, /defenseBreakdown\.total/);
  assert.doesNotMatch(code, /garrisonDefense/);
});

test('UI-20 joint assault uses the existing pending battle Decision Layer and queues Result Card behind consequences', () => {
  assert.match(app, /bodyHtml: battleFlowStatusHtml\(room\.pendingBattle\)/);
  assert.match(app, /if \(data\.kind === 'assault'\)/);
  assert.match(app, /jointAssaultResultCard\(data\)/);
  assert.match(app, /enqueueResultCard\(card\)/);

  const resultStart = app.indexOf('  function renderResultLayer()');
  const resultEnd = app.indexOf('\n  function anchorResultCard(', resultStart);
  const resultCode = app.slice(resultStart, resultEnd);
  assert.match(resultCode, /const decision = mobileDecisionDescriptor\(state\.room\)/);
  assert.match(resultCode, /\|\| decision\)/);
});

test('UI-20 server battleResolved payload sanitizes authoritative joint assault outcome', () => {
  const start = server.indexOf('function battlePresentationResult(result, kind)');
  const end = server.indexOf('\nfunction resolvePendingBattle(', start);
  assert.ok(start >= 0 && end > start);
  const code = server.slice(start, end);

  assert.match(code, /kind === 'assault'/);
  assert.match(code, /defense: result\.defense \? \{ total: result\.defense\.total \}/);
  assert.match(code, /armyPointAwards/);
  assert.match(code, /captureRetention/);
  assert.match(code, /rewardNotes/);
  assert.match(code, /islandId: pending\.islandId \|\| null/);
  assert.match(code, /\['sea', 'assault'\]\.includes\(pending\.kind\)/);
  assert.doesNotMatch(code, /garrisonType|garrisonName|buildings|ducats|debt|cargo/);
});

test('UI-20 joint assault Result Card is perspective-aware for attackers and defenders', () => {
  const start = app.indexOf('  function jointAssaultResultCard(');
  const end = app.indexOf('\n  function seaBattlePreviewHtml(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /onAttack/);
  assert.match(code, /onDefense/);
  assert.match(code, /viewerWon/);
  assert.match(code, /Sila attack|Сила атаки/);
  assert.match(code, /Защита острова/);
  assert.match(code, /tone: outcome === 'tie' \? 'neutral' : viewerWon \? 'success' : 'danger'/);
});


test('UI-21 pending sailing events render as Decision Layer event scenes', () => {
  const start = app.indexOf('  function eventDecisionSceneHtml(');
  const end = app.indexOf('\n  function mobileDecisionDescriptor(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  for (const kind of ['observatory','cargo','raid','boarding','storm','treasure-choice']) {
    assert.match(code, new RegExp(kind.replace('-', '\\-')));
  }
  assert.match(code, /ШТОРМ/);
  assert.match(code, /Выберите допустимую клетку берега/);
  assert.match(code, /eventResolvedResultCard/);

  const descStart = app.indexOf('  function mobileDecisionDescriptor(');
  const descEnd = app.indexOf('\n  function renderDecisionLayer()', descStart);
  const desc = app.slice(descStart, descEnd);
  assert.match(desc, /bodyHtml: eventDecisionSceneHtml\(room\.pendingEvent\)/);
  assert.match(desc, /actionsId: 'eventActions'/);
  assert.match(styles, /UI-21 — sailing event scenes and authoritative results/);
});

test('UI-21 server emits private authoritative presentations for automatic sailing events', () => {
  assert.match(server, /function sailingEventPresentationSnapshot\(player\)/);
  assert.match(server, /function buildSailingEventPresentation\(room, player, card, before\)/);
  assert.match(server, /function emitSailingEventPresentation\(room, player, card, before\)/);
  assert.match(server, /io\.to\(player\.socketId\)\.emit\('eventResolved', presentation\)/);

  const start = server.indexOf('function buildSailingEventPresentation(room, player, card, before)');
  const end = server.indexOf('\nfunction resolveSailingEventCard(', start);
  assert.ok(start >= 0 && end > start);
  const code = server.slice(start, end);
  assert.match(code, /card\.type === 'storm'/);
  assert.match(code, /Шторм отнёс вашу флотилию к берегам/);
  assert.match(code, /card\.type === 'treasury-loss'/);
  assert.match(code, /card\.type === 'turn-effect'/);
  assert.match(code, /card\.type === 'legendary'/);
  assert.match(code, /card\.type === 'found-cargo'/);
  assert.match(code, /card\.type === 'treasure'/);
});

test('UI-21 automatic and observatory-resolved cards emit only after authoritative resolution', () => {
  assert.match(server, /const presentationBefore = sailingEventPresentationSnapshot\(player\);\s*const resolved = resolveSailingEventCard\(room, player, card\);\s*if \(resolved\.pending\) return;\s*emitSailingEventPresentation/);
  assert.match(server, /const presentationBefore = sailingEventPresentationSnapshot\(player\);\s*const resolved = resolveSailingEventCard\(room, player, card\);\s*if \(resolved\.pending\) return \{ ok: true, pending: true \};\s*emitSailingEventPresentation/);
});

test('UI-21 pending event result is emitted after the chosen effect is applied', () => {
  const start = server.indexOf('function completePendingEvent(room, pending)');
  const end = server.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start);
  const code = server.slice(start, end);
  assert.match(code, /presentationBefore = pending\.origin === 'event-phase'/);
  assert.match(code, /if \(presentationBefore && pending\.eventCard\) emitSailingEventPresentation/);
  assert.match(code, /finishPendingEvent\(room, pending\)/);
  assert.ok(code.indexOf('emitSailingEventPresentation') < code.indexOf('finishPendingEvent(room, pending)'));
});

test('UI-21 client converts eventResolved into the shared Result Card queue', () => {
  assert.match(app, /socket\.on\('eventResolved', data =>/);
  assert.match(app, /eventResolvedResultCard\(data\)/);
  assert.match(app, /enqueueResultCard\(card\)/);
  assert.doesNotMatch(app.slice(app.indexOf("socket.on('eventResolved'"), app.indexOf("socket.on('battleResolved'")), /state\.room\s*=|socket\.emit/);
});
