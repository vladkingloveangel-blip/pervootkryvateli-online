const scoringRules = require('./rules/scoring.json');
const economyRules = require('./rules/economy.json');
const { PLACE_DISCOVERY_DEFINITIONS } = require('./game-data');
const { islandStatus } = require('./game-logic');
const { listPlayerDiscoveries } = require('./domain-state');

const CANONICAL_NAMED_PLACE_IDS = new Set(
  (PLACE_DISCOVERY_DEFINITIONS || []).map(definition => String(definition.placeId))
);

function sameId(left, right) {
  return left !== undefined && left !== null
    && right !== undefined && right !== null
    && String(left) === String(right);
}

function ownedIslands(room, player) {
  return (room?.islands || []).filter(island => sameId(island?.ownerId, player?.id));
}

function islandPrestige(island) {
  const status = islandStatus(island);
  const rank = Object.values(economyRules.ranks || {}).find(candidate => candidate?.name === status);
  const statusPrestige = Number(rank?.prestige) || 0;
  const buildingPrestige = (island?.buildings || []).reduce((total, building) => {
    const definition = economyRules.buildings?.[building?.type];
    if (definition?.category !== 'public') return total;
    return total + (Number(definition.prestige) || 0);
  }, 0);
  return statusPrestige + buildingPrestige;
}

function legendaryPlaceCount(room, player) {
  return listPlayerDiscoveries(room, player?.id, PLACE_DISCOVERY_DEFINITIONS)
    .filter(discovery => CANONICAL_NAMED_PLACE_IDS.has(String(discovery?.id)))
    .length;
}

function calculatePlayerFinalMetrics(room, player) {
  const islands = ownedIslands(room, player);
  return {
    islands: islands.length,
    wealth: (Number(player?.ducats) || 0) - (Number(player?.debt) || 0),
    army: Number(player?.armyPoints) || 0,
    fleet: Number(player?.fleetPoints) || 0,
    prestige: islands.reduce((total, island) => total + islandPrestige(island), 0),
    legendaryPlaces: legendaryPlaceCount(room, player),
  };
}

function calculateFinalScoring(room) {
  const playerMetrics = (room?.players || []).map(player => ({
    playerId: player.id,
    metrics: calculatePlayerFinalMetrics(room, player),
  }));
  const minimumOwnedIslands = Math.max(0, Number(scoringRules.titleEligibility?.minimumOwnedIslands) || 0);

  const titles = (scoringRules.titles || []).map(title => {
    const eligible = playerMetrics.filter(entry => entry.metrics.islands >= minimumOwnedIslands);
    if (!eligible.length) {
      return {
        id: title.id,
        name: title.name,
        metric: title.metric,
        maxValue: null,
        winnerIds: [],
      };
    }

    const maxValue = Math.max(...eligible.map(entry => Number(entry.metrics[title.id]) || 0));
    return {
      id: title.id,
      name: title.name,
      metric: title.metric,
      maxValue,
      winnerIds: eligible
        .filter(entry => (Number(entry.metrics[title.id]) || 0) === maxValue)
        .map(entry => entry.playerId),
    };
  });

  return { playerMetrics, titles };
}

module.exports = {
  calculatePlayerFinalMetrics,
  calculateFinalScoring,
};
