'use strict';

const { ASSIGNMENT_DEFINITIONS, EXPEDITION_DEFINITIONS, CONSUMABLE_ABILITY_DEFINITIONS } = require('./game-data');

const DOMAIN_KIND = Symbol('domain-state.kind');
const LEGACY_SNAPSHOT = Symbol('domain-state.legacy-snapshot');
const ABSENT = Symbol('domain-state.absent');

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function cloneDetached(value) {
  if (Array.isArray(value)) return value.map(cloneDetached);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) out[key] = cloneDetached(nested);
  return out;
}

function presenceOf(target, key) {
  if (!target || typeof target !== 'object' || !hasOwn(target, key)) return 'absent';
  const value = target[key];
  if (value === null) return 'null';
  if (Array.isArray(value) && value.length === 0) return 'empty-array';
  return 'value';
}

function defineContract(name, fields) {
  const allowed = Object.freeze([...fields]);

  function view(value) {
    if (value === undefined || value === null) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${name}.view expects a legacy record, null, or undefined.`);
    }
    const raw = cloneDetached(value);
    const out = {};
    for (const field of allowed) {
      if (hasOwn(raw, field)) out[field] = cloneDetached(raw[field]);
    }
    Object.defineProperties(out, {
      [DOMAIN_KIND]: { value: name, enumerable: false },
      [LEGACY_SNAPSHOT]: { value: raw, enumerable: false },
    });
    return out;
  }

  function list(values) {
    if (values === undefined || values === null) return values;
    if (!Array.isArray(values)) throw new TypeError(`${name}.list expects an array, null, or undefined.`);
    return values.map(view);
  }

  function is(value) {
    return Boolean(value && typeof value === 'object' && value[DOMAIN_KIND] === name);
  }

  function toLegacy(value, fallback) {
    if (value === undefined || value === null) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${name}.toLegacy expects a domain record, null, or undefined.`);
    }
    const snapshot = value[LEGACY_SNAPSHOT];
    const base = snapshot && typeof snapshot === 'object'
      ? cloneDetached(snapshot)
      : fallback && typeof fallback === 'object' && !Array.isArray(fallback)
        ? cloneDetached(fallback)
        : {};
    for (const field of allowed) {
      if (hasOwn(value, field)) base[field] = cloneDetached(value[field]);
    }
    return base;
  }

  function listToLegacy(values, fallback = []) {
    if (values === undefined || values === null) return values;
    if (!Array.isArray(values)) throw new TypeError(`${name}.listToLegacy expects an array, null, or undefined.`);
    const previous = Array.isArray(fallback) ? fallback : [];
    return values.map((value, index) => toLegacy(value, previous[index]));
  }

  return Object.freeze({ name, fields: allowed, view, list, is, toLegacy, listToLegacy });
}

const Task = defineContract('Task', ['kind', 'id', 'ownerId', 'state', 'source', 'payload', 'progress']);
const ConsumableAbility = defineContract('ConsumableAbility', ['kind', 'id', 'instanceId', 'abilityId', 'ownerId', 'source', 'payload']);
const StoredBenefit = defineContract('StoredBenefit', ['kind', 'id', 'instanceId', 'ownerId', 'state', 'source', 'payload']);
const Discovery = defineContract('Discovery', ['kind', 'id', 'ownerId', 'state', 'source', 'payload', 'claimedById']);
const TemporaryEffect = defineContract('TemporaryEffect', ['kind', 'id', 'ownerId', 'targetType', 'targetId', 'state', 'source', 'payload', 'duration']);
const PendingResolution = defineContract('PendingResolution', ['family', 'kind', 'id', 'actorId', 'actorPlayerId', 'state', 'source', 'payload', 'options']);
const HistoryRecord = defineContract('HistoryRecord', ['kind', 'id', 'ownerId', 'state', 'source', 'payload', 'completedAt']);

const ACTIVE_ASSIGNMENT_LEGACY_SNAPSHOT = Symbol('domain-state.active-assignment-legacy-snapshot');
const ACTIVE_ASSIGNMENT_PERSISTED_SNAPSHOT = Symbol('domain-state.active-assignment-persisted-snapshot');

function assignmentDefinition(factionId, definitionId) {
  const definitions = ASSIGNMENT_DEFINITIONS?.[factionId];
  if (!Array.isArray(definitions)) return null;
  return definitions.find(definition =>
    definition?.id === definitionId || definition?.conditionKey === definitionId
  ) || null;
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nonCanonicalObjectData(rawValue, canonicalValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return undefined;
  const extras = {};
  for (const [key, value] of Object.entries(rawValue)) {
    if (canonicalValue && hasOwn(canonicalValue, key) && valuesEqual(value, canonicalValue[key])) continue;
    extras[key] = cloneDetached(value);
  }
  return Object.keys(extras).length ? extras : undefined;
}

function activeAssignmentTaskFromLegacy(player, legacyAssignment) {
  if (legacyAssignment === undefined || legacyAssignment === null) return legacyAssignment;
  if (!legacyAssignment || typeof legacyAssignment !== 'object' || Array.isArray(legacyAssignment)) {
    throw new TypeError('ActiveAssignmentTask expects a legacy assignment record, null, or undefined.');
  }
  const semantic = {
    kind: 'assignment',
    ownerId: player?.id,
    state: 'active',
    source: {},
  };
  if (hasOwn(legacyAssignment, 'instanceId')) semantic.id = cloneDetached(legacyAssignment.instanceId);
  if (hasOwn(legacyAssignment, 'factionId')) semantic.source.factionId = cloneDetached(legacyAssignment.factionId);
  if (hasOwn(legacyAssignment, 'issuedRound')) semantic.source.issuedRound = cloneDetached(legacyAssignment.issuedRound);
  if (hasOwn(legacyAssignment, 'card')) semantic.payload = cloneDetached(legacyAssignment.card);
  if (hasOwn(legacyAssignment, 'progress')) semantic.progress = cloneDetached(legacyAssignment.progress);
  const task = Task.view(semantic);
  Object.defineProperty(task, ACTIVE_ASSIGNMENT_LEGACY_SNAPSHOT, {
    value: cloneDetached(legacyAssignment),
    enumerable: false,
  });
  return task;
}

function activeAssignmentTaskFromPersisted(player, persistedTask) {
  if (persistedTask === undefined || persistedTask === null) return persistedTask;
  if (!persistedTask || typeof persistedTask !== 'object' || Array.isArray(persistedTask)) {
    throw new TypeError('ActiveAssignmentTask expects a persisted assignment record, null, or undefined.');
  }
  const factionId = persistedTask.factionId;
  const definitionId = persistedTask.definitionId;
  const definition = assignmentDefinition(factionId, definitionId);
  const payload = definition
    ? { ...cloneDetached(definition), ...(persistedTask.definitionData ? cloneDetached(persistedTask.definitionData) : {}) }
    : (persistedTask.definitionData ? cloneDetached(persistedTask.definitionData) : undefined);
  const semantic = {
    kind: 'assignment',
    ownerId: player?.id,
    state: 'active',
    source: {},
  };
  if (hasOwn(persistedTask, 'instanceId')) semantic.id = cloneDetached(persistedTask.instanceId);
  if (hasOwn(persistedTask, 'factionId')) semantic.source.factionId = cloneDetached(persistedTask.factionId);
  if (hasOwn(persistedTask, 'issuedRound')) semantic.source.issuedRound = cloneDetached(persistedTask.issuedRound);
  if (payload !== undefined) semantic.payload = payload;
  if (hasOwn(persistedTask, 'progress')) semantic.progress = cloneDetached(persistedTask.progress);
  const task = Task.view(semantic);
  Object.defineProperty(task, ACTIVE_ASSIGNMENT_PERSISTED_SNAPSHOT, {
    value: cloneDetached(persistedTask),
    enumerable: false,
  });
  return task;
}

function getActiveAssignmentTask(player) {
  if (!player || typeof player !== 'object') return undefined;
  if (hasOwn(player, 'activeAssignmentTask')) {
    return activeAssignmentTaskFromPersisted(player, player.activeAssignmentTask);
  }
  if (!hasOwn(player, 'activeAssignment')) return undefined;
  return activeAssignmentTaskFromLegacy(player, player.activeAssignment);
}

function activeAssignmentTaskToLegacy(task) {
  if (task === undefined || task === null) return task;
  if (!Task.is(task) || task.kind !== 'assignment' || task.state !== 'active') {
    throw new TypeError('assignTask expects an active assignment Task.');
  }
  const legacySnapshot = task[ACTIVE_ASSIGNMENT_LEGACY_SNAPSHOT];
  const persistedSnapshot = task[ACTIVE_ASSIGNMENT_PERSISTED_SNAPSHOT];
  let legacy = legacySnapshot && typeof legacySnapshot === 'object'
    ? cloneDetached(legacySnapshot)
    : {};
  if (!legacySnapshot && persistedSnapshot && typeof persistedSnapshot === 'object') {
    const targetKeys = new Set(['instanceId', 'definitionId', 'factionId', 'issuedRound', 'progress', 'definitionData']);
    legacy = {};
    for (const [key, value] of Object.entries(persistedSnapshot)) {
      if (!targetKeys.has(key)) legacy[key] = cloneDetached(value);
    }
  }
  if (hasOwn(task, 'id')) legacy.instanceId = cloneDetached(task.id);
  else delete legacy.instanceId;
  const source = task.source && typeof task.source === 'object' ? task.source : {};
  if (hasOwn(source, 'factionId')) legacy.factionId = cloneDetached(source.factionId);
  else delete legacy.factionId;
  if (hasOwn(task, 'payload')) legacy.card = cloneDetached(task.payload);
  else delete legacy.card;
  if (hasOwn(source, 'issuedRound')) legacy.issuedRound = cloneDetached(source.issuedRound);
  else delete legacy.issuedRound;
  if (hasOwn(task, 'progress')) legacy.progress = cloneDetached(task.progress);
  else delete legacy.progress;
  return legacy;
}

function activeAssignmentTaskToPersisted(task) {
  if (task === undefined || task === null) return task;
  if (!Task.is(task) || task.kind !== 'assignment' || task.state !== 'active') {
    throw new TypeError('assignTask expects an active assignment Task.');
  }
  const snapshot = task[ACTIVE_ASSIGNMENT_PERSISTED_SNAPSHOT];
  const persisted = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? cloneDetached(snapshot)
    : {};
  const source = task.source && typeof task.source === 'object' ? task.source : {};
  const definitionId = task.payload?.id || task.payload?.conditionKey || persisted.definitionId;
  const factionId = source.factionId ?? persisted.factionId;
  const canonical = assignmentDefinition(factionId, definitionId);
  if (hasOwn(task, 'id')) persisted.instanceId = cloneDetached(task.id);
  else delete persisted.instanceId;
  if (definitionId != null) persisted.definitionId = cloneDetached(definitionId);
  else delete persisted.definitionId;
  if (factionId != null) persisted.factionId = cloneDetached(factionId);
  else delete persisted.factionId;
  if (hasOwn(source, 'issuedRound')) persisted.issuedRound = cloneDetached(source.issuedRound);
  else delete persisted.issuedRound;
  if (hasOwn(task, 'progress')) persisted.progress = cloneDetached(task.progress);
  else delete persisted.progress;
  const definitionData = nonCanonicalObjectData(task.payload, canonical);
  if (definitionData) persisted.definitionData = definitionData;
  else delete persisted.definitionData;
  delete persisted.card;
  return persisted;
}

function assignTask(player, task) {
  if (!player || typeof player !== 'object') throw new TypeError('assignTask requires a player object.');
  if (!Task.is(task) || task.kind !== 'assignment' || task.state !== 'active') {
    throw new TypeError('assignTask expects an active assignment Task.');
  }
  if (task.ownerId != null && player.id != null && String(task.ownerId) !== String(player.id)) {
    throw new TypeError('Assignment Task ownerId does not match the target player.');
  }
  if (hasOwn(player, 'activeAssignmentTask')) {
    player.activeAssignmentTask = activeAssignmentTaskToPersisted(task);
    return activeAssignmentTaskToLegacy(task);
  }
  player.activeAssignment = activeAssignmentTaskToLegacy(task);
  return player.activeAssignment;
}

function completeAssignmentTask(player) {
  if (!player || typeof player !== 'object') throw new TypeError('completeAssignmentTask requires a player object.');
  const task = getActiveAssignmentTask(player);
  const legacy = task === undefined || task === null ? task : activeAssignmentTaskToLegacy(task);
  if (hasOwn(player, 'activeAssignmentTask')) player.activeAssignmentTask = null;
  else player.activeAssignment = null;
  return legacy;
}


const ACTIVE_EXPEDITION_LEGACY_SNAPSHOT = Symbol('domain-state.active-expedition-legacy-snapshot');
const ACTIVE_EXPEDITION_PERSISTED_SNAPSHOT = Symbol('domain-state.active-expedition-persisted-snapshot');
const EXPEDITION_HISTORY_LEGACY_SNAPSHOT = Symbol('domain-state.expedition-history-legacy-snapshot');
const EXPEDITION_COMPLETION_PERSISTED_SNAPSHOT = Symbol('domain-state.expedition-completion-persisted-snapshot');

function expeditionDefinition(expeditionId, placeId) {
  return EXPEDITION_DEFINITIONS.find(definition =>
    (expeditionId && definition.id === expeditionId)
    || (placeId && definition.placeId === placeId)
  ) || null;
}

function activeExpeditionTaskFromLegacy(player, legacyExpedition) {
  if (legacyExpedition === undefined || legacyExpedition === null) return legacyExpedition;
  if (!legacyExpedition || typeof legacyExpedition !== 'object' || Array.isArray(legacyExpedition)) {
    throw new TypeError('ActiveExpeditionTask expects a legacy expedition record, null, or undefined.');
  }
  const card = hasOwn(legacyExpedition, 'card') && legacyExpedition.card && typeof legacyExpedition.card === 'object'
    ? cloneDetached(legacyExpedition.card)
    : undefined;
  const semantic = {
    kind: 'expedition',
    ownerId: player?.id,
    state: 'active',
    source: {},
    progress: {},
  };
  if (hasOwn(legacyExpedition, 'cardId')) semantic.id = cloneDetached(legacyExpedition.cardId);
  else if (card && hasOwn(card, 'id')) semantic.id = cloneDetached(card.id);
  if (hasOwn(legacyExpedition, 'name')) semantic.source.name = cloneDetached(legacyExpedition.name);
  if (hasOwn(legacyExpedition, 'placeId')) semantic.source.placeId = cloneDetached(legacyExpedition.placeId);
  if (hasOwn(legacyExpedition, 'acceptedRound')) semantic.source.acceptedRound = cloneDetached(legacyExpedition.acceptedRound);
  if (hasOwn(legacyExpedition, 'card')) semantic.payload = card;
  if (hasOwn(legacyExpedition, 'startedAtTarget')) semantic.progress.startedAtTarget = cloneDetached(legacyExpedition.startedAtTarget);
  if (hasOwn(legacyExpedition, 'departedAfterIssue')) semantic.progress.departedAfterIssue = cloneDetached(legacyExpedition.departedAfterIssue);
  const task = Task.view(semantic);
  Object.defineProperty(task, ACTIVE_EXPEDITION_LEGACY_SNAPSHOT, {
    value: cloneDetached(legacyExpedition),
    enumerable: false,
  });
  return task;
}

function activeExpeditionTaskFromPersisted(player, persistedExpedition) {
  if (persistedExpedition === undefined || persistedExpedition === null) return persistedExpedition;
  if (!persistedExpedition || typeof persistedExpedition !== 'object' || Array.isArray(persistedExpedition)) {
    throw new TypeError('ActiveExpeditionTask expects a persisted expedition record, null, or undefined.');
  }
  const definition = expeditionDefinition(persistedExpedition.expeditionId, persistedExpedition.placeId);
  const semantic = {
    kind: 'expedition',
    ownerId: player?.id,
    state: 'active',
    source: {},
    progress: {},
  };
  if (hasOwn(persistedExpedition, 'expeditionId')) semantic.id = cloneDetached(persistedExpedition.expeditionId);
  else if (definition?.id) semantic.id = cloneDetached(definition.id);
  if (hasOwn(persistedExpedition, 'placeId')) semantic.source.placeId = cloneDetached(persistedExpedition.placeId);
  else if (definition?.placeId) semantic.source.placeId = cloneDetached(definition.placeId);
  if (hasOwn(persistedExpedition, 'acceptedRound')) semantic.source.acceptedRound = cloneDetached(persistedExpedition.acceptedRound);
  if (definition?.name) semantic.source.name = cloneDetached(definition.name);
  if (definition) semantic.payload = cloneDetached(definition);
  if (hasOwn(persistedExpedition, 'startedAtTarget')) semantic.progress.startedAtTarget = cloneDetached(persistedExpedition.startedAtTarget);
  if (hasOwn(persistedExpedition, 'departedAfterIssue')) semantic.progress.departedAfterIssue = cloneDetached(persistedExpedition.departedAfterIssue);
  const task = Task.view(semantic);
  Object.defineProperty(task, ACTIVE_EXPEDITION_PERSISTED_SNAPSHOT, {
    value: cloneDetached(persistedExpedition),
    enumerable: false,
  });
  return task;
}

function getActiveExpeditionTask(player) {
  if (!player || typeof player !== 'object') return undefined;
  if (hasOwn(player, 'activeExpeditionTask')) {
    return activeExpeditionTaskFromPersisted(player, player.activeExpeditionTask);
  }
  if (!hasOwn(player, 'activeExpedition')) return undefined;
  return activeExpeditionTaskFromLegacy(player, player.activeExpedition);
}

function activeExpeditionTaskToLegacy(task) {
  if (task === undefined || task === null) return task;
  if (!Task.is(task) || task.kind !== 'expedition' || task.state !== 'active') {
    throw new TypeError('assignExpeditionTask expects an active expedition Task.');
  }
  const snapshot = task[ACTIVE_EXPEDITION_LEGACY_SNAPSHOT];
  const hasSnapshot = Boolean(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot));
  const legacy = hasSnapshot ? cloneDetached(snapshot) : {};
  const source = task.source && typeof task.source === 'object' ? task.source : {};
  const progress = task.progress && typeof task.progress === 'object' ? task.progress : {};

  if (!hasSnapshot || hasOwn(snapshot, 'card')) {
    if (hasOwn(task, 'payload')) legacy.card = cloneDetached(task.payload);
    else delete legacy.card;
  }
  if (!hasSnapshot || hasOwn(snapshot, 'cardId')) {
    if (hasOwn(task, 'id')) legacy.cardId = cloneDetached(task.id);
    else delete legacy.cardId;
  }
  for (const key of ['name', 'placeId', 'acceptedRound']) {
    if (hasSnapshot && !hasOwn(snapshot, key)) continue;
    if (hasOwn(source, key)) legacy[key] = cloneDetached(source[key]);
    else delete legacy[key];
  }
  for (const key of ['startedAtTarget', 'departedAfterIssue']) {
    if (hasSnapshot && !hasOwn(snapshot, key)) continue;
    if (hasOwn(progress, key)) legacy[key] = cloneDetached(progress[key]);
    else delete legacy[key];
  }
  return legacy;
}

