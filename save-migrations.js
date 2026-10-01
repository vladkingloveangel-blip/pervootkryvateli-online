'use strict';

const DIGITAL_MODEL_SCHEMA_VERSION_FIELD = 'digitalModelSchemaVersion';
const INITIAL_DIGITAL_MODEL_SCHEMA_VERSION = 1;
const SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION = 2;
const ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION = 3;
const EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION = 4;
const PLAYER_TASK_INVENTORY_DIGITAL_MODEL_SCHEMA_VERSION = 5;
const DISCOVERY_EFFECT_DIGITAL_MODEL_SCHEMA_VERSION = 6;
const PENDING_ORCHESTRATION_DIGITAL_MODEL_SCHEMA_VERSION = 7;
const LEGACY_CLEANUP_DIGITAL_MODEL_SCHEMA_VERSION = 8;
const CURRENT_DIGITAL_MODEL_SCHEMA_VERSION = LEGACY_CLEANUP_DIGITAL_MODEL_SCHEMA_VERSION;
const RANDOM_SOURCE_STATE_FIELD = 'randomSourceState';

const {
  ASSIGNMENT_DEFINITIONS,
  CONSUMABLE_ABILITY_DEFINITIONS,
  PLACE_DISCOVERY_DEFINITIONS,
  SAILING_EVENT_DEFINITIONS,
  POLITICAL_EFFECT_DEFINITIONS,
} = require('./game-data');

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


function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assignmentDefinition(factionId, definitionId) {
  const definitions = ASSIGNMENT_DEFINITIONS?.[factionId];
  if (!Array.isArray(definitions)) return null;
  return definitions.find(definition =>
    definition?.id === definitionId || definition?.conditionKey === definitionId
  ) || null;
}

function nonCanonicalData(rawValue, canonicalValue) {
  if (!isRecord(rawValue)) return undefined;
  const extras = {};
  for (const [key, value] of Object.entries(rawValue)) {
    if (canonicalValue && Object.hasOwn(canonicalValue, key) && valuesEqual(value, canonicalValue[key])) continue;
    extras[key] = value;
  }
  return Object.keys(extras).length ? extras : undefined;
}

function migrateLegacyActiveAssignment(active) {
  if (active === undefined || active === null) return active ?? null;
  if (!isRecord(active)) return active;
  const card = isRecord(active.card) ? active.card : {};
  const definitionId = card.id || card.conditionKey || active.definitionId || null;
  const factionId = active.factionId ?? null;
  const canonical = assignmentDefinition(factionId, definitionId);
  const known = new Set(['instanceId', 'factionId', 'card', 'issuedRound', 'progress']);
  const migrated = {};
  for (const [key, value] of Object.entries(active)) {
    if (!known.has(key)) migrated[key] = value;
  }
  if (Object.hasOwn(active, 'instanceId')) migrated.instanceId = active.instanceId;
  if (definitionId != null) migrated.definitionId = definitionId;
  if (Object.hasOwn(active, 'factionId')) migrated.factionId = active.factionId;
  if (Object.hasOwn(active, 'issuedRound')) migrated.issuedRound = active.issuedRound;
  if (Object.hasOwn(active, 'progress')) migrated.progress = active.progress;
  const definitionData = nonCanonicalData(card, canonical);
  if (definitionData) migrated.definitionData = definitionData;
  return migrated;
}

function abilityDefinitionById(abilityId) {
  return (CONSUMABLE_ABILITY_DEFINITIONS || []).find(definition => definition?.id === abilityId) || null;
}

function abilityDefinitionByLegacyName(name) {
  return (CONSUMABLE_ABILITY_DEFINITIONS || []).find(definition => definition?.name === name) || null;
}

function stableLegacyAbilityInstanceId(playerId, origin, index, identity) {
  const owner = String(playerId || 'player').replace(/:/g, '_');
  const value = String(identity || 'unknown').replace(/:/g, '_');
  return `legacy-ability:${owner}:${origin}:${Math.max(0, Number(index) || 0)}:${value}`;
}

