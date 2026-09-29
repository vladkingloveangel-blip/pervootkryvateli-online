const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../rules');
const map = require('../map-config');
const { validateRules } = require('../rules/validate');
const fixture = require('./fixtures/master-tables.json');
const copy = value => JSON.parse(JSON.stringify(value));

test('appendix D: each feud row has the structured effect stated by the table', () => {
  const down = (count = 1, buildingTypes) => ({ type:'downgrade-building', steps:1, count, ...(buildingTypes && { buildingTypes }) });
  const income = { type:'skip-income', timing:'current-personal-turn', buildingTypes:['market','bank'] };
  const percent = percent => ({ type:'treasury-percent', percent });
  const upgrade = branch => ({ type:'remove-upgrade', count:1, ...(branch && { branch }) });
  const held = { type:'discard-random-held', count:1, targetZone:null, unresolved:'R29' };
  const cargo = { type:'remove-cargo', holds:1 };
  const none = { type:'none' };
  const ship = { type:'ship-level-loss', levels:1 };
  const expected = {
    lionia: [down(), {type:'reclaim-island',factionId:'lionia',fallbackDucats:4,keepBuildings:true}, ship, percent(50), income, percent(30), down(2,['fort','fortress'])],
    kadingir: [down(), income, ship, percent(10), down(), percent(20), upgrade('army'), {type:'remove-building',count:1,buildingTypes:['fort','fortress']}],
    mori: [{type:'movement-penalty',amount:2,timing:'current-personal-turn'},income,percent(20),cargo,upgrade(),down(),none],
    mayo: [percent(10),income,down(),upgrade(),held,{type:'treasury-flat',amount:2},none],
    suniksiya: [percent(20),income,{type:'treasury-flat',amount:3},held,cargo,down(),none],
    pirates: [down(),income,percent(20),upgrade('army'),upgrade(),percent(10),held,upgrade('artillery'),none],
  };
  for (const [faction, effects] of Object.entries(expected)) {
    assert.equal(effects.length, fixture.tables.feud[faction].length, faction);
    assert.deepEqual(rules.events.feud[faction].map(card => card.effect), effects, faction);
  }
});

test('appendix B: every sailing event has its source-grounded target and value', () => {
  const expected = [
    ['treasure'], ['legendary'], ['found-cargo','ore'], ['found-cargo','wood'], ['found-cargo','stone'],
    ['save-card','ship-master'], ['special-card','mist-path'], ['special-card','sea-veil'],
    ['save-card','market-blueprint'], ['save-card','farm-blueprint'],
    ['turn-effect','moveBonus',1], ['turn-effect','moveBonus',2], ['turn-effect','moveBonus',3],
    ['turn-effect','bestOfTwo',true], ['turn-effect','noNavigation',true],
    ['turn-effect','movePenalty',1], ['turn-effect','movePenalty',2], ['turn-effect','movePenalty',3],
    ['raid'], ['boarding'], ['storm','chertonia'], ['storm','kadingir'], ['storm','landin'],
    ['treasury-loss',30], ['turn-effect','noIncome',true],
  ];
  const actual = rules.events.sailing.map(c => {
    if (c.type === 'found-cargo') return [c.type,c.goodId];
    if (c.type === 'save-card') return [c.type,c.savedKind];
    if (c.type === 'special-card') return [c.type,c.legendaryCardId];
    if (c.type === 'turn-effect') return [c.type,c.effect,c.value];
    if (c.type === 'storm') return [c.type,c.islandId];
    if (c.type === 'treasury-loss') return [c.type,c.percent];
    return [c.type];
  });
  assert.equal(expected.length, fixture.events.length);
  assert.deepEqual(actual, expected);
});

