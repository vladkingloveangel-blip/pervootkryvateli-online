const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  projectOpponentFacingRoomView,
  IMPLEMENTED_POLICY_KEYS,
  SCOUT_RUNTIME_ENABLED,
  projectRoomForViewer,
  projectPlayerForViewer,
  projectIslandForViewer,
  projectPendingForViewer,
} = require('../state-projection');

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fixturePath = path.join(__dirname, 'fixtures', 'visibility-matrix.json');

function player(id = 'p1') {
  return {
    id,
    name: id === 'p1' ? 'Alice' : 'Bob',
    color: id === 'p1' ? 'red' : 'blue',
    shipClass: 'frigate',
    level: 3,
    row: 5,
    col: 7,
    connected: true,
    ready: true,
    glory: 9,
    fleetPoints: 8,
    armyPoints: 7,
    islandCount: 2,
    suzerainId: 'state-a',
    enemyFactionIds: ['state-b'],
    ducats: 'SECRET_DUCATS',
    character: { id: 'scout', name: 'SECRET_CHARACTER', admiraltyLevel: 2, secretNested: 'SECRET_CHARACTER_NESTED' },
    activeAssignment: {
      instanceId: 'SECRET_ASSIGNMENT_INSTANCE',
      factionId: 'state-a',
      id: 'assignment-1',
      text: 'SECRET_ASSIGNMENT',
      reward: 20,
      type: 'visit-island',
      progress: { kind: 'visit', completedStopCount: 1, secretNested: 'SECRET_ASSIGNMENT_PROGRESS' },
    },
    hasActiveAssignment: true,
    assignmentPriority: { kind: 'building', text: 'SECRET_ASSIGNMENT_HINT', secretNested: 'SECRET_HINT' },
    specialCards: ['SECRET_SPECIAL_CARD'],
    specialCardCount: 1,
    legendaryCards: [{ id: 'mist-path', name: 'SECRET_LEGENDARY', handIndex: 0, secretNested: 'SECRET_LEGENDARY_NESTED' }],
    legendaryCardCount: 1,
    playableLegendaryCards: [{ source: 'legendary', index: 0, id: 'mist-path', kind: 'mist-path', name: 'SECRET_LEGENDARY' }],
    savedEventCards: [{ id: 'saved-1', kind: 'cargo', name: 'SECRET_SAVED_EVENT', goodId: 'spice', secretNested: 'SECRET_SAVED_NESTED' }],
    savedEventCardCount: 1,
    activeExpedition: { cardId: 'exp-1', name: 'SECRET_EXPEDITION', placeId: 'place-1', acceptedRound: 4, requiresLeaveAndReturn: true, secretNested: 'SECRET_EXPEDITION_NESTED' },
    hasActiveExpedition: true,
    cargo: { goodId: 'spice', name: 'Spice', quantity: 3, value: 12, secretNested: 'SECRET_CARGO_UNKNOWN' },
    cargoCapacity: 5,
    totalCargoCapacity: 7,
    stats: { artillery: 4, army: 3, cargo: 5, moveMod: 1, secretNested: 'SECRET_STATS_UNKNOWN' },
    assaultArmy: 3,
    fleetArtillery: 6,
    upgrades: [{ id: 'guns-1', name: 'Guns', branch: 'guns', active: true, disabledByLevel: false, missingRequirement: false, secretNested: 'SECRET_UPGRADE_UNKNOWN' }],
    disabledUpgradeIds: [],
    upgradeSlots: 3,
    escorts: [{ id: 'escort-1', type: 'merchant', special: false, active: true, inactiveReason: null, cargo: { goodId: 'tea', quantity: 2, value: 6, secretNested: 'SECRET_ESCORT_CARGO_UNKNOWN' }, secretNested: 'SECRET_ESCORT_UNKNOWN' }],
    levelInactiveEscortIds: [],
    shipyardSlots: 2,
    escortUseLimit: 2,
    nextEscortPrice: 15,
    nextLevel: { level: 4, price: 40, secretNested: 'SECRET_NEXT_LEVEL_UNKNOWN' },
    atCitadel: false,
    inPeaceZone: false,
    skipTurns: 0,
    phase: 'actions',
    roll: 4,
    movePoints: 2,
    actionsLeft: 1,
    allyIds: ['p3'],
    namedPlaceCards: [{ id: 'discovery-1', name: 'Known Place', placeId: 'place-a', secretNested: 'SECRET_DISCOVERY_UNKNOWN' }],
    namedPlaceCardCount: 1,
    expeditionHistory: [{ id: 'history-1', cardId: 'old-exp', name: 'Completed Expedition', placeId: 'place-old', completedRound: 2, secretNested: 'SECRET_HISTORY_UNKNOWN' }],
    expeditionHistoryCount: 1,
    unknownPlayerField: 'SECRET_UNKNOWN_PLAYER',
  };
}

