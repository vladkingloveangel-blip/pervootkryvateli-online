'use strict';

const { SAILING_EVENT_CARDS } = require('./game-data');
const { shuffleWithRng } = require('./random-sources');

function expandSailingEventDefinitions(definitions) {
  const occurrences = [];
  for (const definition of definitions || []) {
    const count = Math.max(1, Number(definition.quantity) || 1);
    for (let copy = 1; copy <= count; copy++) occurrences.push({ ...definition, copy });
  }
  return occurrences;
}

function createSailingEventStorage(rng = Math.random) {
  return {
    drawPile: shuffleWithRng(expandSailingEventDefinitions(SAILING_EVENT_CARDS), rng),
    discard: [],
  };
}

function canonicalizeSailingEventOccurrence(rawOccurrence) {
  if (!rawOccurrence) return null;
  const canonical = SAILING_EVENT_CARDS.find(definition =>
    definition.id === rawOccurrence.masterCardId || definition.id === rawOccurrence.id
  );
  return canonical
    ? { ...rawOccurrence, ...canonical, masterCardId: canonical.id }
    : rawOccurrence;
}

function sailingEventSource(room, rng = Math.random) {
  if (!room) return null;

  function backing({ create = false } = {}) {
    if (!room.eventDeck && create) room.eventDeck = createSailingEventStorage(rng);
    const storage = room.eventDeck || null;
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

  function returnToRecyclable(outcome) {
    if (!outcome) return false;
    const storage = backing();
    if (!storage) return false;
    storage.discard.push({ ...outcome });
    return true;
  }

  return {
    consumeNext() {
      refreshCycle();
      const storage = backing({ create: true });
      return canonicalizeSailingEventOccurrence(storage.drawPile.shift() || null);
    },

    markUsed(outcome) {
      return returnToRecyclable(outcome);
    },

    releaseReserved(outcome) {
      return returnToRecyclable(outcome);
    },

    remainingCount() {
      return backing()?.drawPile.length || 0;
    },
  };
}

module.exports = {
  createSailingEventStorage,
  canonicalizeSailingEventOccurrence,
  sailingEventSource,
};