function activeExpeditionTaskToPersisted(task) {
  if (task === undefined || task === null) return task;
  if (!Task.is(task) || task.kind !== 'expedition' || task.state !== 'active') {
    throw new TypeError('assignExpeditionTask expects an active expedition Task.');
  }
  const snapshot = task[ACTIVE_EXPEDITION_PERSISTED_SNAPSHOT];
  const persisted = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? cloneDetached(snapshot)
    : {};
  const source = task.source && typeof task.source === 'object' ? task.source : {};
  const progress = task.progress && typeof task.progress === 'object' ? task.progress : {};

  if (hasOwn(task, 'id')) persisted.expeditionId = cloneDetached(task.id);
  else delete persisted.expeditionId;
  if (hasOwn(source, 'placeId')) persisted.placeId = cloneDetached(source.placeId);
  else delete persisted.placeId;
  if (hasOwn(source, 'acceptedRound')) persisted.acceptedRound = cloneDetached(source.acceptedRound);
  else delete persisted.acceptedRound;
  if (hasOwn(progress, 'startedAtTarget')) persisted.startedAtTarget = cloneDetached(progress.startedAtTarget);
  else delete persisted.startedAtTarget;
  if (hasOwn(progress, 'departedAfterIssue')) persisted.departedAfterIssue = cloneDetached(progress.departedAfterIssue);
  else delete persisted.departedAfterIssue;

  delete persisted.card;
  delete persisted.cardId;
  delete persisted.name;
  return persisted;
}

function assignExpeditionTask(player, task) {
  if (!player || typeof player !== 'object') throw new TypeError('assignExpeditionTask requires a player object.');
  if (!Task.is(task) || task.kind !== 'expedition' || task.state !== 'active') {
    throw new TypeError('assignExpeditionTask expects an active expedition Task.');
  }
  if (task.ownerId != null && player.id != null && String(task.ownerId) !== String(player.id)) {
    throw new TypeError('Expedition Task ownerId does not match the target player.');
  }
  if (hasOwn(player, 'activeExpeditionTask')) {
    player.activeExpeditionTask = activeExpeditionTaskToPersisted(task);
    return activeExpeditionTaskToLegacy(task);
  }
  player.activeExpedition = activeExpeditionTaskToLegacy(task);
  return player.activeExpedition;
}

function completeExpeditionTask(player) {
  if (!player || typeof player !== 'object') throw new TypeError('completeExpeditionTask requires a player object.');
  const task = getActiveExpeditionTask(player);
  const legacy = task === undefined || task === null ? task : activeExpeditionTaskToLegacy(task);
  if (hasOwn(player, 'activeExpeditionTask')) player.activeExpeditionTask = null;
  else player.activeExpedition = null;
  return legacy;
}

function expeditionHistoryRecordFromLegacy(player, legacyRecord) {
  if (legacyRecord === undefined || legacyRecord === null) return legacyRecord;
  if (!legacyRecord || typeof legacyRecord !== 'object' || Array.isArray(legacyRecord)) {
    throw new TypeError('Expedition HistoryRecord expects a legacy record, null, or undefined.');
  }
  const semantic = {
    kind: 'expedition-completion',
    ownerId: player?.id,
    state: 'completed',
    source: {},
    payload: {},
  };
  if (hasOwn(legacyRecord, 'id')) semantic.id = cloneDetached(legacyRecord.id);
  if (hasOwn(legacyRecord, 'placeId')) semantic.source.placeId = cloneDetached(legacyRecord.placeId);
  if (hasOwn(legacyRecord, 'cardId')) semantic.source.cardId = cloneDetached(legacyRecord.cardId);
  if (hasOwn(legacyRecord, 'name')) semantic.payload.name = cloneDetached(legacyRecord.name);
  if (hasOwn(legacyRecord, 'completedRound')) semantic.completedAt = { round: cloneDetached(legacyRecord.completedRound) };
  const record = HistoryRecord.view(semantic);
  Object.defineProperty(record, EXPEDITION_HISTORY_LEGACY_SNAPSHOT, {
    value: cloneDetached(legacyRecord),
    enumerable: false,
  });
  return record;
}

function expeditionCompletionRecordFromPersisted(player, persistedRecord) {
  if (persistedRecord === undefined || persistedRecord === null) return persistedRecord;
  if (!persistedRecord || typeof persistedRecord !== 'object' || Array.isArray(persistedRecord)) {
    throw new TypeError('Expedition HistoryRecord expects a persisted record, null, or undefined.');
  }
  const definition = expeditionDefinition(persistedRecord.expeditionId, persistedRecord.placeId);
  const semantic = {
    kind: 'expedition-completion',
    ownerId: player?.id,
    state: 'completed',
    source: {},
    payload: {},
  };
  if (hasOwn(persistedRecord, 'id')) semantic.id = cloneDetached(persistedRecord.id);
  if (hasOwn(persistedRecord, 'placeId')) semantic.source.placeId = cloneDetached(persistedRecord.placeId);
  else if (definition?.placeId) semantic.source.placeId = cloneDetached(definition.placeId);
  if (hasOwn(persistedRecord, 'expeditionId')) semantic.source.cardId = cloneDetached(persistedRecord.expeditionId);
  else if (definition?.id) semantic.source.cardId = cloneDetached(definition.id);
  if (hasOwn(persistedRecord, 'name')) semantic.payload.name = cloneDetached(persistedRecord.name);
  else if (definition?.name) semantic.payload.name = cloneDetached(definition.name);
  if (hasOwn(persistedRecord, 'completedRound')) semantic.completedAt = { round: cloneDetached(persistedRecord.completedRound) };
  const record = HistoryRecord.view(semantic);
  Object.defineProperty(record, EXPEDITION_COMPLETION_PERSISTED_SNAPSHOT, {
    value: cloneDetached(persistedRecord),
    enumerable: false,
  });
  return record;
}

function expeditionHistoryRecordToLegacy(record) {
  if (record === undefined || record === null) return record;
  if (!HistoryRecord.is(record) || record.kind !== 'expedition-completion' || record.state !== 'completed') {
    throw new TypeError('Expedition history writes expect a completed expedition HistoryRecord.');
  }
  const snapshot = record[EXPEDITION_HISTORY_LEGACY_SNAPSHOT];
  const hasSnapshot = Boolean(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot));
  const legacy = hasSnapshot ? cloneDetached(snapshot) : {};
  const source = record.source && typeof record.source === 'object' ? record.source : {};
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
  const completedAt = record.completedAt && typeof record.completedAt === 'object' ? record.completedAt : {};

  if (!hasSnapshot || hasOwn(snapshot, 'id')) {
    if (hasOwn(record, 'id')) legacy.id = cloneDetached(record.id);
    else delete legacy.id;
  }
  for (const key of ['placeId', 'cardId']) {
    if (hasSnapshot && !hasOwn(snapshot, key)) continue;
    if (hasOwn(source, key)) legacy[key] = cloneDetached(source[key]);
    else delete legacy[key];
  }
  if (!hasSnapshot || hasOwn(snapshot, 'name')) {
    if (hasOwn(payload, 'name')) legacy.name = cloneDetached(payload.name);
    else delete legacy.name;
  }
  if (!hasSnapshot || hasOwn(snapshot, 'completedRound')) {
    if (hasOwn(completedAt, 'round')) legacy.completedRound = cloneDetached(completedAt.round);
    else delete legacy.completedRound;
  }
  return legacy;
}

function expeditionHistoryRecordToPersisted(record) {
  if (record === undefined || record === null) return record;
  if (!HistoryRecord.is(record) || record.kind !== 'expedition-completion' || record.state !== 'completed') {
    throw new TypeError('Expedition history writes expect a completed expedition HistoryRecord.');
  }
  const snapshot = record[EXPEDITION_COMPLETION_PERSISTED_SNAPSHOT];
  const persisted = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? cloneDetached(snapshot)
    : {};
  const source = record.source && typeof record.source === 'object' ? record.source : {};
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
  const completedAt = record.completedAt && typeof record.completedAt === 'object' ? record.completedAt : {};

  if (hasOwn(record, 'id')) persisted.id = cloneDetached(record.id);
  else delete persisted.id;
  if (hasOwn(source, 'placeId')) persisted.placeId = cloneDetached(source.placeId);
  else delete persisted.placeId;
  if (hasOwn(source, 'cardId')) persisted.expeditionId = cloneDetached(source.cardId);
  else delete persisted.expeditionId;
  if (hasOwn(payload, 'name')) persisted.name = cloneDetached(payload.name);
  else delete persisted.name;
  if (hasOwn(completedAt, 'round')) persisted.completedRound = cloneDetached(completedAt.round);
  else delete persisted.completedRound;
  delete persisted.cardId;
  return persisted;
}

