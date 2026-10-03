const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../rules');
const legacy = require('../rules/compatibility/legacy.json');
const runtime = require('../rules/runtime');
const { validateCompatibility } = require('../rules/validate');
const copy = value => JSON.parse(JSON.stringify(value));

test('legacy profile references remain valid while canonical master data stays separate', () => {
  assert.deepEqual(validateCompatibility(rules,legacy),[]);
  assert.equal(runtime.RUNTIME_PROFILE,'stage-6-events-legends-6.7');
  assert.equal(runtime.BALANCE.session.startingDucats,rules.session.startingDucats);
  assert.equal(runtime.BALANCE.session.players.min,1);
  assert.equal(runtime.BALANCE.session.players.max,6);
  assert.equal(runtime.BALANCE.session.circlesPerRound,6);
  assert.deepEqual(runtime.SHIP_LEVELS[legacy.shipLevel7.level],{...legacy.shipLevel7,retired:true});
  assert.deepEqual(runtime.SHIP_UPGRADES[legacy.removedUpgrade.id],{...legacy.removedUpgrade,retired:true});
  assert.deepEqual(runtime.ESCORTS[legacy.removedEscort.id],{...legacy.removedEscort,retired:true});
  assert.equal(runtime.FACTIONS.mori.giftIslandId,'miyosi');
  assert.deepEqual(Object.keys(runtime.ASSIGNMENT_CARDS),['lionia','kadingir','mori','suniksiya','pirates']);
  assert.equal(Object.values(runtime.ASSIGNMENT_CARDS).flat().length,49);
  assert.equal(runtime.BALANCE.assignmentReplacementPrice,undefined);
  assert.deepEqual(Object.keys(runtime.FEUD_CARDS),rules.politics.order);
  assert.deepEqual(runtime.SAILING_EVENT_CARDS,rules.events.sailing);
  assert.equal(runtime.SAILING_EVENT_CARDS.some(card=>card.type==='next-turn' || card.timing==='next-personal-turn'),false);
  assert.deepEqual(runtime.LEGENDARY_PLACE_RULES,rules.legends.places);
  assert.deepEqual(runtime.NAMED_PLACE_CARDS,rules.legends.namedCards);
  assert.deepEqual(runtime.EXPEDITION_CARDS,rules.legends.expeditions);
  assert.deepEqual(runtime.BALANCE.expeditionLimits,rules.legends.expeditionLimits);
  for (const [id, masterCards] of Object.entries(rules.events.feud)) {
    const cards = runtime.FEUD_CARDS[id];
    assert.equal(cards.reduce((sum,card)=>sum+card.quantity,0),10,id);
    assert.equal(cards.length,masterCards.length,id);
    for (const master of masterCards) {
      const card = cards.find(c => c.id === master.id);
      assert.ok(card,master.id);
      assert.equal(card.masterCardId,master.id);
      assert.equal(card.quantity,master.quantity,master.id);
      assert.equal(card.name,master.name,master.id);
      for (const [key,value] of Object.entries(master.effect)) assert.deepEqual(card[key],value,master.id + ':' + key);
    }
  }
  for (const id of Object.keys(legacy.factionPrizeBuildings)) {
    assert.equal(runtime.FACTIONS[id].fullConquestPrize.preserveBuildings,undefined);
    assert.equal(runtime.FACTIONS[id].fullConquestPrize.razeDucats,undefined);
  }
  assert.equal(runtime.FACTIONS.lionia.fullConquestPrize.ducats,60);
  assert.equal(runtime.FACTIONS.kadingir.fullConquestPrize.ducats,50);
  assert.equal(runtime.FACTIONS.kadingir.fullConquestPrize.amountUnresolved,undefined);
  assert.equal(Object.hasOwn(runtime.MILITARY_REWARDS.kadingir,'preserveBuildings'),false);
  assert.equal(runtime.MILITARY_REWARDS.kisalinia,undefined);
  assert.deepEqual(runtime.TREASURE_CARDS.map(c => c.id),rules.legends.treasures.map(c => c.id));
  assert.deepEqual(rules.legends.treasures.find(c => c.id === 'full-diamonds-hold').effect,{type:'fill-hold',goodId:'diamonds'});
  assert.deepEqual(runtime.BALANCE.legendaryPool,rules.legends.legendaryPool);
  assert.deepEqual(runtime.LEGENDARY_CARDS,rules.legends.legendary);
  assert.equal(runtime.LEGENDARY_CARDS.every(card => !Object.hasOwn(card,'quantity')),true);
  assert.equal(Object.hasOwn(runtime.BALANCE,'legendaryDeck'),false);
});

test('compatibility validator rejects broken saved-state references and projections', () => {
  const mutations = [
    x => x.shipLevel7.level++,
    x => { x.shipLevel7.upgradeSlots = 0; },
    x => x.removedUpgrade.requires = 'missing',
    x => x.removedEscort.cargo = -1,
    x => x.buildingAreas.manor = 0,
    x => x.branchLimits.port = 0,
    x => x.garrisons.guard.price = -1,
    x => x.feud.lionia[0].masterCardId = 'missing',
    x => x.feud.lionia.push(copy(x.feud.lionia[0])),
    x => x.militaryRewardBuildings.landin[0].type = 'missing',
    x => delete x.factionPrizeBuildings.lionia,
    x => x.legendaryQuantities['sea-veil'] = 0,
    x => x.treasure.cargoGoodId = 'missing',
    x => x.anchorGlory.orange = 1,
    x => x.gloryCapture[1].min++,
    x => x.treasuryLossRatio = 2,
  ];
  for (const [index,mutate] of mutations.entries()) {
    const value=copy(legacy); mutate(value);
    assert.notDeepEqual(validateCompatibility(rules,value),[],`mutation ${index + 1} was accepted`);
  }
});

test('stage 5.8 assignment UI exposes current rules and contains no paid-replacement controls', () => {
  const app = fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
  const html = fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  assert.match(app,/Лионии, Кадингира, Мори, Вольной Суниксии и пиратов/);
  assert.match(app,/Поручение имеет приоритет/);
  assert.match(app,/Маршрут Мори/);
  assert.match(app,/Посольство: выберите одно из допустимых поручений/);
  assert.doesNotMatch(app,/Колода поручений:|убрано как невыполнимые/);
  assert.match(html,/личном ходу шестого круга/);
  assert.doesNotMatch(app,/assignmentReplacementPrice/);
  assert.doesNotMatch(app,/платно замен/iu);
  assert.doesNotMatch(app,/replacedAssignmentConditions/);
});