test('master sections 6.6, 6.7 and 10.5 keep exact public, character and legendary effects', () => {
  const buildings = rules.economy.buildings;
  assert.deepEqual(['lighthouse','observatory','embassy','palace','cartography','admiralty'].map(id => buildings[id].effect), [
    {type:'departure-movement',amount:1}, {type:'replace-event',limit:1},
    {type:'choose-assignment',draw:2,keep:1}, {type:'end-enmity',usesPerGame:1},
    {type:'expedition-access'}, {type:'character-access'},
  ]);
  assert.deepEqual(rules.characters.characters.map(c => [c.admiraltyLevel,c.effect]), [
    [1,{type:'reroll-navigation',rerolls:1,secondResultMandatory:true}],
    [1,{type:'inspect-hidden-cards',range:4,distance:'manhattan',assignmentVisibility:null,unresolved:'R29'}],
    [2,{type:'peek-sea-deck',range:4,distance:'manhattan',count:1}],
    [2,{type:'choose-treasure',draw:2,keep:1}],
    [3,{type:'extra-action',count:1}],
    [3,{type:'prevent-battle-level-loss',levels:1,anchorPenaltyExcluded:true}],
  ]);
  assert.deepEqual(rules.legends.legendary.map(c => c.effect), [
    {type:'protect',durationPersonalTurns:3,hostileCardReactionExpiry:'end-of-current-turn',reactionActionCost:0},
    {type:'downgrade-all-buildings',steps:1}, {type:'relocate-reachable'},
    {type:'movement-penalty',amount:3,durationPersonalTurns:3},
  ]);
  assert.deepEqual(rules.legends.treasures.map(c => c.effect), [
    {type:'income-multiple',multiplier:1,minimum:2}, {type:'income-multiple',multiplier:2,minimum:4},
    {type:'income-multiple',multiplier:3,minimum:6}, {type:'fill-hold',goodId:'diamonds'},
  ]);
});

test('appendix G assignments and legendary places reference the entities named in their rows', () => {
  const expectedRefs = {
    lionia: ['capture:asigoriy','capture:chertonia','capture:skull','build:frandia:fort',
      'build-type:shipyard:wood','build:frandia:money','ship-level',
      'anchor:yellow','anchor:yellow','anchor:yellow'],
    kadingir: ['capture:harash','place:abyss','build:kadingir:fort','build:kadingir:food',
      'build:kadingir:money','build:kadingir:stone','ship-level','upgrade:cargo',
      'upgrade:speed','delivery:any'],
    mori: ['island:renaika','island:chertog','island:kisalinia','island:yukon',
      'island:erkalon','island:asigoriy','island:atlantia','island:adia',
      'route:renaika>mori','route:kisalinia>citadel'],
    suniksiya: ['place:kraken','build:suniksiya:food','build:suniksiya:money',
      'delivery:any','delivery:provisions','delivery:wood,stone','delivery:ore',
      'upgrade:cargo','upgrade:speed','treasure-resolved'],
    pirates: ['place:kraken','place:abyss','place:pharaoh','place:pearl',
      'attack-player-island','capture:mao','anchor:blue,yellow','anchor:blue,yellow',
      'upgrade:artillery'],
  };
  const refKey = c => {
    switch (c.type) {
      case 'capture-island': return `capture:${c.islandId}`;
      case 'build-branch': return `build:${c.islandId}:${c.branch}`;
      case 'build-type': return `build-type:${c.buildingType}:${c.resourceId}`;
      case 'anchor-win': return `anchor:${c.colors.join(',')}`;
      case 'visit-place': return `place:${c.placeId}`;
      case 'stat-upgrade': return `upgrade:${c.branch}`;
      case 'delivery': return `delivery:${c.goodIds?.join(',') || 'any'}`;
      case 'visit-island': return `island:${c.islandId}`;
      case 'visit-route': return `route:${c.route.map(stop => stop.islandId || stop.mapObjectId).join('>')}`;
      default: return c.type;
    }
  };
  for (const [faction,cards] of Object.entries(rules.politics.assignments)) {
    assert.equal(expectedRefs[faction].length,fixture.tables.assignments[faction].length,faction);
    assert.deepEqual(cards.map(refKey),expectedRefs[faction],faction);
  }
  const islands = new Map(rules.islands.map(i => [i.id,i.name]));
  const places = new Map(rules.legends.places.map(p => [p.id,p.name]));
  const namesTargetSameEntity = (text, name) => text.toLocaleLowerCase('ru').includes(name.slice(0,Math.min(name.length <= 5 ? 3 : 4,name.length)).toLocaleLowerCase('ru'));
  for (const card of Object.values(rules.politics.assignments).flat()) {
    if (card.islandId) assert.ok(namesTargetSameEntity(card.text,islands.get(card.islandId)),card.id);
    if (card.placeId) assert.ok(namesTargetSameEntity(card.text,places.get(card.placeId)),card.id);
  }
  assert.equal(rules.politics.assignments.lionia.find(c => c.id === 'lionia-shipyard-forest').resourceId,'wood');
  assert.deepEqual(rules.politics.assignments.mori.slice(-2).map(c => c.route), [
    [{islandId:'renaika'},{islandId:'mori'}],
    [{islandId:'kisalinia'},{mapObjectId:'citadel'}],
  ]);
  assert.deepEqual(rules.politics.assignments.suniksiya.find(c => c.id === 'suniksiya-delivery-wood-stone').goodIds,['wood','stone']);
  for (const p of rules.legends.places) {
    if (p.kind === 'island') assert.deepEqual(p.reward,{type:'island-reward',islandId:p.islandId});
    else assert.deepEqual(p.reward,{type:p.id === 'kraken' ? 'legendary':'treasure',count:1});
  }
});

