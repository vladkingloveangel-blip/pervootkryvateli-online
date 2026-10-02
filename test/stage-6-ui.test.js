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
  assert.doesNotMatch(index, /id="mobileGameNav"/);

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



test('UI-5 HUD keeps live combat stats separate from canonical scoring metrics', () => {
  assert.doesNotMatch(index, /id="hudArmyPointsBtn"|id="hudFleetPointsBtn"|id="hudDebtBtn"|id="hudPhase"/);
  assert.match(index, /id="hudArmyBtn"[^>]*data-hud-metric="army"[^>]*aria-label="Войско"/);
  assert.match(index, /id="hudArtilleryBtn"[^>]*data-hud-metric="artillery"[^>]*aria-label="Артиллерия"/);
  assert.match(index, /id="hudArmyGloryBtn"[^>]*data-hud-metric="army-glory"/);
  assert.match(index, /id="hudFleetGloryBtn"[^>]*data-hud-metric="fleet-glory"/);
  assert.match(index, /id="hudPrestigeBtn"[^>]*data-hud-metric="prestige"/);
  assert.match(index, /id="hudTurnStatus"/);
  assert.match(index, /id="hudMenuBtn"/);

  const start = app.indexOf('  function hudMetricInfo(');
  const end = app.indexOf('\n  function toggleHudMetricPopover', start);
  assert.ok(start >= 0 && end > start);
  const hudCode = app.slice(start, end);
  assert.match(hudCode, /mine\.assaultArmy \?\? mine\.stats\?\.army/);
  assert.match(hudCode, /mine\.fleetArtillery \?\? mine\.stats\?\.artillery/);
  assert.match(hudCode, /mine\.armyPoints/);
  assert.match(hudCode, /mine\.fleetPoints/);
  assert.match(hudCode, /mine\.prestige/);

  assert.match(app, /\$\('hudPlayerBtn'\)\.addEventListener\('click',[\s\S]*?renderFleetOverviewObjectSheet/);
  assert.match(app, /document\.querySelectorAll\('\[data-hud-metric\]'\)/);
  assert.match(app, /\$\('hudMenuBtn'\)\.addEventListener\('click', toggleGameMenu\)/);
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
  assert.match(styles, /body\.game-active \.map-nav-overlay \{\s*display: none !important;/);

  // Canonical action hosts remain internal, but the obsolete mobile dock/nav are gone.
  assert.match(index, /class="panel controls" data-ui-tab="actions"/);
  assert.doesNotMatch(index, /id="mobileActionDock"|id="mobileGameNav"/);
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

  assert.match(app, /renderCombat\(\);\s*refreshOpenSeaBattleFlow\(\);\s*refreshOpenAssaultFlow\(\);\s*renderEventFlowOverlay\(\);\s*renderDecisionLayer\(\);\s*renderResultLayer\(\);\s*renderToastStack\(\);\s*renderTargetingBar\(\);\s*renderMap\(\);/);
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



test('UI-9 keeps one reusable object inspection sheet without duplicating map actions', () => {
  assert.match(index, /id="objectSheet" class="object-sheet hidden"/);
  assert.match(index, /id="objectSheetKind"/);
  assert.match(index, /id="objectSheetTitle"/);
  assert.match(index, /id="objectSheetBody"/);
  assert.match(index, /id="objectSheetActions"/);
  assert.match(index, /id="objectSheetClose"/);

  const start = app.indexOf('  function mapObjectKindLabel(');
  const end = app.indexOf('\n  function showMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /renderObjectSheetFromMapInfo/);
  assert.match(code, /showPlayerMapInfo/);
  assert.match(code, /mapInfoMeta/);
  assert.match(code, /legacyAction\.onclick/);

  const showStart = app.indexOf('  function showMapInfo(');
  const showEnd = app.indexOf('\n  function ', showStart + 1);
  const showCode = app.slice(showStart, showEnd);
  assert.doesNotMatch(showCode, /matchMedia\('\(max-width: 900px\)'\)/);
  assert.match(showCode, /renderObjectSheetFromMapInfo\(kind, data\)/);
  assert.doesNotMatch(showCode, /positionMapInfoAt\(resolvedAnchor\.row, resolvedAnchor\.col\)/);

  assert.match(app, /document\.createElement\('button'\);[\s\S]*?showPlayerMapInfo\(p\)/);
  assert.match(app, /\$\('objectSheetClose'\)\.addEventListener\('click', closeMapInfo\)/);
  assert.match(styles, /body\.game-active \.map-info-card \{\s*display: none !important;/);
});

test('UI-9 mandatory decisions close voluntary object selection', () => {
  const start = app.indexOf('  function renderDecisionLayer()');
  const end = app.indexOf('\n  function renderControls()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /if \(descriptor && state\.mapSelection\) closeMapInfo\(\)/);
});



test('UI-10 own islands use one canonical overview-to-management workflow', () => {
  const start = app.indexOf('  function ownIslandCompactHtml(');
  const end = app.indexOf('\n  function showPlayerMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /ownIslandCompactHtml/);
  assert.doesNotMatch(code, /ownIslandQuickActions/);
  assert.match(code, /renderOwnIslandObjectSheet/);
  assert.match(code, /renderOwnIslandManagement/);
  assert.match(code, /renderOwnIslandActionView/);
  assert.match(code, /ВАШ ОСТРОВ/);
  assert.match(code, /Управлять островом/);
  assert.match(code, /Погрузка/);
  assert.match(code, /Улучшение построек/);
  assert.match(code, /Построить/);

  // Management views reuse existing canonical renderers/action nodes instead
  // of rebuilding legality, costs or socket payloads in a parallel UI path.
  assert.match(code, /renderIsland\(\);/);
  assert.match(code, /moveCanonicalActionGroup/);
  assert.doesNotMatch(code, /socket\.emit\('build'/);
  assert.doesNotMatch(code, /socket\.emit\('upgradeBuilding'/);
  assert.doesNotMatch(code, /socket\.emit\('loadCargo'/);

  assert.match(code, /defenseBreakdown/);
  assert.match(code, /building\.nextUpgrade/);
  assert.match(code, /loadedRound === state\.room\.round/);
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

test('UI-12 player sheet delegates alliance commands and combat to canonical flows', () => {
  const start = app.indexOf('  function renderPlayerObjectSheet(');
  const end = app.indexOf('\n  function showPlayerMapInfo(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);

  assert.match(code, /appendCanonicalAllianceActions\(actions, player\.id\)/);
  assert.match(code, /renderSeaBattleFlowSheet\(player\.id\)/);
  assert.doesNotMatch(code, /socket\.emit\('requestAlliance'/);
  assert.doesNotMatch(code, /socket\.emit\('breakAlliance'/);
  assert.doesNotMatch(code, /socket\.emit\('attackShip'/);
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
  const playerEnd = app.indexOf('\n  function renderFleetOverviewObjectSheet(', playerStart);
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
  assert.match(app, /renderCombat\(\);\s*refreshOpenSeaBattleFlow\(\);\s*refreshOpenAssaultFlow\(\);\s*renderEventFlowOverlay\(\);\s*renderDecisionLayer\(\);/);
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



test('UI-20 foreign island assault uses preview plus canonical combat actions', () => {
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

  const sheetStart = app.indexOf('  function renderForeignIslandObjectSheet(');
  const sheetEnd = app.indexOf('\n  function citadelSheetHtml(', sheetStart);
  const sheet = app.slice(sheetStart, sheetEnd);
  assert.match(sheet, /action\.textContent = 'Штурм острова'/);
  assert.match(sheet, /renderAssaultFlowSheet\(island\.id\)/);
  assert.match(app, /refreshOpenSeaBattleFlow\(\);\s*refreshOpenAssaultFlow\(\);\s*renderEventFlowOverlay\(\);\s*renderDecisionLayer\(\);/);
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


test('UI-22 renders sixth-circle progress as Event → Feud → Assignment overlay', () => {
  assert.match(index, /id="eventFlowOverlay" class="event-flow-overlay hidden"/);
  assert.match(index, /id="eventFlowSteps"/);
  assert.match(index, /id="eventFlowLastCard"/);

  const start = app.indexOf('  function eventFlowStageKey(');
  const end = app.indexOf('\n  function eventDecisionSceneHtml(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /eventFlowStageIndex/);
  assert.match(code, /eventFlowStageStatus/);
  assert.match(code, /renderEventFlowOverlay/);
  assert.match(code, /Событие/);
  assert.match(code, /Вражда/);
  assert.match(code, /Поручение/);
  assert.match(code, /phase\.lastCard/);
  assert.match(code, /phase\.currentPlayerId === state\.myId/);

  assert.match(app, /refreshOpenAssaultFlow\(\);\s*renderEventFlowOverlay\(\);\s*renderDecisionLayer\(\);/);
  assert.match(styles, /UI-22 — sixth-circle event orchestration/);
});

test('UI-22 normalizes legacy and domain event stage names without changing server flow', () => {
  const start = app.indexOf('  function eventFlowStageKey(');
  const end = app.indexOf('\n  function eventFlowStageIndex(', start);
  const code = app.slice(start, end);
  assert.match(code, /stage === 'political' \|\| stage === 'feud'/);
  assert.match(code, /stage === 'assignment' \|\| stage === 'assignment-replace'/);
  assert.match(code, /return 'sailing'/);
});

test('UI-22 Feud and Assignment mandatory choices use scene bodies but canonical action handlers', () => {
  const start = app.indexOf('  function feudDecisionSceneHtml(');
  const end = app.indexOf('\n  function eventDecisionSceneHtml(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /downgrade-building/);
  assert.match(code, /remove-building/);
  assert.match(code, /reclaim-island/);
  assert.match(code, /remove-upgrade/);
  assert.match(code, /assignmentDecisionSceneHtml/);

  const descStart = app.indexOf('  function mobileDecisionDescriptor(');
  const descEnd = app.indexOf('\n  function renderDecisionLayer()', descStart);
  const desc = app.slice(descStart, descEnd);
  assert.match(desc, /bodyHtml: feudDecisionSceneHtml\(room\.pendingFeud\)/);
  assert.match(desc, /actionsId: 'eventActions'/);
  assert.match(desc, /bodyHtml: assignmentDecisionSceneHtml\(room\.pendingAssignmentChoice\)/);
  assert.match(desc, /actionsId: 'assignmentActions'/);
});

test('UI-22 other viewers get stage-aware waiting instead of private choice details', () => {
  const start = app.indexOf('  function mobileDecisionDescriptor(');
  const end = app.indexOf('\n  function renderDecisionLayer()', start);
  const code = app.slice(start, end);
  assert.match(code, /room\.phase === 'event' && room\.eventPhase\?\.active && room\.pendingDecision\?\.waiting/);
  assert.match(code, /body: eventFlowStageStatus\(room, room\.eventPhase\)/);
  assert.doesNotMatch(code, /room\.pendingDecision\.options/);
});


test('UI-23 exposes diplomacy through HUD without creating new political socket commands', () => {
  assert.match(index, /id="hudPoliticsBtn"[^>]*aria-label="Дипломатия и сюзерен"/);
  assert.match(index, /id="hudPolitics"/);
  assert.match(app, /\$\('hudPoliticsBtn'\)\.addEventListener\('click',[\s\S]*?renderDiplomacyObjectSheet\(me\(\)\?\.suzerainId \|\| null\)/);
  assert.match(app, /\$\('hudPolitics'\)\.textContent = suzerain/);
});

test('UI-23 state islands open human-readable faction diplomacy in the shared object sheet', () => {
  const start = app.indexOf('  function factionById(');
  const end = app.indexOf('\n  function renderPolitics()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /function factionForIsland/);
  assert.match(code, /function factionRelationLabel/);
  assert.match(code, /Ваш сюзерен/);
  assert.match(code, /Вражда/);
  assert.match(code, /Налог вассала/);
  assert.match(code, /При вступлении государство может передать остров/);
  assert.match(code, /Итоговая награда за полное завоевание/);
  assert.doesNotMatch(code, /socket\.emit\(/);
});


test('UI-23 diplomacy reuses canonical renderPolitics buttons for vassalage and rebellion legality', () => {
  const start = app.indexOf('  function appendCanonicalPoliticsActions(');
  const end = app.indexOf('\n  function renderPolitics()', start);
  const code = app.slice(start, end);
  assert.match(code, /renderPolitics\(\)/);
  assert.match(code, /\$\('politicsActions'\)/);
  assert.match(code, /target\.appendChild\(button\)/);
  assert.doesNotMatch(code, /socket\.emit\(/);

  const diplomacyStart = app.indexOf('  function renderDiplomacyObjectSheet(');
  const diplomacyEnd = app.indexOf('\n  function renderPolitics()', diplomacyStart);
  const diplomacy = app.slice(diplomacyStart, diplomacyEnd);
  assert.match(diplomacy, /appendCanonicalPoliticsActions\(actions, selectedFaction\?\.id \|\| null\)/);
});

test('UI-23 keeps the legacy politics renderer as canonical fallback until UI-32', () => {
  const start = app.indexOf('  function renderPolitics()');
  const end = app.indexOf('\n\n\n  function renderIslandCorrection()', start);
  const code = app.slice(start, end);
  assert.match(code, /socket\.emit\('enterVassalage'/);
  assert.match(code, /socket\.emit\('rebelVassalage'/);
  assert.match(styles, /UI-23 — politics and state diplomacy/);
});


test('UI-24 moves alliance actions into player cards through the canonical alliance renderer', () => {
  const start = app.indexOf('  function appendCanonicalAllianceActions(');
  const end = app.indexOf('\n  function renderPlayerObjectSheet(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.ok(code.includes('renderAlliances();'));
  assert.ok(code.includes("$('allianceActions')"));
  assert.ok(code.includes('node.textContent.includes(player.name)'));
  assert.ok(code.includes('target.appendChild(node)'));
  assert.equal(code.includes('socket.emit'), false);
});

test('UI-24 removes duplicated alliance legality from the player object sheet', () => {
  const start = app.indexOf('  function renderPlayerObjectSheet(');
  const end = app.indexOf('\n  function showPlayerMapInfo(', start);
  const code = app.slice(start, end);
  assert.ok(code.includes('appendCanonicalAllianceActions(actions, player.id)'));
  assert.equal(code.includes('canProposeAlliance'), false);
  assert.equal(code.includes('canBreakAlliance'), false);
  assert.equal(code.includes("socket.emit('requestAlliance'"), false);
  assert.equal(code.includes("socket.emit('breakAlliance'"), false);
});

test('UI-24 keeps incoming alliance response in the mandatory Decision Layer', () => {
  const start = app.indexOf('  function mobileDecisionDescriptor(');
  const end = app.indexOf('\n  function renderDecisionLayer()', start);
  const code = app.slice(start, end);
  assert.ok(code.includes("room.pendingAlliance?.viewerRole === 'recipient'"));
  assert.ok(code.includes("kind: 'decision', kicker: 'ПРЕДЛОЖЕНИЕ СОЮЗА'"));
  assert.ok(code.includes("actionsId: 'allianceActions'"));
  assert.ok(code.includes("room.pendingAlliance?.viewerRole === 'sender'"));
  assert.ok(code.includes("kind: 'waiting'"));
});

test('UI-24 shows a compact public active-alliance status in player cards', () => {
  assert.ok(app.includes('function alliancePublicStatusHtml'));
  assert.ok(app.includes('Действующий союз'));
  assert.ok(app.includes('Союзник · действующий союз'));
  assert.ok(styles.includes('UI-24 — alliances in player cards'));
});


test('UI-25 adds one unified secondary game menu over the map', () => {
  assert.match(index, /id="gameMenuPanel" class="game-menu-panel hidden"/);
  for (const key of ['metrics','holdings','diplomacy','journal','help','endgame','settings','exit']) {
    assert.match(index, new RegExp('data-game-menu="' + key + '"'));
  }
  assert.match(styles, /UI-25 — unified secondary game menu/);
});

test('UI-25 HUD menu opens the game menu rather than the old account popover', () => {
  assert.match(app, /\$\('hudMenuBtn'\)\.addEventListener\('click', toggleGameMenu\)/);
  assert.match(app, /function openGameMenu\(\)/);
  assert.match(app, /function closeGameMenu\(\)/);
  assert.match(app, /function handleGameMenuAction\(kind\)/);
  assert.doesNotMatch(app, /\$\('hudMenuBtn'\)\.addEventListener\('click', \(\) => toggleGameAccountMenu\(\)\)/);
});

test('UI-25 menu routes to existing secondary surfaces without adding gameplay socket logic', () => {
  const start = app.indexOf('  function openMenuInfoSheet(');
  const end = app.indexOf('\n  function cargoSummary', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /renderDiplomacyObjectSheet\(null\)/);
  assert.match(code, /openGameAccountMenu\(\)/);
  assert.match(code, /\$\('logoutBtn'\)\.click\(\)/);
  assert.doesNotMatch(code, /openMobileTab|data-mobile-nav/);
  assert.doesNotMatch(code, /socket\.emit\(/);
});

test('UI-25 keeps ordinary turn actions outside the secondary menu', () => {
  const start = index.indexOf('id="gameMenuPanel"');
  const end = index.indexOf('id="profilePanel"', start);
  const code = index.slice(start, end);
  assert.doesNotMatch(code, /Бросить|Остаться на месте|Завершить ход|Штурм|Морской бой/);
});


test('UI-26 provides a dedicated party metrics overlay', () => {
  assert.match(index, /id="scoreOverlay" class="score-overlay hidden"/);
  assert.match(index, /id="scoreOverlayBody"/);
  assert.match(app, /function renderScoreOverlay\(\)/);
  assert.match(app, /function closeScoreOverlay\(\)/);
  assert.match(styles, /UI-26 — party metrics overlay/);
});


test('UI-26 pre-finish metrics use only projected player fields and never derive hidden scoring', () => {
  const start = app.indexOf('  function metricValue(');
  const end = app.indexOf('\n  function openMenuInfoSheet(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /player\.islandCount/);
  assert.match(code, /player\.armyPoints/);
  assert.match(code, /player\.fleetPoints/);
  assert.match(code, /player\.prestige/);
  assert.match(code, /Object\.hasOwn\(player, 'ducats'\)/);
  assert.match(code, /metricValue\(player\.prestige\)/);
  assert.match(code, /Легендарные места<\/span><strong>скрыто/);
  assert.doesNotMatch(code, /calculateFinalScoring|islandPrestige|legendaryPlaceCount/);
});

test('UI-26 finished metrics come only from canonical finalResult', () => {
  const start = app.indexOf('  function renderScoreOverlay()');
  const end = app.indexOf('\n  function closeScoreOverlay()', start);
  const code = app.slice(start, end);
  assert.match(code, /room\.finalResult\?\.playerMetrics/);
  assert.match(code, /metrics\.islands/);
  assert.match(code, /metrics\.wealth/);
  assert.match(code, /metrics\.army/);
  assert.match(code, /metrics\.fleet/);
  assert.match(code, /metrics\.prestige/);
  assert.match(code, /metrics\.legendaryPlaces/);
});

test('UI-26 menu metrics entry opens the dedicated overlay', () => {
  const start = app.indexOf('  function handleGameMenuAction(kind)');
  const end = app.indexOf('\n  function cargoSummary', start);
  const code = app.slice(start, end);
  assert.match(code, /kind === 'metrics'/);
  assert.match(code, /renderScoreOverlay\(\)/);
});


test('UI-27 adds a viewer-safe journal overlay instead of exposing raw room.log', () => {
  assert.match(index, /id="journalOverlay" class="journal-overlay hidden"/);
  assert.match(index, /id="journalOverlayBody"/);
  assert.match(app, /function renderJournalOverlay\(\)/);
  assert.match(app, /function recordJournal\(/);
  assert.match(styles, /UI-27 — journal and ambient notifications/);
  const start = app.indexOf('  function renderJournalOverlay()');
  const end = app.indexOf('\n  function closeJournalOverlay()', start);
  const code = app.slice(start, end);
  assert.doesNotMatch(code, /room\.log/);
});

test('UI-27 journal records result cards and lightweight toasts already visible to the viewer', () => {
  const resultStart = app.indexOf('  function enqueueResultCard(');
  const toastStart = app.indexOf('  function enqueueToast(', resultStart);
  const toastEnd = app.indexOf('\n  function renderToastStack()', toastStart);
  assert.match(app.slice(resultStart, toastStart), /recordJournal\(entry\.title, entry\.tone, entry\.body\)/);
  assert.match(app.slice(toastStart, toastEnd), /if \(journal\) recordJournal\(toast\.message, toast\.tone\)/);
});

test('UI-27 ambient notifications use only public projected turn state and do not infer hidden mechanics', () => {
  const start = app.indexOf('  function processAmbientRoomState(');
  const end = app.indexOf('\n  let uiAudioContext', start);
  const code = app.slice(start, end);
  assert.match(code, /room\.round/);
  assert.match(code, /room\.circle/);
  assert.match(code, /room\.activePlayerId/);
  assert.match(code, /room\.eventPhase\?\.active/);
  assert.match(code, /room\.eventPhase\?\.currentPlayerId/);
  assert.doesNotMatch(code, /room\.log|pendingAssignment|pendingFeud|hidden|ducats|garrison/);
});

test('UI-27 menu journal entry opens the dedicated journal overlay', () => {
  const start = app.indexOf('  function handleGameMenuAction(kind)');
  const end = app.indexOf('\n  function cargoSummary', start);
  const code = app.slice(start, end);
  assert.match(code, /kind === 'journal'/);
  assert.match(code, /renderJournalOverlay\(\)/);
});


test('UI-28 adds a global end-game voting card driven by endGameConsensus', () => {
  assert.match(index, /id="endGameVoteOverlay" class="end-game-vote-overlay hidden"/);
  assert.match(index, /id="endGameVotePlayers"/);
  assert.match(index, /id="endGameVoteActions"/);
  assert.match(app, /function renderEndGameVoteOverlay\(forceOpen = false\)/);
  assert.match(app, /consensus\?\.status === 'proposed'/);
  assert.match(app, /consensus\?\.status === 'accepted'/);
  assert.match(styles, /UI-28 — global end-game consensus card/);
});

test('UI-28 voting card reuses canonical consensus socket commands without client-side voting rules', () => {
  const start = app.indexOf('  function openEndGameVoteOverlay()');
  const end = app.indexOf('\n  function renderEndGame()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /emitEndGameCommand\('proposeEndGame'\)/);
  assert.match(code, /emitEndGameCommand\('confirmEndGame'\)/);
  assert.match(code, /emitEndGameCommand\('rejectEndGame'\)/);
  assert.doesNotMatch(code, /socket\.emit\('proposeEndGame'/);
  assert.doesNotMatch(code, /finishAfterRound\s*=/);
});

test('UI-28 proposed consensus automatically presents all player vote states', () => {
  const start = app.indexOf('  function renderEndGameVoteOverlay(');
  const end = app.indexOf('\n  function renderEndGame()', start);
  const code = app.slice(start, end);
  assert.match(code, /for \(const player of room\.players \|\| \[\]\)/);
  assert.match(code, /confirmed\.has\(String\(player\.id\)\)/);
  assert.match(code, /Согласился/);
  assert.match(code, /Ожидается ответ/);
  assert.match(code, /overlay\.classList\.remove\('hidden'\)/);
});


test('UI-28 accepted consensus closes voting and leaves finalization server-authoritative', () => {
  const voteStart = app.indexOf('  function renderEndGameVoteOverlay(');
  const voteEnd = app.indexOf('\n  function renderEndGame()', voteStart);
  const vote = app.slice(voteStart, voteEnd);
  assert.match(vote, /const accepted = consensus\?\.status === 'accepted'/);
  assert.match(vote, /overlay\.classList\.add\('hidden'\)/);

  const panelStart = app.indexOf('  function renderEndGame()');
  const panelEnd = app.indexOf('\n  function render()', panelStart);
  const panel = app.slice(panelStart, panelEnd);
  assert.match(panel, /consensus\?\.status === 'accepted'/);
  assert.match(panel, /finishAfterRound/);
  assert.doesNotMatch(vote + panel, /room\.finished\s*=|room\.phase\s*=\s*['"]finished/);
});

test('UI-28 menu end-game entry opens the consensus card instead of hiding the action in Players', () => {
  const start = app.indexOf('  function handleGameMenuAction(kind)');
  const end = app.indexOf('\n  function cargoSummary', start);
  const code = app.slice(start, end);
  assert.match(code, /kind === 'endgame'/);
  assert.match(code, /openEndGameVoteOverlay\(\)/);
});


test('UI-29 uses a dedicated full-screen final results surface', () => {
  assert.match(index, /id="finalResultsPanel" class="final-results-panel final-results-screen hidden"/);
  assert.match(index, /id="finalResultsTitle"/);
  assert.match(index, /Общего победителя нет/);
  assert.match(styles, /UI-29 — dedicated final results screen/);
  assert.match(styles, /\.game\.finished-state > :not\(#finalResultsPanel\)/);
  assert.match(styles, /#finalResultsPanel\.final-results-screen/);
});

test('UI-29 preserves six canonical titles, shared holders and player metrics without a podium', () => {
  const start = app.indexOf('  function renderEndGame()');
  const end = app.indexOf('\n  function render()', start);
  const code = app.slice(start, end);
  assert.match(code, /for \(const title of result\.titles \|\| \[\]\)/);
  assert.match(code, /\(title\.winnerIds \|\| \[\]\)\.map\(playerName\)\.join\(', '\)/);
  assert.match(code, /for \(const row of result\.playerMetrics \|\| \[\]\)/);
  assert.doesNotMatch(code, /overallWinner|winnerOverall|podium|firstPlace|secondPlace|thirdPlace/);
  assert.doesNotMatch(index, /1 место|2 место|3 место|Общий победитель/i);
});

test('UI-29 finished render clears gameplay overlays before returning from render', () => {
  const start = app.indexOf('  function renderEndGame()');
  const end = app.indexOf('\n  function render()', start);
  const code = app.slice(start, end);
  assert.match(code, /closeGameMenu\(\)/);
  assert.match(code, /closeScoreOverlay\(\)/);
  assert.match(code, /closeJournalOverlay\(\)/);
  assert.match(code, /closeEndGameVoteOverlay\(\)/);
  assert.match(code, /state\.targeting = null/);
  assert.match(app, /renderEndGame\(\);\s*if \(r\.finished \|\| r\.phase === 'finished'\) return;/);
});

test('UI-29 reconnect to a finished room renders directly from server finalResult', () => {
  assert.match(app, /socket\.on\('roomState', room =>[\s\S]*?state\.room = room;[\s\S]*?render\(\)/);
  const start = app.indexOf('  function renderEndGame()');
  const end = app.indexOf('\n  function render()', start);
  const code = app.slice(start, end);
  assert.match(code, /const result = r\.finalResult \|\| \{ titles: \[\], playerMetrics: \[\] \}/);
});


test('UI-30 turns the existing players panel into a dedicated pre-game lobby surface', () => {
  assert.match(index, /id="lobbyHero" class="lobby-hero hidden"/);
  assert.match(index, /id="lobbyRoomCode"/);
  assert.match(index, /id="lobbyCapacity"/);
  assert.match(index, /id="lobbyRole"/);
  assert.match(index, /id="lobbyReadySummary"/);
  assert.match(styles, /UI-30 — dedicated pre-game lobby/);
  assert.match(styles, /\.game\.lobby-state #playersPanel/);
});

test('UI-30 lobby shell is driven only by projected room state', () => {
  const start = app.indexOf('  function renderLobbyShell()');
  const end = app.indexOf('\n  function renderPlayers()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /r\.hostId === state\.myId/);
  assert.match(code, /r\.leaderId/);
  assert.match(code, /r\.players/);
  assert.match(code, /r\.balanceCatalog\?\.session\?\.players/);
  assert.match(code, /player\.connected/);
  assert.match(code, /player\.ready/);
  assert.doesNotMatch(code, /socket\.emit\(/);
});

test('UI-30 preserves canonical lobby command ownership inside renderPlayers', () => {
  const start = app.indexOf('  function renderPlayers()');
  const end = app.indexOf('\n  function centerMapOnMe(', start);
  const code = app.slice(start, end);
  assert.match(code, /socket\.emit\('changeShip'/);
  assert.match(code, /socket\.emit\('setReady'/);
  assert.match(code, /setSeatingOrder/);
  assert.match(code, /setLeader/);
  assert.match(code, /socket\.emit\('kickPlayer'/);
  assert.match(code, /r\.players\.length >= r\.balanceCatalog\.session\.players\.min/);
  assert.match(code, /r\.balanceCatalog\.session\.players\.max/);
});

test('UI-30 invite and exit controls delegate to existing room controls', () => {
  assert.match(app, /\$\('lobbyCopyBtn'\)\.addEventListener\('click', \(\) => \$\('copyCodeBtn'\)\.click\(\)\)/);
  assert.match(app, /\$\('lobbyShareBtn'\)\.addEventListener\('click', \(\) => \$\('shareInviteBtn'\)\.click\(\)\)/);
  assert.match(app, /\$\('adminBackBtn'\)\.click\(\)/);
  assert.match(app, /\$\('closeRoomBtn'\)\.click\(\)/);
  assert.match(app, /\$\('leaveRoomBtn'\)\.click\(\)/);
});

test('UI-30 roomState reconnect returns directly to lobby state before game start', () => {
  assert.match(app, /socket\.on\('roomState', room =>[\s\S]*?state\.room = room;[\s\S]*?render\(\)/);
  assert.match(app, /renderLobbyShell\(\);\s*renderMobileHud\(\);/);
  assert.match(app, /game\.classList\.toggle\('lobby-state', lobby\)/);
});


test('UI-31 marks reconnect for authoritative rehydration instead of trusting stale local room state', () => {
  assert.match(app, /rehydrateOnNextRoomState: false/);
  assert.match(app, /socket\.on\('disconnect',[\s\S]*?state\.rehydrateOnNextRoomState = Boolean\(state\.code \|\| state\.room\)/);
  assert.match(app, /socket\.on\('roomState', room =>[\s\S]*?const rehydrating = state\.rehydrateOnNextRoomState/);
  assert.match(app, /if \(rehydrating\) \{[\s\S]*?resetTransientPresentationState\(\)/);
  assert.match(app, /state\.rehydrateOnNextRoomState = false/);
});

test('UI-31 clears only transient presentation state before rebuilding critical UI from roomState', () => {
  const start = app.indexOf('  function resetTransientPresentationState()');
  const end = app.indexOf('\n  function setError(', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  for (const token of [
    'state.selectedIslandId = null',
    'state.mapSelection = null',
    'state.mistCardRef = null',
    "state.characterPeek = ''",
    'state.mapMovePending = false',
    'state.targeting = null',
    'state.resultQueue = []',
    'state.activeResult = null',
    'state.toastQueue = []',
  ]) assert.ok(code.includes(token), token);
  assert.match(code, /decisionLayer/);
  assert.match(code, /resultLayer/);
  assert.match(code, /targetingBar/);
  assert.match(code, /eventFlowOverlay/);
  assert.doesNotMatch(code, /state\.room = null|state\.myId = null|state\.playerToken = null/);
});

test('UI-31 resume paths wait for a fresh authoritative snapshot before rendering stale room memory', () => {
  assert.match(app, /state\.rehydrateOnNextRoomState = true;\s*socket\.timeout\(15000\)\.emit\('resumeRoom'/);
  assert.match(app, /state\.rehydrateOnNextRoomState = true;\s*socket\.emit\('resumeRoom', \{ \.\.\.sess/);
  assert.match(app, /if \(state\.room && !state\.rehydrateOnNextRoomState\) render\(\)/);
});

test('UI-31 critical server-pending flows remain reconstructed in render after rehydration', () => {
  const start = app.indexOf('  function render() {');
  const end = app.indexOf('\n  function renderGameRoster()', start);
  const code = app.slice(start, end);
  assert.match(code, /refreshOpenSeaBattleFlow\(\)/);
  assert.match(code, /refreshOpenAssaultFlow\(\)/);
  assert.match(code, /renderEventFlowOverlay\(\)/);
  assert.match(code, /renderDecisionLayer\(\)/);
  assert.match(code, /renderEndGame\(\)/);
  assert.match(code, /if \(r\.finished \|\| r\.phase === 'finished'\) return/);
});

test('UI-31 refresh does not attempt to restore voluntary targeting or object sheets from localStorage', () => {
  for (const key of ['targeting','mapSelection','selectedIslandId','activeResult','resultQueue']) {
    assert.equal(app.includes(`localStorage.getItem('pervo:${key}'`), false, key);
    assert.equal(app.includes(`localStorage.setItem('pervo:${key}'`), false, key);
  }
});


test('UI-32 removes the obsolete mobile tab and duplicate action-dock architecture', () => {
  assert.doesNotMatch(index, /id="mobileGameNav"|data-mobile-nav=|id="mobileActionDock"|id="mobileSheetClose"|id="mobileSheetTitle"/);
  assert.doesNotMatch(app, /openMobileTab\(|MOBILE_TAB_TITLES|state\.mobileTab|mobileNavActions|mobileNavShip|dockRollBtn|dockSkipBtn|dockEndTurnBtn/);
  assert.doesNotMatch(styles, /\.mobile-game-nav|\.mobile-action-dock|#gameSidePanel\.mobile-open|data-mobile-tab=/);
});


test('UI-32 routes HUD and map context into map-first object sheets instead of mechanic tabs', () => {
  assert.match(app, /function renderFleetOverviewObjectSheet\(\)/);
  assert.match(app, /hudPlayerBtn'[\s\S]*?renderFleetOverviewObjectSheet/);
  assert.match(app, /document\.querySelectorAll\('\[data-hud-metric\]'\)/);
  assert.doesNotMatch(app, /hudCargoBtn'\)\.addEventListener\('click', renderFleetOverviewObjectSheet\)/);
  const start = app.indexOf('  function renderMapContext() {');
  const end = app.indexOf('\n  function actionBarDecisionLabel', start);
  const code = app.slice(start, end);
  assert.match(code, /renderCitadelObjectSheet/);
  assert.match(code, /renderOwnIslandObjectSheet/);
  assert.match(code, /renderForeignIslandObjectSheet/);
  assert.match(code, /renderPlayerObjectSheet/);
  assert.match(code, /renderAnchorEncounterSheet/);
  assert.match(code, /renderDecisionLayer/);
  assert.doesNotMatch(code, /openMobileTab|mobile-open|data-mobile-tab/);
});

test('UI-32 retains legacy panel DOM only as internal canonical action hosts', () => {
  for (const id of ['eventActions','politicsActions','fleetActions','escortCargoActions','islandActions','combatActions','allianceActions']) {
    assert.match(index, new RegExp(`id="${id}"`), id);
  }
  assert.match(app, /Existing renderers remain authoritative for legality, prices and socket payloads/);
  assert.match(app, /Existing event\/legendary renderers remain authoritative for all legality and payloads/);
});


test('UI-33 scenario: first turn navigation exposes canonical roll, stay and map movement commands', () => {
  const start = app.indexOf('  function renderGameActionBar()');
  const end = app.indexOf('\n  function recordJournal(', start);
  assert.ok(start >= 0 && end > start);
  const actionBar = app.slice(start, end);
  assert.match(actionBar, /mine\.phase === 'navigation' && mine\.roll === null/);
  assert.match(actionBar, /socket\.emit\('rollMove', \{\}, handleGameAck\)/);
  assert.match(actionBar, /socket\.emit\('skipNavigation', \{\}, handleGameAck\)/);
  assert.match(actionBar, /r\.reachableCells/);

  const moveStart = app.indexOf('  function moveToMapCell(');
  const moveEnd = app.indexOf('\n  function renderMapContext()', moveStart);
  const move = app.slice(moveStart, moveEnd);
  assert.match(move, /state\.mapMovePending = true/);
  assert.match(move, /socket\.emit\('moveTo', \{ row: cell\.row, col: cell\.col \}/);
  assert.match(move, /if \(res\?\.ok\) return/);

  const mapStart = app.indexOf('  function renderMap()');
  const mapEnd = app.indexOf('\n  function placeCell(', mapStart);
  const map = app.slice(mapStart, mapEnd);
  assert.match(map, /navigation-hit/);
  assert.match(map, /b\.addEventListener\('click', \(\) => moveToMapCell\(cell\)\)/);
});

test('UI-33 scenario: action phase routes island, Citadel and combat through map-first flows', () => {
  const start = app.indexOf('  function renderMapContext() {');
  const end = app.indexOf('\n  function actionBarDecisionLabel', start);
  const code = app.slice(start, end);
  assert.match(code, /mine\.atCitadel/);
  assert.match(code, /renderCitadelObjectSheet/);
  assert.match(code, /renderOwnIslandObjectSheet/);
  assert.match(code, /renderForeignIslandObjectSheet/);
  assert.match(code, /renderPlayerObjectSheet/);
  assert.match(code, /renderAnchorEncounterSheet/);
  assert.match(code, /mine\.actionsLeft/);
  assert.doesNotMatch(code, /openMobileTab|mobileGameNav|mobileActionDock/);
});


test('UI-33 scenario: trade and island management keep canonical action owners', () => {
  const islandStart = app.indexOf('  function renderOwnIslandActionView(');
  const islandEnd = app.indexOf('\n  function handleObjectSheetBack', islandStart);
  const island = app.slice(islandStart, islandEnd);
  assert.match(island, /renderIsland\(\)/);
  assert.match(island, /moveCanonicalActionGroup\(\$\('islandActions'\), labels\[view\], primaryActions\)/);
  assert.match(island, /renderFleet\(\)/);
  assert.match(island, /moveCanonicalActionGroup\(\$\('fleetActions'\)/);
  assert.doesNotMatch(island, /socket\.emit\(/);

  const citadelStart = app.indexOf('  function renderCitadelObjectSheet(');
  const citadelEnd = app.indexOf('\n  function refreshOpenCitadelSheet', citadelStart);
  const citadel = app.slice(citadelStart, citadelEnd);
  assert.match(citadel, /renderFleet\(\)/);
  assert.match(citadel, /renderTrade\(\)/);
  assert.match(citadel, /moveCanonicalCitadelFleetActions/);
  assert.match(citadel, /appendCanonicalCitadelTradeActions/);
  assert.doesNotMatch(citadel, /socket\.emit\(/);
});

test('UI-33 scenario: character, Scout, assignment and expedition stay in their canonical private flows', () => {
  const characterStart = app.indexOf('  function renderCharacterObjectSheet()');
  const characterEnd = app.indexOf('\n  function refreshOpenCharacterSheet', characterStart);
  const character = app.slice(characterStart, characterEnd);
  assert.match(character, /if \(!mine \|\| state\.spectating\) return/);
  assert.match(character, /renderFleet\(\)/);
  assert.match(character, /moveCanonicalCharacterActions/);
  assert.doesNotMatch(character, /socket\.emit\(/);

  assert.match(app, /mode === 'scout-garrison'/);
  assert.match(app, /mode === 'scout-money'/);
  assert.match(app, /socket\.emit\('useScout'/);
  assert.match(app, /function renderGoalsObjectSheet\(\)/);
  assert.match(app, /renderAssignments\(\)/);
  assert.match(app, /renderLegendaryPlaces\(\)/);
  assert.match(app, /moveCanonicalGoalActions/);
});

test('UI-33 scenario: event → feud → assignment is one server-driven mandatory sequence', () => {
  const flowStart = app.indexOf('  function renderEventFlowOverlay()');
  const flowEnd = app.indexOf('\n  function feudDecisionSceneHtml', flowStart);
  const flow = app.slice(flowStart, flowEnd);
  assert.match(flow, /room\.phase !== 'event'/);
  assert.match(flow, /Событие/);
  assert.match(flow, /Вражда/);
  assert.match(flow, /Поручение/);
  assert.match(flow, /eventFlowStageStatus/);

  const decisionStart = app.indexOf('  function renderDecisionLayer()');
  const decisionEnd = app.indexOf('\n  function ', decisionStart + 1);
  const decision = app.slice(decisionStart, decisionEnd);
  assert.match(decision, /mobileDecisionDescriptor\(state\.room\)/);
  assert.match(decision, /if \(descriptor && state\.targeting\) state\.targeting = null/);
  assert.match(decision, /if \(descriptor && state\.mapSelection\) closeMapInfo\(\)/);
});

test('UI-33 scenario: anchor, sea battle and assault use canonical actions then authoritative results', () => {
  const anchorStart = app.indexOf('  function renderAnchorEncounterSheet(');
  const anchorEnd = app.indexOf('\n  function refreshOpenAnchorSheet', anchorStart);
  const anchor = app.slice(anchorStart, anchorEnd);
  assert.match(anchor, /renderAnchors\(\)/);
  assert.match(anchor, /moveCanonicalAnchorActions/);
  assert.doesNotMatch(anchor, /socket\.emit\('fightAnchor'/);

  const seaStart = app.indexOf('  function renderSeaBattleFlowSheet(');
  const seaEnd = app.indexOf('\n  function refreshOpenSeaBattleFlow', seaStart);
  const sea = app.slice(seaStart, seaEnd);
  assert.match(sea, /renderCombat\(\)/);
  assert.match(sea, /data\.combatKind === 'sea'|dataset\.combatKind === 'sea'/);
  assert.doesNotMatch(sea, /socket\.emit\(/);

  const assaultStart = app.indexOf('  function renderAssaultFlowSheet(');
  const assaultEnd = app.indexOf('\n  function refreshOpenAssaultFlow', assaultStart);
  const assault = app.slice(assaultStart, assaultEnd);
  assert.match(assault, /renderCombat\(\)/);
  assert.match(assault, /dataset\.combatKind === 'assault'/);
  assert.doesNotMatch(assault, /socket\.emit\(/);

  assert.match(app, /socket\.on\('battleResolved'/);
  assert.match(app, /enqueueResult/);
});

test('UI-33 scenario: alliance proposal and response stay split between player sheet and Decision Layer', () => {
  const playerStart = app.indexOf('  function renderPlayerObjectSheet(');
  const playerEnd = app.indexOf('\n  function showPlayerMapInfo', playerStart);
  const player = app.slice(playerStart, playerEnd);
  assert.match(player, /appendCanonicalAllianceActions/);
  assert.doesNotMatch(player, /socket\.emit\('proposeAlliance'|socket\.emit\('breakAlliance'/);

  const descriptorStart = app.indexOf('  function mobileDecisionDescriptor(');
  const descriptorEnd = app.indexOf('\n  function renderControls()', descriptorStart);
  const descriptor = app.slice(descriptorStart, descriptorEnd);
  assert.match(descriptor, /pendingAlliance/);
  assert.match(descriptor, /allianceActions/);
});

test('UI-33 scenario: reconnect rebuilds mandatory flow from roomState and drops voluntary local presentation', () => {
  const roomStart = app.indexOf("socket.on('roomState', room =>");
  const roomEnd = app.indexOf("socket.on('adminRoomState'", roomStart);
  const roomState = app.slice(roomStart, roomEnd);
  assert.match(roomState, /resetTransientPresentationState\(\)/);
  assert.match(roomState, /state\.room = room/);
  assert.match(roomState, /render\(\)/);

  const renderStart = app.indexOf('  function render() {');
  const renderEnd = app.indexOf('\n  function renderGameRoster()', renderStart);
  const render = app.slice(renderStart, renderEnd);
  assert.match(render, /renderEventFlowOverlay\(\)/);
  assert.match(render, /renderDecisionLayer\(\)/);
  assert.match(render, /refreshOpenSeaBattleFlow\(\)/);
  assert.match(render, /refreshOpenAssaultFlow\(\)/);
  assert.match(render, /renderEndGame\(\)/);
});

test('UI-33 scenario: round transitions are ambient while finished state becomes canonical final screen', () => {
  const ambientStart = app.indexOf('  function processAmbientRoomState(');
  const ambientEnd = app.indexOf('\n  function ', ambientStart + 1);
  const ambient = app.slice(ambientStart, ambientEnd);
  assert.match(ambient, /next\.round !== prev\.round/);
  assert.match(ambient, /Начался раунд/);
  assert.match(ambient, /enqueueToast/);

  const endStart = app.indexOf('  function renderEndGame()');
  const endEnd = app.indexOf('\n  function renderMobileHud()', endStart);
  const endGame = app.slice(endStart, endEnd);
  assert.match(endGame, /r\?\.finished \|\| r\?\.phase === 'finished'/);
  assert.match(endGame, /const result = r\.finalResult/);
  assert.match(endGame, /result\.titles/);
  assert.match(endGame, /result\.playerMetrics/);
  assert.match(endGame, /title\.winnerIds/);
  assert.doesNotMatch(endGame, /podium|overallWinner/i);
});

test('UI-33 scenario matrix covers every canonical mobile regression path', () => {
  const source = fs.readFileSync(__filename, 'utf8');
  for (const token of [
    'first turn navigation',
    'trade and island management',
    'character, Scout, assignment and expedition',
    'event → feud → assignment',
    'anchor, sea battle and assault',
    'alliance proposal and response',
    'reconnect rebuilds mandatory flow',
    'round transitions are ambient',
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^$\\{}()|[\]\\]/g, '\\$&')));
});


test('UI-34 declares viewport-fit and PWA-safe mobile viewport behavior', () => {
  assert.match(index, /name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/);
  assert.match(index, /name="mobile-web-app-capable" content="yes"/);
  assert.match(index, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(styles, /height: 100vh;\s*height: 100dvh;/);
  assert.match(styles, /env\(safe-area-inset-top, 0px\)/);
  assert.match(styles, /env\(safe-area-inset-bottom, 0px\)/);
  assert.match(styles, /env\(safe-area-inset-left, 0px\)/);
  assert.match(styles, /env\(safe-area-inset-right, 0px\)/);
});

test('UI-34 keeps mandatory actions reachable on short mobile screens', () => {
  const start = styles.indexOf('/* UI-34 — mobile device matrix');
  assert.ok(start >= 0);
  const code = styles.slice(start);
  assert.match(code, /\.decision-card \{[\s\S]*?max-height:[\s\S]*?overflow|\.decision-card \{[\s\S]*?max-height/);
  assert.match(code, /\.decision-actions,[\s\S]*?\.object-sheet-actions[\s\S]*?position: sticky;[\s\S]*?bottom: 0/);
  assert.match(code, /@media \(max-width: 380px\), \(max-height: 700px\) and \(max-width: 900px\)/);
  assert.match(code, /\.decision-card \{[\s\S]*?max-height: 88dvh/);
  assert.doesNotMatch(code, /\.object-sheet\.expanded \{[\s\S]*?max-height: 90dvh/);
});

test('UI-34 covers portrait phones and secondary landscape without a second UX architecture', () => {
  const start = styles.indexOf('/* UI-34 — mobile device matrix');
  const code = styles.slice(start);
  assert.match(code, /Small Android \/ compact iPhone portrait/);
  assert.match(code, /@media \(max-width: 900px\) and \(orientation: landscape\) and \(max-height: 520px\)/);
  assert.match(styles, /body\.game-active \.game-roster \{\s*display: none !important;/);
  assert.match(code, /max-height: calc\(100dvh - env\(safe-area-inset-top, 0px\) - env\(safe-area-inset-bottom, 0px\) - 8px\)/);
  assert.doesNotMatch(code, /mobileLandscapeApp|landscapeGameShell|desktopMobileMode/);
});


test('UI-35 exposes mandatory interaction state to assistive technology', () => {
  assert.match(index, /id="gameActionBar"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(index, /id="targetingBar"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*aria-label="Режим выбора цели"/);
  assert.match(index, /id="decisionLayer"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="decisionTitle"/);
  assert.match(index, /id="decisionActions"[^>]*role="group"[^>]*aria-label="Варианты решения"/);
  assert.match(index, /id="resultLayer"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(index, /id="toastStack"[^>]*aria-live="polite"/);
});

test('UI-35 provides visible keyboard focus, disabled feedback and mobile tap targets', () => {
  const start = styles.indexOf('/* UI-35 — accessibility and interaction quality */');
  assert.ok(start >= 0);
  const code = styles.slice(start);
  assert.match(code, /:where\(button, input, select,[\s\S]*?\):focus-visible \{/);
  assert.match(code, /outline: 3px solid var\(--accent\)/);
  assert.match(code, /button:disabled,[\s\S]*?button\[aria-disabled="true"\]/);
  assert.match(code, /body\.game-active button:not\([\s\S]*?min-height: 44px/);
});

test('UI-35 reduced-motion disables decorative motion and targeting pulse', () => {
  const start = styles.indexOf('/* UI-35 — accessibility and interaction quality */');
  const code = styles.slice(start);
  assert.match(code, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(code, /animation-duration: \.01ms !important/);
  assert.match(code, /transition-duration: \.01ms !important/);
  assert.match(code, /\.targeting-hit,[\s\S]*?\.targeting-marker,[\s\S]*?\.sea-motion-layer[\s\S]*?animation: none !important/);
});


test('UI-36 defines one reusable visual token system for the mobile game shell', () => {
  assert.match(styles, /--surface-deep:/);
  assert.match(styles, /--surface-raised:/);
  assert.match(styles, /--gold-soft:/);
  assert.match(styles, /--success:/);
  assert.match(styles, /--warning:/);
  assert.match(styles, /--info:/);
  assert.match(styles, /--radius-sm:/);
  assert.match(styles, /--radius-lg:/);
  assert.match(styles, /--shadow-float:/);
  assert.match(styles, /--type-kicker:/);
});

test('UI-36 applies shared surface and typography grammar across HUD, sheets, decisions and results', () => {
  const start = styles.indexOf('/* UI-36 — canonical visual kit.');
  assert.ok(start >= 0);
  const code = styles.slice(start);
  assert.match(code, /\.game-hud, \.game-action-bar, \.targeting-bar/);
  assert.match(code, /\.object-sheet, \.decision-card, \.result-card, \.game-menu-panel/);
  assert.match(code, /\.decision-kicker, \.result-kicker, \.object-sheet-kind/);
  assert.match(code, /font: var\(--type-kicker\)/);
  assert.match(code, /var\(--shadow-sheet\)/);
});

test('UI-36 gives decisions, battle warnings, targeting and result tones distinct visual grammar', () => {
  const start = styles.indexOf('/* UI-36 — canonical visual kit.');
  const end = styles.indexOf('/* UI-37 — final local visual assets */', start);
  const code = styles.slice(start, end >= 0 ? end : undefined);
  assert.match(code, /\.decision-card \{[\s\S]*?border-top-color: var\(--gold\)/);
  assert.match(code, /result-layer\[data-tone="success"\]/);
  assert.match(code, /result-layer\[data-tone="danger"\]/);
  assert.match(code, /result-layer\[data-tone="info"\]/);
  assert.match(code, /\.sea-battle-warnings > div, \.sea-battle-note/);
  assert.match(code, /body\.game-active\.targeting-open \.targeting-bar/);
  assert.doesNotMatch(code, /url\([^)]*final|asset\/final|illustration-final/);
});


test('UI-37 replaces HUD emoji with the local SVG icon sprite', () => {
  assert.match(index, /\/assets\/ui-icons\.svg#ship/);
  for (const icon of ['coin','glory','army','cannon','character','cards','goal','politics','cargo','menu']) {
    assert.match(index, new RegExp('/assets/ui-icons\\.svg#' + icon));
  }
  const hudStart = index.indexOf('id="gameHud"');
  const hudEnd = index.indexOf('</section>', hudStart);
  const hud = index.slice(hudStart, hudEnd);
  assert.doesNotMatch(hud, /🪙|💥|♟|☰/);
});

test('UI-37 wires final scene assets into events, combat, legendary goals and final results', () => {
  const start = styles.indexOf('/* UI-37 — final local visual assets */');
  assert.ok(start >= 0);
  const code = styles.slice(start);
  assert.match(code, /url\('\/assets\/event-scene\.svg'\)/);
  assert.match(code, /url\('\/assets\/battle-scene\.svg'\)/);
  assert.match(code, /url\('\/assets\/legendary-scene\.svg'\)/);
  assert.match(code, /url\('\/assets\/final-scene\.svg'\)/);
  assert.match(index, /class="event-flow-art"/);
  assert.match(index, /class="final-results-art"/);
});


test('UI-38 adds short non-blocking motion for sheets, decisions, results, events and route targets', () => {
  const start = styles.indexOf('/* UI-38 — motion and audio polish.');
  assert.ok(start >= 0);
  const code = styles.slice(start);
  assert.match(code, /ui-sheet-in 180ms/);
  assert.match(code, /ui-card-in 170ms/);
  assert.match(code, /ui-result-in 210ms/);
  assert.match(code, /ui-event-in 180ms/);
  assert.match(code, /ui-route-breathe 1\.35s/);
  assert.doesNotMatch(code, /animation-delay:\s*[1-9]/);
});

test('UI-38 fully suppresses gameplay motion when reduced motion is requested', () => {
  const start = styles.indexOf('/* UI-38 — motion and audio polish.');
  const code = styles.slice(start);
  assert.match(code, /prefers-reduced-motion: reduce/);
  assert.match(code, /animation: none !important/);
  assert.match(code, /transition: none !important/);
  assert.match(code, /\.targeting-hit, \.targeting-marker/);
});

test('UI-38 uses local Web Audio cues without external audio assets or authoritative state changes', () => {
  assert.match(app, /function playUiCue\(kind = 'confirm'\)/);
  assert.match(app, /window\.AudioContext \|\| window\.webkitAudioContext/);
  assert.match(app, /function cueForResult\(result\)/);
  assert.match(app, /playUiCue\(cueForResult\(result\)\)/);
  assert.match(app, /playUiCue\('confirm'\)/);
  assert.doesNotMatch(app, /new Audio\(['"]https?:\/\//);
});


test('UI-39 removes viewport gating from canonical Decision and Result presentation', () => {
  const decisionStart = app.indexOf('function renderDecisionLayer()');
  const decisionEnd = app.indexOf('\n  function ', decisionStart + 20);
  const decision = app.slice(decisionStart, decisionEnd);
  assert.doesNotMatch(decision, /max-width: 900px/);
  assert.match(decision, /mobileDecisionDescriptor\(state\.room\)/);

  const resultStart = app.indexOf('function renderResultLayer()');
  const resultEnd = app.indexOf('\n  function anchorResultCard', resultStart);
  const result = app.slice(resultStart, resultEnd);
  assert.doesNotMatch(result, /max-width: 900px/);
  assert.match(result, /mobileDecisionDescriptor\(state\.room\)/);
});

test('UI-39 routes desktop map objects through the same canonical Object Sheet renderers', () => {
  const showStart = app.indexOf('function showMapInfo(kind, data, anchor = null)');
  const showEnd = app.indexOf('\n  function addMapCellButton', showStart);
  const show = app.slice(showStart, showEnd);
  assert.match(show, /renderObjectSheetFromMapInfo\(kind, data\)/);
  assert.doesNotMatch(show, /max-width: 900px/);

  const playerStart = app.indexOf('function showPlayerMapInfo(');
  const playerEnd = app.indexOf('\n  function showMapInfo', playerStart);
  const player = app.slice(playerStart, playerEnd);
  assert.match(player, /renderPlayerObjectSheet\(player\)/);
  assert.doesNotMatch(player, /max-width: 900px/);
});

test('UI-39 expands the map-first shell on desktop without creating a second UX system', () => {
  const start = styles.indexOf('/* UI-39 — desktop expansion');
  assert.ok(start >= 0);
  const code = styles.slice(start);
  assert.match(code, /@media \(min-width: 901px\)/);
  assert.match(code, /#gameWorldShell[\s\S]*?position: fixed/);
  assert.match(code, /\.game-roster[\s\S]*?right: 18px/);
  assert.match(code, /\.object-sheet[\s\S]*?right: 18px/);
  assert.match(code, /\.decision-layer,[\s\S]*?\.result-layer/);
  assert.match(code, /\.game-action-bar[\s\S]*?bottom: 18px/);
  assert.doesNotMatch(code, /desktop-(nav|panel|action|decision)/);
});



test('UI-40 canonical mobile map controls stay compact and HUD identity clips safely', () => {
  assert.match(index, /id="zoomToggle"[^>]*aria-controls="zoomPopover"/);
  assert.match(index, /id="zoomPopover" class="map-zoom-popover hidden"/);
  assert.match(index, /id="centerMe" class="map-tool-icon map-center-me"/);
  assert.match(index, /class="hud-player-copy"/);
  assert.match(app, /\$\('zoomToggle'\)\.addEventListener\('click'/);
  const start = styles.indexOf('/* UI-40 — staging visual normalization.');
  assert.ok(start >= 0);
  const code = styles.slice(start);
  assert.match(code, /\.hud-player-copy strong,[\s\S]*?text-overflow: ellipsis/);
  assert.match(code, /\.map-toolbar \.map-tool-icon \{[\s\S]*?width: 30px;[\s\S]*?height: 30px/);
  assert.match(code, /\.map-zoom-popover\.hidden \{ display: none; \}/);
  assert.match(code, /\.game-world-shell \.map-toolbar \{[\s\S]*?gap: 6px/);
});


test('UI-40 canonical mobile shell hides the gameplay title bar without a map-control plate', () => {
  const start = styles.indexOf('/* UI-40 — staging visual normalization.');
  assert.ok(start >= 0);
  const code = styles.slice(start);
  assert.match(code, /body\.game-active \.topbar[\s\S]*?height: 0;[\s\S]*?background: transparent/);
  assert.match(code, /\.topbar > div:first-child,[\s\S]*?\.topbar \.connection[\s\S]*?display: none/);
  assert.match(code, /\.game-world-shell \.map-toolbar[\s\S]*?width: 30px;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none/);
});


test('UI-40 canonical map tools are circular 30px controls ordered beneath the menu', () => {
  const start = styles.indexOf('/* UI-40 — staging visual normalization.');
  assert.ok(start >= 0);
  const code = styles.slice(start);
  assert.match(code, /\.map-toolbar \.map-tool-icon \{[\s\S]*?width: 30px;[\s\S]*?height: 30px;[\s\S]*?border-radius: 50%;[\s\S]*?aspect-ratio: 1 \/ 1/);
  assert.match(code, /\.map-center-me \{\s*order: 1;/);
  assert.match(code, /\.map-zoom-control \{ order: 2; \}/);
});


test('UI-40 anchor markers render without a translucent backing plate', () => {
  const anchorBlocks = [...styles.matchAll(/\.canonical-map-art \.anchor-marker \{([\s\S]*?)\n\}/g)];
  assert.ok(anchorBlocks.length > 0);
  const code = anchorBlocks.at(-1)[0];
  assert.match(code, /background: transparent/);
  assert.match(code, /box-shadow: none/);
  assert.match(code, /backdrop-filter: none/);
});


test('UI-40 roster uses authoritative turn order for active next and waiting status dots', () => {
  const start = app.indexOf('  function renderGameRoster()');
  const end = app.indexOf('\n  function renderLobbyShell()', start);
  assert.ok(start >= 0 && end > start);
  const code = app.slice(start, end);
  assert.match(code, /const orderedIds = Array\.isArray\(r\.order\)/);
  assert.match(code, /const activeIndex = orderedIds\.indexOf\(r\.activePlayerId\)/);
  assert.match(code, /orderedIds\[\(activeIndex \+ 1\) % orderedIds\.length\]/);
  assert.match(code, /orderedIds\.length > 1/);
  assert.match(code, /turnStatus = isActive \? 'active' : isNext \? 'next' : 'waiting'/);
  assert.match(code, /roster-turn-dot-/);
  assert.match(code, /shipName\(player\.shipClass\)/);
  assert.doesNotMatch(code, /status\.textContent = player\.id === r\.activePlayerId/);

  const cssStart = styles.indexOf('/* UI-40 — staging visual normalization.');
  assert.ok(cssStart >= 0);
  const css = styles.slice(cssStart);
  assert.match(css, /\.roster-player[\s\S]*?background: transparent;[\s\S]*?box-shadow: none/);
  assert.match(css, /\.roster-copy[\s\S]*?background: rgba\(7,31,37,\.62\)/);
  assert.match(css, /\.roster-turn-dot-active \{ background: #38d878; \}/);
  assert.match(css, /\.roster-turn-dot-next \{ background: #ef4444; \}/);
  assert.match(css, /\.roster-turn-dot-waiting \{ background: #aab5b8; \}/);
});


test('UI-40 mobile HUD integrates connection status and uses the canonical tile size', () => {
  assert.match(index, /id="hudConnection" class="hud-connection"/);
  assert.match(app, /hudConnection\.textContent = yes \? '● онлайн' : '○ нет связи'/);
  assert.match(styles, /body\.game-active \.topbar \.connection[\s\S]*?display: none;/);
  assert.match(styles, /--hud-tile: 44px/);
  assert.match(styles, /body\.game-active \.hud-menu-btn[\s\S]*?width: var\(--hud-tile\) !important;[\s\S]*?height: var\(--hud-tile\) !important/);
});