function getExpeditionHistoryRecords(player) {
  if (!player || typeof player !== 'object') return undefined;
  if (hasOwn(player, 'expeditionCompletions')) {
    const history = player.expeditionCompletions;
    if (history === null) return null;
    if (!Array.isArray(history)) throw new TypeError('Expedition completion backing field must be an array, null, or absent.');
    return history.map(entry => expeditionCompletionRecordFromPersisted(player, entry));
  }
  if (!hasOwn(player, 'expeditionHistory')) return undefined;
  const history = player.expeditionHistory;
  if (history === null) return null;
  if (!Array.isArray(history)) throw new TypeError('Expedition history backing field must be an array, null, or absent.');
  return history.map(entry => expeditionHistoryRecordFromLegacy(player, entry));
}

function setExpeditionHistoryRecords(player, records) {
  if (!player || typeof player !== 'object') throw new TypeError('setExpeditionHistoryRecords requires a player object.');
  const persisted = hasOwn(player, 'expeditionCompletions');
  if (records === undefined) {
    if (persisted) delete player.expeditionCompletions;
    else delete player.expeditionHistory;
    return undefined;
  }
  if (records === null) {
    if (persisted) player.expeditionCompletions = null;
    else player.expeditionHistory = null;
    return null;
  }
  if (!Array.isArray(records)) throw new TypeError('setExpeditionHistoryRecords expects an array, null, or undefined.');
  if (persisted) {
    player.expeditionCompletions = records.map(expeditionHistoryRecordToPersisted);
    return player.expeditionCompletions;
  }
  player.expeditionHistory = records.map(expeditionHistoryRecordToLegacy);
  return player.expeditionHistory;
}

function addCompletedExpeditionRecord(player, record) {
  if (!player || typeof player !== 'object') throw new TypeError('addCompletedExpeditionRecord requires a player object.');
  if (hasOwn(player, 'expeditionCompletions')) {
    const persistedRecord = expeditionHistoryRecordToPersisted(record);
    if (!Array.isArray(player.expeditionCompletions)) player.expeditionCompletions = [];
    player.expeditionCompletions.push(persistedRecord);
    return expeditionHistoryRecordToLegacy(record);
  }
  const legacyRecord = expeditionHistoryRecordToLegacy(record);
  if (!Array.isArray(player.expeditionHistory)) player.expeditionHistory = [];
  player.expeditionHistory.push(legacyRecord);
  return legacyRecord;
}

function countExpeditionCompletions(player, placeId) {
  const target = String(placeId || '');
  return (getExpeditionHistoryRecords(player) || [])
    .filter(record => record?.source?.placeId === target)
    .length;
}

function getExpeditionUsage(player) {
  if (!player || typeof player !== 'object') return { drawRound: undefined, drawsThisRound: undefined };
  if (hasOwn(player, 'expeditionAccessUsage')) {
    const usage = player.expeditionAccessUsage;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
      return { drawRound: undefined, drawsThisRound: undefined };
    }
    return {
      drawRound: hasOwn(usage, 'round') ? cloneDetached(usage.round) : undefined,
      drawsThisRound: hasOwn(usage, 'draws') ? cloneDetached(usage.draws) : undefined,
    };
  }
  return {
    drawRound: hasOwn(player, 'expeditionDrawRound') ? cloneDetached(player.expeditionDrawRound) : undefined,
    drawsThisRound: hasOwn(player, 'expeditionsDrawnThisRound') ? cloneDetached(player.expeditionsDrawnThisRound) : undefined,
  };
}

function expeditionTakenThisRound(player, round) {
  const usage = getExpeditionUsage(player);
  return Number(usage.drawRound) === Number(round)
    ? Math.max(1, Number(usage.drawsThisRound) || 1)
    : 0;
}

function recordExpeditionTaken(player, round) {
  if (!player || typeof player !== 'object') throw new TypeError('recordExpeditionTaken requires a player object.');
  if (hasOwn(player, 'expeditionAccessUsage')) {
    const current = player.expeditionAccessUsage && typeof player.expeditionAccessUsage === 'object' && !Array.isArray(player.expeditionAccessUsage)
      ? player.expeditionAccessUsage
      : {};
    player.expeditionAccessUsage = {
      ...current,
      round: Number(round) || 1,
      draws: 1,
    };
    return getExpeditionUsage(player);
  }
  player.expeditionDrawRound = Number(round) || 1;
  player.expeditionsDrawnThisRound = 1;
  return getExpeditionUsage(player);
}

function resetExpeditionRoundUsage(player) {
  if (!player || typeof player !== 'object') throw new TypeError('resetExpeditionRoundUsage requires a player object.');
  if (hasOwn(player, 'expeditionAccessUsage')) {
    const current = player.expeditionAccessUsage && typeof player.expeditionAccessUsage === 'object' && !Array.isArray(player.expeditionAccessUsage)
      ? player.expeditionAccessUsage
      : {};
    player.expeditionAccessUsage = { ...current, draws: 0 };
    return getExpeditionUsage(player);
  }
  player.expeditionsDrawnThisRound = 0;
  return getExpeditionUsage(player);
}


function legendaryConsumableAbilityFromLegacy(player, legacyCard, index = 0) {
  if (!legacyCard || typeof legacyCard !== 'object' || Array.isArray(legacyCard)) {
    throw new TypeError('Legendary ConsumableAbility expects a legacy card object.');
  }
  const semantic = {
    kind: 'legendary',
    ownerId: player?.id,
    source: { inventory: 'legendary', index: Math.max(0, Number(index) || 0) },
    payload: cloneDetached(legacyCard),
  };
  if (hasOwn(legacyCard, 'id')) semantic.id = cloneDetached(legacyCard.id);
  return ConsumableAbility.view(semantic);
}

function specialConsumableAbilityFromLegacy(player, legacyName, index = 0) {
  if (typeof legacyName !== 'string') {
    throw new TypeError('Special ConsumableAbility expects a legacy string entry.');
  }
  return ConsumableAbility.view({
    kind: 'special',
    ownerId: player?.id,
    source: { inventory: 'special', index: Math.max(0, Number(index) || 0) },
    payload: { name: legacyName },
  });
}

function consumableAbilityDefinition(abilityId) {
  return (CONSUMABLE_ABILITY_DEFINITIONS || []).find(definition => definition?.id === abilityId) || null;
}

function consumableAbilityDefinitionByName(name) {
  return (CONSUMABLE_ABILITY_DEFINITIONS || []).find(definition => definition?.name === name) || null;
}

function consumableAbilityFromPersisted(player, persisted, sourceIndex) {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
    throw new TypeError('Persisted ConsumableAbility expects an object.');
  }
  const originKind = persisted.origin?.kind;
  const definition = consumableAbilityDefinition(persisted.abilityId);
  if (originKind === 'legendary') {
    const payload = {
      ...(definition ? cloneDetached(definition) : {}),
      ...(persisted.data && typeof persisted.data === 'object' ? cloneDetached(persisted.data) : {}),
    };
    return ConsumableAbility.view({
      kind: 'legendary',
      ...(persisted.abilityId != null ? { id: cloneDetached(persisted.abilityId), abilityId: cloneDetached(persisted.abilityId) } : {}),
      ...(persisted.instanceId != null ? { instanceId: cloneDetached(persisted.instanceId) } : {}),
      ownerId: player?.id,
      source: { inventory: 'legendary', index: sourceIndex },
      payload,
    });
  }
  if (originKind === 'special') {
    const name = persisted.origin?.legacyName ?? definition?.name ?? persisted.data?.name;
    return ConsumableAbility.view({
      kind: 'special',
      ...(persisted.abilityId != null ? { abilityId: cloneDetached(persisted.abilityId) } : {}),
      ...(persisted.instanceId != null ? { instanceId: cloneDetached(persisted.instanceId) } : {}),
      ownerId: player?.id,
      source: { inventory: 'special', index: sourceIndex },
      payload: { name: cloneDetached(name) },
    });
  }
  throw new TypeError('Persisted ConsumableAbility origin.kind must be legendary or special.');
}

function consumableAbilityToLegacy(ability) {
  if (!ConsumableAbility.is(ability)) {
    throw new TypeError('Consumable ability write expects a ConsumableAbility.');
  }
  const inventory = ability.source?.inventory;
  if (inventory === 'legendary') {
    if (ability.kind !== 'legendary' || !ability.payload || typeof ability.payload !== 'object' || Array.isArray(ability.payload)) {
      throw new TypeError('Legendary ConsumableAbility must contain a card object payload.');
    }
    return cloneDetached(ability.payload);
  }
  if (inventory === 'special') {
    if (ability.kind !== 'special' || typeof ability.payload?.name !== 'string') {
      throw new TypeError('Special ConsumableAbility must contain a string name payload.');
    }
    return ability.payload.name;
  }
  throw new TypeError('ConsumableAbility source.inventory must be legendary or special.');
}

function listPersistedAbilities(player, originKind) {
  if (!Array.isArray(player?.consumableAbilities)) return [];
  let sourceIndex = 0;
  const out = [];
  for (const item of player.consumableAbilities) {
    if (item?.origin?.kind !== originKind) continue;
    out.push(consumableAbilityFromPersisted(player, item, sourceIndex));
    sourceIndex += 1;
  }
  return out;
}

function listLegendaryAbilities(player) {
  if (!player || typeof player !== 'object') return undefined;
  if (hasOwn(player, 'consumableAbilities')) {
    if (player.consumableAbilities === null) return null;
    if (!Array.isArray(player.consumableAbilities)) throw new TypeError('consumableAbilities backing field must be an array, null, or absent.');
    return listPersistedAbilities(player, 'legendary');
  }
  if (!hasOwn(player, 'legendaryCards')) return undefined;
  if (player.legendaryCards === null) return null;
  if (!Array.isArray(player.legendaryCards)) throw new TypeError('legendaryCards backing field must be an array, null, or absent.');
  return player.legendaryCards.map((card, index) => legendaryConsumableAbilityFromLegacy(player, card, index));
}

function listSpecialAbilities(player) {
  if (!player || typeof player !== 'object') return undefined;
  if (hasOwn(player, 'consumableAbilities')) {
    if (player.consumableAbilities === null) return null;
    if (!Array.isArray(player.consumableAbilities)) throw new TypeError('consumableAbilities backing field must be an array, null, or absent.');
    return listPersistedAbilities(player, 'special');
  }
  if (!hasOwn(player, 'specialCards')) return undefined;
  if (player.specialCards === null) return null;
  if (!Array.isArray(player.specialCards)) throw new TypeError('specialCards backing field must be an array, null, or absent.');
  return player.specialCards.map((name, index) => specialConsumableAbilityFromLegacy(player, name, index));
}

function listConsumableAbilities(player) {
  return [
    ...(listLegendaryAbilities(player) || []),
    ...(listSpecialAbilities(player) || []),
  ];
}

function nextConsumableAbilityInstanceId(player, originKind, abilityId) {
  const current = Math.max(0, Math.floor(Number(player.consumableAbilitySequence) || 0));
  const next = current + 1;
  player.consumableAbilitySequence = next;
  return `ability:${String(player.id || 'player')}:${next}:${originKind}:${String(abilityId || 'legacy')}`;
}

function persistedAbilityFromView(player, ability) {
  const inventory = ability.source?.inventory;
  if (inventory === 'legendary') {
    const legacy = consumableAbilityToLegacy(ability);
    const abilityId = legacy.id || ability.abilityId || ability.id || null;
    const canonical = consumableAbilityDefinition(abilityId);
    const persisted = {
      instanceId: ability.instanceId || nextConsumableAbilityInstanceId(player, 'legendary', abilityId),
      abilityId,
      origin: { kind: 'legendary' },
    };
    const data = nonCanonicalObjectData(legacy, canonical);
    if (data) persisted.data = data;
    return persisted;
  }
  if (inventory === 'special') {
    const legacyName = consumableAbilityToLegacy(ability);
    const canonical = consumableAbilityDefinitionByName(legacyName);
    const abilityId = ability.abilityId || canonical?.id || null;
    return {
      instanceId: ability.instanceId || nextConsumableAbilityInstanceId(player, 'special', abilityId || legacyName),
      abilityId,
      origin: { kind: 'special', legacyName },
    };
  }
  throw new TypeError('ConsumableAbility source.inventory must be legendary or special.');
}

function grantConsumableAbility(player, ability) {
  if (!player || typeof player !== 'object') throw new TypeError('grantConsumableAbility requires a player object.');
  if (!ConsumableAbility.is(ability)) throw new TypeError('grantConsumableAbility expects a ConsumableAbility.');
  if (ability.ownerId != null && player.id != null && String(ability.ownerId) !== String(player.id)) {
    throw new TypeError('ConsumableAbility ownerId does not match the target player.');
  }
  const inventory = ability.source?.inventory;
  if (hasOwn(player, 'consumableAbilities')) {
    if (player.consumableAbilities == null) player.consumableAbilities = [];
    if (!Array.isArray(player.consumableAbilities)) throw new TypeError('consumableAbilities backing field must be an array.');
    const persisted = persistedAbilityFromView(player, ability);
    player.consumableAbilities.push(persisted);
    const list = inventory === 'legendary' ? listLegendaryAbilities(player) : listSpecialAbilities(player);
    return list[list.length - 1];
  }
  const legacy = consumableAbilityToLegacy(ability);
  if (inventory === 'legendary') {
    if (player.legendaryCards == null) player.legendaryCards = [];
    if (!Array.isArray(player.legendaryCards)) throw new TypeError('legendaryCards backing field must be an array.');
    const index = player.legendaryCards.push(legacy) - 1;
    return legendaryConsumableAbilityFromLegacy(player, player.legendaryCards[index], index);
  }
  if (inventory === 'special') {
    if (player.specialCards == null) player.specialCards = [];
    if (!Array.isArray(player.specialCards)) throw new TypeError('specialCards backing field must be an array.');
    const index = player.specialCards.push(legacy) - 1;
    return specialConsumableAbilityFromLegacy(player, player.specialCards[index], index);
  }
  throw new TypeError('ConsumableAbility source.inventory must be legendary or special.');
}