function migrateLegacyConsumableAbilities(player) {
  const abilities = [];
  for (const [index, card] of (Array.isArray(player?.legendaryCards) ? player.legendaryCards : []).entries()) {
    if (!isRecord(card)) continue;
    const abilityId = card.id || null;
    const canonical = abilityDefinitionById(abilityId);
    const migrated = {
      instanceId: stableLegacyAbilityInstanceId(player?.id, 'legendary', index, abilityId),
      abilityId,
      origin: { kind: 'legendary', legacyIndex: index },
    };
    const data = nonCanonicalData(card, canonical);
    if (data) migrated.data = data;
    abilities.push(migrated);
  }
  for (const [index, name] of (Array.isArray(player?.specialCards) ? player.specialCards : []).entries()) {
    if (typeof name !== 'string') continue;
    const canonical = abilityDefinitionByLegacyName(name);
    abilities.push({
      instanceId: stableLegacyAbilityInstanceId(player?.id, 'special', index, canonical?.id || name),
      abilityId: canonical?.id || null,
      origin: { kind: 'special', legacyIndex: index, legacyName: name },
    });
  }
  return abilities;
}

function migrateLegacyStoredBenefit(player, benefit, index) {
  if (!isRecord(benefit)) return benefit;
  const known = new Set(['id', 'kind', 'name', 'goodId', 'sourceDeck', 'sourceCard', 'assignmentInstanceId']);
  const migrated = {};
  for (const [key, value] of Object.entries(benefit)) {
    if (!known.has(key)) migrated[key] = value;
  }
  migrated.instanceId = `legacy-benefit:${String(player?.id || 'player').replace(/:/g, '_')}:${Math.max(0, Number(index) || 0)}:${String(benefit.id || benefit.kind || 'benefit').replace(/:/g, '_')}`;
  if (Object.hasOwn(benefit, 'id')) migrated.id = benefit.id;
  if (Object.hasOwn(benefit, 'kind')) migrated.kind = benefit.kind;
  const source = {};
  if (Object.hasOwn(benefit, 'sourceDeck')) source.deck = benefit.sourceDeck;
  if (Object.hasOwn(benefit, 'sourceCard')) source.occurrence = benefit.sourceCard;
  if (Object.keys(source).length) migrated.source = source;
  const payload = {};
  if (Object.hasOwn(benefit, 'name')) payload.name = benefit.name;
  if (Object.hasOwn(benefit, 'goodId')) payload.goodId = benefit.goodId;
  if (Object.hasOwn(benefit, 'assignmentInstanceId')) payload.assignmentInstanceId = benefit.assignmentInstanceId;
  if (Object.keys(payload).length) migrated.payload = payload;
  return migrated;
}

function migrateLegacyPlayerTaskInventory(player) {
  if (!isRecord(player)) return player;
  const migrated = { ...player };

  if (Object.hasOwn(player, 'activeAssignment')) {
    if (!Object.hasOwn(player, 'activeAssignmentTask')) {
      migrated.activeAssignmentTask = migrateLegacyActiveAssignment(player.activeAssignment);
    }
    delete migrated.activeAssignment;
  } else if (!Object.hasOwn(player, 'activeAssignmentTask')) {
    migrated.activeAssignmentTask = null;
  }

  if (Object.hasOwn(player, 'legendaryCards') || Object.hasOwn(player, 'specialCards')) {
    if (!Object.hasOwn(player, 'consumableAbilities')) {
      migrated.consumableAbilities = migrateLegacyConsumableAbilities(player);
    }
    delete migrated.legendaryCards;
    delete migrated.specialCards;
  } else if (!Object.hasOwn(player, 'consumableAbilities')) {
    migrated.consumableAbilities = [];
  }
  if (!Object.hasOwn(player, 'consumableAbilitySequence')) {
    migrated.consumableAbilitySequence = Array.isArray(migrated.consumableAbilities)
      ? migrated.consumableAbilities.length
      : 0;
  }

  if (Object.hasOwn(player, 'savedEventCards')) {
    if (!Object.hasOwn(player, 'storedBenefits')) {
      migrated.storedBenefits = Array.isArray(player.savedEventCards)
        ? player.savedEventCards.map((benefit, index) => migrateLegacyStoredBenefit(player, benefit, index))
        : player.savedEventCards;
    }
    delete migrated.savedEventCards;
  } else if (!Object.hasOwn(player, 'storedBenefits')) {
    migrated.storedBenefits = [];
  }

  return migrated;
}



function canonicalNamedPlaceId(card) {
  if (!isRecord(card)) return null;
  const canonical = (PLACE_DISCOVERY_DEFINITIONS || []).find(definition =>
    definition?.id === card.id || definition?.placeId === card.placeId
  );
  return canonical?.placeId || (typeof card.placeId === 'string' && card.placeId ? card.placeId : null);
}

