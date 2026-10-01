'use strict';

const DIGITAL_MODEL_SCHEMA_VERSION_FIELD = 'digitalModelSchemaVersion';
const INITIAL_DIGITAL_MODEL_SCHEMA_VERSION = 1;
const SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION = 2;
const CURRENT_DIGITAL_MODEL_SCHEMA_VERSION = SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION;
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

const MIGRATIONS = new Map([
  [0, { toVersion: INITIAL_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion0To1 }],
  [1, { toVersion: SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion1To2 }],
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
  RANDOM_SOURCE_STATE_FIELD,
  migrateRoomState,
};
