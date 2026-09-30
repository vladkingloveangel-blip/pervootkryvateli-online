'use strict';

const { BALANCE, TREASURE_CARDS, LEGENDARY_CARDS } = require('./game-data');
const { selectIndependent } = require('./random-sources');

function cloneDefinition(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function canonicalLegendaryCandidates() {
  const ids = Array.isArray(BALANCE.legendaryPool?.typeIds) && BALANCE.legendaryPool.typeIds.length
    ? BALANCE.legendaryPool.typeIds
    : LEGENDARY_CARDS.map(definition => definition.id);
  return ids
    .map(id => LEGENDARY_CARDS.find(definition => definition.id === id))
    .filter(Boolean);
}

function selectTreasureOutcome(rng = Math.random) {
  return cloneDefinition(selectIndependent(TREASURE_CARDS, rng));
}

function selectLegendaryAbility(rng = Math.random) {
  return cloneDefinition(selectIndependent(canonicalLegendaryCandidates(), rng));
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