function discoveryRecord(placeId, ownerId, legacyValue = undefined) {
  const record = {
    placeId: String(placeId),
    ownerId,
    claimedById: ownerId,
    state: 'claimed',
    rewardGranted: true,
  };
  if (isRecord(legacyValue)) {
    const extras = { ...legacyValue };
    delete extras.placeId;
    delete extras.ownerId;
    delete extras.claimedById;
    delete extras.claimedBy;
    delete extras.state;
    delete extras.rewardGranted;
    if (Object.keys(extras).length) record.legacyData = extras;
  }
  return record;
}

function migrateLegacyDiscoveries(state) {
  const records = isRecord(state?.discoveries) ? cloneState(state.discoveries) : {};
  const registry = state?.legendaryPlacesExplored;

  if (isRecord(registry)) {
    for (const [placeId, rawOwner] of Object.entries(registry)) {
      if (Object.hasOwn(records, placeId)) continue;
      const ownerId = isRecord(rawOwner)
        ? (rawOwner.ownerId ?? rawOwner.claimedById ?? rawOwner.claimedBy ?? null)
        : rawOwner;
      if (ownerId === undefined || ownerId === null || String(ownerId) === '') continue;
      records[placeId] = discoveryRecord(placeId, ownerId, rawOwner);
    }
  }

  for (const player of state?.players || []) {
    for (const card of (Array.isArray(player?.namedPlaceCards) ? player.namedPlaceCards : [])) {
      const placeId = canonicalNamedPlaceId(card);
      if (!placeId || Object.hasOwn(records, placeId)) continue;
      if (player?.id === undefined || player?.id === null || String(player.id) === '') continue;
      records[placeId] = discoveryRecord(placeId, player.id);
    }
  }

  return records;
}

function legacyRecordExtras(raw, knownKeys) {
  if (!isRecord(raw)) return undefined;
  const extras = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!knownKeys.has(key)) extras[key] = value;
  }
  return Object.keys(extras).length ? extras : undefined;
}

function persistedEffectRecord({
  kind,
  id,
  ownerId,
  targetType,
  targetId,
  state = 'active',
  source = {},
  duration = {},
  payload = {},
  legacyData,
}) {
  const record = { kind, id, ownerId, targetType, targetId, state, source, duration, payload };
  if (legacyData && Object.keys(legacyData).length) record.legacyData = legacyData;
  return record;
}

function migrateLegacyPlayerEffects(player) {
  const existing = isRecord(player?.temporaryEffects) ? cloneState(player.temporaryEffects) : {};
  let active = Array.isArray(existing.active) ? existing.active : [];
  let scheduled = Array.isArray(existing.scheduled) ? existing.scheduled : [];
  const targetId = player?.id ?? null;

  if (Object.hasOwn(player || {}, 'activeTurnEffects')) {
    active = active.filter(record => !String(record?.kind || '').startsWith('active-turn:'));
    for (const [key, value] of Object.entries(isRecord(player?.activeTurnEffects) ? player.activeTurnEffects : {})) {
      active.push(persistedEffectRecord({
        kind: 'active-turn:' + key,
        id: 'active-turn:' + key,
        ownerId: targetId,
        targetType: 'player',
        targetId,
        source: { backing: 'temporaryEffects.active', key },
        duration: { scope: 'personal-turn' },
        payload: { value },
      }));
    }
  }

  if (Object.hasOwn(player || {}, 'nextTurnEffects')) {
    scheduled = scheduled.filter(record => !String(record?.kind || '').startsWith('active-turn:'));
    for (const [key, value] of Object.entries(isRecord(player?.nextTurnEffects) ? player.nextTurnEffects : {})) {
      scheduled.push(persistedEffectRecord({
        kind: 'active-turn:' + key,
        id: 'next-turn:' + key,
        ownerId: targetId,
        targetType: 'player',
        targetId,
        state: 'scheduled',
        source: { backing: 'temporaryEffects.scheduled', key, legacyBacking: 'nextTurnEffects' },
        duration: { activation: 'next-personal-turn' },
        payload: { value },
      }));
    }
  }

  if (Object.hasOwn(player || {}, 'legendaryEffects')) {
    active = active.filter(record => !['ship-veil', 'sea-curse', 'ship-veil-reaction'].includes(record?.kind));
    const legendary = isRecord(player?.legendaryEffects) ? player.legendaryEffects : {};
    if (isRecord(legendary.shipVeil)) {
      active.push(persistedEffectRecord({
        kind: 'ship-veil',
        id: 'ship-veil',
        ownerId: targetId,
        targetType: 'player',
        targetId,
        source: {
          backing: 'temporaryEffects.active',
          sourcePlayerId: legendary.shipVeil.sourcePlayerId ?? null,
        },
        duration: {
          remaining: legendary.shipVeil.remaining,
          ignoreTurnNo: Object.hasOwn(legendary.shipVeil, 'ignoreTurnNo') ? legendary.shipVeil.ignoreTurnNo : null,
        },
        payload: {},
        legacyData: legacyRecordExtras(legendary.shipVeil, new Set(['remaining', 'sourcePlayerId', 'ignoreTurnNo'])),
      }));
    }
    for (const [index, curse] of (Array.isArray(legendary.seaCurses) ? legendary.seaCurses : []).entries()) {
      if (!isRecord(curse)) continue;
      active.push(persistedEffectRecord({
        kind: 'sea-curse',
        id: 'sea-curse:' + index,
        ownerId: targetId,
        targetType: 'player',
        targetId,
        source: {
          backing: 'temporaryEffects.active',
          sourcePlayerId: Object.hasOwn(curse, 'sourcePlayerId') ? curse.sourcePlayerId : null,
        },
        duration: { remaining: curse.remaining },
        payload: Object.hasOwn(curse, 'penalty') ? { penalty: curse.penalty } : {},
        legacyData: legacyRecordExtras(curse, new Set(['remaining', 'penalty', 'sourcePlayerId'])),
      }));
    }
    if (isRecord(legendary.shipVeilReaction)) {
      active.push(persistedEffectRecord({
        kind: 'ship-veil-reaction',
        id: 'ship-veil-reaction',
        ownerId: targetId,
        targetType: 'player',
        targetId,
        source: { backing: 'temporaryEffects.active' },
        duration: {
          expiry: legendary.shipVeilReaction.expiry,
          expiresOnPlayerId: legendary.shipVeilReaction.expiresOnPlayerId,
        },
        payload: {},
        legacyData: legacyRecordExtras(legendary.shipVeilReaction, new Set(['expiry', 'expiresOnPlayerId'])),
      }));
    }
    const compatibility = isRecord(existing.compatibility) ? cloneState(existing.compatibility) : {};
    const legendaryExtras = legacyRecordExtras(legendary, new Set(['shipVeil', 'seaCurses', 'shipVeilReaction']));
    if (legendaryExtras) compatibility.legendaryEffects = legendaryExtras;
    if (Object.keys(compatibility).length) existing.compatibility = compatibility;
  }

  return { ...existing, active, scheduled };
}

