'use strict';

const { ASSIGNMENT_CARDS } = require('./game-data');
const { ELIGIBILITY, selectFilteredTasks, shuffleWithRng } = require('./random-sources');
const { getActiveAssignmentTask } = require('./domain-state');

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
  for (const factionId of Object.keys(ASSIGNMENT_CARDS)) {
    storage[factionId] = {
      drawPile: shuffleWithRng(expandAssignmentDefinitions(ASSIGNMENT_CARDS[factionId] || []), rng),
      discard: [],
      removed: [],
    };
  }
  return storage;
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
  const pending = room?.pendingAssignmentChoice;
  if (pending?.kind === 'embassy' && pending.factionId === factionId) {
    for (const occurrence of pending.options || []) if (occurrence) reserved.push(occurrence);
  }
  return reserved;
}

function assignmentPool(room, factionId, rng = Math.random, options = {}) {
  if (!room || !ASSIGNMENT_CARDS[factionId]) return null;
  const classify = typeof options.classify === 'function' ? options.classify : null;

  function backing({ create = false } = {}) {
    if (!room.assignmentDecks && create) room.assignmentDecks = createAssignmentStorage(rng);
    if (!room.assignmentDecks) return null;
    const storage = room.assignmentDecks[factionId] || null;
    if (!storage) return null;
    storage.drawPile ||= [];
    storage.discard ||= [];
    storage.removed ||= [];
    return storage;
  }

  function classifyForPlayer(player, occurrence) {
    if (reservedOccurrences(room, factionId).some(reserved => sameOccurrence(reserved, occurrence))) {
      return ELIGIBILITY.SKIP;
    }
    if (!classify) throw new TypeError('AssignmentPool offerEligible requires a classifier callback.');
    return classify(room, player, occurrence);
  }

  function returnOccurrences(occurrences) {
    const storage = backing({ create: true });
    if (!storage) return 0;
    const returned = [];
    for (const occurrence of occurrences || []) {
      if (!occurrence || containsOccurrence(storage.removed, occurrence)) continue;
      takeOccurrence(storage.drawPile, occurrence);
      takeOccurrence(storage.discard, occurrence);
      returned.push({ ...occurrence });
    }
    if (!returned.length) return 0;
    storage.drawPile = shuffleWithRng(
      [...storage.drawPile, ...returned].map(occurrence => ({ ...occurrence })),
      rng
    );
    return returned.length;
  }

  return {
    offerEligible(player, count = 1) {
      const storage = backing({ create: true });
      if (!storage) return [];
      return selectFilteredTasks(storage.drawPile, storage.discard, storage.removed, {
        count,
        classify: occurrence => classifyForPlayer(player, occurrence),
        rng,
      });
    },

    chooseOffered(occurrences, cardId) {
      const cards = (occurrences || []).filter(Boolean).map(occurrence => ({ ...occurrence }));
      const chosen = cards.find(occurrence => occurrenceId(occurrence) === cardId) || null;
      if (!chosen) return { chosen: null, returned: 0 };
      const returned = returnOccurrences(cards.filter(occurrence => occurrenceId(occurrence) !== occurrenceId(chosen)));
      return { chosen, returned };
    },

    reserve(occurrence) {
      const storage = backing({ create: true });
      if (!storage || !occurrence || containsOccurrence(storage.removed, occurrence)) return null;
      return takeOccurrence(storage.drawPile, occurrence) || takeOccurrence(storage.discard, occurrence);
    },

    returnUnchosen(occurrences) {
      const list = Array.isArray(occurrences) ? occurrences : [occurrences];
      return returnOccurrences(list.filter(Boolean));
    },

    recycleCompleted(occurrence) {
      const storage = backing({ create: true });
      if (!storage || !occurrence || containsOccurrence(storage.removed, occurrence)) return false;
      takeOccurrence(storage.drawPile, occurrence);
      takeOccurrence(storage.discard, occurrence);
      storage.discard.push({ ...occurrence });
      return true;
    },

    excludePermanently(occurrence) {
      const storage = backing({ create: true });
      if (!storage || !occurrence) return false;
      if (containsOccurrence(storage.removed, occurrence)) return false;
      const stored = takeOccurrence(storage.drawPile, occurrence)
        || takeOccurrence(storage.discard, occurrence)
        || occurrence;
      storage.removed.push({ ...stored });
      return true;
    },

    remainingCount() {
      return backing()?.drawPile.length || 0;
    },

    availabilityCounts() {
      const storage = backing();
      return {
        available: storage?.drawPile.length || 0,
        recyclable: storage?.discard.length || 0,
        removed: storage?.removed.length || 0,
      };
    },

    compatibilityStorage() {
      return backing();
    },
  };
}

module.exports = {
  expandAssignmentDefinitions,
  createAssignmentStorage,
  assignmentPool,
};
