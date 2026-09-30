'use strict';

const { EXPEDITION_CARDS } = require('./game-data');

function expandExpeditionDefinitions(definitions) {
  const occurrences = [];
  for (const definition of definitions || []) {
    const count = Math.max(1, Number(definition.quantity) || 1);
    for (let copy = 1; copy <= count; copy++) occurrences.push({ ...definition, copy });
  }
  return occurrences;
}

function shuffleExpeditions(cards, rng = Math.random) {
  const out = (cards || []).map(card => ({ ...card }));
  for (let i = out.length - 1; i > 0; i--) {
    const sample = Math.max(0, Math.min(0.999999999, Number(rng()) || 0));
    const j = Math.floor(sample * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function createExpeditionStorage(rng = Math.random) {
  return { drawPile: shuffleExpeditions(expandExpeditionDefinitions(EXPEDITION_CARDS), rng) };
}

function sameOccurrence(left, right) {
  if (!left || !right) return false;
  if (left.id && right.id) return left.id === right.id;
  return Boolean(left.placeId && right.placeId && left.placeId === right.placeId);
}

function expeditionPool(room, rng = Math.random, options = {}) {
  if (!room) return null;
  const isEligible = typeof options.isEligible === 'function' ? options.isEligible : null;

  function backing({ create = false } = {}) {
    if (!room.expeditionDeck && create) room.expeditionDeck = createExpeditionStorage(rng);
    if (!room.expeditionDeck) return null;
    if (!Array.isArray(room.expeditionDeck.drawPile)) {
      if (!create) return null;
      room.expeditionDeck.drawPile = [];
    }
    return room.expeditionDeck;
  }

  function eligibleForPlayer(player, occurrence) {
    if (!isEligible) throw new TypeError('ExpeditionPool eligibility operations require an isEligible callback.');
    return Boolean(isEligible(player, occurrence));
  }

  return {
    hasEligible(player) {
      const storage = backing({ create: true });
      return Boolean(storage?.drawPile.some(occurrence => eligibleForPlayer(player, occurrence)));
    },

    takeEligible(player) {
      const storage = backing({ create: true });
      if (!storage) return null;
      const skipped = [];
      let selected = null;

      while (storage.drawPile.length) {
        const candidate = storage.drawPile.shift();
        if (eligibleForPlayer(player, candidate)) {
          selected = candidate;
          break;
        }
        skipped.push(candidate);
      }

      if (skipped.length) {
        storage.drawPile = shuffleExpeditions([...storage.drawPile, ...skipped], rng);
      }
      return selected;
    },

    returnCompleted(expedition) {
      const storage = backing({ create: true });
      const occurrence = expedition?.card || expedition;
      if (!storage || !occurrence) return false;
      const withoutReturned = storage.drawPile.filter(card => !sameOccurrence(card, occurrence));
      storage.drawPile = shuffleExpeditions([...withoutReturned, { ...occurrence }], rng);
      return true;
    },

    remainingCount() {
      return backing()?.drawPile.length || 0;
    },

    compatibilityStorage() {
      return backing();
    },
  };
}

module.exports = {
  expandExpeditionDefinitions,
  shuffleExpeditions,
  createExpeditionStorage,
  expeditionPool,
};