function grantLegendaryAbility(player, card) {
  const index = (listLegendaryAbilities(player) || []).length;
  return grantConsumableAbility(player, legendaryConsumableAbilityFromLegacy(player, card, index));
}

function grantSpecialAbility(player, name) {
  const index = (listSpecialAbilities(player) || []).length;
  return grantConsumableAbility(player, specialConsumableAbilityFromLegacy(player, name, index));
}

function peekConsumableAbility(player, ref) {
  if (!player || !ref) return null;
  const source = String(ref.source || ref.inventory || '');
  const index = Number(ref.index);
  if (!Number.isInteger(index) || index < 0) return null;
  if (source === 'legendary') {
    const cards = listLegendaryAbilities(player);
    return Array.isArray(cards) ? cards[index] || null : null;
  }
  if (source === 'special') {
    const cards = listSpecialAbilities(player);
    return Array.isArray(cards) ? cards[index] || null : null;
  }
  return null;
}

function consumeConsumableAbility(player, ref) {
  const ability = peekConsumableAbility(player, ref);
  if (!ability) return null;
  const source = ability.source?.inventory;
  const index = ability.source?.index;
  if (hasOwn(player, 'consumableAbilities')) {
    if (!Array.isArray(player.consumableAbilities)) return null;
    let seen = 0;
    const backingIndex = player.consumableAbilities.findIndex(item => {
      if (item?.origin?.kind !== source) return false;
      const matches = seen === index;
      seen += 1;
      return matches;
    });
    if (backingIndex < 0) return null;
    player.consumableAbilities.splice(backingIndex, 1);
    return ability;
  }
  if (source === 'legendary') {
    if (!Array.isArray(player.legendaryCards) || index < 0 || index >= player.legendaryCards.length) return null;
    player.legendaryCards.splice(index, 1);
    return ability;
  }
  if (source === 'special') {
    if (!Array.isArray(player.specialCards) || index < 0 || index >= player.specialCards.length) return null;
    player.specialCards.splice(index, 1);
    return ability;
  }
  return null;
}


const STORED_BENEFIT_LEGACY_SNAPSHOT = Symbol('domain-state.stored-benefit-legacy-snapshot');
const STORED_BENEFIT_PERSISTED_SNAPSHOT = Symbol('domain-state.stored-benefit-persisted-snapshot');

function storedBenefitFromLegacy(player, legacyBenefit) {
  if (legacyBenefit === undefined || legacyBenefit === null) return legacyBenefit;
  if (!legacyBenefit || typeof legacyBenefit !== 'object' || Array.isArray(legacyBenefit)) {
    throw new TypeError('StoredBenefit expects a legacy saved event record, null, or undefined.');
  }
  const semantic = {
    ownerId: player?.id,
    state: 'stored',
    source: {},
    payload: {},
  };
  if (hasOwn(legacyBenefit, 'kind')) semantic.kind = cloneDetached(legacyBenefit.kind);
  if (hasOwn(legacyBenefit, 'id')) semantic.id = cloneDetached(legacyBenefit.id);
  if (hasOwn(legacyBenefit, 'sourceDeck')) semantic.source.deck = cloneDetached(legacyBenefit.sourceDeck);
  if (hasOwn(legacyBenefit, 'sourceCard')) semantic.source.occurrence = cloneDetached(legacyBenefit.sourceCard);
  if (hasOwn(legacyBenefit, 'name')) semantic.payload.name = cloneDetached(legacyBenefit.name);
  if (hasOwn(legacyBenefit, 'goodId')) semantic.payload.goodId = cloneDetached(legacyBenefit.goodId);
  if (hasOwn(legacyBenefit, 'assignmentInstanceId')) {
    semantic.payload.assignmentInstanceId = cloneDetached(legacyBenefit.assignmentInstanceId);
  }
  const benefit = StoredBenefit.view(semantic);
  Object.defineProperty(benefit, STORED_BENEFIT_LEGACY_SNAPSHOT, {
    value: cloneDetached(legacyBenefit),
    enumerable: false,
  });
  return benefit;
}

function storedBenefitFromPersisted(player, persistedBenefit) {
  if (persistedBenefit === undefined || persistedBenefit === null) return persistedBenefit;
  if (!persistedBenefit || typeof persistedBenefit !== 'object' || Array.isArray(persistedBenefit)) {
    throw new TypeError('StoredBenefit expects a persisted record, null, or undefined.');
  }
  const semantic = {
    ownerId: player?.id,
    state: 'stored',
    source: persistedBenefit.source && typeof persistedBenefit.source === 'object'
      ? cloneDetached(persistedBenefit.source)
      : {},
    payload: persistedBenefit.payload && typeof persistedBenefit.payload === 'object'
      ? cloneDetached(persistedBenefit.payload)
      : {},
  };
  if (hasOwn(persistedBenefit, 'instanceId')) semantic.instanceId = cloneDetached(persistedBenefit.instanceId);
  if (hasOwn(persistedBenefit, 'id')) semantic.id = cloneDetached(persistedBenefit.id);
  if (hasOwn(persistedBenefit, 'kind')) semantic.kind = cloneDetached(persistedBenefit.kind);
  const benefit = StoredBenefit.view(semantic);
  Object.defineProperty(benefit, STORED_BENEFIT_PERSISTED_SNAPSHOT, {
    value: cloneDetached(persistedBenefit),
    enumerable: false,
  });
  return benefit;
}

function storedBenefitToLegacy(benefit) {
  if (benefit === undefined || benefit === null) return benefit;
  if (!StoredBenefit.is(benefit) || benefit.state !== 'stored') {
    throw new TypeError('Stored benefit writes expect a stored StoredBenefit.');
  }
  const legacySnapshot = benefit[STORED_BENEFIT_LEGACY_SNAPSHOT];
  const persistedSnapshot = benefit[STORED_BENEFIT_PERSISTED_SNAPSHOT];
  const hasLegacySnapshot = Boolean(legacySnapshot && typeof legacySnapshot === 'object' && !Array.isArray(legacySnapshot));
  let legacy = hasLegacySnapshot ? cloneDetached(legacySnapshot) : {};
  if (!hasLegacySnapshot && persistedSnapshot && typeof persistedSnapshot === 'object') {
    const targetKeys = new Set(['instanceId', 'id', 'kind', 'source', 'payload']);
    for (const [key, value] of Object.entries(persistedSnapshot)) {
      if (!targetKeys.has(key)) legacy[key] = cloneDetached(value);
    }
  }
  const source = benefit.source && typeof benefit.source === 'object' ? benefit.source : {};
  const payload = benefit.payload && typeof benefit.payload === 'object' ? benefit.payload : {};

  if (!hasLegacySnapshot || hasOwn(legacySnapshot, 'id')) {
    if (hasOwn(benefit, 'id')) legacy.id = cloneDetached(benefit.id);
    else delete legacy.id;
  }
  if (!hasLegacySnapshot || hasOwn(legacySnapshot, 'kind')) {
    if (hasOwn(benefit, 'kind')) legacy.kind = cloneDetached(benefit.kind);
    else delete legacy.kind;
  }
  if (!hasLegacySnapshot || hasOwn(legacySnapshot, 'sourceDeck')) {
    if (hasOwn(source, 'deck')) legacy.sourceDeck = cloneDetached(source.deck);
    else delete legacy.sourceDeck;
  }
  if (!hasLegacySnapshot || hasOwn(legacySnapshot, 'sourceCard')) {
    if (hasOwn(source, 'occurrence')) legacy.sourceCard = cloneDetached(source.occurrence);
    else delete legacy.sourceCard;
  }
  for (const key of ['name', 'goodId', 'assignmentInstanceId']) {
    if (hasLegacySnapshot && !hasOwn(legacySnapshot, key)) continue;
    if (hasOwn(payload, key)) legacy[key] = cloneDetached(payload[key]);
    else delete legacy[key];
  }
  return legacy;
}

function storedBenefitToPersisted(player, benefit) {
  if (benefit === undefined || benefit === null) return benefit;
  if (!StoredBenefit.is(benefit) || benefit.state !== 'stored') {
    throw new TypeError('Stored benefit writes expect a stored StoredBenefit.');
  }
  const snapshot = benefit[STORED_BENEFIT_PERSISTED_SNAPSHOT];
  const persisted = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? cloneDetached(snapshot)
    : {};
  if (hasOwn(benefit, 'instanceId')) persisted.instanceId = cloneDetached(benefit.instanceId);
  else if (!persisted.instanceId) persisted.instanceId = `benefit:${String(player?.id || 'player')}:${String(benefit.id || (player?.storedBenefits?.length || 0))}`;
  if (hasOwn(benefit, 'id')) persisted.id = cloneDetached(benefit.id);
  else delete persisted.id;
  if (hasOwn(benefit, 'kind')) persisted.kind = cloneDetached(benefit.kind);
  else delete persisted.kind;
  persisted.source = benefit.source && typeof benefit.source === 'object' ? cloneDetached(benefit.source) : {};
  persisted.payload = benefit.payload && typeof benefit.payload === 'object' ? cloneDetached(benefit.payload) : {};
  delete persisted.sourceDeck;
  delete persisted.sourceCard;
  delete persisted.name;
  delete persisted.goodId;
  delete persisted.assignmentInstanceId;
  return persisted;
}

function listStoredBenefits(player) {
  if (!player || typeof player !== 'object') return undefined;
  if (hasOwn(player, 'storedBenefits')) {
    if (player.storedBenefits === null) return null;
    if (!Array.isArray(player.storedBenefits)) {
      throw new TypeError('storedBenefits backing field must be an array, null, or absent.');
    }
    return player.storedBenefits.map(entry => storedBenefitFromPersisted(player, entry));
  }
  if (!hasOwn(player, 'savedEventCards')) return undefined;
  if (player.savedEventCards === null) return null;
  if (!Array.isArray(player.savedEventCards)) {
    throw new TypeError('savedEventCards backing field must be an array, null, or absent.');
  }
  return player.savedEventCards.map(entry => storedBenefitFromLegacy(player, entry));
}

function peekStoredBenefit(player, savedCardId) {
  const id = String(savedCardId || '');
  const benefits = listStoredBenefits(player);
  if (!Array.isArray(benefits)) return null;
  return benefits.find(benefit => String(benefit?.id || '') === id) || null;
}

function storeBenefit(player, benefit) {
  if (!player || typeof player !== 'object') throw new TypeError('storeBenefit requires a player object.');
  if (!StoredBenefit.is(benefit) || benefit.state !== 'stored') {
    throw new TypeError('storeBenefit expects a stored StoredBenefit.');
  }
  if (benefit.ownerId != null && player.id != null && String(benefit.ownerId) !== String(player.id)) {
    throw new TypeError('StoredBenefit ownerId does not match the target player.');
  }
  if (hasOwn(player, 'storedBenefits')) {
    if (player.storedBenefits == null) player.storedBenefits = [];
    if (!Array.isArray(player.storedBenefits)) throw new TypeError('storedBenefits backing field must be an array.');
    const persisted = storedBenefitToPersisted(player, benefit);
    player.storedBenefits.push(persisted);
    return storedBenefitFromPersisted(player, persisted);
  }
  const legacy = storedBenefitToLegacy(benefit);
  if (player.savedEventCards == null) player.savedEventCards = [];
  if (!Array.isArray(player.savedEventCards)) throw new TypeError('savedEventCards backing field must be an array.');
  player.savedEventCards.push(legacy);
  return storedBenefitFromLegacy(player, legacy);
}

function consumeStoredBenefit(player, savedCardId) {
  if (!player || typeof player !== 'object') return null;
  const id = String(savedCardId || '');
  if (hasOwn(player, 'storedBenefits')) {
    if (!Array.isArray(player.storedBenefits)) return null;
    const index = player.storedBenefits.findIndex(entry => String(entry?.id || '') === id);
    if (index < 0) return null;
    const [persisted] = player.storedBenefits.splice(index, 1);
    return storedBenefitFromPersisted(player, persisted);
  }
  if (!Array.isArray(player.savedEventCards)) return null;
  const index = player.savedEventCards.findIndex(entry => String(entry?.id || '') === id);
  if (index < 0) return null;
  const [legacy] = player.savedEventCards.splice(index, 1);
  return storedBenefitFromLegacy(player, legacy);
}

function discardStoredBenefit(player, savedCardId) {
  return consumeStoredBenefit(player, savedCardId);
}


function discoveryDefinitionFor(placeDefinitions, placeId) {
  const id = String(placeId || '');
  if (!id || !placeDefinitions) return null;
  if (Array.isArray(placeDefinitions)) return placeDefinitions.find(definition => String(definition?.id || '') === id) || null;
  if (typeof placeDefinitions !== 'object') return null;
  if (String(placeDefinitions.id || '') === id) return placeDefinitions;
  const direct = placeDefinitions[id];
  return direct && typeof direct === 'object' && !Array.isArray(direct) ? direct : null;
}

