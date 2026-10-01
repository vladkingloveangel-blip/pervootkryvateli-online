'use strict';

const { SAILING_EVENT_DEFINITIONS } = require('./game-data');
const { shuffleWithRng } = require('./random-sources');
const { SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION, RANDOM_SOURCE_STATE_FIELD } = require('./save-migrations');

function expandSailingEventDefinitions(definitions) {
  const occurrences = [];
  for (const definition of definitions || []) {
    const count = Math.max(1, Number(definition.quantity) || 1);
    for (let copy = 1; copy <= count; copy++) occurrences.push({ ...definition, copy });
  }
  return occurrences;
}

function createSailingEventStorage(rng = Math.random) {
  return { drawPile: shuffleWithRng(expandSailingEventDefinitions(SAILING_EVENT_DEFINITIONS), rng), discard: [] };
}

function createSailingEventSourceState(rng = Math.random) {
  return { available: shuffleWithRng(expandSailingEventDefinitions(SAILING_EVENT_DEFINITIONS), rng), recyclable: [], reserved: [] };
}

function canonicalizeSailingEventOccurrence(rawOccurrence) {
  if (!rawOccurrence) return null;
  const canonical = SAILING_EVENT_DEFINITIONS.find(definition =>
    definition.id === rawOccurrence.masterCardId || definition.id === rawOccurrence.id
  );
  return canonical ? { ...rawOccurrence, ...canonical, masterCardId: canonical.id } : rawOccurrence;
}

function occurrenceKey(occurrence) {
  if (!occurrence) return null;
  return `${occurrence.masterCardId || occurrence.id || 'unknown'}:${occurrence.copy ?? 'legacy'}`;
}

function releaseStoredBenefitReservation(room, benefit) {
  const source = benefit?.source;
  if (!room || source?.deck !== 'event' || !source.occurrence) return false;
  return Boolean(sailingEventSource(room)?.releaseReserved(source.occurrence));
}

function sailingEventSource(room, rng = Math.random) {
  if (!room) return null;
  const digital = Boolean(room[RANDOM_SOURCE_STATE_FIELD])
    || Number(room.digitalModelSchemaVersion) >= SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION;

  function backing({ create = false } = {}) {
    if (digital) {
      if (!room[RANDOM_SOURCE_STATE_FIELD] && create) room[RANDOM_SOURCE_STATE_FIELD] = {};
      if (!room[RANDOM_SOURCE_STATE_FIELD]) return null;
      if (!room[RANDOM_SOURCE_STATE_FIELD].sailingEvent && create) {
        room[RANDOM_SOURCE_STATE_FIELD].sailingEvent = createSailingEventSourceState(rng);
      }
      const storage = room[RANDOM_SOURCE_STATE_FIELD].sailingEvent || null;
      if (!storage) return null;
      storage.available ||= []; storage.recyclable ||= []; storage.reserved ||= [];
      return storage;
    }
    if (!room.eventDeck && create) room.eventDeck = createSailingEventStorage(rng);
    const storage = room.eventDeck || null;
    if (!storage) return null;
    storage.drawPile ||= []; storage.discard ||= [];
    return storage;
  }

  function arrays({ create = false } = {}) {
    const storage = backing({ create });
    if (!storage) return null;
    return digital
      ? { storage, available: storage.available, recyclable: storage.recyclable, reserved: storage.reserved }
      : { storage, available: storage.drawPile, recyclable: storage.discard, reserved: null };
  }

  function refreshCycle() {
    const state = arrays({ create: true });
    if (state.available.length || !state.recyclable.length) return false;
    const refreshed = shuffleWithRng(state.recyclable.map(occurrence => ({ ...occurrence })), rng);
    state.available.splice(0, state.available.length, ...refreshed);
    state.recyclable.splice(0, state.recyclable.length);
    return true;
  }

  function consumeNext() {
    refreshCycle();
    const state = arrays({ create: true });
    const outcome = canonicalizeSailingEventOccurrence(state.available.shift() || null);
    if (digital && outcome) state.reserved.push({ ...outcome });
    return outcome;
  }

  function returnToRecyclable(outcome) {
    if (!outcome) return false;
    const state = arrays();
    if (!state) return false;
    if (!digital) { state.recyclable.push({ ...outcome }); return true; }
    const key = occurrenceKey(outcome);
    const reservedIndex = state.reserved.findIndex(item => occurrenceKey(item) === key);
    if (reservedIndex >= 0) {
      const [stored] = state.reserved.splice(reservedIndex, 1);
      state.recyclable.push(stored);
      return true;
    }
    if ([...state.available, ...state.recyclable].some(item => occurrenceKey(item) === key)) return false;
    state.recyclable.push({ ...outcome });
    return true;
  }

  return {
    consumeNext,
    replaceObserved(first) { if (first) returnToRecyclable(first); return consumeNext(); },
    markUsed(outcome) { return returnToRecyclable(outcome); },
    releaseReserved(outcome) { return returnToRecyclable(outcome); },
    remainingCount() { return arrays()?.available.length || 0; },
    availabilityCounts() {
      const state = arrays();
      return { available: state?.available.length || 0, recyclable: state?.recyclable.length || 0, reserved: state?.reserved?.length || 0 };
    },
  };
}

module.exports = {
  expandSailingEventDefinitions,
  createSailingEventStorage,
  createSailingEventSourceState,
  canonicalizeSailingEventOccurrence,
  sailingEventSource,
  releaseStoredBenefitReservation,
};
