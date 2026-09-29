const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');
const legacy = require('../rules/compatibility/legacy.json');
const runtime = require('../rules/runtime');
const { validateCompatibility } = require('../rules/validate');
const copy = value => JSON.parse(JSON.stringify(value));

test('legacy profile references remain valid while canonical master data stays separate', () => {
  assert.deepEqual(validateCompatibility(rules,legacy),[]);
  assert.equal(runtime.BALANCE.session.startingDucats,rules.session.startingDucats);
  assert.equal(runtime.BALANCE.session.players.min,4);
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
  assert.equal(runtime.FACTIONS.kadingir.fullConquestPrize.amountUnresolved,true);
  assert.deepEqual(runtime.MILITARY_REWARDS.kadingir.preserveBuildings,[]);
  assert.deepEqual(runtime.MILITARY_REWARDS.kisalinia.preserveBuildings,[{type:'fort',level:1}]);
  assert.deepEqual(runtime.TREASURE_CARDS.map(c => c.id),[
    ...rules.legends.treasures.filter(c => c.effect.type === 'income-multiple').map(c => c.id),legacy.treasure.id,
  ]);
  assert.deepEqual(rules.legends.treasures.find(c => c.id === 'full-diamonds-hold').effect,{type:'fill-hold',goodId:'diamonds'});
  assert.equal(rules.legends.legendaryDeck.copiesByKind,null); // R05 is not resolved by the temporary 2×4 runtime deck.
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