function discoveryRegistryBacking(room) {
  if (room && hasOwn(room, 'discoveries')) {
    if (!room.discoveries || typeof room.discoveries !== 'object' || Array.isArray(room.discoveries)) return null;
    return { kind: 'persisted', registry: room.discoveries };
  }
  const registry = room?.legendaryPlacesExplored;
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return null;
  return { kind: 'legacy', registry };
}

function discoveryFromRegistryEntry(placeId, rawEntry, placeDefinitions = null, backingKind = 'legacy') {
  const id = String(placeId || '');
  const ownerId = backingKind === 'persisted' && rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry)
    ? (rawEntry.ownerId ?? rawEntry.claimedById ?? rawEntry.claimedBy)
    : rawEntry;
  if (!id || ownerId === undefined || ownerId === null || String(ownerId) === '') return null;
  const definition = discoveryDefinitionFor(placeDefinitions, id);
  const source = { registry: backingKind === 'persisted' ? 'discoveries' : 'legendaryPlacesExplored', placeId: id };
  if (definition) {
    if (hasOwn(definition, 'kind')) source.placeKind = cloneDetached(definition.kind);
    if (hasOwn(definition, 'mapPlaceId')) source.mapPlaceId = cloneDetached(definition.mapPlaceId);
    if (hasOwn(definition, 'islandId')) source.islandId = cloneDetached(definition.islandId);
  }
  return Discovery.view({
    kind: 'legendary-place', id, ownerId: cloneDetached(ownerId), claimedById: cloneDetached(ownerId),
    state: 'claimed', source, payload: definition ? cloneDetached(definition) : { id },
  });
}

function getDiscovery(room, placeId, placeDefinitions = null) {
  const backing = discoveryRegistryBacking(room);
  const id = String(placeId || '');
  if (!id || !backing || !hasOwn(backing.registry, id)) return null;
  return discoveryFromRegistryEntry(id, backing.registry[id], placeDefinitions, backing.kind);
}

function listDiscoveries(room, placeDefinitions = null) {
  const backing = discoveryRegistryBacking(room);
  if (!backing) return [];
  return Object.keys(backing.registry).map(placeId => getDiscovery(room, placeId, placeDefinitions)).filter(Boolean);
}

function listPlayerDiscoveries(room, playerId, placeDefinitions = null) {
  if (playerId === undefined || playerId === null) return [];
  return listDiscoveries(room, placeDefinitions).filter(discovery => String(discovery.ownerId) === String(playerId));
}

function hasDiscovery(room, placeId) {
  return Boolean(getDiscovery(room, placeId));
}

function claimDiscovery(room, placeId, playerId, placeDefinitions = null) {
  if (!room || typeof room !== 'object') throw new TypeError('claimDiscovery requires a room object.');
  const id = String(placeId || '');
  if (!id) throw new TypeError('claimDiscovery requires a placeId.');
  if (playerId === undefined || playerId === null || String(playerId) === '') throw new TypeError('claimDiscovery requires a playerId.');

  if (hasOwn(room, 'discoveries')) {
    if (!room.discoveries || typeof room.discoveries !== 'object' || Array.isArray(room.discoveries)) room.discoveries = {};
    const existing = getDiscovery(room, id, placeDefinitions);
    if (existing) return { first: false, existingOwnerId: existing.ownerId, ownerId: existing.ownerId, discovery: existing };
    room.discoveries[id] = {
      placeId: id, ownerId: cloneDetached(playerId), claimedById: cloneDetached(playerId),
      state: 'claimed', rewardGranted: true,
    };
    const discovery = getDiscovery(room, id, placeDefinitions);
    return { first: true, existingOwnerId: null, ownerId: discovery.ownerId, discovery };
  }

  if (!room.legendaryPlacesExplored || typeof room.legendaryPlacesExplored !== 'object' || Array.isArray(room.legendaryPlacesExplored)) room.legendaryPlacesExplored = {};
  const existing = getDiscovery(room, id, placeDefinitions);
  if (existing) return { first: false, existingOwnerId: existing.ownerId, ownerId: existing.ownerId, discovery: existing };
  room.legendaryPlacesExplored[id] = playerId;
  const discovery = getDiscovery(room, id, placeDefinitions);
  return { first: true, existingOwnerId: null, ownerId: discovery.ownerId, discovery };
}

const ACTIVE_TURN_NUMERIC_EFFECTS = new Set(['moveBonus', 'movePenalty']);

function temporaryEffectState(target, create = false) {
  if (!target || typeof target !== 'object' || !hasOwn(target, 'temporaryEffects')) return null;
  if (!target.temporaryEffects || typeof target.temporaryEffects !== 'object' || Array.isArray(target.temporaryEffects)) {
    if (!create) return null;
    target.temporaryEffects = {};
  }
  if (create) {
    if (!Array.isArray(target.temporaryEffects.active)) target.temporaryEffects.active = [];
    if (!Array.isArray(target.temporaryEffects.scheduled)) target.temporaryEffects.scheduled = [];
  }
  return target.temporaryEffects;
}

function persistedTemporaryEffectView(target, record, targetType) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const ownerId = hasOwn(record, 'ownerId') ? record.ownerId : (targetType === 'player' ? target?.id : target?.ownerId);
  return TemporaryEffect.view({
    kind: cloneDetached(record.kind), id: cloneDetached(record.id), ownerId: cloneDetached(ownerId),
    targetType: cloneDetached(record.targetType || targetType),
    targetId: cloneDetached(hasOwn(record, 'targetId') ? record.targetId : target?.id),
    state: cloneDetached(record.state || 'active'), source: cloneDetached(record.source || {}),
    payload: cloneDetached(record.payload || {}), duration: cloneDetached(record.duration || {}),
  });
}

function persistedActiveEffects(target) {
  const state = temporaryEffectState(target, false);
  return state && Array.isArray(state.active) ? state.active : null;
}

function persistedScheduledEffects(target) {
  const state = temporaryEffectState(target, false);
  return state && Array.isArray(state.scheduled) ? state.scheduled : null;
}

function activeTurnEffectFromLegacy(player, effectKind, value) {
  const key = String(effectKind || '');
  if (!key || value === undefined) return null;
  return TemporaryEffect.view({
    kind: 'active-turn:' + key, id: 'active-turn:' + key, ownerId: player?.id,
    targetType: 'player', targetId: player?.id, state: 'active',
    source: { backing: 'activeTurnEffects', key }, duration: { scope: 'personal-turn' },
    payload: { value: cloneDetached(value) },
  });
}

function listActiveTurnEffects(player) {
  const persisted = persistedActiveEffects(player);
  if (persisted) return persisted.filter(record => record?.state !== 'scheduled' && String(record?.kind || '').startsWith('active-turn:'))
    .map(record => persistedTemporaryEffectView(player, record, 'player')).filter(Boolean);
  const backing = player?.activeTurnEffects;
  if (!backing || typeof backing !== 'object' || Array.isArray(backing)) return [];
  return Object.entries(backing).map(([key, value]) => activeTurnEffectFromLegacy(player, key, value)).filter(Boolean);
}

function getActiveTurnEffect(player, effectKind) {
  const key = String(effectKind || '');
  if (!key) return null;
  const persisted = persistedActiveEffects(player);
  if (persisted) {
    const record = persisted.find(item => item?.state !== 'scheduled' && (item?.source?.key === key || item?.kind === 'active-turn:' + key));
    return persistedTemporaryEffectView(player, record, 'player');
  }
  if (!player?.activeTurnEffects || typeof player.activeTurnEffects !== 'object' || Array.isArray(player.activeTurnEffects) || !hasOwn(player.activeTurnEffects, key)) return null;
  return activeTurnEffectFromLegacy(player, key, player.activeTurnEffects[key]);
}

function getActiveTurnEffectValue(player, effectKind) {
  return getActiveTurnEffect(player, effectKind)?.payload?.value;
}

function activeTurnEffectsSnapshot(player) {
  return Object.fromEntries(listActiveTurnEffects(player).map(effect => [
    effect.source.key || String(effect.kind || '').replace(/^active-turn:/, ''), cloneDetached(effect.payload.value),
  ]));
}

function writePersistedActiveTurnEffect(player, effectKind, value) {
  const state = temporaryEffectState(player, true);
  const key = String(effectKind);
  const index = state.active.findIndex(item => item?.state !== 'scheduled' && (item?.source?.key === key || item?.kind === 'active-turn:' + key));
  const previous = index >= 0 ? state.active[index] : {};
  const record = {
    ...previous, kind: 'active-turn:' + key, id: 'active-turn:' + key,
    ownerId: player?.id, targetType: 'player', targetId: player?.id, state: 'active',
    source: { ...(previous.source || {}), backing: 'temporaryEffects.active', key },
    duration: { ...(previous.duration || {}), scope: 'personal-turn' },
    payload: { ...(previous.payload || {}), value: cloneDetached(value) },
  };
  if (index >= 0) state.active[index] = record; else state.active.push(record);
  return persistedTemporaryEffectView(player, record, 'player');
}

function addActiveTurnEffect(player, effectKind, value) {
  if (!player || typeof player !== 'object') throw new TypeError('addActiveTurnEffect requires a player object.');
  const key = String(effectKind || '');
  if (!key) throw new TypeError('addActiveTurnEffect requires an effect kind.');
  if (temporaryEffectState(player, false)) {
    const current = getActiveTurnEffectValue(player, key);
    const next = ACTIVE_TURN_NUMERIC_EFFECTS.has(key) ? (Number(current) || 0) + (Number(value) || 0) : Boolean(value);
    return writePersistedActiveTurnEffect(player, key, next);
  }
  if (!player.activeTurnEffects || typeof player.activeTurnEffects !== 'object' || Array.isArray(player.activeTurnEffects)) player.activeTurnEffects = {};
  if (ACTIVE_TURN_NUMERIC_EFFECTS.has(key)) player.activeTurnEffects[key] = (Number(player.activeTurnEffects[key]) || 0) + (Number(value) || 0);
  else player.activeTurnEffects[key] = Boolean(value);
  return getActiveTurnEffect(player, key);
}

function clearActiveTurnEffects(player) {
  if (!player || typeof player !== 'object') return [];
  const state = temporaryEffectState(player, false);
  if (state) {
    state.active = (Array.isArray(state.active) ? state.active : []).filter(record => !String(record?.kind || '').startsWith('active-turn:'));
    return [];
  }
  player.activeTurnEffects = {};
  return [];
}

function scheduleNextTurnEffect(player, effectKind, value) {
  if (!player || typeof player !== 'object') throw new TypeError('scheduleNextTurnEffect requires a player object.');
  const key = String(effectKind || '');
  if (!key) throw new TypeError('scheduleNextTurnEffect requires an effect kind.');
  const state = temporaryEffectState(player, false);
  if (state) {
    if (!Array.isArray(state.scheduled)) state.scheduled = [];
    const index = state.scheduled.findIndex(item => item?.source?.key === key || item?.kind === 'active-turn:' + key);
    const previous = index >= 0 ? state.scheduled[index] : {};
    const current = previous?.payload?.value;
    const next = ACTIVE_TURN_NUMERIC_EFFECTS.has(key) ? (Number(current) || 0) + (Number(value) || 0) : Boolean(value);
    const record = {
      ...previous, kind: 'active-turn:' + key, id: 'next-turn:' + key,
      ownerId: player?.id, targetType: 'player', targetId: player?.id, state: 'scheduled',
      source: { ...(previous.source || {}), backing: 'temporaryEffects.scheduled', key, legacyBacking: 'nextTurnEffects' },
      duration: { ...(previous.duration || {}), activation: 'next-personal-turn' },
      payload: { ...(previous.payload || {}), value: cloneDetached(next) },
    };
    if (index >= 0) state.scheduled[index] = record; else state.scheduled.push(record);
    return persistedTemporaryEffectView(player, record, 'player');
  }
  const legacy = player.nextTurnEffects ||= {};
  if (ACTIVE_TURN_NUMERIC_EFFECTS.has(key)) legacy[key] = (Number(legacy[key]) || 0) + (Number(value) || 0);
  else legacy[key] = Boolean(value);
  return TemporaryEffect.view({
    kind: 'active-turn:' + key, id: 'next-turn:' + key, ownerId: player.id,
    targetType: 'player', targetId: player.id, state: 'scheduled',
    source: { backing: 'nextTurnEffects', key }, duration: { activation: 'next-personal-turn' },
    payload: { value: cloneDetached(legacy[key]) },
  });
}

function scheduledTurnEffectsSnapshot(player) {
  const scheduled = persistedScheduledEffects(player);
  if (scheduled) {
    const result = {};
    for (const record of scheduled) {
      const key = record?.source?.key || String(record?.kind || '').replace(/^active-turn:/, '');
      if (!key || !String(record?.kind || '').startsWith('active-turn:')) continue;
      result[key] = cloneDetached(record?.payload?.value);
    }
    return result;
  }
  return player?.nextTurnEffects && typeof player.nextTurnEffects === 'object' && !Array.isArray(player.nextTurnEffects)
    ? cloneDetached(player.nextTurnEffects) : {};
}

function activateNextTurnEffects(player) {
  if (!player || typeof player !== 'object') return [];
  const state = temporaryEffectState(player, false);
  if (state) {
    const pending = scheduledTurnEffectsSnapshot(player);
    clearActiveTurnEffects(player);
    for (const [effectKind, value] of Object.entries(pending)) addActiveTurnEffect(player, effectKind, value);
    state.scheduled = (Array.isArray(state.scheduled) ? state.scheduled : []).filter(record => !String(record?.kind || '').startsWith('active-turn:'));
    return listActiveTurnEffects(player);
  }
  const pending = player.nextTurnEffects && typeof player.nextTurnEffects === 'object' && !Array.isArray(player.nextTurnEffects) ? cloneDetached(player.nextTurnEffects) : {};
  clearActiveTurnEffects(player);
  for (const [effectKind, value] of Object.entries(pending)) addActiveTurnEffect(player, effectKind, value);
  player.nextTurnEffects = {};
  return listActiveTurnEffects(player);
}

