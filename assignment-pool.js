'use strict';

const { ASSIGNMENT_DEFINITIONS } = require('./game-data');
const { ELIGIBILITY, selectFilteredTasks, shuffleWithRng } = require('./random-sources');
const { getActiveAssignmentTask, getPendingAssignmentChoiceResolution } = require('./domain-state');
const {
  ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION,
  RANDOM_SOURCE_STATE_FIELD,
} = require('./save-migrations');

function expandAssignmentDefinitions(definitions) {
  const occurrences = [];
  for (const definition of definitions || []) {
    const count = Math.max(1, Number(definition.quantity) || 1);
    for (let copy = 1; copy <= count; copy++) occurrences.push({ ...definition, copy });
  }
  return occurrences;
}

function createAssignmentStorage(rng = Math.random) {
  const storage = {};
  for (const factionId of Object.keys(ASSIGNMENT_DEFINITIONS)) {
    storage[factionId] = {
      drawPile: shuffleWithRng(expandAssignmentDefinitions(ASSIGNMENT_DEFINITIONS[factionId] || []), rng),
      discard: [],
      removed: [],
    };
  }
  return storage;
}

function createAssignmentPoolFactionState(factionId, rng = Math.random) {
  return {
    available: shuffleWithRng(expandAssignmentDefinitions(ASSIGNMENT_DEFINITIONS[factionId] || []), rng),
    recyclable: [],
    permanentlyExcluded: [],
    reserved: [],
  };
}

function createAssignmentPoolState(rng = Math.random) {
  const storage = {};
  for (const factionId of Object.keys(ASSIGNMENT_DEFINITIONS)) {
    storage[factionId] = createAssignmentPoolFactionState(factionId, rng);
  }
  return storage;
}

function usesDigitalAssignmentPool(room) {
  return Boolean(room?.[RANDOM_SOURCE_STATE_FIELD]?.assignmentPool)
    || Number(room?.digitalModelSchemaVersion) >= ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION;
}

function occurrenceId(occurrence) {
  return occurrence?.id || occurrence?.conditionKey || null;
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
  if (!Array.isArray(items)) return null;
  const index = items.findIndex(item => sameOccurrence(item, occurrence));
  if (index < 0) return null;
  return items.splice(index, 1)[0] || null;
}

function reservedOccurrences(room, factionId) {
  const reserved = [];
  for (const player of room?.players || []) {
    const task = getActiveAssignmentTask(player);
    if (task?.source?.factionId === factionId && task.payload) reserved.push(task.payload);
  }
  const pending = getPendingAssignmentChoiceResolution(room);
  if (pending?.kind === 'embassy' && pending.payload?.factionId === factionId) {
    for (const occurrence of pending.options || []) if (occurrence) reserved.push(occurrence);
  }
  return reserved;
}

