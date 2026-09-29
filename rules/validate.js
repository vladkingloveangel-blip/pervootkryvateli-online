// Small domain-specific validator; no runtime effect interpreter or schema DSL.
function validateRules(rules, map) {
  const errors = [];
  const check = (condition, path, message) => { if (!condition) errors.push(`${path}: ${message}`); };
  const integer = (n, path, min = 0) => check(Number.isInteger(n) && n >= min, path, 'expected integer');
  const unique = (list, path) => {
    const seen = new Set();
    for (const value of list) { check(!seen.has(value), path, `duplicate ${value}`); seen.add(value); }
  };
  const records = (list, path) => {
    unique(list.map(x => x.id), path);
    for (const x of list) {
      check(typeof x.id === 'string' && x.id.length > 0, path, 'missing id');
      check(typeof (x.name || x.text) === 'string', `${path}.${x.id}`, 'missing name/text');
      check(typeof x.iconKey === 'string', `${path}.${x.id}`, 'missing iconKey');
      if (x.availability) {
        check(x.availability.status === 'data-ready', path, 'invalid availability');
        check(x.availability.consumerStage >= 2 && x.availability.consumerStage <= 7, path, 'invalid consumer stage');
      }
    }
  };
  const { fleet, economy, politics, legends } = rules;
  const islands = new Set(rules.islands.map(i => i.id));
  const places = new Set(legends.places.map(p => p.id));
  const factions = new Set(Object.keys(politics.factions));
  const buildings = new Set(Object.keys(economy.buildings));
  const goods = new Set(Object.keys(economy.goods));
  const resources = new Set(Object.keys(economy.resources));
  const branches = new Set(economy.buildingBranches.map(b => b.id));
  const upgradeBranches = new Set(Object.values(fleet.upgrades).map(u => u.branch));
  const ref = (id, set, path) => check(set.has(id), path, `unknown reference ${id}`);
  const required = (value, keys, path) => {
    for (const key of keys) check(value[key] !== undefined && value[key] !== null, `${path}.${key}`, 'missing required field');
  };
  const only = (value, keys, path) => {
    for (const key of Object.keys(value)) check(keys.includes(key), `${path}.${key}`, 'unexpected field');
  };
  const positive = (value, path) => integer(value, path, 1);
  const boolean = (value, path) => check(typeof value === 'boolean', path, 'expected boolean');
  const nonemptyIds = (value, set, path) => {
    check(Array.isArray(value) && value.length > 0, path, 'expected nonempty list');
    if (!Array.isArray(value)) return;
    unique(value, path);
    for (const id of value) ref(id, set, path);
  };
  const effectTypes = new Set(['movement-penalty','skip-income','reclaim-island','ship-level-loss',
    'treasury-percent','treasury-flat','remove-upgrade','remove-cargo','discard-random-held','none',
    'remove-building','downgrade-building','departure-movement','replace-event','choose-assignment',
    'end-enmity','expedition-access','character-access','protect','downgrade-all-buildings',
    'relocate-reachable','income-multiple','fill-hold','reroll-navigation','inspect-hidden-cards',
    'peek-sea-deck','choose-treasure','extra-action','prevent-battle-level-loss']);
  function effect(e, path) {
    check(e && effectTypes.has(e.type), path, `unknown effect ${e?.type}`);
    if (!e || !effectTypes.has(e.type)) return;
    // Each effect stays a plain data object. Closed field lists catch silent typos in deferred mechanics.
    const shapes = {
      'movement-penalty': [['amount'], ['timing','durationPersonalTurns']],
      'skip-income': [['timing','buildingTypes']],
      'reclaim-island': [['factionId','fallbackDucats','keepBuildings']],
      'ship-level-loss': [['levels']],
      'treasury-percent': [['percent']], 'treasury-flat': [['amount']],
      'remove-upgrade': [['count'], ['branch']], 'remove-cargo': [['holds']],
      'discard-random-held': [['count','targetZone','unresolved']], 'none': [[]],
      'remove-building': [['count','buildingTypes']],
      'downgrade-building': [['count','steps'], ['buildingTypes']],
      'departure-movement': [['amount']], 'replace-event': [['limit']],
      'choose-assignment': [['draw','keep']], 'end-enmity': [['usesPerGame']],
      'expedition-access': [[]], 'character-access': [[]],
      'protect': [['durationPersonalTurns','hostileCardReactionExpiry','reactionActionCost']],
      'downgrade-all-buildings': [['steps']], 'relocate-reachable': [[]],
      'income-multiple': [['minimum','multiplier']], 'fill-hold': [['goodId']],
      'reroll-navigation': [['rerolls','secondResultMandatory']],
      'inspect-hidden-cards': [['range','distance','assignmentVisibility','unresolved']],
      'peek-sea-deck': [['range','distance','count']],
      'choose-treasure': [['draw','keep']], 'extra-action': [['count']],
      'prevent-battle-level-loss': [['levels','anchorPenaltyExcluded']],
    };
    const [needed, optional = []] = shapes[e.type];
    required(e, needed.filter(key => !['targetZone','assignmentVisibility'].includes(key)), path);
    for (const key of needed.filter(key => ['targetZone','assignmentVisibility'].includes(key))) check(Object.hasOwn(e,key), `${path}.${key}`, 'missing required field');
    only(e, ['type',...needed,...optional], path);
    for (const key of ['amount','count','steps','levels','durationPersonalTurns','range','draw','keep','minimum','multiplier','usesPerGame','holds','rerolls','limit']) if (key in e) positive(e[key], `${path}.${key}`);
    for (const key of ['fallbackDucats','reactionActionCost']) if (key in e) integer(e[key], `${path}.${key}`);
    if ('percent' in e) check(Number.isInteger(e.percent) && e.percent >= 0 && e.percent <= 100, `${path}.percent`, 'expected percentage 0..100');
    for (const key of ['keepBuildings','secondResultMandatory','anchorPenaltyExcluded']) if (key in e) boolean(e[key], `${path}.${key}`);
    if ('draw' in e && 'keep' in e) check(e.keep <= e.draw, path, 'keep exceeds draw');
    if (e.goodId !== undefined) ref(e.goodId, goods, path);
    if (e.factionId !== undefined) ref(e.factionId, factions, path);
    if (e.branch !== undefined) ref(e.branch, upgradeBranches, path);
    if (e.buildingTypes !== undefined) nonemptyIds(e.buildingTypes, buildings, `${path}.buildingTypes`);
    if (e.timing !== undefined) check(e.timing === 'current-personal-turn', path, 'invalid timing');
    if (e.distance !== undefined) check(e.distance === 'manhattan', path, 'invalid distance');
    if (e.type === 'movement-penalty') check((e.timing === 'current-personal-turn') !== Number.isInteger(e.durationPersonalTurns), path, 'expected exactly one duration');
    if (e.type === 'reclaim-island') check(rules.islands.some(i => i.factionId === e.factionId), path, 'faction has no original island');
    if (e.type === 'discard-random-held') check(e.targetZone === null && e.unresolved === 'R29', path, 'unresolved target must stay neutral');
    if (e.type === 'inspect-hidden-cards') check(e.assignmentVisibility === null && e.unresolved === 'R29', path, 'unresolved visibility must stay neutral');
    if (e.type === 'protect') check(e.hostileCardReactionExpiry === 'end-of-current-turn', path, 'invalid reaction expiry');
  }
  integer(rules.metadata.schemaVersion, 'metadata.schemaVersion', 1);
  check(Boolean(rules.metadata.rulesetVersion), 'metadata', 'missing rulesetVersion');
  check(rules.islands.length === 28, 'islands', 'expected 28 islands');
  records(rules.islands, 'islands');
  for (const i of rules.islands) {
    integer(i.area, i.id, 1); integer(i.army, i.id);
    unique(i.resourceIds, `${i.id}.resources`);
    for (const id of i.resourceIds) ref(id, resources, i.id);
    check(['free','independent','state'].includes(i.kind), i.id, 'invalid kind');
    if (i.kind === 'state') ref(i.factionId, factions, i.id);
    else check(i.factionId === null, i.id, 'non-state island has faction');
    check(Boolean(i.reward?.trigger), i.id, 'missing reward trigger');
    for (const field of ['ducats','legendary']) if (field in i.reward) integer(i.reward[field], `${i.id}.reward.${field}`);
    if (i.reward.legendaryCardId) ref(i.reward.legendaryCardId, new Set(legends.legendary.map(c => c.id)), i.id);
    for (const b of i.reward.buildings || []) {
      ref(b.type, buildings, i.id);
      check(Boolean(economy.buildings[b.type]?.levels[b.level]), i.id, 'unknown reward level');
    }
  }
  check(Object.keys(fleet.ships).length === 4, 'ships', 'expected four classes');
  for (const id of ['brigantine','frigate','caravel','carrack']) check(Boolean(fleet.ships[id]), 'ships', `missing ${id}`);
  for (const [domain, catalog] of Object.entries({ships:fleet.ships,upgrades:fleet.upgrades,escorts:fleet.escorts,goods:economy.goods,resources:economy.resources,buildings:economy.buildings,factions:politics.factions})) {
    records(Object.values(catalog), domain);
    for (const [id, value] of Object.entries(catalog)) check(value.id === id, domain, `key/id mismatch ${id}`);
  }
  check(Object.keys(fleet.levels).length === fleet.maxLevel, 'levels', 'missing or extra levels');
  for (let level = 1; level <= fleet.maxLevel; level++) {
    const d = fleet.levels[level]; check(d?.level === level, 'levels', `missing ${level}`);
    if (!d) continue;
    for (const key of ['price','statBonus','moveBonus','upgradeSlots','escortLimit']) integer(d[key], `levels.${level}.${key}`);
  }
  for (const s of Object.values(fleet.ships)) {
    for (const key of ['artillery','army','cargo']) integer(s[key], `${s.id}.${key}`);
    check(Number.isInteger(s.moveMod), s.id, 'missing moveMod');
    check(['shoal','reef','ice','land1'].includes(s.passability), s.id, 'invalid passability');
  }
  for (const u of Object.values(fleet.upgrades)) {
    integer(u.price, u.id); integer(u.order, u.id, 1);
    if (u.requires) {
      const previous = fleet.upgrades[u.requires];
      check(previous && previous.branch === u.branch && previous.order < u.order, u.id, 'invalid prerequisite');
    }
  }
  for (const g of Object.values(economy.goods)) integer(g.price, g.id);
  for (const r of Object.values(economy.resources)) ref(r.goodId, goods, r.id);
  for (const branch of economy.buildingBranches) {
    unique(branch.types, branch.id);
    for (const type of branch.types) ref(type, buildings, branch.id);
  }
  for (const b of Object.values(economy.buildings)) {
    integer(b.price, b.id); check(b.area === 1, b.id, 'building must occupy one area');
    check(b.price === b.levels?.[1]?.price, b.id, 'price differs from level I');
    if (b.produces) ref(b.produces, goods, b.id);
    if (b.resourceId) ref(b.resourceId, resources, b.id);
    check(Object.keys(b.levels || {}).length > 0, b.id, 'missing levels');
    for (const [level, d] of Object.entries(b.levels || {})) {
      check(d.level === +level, b.id, 'invalid level');
      for (const key of ['price','foodStage','area']) integer(d[key], `${b.id}.${level}.${key}`);
      if (d.next) {
        const target = economy.buildings[d.next.type]?.levels[d.next.level];
        check(Boolean(target), b.id, 'invalid next level');
        check(d.next.type !== b.id || d.next.level > d.level, b.id, 'cyclic level chain');
      }
    }
    if (b.effect) effect(b.effect, b.id);
  }
  unique(politics.order, 'politics.order');
  check(politics.order.length === 6, 'politics.order', 'expected six states');
  for (const id of politics.order) ref(id, factions, 'politics.order');
  for (const f of Object.values(politics.factions)) {
    integer(f.tax, f.id); integer(f.fullConquestPrize.ducats, f.id);
    for (const id of f.originalIslandIds) {
      ref(id, islands, f.id);
      check(rules.islands.find(i => i.id === id)?.factionId === f.id, f.id, 'island/faction mismatch');
    }
    if (f.giftIslandId) check(f.originalIslandIds.includes(f.giftIslandId), f.id, 'invalid gift island');
  }
  const assignmentTypes = new Set(['capture-island','build-branch','build-type','ship-level','anchor-win','visit-place','stat-upgrade','delivery','attack-player-island','treasure-resolved','visit-island','visit-route']);
  const allAssignments = Object.values(politics.assignments).flat();
  records(allAssignments, 'assignments'); check(allAssignments.length === 49, 'assignments', 'expected 49 cards');
  for (const [factionId, cards] of Object.entries(politics.assignments)) for (const c of cards) {
    ref(factionId, factions, c.id); check(c.factionId === factionId, c.id, 'faction mismatch');
    integer(c.reward, c.id); check(assignmentTypes.has(c.type), c.id, 'unknown condition');
    const assignmentFields = {
      'capture-island':['islandId'], 'build-branch':['islandId','branch'],
      'build-type':['buildingType','resourceId'], 'ship-level':[],
      'anchor-win':['colors'], 'visit-place':['placeId'], 'stat-upgrade':['branch'],
      'delivery':['goodIds'], 'attack-player-island':[], 'treasure-resolved':[],
      'visit-island':['islandId'], 'visit-route':['route'],
    };
    if (assignmentFields[c.type]) {
      only(c, ['id','conditionKey','text','reward','type','factionId','iconKey','availability',
        ...assignmentFields[c.type],...(c.type === 'build-type' ? ['resource'] : [])], c.id);
      for (const key of assignmentFields[c.type]) {
        if (key === 'goodIds') check(Object.hasOwn(c,key), `${c.id}.${key}`, 'missing required field');
        else required(c,[key],c.id);
      }
    }
    if (c.islandId) ref(c.islandId, islands, c.id);
    if (c.placeId) ref(c.placeId, places, c.id);
    if (c.buildingType) ref(c.buildingType, buildings, c.id);
    if (c.resourceId) ref(c.resourceId, resources, c.id);
    if (c.resource && c.resourceId) check(economy.resources[c.resourceId]?.name === c.resource, c.id, 'resource label/id mismatch');
    if (c.branch) ref(c.branch, new Set([...branches,...upgradeBranches]), c.id);
    if (c.goodIds !== null && c.goodIds !== undefined) nonemptyIds(c.goodIds, goods, `${c.id}.goodIds`);
    if (c.colors !== undefined) nonemptyIds(c.colors, new Set(Object.keys(rules.sea)), `${c.id}.colors`);
    if (c.type === 'visit-route') check(Array.isArray(c.route) && c.route.length === 2, c.id, 'expected two ordered stops');
    if (c.type === 'build-branch') check(economy.buildingBranches.some(b => b.id === c.branch), c.id, 'unknown building branch');
    if (c.type === 'stat-upgrade') check(upgradeBranches.has(c.branch), c.id, 'unknown upgrade branch');
    if (c.type === 'build-type') check(c.resourceId && rules.islands.some(i => i.resourceIds.includes(c.resourceId)), c.id, 'resource has no island');
    for (const stop of Array.isArray(c.route) ? c.route : []) {
      if (!stop || typeof stop !== 'object' || Array.isArray(stop)) { check(false, c.id, 'invalid route stop'); continue; }
      check(Object.keys(stop).length === 1, c.id, 'route stop must have one reference');
      if (stop.islandId) ref(stop.islandId, islands, c.id);
      else check(stop.mapObjectId === map.CITADEL.id, c.id, 'unknown route stop');
    }
  }
  function deck(cards, expected, path) {
    records(cards, path);
    for (const c of cards) integer(c.quantity, `${path}.${c.id}.quantity`, 1);
    check(cards.reduce((n,c) => n+c.quantity,0) === expected, path, `expected ${expected} copies`);
  }
  for (const color of ['blue','yellow','red']) {
    const cards = rules.sea[color]; deck(cards, 10, `sea.${color}`);
    for (const c of cards) { integer(c.reward, c.id); if (c.quiet) check(c.artillery === null, c.id, 'quiet artillery'); else integer(c.artillery, c.id, 1); }
  }
  deck(rules.events.sailing, 26, 'sailing');
  const eventTypes = new Set(['treasure','legendary','found-cargo','save-card','special-card','turn-effect','raid','boarding','storm','treasury-loss']);
  for (const c of rules.events.sailing) {
    check(eventTypes.has(c.type), c.id, 'unknown event type');
    const eventFields = {treasure:[],legendary:[],'found-cargo':['goodId'],
      'save-card':['savedKind'],'special-card':['legendaryCardId'],
      'turn-effect':['effect','value','timing'],raid:[],boarding:[],storm:['islandId'],
      'treasury-loss':['percent']};
    if (eventFields[c.type]) {
      only(c, ['id','name','rulesText','source','quantity','iconKey','availability','type',
        ...eventFields[c.type],...(c.type === 'save-card' ? ['buildingType'] : []),
        ...(c.type === 'special-card' ? ['cardName'] : [])], c.id);
      for (const key of eventFields[c.type]) required(c,[key],c.id);
    }
    if (c.goodId) ref(c.goodId, goods, c.id);
    if (c.islandId) ref(c.islandId, islands, c.id);
    if (c.buildingType) ref(c.buildingType, buildings, c.id);
    if (c.legendaryCardId) ref(c.legendaryCardId, new Set(legends.legendary.map(x=>x.id)), c.id);
    if (c.type === 'turn-effect') {
      check(['moveBonus','movePenalty','bestOfTwo','noNavigation','noIncome'].includes(c.effect), c.id, 'unknown turn effect');
      check(c.timing === 'current-personal-turn', c.id, 'invalid timing');
      if (['moveBonus','movePenalty'].includes(c.effect)) positive(c.value, `${c.id}.value`);
      else check(c.value === true, `${c.id}.value`, 'expected true');
    }
    if (c.type === 'treasury-loss') check(Number.isInteger(c.percent) && c.percent >= 0 && c.percent <= 100, c.id, 'invalid percentage');
    if (c.type === 'special-card') check(legends.legendary.find(x => x.id === c.legendaryCardId)?.name === c.cardName, c.id, 'card name/reference mismatch');
    if (c.type === 'save-card') {
      check(['ship-master','market-blueprint','farm-blueprint'].includes(c.savedKind), c.id, 'unknown saved card');
      if (c.savedKind === 'ship-master') check(c.buildingType === undefined, c.id, 'ship master is not a building blueprint');
      else check(c.buildingType && c.savedKind === `${c.buildingType}-blueprint`, c.id, 'blueprint/reference mismatch');
    }
  }
  for (const id of politics.order) {
    deck(rules.events.feud[id], 10, `feud.${id}`);
    for (const c of rules.events.feud[id]) {
      check(c.factionId === id, c.id, 'faction mismatch'); effect(c.effect, c.id);
      if (c.effect?.type === 'reclaim-island') check(c.effect.factionId === id, c.id, 'reclaim faction/card mismatch');
    }
  }
  records(legends.places, 'places'); check(legends.places.length === 10, 'places', 'expected ten places');
  for (const p of legends.places) {
    check(['island','sea'].includes(p.kind), p.id, 'invalid place kind');
    if (p.kind === 'island') {
      ref(p.islandId, islands, p.id);
      check(p.reward?.type === 'island-reward' && p.reward.islandId === p.islandId, p.id, 'island reward/reference mismatch');
    } else {
      ref(p.mapPlaceId, new Set(Object.keys(map.LEGENDARY_PLACES)), p.id);
      check(['treasure','legendary'].includes(p.reward?.type), p.id, 'invalid sea reward');
      positive(p.reward?.count, `${p.id}.reward.count`);
    }
  }
  for (const key of ['namedCards','expeditions']) {
    deck(legends[key], 10, key); unique(legends[key].map(c=>c.placeId), key);
    for (const c of legends[key]) ref(c.placeId, places, c.id);
  }
  records(legends.legendary, 'legendary'); records(legends.treasures, 'treasures');
  for (const c of [...legends.legendary,...legends.treasures]) effect(c.effect, c.id);
  // Unknown copies stay nullable; do not turn a temporary runtime choice into a rule.
  records(rules.characters.characters, 'characters');
  check(rules.characters.characters.length === 6, 'characters', 'expected six characters');
  for (const c of rules.characters.characters) {
    check(Boolean(economy.buildings.admiralty.levels[c.admiraltyLevel]), c.id, 'invalid admiralty level');
    effect(c.effect, c.id);
  }
  const coordinate = (cell, path) => check(Array.isArray(cell) && cell.length === 2 && cell.every(Number.isInteger)
    && cell[0] >= 0 && cell[0] < map.MAP_META.rows && cell[1] >= 0 && cell[1] < map.MAP_META.cols, path, 'invalid coordinate');
  check(map.MAP_META.rows === 28 && map.MAP_META.cols === 28, 'map', 'expected 28x28');
  unique(map.ISLAND_DEFS.map(i => i.id), 'map islands');
  check(map.ISLAND_DEFS.length === islands.size, 'map islands', 'missing geometry');
  for (const i of map.ISLAND_DEFS) { ref(i.id, islands, 'map'); check(i.cells.length > 0, i.id, 'missing cells'); unique(i.cells.map(String), i.id); i.cells.forEach(c=>coordinate(c,i.id)); }
  for (const [id, obj] of Object.entries({...map.HAZARDS,...map.ANCHORS})) obj.cells.forEach(c=>coordinate(c,id));
  for (const p of Object.values(map.LEGENDARY_PLACES)) coordinate([p.row,p.col],p.id);
  for (const c of [...map.CITADEL_CELLS,...map.LAND_CELLS,...map.SPECIAL_LAND]) coordinate(c,'map');
  return errors;
}
module.exports = { validateRules };