function legacyLegendaryEffectBacking(player) {
  if (!player.legendaryEffects || typeof player.legendaryEffects !== 'object' || Array.isArray(player.legendaryEffects)) player.legendaryEffects = {};
  return player.legendaryEffects;
}

function persistedEffectByKind(target, kind, targetType) {
  const active = persistedActiveEffects(target);
  if (!active) return null;
  return persistedTemporaryEffectView(target, active.find(item => item?.kind === kind), targetType);
}

function replacePersistedEffect(target, kind, record, targetType) {
  const state = temporaryEffectState(target, true);
  const index = state.active.findIndex(item => item?.kind === kind);
  const previous = index >= 0 ? state.active[index] : {};
  const next = { ...previous, ...record, kind };
  if (index >= 0) state.active[index] = next; else state.active.push(next);
  return persistedTemporaryEffectView(target, next, targetType);
}

function removePersistedEffect(target, kind, targetType) {
  const state = temporaryEffectState(target, false);
  if (!state || !Array.isArray(state.active)) return null;
  const index = state.active.findIndex(item => item?.kind === kind);
  if (index < 0) return null;
  const [removed] = state.active.splice(index, 1);
  return persistedTemporaryEffectView(target, removed, targetType);
}

function shipVeilEffectFromLegacy(player, legacy = player?.legendaryEffects?.shipVeil) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  return TemporaryEffect.view({
    kind: 'ship-veil', id: 'ship-veil', ownerId: player?.id, targetType: 'player',
    targetId: player?.id, state: 'active',
    source: { backing: 'legendaryEffects.shipVeil', sourcePlayerId: cloneDetached(legacy.sourcePlayerId) },
    duration: { remaining: cloneDetached(legacy.remaining), ignoreTurnNo: hasOwn(legacy, 'ignoreTurnNo') ? cloneDetached(legacy.ignoreTurnNo) : null },
    payload: {},
  });
}

function getShipVeilEffect(player) {
  if (persistedActiveEffects(player)) return persistedEffectByKind(player, 'ship-veil', 'player');
  return shipVeilEffectFromLegacy(player);
}

function addShipVeilEffect(player, effect) {
  if (!player || typeof player !== 'object') throw new TypeError('addShipVeilEffect requires a player object.');
  const input = effect || {};
  const duration = input.duration && typeof input.duration === 'object' ? input.duration : input;
  const source = input.source && typeof input.source === 'object' ? input.source : input;
  if (temporaryEffectState(player, false)) return replacePersistedEffect(player, 'ship-veil', {
    id: 'ship-veil', ownerId: player.id, targetType: 'player', targetId: player.id, state: 'active',
    source: { backing: 'temporaryEffects.active', sourcePlayerId: cloneDetached(source.sourcePlayerId) },
    duration: { remaining: cloneDetached(duration.remaining), ignoreTurnNo: hasOwn(duration, 'ignoreTurnNo') ? cloneDetached(duration.ignoreTurnNo) : null },
    payload: {},
  }, 'player');
  const backing = legacyLegendaryEffectBacking(player);
  backing.shipVeil = {
    remaining: cloneDetached(duration.remaining), sourcePlayerId: cloneDetached(source.sourcePlayerId),
    ignoreTurnNo: hasOwn(duration, 'ignoreTurnNo') ? cloneDetached(duration.ignoreTurnNo) : null,
  };
  return getShipVeilEffect(player);
}

function removeShipVeilEffect(player) {
  if (persistedActiveEffects(player)) return removePersistedEffect(player, 'ship-veil', 'player');
  const effect = getShipVeilEffect(player);
  if (player?.legendaryEffects && typeof player.legendaryEffects === 'object') delete player.legendaryEffects.shipVeil;
  return effect;
}

function tickShipVeilEffect(player, personalTurnNo) {
  const effect = getShipVeilEffect(player);
  if (!effect) return { effect: null, expired: false, skipped: false };
  const turnNo = Number(personalTurnNo) || 0;
  if (effect.duration.ignoreTurnNo === turnNo) {
    effect.duration.ignoreTurnNo = null;
    return { effect: addShipVeilEffect(player, effect), expired: false, skipped: true };
  }
  effect.duration.remaining = Math.max(0, (Number(effect.duration.remaining) || 0) - 1);
  if (!effect.duration.remaining) {
    removeShipVeilEffect(player);
    return { effect: null, expired: true, skipped: false };
  }
  return { effect: addShipVeilEffect(player, effect), expired: false, skipped: false };
}

function seaCurseEffectFromLegacy(player, legacy, index = 0) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  return TemporaryEffect.view({
    kind: 'sea-curse', id: 'sea-curse:' + index, ownerId: player?.id, targetType: 'player',
    targetId: player?.id, state: 'active',
    source: { backing: 'legendaryEffects.seaCurses', index, sourcePlayerId: cloneDetached(legacy.sourcePlayerId) },
    duration: { remaining: cloneDetached(legacy.remaining) }, payload: { penalty: cloneDetached(legacy.penalty) },
  });
}

function listSeaCurseEffects(player) {
  const persisted = persistedActiveEffects(player);
  if (persisted) return persisted.filter(item => item?.kind === 'sea-curse').map(record => persistedTemporaryEffectView(player, record, 'player')).filter(Boolean);
  const curses = player?.legendaryEffects?.seaCurses;
  if (!Array.isArray(curses)) return [];
  return curses.map((legacy, index) => seaCurseEffectFromLegacy(player, legacy, index)).filter(Boolean);
}

function addSeaCurseEffect(player, effect) {
  if (!player || typeof player !== 'object') throw new TypeError('addSeaCurseEffect requires a player object.');
  const input = effect || {};
  const duration = input.duration && typeof input.duration === 'object' ? input.duration : input;
  const source = input.source && typeof input.source === 'object' ? input.source : input;
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : input;
  if (temporaryEffectState(player, false)) {
    const state = temporaryEffectState(player, true);
    const sequence = Math.max(0, ...state.active.filter(item => item?.kind === 'sea-curse').map(item => {
      const match = String(item?.id || '').match(/^sea-curse:(\d+)$/);
      return match ? Number(match[1]) + 1 : 0;
    }));
    const record = {
      kind: 'sea-curse', id: 'sea-curse:' + sequence, ownerId: player.id,
      targetType: 'player', targetId: player.id, state: 'active',
      source: { backing: 'temporaryEffects.active', sourcePlayerId: hasOwn(source, 'sourcePlayerId') ? cloneDetached(source.sourcePlayerId) : null },
      duration: { remaining: cloneDetached(duration.remaining) }, payload: { penalty: cloneDetached(payload.penalty) },
    };
    state.active.push(record);
    return persistedTemporaryEffectView(player, record, 'player');
  }
  const backing = legacyLegendaryEffectBacking(player);
  if (!Array.isArray(backing.seaCurses)) backing.seaCurses = [];
  backing.seaCurses.push({
    remaining: cloneDetached(duration.remaining), penalty: cloneDetached(payload.penalty),
    sourcePlayerId: hasOwn(source, 'sourcePlayerId') ? cloneDetached(source.sourcePlayerId) : null,
  });
  return seaCurseEffectFromLegacy(player, backing.seaCurses[backing.seaCurses.length - 1], backing.seaCurses.length - 1);
}

function removeSeaCurseEffect(player, index) {
  const persisted = persistedActiveEffects(player);
  if (persisted) {
    const matching = persisted.map((record, actualIndex) => ({ record, actualIndex })).filter(item => item.record?.kind === 'sea-curse');
    if (!Number.isInteger(index) || index < 0 || index >= matching.length) return null;
    const [record] = persisted.splice(matching[index].actualIndex, 1);
    return persistedTemporaryEffectView(player, record, 'player');
  }
  const curses = player?.legendaryEffects?.seaCurses;
  if (!Array.isArray(curses) || !Number.isInteger(index) || index < 0 || index >= curses.length) return null;
  const removed = seaCurseEffectFromLegacy(player, curses[index], index);
  curses.splice(index, 1);
  return removed;
}

function tickSeaCurseEffects(player) {
  const persisted = persistedActiveEffects(player);
  if (persisted) {
    const state = temporaryEffectState(player, true);
    const expired = [];
    const next = [];
    for (const record of state.active) {
      if (record?.kind !== 'sea-curse') { next.push(record); continue; }
      const effect = persistedTemporaryEffectView(player, record, 'player');
      const remaining = Math.max(0, (Number(effect.duration.remaining) || 0) - 1);
      if (!remaining) { expired.push(effect); continue; }
      next.push({ ...record, duration: { ...(record.duration || {}), remaining } });
    }
    state.active = next;
    return { active: listSeaCurseEffects(player), expired };
  }
  const curses = listSeaCurseEffects(player);
  if (!curses.length) {
    if (player?.legendaryEffects && !Array.isArray(player.legendaryEffects.seaCurses)) player.legendaryEffects.seaCurses = [];
    return { active: [], expired: [] };
  }
  const activeLegacy = [];
  const expired = [];
  for (const effect of curses) {
    effect.duration.remaining = Math.max(0, (Number(effect.duration.remaining) || 0) - 1);
    if (!effect.duration.remaining) { expired.push(effect); continue; }
    activeLegacy.push({
      remaining: cloneDetached(effect.duration.remaining), penalty: cloneDetached(effect.payload.penalty),
      sourcePlayerId: hasOwn(effect.source, 'sourcePlayerId') ? cloneDetached(effect.source.sourcePlayerId) : null,
    });
  }
  const backing = legacyLegendaryEffectBacking(player);
  backing.seaCurses = activeLegacy;
  return { active: listSeaCurseEffects(player), expired };
}

function shipVeilReactionEffectFromLegacy(player, legacy = player?.legendaryEffects?.shipVeilReaction) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  return TemporaryEffect.view({
    kind: 'ship-veil-reaction', id: 'ship-veil-reaction', ownerId: player?.id,
    targetType: 'player', targetId: player?.id, state: 'active',
    source: { backing: 'legendaryEffects.shipVeilReaction' },
    duration: { expiry: cloneDetached(legacy.expiry), expiresOnPlayerId: cloneDetached(legacy.expiresOnPlayerId) }, payload: {},
  });
}

function getShipVeilReaction(player) {
  if (persistedActiveEffects(player)) return persistedEffectByKind(player, 'ship-veil-reaction', 'player');
  return shipVeilReactionEffectFromLegacy(player);
}

function addShipVeilReaction(player, effect) {
  if (!player || typeof player !== 'object') throw new TypeError('addShipVeilReaction requires a player object.');
  const duration = effect?.duration && typeof effect.duration === 'object' ? effect.duration : (effect || {});
  if (temporaryEffectState(player, false)) return replacePersistedEffect(player, 'ship-veil-reaction', {
    id: 'ship-veil-reaction', ownerId: player.id, targetType: 'player', targetId: player.id, state: 'active',
    source: { backing: 'temporaryEffects.active' },
    duration: { expiry: cloneDetached(duration.expiry), expiresOnPlayerId: cloneDetached(duration.expiresOnPlayerId) }, payload: {},
  }, 'player');
  const backing = legacyLegendaryEffectBacking(player);
  backing.shipVeilReaction = { expiry: cloneDetached(duration.expiry), expiresOnPlayerId: cloneDetached(duration.expiresOnPlayerId) };
  return getShipVeilReaction(player);
}

function removeShipVeilReaction(player) {
  if (persistedActiveEffects(player)) return removePersistedEffect(player, 'ship-veil-reaction', 'player');
  const effect = getShipVeilReaction(player);
  if (player?.legendaryEffects && typeof player.legendaryEffects === 'object') delete player.legendaryEffects.shipVeilReaction;
  return effect;
}

function listPlayerLegendaryEffects(player) {
  return [getShipVeilEffect(player), ...listSeaCurseEffects(player), getShipVeilReaction(player)].filter(Boolean);
}

function islandVeilEffectFromLegacy(island, legacy = island?.legendaryVeil) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  return TemporaryEffect.view({
    kind: 'island-veil', id: 'island-veil', ownerId: island?.ownerId || null,
    targetType: 'island', targetId: island?.id, state: 'active',
    source: { backing: 'legendaryVeil', sourcePlayerId: cloneDetached(legacy.sourcePlayerId) },
    duration: { remaining: cloneDetached(legacy.remaining), ignoreTurnNo: hasOwn(legacy, 'ignoreTurnNo') ? cloneDetached(legacy.ignoreTurnNo) : null },
    payload: {},
  });
}

function getIslandVeilEffect(island) {
  if (persistedActiveEffects(island)) return persistedEffectByKind(island, 'island-veil', 'island');
  return islandVeilEffectFromLegacy(island);
}

function addIslandVeilEffect(island, effect) {
  if (!island || typeof island !== 'object') throw new TypeError('addIslandVeilEffect requires an island object.');
  const input = effect || {};
  const duration = input.duration && typeof input.duration === 'object' ? input.duration : input;
  const source = input.source && typeof input.source === 'object' ? input.source : input;
  if (temporaryEffectState(island, false)) return replacePersistedEffect(island, 'island-veil', {
    id: 'island-veil', ownerId: island.ownerId || null, targetType: 'island', targetId: island.id, state: 'active',
    source: { backing: 'temporaryEffects.active', sourcePlayerId: cloneDetached(source.sourcePlayerId) },
    duration: { remaining: cloneDetached(duration.remaining), ignoreTurnNo: hasOwn(duration, 'ignoreTurnNo') ? cloneDetached(duration.ignoreTurnNo) : null },
    payload: {},
  }, 'island');
  island.legendaryVeil = {
    remaining: cloneDetached(duration.remaining), sourcePlayerId: cloneDetached(source.sourcePlayerId),
    ignoreTurnNo: hasOwn(duration, 'ignoreTurnNo') ? cloneDetached(duration.ignoreTurnNo) : null,
  };
  return getIslandVeilEffect(island);
}