function migrateLegacyIslandEffects(island) {
  const existing = isRecord(island?.temporaryEffects) ? cloneState(island.temporaryEffects) : {};
  let active = Array.isArray(existing.active) ? existing.active : [];
  const targetId = island?.id ?? null;

  if (Object.hasOwn(island || {}, 'legendaryVeil')) {
    active = active.filter(record => record?.kind !== 'island-veil');
    if (isRecord(island.legendaryVeil)) {
      active.push(persistedEffectRecord({
        kind: 'island-veil',
        id: 'island-veil',
        ownerId: island?.ownerId ?? null,
        targetType: 'island',
        targetId,
        source: {
          backing: 'temporaryEffects.active',
          sourcePlayerId: island.legendaryVeil.sourcePlayerId ?? null,
        },
        duration: {
          remaining: island.legendaryVeil.remaining,
          ignoreTurnNo: Object.hasOwn(island.legendaryVeil, 'ignoreTurnNo') ? island.legendaryVeil.ignoreTurnNo : null,
        },
        payload: {},
        legacyData: legacyRecordExtras(island.legendaryVeil, new Set(['remaining', 'sourcePlayerId', 'ignoreTurnNo'])),
      }));
    }
  }

  if (Object.hasOwn(island || {}, 'legendaryVeilReaction')) {
    active = active.filter(record => record?.kind !== 'island-veil-reaction');
    if (isRecord(island.legendaryVeilReaction)) {
      active.push(persistedEffectRecord({
        kind: 'island-veil-reaction',
        id: 'island-veil-reaction',
        ownerId: island?.ownerId ?? null,
        targetType: 'island',
        targetId,
        source: {
          backing: 'temporaryEffects.active',
          sourcePlayerId: island.legendaryVeilReaction.sourcePlayerId ?? null,
        },
        duration: {
          expiry: island.legendaryVeilReaction.expiry,
          expiresOnPlayerId: island.legendaryVeilReaction.expiresOnPlayerId,
        },
        payload: {},
        legacyData: legacyRecordExtras(island.legendaryVeilReaction, new Set(['expiry', 'sourcePlayerId', 'expiresOnPlayerId'])),
      }));
    }
  }

  return { ...existing, active };
}

