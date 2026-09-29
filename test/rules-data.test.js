const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const rules = require('../rules');
const map = require('../map-config');
const data = require('../game-data');
const logic = require('../game-logic');
const { validateRules } = require('../rules/validate');
const fixture = require('./fixtures/master-tables.json');
const copy = x => JSON.parse(JSON.stringify(x));
const n = text => Number(String(text).replace('−','-').match(/[-+]?\d+/)?.[0]);

test('all master data, references, decks, required fields and map coordinates validate', () => {
  assert.deepEqual(validateRules(rules, map), []);
});

test('validator rejects corruption rather than merely accepting the shipped sample', () => {
  const cases = [
    x => x.islands.push(copy(x.islands[0])),
    x => x.islands[0].resourceIds.push('missing'),
    x => x.islands.find(i=>i.kind==='state').factionId = 'missing',
    x => delete x.fleet.ships.brigantine.artillery,
    x => delete x.fleet.levels[4],
    x => { x.fleet.levels[3].moveBonus = 1; },
    x => { x.fleet.levels[4].upgradeSlots = 3; },
    x => x.fleet.upgrades.culverins.requires = 'missing',
    x => { x.fleet.upgrades.leadLine.order = 2; },
    x => { x.fleet.upgrades.leadLine.branch = 'reefPilot'; },
    x => { delete x.fleet.upgrades.leadLine.availability; },
    x => { x.fleet.upgrades.thirdArtillery = {...x.fleet.upgrades.falcons,id:'thirdArtillery',name:'Тест',order:1}; },
    x => { delete x.fleet.escorts.cargo; },
    x => { x.fleet.levels[4].escortLimit = 3; },
    x => { x.economy.buildings.shipyard.levels[2].escortSlots = 1; },
    x => x.economy.buildings.farm.levels[1].next.type = 'missing',
    x => x.politics.assignments.mori[0].islandId = 'missing',
    x => x.politics.assignments.mori[8].route[1] = {mapObjectId:'missing'},
    x => x.events.feud.mori[0].effect.type = 'not-an-effect',
    x => delete x.events.feud.mori[0].effect.amount,
    x => x.events.sailing[0].quantity = 3,
    x => x.sea.red[0].id = x.sea.red[1].id,
    x => x.legends.expeditions[0].placeId = 'missing',
    x => x.characters.characters[0].admiraltyLevel = 9,
  ];
  for (const mutate of cases) { const value=copy(rules); mutate(value); assert.ok(validateRules(value,map).length > 0); }
  const badMap = copy(map); badMap.ISLAND_DEFS[0].cells[0] = [28,0];
  assert.ok(validateRules(rules,badMap).some(e=>e.includes('coordinate')));
});

test('validator rejects drift in overview fields, building chains and deferred references', () => {
  const cases = [
    x => { x.economy.buildings.farm.price += 1; },
    x => { x.economy.buildings.fort.defense += 1; },
    x => { x.economy.buildings.market.income += 1; },
    x => { x.economy.buildings.mine.resource = 'wrong'; },
    x => { x.economy.buildings.mine.produces = 'diamonds'; },
    x => { x.economy.buildings.farm.levels[2].area += 1; },
    x => { delete x.economy.buildings.farm.levels[2].next; },
    x => { x.economy.buildings.farm.levels[3].next = {type:'bank',level:1}; },
    x => { x.economy.buildingBranches[0].types.push('mine'); },
    x => { x.politics.factions.lionia.originalIslandIds.pop(); },
    x => { x.legends.treasures[0].multiplier += 1; },
    x => { x.legends.treasures.at(-1).cargoGoodId = 'wood'; },
    x => { x.legends.namedCards[0].name = 'wrong'; },
    x => { x.legends.expeditions[0].reward.count += 1; },
    x => { x.scoring.army.capture[1].min += 1; },
    x => { x.economy.landCompany.armyByArsenalLevel.pop(); },
    x => { x.implementation.pendingConsumers[0].path = 'missing.path'; },
  ];
  for (const mutate of cases) {
    const value=copy(rules); mutate(value);
    assert.ok(validateRules(value,map).length > 0, mutate.toString());
  }
});

