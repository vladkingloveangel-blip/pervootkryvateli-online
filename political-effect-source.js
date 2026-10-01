'use strict';

const { POLITICAL_EFFECT_DEFINITIONS, POLITICAL_FACTION_ORDER } = require('./game-data');
const { shuffleWithRng } = require('./random-sources');
const { SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION, RANDOM_SOURCE_STATE_FIELD } = require('./save-migrations');

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
    storage[factionId] = { drawPile: shuffleWithRng(expandPoliticalEffectDefinitions(POLITICAL_EFFECT_DEFINITIONS[factionId] || []), rng), discard: [] };
  }
  return storage;
}

function createPoliticalEffectSourceState(rng = Math.random) {
  const storage = {};
  for (const factionId of POLITICAL_FACTION_ORDER) {
    storage[factionId] = { available: shuffleWithRng(expandPoliticalEffectDefinitions(POLITICAL_EFFECT_DEFINITIONS[factionId] || []), rng), recyclable: [], reserved: [] };
  }
  return storage;
}

function canonicalizePoliticalEffectOccurrence(factionId, rawOccurrence) {
  if (!rawOccurrence) return null;
  const canonical = (POLITICAL_EFFECT_DEFINITIONS[factionId] || []).find(definition =>
    definition.id === rawOccurrence.masterCardId || definition.id === rawOccurrence.id
  );
  return canonical ? { ...rawOccurrence, ...canonical, masterCardId: canonical.id } : rawOccurrence;
}

function occurrenceKey(factionId, occurrence) {
  if (!occurrence) return null;
  const canonical = canonicalizePoliticalEffectOccurrence(factionId, occurrence);
  return `${canonical.masterCardId || canonical.id || 'unknown'}:${canonical.copy ?? 'legacy'}`;
}

function politicalEffectSource(room, factionId, rng = Math.random) {
  if (!room || !POLITICAL_EFFECT_DEFINITIONS[factionId]) return null;
  const digital = Boolean(room[RANDOM_SOURCE_STATE_FIELD])
    || Number(room.digitalModelSchemaVersion) >= SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION;

  function backing({ create = false } = {}) {
    if (digital) {
      if (!room[RANDOM_SOURCE_STATE_FIELD] && create) room[RANDOM_SOURCE_STATE_FIELD] = {};
      if (!room[RANDOM_SOURCE_STATE_FIELD]) return null;
      if (!room[RANDOM_SOURCE_STATE_FIELD].politicalEffect && create) {
        room[RANDOM_SOURCE_STATE_FIELD].politicalEffect = createPoliticalEffectSourceState(rng);
      }
      if (!room[RANDOM_SOURCE_STATE_FIELD].politicalEffect) return null;
      if (!room[RANDOM_SOURCE_STATE_FIELD].politicalEffect[factionId] && create) {
        room[RANDOM_SOURCE_STATE_FIELD].politicalEffect[factionId] = { available: [], recyclable: [], reserved: [] };
      }
      const storage = room[RANDOM_SOURCE_STATE_FIELD].politicalEffect[factionId] || null;
      if (!storage) return null;
      storage.available ||= []; storage.recyclable ||= []; storage.reserved ||= [];
      return storage;
    }
    if (!room.feudDecks && create) room.feudDecks = createPoliticalEffectStorage(rng);
    if (!room.feudDecks) return null;
    if (!room.feudDecks[factionId] && create) room.feudDecks[factionId] = { drawPile: [], discard: [] };
    const storage = room.feudDecks[factionId] || null;
    if (!storage) return null;
    storage.drawPile ||= []; storage.discard ||= [];
    return storage;
  }

  function arrays({ create = false } = {}) {
    const storage = backing({ create });
    if (!storage) return null;
    return digital
      ? { available: storage.available, recyclable: storage.recyclable, reserved: storage.reserved }
      : { available: storage.drawPile, recyclable: storage.discard, reserved: null };
  }

  function refreshCycle() {
    const state = arrays({ create: true });
    if (state.available.length || !state.recyclable.length) return false;
    const refreshed = shuffleWithRng(state.recyclable.map(occurrence => ({ ...occurrence })), rng);
    state.available.splice(0, state.available.length, ...refreshed);
    state.recyclable.splice(0, state.recyclable.length);
    return true;
  }

  return {
    consumeNext() {
      refreshCycle();
      const state = arrays({ create: true });
      const outcome = canonicalizePoliticalEffectOccurrence(factionId, state.available.shift() || null);
      if (digital && outcome) state.reserved.push({ ...outcome });
      return outcome;
    },
    markUsed(outcome) {
      if (!outcome) return false;
      const state = arrays({ create: true });
      const canonical = canonicalizePoliticalEffectOccurrence(factionId, outcome);
      const key = occurrenceKey(factionId, canonical);
      if (digital) {
        const reservedIndex = state.reserved.findIndex(item => occurrenceKey(factionId, item) === key);
        if (reservedIndex >= 0) {
          const [stored] = state.reserved.splice(reservedIndex, 1);
          state.recyclable.push(stored);
          return true;
        }
      }
      if ([...state.available, ...state.recyclable, ...(state.reserved || [])].some(item => occurrenceKey(factionId, item) === key)) return false;
      state.recyclable.push({ ...canonical });
      return true;
    },
    remainingCount() { return arrays()?.available.length || 0; },
    availabilityCounts() {
      const state = arrays();
      return { available: state?.available.length || 0, recyclable: state?.recyclable.length || 0, reserved: state?.reserved?.length || 0 };
    },
  };
}

module.exports = {
  expandPoliticalEffectDefinitions,
  createPoliticalEffectStorage,
  createPoliticalEffectSourceState,
  canonicalizePoliticalEffectOccurrence,
  politicalEffectSource,
};