function island(ownerId = 'p1') {
  return {
    id: 'island-1',
    name: 'Port Royal',
    kind: 'island',
    faction: 'state-a',
    area: 8,
    army: 1,
    resources: ['wood'],
    ownerId,
    availableGoods: ['tea'],
    buildings: [{ index: 0, type: 'fort', level: 2, name: 'Fort II', supported: null, nextUpgrade: { type: 'fortress', level: 3, price: 20, name: 'Fortress', secretNested: 'SECRET_BUILDING_UPGRADE_UNKNOWN' }, secretNested: 'SECRET_BUILDING_UNKNOWN' }],
    usedArea: 2,
    effectiveArea: 8,
    status: 'city',
    garrisonType: 'SECRET_GARRISON_TYPE',
    garrisonName: 'SECRET_GARRISON_NAME',
    garrisonDefense: 4,
    defenseArmy: 11,
    defenseBreakdown: { total: 11, garrison: 0, hiredGarrison: 4, fortifications: 3, bastions: 0, ownerShip: 4, ownerShipPresent: true, secretNested: 'SECRET_DEFENSE_BREAKDOWN' },
    unknownIslandField: 'SECRET_UNKNOWN_ISLAND',
  };
}

function room() {
  return {
    version: '0.33.0',
    code: 'ABCDE',
    started: true,
    hostId: 'p1',
    leaderId: 'p1', // legacy-shaped compatibility field; current lobby gameplay does not use a leader
    round: 4,
    circle: 2,
    turnIndex: 0,
    activePlayerId: 'p1',
    seatingOrder: ['p1', 'p2'],
    order: ['p1', 'p2'],
    players: [player('p1'), player('p2')],
    islands: [island('p1')],
    pendingEvent: {
      id: 'pending-1',
      playerId: 'p1',
      kind: 'SECRET_PENDING_KIND',
      cardName: 'SECRET_PENDING_CARD',
      goodId: 'SECRET_PENDING_GOOD',
      options: [{ id: 'choice-1', name: 'SECRET_PENDING_OPTION', secretNested: 'SECRET_PENDING_NESTED' }],
      unknownPendingField: { deeper: 'SECRET_PENDING_UNKNOWN' },
    },
    legendaryPlaces: [{ id: 'place-a', name: 'Legendary Place', exploredBy: 'p2' }],
    namedPlaceCards: [{ id: 'named-a', name: 'Named Place', placeId: 'place-a', claimedBy: 'p2' }],
    characterCatalog: { scout: { id: 'scout', name: 'Scout', admiraltyLevel: 2, acquireActionCost: 1, useActionCost: 1, unknownDefinitionField: 'SECRET_UNKNOWN_CATALOG_FIELD' } },
    unknownRootField: 'SECRET_UNKNOWN_ROOT',
  };
}

function assertPrivatePlayerKeysAbsent(view) {
  for (const key of [
    'ducats', 'debt', 'nextTurnEffects', 'character', 'activeAssignment', 'hasActiveAssignment', 'assignmentPriority',
    'specialCards', 'specialCardCount', 'legendaryCards', 'legendaryCardCount',
    'playableLegendaryCards', 'savedEventCards', 'savedEventCardCount',
    'activeExpedition', 'hasActiveExpedition',
  ]) {
    assert.equal(has(view, key), false, key + ' must be omitted');
  }
}

test('1. unknown root field does not pass projection', () => {
  const projected = projectRoomForViewer(room(), { viewerId: 'p2' });
  assert.equal(has(projected, 'unknownRootField'), false);
});

test('2. unknown player field does not pass projection', () => {
  const projected = projectPlayerForViewer(player('p1'), { viewerId: 'p1' });
  assert.equal(has(projected, 'unknownPlayerField'), false);
});

test('3. unknown island field does not pass projection', () => {
  const projected = projectIslandForViewer(island('p1'), { viewerId: 'p1' });
  assert.equal(has(projected, 'unknownIslandField'), false);
});

test('4. unknown nested pending field does not pass projection', () => {
  const source = room().pendingEvent;
  const projected = projectPendingForViewer(source, { viewerId: 'p1' }, { actorField: 'playerId' });
  assert.equal(has(projected, 'unknownPendingField'), false);
  assert.equal(has(projected.options[0], 'secretNested'), false);
  assert.equal(JSON.stringify(projected).includes('SECRET_PENDING_NESTED'), false);
});

test('5. opponent receives no approved private player fields', () => {
  const projected = projectPlayerForViewer(player('p1'), { viewerId: 'p2' });
  assertPrivatePlayerKeysAbsent(projected);
  assert.equal(JSON.stringify(projected).includes('SECRET_DUCATS'), false);
  assert.equal(JSON.stringify(projected).includes('SECRET_ASSIGNMENT'), false);
});

