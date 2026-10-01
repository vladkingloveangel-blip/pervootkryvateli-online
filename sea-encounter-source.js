'use strict';

const { SEA_ENCOUNTER_DEFINITIONS } = require('./game-data');
const { shuffleWithRng } = require('./random-sources');
const { SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION, RANDOM_SOURCE_STATE_FIELD } = require('./save-migrations');

function expandSeaEncounterDefinitions(definitions) {
  const occurrences = [];
  for (const definition of definitions || []) {
    const count = Math.max(1, Number(definition.quantity) || 1);
    for (let copy = 1; copy <= count; copy++) occurrences.push({ ...definition, copy });
  }
  return occurrences;
}

function createSeaEncounterStorage(rng = Math.random) {
  const storage = {};
  for (const [color, definitions] of Object.entries(SEA_ENCOUNTER_DEFINITIONS)) {
    storage[color] = { drawPile: shuffleWithRng(expandSeaEncounterDefinitions(definitions), rng), discard: [] };
  }
  return storage;
}

function createSeaEncounterSourceState(rng = Math.random) {
  const storage = {};
  for (const [color, definitions] of Object.entries(SEA_ENCOUNTER_DEFINITIONS)) {
    storage[color] = { available: shuffleWithRng(expandSeaEncounterDefinitions(definitions), rng), recyclable: [] };
  }
  return storage;
}

function usesDigitalSourceState(room) {
  return Boolean(room?.[RANDOM_SOURCE_STATE_FIELD])
    || Number(room?.digitalModelSchemaVersion) >= SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION;
}

function ensureSeaEncounterBacking(room, color, rng = Math.random) {
  if (!room || !SEA_ENCOUNTER_DEFINITIONS[color]) return null;
  if (usesDigitalSourceState(room)) {
    room[RANDOM_SOURCE_STATE_FIELD] ||= {};
    room[RANDOM_SOURCE_STATE_FIELD].seaEncounter ||= createSeaEncounterSourceState(rng);
    room[RANDOM_SOURCE_STATE_FIELD].seaEncounter[color] ||= { available: [], recyclable: [] };
    const storage = room[RANDOM_SOURCE_STATE_FIELD].seaEncounter[color];
    storage.available ||= [];
    storage.recyclable ||= [];
    return { storage, available: storage.available, recyclable: storage.recyclable, digital: true };
  }
  room.anchorDecks ||= createSeaEncounterStorage(rng);
  room.anchorDecks[color] ||= { drawPile: [], discard: [] };
  const storage = room.anchorDecks[color];
  storage.drawPile ||= [];
  storage.discard ||= [];
  return { storage, available: storage.drawPile, recyclable: storage.discard, digital: false };
}

function seaEncounterSource(room, color, rng = Math.random) {
  const backing = ensureSeaEncounterBacking(room, color, rng);
  if (!backing) return null;

  function refreshCycle() {
    if (backing.available.length || !backing.recyclable.length) return false;
    const refreshed = shuffleWithRng(backing.recyclable.map(occurrence => ({ ...occurrence })), rng);
    backing.available.splice(0, backing.available.length, ...refreshed);
    backing.recyclable.splice(0, backing.recyclable.length);
    return true;
  }

  return {
    consumeNext() { refreshCycle(); return backing.available.shift() || null; },
    peekNext() { refreshCycle(); return backing.available[0] || null; },
    remainingCount() { return backing.available.length; },
    markUsed(occurrence) { if (!occurrence) return false; backing.recyclable.push(occurrence); return true; },
    availabilityCounts() { return { available: backing.available.length, recyclable: backing.recyclable.length }; },
    compatibilityStorage() {
      return backing.digital ? { drawPile: backing.available, discard: backing.recyclable } : backing.storage;
    },
  };
}

module.exports = {
  expandSeaEncounterDefinitions,
  createSeaEncounterStorage,
  createSeaEncounterSourceState,
  seaEncounterSource,
};