function migrateLegacyDiscoveryEffectPlayer(player) {
  if (!isRecord(player)) return player;
  const migrated = { ...player, temporaryEffects: migrateLegacyPlayerEffects(player) };
  delete migrated.namedPlaceCards;
  delete migrated.activeTurnEffects;
  delete migrated.nextTurnEffects;
  delete migrated.legendaryEffects;
  return migrated;
}

function migrateLegacyDiscoveryEffectIsland(island) {
  if (!isRecord(island)) return island;
  const migrated = { ...island, temporaryEffects: migrateLegacyIslandEffects(island) };
  delete migrated.legendaryVeil;
  delete migrated.legendaryVeilReaction;
  return migrated;
}



const PENDING_RESOLUTION_MIGRATION_FAMILIES = Object.freeze({
  event: Object.freeze({ field: 'pendingEvent', actorField: 'playerId' }),
  feud: Object.freeze({ field: 'pendingFeud', actorField: 'playerId' }),
  'assignment-choice': Object.freeze({ field: 'pendingAssignmentChoice', actorField: 'playerId' }),
  'legendary-reaction': Object.freeze({ field: 'pendingLegendaryReaction', actorField: 'targetPlayerId' }),
});

const PRE_TURN_LEGACY_ROOT_FIELDS = new Set([
  'active', 'personalTurn', 'turnPlayerId', 'currentPlayerId', 'politicalSnapshot', 'lastCard', 'taxResult',
  'stage', 'playerIndex', 'feudIndex', 'assignmentIndex', 'replacementIndex',
  'feudQueue', 'assignmentQueue', 'replacementQueue', 'observatoryReplacementsUsed',
]);

function migrateLegacyPendingResolution(family, legacy) {
  if (legacy === undefined || legacy === null) return legacy;
  if (!isRecord(legacy)) return undefined;
  const config = PENDING_RESOLUTION_MIGRATION_FAMILIES[family];
  const payload = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (key === 'id' || key === 'kind' || key === config.actorField || key === 'options') continue;
    payload[key] = cloneState(value);
  }
  const record = {
    family,
    state: 'pending',
    source: { backing: 'pendingResolutions', legacyField: config.field },
    payload,
  };
  if (Object.hasOwn(legacy, 'id')) record.id = cloneState(legacy.id);
  if (Object.hasOwn(legacy, 'kind')) record.kind = cloneState(legacy.kind);
  if (Object.hasOwn(legacy, config.actorField)) {
    record.actorPlayerId = cloneState(legacy[config.actorField]);
    record.actorId = cloneState(legacy[config.actorField]);
  }
  if (Object.hasOwn(legacy, 'options')) record.options = cloneState(legacy.options);
  return record;
}

function migrateLegacyPreTurnResolutionFlow(legacy) {
  if (legacy === undefined || legacy === null) return legacy;
  if (!isRecord(legacy)) return undefined;
  const flow = {};
  for (const key of ['active', 'personalTurn', 'turnPlayerId', 'currentPlayerId', 'politicalSnapshot', 'lastCard', 'taxResult']) {
    if (Object.hasOwn(legacy, key)) flow[key] = cloneState(legacy[key]);
  }
  if (Object.hasOwn(legacy, 'stage')) flow.stage = legacy.stage === 'feud' ? 'political' : cloneState(legacy.stage);

  const indexes = {};
  if (Object.hasOwn(legacy, 'playerIndex')) indexes.sailing = cloneState(legacy.playerIndex);
  if (Object.hasOwn(legacy, 'feudIndex')) indexes.political = cloneState(legacy.feudIndex);
  if (Object.hasOwn(legacy, 'assignmentIndex')) indexes.assignment = cloneState(legacy.assignmentIndex);
  if (Object.hasOwn(legacy, 'replacementIndex')) indexes.replacement = cloneState(legacy.replacementIndex);
  if (Object.keys(indexes).length) flow.indexes = indexes;

  const queues = {};
  if (Object.hasOwn(legacy, 'feudQueue')) queues.political = cloneState(legacy.feudQueue);
  if (Object.hasOwn(legacy, 'assignmentQueue')) queues.assignment = cloneState(legacy.assignmentQueue);
  if (Object.hasOwn(legacy, 'replacementQueue')) queues.replacement = cloneState(legacy.replacementQueue);
  if (Object.keys(queues).length) flow.queues = queues;

  if (Object.hasOwn(legacy, 'observatoryReplacementsUsed')) {
    flow.counters = { observatoryReplacementsUsed: cloneState(legacy.observatoryReplacementsUsed) };
  }

  const legacyData = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (!PRE_TURN_LEGACY_ROOT_FIELDS.has(key)) legacyData[key] = cloneState(value);
  }
  if (Object.keys(legacyData).length) flow.legacyData = legacyData;
  return flow;
}

