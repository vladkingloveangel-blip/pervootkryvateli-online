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
      'discard-random-held': [['count','targetZone']], 'none': [[]],
      'remove-building': [['count','buildingTypes']],
      'downgrade-building': [['count','steps'], ['buildingTypes']],
      'departure-movement': [['amount']], 'replace-event': [['limit']],
      'choose-assignment': [['draw','keep']], 'end-enmity': [['usesPerGame']],
      'expedition-access': [[]], 'character-access': [[]],
      'protect': [['durationPersonalTurns','hostileCardReactionExpiry','reactionActionCost']],
      'downgrade-all-buildings': [['steps']], 'relocate-reachable': [[]],
      'income-multiple': [['minimum','multiplier']], 'fill-hold': [['goodId']],
      'reroll-navigation': [['rerolls','secondResultMandatory']],
      'inspect-hidden-cards': [['range','distance','modes','revealCount','duration']],
      'peek-sea-deck': [['range','distance','count']],
      'choose-treasure': [['draw','keep']], 'extra-action': [['count']],
      'prevent-battle-level-loss': [['levels','anchorPenaltyExcluded']],
    };
    const [needed, optional = []] = shapes[e.type];
    required(e, needed.filter(key => !['targetZone','assignmentVisibility'].includes(key)), path);
    for (const key of needed.filter(key => ['targetZone','assignmentVisibility'].includes(key))) check(Object.hasOwn(e,key), `${path}.${key}`, 'missing required field');
    only(e, ['type',...needed,...optional], path);
    for (const key of ['amount','count','steps','levels','durationPersonalTurns','range','draw','keep','minimum','multiplier','usesPerGame','holds','rerolls','limit','revealCount']) if (key in e) positive(e[key], `${path}.${key}`);
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
    if (e.type === 'discard-random-held') check(e.targetZone === 'closed-hand-except-active-assignment', path, 'random discard must target the closed hand while protecting the active assignment');
    if (e.type === 'inspect-hidden-cards') {
      check(Array.isArray(e.modes) && e.modes.length === 2 && new Set(e.modes).size === 2 && e.modes.includes('garrison') && e.modes.includes('money'), path, 'Scout modes must be exactly garrison and money');
      check(e.revealCount === 1, path, 'Scout must reveal exactly one target per use');
      check(e.duration === 'current-personal-turn', path, 'Scout reveal must expire at end of current personal turn');
    }
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
    check(!Object.hasOwn(i.reward, 'buildings'), i.id, 'prize-building rewards are retired by author decision');
  }
  check(Object.keys(fleet.ships).length === 4, 'ships', 'expected four classes');
  for (const id of ['brigantine','frigate','caravel','carrack']) check(Boolean(fleet.ships[id]), 'ships', `missing ${id}`);
  for (const [domain, catalog] of Object.entries({ships:fleet.ships,upgrades:fleet.upgrades,escorts:fleet.escorts,goods:economy.goods,resources:economy.resources,buildings:economy.buildings,factions:politics.factions})) {
    records(Object.values(catalog), domain);
    for (const [id, value] of Object.entries(catalog)) check(value.id === id, domain, `key/id mismatch ${id}`);
  }
  check(fleet.maxLevel === 6, 'fleet.maxLevel', 'expected VI maximum');
  check(Object.keys(fleet.levels).length === fleet.maxLevel, 'levels', 'missing or extra levels');
  for (let level = 1; level <= fleet.maxLevel; level++) {
    const d = fleet.levels[level]; check(d?.level === level, 'levels', `missing ${level}`);
    if (!d) continue;
    for (const key of ['price','statBonus','moveBonus','upgradeSlots','escortLimit']) integer(d[key], `levels.${level}.${key}`);
    check(d.moveBonus === 0, `levels.${level}.moveBonus`, 'ship levels must not add movement');
    check(d.upgradeSlots === level, `levels.${level}.upgradeSlots`, 'expected one upgrade slot per level');
  }
  for (const s of Object.values(fleet.ships)) {
    for (const key of ['artillery','army','cargo']) integer(s[key], `${s.id}.${key}`);
    check(Number.isInteger(s.moveMod), s.id, 'missing moveMod');
    check(['shoal','reef','ice','land1'].includes(s.passability), s.id, 'invalid passability');
  }
  check(Array.isArray(fleet.escortPrices) && fleet.escortPrices.length === 3, 'escortPrices', 'expected three escort purchase prices');
  for (const [index, price] of (fleet.escortPrices || []).entries()) positive(price, `escortPrices.${index}`);
  check(Object.keys(fleet.escorts).length === 2, 'escorts', 'expected cargo and combat escorts only');
  for (const id of ['cargo','combat']) check(Boolean(fleet.escorts[id]), 'escorts', `missing ${id}`);
  for (const escort of Object.values(fleet.escorts)) for (const key of ['artillery','army','cargo']) integer(escort[key], `${escort.id}.${key}`);
  check(fleet.escorts.cargo?.artillery === 0 && fleet.escorts.cargo?.army === 0 && fleet.escorts.cargo?.cargo > 0, 'escorts.cargo', 'invalid cargo escort profile');
  check(fleet.escorts.combat?.artillery > 0 && fleet.escorts.combat?.army === 0 && fleet.escorts.combat?.cargo === 0, 'escorts.combat', 'invalid combat escort profile');
  for (let level = 1; level <= fleet.maxLevel; level++) {
    check(fleet.levels[level]?.escortLimit === Math.ceil(level / 2), `levels.${level}.escortLimit`, 'expected 1/1/2/2/3/3 escort limit');
  }
  const shipyardLevels = economy.buildings?.shipyard?.levels || {};
  for (let level = 1; level <= 3; level++) {
    check(shipyardLevels[level]?.escortSlots === level, `buildings.shipyard.levels.${level}.escortSlots`, 'expected one escort slot per shipyard level');
  }
  positive(fleet.maxBranchUpgrades, 'fleet.maxBranchUpgrades');
  const upgradesByBranch = new Map();
  for (const u of Object.values(fleet.upgrades)) {
    integer(u.price, u.id); integer(u.order, u.id, 1);
    check(u.order <= fleet.maxBranchUpgrades, u.id, 'upgrade order exceeds branch limit');
    if (u.order > 1) required(u,['requires'],u.id);
    if (u.requires) {
      const previous = fleet.upgrades[u.requires];
      check(previous && previous.branch === u.branch && previous.order < u.order, u.id, 'invalid prerequisite');
    }
    if (!upgradesByBranch.has(u.branch)) upgradesByBranch.set(u.branch, []);
    upgradesByBranch.get(u.branch).push(u);
  }
  for (const [branch, branchUpgrades] of upgradesByBranch) {
    check(branchUpgrades.length <= fleet.maxBranchUpgrades, `upgrades.${branch}`, 'too many upgrades in branch');
    unique(branchUpgrades.map(u => u.order), `upgrades.${branch}.orders`);
  }
  const navigationUpgrades = Object.values(fleet.upgrades).filter(u => u.passability);
  check(navigationUpgrades.length === 4, 'navigationUpgrades', 'expected four navigation upgrades');
  unique(navigationUpgrades.map(u => u.passability), 'navigationUpgrades.passability');
  unique(navigationUpgrades.map(u => u.branch), 'navigationUpgrades.branches');
  for (const u of navigationUpgrades) {
    check(['shoal','reef','ice','land1'].includes(u.passability), u.id, 'invalid navigation passability');
    check(u.order === 1 && !u.requires, u.id, 'navigation upgrade must be a one-level branch');
    check(u.branch === u.id, u.id, 'navigation upgrade must use its own branch');
    check(u.availability?.status === 'data-ready' && u.availability?.consumerStage === 3, u.id, 'navigation upgrade must target stage 3');
  }
  for (const g of Object.values(economy.goods)) integer(g.price, g.id);
  for (const r of Object.values(economy.resources)) ref(r.goodId, goods, r.id);
  unique(economy.buildingBranches.map(b => b.id), 'buildingBranches');
  const listedBuildingTypes = [];
  for (const branch of economy.buildingBranches) {
    unique(branch.types, branch.id);
    for (const type of branch.types) {
      ref(type, buildings, branch.id);
      listedBuildingTypes.push(type);
      check(economy.buildings[type]?.branch === branch.id, branch.id, `building branch mismatch ${type}`);
    }
  }
  unique(listedBuildingTypes, 'buildingBranches.types');
  for (const b of Object.values(economy.buildings)) {
    integer(b.price, b.id); check(b.area === 1, b.id, 'building must occupy one area');
    const singleStage = b.singleStage === true;
    if (singleStage) {
      check(!Object.hasOwn(b, 'levels'), `${b.id}.levels`, 'single-stage building must not define levels');
    } else {
      check(b.price === b.levels?.[1]?.price, b.id, 'price differs from level I');
    }
    if (branches.has(b.branch)) check(listedBuildingTypes.includes(b.id), b.id, 'missing from building branch');
    if (b.produces) ref(b.produces, goods, b.id);
    if (b.resourceId) {
      ref(b.resourceId, resources, b.id);
      check(b.resource === economy.resources[b.resourceId]?.name, b.id, 'resource label/id mismatch');
      check(b.produces === economy.resources[b.resourceId]?.goodId, b.id, 'resource/product mismatch');
    }
    for (const key of ['defense','income']) {
      if (b[key] !== undefined && !singleStage) check(b[key] === b.levels?.[1]?.[key], b.id, `${key} differs from level I`);
    }
    if (b.limitPerIsland !== undefined) positive(b.limitPerIsland, `${b.id}.limitPerIsland`);
    if (!singleStage) {
      check(Object.keys(b.levels || {}).length > 0, b.id, 'missing levels');
      const levels = Object.keys(b.levels || {}).map(Number).sort((a,c) => a-c);
      const branch = economy.buildingBranches.find(item => item.types.includes(b.id));
      const nextType = branch?.types[branch.types.indexOf(b.id) + 1];
      for (const [level, d] of Object.entries(b.levels || {})) {
        check(d.level === +level, b.id, 'invalid level');
        for (const key of ['price','foodStage','area']) integer(d[key], `${b.id}.${level}.${key}`);
        check(d.area === b.area, `${b.id}.${level}`, 'level/overview area mismatch');
        if (d.next) {
          const target = economy.buildings[d.next.type]?.levels?.[d.next.level];
          check(Boolean(target), b.id, 'invalid next level');
          check(d.next.type !== b.id || d.next.level > d.level, b.id, 'cyclic level chain');
        }
        const index = levels.indexOf(+level);
        const expected = levels[index + 1] ? {type:b.id,level:levels[index + 1]} : nextType ? {type:nextType,level:1} : null;
        check(expected ? d.next?.type === expected.type && d.next?.level === expected.level : d.next === undefined,
          `${b.id}.${level}.next`, 'incomplete or incorrect level chain');
      }
      for (const [index, level] of levels.entries()) check(level === index + 1, `${b.id}.levels`, 'missing level');
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
    for (const island of rules.islands.filter(i => i.factionId === f.id)) check(f.originalIslandIds.includes(island.id), f.id, `missing original island ${island.id}`);
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
    if (p.kind === 'island') ref(p.islandId, islands, p.id);
    else ref(p.mapPlaceId, new Set(Object.keys(map.LEGENDARY_PLACES)), p.id);
    check(p.reward?.type === 'legendary', p.id, 'legendary place first-discovery reward must be legendary');
    positive(p.reward?.count, `${p.id}.reward.count`);
  }
  deck(legends.namedCards, 10, 'namedCards'); unique(legends.namedCards.map(c=>c.placeId), 'namedCards');
  for (const c of legends.namedCards) {
    ref(c.placeId, places, c.id);
    check(c.name === legends.places.find(p => p.id === c.placeId)?.name, c.id, 'place card/name mismatch');
    check(c.quantity === 1, c.id, 'expected one named card per place');
    check(c.visibility === 'public', c.id, 'named place cards are public');
  }
  deck(legends.expeditions, 7, 'expeditions'); unique(legends.expeditions.map(c=>c.placeId), 'expeditions');
  const seaPlaceIds = new Set(legends.places.filter(p => p.kind === 'sea').map(p => p.id));
  check(seaPlaceIds.size === 7, 'expeditions', 'expected seven sea legendary places');
  for (const c of legends.expeditions) {
    ref(c.placeId, seaPlaceIds, c.id);
    check(c.name === legends.places.find(p => p.id === c.placeId)?.name, c.id, 'place card/name mismatch');
    check(c.quantity === 1, c.id, 'expected one expedition per sea place');
    check(c.reward?.type === 'treasure' && c.reward.count === 1, c.id, 'invalid expedition reward');
  }
  records(legends.legendary, 'legendary'); records(legends.treasures, 'treasures');
  check(legends.legendary.length === 4, 'legendary', 'expected four digital legendary types');
  check(legends.legendaryPool?.mode === 'random-with-replacement', 'legendaryPool.mode', 'expected random-with-replacement');
  check(legends.legendaryPool?.selection === 'uniform', 'legendaryPool.selection', 'expected uniform selection');
  check(legends.legendaryPool?.consumedOnUse === true, 'legendaryPool.consumedOnUse', 'legendary cards must be consumed on use');
  check(Array.isArray(legends.legendaryPool?.typeIds), 'legendaryPool.typeIds', 'missing type ids');
  if (Array.isArray(legends.legendaryPool?.typeIds)) {
    unique(legends.legendaryPool.typeIds, 'legendaryPool.typeIds');
    check(legends.legendaryPool.typeIds.length === legends.legendary.length, 'legendaryPool.typeIds', 'pool/type count mismatch');
    for (const id of legends.legendaryPool.typeIds) ref(id, new Set(legends.legendary.map(c=>c.id)), 'legendaryPool.typeIds');
  }
  check(legends.treasurePool?.mode === 'random-with-replacement', 'treasurePool.mode', 'expected random-with-replacement');
  check(legends.treasurePool?.selection === 'uniform', 'treasurePool.selection', 'expected uniform selection');
  check(Array.isArray(legends.treasurePool?.typeIds), 'treasurePool.typeIds', 'missing treasure type ids');
  if (Array.isArray(legends.treasurePool?.typeIds)) {
    unique(legends.treasurePool.typeIds, 'treasurePool.typeIds');
    check(legends.treasurePool.typeIds.length === legends.treasures.length, 'treasurePool.typeIds', 'pool/type count mismatch');
    for (const id of legends.treasurePool.typeIds) ref(id, new Set(legends.treasures.map(c=>c.id)), 'treasurePool.typeIds');
  }
  for (const id of ['exotic','slaves','gold','diamonds']) {
    const building = economy.buildings[id];
    check(building?.singleStage === true, 'economy.buildings.' + id + '.singleStage', 'rare industry must be single-stage');
    check(!Object.hasOwn(building || {}, 'levels'), 'economy.buildings.' + id + '.levels', 'rare industry must not define levels');
    check(!Object.hasOwn(building || {}, 'futureLevels'), 'economy.buildings.' + id + '.futureLevels', 'future rare levels are not canonical');
    check(!Object.hasOwn(building || {}, 'futureLevelsPurchasable'), 'economy.buildings.' + id + '.futureLevelsPurchasable', 'future rare level flag is not canonical');
  }
  for (const c of [...legends.legendary,...legends.treasures]) effect(c.effect, c.id);
  for (const c of legends.treasures) {
    if (c.effect.type === 'income-multiple') check(c.multiplier === c.effect.multiplier && c.minimum === c.effect.minimum, c.id, 'treasure overview/effect mismatch');
    if (c.effect.type === 'fill-hold') {
      ref(c.cargoGoodId, goods, c.id);
      check(c.cargoGoodId === c.effect.goodId, c.id, 'cargo overview/effect mismatch');
    }
  }
  records(rules.characters.characters, 'characters');
  check(rules.characters.characters.length === 6, 'characters', 'expected six characters');
  for (const c of rules.characters.characters) {
    check(Boolean(economy.buildings.admiralty.levels[c.admiraltyLevel]), c.id, 'invalid admiralty level');
    positive(c.acquireActionCost, `${c.id}.acquireActionCost`);
    integer(c.useActionCost, `${c.id}.useActionCost`);
    positive(c.uses, `${c.id}.uses`);
    effect(c.effect, c.id);
  }
  const { session, scoring, implementation, metadata } = rules;
  for (const key of ['min','max']) positive(session.players?.[key], `session.players.${key}`);
  check(session.players.min <= session.players.max, 'session.players', 'invalid player range');
  for (const key of ['startingDucats','circlesPerRound','eventCircle','actionsPerTurn','dieSides','taxUnderpaymentActionLimit']) positive(session[key], `session.${key}`);
  check(session.eventCircle <= session.circlesPerRound, 'session', 'event circle beyond round');
  check(session.taxUnderpaymentActionLimit <= session.actionsPerTurn, 'session', 'tax action limit exceeds normal limit');
  for (const key of ['guard','permanentUpgrade','permanentDirect']) {
    positive(economy.garrisons[key]?.price, `garrisons.${key}.price`);
    positive(economy.garrisons[key]?.defense, `garrisons.${key}.defense`);
  }
  const companyArmy = economy.landCompany?.armyByArsenalLevel;
  check(Array.isArray(companyArmy), 'landCompany.armyByArsenalLevel', 'missing army table');
  for (const [index, army] of (companyArmy || []).entries()) integer(army, `landCompany.armyByArsenalLevel.${index}`);
  check(companyArmy?.length === Object.keys(economy.buildings.arsenal.levels).length + 1,
    'landCompany.armyByArsenalLevel', 'arsenal level coverage mismatch');
  for (const color of Object.keys(rules.sea)) positive(scoring.fleet.anchor[color], `scoring.fleet.anchor.${color}`);
  for (const key of ['playerVictory','defenseVictory','perOpponentPerRound']) positive(scoring.fleet[key], `scoring.fleet.${key}`);
  positive(scoring.army.defenseVictory, 'scoring.army.defenseVictory');
  positive(scoring.army.perOpponentPerRound, 'scoring.army.perOpponentPerRound');
  for (const [index, band] of scoring.army.capture.entries()) {
    integer(band.min, `scoring.army.capture.${index}.min`);
    if (band.max !== null) integer(band.max, `scoring.army.capture.${index}.max`, band.min);
    integer(band.points, `scoring.army.capture.${index}.points`);
    if (index) check(band.min === scoring.army.capture[index - 1].max + 1, `scoring.army.capture.${index}`, 'gap or overlap');
  }
  check(scoring.army.capture.at(-1)?.max === null, 'scoring.army.capture', 'last band must be open');
  for (const key of ['lootMax','attacksPerOpponentPerRound','alliancePartners']) positive(scoring.combat[key], `scoring.combat.${key}`);
  positive(scoring.combat.anchorLoss.minimum, 'scoring.combat.anchorLoss.minimum');
  check(scoring.combat.anchorLoss.ratio > 0 && scoring.combat.anchorLoss.ratio <= 1, 'scoring.combat.anchorLoss.ratio', 'invalid ratio');
  check(scoring.combat.capturedBuildingsKeptRatio > 0 && scoring.combat.capturedBuildingsKeptRatio <= 1, 'scoring.combat.capturedBuildingsKeptRatio', 'invalid ratio');
  unique(scoring.titles.map(t => t.id), 'scoring.titles');
  check(scoring.titles.length === 6, 'scoring.titles', 'expected six titles');
  for (const title of scoring.titles) required(title,['id','name','metric'],'scoring.titles');
  unique(metadata.unresolved, 'metadata.unresolved');
  const pathExists = (value, segments) => {
    if (!segments.length) return true;
    if (!value || typeof value !== 'object') return false;
    const [head,...tail] = segments;
    return head === '*' ? Object.values(value).some(item => pathExists(item,tail))
      : Object.hasOwn(value,head) && pathExists(value[head],tail);
  };
  unique(implementation.pendingConsumers.map(item => item.path), 'implementation.pendingConsumers');
  for (const item of implementation.pendingConsumers) {
    check(pathExists(rules,item.path.split('.')), item.path, 'unknown pending-consumer path');
    check(item.status === 'data-ready' && Number.isInteger(item.consumerStage) && item.consumerStage >= 2 && item.consumerStage <= 7,
      item.path, 'invalid pending-consumer stage');
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
// The legacy profile describes existing rooms, not a second source of master balance.
function validateCompatibility(rules, legacy) {
  const errors = [];
  const check = (ok, path, message) => { if (!ok) errors.push(`${path}: ${message}`); };
  const integer = (value, path, min = 0) => check(Number.isInteger(value) && value >= min, path, `expected integer >= ${min}`);
  const sameKeys = (actual, expected, path) => {
    for (const id of Object.keys(actual || {})) check(expected.includes(id), `${path}.${id}`, 'unknown key');
    for (const id of expected) check(Object.hasOwn(actual || {},id), `${path}.${id}`, 'missing key');
  };
  const building = (spec, path) => {
    check(Boolean(rules.economy.buildings[spec?.type]?.levels?.[spec?.level]), path, 'unknown building level');
  };
  const factions = Object.keys(rules.politics.factions).filter(id => !rules.politics.factions[id].availability);
  const islandIds = new Set(rules.islands.map(i => i.id));
  integer(legacy.session?.players?.min, 'legacy.session.players.min', 1);
  integer(legacy.session?.players?.max, 'legacy.session.players.max', legacy.session?.players?.min || 1);
  integer(legacy.session?.startingDucats, 'legacy.session.startingDucats');
  integer(legacy.session?.circlesPerRound, 'legacy.session.circlesPerRound', 1);
  check(legacy.shipLevel7?.level === rules.fleet.maxLevel + 1, 'legacy.shipLevel7', 'expected next retired level');
  for (const key of ['price','statBonus','moveBonus']) integer(legacy.shipLevel7?.[key], `legacy.shipLevel7.${key}`);
  integer(legacy.shipLevel7?.upgradeSlots, 'legacy.shipLevel7.upgradeSlots', 1);
  const oldUpgrade = legacy.removedUpgrade;
  check(Boolean(oldUpgrade?.id) && !rules.fleet.upgrades[oldUpgrade.id], 'legacy.removedUpgrade', 'must be retired');
  check(Object.values(rules.fleet.upgrades).some(u => u.id === oldUpgrade?.requires && u.branch === oldUpgrade.branch && u.order < oldUpgrade.order), 'legacy.removedUpgrade.requires', 'invalid prerequisite');
  integer(oldUpgrade?.price, 'legacy.removedUpgrade.price');
  const oldEscort = legacy.removedEscort;
  check(Boolean(oldEscort?.id) && !rules.fleet.escorts[oldEscort.id], 'legacy.removedEscort', 'must be retired');
  for (const key of ['artillery','army','cargo']) integer(oldEscort?.[key], `legacy.removedEscort.${key}`);
  for (const [id, area] of Object.entries(legacy.buildingAreas || {})) {
    check(Boolean(rules.economy.buildings[id]), `legacy.buildingAreas.${id}`, 'unknown building');
    integer(area, `legacy.buildingAreas.${id}`, 1);
  }
  sameKeys(legacy.branchLimits, Object.keys(rules.economy.ranks), 'legacy.branchLimits');
  for (const [id, limit] of Object.entries(legacy.branchLimits || {})) integer(limit, `legacy.branchLimits.${id}`, 1);
  sameKeys(legacy.garrisons, ['guard','permanentUpgrade'], 'legacy.garrisons');
  for (const [id, data] of Object.entries(legacy.garrisons || {})) for (const key of ['price','defense']) integer(data[key], `legacy.garrisons.${id}.${key}`, 1);
  sameKeys(legacy.feud, factions, 'legacy.feud');
  for (const [id, cards] of Object.entries(legacy.feud || {})) {
    check(Array.isArray(cards) && cards.length > 0, `legacy.feud.${id}`, 'missing cards');
    const seen = new Set();
    for (const card of cards || []) {
      check(!seen.has(card.masterCardId), `legacy.feud.${id}`, `duplicate ${card.masterCardId}`);
      seen.add(card.masterCardId);
      check(Boolean(rules.events.feud[id]?.find(c => c.id === card.masterCardId)), `legacy.feud.${id}.${card.id}`, 'unknown master card');
    }
  }
  for (const [id, specs] of Object.entries(legacy.militaryRewardBuildings || {})) {
    check(islandIds.has(id), `legacy.militaryRewardBuildings.${id}`, 'unknown island');
    check(Array.isArray(specs), `legacy.militaryRewardBuildings.${id}`, 'expected list');
    for (const [index, spec] of (specs || []).entries()) building(spec, `legacy.militaryRewardBuildings.${id}.${index}`);
  }
  sameKeys(legacy.factionPrizeBuildings, factions, 'legacy.factionPrizeBuildings');
  for (const [id, specs] of Object.entries(legacy.factionPrizeBuildings || {})) {
    check(Array.isArray(specs), `legacy.factionPrizeBuildings.${id}`, 'expected list');
    for (const [index, spec] of (specs || []).entries()) building(spec, `legacy.factionPrizeBuildings.${id}.${index}`);
  }
  sameKeys(legacy.legendaryQuantities, rules.legends.legendary.map(c => c.id), 'legacy.legendaryQuantities');
  for (const [id, quantity] of Object.entries(legacy.legendaryQuantities || {})) integer(quantity, `legacy.legendaryQuantities.${id}`, 1);
  check(Boolean(legacy.treasure?.id) && !rules.legends.treasures.some(c => c.id === legacy.treasure.id), 'legacy.treasure', 'must be retired');
  check(Boolean(rules.economy.goods[legacy.treasure?.cargoGoodId]), 'legacy.treasure.cargoGoodId', 'unknown good');
  for (const [id, points] of Object.entries(legacy.anchorGlory || {})) {
    check(Boolean(rules.sea[id]), `legacy.anchorGlory.${id}`, 'unknown sea deck');
    integer(points, `legacy.anchorGlory.${id}`);
  }
  sameKeys(legacy.anchorGlory, Object.keys(rules.sea), 'legacy.anchorGlory');
  check(Array.isArray(legacy.gloryCapture) && legacy.gloryCapture.length > 0, 'legacy.gloryCapture', 'missing bands');
  for (const [index, band] of (legacy.gloryCapture || []).entries()) {
    integer(band.min, `legacy.gloryCapture.${index}.min`);
    if (band.max !== null) integer(band.max, `legacy.gloryCapture.${index}.max`, band.min);
    integer(band.points, `legacy.gloryCapture.${index}.points`);
    if (index) check(band.min === legacy.gloryCapture[index - 1].max + 1, `legacy.gloryCapture.${index}`, 'gap or overlap');
  }
  integer(legacy.assignmentReplacementPrice, 'legacy.assignmentReplacementPrice');
  check(typeof legacy.treasuryLossRatio === 'number' && legacy.treasuryLossRatio >= 0 && legacy.treasuryLossRatio <= 1, 'legacy.treasuryLossRatio', 'invalid ratio');
  integer(legacy.attackHistoryWindow, 'legacy.attackHistoryWindow', 1);
  integer(legacy.attackRebellionThreshold, 'legacy.attackRebellionThreshold', 1);
  return errors;
}
module.exports = { validateRules, validateCompatibility };
