'use strict';

const { EXPEDITION_DEFINITIONS } = require('./game-data');
const { getActiveExpeditionTask } = require('./domain-state');
const {
  EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION,
  RANDOM_SOURCE_STATE_FIELD,
} = require('./save-migrations');

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
  return { drawPile: shuffleExpeditions(expandExpeditionDefinitions(EXPEDITION_DEFINITIONS), rng) };
}

function createExpeditionPoolState(rng = Math.random) {
  return {
    available: shuffleExpeditions(expandExpeditionDefinitions(EXPEDITION_DEFINITIONS), rng),
    reserved: [],
  };
}

function usesDigitalExpeditionPool(room) {
  return Boolean(room?.[RANDOM_SOURCE_STATE_FIELD]?.expeditionPool)
    || Number(room?.digitalModelSchemaVersion) >= EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION;
}

function occurrenceId(occurrence) {
  return occurrence?.id || occurrence?.expeditionId || occurrence?.cardId || occurrence?.placeId || null;
}

function sameOccurrence(left, right) {
  const leftId = occurrenceId(left);
  const rightId = occurrenceId(right);
  if (!leftId || !rightId || leftId !== rightId) return false;
  if (left?.copy == null || right?.copy == null) return true;
  return Number(left.copy) === Number(right.copy);
}

function containsOccurrence(items, occurrence) {
  return Array.isArray(items) && items.some(item => sameOccurrence(item, occurrence));
}

function takeOccurrence(items, occurrence) {
  if (!Array.isArray(items) || !occurrence) return null;
  const index = items.findIndex(item => sameOccurrence(item, occurrence));
  if (index < 0) return null;
  return items.splice(index, 1)[0] || null;
}

function activeReservationOccurrences(room) {
  const reserved = [];
  for (const player of room?.players || []) {
    const task = getActiveExpeditionTask(player);
    if (!task) continue;
    if (task.payload) reserved.push(task.payload);
    else reserved.push({ id: task.id, placeId: task.source?.placeId });
  }
  return reserved;
}

function reserveActiveOccurrences(storage, room) {
  storage.available ||= [];
  storage.reserved ||= [];
  for (const occurrence of activeReservationOccurrences(room)) {
    if (!occurrence || containsOccurrence(storage.reserved, occurrence)) continue;
    const stored = takeOccurrence(storage.available, occurrence) || occurrence;
    storage.reserved.push(stored);
  }
  return storage;
}

function expeditionPool(room, rng = Math.random, options = {}) {
  if (!room) return null;
  const isEligible = typeof options.isEligible === 'function' ? options.isEligible : null;
  const digital = usesDigitalExpeditionPool(room);

  function backing({ create = false } = {}) {
    if (digital) {
      if (!room[RANDOM_SOURCE_STATE_FIELD] && create) room[RANDOM_SOURCE_STATE_FIELD] = {};
      if (!room[RANDOM_SOURCE_STATE_FIELD]) return null;
      if (!room[RANDOM_SOURCE_STATE_FIELD].expeditionPool && create) {
        room[RANDOM_SOURCE_STATE_FIELD].expeditionPool = reserveActiveOccurrences(createExpeditionPoolState(rng), room);
      }
      const storage = room[RANDOM_SOURCE_STATE_FIELD].expeditionPool;
      if (!storage) return null;
      if (!Array.isArray(storage.available)) {
        if (!create) return null;
        storage.available = [];
      }
      if (!Array.isArray(storage.reserved)) {
        if (!create) return null;
        storage.reserved = [];
      }
      return {
        digital: true,
        storage,
        available: storage.available,
        reserved: storage.reserved,
      };
    }

    if (!room.expeditionDeck && create) room.expeditionDeck = createExpeditionStorage(rng);
    if (!room.expeditionDeck) return null;
    if (!Array.isArray(room.expeditionDeck.drawPile)) {
      if (!create) return null;
      room.expeditionDeck.drawPile = [];
    }
    return {
      digital: false,
      storage: room.expeditionDeck,
      available: room.expeditionDeck.drawPile,
      reserved: [],
    };
  }

  function setAvailable(state, items) {
    if (state.digital) state.storage.available = items;
    else state.storage.drawPile = items;
    state.available = items;
  }

  function eligibleForPlayer(player, occurrence) {
    if (!isEligible) throw new TypeError('ExpeditionPool eligibility operations require an isEligible callback.');
    return Boolean(isEligible(player, occurrence));
  }

  return {
    ensureStorage() {
      return backing({ create: true })?.storage || null;
    },

    hasEligible(player) {
      const state = backing({ create: true });
      return Boolean(state?.available.some(occurrence => eligibleForPlayer(player, occurrence)));
    },

    takeEligible(player) {
      const state = backing({ create: true });
      if (!state) return null;
      const skipped = [];
      let selected = null;

      while (state.available.length) {
        const candidate = state.available.shift();
        if (eligibleForPlayer(player, candidate)) {
          selected = candidate;
          break;
        }
        skipped.push(candidate);
      }

      if (skipped.length) {
        setAvailable(state, shuffleExpeditions([...state.available, ...skipped], rng));
      }
      if (selected && state.digital) {
        if (containsOccurrence(state.reserved, selected)) {
          throw new Error('Expedition occurrence is already reserved.');
        }
        state.reserved.push(selected);
      }
      return selected;
    },

    returnCompleted(expedition) {
      const state = backing({ create: true });
      const occurrence = expedition?.card || expedition;
      if (!state || !occurrence) return false;

      let stored = occurrence;
      if (state.digital) {
        stored = takeOccurrence(state.reserved, occurrence);
        if (!stored) return false;
      } else {
        stored = takeOccurrence(state.available, occurrence) || occurrence;
      }

      const withoutReturned = state.available.filter(card => !sameOccurrence(card, stored));
      setAvailable(state, shuffleExpeditions([...withoutReturned, { ...stored }], rng));
      return true;
    },

    remainingCount() {
      return backing()?.available.length || 0;
    },

    reservationCount() {
      return backing()?.reserved.length || 0;
    },

    compatibilityStorage() {
      const state = backing();
      if (!state) return null;
      if (!state.digital) return state.storage;
      return { drawPile: state.available };
    },
  };
}

module.exports = {
  expandExpeditionDefinitions,
  shuffleExpeditions,
  createExpeditionStorage,
  createExpeditionPoolState,
  usesDigitalExpeditionPool,
  expeditionPool,
};
