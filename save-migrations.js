'use strict';

const DIGITAL_MODEL_SCHEMA_VERSION_FIELD = 'digitalModelSchemaVersion';
const INITIAL_DIGITAL_MODEL_SCHEMA_VERSION = 1;
const SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION = 2;
const ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION = 3;
const EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION = 4;
const CURRENT_DIGITAL_MODEL_SCHEMA_VERSION = EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION;
const RANDOM_SOURCE_STATE_FIELD = 'randomSourceState';

function cloneState(value) {
  return structuredClone(value);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function occurrenceKey(occurrence) {
  if (!isRecord(occurrence)) return null;
  const id = occurrence.masterCardId || occurrence.id || occurrence.conditionKey || occurrence.placeId || null;
  if (!id) return null;
  return `${String(id)}:${occurrence.copy ?? 'legacy'}`;
}

function takeMatchingOccurrence(items, occurrence) {
  if (!Array.isArray(items) || !occurrence) return null;
  const key = occurrenceKey(occurrence);
  const index = key === null
    ? items.findIndex(item => JSON.stringify(item) === JSON.stringify(occurrence))
    : items.findIndex(item => occurrenceKey(item) === key);
  if (index < 0) return null;
  return items.splice(index, 1)[0] || null;
}

function reserveOccurrence(storage, occurrence) {
  if (!isRecord(storage) || !occurrence) return false;
  storage.available ||= [];
  storage.recyclable ||= [];
  storage.reserved ||= [];
  const key = occurrenceKey(occurrence);
  if (storage.reserved.some(item => key === null
    ? JSON.stringify(item) === JSON.stringify(occurrence)
    : occurrenceKey(item) === key)) return false;
  const stored = takeMatchingOccurrence(storage.available, occurrence)
    || takeMatchingOccurrence(storage.recyclable, occurrence)
    || occurrence;
  storage.reserved.push(stored);
  return true;
}

function migrateLegacyCyclicStorage(rawStorage, { reservable = false, reserved = [] } = {}) {
  if (!isRecord(rawStorage)) return rawStorage;
  const migrated = {
    ...rawStorage,
    available: Array.isArray(rawStorage.drawPile) ? rawStorage.drawPile : [],
    recyclable: Array.isArray(rawStorage.discard) ? rawStorage.discard : [],
  };
  delete migrated.drawPile;
  delete migrated.discard;
  if (reservable) {
    migrated.reserved = Array.isArray(rawStorage.reserved) ? rawStorage.reserved : [];
    for (const occurrence of reserved) reserveOccurrence(migrated, occurrence);
  }
  return migrated;
}

function migrateGroupedLegacyCyclicStorage(rawGroup, reservationsByKey = null) {
  if (!isRecord(rawGroup)) return rawGroup;
  const migrated = {};
  for (const [key, rawStorage] of Object.entries(rawGroup)) {
    if (isRecord(rawStorage) && (Object.hasOwn(rawStorage, 'drawPile') || Object.hasOwn(rawStorage, 'discard'))) {
      migrated[key] = migrateLegacyCyclicStorage(rawStorage, {
        reservable: Boolean(reservationsByKey),
        reserved: reservationsByKey?.[key] || [],
      });
    } else {
      migrated[key] = rawStorage;
    }
  }
  return migrated;
}

function sailingReservations(state) {
  const reserved = [];
  for (const player of state?.players || []) {
    for (const saved of player?.savedEventCards || []) {
      if ((saved?.sourceDeck == null || saved.sourceDeck === 'event') && saved.sourceCard) reserved.push(saved.sourceCard);
    }
  }
  if (state?.pendingEvent?.eventCard && (!state.pendingEvent.origin || state.pendingEvent.origin === 'event-phase')) {
    reserved.push(state.pendingEvent.eventCard);
  }
  return reserved;
}

function politicalReservations(state) {
  const pending = state?.pendingFeud;
  if (!pending?.factionId || !pending.feudCard) return {};
  return { [pending.factionId]: [pending.feudCard] };
}

function assignmentOccurrenceId(occurrence) {
  return occurrence?.id || occurrence?.conditionKey || null;
}

function sameAssignmentOccurrence(left, right) {
  const leftId = assignmentOccurrenceId(left);
  const rightId = assignmentOccurrenceId(right);
  if (!leftId || !rightId || leftId !== rightId) return false;
  if (left?.copy == null || right?.copy == null) return true;
  return Number(left.copy) === Number(right.copy);
}

function containsAssignmentOccurrence(items, occurrence) {
  return Array.isArray(items) && items.some(item => sameAssignmentOccurrence(item, occurrence));
}

function takeAssignmentOccurrence(items, occurrence) {
  if (!Array.isArray(items) || !occurrence) return null;
  const index = items.findIndex(item => sameAssignmentOccurrence(item, occurrence));
  if (index < 0) return null;
  return items.splice(index, 1)[0] || null;
}

function assignmentReservations(state) {
  const reservedByFaction = {};
  const add = (factionId, occurrence) => {
    if (!factionId || !occurrence) return;
    (reservedByFaction[factionId] ||= []).push(occurrence);
  };

  for (const player of state?.players || []) {
    const active = player?.activeAssignment;
    add(active?.factionId, active?.card);
  }

  const pending = state?.pendingAssignmentChoice;
  if (pending?.kind === 'embassy' && pending.factionId) {
    for (const occurrence of pending.options || []) add(pending.factionId, occurrence);
  }
  return reservedByFaction;
}

function reserveAssignmentOccurrence(storage, occurrence) {
  if (!isRecord(storage) || !occurrence) return false;
  storage.available ||= [];
  storage.recyclable ||= [];
  storage.permanentlyExcluded ||= [];
  storage.reserved ||= [];
  if (containsAssignmentOccurrence(storage.permanentlyExcluded, occurrence)) {
    takeAssignmentOccurrence(storage.available, occurrence);
    takeAssignmentOccurrence(storage.recyclable, occurrence);
    takeAssignmentOccurrence(storage.reserved, occurrence);
    return false;
  }
  if (containsAssignmentOccurrence(storage.reserved, occurrence)) {
    const duplicateAvailable = takeAssignmentOccurrence(storage.available, occurrence);
    const duplicateRecyclable = takeAssignmentOccurrence(storage.recyclable, occurrence);
    return Boolean(duplicateAvailable || duplicateRecyclable);
  }
  const stored = takeAssignmentOccurrence(storage.available, occurrence)
    || takeAssignmentOccurrence(storage.recyclable, occurrence)
    || occurrence;
  storage.reserved.push(stored);
  return true;
}

function migrateLegacyAssignmentStorage(rawStorage, reserved = []) {
  if (!isRecord(rawStorage)) return rawStorage;
  const migrated = {
    ...rawStorage,
    available: Array.isArray(rawStorage.drawPile) ? rawStorage.drawPile : [],
    recyclable: Array.isArray(rawStorage.discard) ? rawStorage.discard : [],
    permanentlyExcluded: Array.isArray(rawStorage.removed) ? rawStorage.removed : [],
    reserved: Array.isArray(rawStorage.reserved) ? rawStorage.reserved : [],
  };
  delete migrated.drawPile;
  delete migrated.discard;
  delete migrated.removed;
  for (const occurrence of reserved) reserveAssignmentOccurrence(migrated, occurrence);
  return migrated;
}

function migrateLegacyAssignmentPool(rawGroup, reservationsByFaction) {
  if (!isRecord(rawGroup)) return rawGroup;
  const migrated = {};
  for (const [factionId, rawStorage] of Object.entries(rawGroup)) {
    if (isRecord(rawStorage) && (
      Object.hasOwn(rawStorage, 'drawPile')
      || Object.hasOwn(rawStorage, 'discard')
      || Object.hasOwn(rawStorage, 'removed')
    )) {
      migrated[factionId] = migrateLegacyAssignmentStorage(
        rawStorage,
        reservationsByFaction?.[factionId] || []
      );
    } else {
      migrated[factionId] = rawStorage;
    }
  }
  return migrated;
}


function expeditionOccurrenceId(occurrence) {
  return occurrence?.id || occurrence?.expeditionId || occurrence?.cardId || occurrence?.placeId || null;
}

function sameExpeditionOccurrence(left, right) {
  const leftId = expeditionOccurrenceId(left);
  const rightId = expeditionOccurrenceId(right);
  if (!leftId || !rightId || leftId !== rightId) return false;
  if (left?.copy == null || right?.copy == null) return true;
  return Number(left.copy) === Number(right.copy);
}

function containsExpeditionOccurrence(items, occurrence) {
  return Array.isArray(items) && items.some(item => sameExpeditionOccurrence(item, occurrence));
}

function takeExpeditionOccurrence(items, occurrence) {
  if (!Array.isArray(items) || !occurrence) return null;
  const index = items.findIndex(item => sameExpeditionOccurrence(item, occurrence));
  if (index < 0) return null;
  return items.splice(index, 1)[0] || null;
}

function legacyActiveExpeditionOccurrence(active) {
  if (!isRecord(active)) return null;
  if (isRecord(active.card)) return active.card;
  const id = active.cardId || active.expeditionId || null;
  const placeId = active.placeId || null;
  if (!id && !placeId) return null;
  const occurrence = {};
  if (id) occurrence.id = id;
  if (placeId) occurrence.placeId = placeId;
  if (active.copy != null) occurrence.copy = active.copy;
  return occurrence;
}

function migrateLegacyActiveExpedition(active) {
  if (active === undefined || active === null) return active ?? null;
  if (!isRecord(active)) return active;
  const card = isRecord(active.card) ? active.card : null;
  const known = new Set(['card', 'cardId', 'name', 'placeId', 'acceptedRound', 'startedAtTarget', 'departedAfterIssue']);
  const migrated = {};
  for (const [key, value] of Object.entries(active)) {
    if (!known.has(key)) migrated[key] = value;
  }
  const expeditionId = active.expeditionId || active.cardId || card?.id || null;
  const placeId = active.placeId || card?.placeId || null;
  if (expeditionId != null) migrated.expeditionId = expeditionId;
  if (placeId != null) migrated.placeId = placeId;
  if (Object.hasOwn(active, 'acceptedRound')) migrated.acceptedRound = active.acceptedRound;
  if (Object.hasOwn(active, 'startedAtTarget')) migrated.startedAtTarget = active.startedAtTarget;
  if (Object.hasOwn(active, 'departedAfterIssue')) migrated.departedAfterIssue = active.departedAfterIssue;
  return migrated;
}

function migrateLegacyExpeditionCompletion(record) {
  if (!isRecord(record)) return record;
  const migrated = { ...record };
  if (!Object.hasOwn(migrated, 'expeditionId') && Object.hasOwn(migrated, 'cardId')) {
    migrated.expeditionId = migrated.cardId;
  }
  delete migrated.cardId;
  return migrated;
}

function migrateLegacyExpeditionPlayer(player) {
  if (!isRecord(player)) return player;
  const migrated = { ...player };

  if (Object.hasOwn(player, 'activeExpedition')) {
    if (!Object.hasOwn(player, 'activeExpeditionTask')) {
      migrated.activeExpeditionTask = migrateLegacyActiveExpedition(player.activeExpedition);
    }
    delete migrated.activeExpedition;
  } else if (!Object.hasOwn(player, 'activeExpeditionTask')) {
    migrated.activeExpeditionTask = null;
  }

  if (Object.hasOwn(player, 'expeditionHistory')) {
    if (!Object.hasOwn(player, 'expeditionCompletions')) {
      migrated.expeditionCompletions = Array.isArray(player.expeditionHistory)
        ? player.expeditionHistory.map(migrateLegacyExpeditionCompletion)
        : player.expeditionHistory;
    }
    delete migrated.expeditionHistory;
  } else if (!Object.hasOwn(player, 'expeditionCompletions')) {
    migrated.expeditionCompletions = [];
  }

  if (Object.hasOwn(player, 'expeditionDrawRound') || Object.hasOwn(player, 'expeditionsDrawnThisRound')) {
    if (!Object.hasOwn(player, 'expeditionAccessUsage')) {
      migrated.expeditionAccessUsage = {
        round: Object.hasOwn(player, 'expeditionDrawRound') ? player.expeditionDrawRound : null,
        draws: Object.hasOwn(player, 'expeditionsDrawnThisRound') ? player.expeditionsDrawnThisRound : 0,
      };
    }
    delete migrated.expeditionDrawRound;
    delete migrated.expeditionsDrawnThisRound;
  } else if (!Object.hasOwn(player, 'expeditionAccessUsage')) {
    migrated.expeditionAccessUsage = { round: null, draws: 0 };
  }

  return migrated;
}

function migrateLegacyExpeditionPool(rawStorage, players = []) {
  if (!isRecord(rawStorage)) return rawStorage;
  const migrated = {
    ...rawStorage,
    available: Array.isArray(rawStorage.drawPile) ? rawStorage.drawPile : [],
    reserved: Array.isArray(rawStorage.reserved) ? rawStorage.reserved : [],
  };
  delete migrated.drawPile;

  for (const player of players || []) {
    const occurrence = legacyActiveExpeditionOccurrence(player?.activeExpedition);
    if (!occurrence || containsExpeditionOccurrence(migrated.reserved, occurrence)) continue;
    const stored = takeExpeditionOccurrence(migrated.available, occurrence) || occurrence;
    migrated.reserved.push(stored);
  }
  return migrated;
}

function migrateVersion0To1(state) {
  return {
    ...state,
    [DIGITAL_MODEL_SCHEMA_VERSION_FIELD]: INITIAL_DIGITAL_MODEL_SCHEMA_VERSION,
  };
}

function migrateVersion1To2(state) {
  const next = {
    ...state,
    [DIGITAL_MODEL_SCHEMA_VERSION_FIELD]: SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION,
  };
  const existingSources = isRecord(state?.[RANDOM_SOURCE_STATE_FIELD])
    ? state[RANDOM_SOURCE_STATE_FIELD]
    : {};
  const sourceState = { ...existingSources };
  let ownsSourceState = Object.hasOwn(state || {}, RANDOM_SOURCE_STATE_FIELD);

  if (Object.hasOwn(state || {}, 'anchorDecks')) {
    sourceState.seaEncounter = migrateGroupedLegacyCyclicStorage(state.anchorDecks);
    delete next.anchorDecks;
    ownsSourceState = true;
  }

  if (Object.hasOwn(state || {}, 'eventDeck')) {
    sourceState.sailingEvent = migrateLegacyCyclicStorage(state.eventDeck, {
      reservable: true,
      reserved: sailingReservations(state),
    });
    delete next.eventDeck;
    ownsSourceState = true;
  }

  if (Object.hasOwn(state || {}, 'feudDecks')) {
    sourceState.politicalEffect = migrateGroupedLegacyCyclicStorage(
      state.feudDecks,
      politicalReservations(state)
    );
    delete next.feudDecks;
    ownsSourceState = true;
  }

  if (ownsSourceState) next[RANDOM_SOURCE_STATE_FIELD] = sourceState;
  return next;
}

function migrateVersion2To3(state) {
  const next = {
    ...state,
    [DIGITAL_MODEL_SCHEMA_VERSION_FIELD]: ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION,
  };
  const existingSources = isRecord(state?.[RANDOM_SOURCE_STATE_FIELD])
    ? state[RANDOM_SOURCE_STATE_FIELD]
    : {};
  const sourceState = { ...existingSources };
  let ownsSourceState = Object.hasOwn(state || {}, RANDOM_SOURCE_STATE_FIELD);

  if (Object.hasOwn(state || {}, 'assignmentDecks')) {
    sourceState.assignmentPool = migrateLegacyAssignmentPool(
      state.assignmentDecks,
      assignmentReservations(state)
    );
    delete next.assignmentDecks;
    ownsSourceState = true;
  }

  if (ownsSourceState) next[RANDOM_SOURCE_STATE_FIELD] = sourceState;
  return next;
}

function migrateVersion3To4(state) {
  const next = {
    ...state,
    [DIGITAL_MODEL_SCHEMA_VERSION_FIELD]: EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION,
  };
  const existingSources = isRecord(state?.[RANDOM_SOURCE_STATE_FIELD])
    ? state[RANDOM_SOURCE_STATE_FIELD]
    : {};
  const sourceState = { ...existingSources };
  let ownsSourceState = Object.hasOwn(state || {}, RANDOM_SOURCE_STATE_FIELD);

  if (Object.hasOwn(state || {}, 'expeditionDeck')) {
    sourceState.expeditionPool = migrateLegacyExpeditionPool(state.expeditionDeck, state.players || []);
    delete next.expeditionDeck;
    ownsSourceState = true;
  }

  if (Array.isArray(state?.players)) {
    next.players = state.players.map(migrateLegacyExpeditionPlayer);
  }

  if (ownsSourceState) next[RANDOM_SOURCE_STATE_FIELD] = sourceState;
  return next;
}

const MIGRATIONS = new Map([
  [0, { toVersion: INITIAL_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion0To1 }],
  [1, { toVersion: SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion1To2 }],
  [2, { toVersion: ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion2To3 }],
  [3, { toVersion: EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion3To4 }],
]);

function readDigitalModelSchemaVersion(rawRoom) {
  const hasVersion = rawRoom !== null
    && typeof rawRoom === 'object'
    && !Array.isArray(rawRoom)
    && Object.hasOwn(rawRoom, DIGITAL_MODEL_SCHEMA_VERSION_FIELD);
  const version = hasVersion ? rawRoom[DIGITAL_MODEL_SCHEMA_VERSION_FIELD] : 0;

  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Invalid digital model schema version: ${String(version)}`);
  }
  if (version > CURRENT_DIGITAL_MODEL_SCHEMA_VERSION) {
    throw new Error(`Unsupported future digital model schema version: ${version}`);
  }
  return version;
}

function migrateRoomState(rawRoom) {
  const fromVersion = readDigitalModelSchemaVersion(rawRoom);
  let state = cloneState(rawRoom);
  let version = fromVersion;

  while (version < CURRENT_DIGITAL_MODEL_SCHEMA_VERSION) {
    const step = MIGRATIONS.get(version);
    if (!step || step.toVersion !== version + 1) {
      throw new Error(`Missing digital model schema migration from version ${version}`);
    }
    state = step.migrate(state);
    version = step.toVersion;
  }

  return {
    state,
    migrated: fromVersion !== version,
    fromVersion,
    toVersion: version,
  };
}

module.exports = {
  CURRENT_DIGITAL_MODEL_SCHEMA_VERSION,
  SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION,
  ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION,
  EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION,
  RANDOM_SOURCE_STATE_FIELD,
  migrateRoomState,
};
