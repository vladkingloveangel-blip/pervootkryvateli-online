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
  for (const [level, data] of Object.entries(building.levels)) {
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
  MILITARY_REWARDS[island.id] = {
    ...copy(island.reward),
    // Ready-made buildings exist only where the current island card explicitly lists them.
    preserveBuildings: copy(island.reward?.buildings || []),
  };
}
const FACTIONS = Object.fromEntries(Object.entries(rules.politics.factions)
  .filter(([, faction]) => !faction.availability
    || (faction.availability.status === 'data-ready' && faction.availability.consumerStage <= 5))
  .map(([id, faction]) => [id, {
    ...copy(faction),
    // Author decision: Kadingir's final conquest prize follows §9.6 — 50 ducats.
    fullConquestPrize: copy(faction.fullConquestPrize),
  }]));
const FEUD_CARDS = Object.fromEntries(Object.entries(rules.events.feud).map(([factionId, cards]) => [
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
module.exports = {
  RULESET: rules.metadata, RUNTIME_PROFILE: 'stage-5-combat-politics-5.8.5',
  BALANCE: {
    session: rules.session,
    maxShipLevel: rules.fleet.maxLevel, maxReadableShipLevel: legacy.shipLevel7.level,
    escortPrices: rules.fleet.escortPrices, maxBranchUpgrades: rules.fleet.maxBranchUpgrades,
    maxEscorts: rules.fleet.escortPrices.length,
    garrisons: rules.economy.garrisons, branchLimits: BRANCH_LIMITS, ranks: rules.economy.ranks,
    landCompany: rules.economy.landCompany, combat: rules.scoring.combat, fleetScoring: rules.scoring.fleet, armyScoring: rules.scoring.army,
    contractBonusRatio: rules.economy.contractBonusRatio,
    loadingLimitPerIslandPerRound: rules.economy.loadingLimitPerIslandPerRound,
    gloryCapture: legacy.gloryCapture, treasuryLossRatio: legacy.treasuryLossRatio,
    reclaimIslandFallback: rules.events.feud.lionia.find(c => c.effect.type === 'reclaim-island').effect.fallbackDucats,
    legendaryEffects: Object.fromEntries(rules.legends.legendary.map(c => [c.id, c.effect])),
  },
  SHIPS: rules.fleet.ships, SHIP_LEVELS, SHIP_UPGRADES,
  ESCORTS: { ...rules.fleet.escorts, [legacy.removedEscort.id]: { ...legacy.removedEscort, retired: true } },
  GOODS: rules.economy.goods, BUILDINGS, BUILDING_UPGRADES, CHARACTERS, MILITARY_REWARDS, FACTIONS,
  POLITICAL_FACTION_ORDER: rules.politics.order.filter(id => id in FACTIONS),
  // Five suzerains issue assignments. Mayo has no vassalage and therefore no assignment deck.
  ASSIGNMENT_CARDS: Object.fromEntries(POLITICAL_FACTION_ORDER
    .filter(id => FACTIONS[id]?.canHaveVassal)
    .map(id => [id, copy(rules.politics.assignments[id] || [])])),
  ANCHOR_CARDS: rules.sea,
  SAILING_EVENT_CARDS: rules.events.sailing.map(card => card.type === 'turn-effect'
    ? { ...card, type: 'next-turn', timing: 'next-personal-turn' } : card),
  FEUD_CARDS,
  LEGENDARY_CARDS: rules.legends.legendary.map(card => ({ ...card, quantity: legacy.legendaryQuantities[card.id] })),
  // Physical treasure copy counts are unresolved in the source. Runtime keeps one
  // instance of each canonical treasure kind without inventing additional copies.
  TREASURE_CARDS: rules.legends.treasures.map(card => copy(card)),
  ANCHOR_GLORY: legacy.anchorGlory,
};