test('validator rejects malformed effect values and broken cross-catalog references', () => {
  const mutations = [
    x => delete x.economy.buildings.observatory.effect.limit,
    x => x.economy.buildings.embassy.effect.keep = 3,
    x => x.economy.buildings.farm.levels[1].price++,
    x => x.events.feud.lionia[1].effect.factionId = 'pirates',
    x => x.events.feud.mori[0].effect.timing = 'next-round',
    x => x.events.feud.mayo[4].effect.targetZone = 'hand',
    x => x.events.feud.pirates[3].effect.branch = 'wood',
    x => x.events.feud.lionia[6].effect.buildingTypes = ['fort','missing'],
    x => x.events.feud.kadingir[3].effect.percent = 101,
    x => x.events.feud.mori[3].effect.holds = 0,
    x => x.events.feud.mori[6].effect.amount = 2,
    x => delete x.politics.assignments.lionia[4].resourceId,
    x => x.politics.assignments.lionia[4].resourceId = 'stone',
    x => delete x.politics.assignments.kadingir[1].placeId,
    x => x.politics.assignments.mori[8].route = [{islandId:'renaika'}],
    x => x.politics.assignments.mori[8].route[1] = null,
    x => x.events.sailing.find(c => c.id === 'found-wood').goodId = 'missing',
    x => delete x.events.sailing.find(c => c.id === 'farm-blueprint').buildingType,
    x => x.events.sailing.find(c => c.id === 'fortune').value = 2,
    x => x.events.sailing.find(c => c.id === 'military-levy').percent = 101,
    x => x.events.sailing.find(c => c.id === 'sea-veil').legendaryCardId = 'mist-path',
    x => x.legends.places.find(p => p.id === 'atlantia').reward.islandId = 'skull',
    x => x.legends.places.find(p => p.id === 'kraken').reward.count = 0,
    x => delete x.characters.characters[0].effect.rerolls,
    x => x.characters.characters[1].effect.assignmentVisibility = true,
    x => x.characters.characters[3].effect.keep = 3,
  ];
  for (const [index,mutate] of mutations.entries()) {
    const value = copy(rules); mutate(value);
    assert.notDeepEqual(validateRules(value,map),[],`mutation ${index + 1} was accepted`);
  }
});