function migrateVersion6To7(state) {
  const next = {
    ...state,
    [DIGITAL_MODEL_SCHEMA_VERSION_FIELD]: PENDING_ORCHESTRATION_DIGITAL_MODEL_SCHEMA_VERSION,
  };

  const pendingResolutions = isRecord(state?.pendingResolutions) ? cloneState(state.pendingResolutions) : {};
  let ownsPendingResolutions = Object.hasOwn(state || {}, 'pendingResolutions');
  for (const [family, config] of Object.entries(PENDING_RESOLUTION_MIGRATION_FAMILIES)) {
    if (!Object.hasOwn(state || {}, config.field)) continue;
    const legacy = state[config.field];
    const converted = migrateLegacyPendingResolution(family, legacy);
    if (converted === undefined && legacy !== undefined) continue;
    pendingResolutions[family] = converted;
    delete next[config.field];
    ownsPendingResolutions = true;
  }
  if (ownsPendingResolutions) next.pendingResolutions = pendingResolutions;

  if (Object.hasOwn(state || {}, 'pendingExpeditionRewards') && Array.isArray(state.pendingExpeditionRewards)) {
    const existingQueue = isRecord(state.resolutionQueue) ? cloneState(state.resolutionQueue) : {};
    next.resolutionQueue = {
      ...existingQueue,
      kind: 'resolution-queue',
      items: cloneState(state.pendingExpeditionRewards),
    };
    delete next.pendingExpeditionRewards;
  }

  if (Object.hasOwn(state || {}, 'eventPhase')) {
    const convertedFlow = migrateLegacyPreTurnResolutionFlow(state.eventPhase);
    if (convertedFlow !== undefined || state.eventPhase === undefined) {
      const existingFlow = isRecord(state.preTurnResolutionFlow) ? cloneState(state.preTurnResolutionFlow) : {};
      next.preTurnResolutionFlow = convertedFlow && isRecord(convertedFlow)
        ? { ...existingFlow, ...convertedFlow }
        : convertedFlow;
      delete next.eventPhase;
    }
  }

  return next;
}


const RETIRED_EXPEDITION_IDS = new Set(['expedition-atlantia', 'expedition-adia', 'expedition-skull']);
const RETIRED_EXPEDITION_PLACE_IDS = new Set(['atlantia', 'adia', 'skull']);

function retiredExpeditionEntry(value) {
  if (!isRecord(value)) return false;
  const ids = [value.id, value.expeditionId, value.cardId].filter(id => id != null).map(String);
  const places = [value.placeId].filter(id => id != null).map(String);
  return ids.some(id => RETIRED_EXPEDITION_IDS.has(id))
    || places.some(placeId => RETIRED_EXPEDITION_PLACE_IDS.has(placeId));
}

function stripKnownMasterCardId(occurrence, definitions) {
  if (!isRecord(occurrence) || !Object.hasOwn(occurrence, 'masterCardId')) return occurrence;
  const masterCardId = occurrence.masterCardId;
  const canonical = (definitions || []).find(definition => definition?.id === masterCardId);
  if (!canonical) return occurrence;
  const cleaned = { ...occurrence, id: canonical.id };
  delete cleaned.masterCardId;
  return cleaned;
}

function cleanupPendingResolutions(rawPending) {
  if (!isRecord(rawPending)) return rawPending;
  const pending = cloneState(rawPending);

  const event = pending.event;
  if (isRecord(event?.payload) && isRecord(event.payload.eventCard)) {
    event.payload.eventCard = stripKnownMasterCardId(event.payload.eventCard, SAILING_EVENT_DEFINITIONS);
  }

  const feud = pending.feud;
  if (isRecord(feud?.payload) && isRecord(feud.payload.feudCard)) {
    const factionId = feud.payload.factionId;
    feud.payload.feudCard = stripKnownMasterCardId(
      feud.payload.feudCard,
      POLITICAL_EFFECT_DEFINITIONS?.[factionId] || []
    );
  }

  const assignmentChoice = pending['assignment-choice'];
  if (assignmentChoice && assignmentChoice.kind !== 'embassy') {
    pending['assignment-choice'] = null;
  }

  const legendaryReaction = pending['legendary-reaction'];
  if (isRecord(legendaryReaction?.payload) && Object.hasOwn(legendaryReaction.payload, 'captureMode')) {
    delete legendaryReaction.payload.captureMode;
  }

  return pending;
}