test('ship classes, levels, upgrades, navigation and escorts match source tables', () => {
  for (const row of fixture.tables.ships) {
    const ship=Object.values(rules.fleet.ships).find(s=>s.name===row[0]);
    assert.deepEqual([ship.artillery,ship.army,ship.cargo,ship.moveMod], row.slice(1,5).map(n));
  }
  for (const [index,row] of fixture.tables.levels.entries()) {
    const level=rules.fleet.levels[index+2];
    assert.deepEqual([level.price,level.statBonus,level.statBonus,level.statBonus,level.moveBonus], [n(row[1]),...row.slice(3).map(n)]);
  }
  for (const row of fixture.tables.upgrades) {
    const upgrade=Object.values(rules.fleet.upgrades).find(u=>u.name===row[1]);
    assert.equal(upgrade.price,n(row[3]));
    const stat={Артиллерия:'artillery',Войско:'army',Трюм:'cargo',Скорость:'movement'}[row[0]];
    assert.equal(upgrade[stat],n(row[2]));
  }
  for (const row of fixture.tables.navigation) {
    const upgrade=Object.values(rules.fleet.upgrades).find(u=>u.name===row[0]);
    assert.equal(upgrade.price,n(row[1])); assert.equal(upgrade.availability.consumerStage,3);
    assert.equal(data.SHIP_UPGRADES[upgrade.id].passability,upgrade.passability);
  }
  assert.deepEqual(rules.fleet.escortPrices,[10,15,20]);
  assert.deepEqual(Object.values(rules.fleet.levels).map(l=>l.escortLimit),[1,1,2,2,3,3]);
  assert.deepEqual(['artillery','army','cargo'].map(k=>rules.fleet.escorts.cargo[k]),[0,0,5]);
  assert.deepEqual(['artillery','army','cargo'].map(k=>rules.fleet.escorts.combat[k]),[5,0,0]);
});

test('every economic table row, building chain, price, income and defense matches source', () => {
  const pairs=[['farm','manor'],['lumbermill','shipyard'],['quarry','stoneworks'],['mine','arsenal'],['fort','fortress'],['market','bank']];
  for (const [index,[base,advanced]] of pairs.entries()) {
    const actual=[base,advanced].flatMap(id=>[1,2,3].map(level=>rules.economy.buildings[id].levels[level].price));
    assert.deepEqual(actual,fixture.tables.buildingPrices[index].slice(1).map(n));
    assert.deepEqual(rules.economy.buildings[base].levels[3].next,{type:advanced,level:1});
  }
  assert.deepEqual(rules.economy.buildings.fortress.levels[3].next,{type:'bastion',level:1});
  for (const [index,row] of fixture.tables.income.entries()) {
    assert.deepEqual(['market','bank'].map(id=>rules.economy.buildings[id].levels[index+1].income),row.slice(1).map(n));
  }
  for (const [index,row] of fixture.tables.defense.entries()) {
    assert.deepEqual(['fort','fortress'].map(id=>rules.economy.buildings[id].levels[index+1].defense),row.slice(1).map(n));
  }
  for (const row of fixture.tables.goods) assert.equal(Object.values(rules.economy.goods).find(g=>g.name===row[0]).price,n(row[1]));
  for (const row of fixture.tables.rare) {
    const building=Object.values(rules.economy.buildings).find(b=>b.name===row[0]);
    assert.equal(building.price,n(row[2])); assert.equal(building.futureLevelsPurchasable,false);
    assert.deepEqual(Object.keys(building.levels),['1']);
    assert.deepEqual(building.futureLevels,{2:null,3:null});
  }
  for (const row of fixture.tables.publicBuildings) {
    const b=Object.values(rules.economy.buildings).find(b=>b.name===row[0]);
    assert.deepEqual(Object.values(b.levels).map(l=>l.price),b.id==='admiralty'?row[1].split('; ').map(n):[n(row[1])]);
    assert.equal(b.availability.consumerStage,4); assert.equal(b.buildable,false);
    assert.equal(data.BUILDINGS[b.id].buildable,true);
  }
  assert.deepEqual(['guard','permanentUpgrade','permanentDirect'].map(id=>rules.economy.garrisons[id].price),fixture.tables.garrisons.map(row=>n(row[1])));
  assert.deepEqual(['guard','permanentUpgrade','permanentDirect'].map(id=>rules.economy.garrisons[id].defense),[1,3,2]);
  assert.deepEqual(data.BALANCE.garrisons,rules.economy.garrisons);
  assert.equal(rules.economy.buildings.bastion.defense,10);
  assert.deepEqual(data.BUILDING_UPGRADES.admiralty[1],{type:'admiralty',level:2,price:15});
  assert.deepEqual(data.BUILDING_UPGRADES.admiralty[2],{type:'admiralty',level:3,price:20});
  assert.equal(Object.keys(data.CHARACTERS).length,6);
  assert.equal(data.CHARACTERS.scout.effect.unresolved,'R29');
});

