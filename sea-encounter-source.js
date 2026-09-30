'use strict';

const { ANCHOR_CARDS } = require('./game-data');
const { shuffleWithRng } = require('./random-sources');

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
  for (const [color, definitions] of Object.entries(ANCHOR_CARDS)) {
    storage[color] = {
      drawPile: shuffleWithRng(expandSeaEncounterDefinitions(definitions), rng),
      discard: [],
    };
  }
  return storage;
}

function ensureSeaEncounterBacking(room, color, rng = Math.random) {
  if (!room || !ANCHOR_CARDS[color]) return null;
  room.anchorDecks ||= createSeaEncounterStorage(rng);
  room.anchorDecks[color] ||= { drawPile: [], discard: [] };
  const backing = room.anchorDecks[color];
  backing.drawPile ||= [];
  backing.discard ||= [];
  return backing;
}

function seaEncounterSource(room, color, rng = Math.random) {
  const backing = ensureSeaEncounterBacking(room, color, rng);
  if (!backing) return null;

  function refreshCycle() {
    if (backing.drawPile.length || !backing.discard.length) return false;
    const refreshed = shuffleWithRng(backing.discard.map(occurrence => ({ ...occurrence })), rng);
    backing.drawPile = refreshed;
    backing.discard = [];
    return true;
  }

  return {
    consumeNext() {
      refreshCycle();
      return backing.drawPile.shift() || null;
    },

    peekNext() {
      refreshCycle();
      return backing.drawPile[0] || null;
    },

    remainingCount() {
      return backing.drawPile.length;
    },

    markUsed(occurrence) {
      if (!occurrence) return false;
      backing.discard.push(occurrence);
      return true;
    },

    compatibilityStorage() {
      return backing;
    },
  };
}

module.exports = {
  createSeaEncounterStorage,
  seaEncounterSource,
};
