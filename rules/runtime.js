// Active rules projection with explicit compatibility for mechanics still awaiting later stages.
const rules = require('./index');
const legacy = require('./compatibility/legacy.json');
const { validateCompatibility } = require('./validate');
const compatibilityErrors = validateCompatibility(rules, legacy);
if (compatibilityErrors.length) throw new Error(`Invalid legacy rules profile:\n${compatibilityErrors.join('\n')}`);
const copy = value => JSON.parse(JSON.stringify(value));
const BUILDINGS = copy(rules.economy.buildings);
for (const building of Object.values(BUILDINGS)) {
  if (building.category === 'public' && building.availability?.status === 'data-ready' && building.availability.consumerStage <= 4) {
    building.buildable = true;
  }
}
const BRANCH_LIMITS = Object.fromEntries(Object.entries(rules.economy.ranks)
  .map(([id, rank]) => [id, rank.branchLimit]));
const BUILDING_UPGRADES = {};
for (const [id, building] of Object.entries(BUILDINGS)) {
  if (building.category === 'public' && id !== 'admiralty') continue;
  for (const [level, data] of Object.entries(building.levels || {})) {
    if (!data.next || data.next.type === 'bastion') continue;
    const next = data.next;
    (BUILDING_UPGRADES[id] ||= {})[level] = { ...next, price: BUILDINGS[next.type].levels[next.level].price };
  }
}
const CHARACTERS = Object.fromEntries(rules.characters.characters
  .filter(c => c.availability?.status === 'data-ready' && c.availability.consumerStage <= 4)
  .map(c => [c.id, copy(c)]));
const SHIP_UPGRADES = Object.fromEntries(Object.entries(rules.fleet.upgrades)
  .filter(([, u]) => !u.availability || (u.availability.status === 'data-ready' && u.availability.consumerStage <= 3)));
// Read retired content from old saves, but do not sell it again.
SHIP_UPGRADES[legacy.removedUpgrade.id] = { ...legacy.removedUpgrade, retired: true };
const SHIP_LEVELS = { ...rules.fleet.levels, [legacy.shipLevel7.level]: { ...legacy.shipLevel7, retired: true } };
const MILITARY_REWARDS = {};
for (const island of rules.islands.filter(i => i.kind !== 'free')) {
  MILITARY_REWARDS[island.id] = copy(island.reward);
}
const FACTIONS = Object.fromEntries(Object.entries(rules.politics.factions)
  .filter(([, faction]) => !faction.availability
    || (faction.availability.status === 'data-ready' && faction.availability.consumerStage <= 5))
  .map(([id, faction]) => [id, {
    ...copy(faction),
    // Author decision: Kadingir's final conquest prize follows §9.6 — 50 ducats.
    fullConquestPrize: copy(faction.fullConquestPrize),
  }]));
const POLITICAL_EFFECT_DEFINITIONS = Object.fromEntries(Object.entries(rules.events.feud).map(([factionId, cards]) => [
  factionId,
  cards.map(card => ({
    id: card.id,
    masterCardId: card.id,
    factionId,
    name: card.name,
    quantity: card.quantity,
    source: card.source,
    ...copy(card.effect),
  })),
]));
const POLITICAL_FACTION_ORDER = rules.politics.order.filter(id => id in FACTIONS);

const SEA_ENCOUNTER_DEFINITIONS = rules.sea;
const SAILING_EVENT_DEFINITIONS = rules.events.sailing.map(card => copy(card));
const ASSIGNMENT_DEFINITIONS = Object.fromEntries(POLITICAL_FACTION_ORDER
  .filter(id => FACTIONS[id]?.canHaveVassal)
  .map(id => [id, copy(rules.politics.assignments[id] || [])]));
const EXPEDITION_DEFINITIONS = rules.legends.expeditions.map(card => copy(card));
const TREASURE_OUTCOME_DEFINITIONS = rules.legends.treasures.map(card => copy(card));
const CONSUMABLE_ABILITY_DEFINITIONS = rules.legends.legendary.map(card => copy(card));
const PLACE_DISCOVERY_DEFINITIONS = rules.legends.namedCards.map(card => copy(card));