test('6. public observer receives no approved private player fields', () => {
  const projected = projectPlayerForViewer(player('p1'), {});
  assertPrivatePlayerKeysAbsent(projected);
});

test('7. owner receives own approved private player fields', () => {
  const projected = projectPlayerForViewer(player('p1'), { viewerId: 'p1' });
  assert.equal(projected.ducats, 'SECRET_DUCATS');
  assert.equal(projected.character.id, 'scout');
  assert.equal(projected.activeAssignment.text, 'SECRET_ASSIGNMENT');
  assert.equal(projected.hasActiveAssignment, true);
  assert.deepEqual(projected.specialCards, ['SECRET_SPECIAL_CARD']);
  assert.equal(projected.legendaryCardCount, 1);
  assert.equal(projected.savedEventCardCount, 1);
  assert.equal(projected.activeExpedition.name, 'SECRET_EXPEDITION');
  assert.equal(projected.hasActiveExpedition, true);
});

test('8. owner of one player receives no private state of another player', () => {
  const projected = projectRoomForViewer(room(), { viewerId: 'p1' });
  const own = projected.players.find(p => p.id === 'p1');
  const other = projected.players.find(p => p.id === 'p2');
  assert.equal(own.ducats, 'SECRET_DUCATS');
  assertPrivatePlayerKeysAbsent(other);
});

test('9. island owner receives garrison-private properties', () => {
  const projected = projectIslandForViewer(island('p1'), { viewerId: 'p1' });
  assert.equal(projected.garrisonType, 'SECRET_GARRISON_TYPE');
  assert.equal(projected.garrisonDefense, 4);
  assert.equal(projected.defenseArmy, 11);
  assert.equal(projected.defenseBreakdown.hiredGarrison, 4);
});

test('10. island opponent receives neither garrison nor garrison-derived defense', () => {
  const projected = projectIslandForViewer(island('p1'), { viewerId: 'p2' });
  for (const key of ['garrisonType', 'garrisonName', 'garrisonDefense', 'defenseArmy', 'defenseBreakdown']) {
    assert.equal(has(projected, key), false, key + ' must be omitted');
  }
  assert.equal(JSON.stringify(projected).includes('SECRET_GARRISON'), false);
});

test('11. public ship, cargo, upgrades and escorts remain visible to opponent', () => {
  const projected = projectPlayerForViewer(player('p1'), { viewerId: 'p2' });
  assert.equal(projected.shipClass, 'frigate');
  assert.equal(projected.level, 3);
  assert.deepEqual(projected.stats, { artillery: 4, army: 3, cargo: 5, moveMod: 1 });
  assert.equal(projected.cargo.goodId, 'spice');
  assert.equal(projected.upgrades[0].id, 'guns-1');
  assert.equal(projected.escorts[0].id, 'escort-1');
  assert.equal(projected.escorts[0].cargo.goodId, 'tea');
});

test('12. suzerain relation remains public', () => {
  const projected = projectPlayerForViewer(player('p1'), { viewerId: 'p2' });
  assert.equal(projected.suzerainId, 'state-a');
});

test('13. completed discoveries and history remain public', () => {
  const projected = projectPlayerForViewer(player('p1'), { viewerId: 'p2' });
  assert.equal(projected.namedPlaceCards[0].placeId, 'place-a');
  assert.equal(projected.expeditionHistory[0].name, 'Completed Expedition');
  assert.equal(projected.expeditionHistoryCount, 1);
});

test('14. pendingActor receives private content only for own pending resolution', () => {
  const source = room().pendingEvent;
  const actor = projectPendingForViewer(source, { viewerId: 'p1' }, { actorField: 'playerId' });
  const other = projectPendingForViewer(source, { viewerId: 'p2' }, { actorField: 'playerId' });
  assert.equal(actor.kind, 'SECRET_PENDING_KIND');
  assert.equal(actor.cardName, 'SECRET_PENDING_CARD');
  assert.equal(actor.options[0].name, 'SECRET_PENDING_OPTION');
  assert.equal(other, null);
});

test('15. unrelated viewer receives no typed private pending object', () => {
  const projected = projectPendingForViewer(room().pendingEvent, { viewerId: 'p2' }, { actorField: 'playerId' });
  assert.equal(projected, null);
});

test('16. projection does not mutate input', () => {
  const source = room();
  const before = JSON.stringify(source);
  projectRoomForViewer(source, { viewerId: 'p1' });
  assert.equal(JSON.stringify(source), before);
});

test('17. nested output is detached from input', () => {
  const source = player('p1');
  const projected = projectPlayerForViewer(source, { viewerId: 'p1' });
  projected.cargo.quantity = 999;
  projected.upgrades[0].name = 'Changed';
  projected.activeAssignment.progress.kind = 'changed';
  assert.equal(source.cargo.quantity, 3);
  assert.equal(source.upgrades[0].name, 'Guns');
  assert.equal(source.activeAssignment.progress.kind, 'visit');
});

