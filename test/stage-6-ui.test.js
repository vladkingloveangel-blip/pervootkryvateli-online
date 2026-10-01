const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

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