function removeIslandVeilEffect(island) {
  if (persistedActiveEffects(island)) return removePersistedEffect(island, 'island-veil', 'island');
  const effect = getIslandVeilEffect(island);
  if (island && typeof island === 'object') island.legendaryVeil = null;
  return effect;
}

function tickIslandVeilEffect(island, sourcePlayerId, personalTurnNo) {
  const effect = getIslandVeilEffect(island);
  if (!effect || effect.source.sourcePlayerId !== sourcePlayerId) return { effect, expired: false, skipped: false, matchedSource: false };
  const turnNo = Number(personalTurnNo) || 0;
  if (effect.duration.ignoreTurnNo === turnNo) {
    effect.duration.ignoreTurnNo = null;
    return { effect: addIslandVeilEffect(island, effect), expired: false, skipped: true, matchedSource: true };
  }
  effect.duration.remaining = Math.max(0, (Number(effect.duration.remaining) || 0) - 1);
  if (!effect.duration.remaining) {
    removeIslandVeilEffect(island);
    return { effect: null, expired: true, skipped: false, matchedSource: true };
  }
  return { effect: addIslandVeilEffect(island, effect), expired: false, skipped: false, matchedSource: true };
}

function islandVeilReactionEffectFromLegacy(island, legacy = island?.legendaryVeilReaction) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  return TemporaryEffect.view({
    kind: 'island-veil-reaction', id: 'island-veil-reaction', ownerId: island?.ownerId || null,
    targetType: 'island', targetId: island?.id, state: 'active',
    source: { backing: 'legendaryVeilReaction', sourcePlayerId: cloneDetached(legacy.sourcePlayerId) },
    duration: { expiry: cloneDetached(legacy.expiry), expiresOnPlayerId: cloneDetached(legacy.expiresOnPlayerId) }, payload: {},
  });
}

function getIslandVeilReaction(island) {
  if (persistedActiveEffects(island)) return persistedEffectByKind(island, 'island-veil-reaction', 'island');
  return islandVeilReactionEffectFromLegacy(island);
}

function addIslandVeilReaction(island, effect) {
  if (!island || typeof island !== 'object') throw new TypeError('addIslandVeilReaction requires an island object.');
  const input = effect || {};
  const duration = input.duration && typeof input.duration === 'object' ? input.duration : input;
  const source = input.source && typeof input.source === 'object' ? input.source : input;
  if (temporaryEffectState(island, false)) return replacePersistedEffect(island, 'island-veil-reaction', {
    id: 'island-veil-reaction', ownerId: island.ownerId || null, targetType: 'island', targetId: island.id, state: 'active',
    source: { backing: 'temporaryEffects.active', sourcePlayerId: cloneDetached(source.sourcePlayerId) },
    duration: { expiry: cloneDetached(duration.expiry), expiresOnPlayerId: cloneDetached(duration.expiresOnPlayerId) }, payload: {},
  }, 'island');
  island.legendaryVeilReaction = {
    expiry: cloneDetached(duration.expiry), sourcePlayerId: cloneDetached(source.sourcePlayerId),
    expiresOnPlayerId: cloneDetached(duration.expiresOnPlayerId),
  };
  return getIslandVeilReaction(island);
}

function removeIslandVeilReaction(island) {
  if (persistedActiveEffects(island)) return removePersistedEffect(island, 'island-veil-reaction', 'island');
  const effect = getIslandVeilReaction(island);
  if (island && typeof island === 'object') island.legendaryVeilReaction = null;
  return effect;
}

function listIslandLegendaryEffects(island) {
  return [getIslandVeilEffect(island), getIslandVeilReaction(island)].filter(Boolean);
}

function adoptLegacyTemporaryEffects(target, targetType = 'player') {
  const state = temporaryEffectState(target, false);
  if (!state) return false;
  let changed = false;
  if (targetType === 'player') {
    if (hasOwn(target, 'activeTurnEffects')) {
      state.active = (Array.isArray(state.active) ? state.active : []).filter(record => !String(record?.kind || '').startsWith('active-turn:'));
      for (const [key, value] of Object.entries(target.activeTurnEffects && typeof target.activeTurnEffects === 'object' && !Array.isArray(target.activeTurnEffects) ? target.activeTurnEffects : {})) writePersistedActiveTurnEffect(target, key, value);
      delete target.activeTurnEffects;
      changed = true;
    }
    if (hasOwn(target, 'nextTurnEffects')) {
      state.scheduled = (Array.isArray(state.scheduled) ? state.scheduled : []).filter(record => !String(record?.kind || '').startsWith('active-turn:'));
      for (const [key, value] of Object.entries(target.nextTurnEffects && typeof target.nextTurnEffects === 'object' && !Array.isArray(target.nextTurnEffects) ? target.nextTurnEffects : {})) scheduleNextTurnEffect(target, key, value);
      delete target.nextTurnEffects;
      changed = true;
    }
    if (hasOwn(target, 'legendaryEffects')) {
      state.active = (Array.isArray(state.active) ? state.active : []).filter(record => !['ship-veil', 'sea-curse', 'ship-veil-reaction'].includes(record?.kind));
      const legacy = target.legendaryEffects && typeof target.legendaryEffects === 'object' && !Array.isArray(target.legendaryEffects) ? target.legendaryEffects : {};
      if (legacy.shipVeil && typeof legacy.shipVeil === 'object') addShipVeilEffect(target, legacy.shipVeil);
      for (const curse of (Array.isArray(legacy.seaCurses) ? legacy.seaCurses : [])) addSeaCurseEffect(target, curse);
      if (legacy.shipVeilReaction && typeof legacy.shipVeilReaction === 'object') addShipVeilReaction(target, legacy.shipVeilReaction);
      const extras = {};
      for (const [key, value] of Object.entries(legacy)) if (!['shipVeil', 'seaCurses', 'shipVeilReaction'].includes(key)) extras[key] = cloneDetached(value);
      if (Object.keys(extras).length) {
        state.compatibility ||= {};
        state.compatibility.legendaryEffects = extras;
      }
      delete target.legendaryEffects;
      changed = true;
    }
  } else if (targetType === 'island') {
    if (hasOwn(target, 'legendaryVeil')) {
      removePersistedEffect(target, 'island-veil', 'island');
      if (target.legendaryVeil && typeof target.legendaryVeil === 'object') addIslandVeilEffect(target, target.legendaryVeil);
      delete target.legendaryVeil;
      changed = true;
    }
    if (hasOwn(target, 'legendaryVeilReaction')) {
      removePersistedEffect(target, 'island-veil-reaction', 'island');
      if (target.legendaryVeilReaction && typeof target.legendaryVeilReaction === 'object') addIslandVeilReaction(target, target.legendaryVeilReaction);
      delete target.legendaryVeilReaction;
      changed = true;
    }
  }
  return changed;
}


const PENDING_RESOLUTION_LEGACY_SNAPSHOT = Symbol('domain-state.pending-resolution-legacy-snapshot');
const PENDING_RESOLUTION_FAMILIES = Object.freeze({
  event: Object.freeze({ field: 'pendingEvent', actorField: 'playerId' }),
  feud: Object.freeze({ field: 'pendingFeud', actorField: 'playerId' }),
  'assignment-choice': Object.freeze({ field: 'pendingAssignmentChoice', actorField: 'playerId' }),
  'legendary-reaction': Object.freeze({ field: 'pendingLegendaryReaction', actorField: 'targetPlayerId' }),
});

function pendingResolutionFamilyConfig(family) {
  const key = String(family || '');
  const config = PENDING_RESOLUTION_FAMILIES[key];
  if (!config) throw new TypeError(`Unknown PendingResolution family: ${key || '(empty)'}`);
  return { family: key, ...config };
}

function pendingResolutionFromLegacy(family, legacy) {
  if (legacy === undefined || legacy === null) return legacy;
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
    throw new TypeError('PendingResolution expects a legacy pending object, null, or undefined.');
  }
  const config = pendingResolutionFamilyConfig(family);
  const actorPlayerId = hasOwn(legacy, config.actorField) ? cloneDetached(legacy[config.actorField]) : undefined;
  const payload = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (key === 'id' || key === 'kind' || key === config.actorField || key === 'options') continue;
    payload[key] = cloneDetached(value);
  }
  const semantic = {
    family: config.family,
    state: 'pending',
    source: { backing: config.field },
    payload,
  };
  if (hasOwn(legacy, 'id')) semantic.id = cloneDetached(legacy.id);
  if (hasOwn(legacy, 'kind')) semantic.kind = cloneDetached(legacy.kind);
  if (actorPlayerId !== undefined) {
    semantic.actorPlayerId = actorPlayerId;
    semantic.actorId = cloneDetached(actorPlayerId);
  }
  if (hasOwn(legacy, 'options')) semantic.options = cloneDetached(legacy.options);
  const resolution = PendingResolution.view(semantic);
  Object.defineProperty(resolution, PENDING_RESOLUTION_LEGACY_SNAPSHOT, {
    value: cloneDetached(legacy),
    enumerable: false,
  });
  return resolution;
}

function pendingResolutionToLegacy(resolution) {
  if (resolution === undefined || resolution === null) return resolution;
  if (!PendingResolution.is(resolution) || resolution.state !== 'pending') {
    throw new TypeError('Pending resolution writes expect a pending PendingResolution.');
  }
  const config = pendingResolutionFamilyConfig(resolution.family);
  const snapshot = resolution[PENDING_RESOLUTION_LEGACY_SNAPSHOT];
  const legacy = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? cloneDetached(snapshot) : {};
  if (hasOwn(resolution, 'id')) legacy.id = cloneDetached(resolution.id);
  if (hasOwn(resolution, 'kind')) legacy.kind = cloneDetached(resolution.kind);
  if (hasOwn(resolution, 'actorPlayerId')) legacy[config.actorField] = cloneDetached(resolution.actorPlayerId);
  else if (hasOwn(resolution, 'actorId')) legacy[config.actorField] = cloneDetached(resolution.actorId);
  if (hasOwn(resolution, 'options')) legacy.options = cloneDetached(resolution.options);
  if (resolution.payload && typeof resolution.payload === 'object' && !Array.isArray(resolution.payload)) {
    for (const [key, value] of Object.entries(resolution.payload)) {
      if (key === 'id' || key === 'kind' || key === config.actorField || key === 'options') continue;
      legacy[key] = cloneDetached(value);
    }
  }
  return legacy;
}

function getPendingResolution(room, family) {
  if (!room || typeof room !== 'object') return undefined;
  const config = pendingResolutionFamilyConfig(family);
  if (!hasOwn(room, config.field)) return undefined;
  return pendingResolutionFromLegacy(config.family, room[config.field]);
}

function setPendingResolution(room, family, resolution) {
  if (!room || typeof room !== 'object') throw new TypeError('setPendingResolution requires a room object.');
  const config = pendingResolutionFamilyConfig(family);
  if (resolution === undefined) {
    delete room[config.field];
    return undefined;
  }
  if (resolution === null) {
    room[config.field] = null;
    return null;
  }
  if (!PendingResolution.is(resolution) || resolution.family !== config.family) {
    throw new TypeError(`setPendingResolution expects a ${config.family} PendingResolution.`);
  }
  room[config.field] = pendingResolutionToLegacy(resolution);
  return getPendingResolution(room, config.family);
}

function clearPendingResolution(room, family) {
  if (!room || typeof room !== 'object') throw new TypeError('clearPendingResolution requires a room object.');
  const config = pendingResolutionFamilyConfig(family);
  room[config.field] = null;
  return null;
}

function hasPendingResolution(room, family) {
  const resolution = getPendingResolution(room, family);
  return Boolean(resolution && typeof resolution === 'object');
}

function getPendingEventResolution(room) {
  return getPendingResolution(room, 'event');
}
function getPendingFeudResolution(room) {
  return getPendingResolution(room, 'feud');
}
function getPendingAssignmentChoiceResolution(room) {
  return getPendingResolution(room, 'assignment-choice');
}
function getPendingLegendaryReactionResolution(room) {
  return getPendingResolution(room, 'legendary-reaction');
}



const PRE_TURN_RESOLUTION_FLOW_LEGACY_SNAPSHOT = Symbol('domain-state.pre-turn-resolution-flow-legacy-snapshot');
const PRE_TURN_STAGES = Object.freeze(['sailing', 'political', 'assignment']);

function preTurnStageFromLegacy(stage) {
  return stage === 'feud' ? 'political' : cloneDetached(stage);
}

function preTurnStageToLegacy(stage) {
  return stage === 'political' ? 'feud' : cloneDetached(stage);
}