test('18. identical input and context produce deterministic deep-equal output', () => {
  const source = room();
  const a = projectRoomForViewer(source, { viewerId: 'p1' });
  const b = projectRoomForViewer(source, { viewerId: 'p1' });
  assert.deepEqual(a, b);
});

test('19. null/no viewer behaves as publicObserver', () => {
  const source = room();
  const a = projectRoomForViewer(source, null);
  const b = projectRoomForViewer(source, {});
  assert.deepEqual(a, b);
  assertPrivatePlayerKeysAbsent(a.players[0]);
});

test('20. legacy/forged scoutGrant context is ignored even though Scout runtime is enabled', () => {
  const context = {
    viewerId: 'p2',
    scoutGrant: { mode: 'selected-player-ducats', playerId: 'p1', islandId: 'island-1' },
  };
  const projectedPlayer = projectPlayerForViewer(player('p1'), context);
  const projectedIsland = projectIslandForViewer(island('p1'), context);
  assert.equal(SCOUT_RUNTIME_ENABLED, true);
  assert.equal(has(projectedPlayer, 'ducats'), false);
  assert.equal(has(projectedIsland, 'garrisonType'), false);
});

test('21. implemented policy exactly covers canonical fixture', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.deepEqual([...IMPLEMENTED_POLICY_KEYS].sort(), fixture.policies.map(row=>row.key).sort());
  assert.equal(SCOUT_RUNTIME_ENABLED, true);
});

function enrichedRoom() {
  const source=room();
  for(const item of source.players) Object.assign(item, {
    debt:'SECRET_DEBT', nextTurnEffects:{ noIncome:true, sourceCard:'SECRET_NEXT_SOURCE' },
    characterAcquisitionOptions:[{id:'SECRET_CHARACTER_OPTION'}], actionHint:'SECRET_OWNER_ACTION',
    legendaryStatus:{shipVeilTurns:2,seaCurseTurns:[1],seaCursePenalty:1,sourceCard:'SECRET_STATUS_SOURCE'},
    activeTurnEffects:{noIncome:true,noNavigation:true,moveBonus:2,movePenalty:1,bestOfTwo:true,sourceCard:'SECRET_EFFECT_SOURCE'},
    landCompany:{army:4,arsenalLevel:2,sourceIslandId:'island-1',formedAt:100,unknown:'SECRET_COMPANY'},
    visitedAnchors:['4:red:5:7'], lastAnchorEncounter:{round:4,color:'red',outcome:'win',reward:{gross:4,debtRemaining:'SECRET_HISTORY_DEBT'},unknown:'SECRET_HISTORY'},
  });
  return source;
}
test('4.4 boundary projects owner contract and filters every other identity',()=>{
  const source=enrichedRoom(), before=structuredClone(source);
  for(const viewerId of ['p1','p2',null,'unknown']) {
    const out=projectOpponentFacingRoomView(source,{viewerId,scoutGrant:{playerId:'p1'}});
    for(let i=0;i<source.players.length;i++) {
      if(source.players[i].id===viewerId) {
        assert.equal(out.players[i].ducats,'SECRET_DUCATS');
        assert.equal(out.players[i].debt,'SECRET_DEBT');
        assert.equal(has(out.players[i],'unknownPlayerField'),false);
        assert.equal(has(out.players[i],'actionHint'),false);
      }
      else {
        const view=out.players[i]; assertPrivatePlayerKeysAbsent(view);
        assert.equal(view.legendaryStatus.shipVeilTurns,2);
        assert.deepEqual(view.activeTurnEffects,{noIncome:true,noNavigation:true,moveBonus:2,movePenalty:1,bestOfTwo:true});
        assert.equal(view.landCompany.army,4); assert.equal(view.assaultArmy,3);
        assert.deepEqual(view.visitedAnchors,['4:red:5:7']); assert.equal(view.lastAnchorEncounter.outcome,'win');
        assert.equal(JSON.stringify(view).includes('SECRET_'),false);
      }
    }
    if(viewerId==='p1') {
      assert.equal(out.islands[0].garrisonName,'SECRET_GARRISON_NAME');
      assert.equal(has(out.islands[0],'unknownIslandField'),false);
    }
    else for(const key of ['garrisonType','garrisonName','garrisonDefense','defenseArmy','defenseBreakdown']) assert.equal(has(out.islands[0],key),false);
    assert.equal(out.unknownRootField,source.unknownRootField); // current root presentation contract
    out.players[0].name='Changed';
  }
  assert.deepEqual(source,before);
});
test('4.3 all six pending paths preserve actor choices and omit non-actor private context',()=>{
  for(const [key,actorField] of [['pendingEvent','playerId'],['pendingFeud','playerId'],['pendingAssignmentChoice','playerId'],['pendingIslandCorrection','playerId'],['pendingFleetAdjustment','playerId'],['pendingLegendaryReaction','targetPlayerId']]) {
    const pending={id:'waiting', [actorField]:'p1',kind:'SECRET_KIND',cardName:'SECRET_CARD',options:[{id:'SECRET_CHOICE'}],veilOptions:[{id:'SECRET_VEIL'}],factionId:'SECRET_FACTION',islandId:'SECRET_TARGET',context:'SECRET_CONTEXT',sourcePlayerId:'p2'};
    const source={players:[],islands:[],[key]:pending,eventPhase:{lastCard:{playerId:'p1',pending:true,cardName:'SECRET_CARD'}}};
    const actor=projectOpponentFacingRoomView(source,{viewerId:'p1'})[key];
    assert.equal(actor.viewerCanRespond,true);
    assert.equal(has(actor,'context'),false);
    if(key==='pendingLegendaryReaction') assert.equal(actor.veilOptions[0].id,'SECRET_VEIL');
    else if(key==='pendingIslandCorrection') assert.equal(has(actor.options[0],'id'),false);
    else assert.equal(actor.options[0].id,'SECRET_CHOICE');
    for(const viewerId of ['p2',null]) {
      const out=projectOpponentFacingRoomView(source,{viewerId});
      assert.equal(has(out,key),false);
      assert.deepEqual(out.pendingDecision,{waiting:true,actorPlayerId:'p1'});
      assert.deepEqual(Object.keys(out.pendingDecision).sort(),['actorPlayerId','waiting']);
      assert.equal(has(out.eventPhase,'lastCard'),false);
      assert.equal(JSON.stringify(out).includes('SECRET_'),false);
    }
  }
});

