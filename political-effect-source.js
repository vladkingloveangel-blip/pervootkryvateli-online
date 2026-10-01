'use strict';

const { POLITICAL_EFFECT_DEFINITIONS, POLITICAL_FACTION_ORDER } = require('./game-data');
const { shuffleWithRng } = require('./random-sources');

function expandPoliticalEffectDefinitions(definitions) {
  const occurrences = [];
  for (const definition of definitions || []) {
    const count = Math.max(1, Number(definition.quantity) || 1);
    for (let copy = 1; copy <= count; copy++) occurrences.push({ ...definition, copy });
  }
  return occurrences;
}

function createPoliticalEffectStorage(rng = Math.random) {
  const storage = {};
  for (const factionId of POLITICAL_FACTION_ORDER) {
    storage[factionId] = {
      drawPile: shuffleWithRng(expandPoliticalEffectDefinitions(POLITICAL_EFFECT_DEFINITIONS[factionId] || []), rng),
      discard: [],
    };
  }
  return storage;
}

function canonicalizePoliticalEffectOccurrence(factionId, rawOccurrence) {
  if (!rawOccurrence) return null;
  const canonical = (POLITICAL_EFFECT_DEFINITIONS[factionId] || []).find(definition =>
    definition.id === rawOccurrence.masterCardId || definition.id === rawOccurrence.id
  );
  return canonical
    ? { ...rawOccurrence, ...canonical, masterCardId: canonical.id }
    : rawOccurrence;
}

function occurrenceKey(factionId, occurrence) {
  if (!occurrence) return null;
  const canonical = canonicalizePoliticalEffectOccurrence(factionId, occurrence);
  const id = canonical.masterCardId || canonical.id || 'unknown';
  return `${id}:${canonical.copy ?? 'legacy'}`;
}

function politicalEffectSource(room, factionId, rng = Math.random) {
  if (!room || !POLITICAL_EFFECT_DEFINITIONS[factionId]) return null;

  function backing({ create = false } = {}) {
    if (!room.feudDecks && create) room.feudDecks = createPoliticalEffectStorage(rng);
    if (!room.feudDecks) return null;
    if (!room.feudDecks[factionId] && create) {
      room.feudDecks[factionId] = {
        drawPile: shuffleWithRng(expandPoliticalEffectDefinitions(POLITICAL_EFFECT_DEFINITIONS[factionId] || []), rng),
        discard: [],
      };
    }
    const storage = room.feudDecks[factionId] || null;
    if (!storage) return null;
    storage.drawPile ||= [];
    storage.discard ||= [];
    return storage;
  }

  function refreshCycle() {
    const storage = backing({ create: true });
    if (storage.drawPile.length || !storage.discard.length) return false;
    storage.drawPile = shuffleWithRng(
      storage.discard.map(occurrence => ({ ...occurrence })),
      rng
    );
    storage.discard = [];
    return true;
  }

  return {
    consumeNext() {
      refreshCycle();
      const storage = backing({ create: true });
      return canonicalizePoliticalEffectOccurrence(factionId, storage.drawPile.shift() || null);
    },

    markUsed(outcome) {
      if (!outcome) return false;
      const storage = backing({ create: true });
      const canonical = canonicalizePoliticalEffectOccurrence(factionId, outcome);
      const key = occurrenceKey(factionId, canonical);
      if ([...storage.drawPile, ...storage.discard].some(item => occurrenceKey(factionId, item) === key)) return false;
      storage.discard.push({ ...canonical });
      return true;
    },

    remainingCount() {
      return backing()?.drawPile.length || 0;
    },
  };
}

module.exports = {
  createPoliticalEffectStorage,
  canonicalizePoliticalEffectOccurrence,
  politicalEffectSource,
};
