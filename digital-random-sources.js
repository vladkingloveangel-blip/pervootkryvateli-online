'use strict';

const { BALANCE, TREASURE_OUTCOME_DEFINITIONS, CONSUMABLE_ABILITY_DEFINITIONS } = require('./game-data');
const { selectIndependent } = require('./random-sources');

function cloneDefinition(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function canonicalLegendaryCandidates() {
  const ids = Array.isArray(BALANCE.legendaryPool?.typeIds) && BALANCE.legendaryPool.typeIds.length
    ? BALANCE.legendaryPool.typeIds
    : CONSUMABLE_ABILITY_DEFINITIONS.map(definition => definition.id);
  return ids
    .map(id => CONSUMABLE_ABILITY_DEFINITIONS.find(definition => definition.id === id))
    .filter(Boolean);
}

function selectTreasureOutcome(rng = Math.random) {
  return cloneDefinition(selectIndependent(TREASURE_OUTCOME_DEFINITIONS, rng));
}

function selectLegendaryAbility(rng = Math.random) {
  const candidates = canonicalLegendaryCandidates();
  const weighted = candidates.flatMap(card => Array(card.id === 'hellfire' ? 1 : 2).fill(card));
  return cloneDefinition(selectIndependent(weighted, rng));
}

function selectTreasureCandidates(count, rng = Math.random) {
  const wanted = Math.max(0, Math.floor(Number(count) || 0));
  const candidates = [];
  for (let i = 0; i < wanted; i++) candidates.push(selectTreasureOutcome(rng));
  return candidates;
}

module.exports = {
  selectTreasureOutcome,
  selectLegendaryAbility,
  selectTreasureCandidates,
};