test('4.3 corrective: shared secret journal is absent for owners and all other viewers', () => {
  const source=room();
  const secrets=['SECRET_CHARACTER_LOG','SECRET_ASSIGNMENT_LOG','SECRET_EXPEDITION_LOG','SECRET_HIDDEN_CARD_LOG'];
  source.log=secrets.map(text=>({t:1,text}));
  const before=structuredClone(source);
  for(const viewerId of ['p1','p2',null]) {
    const out=projectOpponentFacingRoomView(source,{viewerId});
    assert.equal(has(out,'log'),false);
    for(const secret of secrets) assert.equal(JSON.stringify(out).includes(secret),false);
  }
  assert.deepEqual(source,before);
});

function ownerActionContract() {
  const source=player();
  Object.assign(source, {
    debt:7, attackedPlayerIdsThisRound:['p2'], nextActionLimit:2,
    nextTurnEffects:{moveBonus:2,bestOfTwo:true,sourceCard:'SECRET_EFFECT_ORIGIN'},
    expeditionTakenThisRound:true,canTakeExpedition:false,canDismissLandCompanyHere:true,
    characterReplacedThisRound:false,admiraltyLevelHere:3,palaceUsed:true,pendingLandinEscort:true,
    characterAcquisitionOptions:[{id:'navigator',name:'Navigator',admiraltyLevel:1,effect:{type:'reroll-navigation',rerolls:1,secondResultMandatory:true,unknown:'SECRET_OPTION_EFFECT'},unknown:'SECRET_OPTION'}],
    characterReplacementOptions:[{id:'cartographer',name:'Cartographer',admiraltyLevel:2,effect:{type:'peek-sea-deck',range:4,distance:'manhattan',count:1,unknown:'SECRET_REPLACE_EFFECT'}}],
    cartographerAnchorOptions:[{id:'red',color:'red',name:'Red anchor',distance:2,unknown:'SECRET_CARTOGRAPHER'}],
    inactiveBastionIslandIds:['island-2'],disabledUpgradeIds:['guns-1'],levelInactiveEscortIds:['escort-1'],brokenAlliesThisTurn:['p2'],
  });
  source.playableLegendaryCards[0].secretNested='SECRET_PLAYABLE_REF';
  source.lastAnchorEncounter={outcome:'win',reward:{gross:4,debtPaid:2,net:2,debtRemaining:1,unknown:'SECRET_OWNER_REWARD'},penalty:null};
  source.character.effect={type:'reroll-navigation',rerolls:1,secondResultMandatory:true,sourceCard:'SECRET_CHARACTER_EFFECT'};
  source.activeAssignment.progress.completedStops=[{index:0,islandId:'island-1',mapObjectId:null,label:'Port',unknown:'SECRET_STOP'}];
  return source;
}