// Digital semantic definitions; legacy *_CARDS exports below are compatibility aliases.
const ANCHOR_CARDS = SEA_ENCOUNTER_DEFINITIONS;
const SAILING_EVENT_CARDS = SAILING_EVENT_DEFINITIONS;
const FEUD_CARDS = POLITICAL_EFFECT_DEFINITIONS;
const ASSIGNMENT_CARDS = ASSIGNMENT_DEFINITIONS;
const EXPEDITION_CARDS = EXPEDITION_DEFINITIONS;
const TREASURE_CARDS = TREASURE_OUTCOME_DEFINITIONS;
const LEGENDARY_CARDS = CONSUMABLE_ABILITY_DEFINITIONS;
const NAMED_PLACE_CARDS = PLACE_DISCOVERY_DEFINITIONS;

module.exports = {
  RULESET: rules.metadata, RUNTIME_PROFILE: 'stage-6-events-legends-6.7',
  BALANCE: {
    session: rules.session,
    maxShipLevel: rules.fleet.maxLevel, maxReadableShipLevel: legacy.shipLevel7.level,
    escortPrices: rules.fleet.escortPrices, maxBranchUpgrades: rules.fleet.maxBranchUpgrades,
    maxEscorts: rules.fleet.escortPrices.length,
    garrisons: rules.economy.garrisons, branchLimits: BRANCH_LIMITS, ranks: rules.economy.ranks,
    landCompany: rules.economy.landCompany, combat: rules.scoring.combat, fleetScoring: rules.scoring.fleet, armyScoring: rules.scoring.army,
    loadingLimitPerIslandPerRound: rules.economy.loadingLimitPerIslandPerRound,
    gloryCapture: legacy.gloryCapture, treasuryLossRatio: legacy.treasuryLossRatio,
    reclaimIslandFallback: POLITICAL_EFFECT_DEFINITIONS.lionia.find(c => c.type === 'reclaim-island').fallbackDucats,
    legendaryEffects: Object.fromEntries(CONSUMABLE_ABILITY_DEFINITIONS.map(c => [c.id, c.effect])),
    legendaryPool: copy(rules.legends.legendaryPool),
    treasurePool: copy(rules.legends.treasurePool),
    expeditionLimits: copy(rules.legends.expeditionLimits),
  },
  SHIPS: rules.fleet.ships, SHIP_LEVELS, SHIP_UPGRADES,
  ESCORTS: { ...rules.fleet.escorts, [legacy.removedEscort.id]: { ...legacy.removedEscort, retired: true } },
  GOODS: rules.economy.goods, BUILDINGS, BUILDING_UPGRADES, CHARACTERS, MILITARY_REWARDS, FACTIONS,
  POLITICAL_FACTION_ORDER,
  SEA_ENCOUNTER_DEFINITIONS,
  SAILING_EVENT_DEFINITIONS,
  POLITICAL_EFFECT_DEFINITIONS,
  ASSIGNMENT_DEFINITIONS,
  EXPEDITION_DEFINITIONS,
  TREASURE_OUTCOME_DEFINITIONS,
  CONSUMABLE_ABILITY_DEFINITIONS,
  PLACE_DISCOVERY_DEFINITIONS,
  LEGENDARY_PLACE_RULES: rules.legends.places.map(place => copy(place)),
  // Compatibility aliases. Each alias is the exact same runtime object as its semantic export.
  ANCHOR_CARDS,
  SAILING_EVENT_CARDS,
  FEUD_CARDS,
  ASSIGNMENT_CARDS,
  EXPEDITION_CARDS,
  TREASURE_CARDS,
  LEGENDARY_CARDS,
  NAMED_PLACE_CARDS,
  ANCHOR_GLORY: legacy.anchorGlory,
};