function cleanupStoredBenefits(rawBenefits) {
  if (!Array.isArray(rawBenefits)) return rawBenefits;
  return rawBenefits.map(benefit => {
    if (!isRecord(benefit)) return benefit;
    const cleaned = cloneState(benefit);
    if (cleaned.source?.deck === 'event' && isRecord(cleaned.source.occurrence)) {
      cleaned.source.occurrence = stripKnownMasterCardId(
        cleaned.source.occurrence,
        SAILING_EVENT_DEFINITIONS
      );
    }
    return cleaned;
  });
}

function cleanupPreTurnResolutionFlow(rawFlow) {
  if (!isRecord(rawFlow)) return rawFlow;
  const flow = cloneState(rawFlow);
  const retiredAssignmentReplace = flow.stage === 'assignment-replace';

  if (retiredAssignmentReplace) {
    flow.stage = 'assignment';
    flow.queues = isRecord(flow.queues) ? flow.queues : {};
    flow.indexes = isRecord(flow.indexes) ? flow.indexes : {};
    if (!Array.isArray(flow.queues.assignment)) flow.queues.assignment = [];
    flow.indexes.assignment = flow.queues.assignment.length;
    if (flow.active) flow.migrationResumeEventPhase = true;
  }

  if (isRecord(flow.queues)) delete flow.queues.replacement;
  if (isRecord(flow.indexes)) delete flow.indexes.replacement;
  return flow;
}

function cleanupExpeditionPool(rawPool) {
  if (!isRecord(rawPool)) return rawPool;
  const pool = cloneState(rawPool);
  for (const key of ['available', 'reserved']) {
    if (Array.isArray(pool[key])) pool[key] = pool[key].filter(entry => !retiredExpeditionEntry(entry));
  }
  return pool;
}

function cleanupLegacyPlayerState(player) {
  if (!isRecord(player)) return player;
  const migrated = { ...player };

  // Globally retired assignment-replacement bookkeeping has no target meaning.
  delete migrated.replacedAssignmentConditions;

  if (Object.hasOwn(player, 'activeAssignmentTask')) delete migrated.activeAssignment;

  if (Object.hasOwn(player, 'consumableAbilities')) {
    delete migrated.legendaryCards;
    delete migrated.specialCards;
    if (Object.hasOwn(player, 'pendingLegendary')) {
      const pendingCount = Math.max(0, Math.floor(Number(player.pendingLegendary) || 0));
      if (!Object.hasOwn(player, 'pendingConsumableAbilityGrants') && pendingCount > 0) {
        migrated.pendingConsumableAbilityGrants = pendingCount;
      }
      delete migrated.pendingLegendary;
    }
  }

  if (Object.hasOwn(player, 'storedBenefits')) {
    migrated.storedBenefits = cleanupStoredBenefits(player.storedBenefits);
    delete migrated.savedEventCards;
  }

  if (Object.hasOwn(player, 'activeExpeditionTask')) {
    migrated.activeExpeditionTask = retiredExpeditionEntry(player.activeExpeditionTask)
      ? null
      : cloneState(player.activeExpeditionTask);
    delete migrated.activeExpedition;
  }

  if (Object.hasOwn(player, 'expeditionCompletions')) {
    migrated.expeditionCompletions = Array.isArray(player.expeditionCompletions)
      ? player.expeditionCompletions.filter(entry => !retiredExpeditionEntry(entry)).map(cloneState)
      : player.expeditionCompletions;
    delete migrated.expeditionHistory;
  }

  if (Object.hasOwn(player, 'expeditionAccessUsage')) {
    delete migrated.expeditionDrawRound;
    delete migrated.expeditionsDrawnThisRound;
  }

  if (Object.hasOwn(player, 'temporaryEffects')) {
    delete migrated.activeTurnEffects;
    delete migrated.nextTurnEffects;
    delete migrated.legendaryEffects;
  }

  return migrated;
}