test('4.4 owner action contract is explicit and nested private objects omit unknown keys',()=>{
  const source=ownerActionContract(), before=structuredClone(source);
  const owner=projectOpponentFacingRoomView({players:[source],log:[{text:'SECRET_JOURNAL'}]},{viewerId:'p1'}).players[0];
  assert.equal(owner.ducats,'SECRET_DUCATS'); assert.equal(owner.debt,7);
  assert.deepEqual(owner.character,{id:'scout',name:'SECRET_CHARACTER',admiraltyLevel:2,effect:{type:'reroll-navigation',rerolls:1,secondResultMandatory:true}});
  assert.equal(owner.activeAssignment.instanceId,'SECRET_ASSIGNMENT_INSTANCE');
  assert.equal(owner.activeAssignment.progress.completedStopCount,1);
  assert.deepEqual(owner.activeAssignment.progress.completedStops,[{index:0,islandId:'island-1',mapObjectId:null,label:'Port'}]);
  assert.equal(owner.assignmentPriority.text,'SECRET_ASSIGNMENT_HINT');
  assert.equal(owner.hasActiveAssignment,true); assert.equal(owner.hasActiveExpedition,true);
  assert.equal(owner.activeExpedition.name,'SECRET_EXPEDITION');
  assert.equal(has(owner.activeExpedition,'secretNested'),false);
  for(const key of ['specialCardCount','legendaryCardCount','savedEventCardCount']) assert.equal(owner[key],1);
  assert.equal(owner.specialCards[0],'SECRET_SPECIAL_CARD');
  assert.equal(owner.legendaryCards[0].name,'SECRET_LEGENDARY');
  assert.equal(owner.playableLegendaryCards[0].source,'legendary');
  assert.equal(owner.savedEventCards[0].goodId,'spice');
  for(const [key,value] of Object.entries({nextActionLimit:2,expeditionTakenThisRound:true,canTakeExpedition:false,canDismissLandCompanyHere:true,characterReplacedThisRound:false,admiraltyLevelHere:3,palaceUsed:true,pendingLandinEscort:true})) assert.equal(owner[key],value,key);
  for(const key of ['attackedPlayerIdsThisRound','inactiveBastionIslandIds','disabledUpgradeIds','levelInactiveEscortIds','brokenAlliesThisTurn']) assert.deepEqual(owner[key],source[key]);
  assert.deepEqual(owner.nextTurnEffects,{moveBonus:2,bestOfTwo:true});
  assert.deepEqual(owner.lastAnchorEncounter.reward,{gross:4,debtPaid:2,net:2,debtRemaining:1});
  assert.deepEqual(owner.characterAcquisitionOptions[0],{id:'navigator',name:'Navigator',admiraltyLevel:1,effect:{type:'reroll-navigation',rerolls:1,secondResultMandatory:true}});
  assert.equal(owner.characterReplacementOptions[0].effect.range,4);
  assert.deepEqual(owner.cartographerAnchorOptions[0],{id:'red',color:'red',name:'Red anchor',distance:2});
  for(const key of ['unknownPlayerField']) assert.equal(has(owner,key),false);
  for(const object of [owner.character,owner.activeAssignment,owner.activeAssignment.progress,owner.legendaryCards[0],owner.playableLegendaryCards[0],owner.savedEventCards[0]]) assert.equal(has(object,'secretNested'),false);
  for(const secret of ['SECRET_EFFECT_ORIGIN','SECRET_CHARACTER_EFFECT','SECRET_STOP','SECRET_OPTION_EFFECT','SECRET_OPTION','SECRET_REPLACE_EFFECT','SECRET_CARTOGRAPHER','SECRET_OWNER_REWARD','SECRET_PLAYABLE_REF']) assert.equal(JSON.stringify(owner).includes(secret),false);
  const other=projectPlayerForViewer(source,{viewerId:'p2'});
  assertPrivatePlayerKeysAbsent(other);
  for(const key of ['characterAcquisitionOptions','characterReplacementOptions','cartographerAnchorOptions','attackedPlayerIdsThisRound','canTakeExpedition']) assert.equal(has(other,key),false);
  assert.deepEqual(source,before);
  assert.deepEqual(owner,projectPlayerForViewer(source,{viewerId:'p1'}));
});

const actorContracts = [
  ['pendingEvent','playerId',{kind:'storm',cardName:'Storm',options:[{row:3,col:4}]}],
  ['pendingFeud','playerId',{kind:'building-choice',factionId:'mori',factionName:'Mori',remaining:1,options:[{islandId:'island-1',islandName:'Port',buildingIndex:0,name:'Farm',canDowngrade:true}]}],
  ['pendingAssignmentChoice','playerId',{kind:'embassy',factionId:'mori',factionName:'Mori',options:[{id:'task-1',text:'Visit Port',reward:12,type:'visit-island'}]}],
  ['pendingIslandCorrection','playerId',{kind:'constraints',islandId:'island-1',islandName:'Port',reason:'Area',initialBuildingCount:2,keepCount:1,remainingRemovals:1,removed:['Farm'],report:{legal:false,status:'settlement',usedArea:6,effectiveArea:4,overArea:2,branchLimit:1,branchViolations:[{branch:'money',name:'Trade',count:2,limit:1}]},options:[{buildingIndex:0,name:'Farm',type:'farm',level:1,area:2,branch:'money',branchName:'Trade'}]}],
  ['pendingFleetAdjustment','playerId',{stage:'escorts',reason:'Capacity',required:1,options:[{id:'escort-1',name:'Merchant',type:'merchant',missingRequirement:false,special:false,artillery:0,cargoCapacity:3,hasCargo:true,cargoText:'Tea ×2'}]}],
  ['pendingLegendaryReaction','targetPlayerId',{kind:'sea-curse',sourcePlayerId:'p2',islandId:null,veilOptions:[{id:'sea-veil',name:'Sea Veil',kind:'sea-veil',source:'legendary',index:0}]}],
];