test('all 28 island cards match appendix A, including resources and one-time rewards', () => {
  const lines=fixture.islandSourceLines;
  for(let i=0;i<lines.length;i+=4) {
    const name=lines[i].replace(/^А\.\d\.\d+ /,'');
    const island=rules.islands.find(x=>x.name===name); assert.ok(island,name);
    const values=lines[i+1].match(/Площадь: (\d+)\. Исходный гарнизон: (\d+)/);
    assert.deepEqual([island.area,island.army],[+values[1],+values[2]],name);
    const resourceNames=lines[i+2].replace(/^Ресурсы: /,'').replace(/\.$/,'').split(', ');
    assert.deepEqual(island.resourceIds.map(id=>rules.economy.resources[id].name),resourceNames,name);
    const rewardText=lines[i+3].replace(/^Разовая награда(?: в дукатах)?: /,'');
    assert.equal(island.rewardText,rewardText);
    assert.equal(island.reward.ducats || 0,Number(rewardText.match(/^\d+/)?.[0] || 0));
    assert.equal(island.reward.legendary || 0,/случайная легендарная/.test(rewardText)?1:0);
    const view=data.ISLAND_DEFS.find(x=>x.id===island.id);
    assert.deepEqual([view.area,view.army,view.resourceIds],[island.area,island.army,island.resourceIds]);
  }
  assert.equal(rules.islands.find(i=>i.id==='chertog').reward.legendaryCardId,'mist-path');
  assert.deepEqual(rules.islands.find(i=>i.id==='kisalinia').reward.buildings,[{type:'fort',level:1}]);
});

test('complete known sea, assignment, feud and event decks match appendix rows', () => {
  for (const color of ['blue','yellow','red']) assert.deepEqual(rules.sea[color].map(c=>[c.name,c.quantity,c.artillery,c.reward]),fixture.tables.sea[color].map(r=>[r[0],n(r[1]),r[2]==='—'?null:n(r[2]),n(r[3])]));
  for (const [id,rows] of Object.entries(fixture.tables.assignments)) assert.deepEqual(rules.politics.assignments[id].map(c=>[c.text,c.reward]),rows.map(r=>[r[0],n(r[1])]));
  for (const [id,rows] of Object.entries(fixture.tables.feud)) assert.deepEqual(rules.events.feud[id].map(c=>[c.name,c.quantity]),rows.map(r=>[r[0],n(r[1])]));
  assert.deepEqual(rules.events.sailing.map(({name,quantity,rulesText})=>({name,quantity,rulesText})),fixture.events);
  for(const row of fixture.tables.factions) assert.equal(Object.values(rules.politics.factions).find(f=>f.name===row[0]).fullConquestPrize.ducats,n(row[2]));
  assert.equal(rules.politics.factions.kadingir.fullConquestPrize.ducats,50);
  assert.equal(rules.politics.assignments.lionia[0].islandId,'asigoriy');
  assert.deepEqual(rules.politics.assignments.mori.slice(0,8).map(c=>c.islandId),['renaika','chertog','kisalinia','yukon','erkalon','asigoriy','atlantia','adia']);
});

