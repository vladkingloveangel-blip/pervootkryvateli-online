const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');
const legacy = require('../rules/compatibility/legacy.json');
const runtime = require('../rules/runtime');
const { validateCompatibility } = require('../rules/validate');
const copy = value => JSON.parse(JSON.stringify(value));

test('legacy profile references remain valid while canonical master data stays separate', () => {
  assert.deepEqual(validateCompatibility(rules,legacy),[]);
  assert.equal(runtime.BALANCE.session.startingDucats,legacy.session.startingDucats);
  assert.equal(rules.session.startingDucats,15);
  assert.deepEqual(runtime.SHIP_LEVELS[legacy.shipLevel7.level],{...legacy.shipLevel7,retired:true});
  assert.deepEqual(runtime.SHIP_UPGRADES[legacy.removedUpgrade.id],{...legacy.removedUpgrade,retired:true});
  assert.deepEqual(runtime.ESCORTS[legacy.removedEscort.id],{...legacy.removedEscort,retired:true});
  assert.equal(runtime.FACTIONS.mori,undefined);
  for (const [id, cards] of Object.entries(runtime.FEUD_CARDS)) {
    for (const card of cards) {
      const master = rules.events.feud[id].find(c => c.id === card.masterCardId);
      assert.equal(card.quantity,master.quantity,card.id);
      for (const key of ['percent','amount','count','fallbackDucats']) if (master.effect[key] !== undefined) assert.equal(card[key],master.effect[key],card.id);
    }
  }
  for (const [id, buildings] of Object.entries(legacy.factionPrizeBuildings)) assert.deepEqual(runtime.FACTIONS[id].fullConquestPrize.preserveBuildings,buildings);
  assert.deepEqual(runtime.TREASURE_CARDS.map(c => c.id),[
    ...rules.legends.treasures.filter(c => c.effect.type === 'income-multiple').map(c => c.id),legacy.treasure.id,
  ]);
  assert.deepEqual(rules.legends.treasures.find(c => c.id === 'full-diamonds-hold').effect,{type:'fill-hold',goodId:'diamonds'});
  assert.equal(rules.legends.legendaryDeck.copiesByKind,null); // R05 is not resolved by the temporary 2×4 runtime deck.
});

test('compatibility validator rejects broken saved-state references and projections', () => {
  const mutations = [
    x => x.shipLevel7.level++,
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