test('4.4 all actor families retain their UI choices and deny unknown fields at every nested level',()=>{
  for(const [family,actorField,contract] of actorContracts) {
    const pending={id:'decision',[actorField]:'p1',...structuredClone(contract),unknown:'SECRET_PENDING_ROOT'};
    for(const option of pending.options || pending.veilOptions || []) option.unknown='SECRET_PENDING_OPTION';
    if(pending.report) {pending.report.unknown='SECRET_REPORT';pending.report.branchViolations[0].unknown='SECRET_BRANCH';}
    const source={players:[],islands:[],[family]:pending}, before=structuredClone(source);
    const actor=projectOpponentFacingRoomView(source,{viewerId:'p1'})[family];
    assert.deepEqual(actor,{id:'decision',[actorField]:'p1',viewerCanRespond:true,...contract});
    assert.equal(JSON.stringify(actor).includes('SECRET_'),false);
    for(const viewerId of ['p2',null]) {
      const other=projectOpponentFacingRoomView(source,{viewerId});
      assert.equal(has(other,family),false);
      assert.deepEqual(other.pendingDecision,{waiting:true,actorPlayerId:'p1'});
      assert.deepEqual(Object.keys(other.pendingDecision).sort(),['actorPlayerId','waiting']);
    }
    assert.deepEqual(source,before);
    assert.deepEqual(actor,projectOpponentFacingRoomView(source,{viewerId:'p1'})[family]);
  }
});

test('4.4 owner islands preserve visible buildings/status and private defense without nested bypass',()=>{
  const source=island();
  source.constraints={legal:true,status:'city',usedArea:2,effectiveArea:8,branchViolations:[],unknown:'SECRET_CONSTRAINT'};
  source.legendaryVeil={remaining:2,sourcePlayerId:'p1',unknown:'SECRET_VEIL'};
  const out=projectOpponentFacingRoomView({islands:[source]},{viewerId:'p1'}).islands[0];
  assert.equal(out.garrisonDefense,4);assert.equal(out.defenseArmy,11);
  assert.equal(out.defenseBreakdown.hiredGarrison,4);
  assert.equal(out.buildings[0].nextUpgrade.price,20);
  assert.deepEqual(out.legendaryVeil,{remaining:2,sourcePlayerId:'p1'});
  for(const object of [out,out.defenseBreakdown,out.buildings[0],out.buildings[0].nextUpgrade,out.constraints]) assert.equal(has(object,'secretNested') || has(object,'unknownIslandField') || has(object,'unknown'),false);
  const other=projectIslandForViewer(source,{viewerId:'p2'});
  for(const key of ['garrisonType','garrisonName','garrisonDefense','defenseArmy','defenseBreakdown']) assert.equal(has(other,key),false);
  assert.equal(other.legendaryVeil.remaining,2);
});

test('4.4 lastCard never carries assignment/source secrets to another player',()=>{
  for(const card of [{playerId:'p1',cardName:'SECRET_ASSIGNMENT',source:'assignment',pending:false},{playerId:'p1',cardName:'SECRET_PENDING_CARD',source:'sailing',pending:true}]) {
    const source={eventPhase:{active:true,lastCard:{...card,unknown:'SECRET_LAST_CARD'}}};
    const actor=projectOpponentFacingRoomView(source,{viewerId:'p1'});
    assert.equal(actor.eventPhase.lastCard.cardName,card.cardName);
    assert.equal(has(actor.eventPhase.lastCard,'unknown'),false);
    for(const viewerId of ['p2',null]) {
      const out=projectOpponentFacingRoomView(source,{viewerId});
      assert.equal(has(out.eventPhase,'lastCard'),false);
      assert.equal(JSON.stringify(out).includes('SECRET_'),false);
    }
  }
  const completedCard={eventPhase:{active:true,currentPlayerId:'p1',lastCard:{playerId:'p1',source:'feud',pending:false,cardName:'SECRET_COMPLETED_FEUD'}}};
  const other=projectOpponentFacingRoomView(completedCard,{viewerId:'p2'});
  assert.equal(has(other.eventPhase,'lastCard'),false);
  assert.equal(JSON.stringify(other).includes('SECRET_COMPLETED_FEUD'),false);
  assert.equal(SCOUT_RUNTIME_ENABLED,true);
});