function preTurnResolutionFlowFromLegacy(legacy) {
  if (legacy === undefined || legacy === null) return legacy;
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
    throw new TypeError('PreTurnResolutionFlow expects a legacy eventPhase object, null, or undefined.');
  }
  const flow = {};
  for (const key of ['active', 'personalTurn', 'turnPlayerId', 'currentPlayerId', 'politicalSnapshot', 'lastCard', 'taxResult']) {
    if (hasOwn(legacy, key)) flow[key] = cloneDetached(legacy[key]);
  }
  if (hasOwn(legacy, 'stage')) flow.stage = preTurnStageFromLegacy(legacy.stage);

  const indexes = {};
  if (hasOwn(legacy, 'playerIndex')) indexes.sailing = cloneDetached(legacy.playerIndex);
  if (hasOwn(legacy, 'feudIndex')) indexes.political = cloneDetached(legacy.feudIndex);
  if (hasOwn(legacy, 'assignmentIndex')) indexes.assignment = cloneDetached(legacy.assignmentIndex);
  if (hasOwn(legacy, 'replacementIndex')) indexes.replacement = cloneDetached(legacy.replacementIndex);
  if (Object.keys(indexes).length) flow.indexes = indexes;

  const queues = {};
  if (hasOwn(legacy, 'feudQueue')) queues.political = cloneDetached(legacy.feudQueue);
  if (hasOwn(legacy, 'assignmentQueue')) queues.assignment = cloneDetached(legacy.assignmentQueue);
  if (hasOwn(legacy, 'replacementQueue')) queues.replacement = cloneDetached(legacy.replacementQueue);
  if (Object.keys(queues).length) flow.queues = queues;

  if (hasOwn(legacy, 'observatoryReplacementsUsed')) {
    flow.counters = { observatoryReplacementsUsed: cloneDetached(legacy.observatoryReplacementsUsed) };
  }

  Object.defineProperty(flow, PRE_TURN_RESOLUTION_FLOW_LEGACY_SNAPSHOT, {
    value: cloneDetached(legacy),
    enumerable: false,
  });
  return flow;
}

function preTurnResolutionFlowToLegacy(flow) {
  if (flow === undefined || flow === null) return flow;
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) {
    throw new TypeError('PreTurnResolutionFlow legacy conversion expects an object, null, or undefined.');
  }
  const snapshot = flow[PRE_TURN_RESOLUTION_FLOW_LEGACY_SNAPSHOT];
  const legacy = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? cloneDetached(snapshot) : {};

  for (const key of ['active', 'personalTurn', 'turnPlayerId', 'currentPlayerId', 'politicalSnapshot', 'lastCard', 'taxResult']) {
    if (hasOwn(flow, key)) legacy[key] = cloneDetached(flow[key]);
  }
  if (hasOwn(flow, 'stage')) legacy.stage = preTurnStageToLegacy(flow.stage);

  if (flow.indexes && typeof flow.indexes === 'object' && !Array.isArray(flow.indexes)) {
    if (hasOwn(flow.indexes, 'sailing')) legacy.playerIndex = cloneDetached(flow.indexes.sailing);
    if (hasOwn(flow.indexes, 'political')) legacy.feudIndex = cloneDetached(flow.indexes.political);
    if (hasOwn(flow.indexes, 'assignment')) legacy.assignmentIndex = cloneDetached(flow.indexes.assignment);
    if (hasOwn(flow.indexes, 'replacement')) legacy.replacementIndex = cloneDetached(flow.indexes.replacement);
  }

  if (flow.queues && typeof flow.queues === 'object' && !Array.isArray(flow.queues)) {
    if (hasOwn(flow.queues, 'political')) legacy.feudQueue = cloneDetached(flow.queues.political);
    if (hasOwn(flow.queues, 'assignment')) legacy.assignmentQueue = cloneDetached(flow.queues.assignment);
    if (hasOwn(flow.queues, 'replacement')) legacy.replacementQueue = cloneDetached(flow.queues.replacement);
  }

  if (flow.counters && typeof flow.counters === 'object' && !Array.isArray(flow.counters)
      && hasOwn(flow.counters, 'observatoryReplacementsUsed')) {
    legacy.observatoryReplacementsUsed = cloneDetached(flow.counters.observatoryReplacementsUsed);
  }
  return legacy;
}

function getPreTurnResolutionFlow(room) {
  if (!room || typeof room !== 'object') throw new TypeError('getPreTurnResolutionFlow requires a room object.');
  if (!hasOwn(room, 'eventPhase')) return undefined;
  return preTurnResolutionFlowFromLegacy(room.eventPhase);
}

function setPreTurnResolutionFlow(room, flow) {
  if (!room || typeof room !== 'object') throw new TypeError('setPreTurnResolutionFlow requires a room object.');
  room.eventPhase = preTurnResolutionFlowToLegacy(flow);
  return getPreTurnResolutionFlow(room);
}

function clearPreTurnResolutionFlow(room) {
  if (!room || typeof room !== 'object') throw new TypeError('clearPreTurnResolutionFlow requires a room object.');
  room.eventPhase = null;
  return null;
}

function mutatePreTurnResolutionFlow(room, mutator) {
  const flow = getPreTurnResolutionFlow(room);
  if (!flow || typeof flow !== 'object') return flow;
  mutator(flow);
  return setPreTurnResolutionFlow(room, flow);
}

function getPreTurnStage(room) {
  return getPreTurnResolutionFlow(room)?.stage;
}

function setPreTurnStage(room, stage, options = {}) {
  if (!PRE_TURN_STAGES.includes(stage)) throw new TypeError('PreTurnResolutionFlow stage must be sailing, political, or assignment.');
  return mutatePreTurnResolutionFlow(room, flow => {
    flow.stage = stage;
    if (hasOwn(options, 'index')) {
      flow.indexes ||= {};
      flow.indexes[stage] = cloneDetached(options.index);
    }
    if (hasOwn(options, 'currentPlayerId')) flow.currentPlayerId = cloneDetached(options.currentPlayerId);
  });
}

function setPreTurnActive(room, active) {
  return mutatePreTurnResolutionFlow(room, flow => { flow.active = Boolean(active); });
}

function getPreTurnStageIndex(room, stage = getPreTurnStage(room)) {
  return getPreTurnResolutionFlow(room)?.indexes?.[stage];
}

function setPreTurnStageIndex(room, stage, index) {
  if (!PRE_TURN_STAGES.includes(stage)) throw new TypeError('PreTurnResolutionFlow cursor stage must be sailing, political, or assignment.');
  return mutatePreTurnResolutionFlow(room, flow => {
    flow.indexes ||= {};
    flow.indexes[stage] = cloneDetached(index);
  });
}

function advancePreTurnStageIndex(room, stage, amount = 1) {
  const current = Number(getPreTurnStageIndex(room, stage)) || 0;
  const next = current + (Number(amount) || 0);
  setPreTurnStageIndex(room, stage, next);
  return next;
}

function setPreTurnCurrentPlayer(room, playerId) {
  return mutatePreTurnResolutionFlow(room, flow => { flow.currentPlayerId = cloneDetached(playerId); });
}

function setPreTurnLastCard(room, card) {
  return mutatePreTurnResolutionFlow(room, flow => { flow.lastCard = cloneDetached(card); });
}

function getPreTurnObservatoryReplacementsUsed(room) {
  return Math.max(0, Number(getPreTurnResolutionFlow(room)?.counters?.observatoryReplacementsUsed) || 0);
}

function incrementObservatoryReplacement(room) {
  const next = getPreTurnObservatoryReplacementsUsed(room) + 1;
  mutatePreTurnResolutionFlow(room, flow => {
    flow.counters ||= {};
    flow.counters.observatoryReplacementsUsed = next;
  });
  return next;
}

function setPreTurnTaxResult(room, result) {
  return mutatePreTurnResolutionFlow(room, flow => { flow.taxResult = cloneDetached(result); });
}

const RESOLUTION_QUEUE_FIELD = 'pendingExpeditionRewards';

function resolutionQueueBacking(room, create = false) {
  if (!room || typeof room !== 'object') throw new TypeError('ResolutionQueue requires a room object.');
  if (!hasOwn(room, RESOLUTION_QUEUE_FIELD)) {
    if (!create) return null;
    room[RESOLUTION_QUEUE_FIELD] = [];
  }
  const queue = room[RESOLUTION_QUEUE_FIELD];
  if (!Array.isArray(queue)) {
    throw new TypeError('ResolutionQueue backing must be an array. Run compatibility normalization first.');
  }
  return queue;
}

function listResolutionQueue(room) {
  const queue = resolutionQueueBacking(room, false);
  return queue ? cloneDetached(queue) : [];
}

function peekResolutionQueue(room) {
  const queue = resolutionQueueBacking(room, false);
  if (!queue?.length) return undefined;
  return cloneDetached(queue[0]);
}

function enqueueResolution(room, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new TypeError('enqueueResolution expects a legacy queue item object.');
  }
  const queue = resolutionQueueBacking(room, true);
  const stored = cloneDetached(item);
  queue.push(stored);
  return cloneDetached(stored);
}

function dequeueResolution(room) {
  const queue = resolutionQueueBacking(room, false);
  if (!queue?.length) return undefined;
  return cloneDetached(queue.shift());
}

function resolutionQueueLength(room) {
  const queue = resolutionQueueBacking(room, false);
  return queue?.length || 0;
}

function createLegacyFieldAdapter(target, key, contract, options = {}) {
  if (!target || typeof target !== 'object') throw new TypeError('Legacy field adapter requires a target object.');
  if (!contract || typeof contract.view !== 'function' || typeof contract.toLegacy !== 'function') {
    throw new TypeError('Legacy field adapter requires a domain contract.');
  }
  const collection = Boolean(options.collection);

  return Object.freeze({
    presence() {
      return presenceOf(target, key);
    },
    read() {
      if (!hasOwn(target, key)) return undefined;
      return collection ? contract.list(target[key]) : contract.view(target[key]);
    },
    write(value) {
      if (value === ABSENT || value === undefined) {
        delete target[key];
        return undefined;
      }
      const previous = target[key];
      target[key] = collection
        ? contract.listToLegacy(value, previous)
        : contract.toLegacy(value, previous);
      return target[key];
    },
  });
}

module.exports = {
  ABSENT,
  Task,
  ConsumableAbility,
  StoredBenefit,
  Discovery,
  TemporaryEffect,
  PendingResolution,
  HistoryRecord,
  activeAssignmentTaskFromLegacy,
  activeAssignmentTaskFromPersisted,
  activeAssignmentTaskToLegacy,
  activeAssignmentTaskToPersisted,
  getActiveAssignmentTask,
  assignTask,
  completeAssignmentTask,
  activeExpeditionTaskFromLegacy,
  activeExpeditionTaskToLegacy,
  getActiveExpeditionTask,
  assignExpeditionTask,
  completeExpeditionTask,
  expeditionHistoryRecordFromLegacy,
  expeditionHistoryRecordToLegacy,
  getExpeditionHistoryRecords,
  setExpeditionHistoryRecords,
  addCompletedExpeditionRecord,
  countExpeditionCompletions,
  getExpeditionUsage,
  expeditionTakenThisRound,
  recordExpeditionTaken,
  resetExpeditionRoundUsage,
  legendaryConsumableAbilityFromLegacy,
  specialConsumableAbilityFromLegacy,
  consumableAbilityToLegacy,
  listLegendaryAbilities,
  listSpecialAbilities,
  listConsumableAbilities,
  grantConsumableAbility,
  grantLegendaryAbility,
  grantSpecialAbility,
  peekConsumableAbility,
  consumeConsumableAbility,
  storedBenefitFromLegacy,
  storedBenefitFromPersisted,
  storedBenefitToLegacy,
  listStoredBenefits,
  peekStoredBenefit,
  storeBenefit,
  consumeStoredBenefit,
  discardStoredBenefit,
  discoveryFromRegistryEntry,
  getDiscovery,
  listDiscoveries,
  listPlayerDiscoveries,
  hasDiscovery,
  claimDiscovery,
  activeTurnEffectFromLegacy,
  listActiveTurnEffects,
  getActiveTurnEffect,
  getActiveTurnEffectValue,
  activeTurnEffectsSnapshot,
  addActiveTurnEffect,
  clearActiveTurnEffects,
  scheduleNextTurnEffect,
  scheduledTurnEffectsSnapshot,
  activateNextTurnEffects,
  shipVeilEffectFromLegacy,
  getShipVeilEffect,
  addShipVeilEffect,
  removeShipVeilEffect,
  tickShipVeilEffect,
  seaCurseEffectFromLegacy,
  listSeaCurseEffects,
  addSeaCurseEffect,
  removeSeaCurseEffect,
  tickSeaCurseEffects,
  shipVeilReactionEffectFromLegacy,
  getShipVeilReaction,
  addShipVeilReaction,
  removeShipVeilReaction,
  listPlayerLegendaryEffects,
  islandVeilEffectFromLegacy,
  getIslandVeilEffect,
  addIslandVeilEffect,
  removeIslandVeilEffect,
  tickIslandVeilEffect,
  islandVeilReactionEffectFromLegacy,
  getIslandVeilReaction,
  addIslandVeilReaction,
  removeIslandVeilReaction,
  listIslandLegendaryEffects,
  adoptLegacyTemporaryEffects,
  PENDING_RESOLUTION_FAMILIES,
  pendingResolutionFromLegacy,
  pendingResolutionToLegacy,
  getPendingResolution,
  setPendingResolution,
  clearPendingResolution,
  hasPendingResolution,
  getPendingEventResolution,
  getPendingFeudResolution,
  getPendingAssignmentChoiceResolution,
  getPendingLegendaryReactionResolution,
  PRE_TURN_STAGES,
  preTurnResolutionFlowFromLegacy,
  preTurnResolutionFlowToLegacy,
  getPreTurnResolutionFlow,
  setPreTurnResolutionFlow,
  clearPreTurnResolutionFlow,
  getPreTurnStage,
  setPreTurnStage,
  setPreTurnActive,
  getPreTurnStageIndex,
  setPreTurnStageIndex,
  advancePreTurnStageIndex,
  setPreTurnCurrentPlayer,
  setPreTurnLastCard,
  getPreTurnObservatoryReplacementsUsed,
  incrementObservatoryReplacement,
  setPreTurnTaxResult,
  RESOLUTION_QUEUE_FIELD,
  listResolutionQueue,
  peekResolutionQueue,
  enqueueResolution,
  dequeueResolution,
  resolutionQueueLength,
  presenceOf,
  createLegacyFieldAdapter,
};