function migrateVersion7To8(state) {
  const next = {
    ...state,
    [DIGITAL_MODEL_SCHEMA_VERSION_FIELD]: LEGACY_CLEANUP_DIGITAL_MODEL_SCHEMA_VERSION,
  };

  // These physical decks are fully retired. Digital selectors never read them.
  delete next.treasureDeck;
  delete next.legendaryDeck;
  delete next.pendingStatePrize;

  if (isRecord(state.pendingBattle) && Object.hasOwn(state.pendingBattle, 'captureMode')) {
    next.pendingBattle = cloneState(state.pendingBattle);
    delete next.pendingBattle.captureMode;
  }

  if (isRecord(state[RANDOM_SOURCE_STATE_FIELD])) {
    const sources = { ...state[RANDOM_SOURCE_STATE_FIELD] };
    if (Object.hasOwn(sources, 'seaEncounter')) delete next.anchorDecks;
    if (Object.hasOwn(sources, 'sailingEvent')) delete next.eventDeck;
    if (Object.hasOwn(sources, 'politicalEffect')) delete next.feudDecks;
    if (Object.hasOwn(sources, 'assignmentPool')) delete next.assignmentDecks;
    if (Object.hasOwn(sources, 'expeditionPool')) {
      sources.expeditionPool = cleanupExpeditionPool(sources.expeditionPool);
      delete next.expeditionDeck;
    }
    next[RANDOM_SOURCE_STATE_FIELD] = sources;
  }

  if (Object.hasOwn(state, 'pendingResolutions')) {
    next.pendingResolutions = cleanupPendingResolutions(state.pendingResolutions);
    for (const config of Object.values(PENDING_RESOLUTION_MIGRATION_FAMILIES)) delete next[config.field];
  }

  if (Object.hasOwn(state, 'resolutionQueue')) delete next.pendingExpeditionRewards;

  if (Object.hasOwn(state, 'preTurnResolutionFlow')) {
    next.preTurnResolutionFlow = cleanupPreTurnResolutionFlow(state.preTurnResolutionFlow);
    delete next.eventPhase;
  }

  if (Object.hasOwn(state, 'discoveries')) delete next.legendaryPlacesExplored;

  if (Array.isArray(state.players)) {
    next.players = state.players.map(player => {
      const migrated = cleanupLegacyPlayerState(player);
      if (Object.hasOwn(state, 'discoveries')) delete migrated.namedPlaceCards;
      return migrated;
    });
  }

  if (Array.isArray(state.islands)) {
    next.islands = state.islands.map(island => {
      if (!isRecord(island)) return island;
      const migrated = { ...island };
      if (Object.hasOwn(island, 'temporaryEffects')) {
        delete migrated.legendaryVeil;
        delete migrated.legendaryVeilReaction;
      }
      return migrated;
    });
  }

  return next;
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

function migrateVersion4To5(state) {
  const next = {
    ...state,
    [DIGITAL_MODEL_SCHEMA_VERSION_FIELD]: PLAYER_TASK_INVENTORY_DIGITAL_MODEL_SCHEMA_VERSION,
  };
  if (Array.isArray(state?.players)) {
    next.players = state.players.map(migrateLegacyPlayerTaskInventory);
  }
  return next;
}

function migrateVersion5To6(state) {
  const next = {
    ...state,
    [DIGITAL_MODEL_SCHEMA_VERSION_FIELD]: DISCOVERY_EFFECT_DIGITAL_MODEL_SCHEMA_VERSION,
    discoveries: migrateLegacyDiscoveries(state),
  };
  delete next.legendaryPlacesExplored;
  if (Array.isArray(state?.players)) next.players = state.players.map(migrateLegacyDiscoveryEffectPlayer);
  if (Array.isArray(state?.islands)) next.islands = state.islands.map(migrateLegacyDiscoveryEffectIsland);
  return next;
}

const MIGRATIONS = new Map([
  [0, { toVersion: INITIAL_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion0To1 }],
  [1, { toVersion: SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion1To2 }],
  [2, { toVersion: ASSIGNMENT_POOL_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion2To3 }],
  [3, { toVersion: EXPEDITION_POOL_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion3To4 }],
  [4, { toVersion: PLAYER_TASK_INVENTORY_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion4To5 }],
  [5, { toVersion: DISCOVERY_EFFECT_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion5To6 }],
  [6, { toVersion: PENDING_ORCHESTRATION_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion6To7 }],
  [7, { toVersion: LEGACY_CLEANUP_DIGITAL_MODEL_SCHEMA_VERSION, migrate: migrateVersion7To8 }],
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
  PLAYER_TASK_INVENTORY_DIGITAL_MODEL_SCHEMA_VERSION,
  DISCOVERY_EFFECT_DIGITAL_MODEL_SCHEMA_VERSION,
  PENDING_ORCHESTRATION_DIGITAL_MODEL_SCHEMA_VERSION,
  LEGACY_CLEANUP_DIGITAL_MODEL_SCHEMA_VERSION,
  RANDOM_SOURCE_STATE_FIELD,
  migrateRoomState,
};
