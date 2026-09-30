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
    leaderId: 'p1',
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
      options: [{ id: 'choice-1', text: 'SECRET_PENDING_OPTION', secretNested: 'SECRET_PENDING_NESTED' }],
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
  assert.equal(actor.options[0].text, 'SECRET_PENDING_OPTION');
  assert.equal(has(other, 'kind'), false);
  assert.equal(has(other, 'options'), false);
});

test('15. unrelated viewer receives only minimal public pending envelope', () => {
  const projected = projectPendingForViewer(room().pendingEvent, { viewerId: 'p2' }, { actorField: 'playerId' });
  assert.deepEqual(projected, { id: 'pending-1', playerId: 'p1', viewerCanRespond: false });
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

test('20. Scout grants are absent in 4.2 and reveal no Scout-only private state', () => {
  const context = {
    viewerId: 'p2',
    scoutGrant: { mode: 'selected-player-ducats', playerId: 'p1', islandId: 'island-1' },
  };
  const projectedPlayer = projectPlayerForViewer(player('p1'), context);
  const projectedIsland = projectIslandForViewer(island('p1'), context);
  assert.equal(SCOUT_RUNTIME_ENABLED, false);
  assert.equal(has(projectedPlayer, 'ducats'), false);
  assert.equal(has(projectedIsland, 'garrisonType'), false);
});

test('21. implemented policy exactly covers canonical fixture', () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.deepEqual([...IMPLEMENTED_POLICY_KEYS].sort(), fixture.policies.map(row=>row.key).sort());
  assert.equal(SCOUT_RUNTIME_ENABLED, false);
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
test('4.3 transitional boundary keeps owner legacy contract and filters every other identity',()=>{
  const source=enrichedRoom(), before=structuredClone(source);
  for(const viewerId of ['p1','p2',null,'unknown']) {
    const out=projectOpponentFacingRoomView(source,{viewerId,scoutGrant:{playerId:'p1'}});
    for(let i=0;i<source.players.length;i++) {
      if(source.players[i].id===viewerId) assert.deepEqual(out.players[i],source.players[i]);
      else {
        const view=out.players[i]; assertPrivatePlayerKeysAbsent(view);
        assert.equal(view.legendaryStatus.shipVeilTurns,2);
        assert.deepEqual(view.activeTurnEffects,{noIncome:true,noNavigation:true,moveBonus:2,movePenalty:1,bestOfTwo:true});
        assert.equal(view.landCompany.army,4); assert.equal(view.assaultArmy,3);
        assert.deepEqual(view.visitedAnchors,['4:red:5:7']); assert.equal(view.lastAnchorEncounter.outcome,'win');
        assert.equal(JSON.stringify(view).includes('SECRET_'),false);
      }
    }
    if(viewerId==='p1') assert.deepEqual(out.islands[0],source.islands[0]);
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
    assert.deepEqual(projectOpponentFacingRoomView(source,{viewerId:'p1'})[key],pending);
    for(const viewerId of ['p2',null]) {
      const out=projectOpponentFacingRoomView(source,{viewerId});
      assert.deepEqual(out[key],{id:'waiting',[actorField]:'p1',viewerCanRespond:false});
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