test('stage 5.2 activates canonical PvP sea combat scoring without prematurely activating later stage-5 consumers', () => {
  assert.equal(rules.implementation.activeProfile,'stage-5-combat-politics-5.2');
  assert.equal(rules.implementation.pendingConsumers.every(item => item.consumerStage >= 5),true);
  assert.equal(rules.scoring.combat.attacksPerOpponentPerRound,1);
  assert.equal(data.BALANCE.combat.attacksPerOpponentPerRound,rules.scoring.combat.attacksPerOpponentPerRound);
  assert.deepEqual(data.BALANCE.fleetScoring,rules.scoring.fleet);
  assert.equal(data.BALANCE.fleetScoring.playerVictory,2);
  assert.equal(data.BALANCE.fleetScoring.defenseVictory,2);
  assert.equal(data.BALANCE.attackHistoryWindow,undefined);
  assert.equal(data.BALANCE.attackRebellionThreshold,undefined);
  for (const resolved of [
    'fleet.upgrades.*.passability',
    'economy.buildings.*.area',
    'economy.ranks.*.branchLimit',
    'economy.garrisons',
    'economy.buildings.fortress.levels.3.next',
    'economy.buildings.*.effect',
    'characters',
    'legends.treasures',
  ]) assert.equal(rules.implementation.pendingConsumers.some(item => item.path === resolved),false,resolved);
});

test('unknown physical copies and author decisions remain explicit, never guessed', () => {
  for (const id of ['R05','R06','R07','R21','R29','remaining-prize-buildings']) assert.ok(rules.metadata.unresolved.includes(id));
  assert.equal(rules.legends.legendaryDeck.copiesByKind,null);
  assert.equal(rules.legends.legendaryDeck.reshuffle,null);
  assert.equal(rules.legends.treasureDeck.copiesByKind,null);
  for(const c of rules.legends.legendary) assert.equal(c.quantity,null);
  for(const id of ['vortex','icebergs','rose']) {
    const p=rules.legends.places.find(p=>p.id===id);
    assert.deepEqual(p.reward,{type:'treasure',count:1}); assert.equal(p.unresolved,'R06');
  }
  assert.equal(rules.legends.treasures.at(-1).onNoEmptyHold,'discard');
  assert.equal(rules.legends.treasures.at(-1).cargoGoodId,'diamonds');
  assert.equal(rules.politics.paidAssignmentReplacement,false);
  assert.equal(rules.fleet.escorts.landin,undefined);
  assert.equal(rules.fleet.upgrades.foreMarsel,undefined);
});