function assignmentPool(room, factionId, rng = Math.random, options = {}) {
  if (!room || !ASSIGNMENT_DEFINITIONS[factionId]) return null;
  const classify = typeof options.classify === 'function' ? options.classify : null;
  const digital = usesDigitalAssignmentPool(room);

  function backing({ create = false } = {}) {
    if (digital) {
      if (!room[RANDOM_SOURCE_STATE_FIELD] && create) room[RANDOM_SOURCE_STATE_FIELD] = {};
      if (!room[RANDOM_SOURCE_STATE_FIELD]) return null;
      if (!room[RANDOM_SOURCE_STATE_FIELD].assignmentPool && create) {
        room[RANDOM_SOURCE_STATE_FIELD].assignmentPool = createAssignmentPoolState(rng);
      }
      const pools = room[RANDOM_SOURCE_STATE_FIELD].assignmentPool;
      if (!pools) return null;
      if (!pools[factionId] && create) pools[factionId] = createAssignmentPoolFactionState(factionId, rng);
      const storage = pools[factionId] || null;
      if (!storage) return null;
      storage.available ||= [];
      storage.recyclable ||= [];
      storage.permanentlyExcluded ||= [];
      storage.reserved ||= [];
      return {
        storage,
        available: storage.available,
        recyclable: storage.recyclable,
        removed: storage.permanentlyExcluded,
        reserved: storage.reserved,
        digital: true,
      };
    }

    if (!room.assignmentDecks && create) room.assignmentDecks = createAssignmentStorage(rng);
    if (!room.assignmentDecks) return null;
    const storage = room.assignmentDecks[factionId] || null;
    if (!storage) return null;
    storage.drawPile ||= [];
    storage.discard ||= [];
    storage.removed ||= [];
    return {
      storage,
      available: storage.drawPile,
      recyclable: storage.discard,
      removed: storage.removed,
      reserved: null,
      digital: false,
    };
  }

  function classifyForPlayer(player, occurrence, state) {
    if (state.digital) {
      if (containsOccurrence(state.reserved, occurrence)) return ELIGIBILITY.SKIP;
    } else if (reservedOccurrences(room, factionId).some(reserved => sameOccurrence(reserved, occurrence))) {
      return ELIGIBILITY.SKIP;
    }
    if (!classify) throw new TypeError('AssignmentPool offerEligible requires a classifier callback.');
    return classify(room, player, occurrence);
  }

  function returnOccurrences(occurrences) {
    const state = backing({ create: true });
    if (!state) return 0;
    const returned = [];

    for (const occurrence of occurrences || []) {
      if (!occurrence || containsOccurrence(state.removed, occurrence)) continue;
      if (state.digital) {
        const stored = takeOccurrence(state.reserved, occurrence)
          || takeOccurrence(state.available, occurrence)
          || takeOccurrence(state.recyclable, occurrence)
          || occurrence;
        returned.push({ ...stored });
      } else {
        takeOccurrence(state.available, occurrence);
        takeOccurrence(state.recyclable, occurrence);
        returned.push({ ...occurrence });
      }
    }

    if (!returned.length) return 0;
    const reordered = shuffleWithRng(
      [...state.available, ...returned].map(occurrence => ({ ...occurrence })),
      rng
    );
    state.available.splice(0, state.available.length, ...reordered);
    return returned.length;
  }

  return {
    offerEligible(player, count = 1) {
      const state = backing({ create: true });
      if (!state) return [];
      const chosen = selectFilteredTasks(state.available, state.recyclable, state.removed, {
        count,
        classify: occurrence => classifyForPlayer(player, occurrence, state),
        rng,
      });
      if (state.digital) {
        for (const occurrence of chosen) {
          if (!containsOccurrence(state.reserved, occurrence)) state.reserved.push(occurrence);
        }
      }
      return chosen;
    },

    chooseOffered(occurrences, cardId) {
      const cards = (occurrences || []).filter(Boolean).map(occurrence => ({ ...occurrence }));
      const chosen = cards.find(occurrence => occurrenceId(occurrence) === cardId) || null;
      if (!chosen) return { chosen: null, returned: 0 };
      const returned = returnOccurrences(cards.filter(occurrence => occurrenceId(occurrence) !== occurrenceId(chosen)));
      return { chosen, returned };
    },

    reserve(occurrence) {
      const state = backing({ create: true });
      if (!state || !occurrence || containsOccurrence(state.removed, occurrence)) return null;
      if (state.digital && containsOccurrence(state.reserved, occurrence)) return null;
      const stored = takeOccurrence(state.available, occurrence) || takeOccurrence(state.recyclable, occurrence);
      if (!stored) return null;
      if (state.digital) state.reserved.push(stored);
      return stored;
    },

    returnUnchosen(occurrences) {
      const list = Array.isArray(occurrences) ? occurrences : [occurrences];
      return returnOccurrences(list.filter(Boolean));
    },

    recycleCompleted(occurrence) {
      const state = backing({ create: true });
      if (!state || !occurrence || containsOccurrence(state.removed, occurrence)) return false;
      const stored = state.digital
        ? (takeOccurrence(state.reserved, occurrence)
          || takeOccurrence(state.available, occurrence)
          || takeOccurrence(state.recyclable, occurrence)
          || occurrence)
        : (takeOccurrence(state.available, occurrence)
          || takeOccurrence(state.recyclable, occurrence)
          || occurrence);
      state.recyclable.push({ ...stored });
      return true;
    },

    excludePermanently(occurrence) {
      const state = backing({ create: true });
      if (!state || !occurrence) return false;
      if (containsOccurrence(state.removed, occurrence)) return false;
      const stored = (state.digital ? takeOccurrence(state.reserved, occurrence) : null)
        || takeOccurrence(state.available, occurrence)
        || takeOccurrence(state.recyclable, occurrence)
        || occurrence;
      state.removed.push({ ...stored });
      return true;
    },

    remainingCount() {
      return backing()?.available.length || 0;
    },

    availabilityCounts() {
      const state = backing();
      return {
        available: state?.available.length || 0,
        recyclable: state?.recyclable.length || 0,
        removed: state?.removed.length || 0,
      };
    },

    compatibilityStorage() {
      const state = backing();
      if (!state) return null;
      if (!state.digital) return state.storage;
      return {
        drawPile: state.available,
        discard: state.recyclable,
        removed: state.removed,
      };
    },
  };
}

module.exports = {
  expandAssignmentDefinitions,
  createAssignmentStorage,
  createAssignmentPoolFactionState,
  createAssignmentPoolState,
  usesDigitalAssignmentPool,
  assignmentPool,
};