test('4.4 corrective: non-actor personal eventPhase is minimal while actor keeps event UI details',()=>{
  const source={
    players:[],islands:[],
    eventPhase:{
      active:true,personalTurn:true,currentPlayerId:'p1',playerIndex:2,totalPlayers:4,
      stage:'assignment',observatoryReplacementsUsed:1,feudIndex:1,feudTotal:3,
      assignmentIndex:1,assignmentTotal:2,replacementIndex:1,replacementTotal:2,
      lastCard:{playerId:'p1',playerName:'Alice',cardName:'SECRET_ASSIGNMENT_CARD',factionId:'mori',factionName:'SECRET_FACTION',pending:false,source:'assignment'},
    },
  };
  const actor=projectOpponentFacingRoomView(source,{viewerId:'p1'});
  assert.equal(actor.eventPhase.stage,'assignment');
  assert.equal(actor.eventPhase.assignmentTotal,2);
  assert.equal(actor.eventPhase.assignmentIndex,1);
  assert.equal(actor.eventPhase.lastCard.cardName,'SECRET_ASSIGNMENT_CARD');
  const other=projectOpponentFacingRoomView(source,{viewerId:'p2'});
  assert.deepEqual(other.eventPhase,{active:true,personalTurn:true,currentPlayerId:'p1'});
  for(const key of ['lastCard','stage','assignmentTotal','assignmentIndex','feudIndex','feudTotal','replacementIndex','replacementTotal','observatoryReplacementsUsed']) assert.equal(has(other.eventPhase,key),false,key);
  assert.equal(JSON.stringify(other).includes('SECRET_'),false);
});

test('4.4 corrective: ordinary player boundary omits private-derived source counters regardless of source lengths',()=>{
  const sourceA={players:[],islands:[],eventDecks:{sailing:{remaining:9,discard:1},expeditions:{remaining:7}},feudDecks:{mori:{remaining:8,discard:2}},assignmentDecks:{mori:{remaining:6,discard:3,removed:1}},anchorDecks:{red:{remaining:4,discard:1}}};
  const sourceB=structuredClone(sourceA);
  sourceB.eventDecks.sailing.remaining=1;sourceB.eventDecks.expeditions.remaining=2;
  sourceB.feudDecks.mori.remaining=3;sourceB.assignmentDecks.mori.remaining=4;
  const a=projectOpponentFacingRoomView(sourceA,{viewerId:'p2'});
  const b=projectOpponentFacingRoomView(sourceB,{viewerId:'p2'});
  for(const view of [a,b]) {
    for(const key of ['eventDecks','feudDecks','assignmentDecks']) assert.equal(has(view,key),false,key);
    assert.deepEqual(view.anchorDecks,{red:{remaining:4,discard:1}});
  }
  assert.deepEqual(a,b);
});

test('4.4 corrective: anchor history remains public but exact finance settlement is owner-only',()=>{
  const source=player('p1');
  source.visitedAnchors=['4:red:5:7'];
  source.lastAnchorEncounter={
    round:4,row:5,col:7,color:'red',anchorName:'Red',cardName:'Encounter',cardArtillery:3,rewardValue:8,
    fleetPower:6,outcome:'win',fleetPoints:2,
    reward:{gross:8,debtPaid:3,net:5,debtRemaining:4},
    penalty:{required:4,paid:1,addedDebt:3,debt:7},
  };
  const roomView={players:[source],islands:[]};
  const other=projectOpponentFacingRoomView(roomView,{viewerId:'p2'}).players[0];
  assert.deepEqual(other.visitedAnchors,['4:red:5:7']);
  assert.equal(other.lastAnchorEncounter.outcome,'win');
  assert.equal(other.lastAnchorEncounter.fleetPower,6);
  assert.equal(has(other.lastAnchorEncounter,'reward'),false);
  assert.equal(has(other.lastAnchorEncounter,'penalty'),false);
  const owner=projectOpponentFacingRoomView(roomView,{viewerId:'p1'}).players[0];
  assert.deepEqual(owner.lastAnchorEncounter.reward,{gross:8,debtPaid:3,net:5,debtRemaining:4});
  assert.deepEqual(owner.lastAnchorEncounter.penalty,{required:4,paid:1,addedDebt:3,debt:7});
});

test('4.5 invariants keep journal absent while Scout runtime is enabled',()=>{
  const out=projectOpponentFacingRoomView({players:[],islands:[],log:[{text:'SECRET_LOG'}]},{viewerId:'p2'});
  assert.equal(has(out,'log'),false);
  assert.equal(JSON.stringify(out).includes('SECRET_LOG'),false);
  assert.equal(SCOUT_RUNTIME_ENABLED,true);
});