test('runtime consumers use canonical prices, characteristics, income and safe map projections', () => {
  for (const [id,ship] of Object.entries(rules.fleet.ships)) {
    for(let level=1;level<=6;level++) {
      const p={shipClass:id,level,upgrades:[]};const stats=logic.shipStats(p);
      assert.equal(stats.artillery,ship.artillery+rules.fleet.levels[level].statBonus);
      assert.equal(stats.moveMod,ship.moveMod);
      assert.equal(logic.shipUpgradeSlotLimit(p),rules.fleet.levels[level].upgradeSlots);
    }
  }
  for(const [id,b] of Object.entries(rules.economy.buildings)) {
    assert.equal(data.BUILDINGS[id].price,b.price);
    assert.equal(data.BUILDINGS[id].area,b.area);
    for(const [level,levelData] of Object.entries(b.levels)) {
      assert.equal(levelData.area,1,`${id} ${level} must occupy exactly one area cell`);
    }
    for(const [level,next] of Object.entries(data.BUILDING_UPGRADES[id] || {})) {
      assert.equal(next.price,rules.economy.buildings[next.type].levels[next.level].price);
    }
  }
  assert.deepEqual(data.BALANCE.branchLimits,{settlement:1,city:2,port:2});
  assert.equal(data.BUILDINGS.bastion.countsAsAdvanced,true);
  const runtimeIslands=logic.cloneIslands();
  assert.equal(runtimeIslands.length,28);
  for(const source of rules.islands) {
    const island=runtimeIslands.find(i=>i.id===source.id);
    assert.ok(island,`missing runtime island ${source.id}`);
    assert.equal(island.area,source.area);
    assert.equal(island.army,source.army);
    assert.deepEqual(island.resourceIds,source.resourceIds);
  }
  for(let count=0;count<3;count++) assert.equal(logic.escortPurchasePrice({escorts:Array(count).fill({})}),rules.fleet.escortPrices[count]);
  assert.deepEqual(data.GOODS,rules.economy.goods);
  assert.equal(data.BALANCE.loadingLimitPerIslandPerRound,rules.economy.loadingLimitPerIslandPerRound);
  assert.deepEqual(data.TREASURE_CARDS.map(c=>c.id),rules.legends.treasures.map(c=>c.id));
  assert.equal(data.TREASURE_CARDS.find(c=>c.id==='full-diamonds-hold').cargoGoodId,'diamonds');
  assert.equal(data.TREASURE_CARDS.some(c=>c.id==='full-ore-hold'),false);
  assert.deepEqual(data.ANCHOR_CARDS,rules.sea);
  const geometry={islands:map.ISLAND_DEFS.map(({id,cells})=>({id,cells})),land:map.LAND_CELLS,citadel:map.CITADEL_CELLS,special:map.SPECIAL_LAND,hazards:map.HAZARDS,anchors:Object.values(map.ANCHORS).map(({id,cells})=>({id,cells})),places:Object.values(map.LEGENDARY_PLACES).map(({id,row,col})=>({id,row,col}))};
  const hash=crypto.createHash('sha256').update(JSON.stringify(geometry)).digest('hex');
  assert.equal(hash,fixture.geometrySha256,'geometry changed from main 252a316');
});

test('retired fleet content stays compatibility-only while stage 3 navigation upgrades are active', () => {
  const p={row:13,col:13,shipClass:'carrack',level:7,ducats:999,upgrades:['foreMarsel'],escorts:[{id:'old',type:'landin',special:true}]};
  assert.equal(rules.fleet.levels[7],undefined);
  assert.equal(data.SHIP_LEVELS[7].retired,true);
  assert.ok(logic.shipStats(p).cargo > 0); assert.equal(p.level,7);
  assert.equal(logic.shipUpgradeSlotLimit(p),data.SHIP_LEVELS[7].upgradeSlots);
  assert.equal(logic.buyShipLevel(p).ok,false);
  const buyer={...p,level:6,upgrades:[]};
  assert.equal(logic.buyShipUpgrade(buyer,'foreMarsel').ok,false);
  assert.equal(logic.installShipUpgradeFree(buyer,'foreMarsel').ok,false);
  assert.equal(data.SHIP_UPGRADES.leadLine.passability,'shoal');
  assert.equal(logic.buyShipUpgrade(buyer,'leadLine').ok,true);
  assert.equal(data.MILITARY_REWARDS.landin.specialLandinEscort,undefined);
  assert.equal(logic.buyEscort({islands:[]},buyer,'landin').ok,false);
  assert.equal(data.FACTIONS.mori,undefined);
  assert.equal(rules.politics.factions.mori.giftIslandId,'miyosi');
});
