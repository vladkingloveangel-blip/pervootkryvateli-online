'use strict';

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
const ConsumableAbility = defineContract('ConsumableAbility', ['kind', 'id', 'ownerId', 'source', 'payload']);
const StoredBenefit = defineContract('StoredBenefit', ['kind', 'id', 'ownerId', 'state', 'source', 'payload']);
const Discovery = defineContract('Discovery', ['kind', 'id', 'ownerId', 'state', 'source', 'payload', 'claimedById']);
const TemporaryEffect = defineContract('TemporaryEffect', ['kind', 'id', 'ownerId', 'targetType', 'targetId', 'state', 'source', 'payload', 'duration']);
const PendingResolution = defineContract('PendingResolution', ['family', 'kind', 'id', 'actorId', 'actorPlayerId', 'state', 'source', 'payload', 'options']);
const HistoryRecord = defineContract('HistoryRecord', ['kind', 'id', 'ownerId', 'state', 'source', 'payload', 'completedAt']);

const ACTIVE_ASSIGNMENT_LEGACY_SNAPSHOT = Symbol('domain-state.active-assignment-legacy-snapshot');

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

function getActiveAssignmentTask(player) {
  if (!player || typeof player !== 'object' || !hasOwn(player, 'activeAssignment')) return undefined;
  return activeAssignmentTaskFromLegacy(player, player.activeAssignment);
}

function activeAssignmentTaskToLegacy(task) {
  if (task === undefined || task === null) return task;
  if (!Task.is(task) || task.kind !== 'assignment' || task.state !== 'active') {
    throw new TypeError('assignTask expects an active assignment Task.');
  }
  const snapshot = task[ACTIVE_ASSIGNMENT_LEGACY_SNAPSHOT];
  const legacy = snapshot && typeof snapshot === 'object' ? cloneDetached(snapshot) : {};
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

function assignTask(player, task) {
  if (!player || typeof player !== 'object') throw new TypeError('assignTask requires a player object.');
  if (!Task.is(task) || task.kind !== 'assignment' || task.state !== 'active') {
    throw new TypeError('assignTask expects an active assignment Task.');
  }
  if (task.ownerId != null && player.id != null && String(task.ownerId) !== String(player.id)) {
    throw new TypeError('Assignment Task ownerId does not match the target player.');
  }
  player.activeAssignment = activeAssignmentTaskToLegacy(task);
  return player.activeAssignment;
}

function completeAssignmentTask(player) {
  if (!player || typeof player !== 'object') throw new TypeError('completeAssignmentTask requires a player object.');
  const task = getActiveAssignmentTask(player);
  const legacy = task === undefined || task === null ? task : activeAssignmentTaskToLegacy(task);
  player.activeAssignment = null;
  return legacy;
}


const ACTIVE_EXPEDITION_LEGACY_SNAPSHOT = Symbol('domain-state.active-expedition-legacy-snapshot');
const EXPEDITION_HISTORY_LEGACY_SNAPSHOT = Symbol('domain-state.expedition-history-legacy-snapshot');

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

function getActiveExpeditionTask(player) {
  if (!player || typeof player !== 'object' || !hasOwn(player, 'activeExpedition')) return undefined;
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

function assignExpeditionTask(player, task) {
  if (!player || typeof player !== 'object') throw new TypeError('assignExpeditionTask requires a player object.');
  if (!Task.is(task) || task.kind !== 'expedition' || task.state !== 'active') {
    throw new TypeError('assignExpeditionTask expects an active expedition Task.');
  }
  if (task.ownerId != null && player.id != null && String(task.ownerId) !== String(player.id)) {
    throw new TypeError('Expedition Task ownerId does not match the target player.');
  }
  player.activeExpedition = activeExpeditionTaskToLegacy(task);
  return player.activeExpedition;
}

function completeExpeditionTask(player) {
  if (!player || typeof player !== 'object') throw new TypeError('completeExpeditionTask requires a player object.');
  const task = getActiveExpeditionTask(player);
  const legacy = task === undefined || task === null ? task : activeExpeditionTaskToLegacy(task);
  player.activeExpedition = null;
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

function getExpeditionHistoryRecords(player) {
  if (!player || typeof player !== 'object' || !hasOwn(player, 'expeditionHistory')) return undefined;
  const history = player.expeditionHistory;
  if (history === null) return null;
  if (!Array.isArray(history)) throw new TypeError('Expedition history backing field must be an array, null, or absent.');
  return history.map(entry => expeditionHistoryRecordFromLegacy(player, entry));
}

function setExpeditionHistoryRecords(player, records) {
  if (!player || typeof player !== 'object') throw new TypeError('setExpeditionHistoryRecords requires a player object.');
  if (records === undefined) {
    delete player.expeditionHistory;
    return undefined;
  }
  if (records === null) {
    player.expeditionHistory = null;
    return null;
  }
  if (!Array.isArray(records)) throw new TypeError('setExpeditionHistoryRecords expects an array, null, or undefined.');
  player.expeditionHistory = records.map(expeditionHistoryRecordToLegacy);
  return player.expeditionHistory;
}

function addCompletedExpeditionRecord(player, record) {
  if (!player || typeof player !== 'object') throw new TypeError('addCompletedExpeditionRecord requires a player object.');
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
  player.expeditionDrawRound = Number(round) || 1;
  player.expeditionsDrawnThisRound = 1;
  return getExpeditionUsage(player);
}

function resetExpeditionRoundUsage(player) {
  if (!player || typeof player !== 'object') throw new TypeError('resetExpeditionRoundUsage requires a player object.');
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

function listLegendaryAbilities(player) {
  if (!player || typeof player !== 'object' || !hasOwn(player, 'legendaryCards')) return undefined;
  if (player.legendaryCards === null) return null;
  if (!Array.isArray(player.legendaryCards)) throw new TypeError('legendaryCards backing field must be an array, null, or absent.');
  return player.legendaryCards.map((card, index) => legendaryConsumableAbilityFromLegacy(player, card, index));
}

function listSpecialAbilities(player) {
  if (!player || typeof player !== 'object' || !hasOwn(player, 'specialCards')) return undefined;
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

function grantConsumableAbility(player, ability) {
  if (!player || typeof player !== 'object') throw new TypeError('grantConsumableAbility requires a player object.');
  if (!ConsumableAbility.is(ability)) throw new TypeError('grantConsumableAbility expects a ConsumableAbility.');
  if (ability.ownerId != null && player.id != null && String(ability.ownerId) !== String(player.id)) {
    throw new TypeError('ConsumableAbility ownerId does not match the target player.');
  }
  const inventory = ability.source?.inventory;
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
  const index = Array.isArray(player?.legendaryCards) ? player.legendaryCards.length : 0;
  return grantConsumableAbility(player, legendaryConsumableAbilityFromLegacy(player, card, index));
}

function grantSpecialAbility(player, name) {
  const index = Array.isArray(player?.specialCards) ? player.specialCards.length : 0;
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

function storedBenefitToLegacy(benefit) {
  if (benefit === undefined || benefit === null) return benefit;
  if (!StoredBenefit.is(benefit) || benefit.state !== 'stored') {
    throw new TypeError('Stored benefit writes expect a stored StoredBenefit.');
  }
  const snapshot = benefit[STORED_BENEFIT_LEGACY_SNAPSHOT];
  const hasSnapshot = Boolean(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot));
  const legacy = hasSnapshot ? cloneDetached(snapshot) : {};
  const source = benefit.source && typeof benefit.source === 'object' ? benefit.source : {};
  const payload = benefit.payload && typeof benefit.payload === 'object' ? benefit.payload : {};

  if (!hasSnapshot || hasOwn(snapshot, 'id')) {
    if (hasOwn(benefit, 'id')) legacy.id = cloneDetached(benefit.id);
    else delete legacy.id;
  }
  if (!hasSnapshot || hasOwn(snapshot, 'kind')) {
    if (hasOwn(benefit, 'kind')) legacy.kind = cloneDetached(benefit.kind);
    else delete legacy.kind;
  }
  if (!hasSnapshot || hasOwn(snapshot, 'sourceDeck')) {
    if (hasOwn(source, 'deck')) legacy.sourceDeck = cloneDetached(source.deck);
    else delete legacy.sourceDeck;
  }
  if (!hasSnapshot || hasOwn(snapshot, 'sourceCard')) {
    if (hasOwn(source, 'occurrence')) legacy.sourceCard = cloneDetached(source.occurrence);
    else delete legacy.sourceCard;
  }
  for (const key of ['name', 'goodId', 'assignmentInstanceId']) {
    if (hasSnapshot && !hasOwn(snapshot, key)) continue;
    if (hasOwn(payload, key)) legacy[key] = cloneDetached(payload[key]);
    else delete legacy[key];
  }
  return legacy;
}

function listStoredBenefits(player) {
  if (!player || typeof player !== 'object' || !hasOwn(player, 'savedEventCards')) return undefined;
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
  return benefits.find(benefit => benefit?.id === id) || null;
}

function storeBenefit(player, benefit) {
  if (!player || typeof player !== 'object') throw new TypeError('storeBenefit requires a player object.');
  if (!StoredBenefit.is(benefit) || benefit.state !== 'stored') {
    throw new TypeError('storeBenefit expects a stored StoredBenefit.');
  }
  if (benefit.ownerId != null && player.id != null && String(benefit.ownerId) !== String(player.id)) {
    throw new TypeError('StoredBenefit ownerId does not match the target player.');
  }
  const legacy = storedBenefitToLegacy(benefit);
  if (player.savedEventCards == null) player.savedEventCards = [];
  if (!Array.isArray(player.savedEventCards)) throw new TypeError('savedEventCards backing field must be an array.');
  player.savedEventCards.push(legacy);
  return storedBenefitFromLegacy(player, legacy);
}

function consumeStoredBenefit(player, savedCardId) {
  if (!player || typeof player !== 'object' || !Array.isArray(player.savedEventCards)) return null;
  const id = String(savedCardId || '');
  const index = player.savedEventCards.findIndex(entry => entry?.id === id);
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
  if (Array.isArray(placeDefinitions)) {
    return placeDefinitions.find(definition => String(definition?.id || '') === id) || null;
  }
  if (typeof placeDefinitions !== 'object') return null;
  if (String(placeDefinitions.id || '') === id) return placeDefinitions;
  const direct = placeDefinitions[id];
  return direct && typeof direct === 'object' && !Array.isArray(direct) ? direct : null;
}

function discoveryFromRegistryEntry(placeId, ownerId, placeDefinitions = null) {
  const id = String(placeId || '');
  if (!id || ownerId === undefined || ownerId === null || String(ownerId) === '') return null;
  const definition = discoveryDefinitionFor(placeDefinitions, id);
  const source = {
    registry: 'legendaryPlacesExplored',
    placeId: id,
  };
  if (definition) {
    if (hasOwn(definition, 'kind')) source.placeKind = cloneDetached(definition.kind);
    if (hasOwn(definition, 'mapPlaceId')) source.mapPlaceId = cloneDetached(definition.mapPlaceId);
    if (hasOwn(definition, 'islandId')) source.islandId = cloneDetached(definition.islandId);
  }
  return Discovery.view({
    kind: 'legendary-place',
    id,
    ownerId: cloneDetached(ownerId),
    claimedById: cloneDetached(ownerId),
    state: 'claimed',
    source,
    payload: definition ? cloneDetached(definition) : { id },
  });
}

function getDiscovery(room, placeId, placeDefinitions = null) {
  const registry = room?.legendaryPlacesExplored;
  const id = String(placeId || '');
  if (!id || !registry || typeof registry !== 'object' || Array.isArray(registry) || !hasOwn(registry, id)) return null;
  return discoveryFromRegistryEntry(id, registry[id], placeDefinitions);
}

function listDiscoveries(room, placeDefinitions = null) {
  const registry = room?.legendaryPlacesExplored;
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) return [];
  return Object.keys(registry)
    .map(placeId => getDiscovery(room, placeId, placeDefinitions))
    .filter(Boolean);
}

function listPlayerDiscoveries(room, playerId, placeDefinitions = null) {
  if (playerId === undefined || playerId === null) return [];
  return listDiscoveries(room, placeDefinitions)
    .filter(discovery => String(discovery.ownerId) === String(playerId));
}

function hasDiscovery(room, placeId) {
  return Boolean(getDiscovery(room, placeId));
}

function claimDiscovery(room, placeId, playerId, placeDefinitions = null) {
  if (!room || typeof room !== 'object') throw new TypeError('claimDiscovery requires a room object.');
  const id = String(placeId || '');
  if (!id) throw new TypeError('claimDiscovery requires a placeId.');
  if (playerId === undefined || playerId === null || String(playerId) === '') {
    throw new TypeError('claimDiscovery requires a playerId.');
  }
  if (!room.legendaryPlacesExplored || typeof room.legendaryPlacesExplored !== 'object' || Array.isArray(room.legendaryPlacesExplored)) {
    room.legendaryPlacesExplored = {};
  }

  const existing = getDiscovery(room, id, placeDefinitions);
  if (existing) {
    return {
      first: false,
      existingOwnerId: existing.ownerId,
      ownerId: existing.ownerId,
      discovery: existing,
    };
  }

  room.legendaryPlacesExplored[id] = playerId;
  const discovery = getDiscovery(room, id, placeDefinitions);
  return {
    first: true,
    existingOwnerId: null,
    ownerId: discovery.ownerId,
    discovery,
  };
}


const ACTIVE_TURN_NUMERIC_EFFECTS = new Set(['moveBonus', 'movePenalty']);

function activeTurnEffectFromLegacy(player, effectKind, value) {
  const key = String(effectKind || '');
  if (!key || value === undefined) return null;
  return TemporaryEffect.view({
    kind: `active-turn:${key}`,
    id: `active-turn:${key}`,
    ownerId: player?.id,
    targetType: 'player',
    targetId: player?.id,
    state: 'active',
    source: { backing: 'activeTurnEffects', key },
    duration: { scope: 'personal-turn' },
    payload: { value: cloneDetached(value) },
  });
}

function listActiveTurnEffects(player) {
  const backing = player?.activeTurnEffects;
  if (!backing || typeof backing !== 'object' || Array.isArray(backing)) return [];
  return Object.entries(backing)
    .map(([key, value]) => activeTurnEffectFromLegacy(player, key, value))
    .filter(Boolean);
}

function getActiveTurnEffect(player, effectKind) {
  const key = String(effectKind || '');
  if (!key || !player?.activeTurnEffects || typeof player.activeTurnEffects !== 'object' || Array.isArray(player.activeTurnEffects) || !hasOwn(player.activeTurnEffects, key)) return null;
  return activeTurnEffectFromLegacy(player, key, player.activeTurnEffects[key]);
}

function getActiveTurnEffectValue(player, effectKind) {
  return getActiveTurnEffect(player, effectKind)?.payload?.value;
}

function activeTurnEffectsSnapshot(player) {
  return Object.fromEntries(listActiveTurnEffects(player).map(effect => [effect.source.key, cloneDetached(effect.payload.value)]));
}

function addActiveTurnEffect(player, effectKind, value) {
  if (!player || typeof player !== 'object') throw new TypeError('addActiveTurnEffect requires a player object.');
  const key = String(effectKind || '');
  if (!key) throw new TypeError('addActiveTurnEffect requires an effect kind.');
  if (!player.activeTurnEffects || typeof player.activeTurnEffects !== 'object' || Array.isArray(player.activeTurnEffects)) player.activeTurnEffects = {};
  if (ACTIVE_TURN_NUMERIC_EFFECTS.has(key)) {
    player.activeTurnEffects[key] = (Number(player.activeTurnEffects[key]) || 0) + (Number(value) || 0);
  } else {
    player.activeTurnEffects[key] = Boolean(value);
  }
  return getActiveTurnEffect(player, key);
}

function clearActiveTurnEffects(player) {
  if (!player || typeof player !== 'object') return [];
  player.activeTurnEffects = {};
  return [];
}

function ensurePlayerLegendaryEffectBacking(player) {
  if (!player.legendaryEffects || typeof player.legendaryEffects !== 'object' || Array.isArray(player.legendaryEffects)) player.legendaryEffects = {};
  return player.legendaryEffects;
}

function shipVeilEffectFromLegacy(player, legacy = player?.legendaryEffects?.shipVeil) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  return TemporaryEffect.view({
    kind: 'ship-veil',
    id: 'ship-veil',
    ownerId: player?.id,
    targetType: 'player',
    targetId: player?.id,
    state: 'active',
    source: {
      backing: 'legendaryEffects.shipVeil',
      sourcePlayerId: cloneDetached(legacy.sourcePlayerId),
    },
    duration: {
      remaining: cloneDetached(legacy.remaining),
      ignoreTurnNo: hasOwn(legacy, 'ignoreTurnNo') ? cloneDetached(legacy.ignoreTurnNo) : null,
    },
    payload: {},
  });
}

function getShipVeilEffect(player) {
  return shipVeilEffectFromLegacy(player);
}

function addShipVeilEffect(player, effect) {
  if (!player || typeof player !== 'object') throw new TypeError('addShipVeilEffect requires a player object.');
  const input = effect || {};
  const duration = input.duration && typeof input.duration === 'object' ? input.duration : input;
  const source = input.source && typeof input.source === 'object' ? input.source : input;
  const backing = ensurePlayerLegendaryEffectBacking(player);
  backing.shipVeil = {
    remaining: cloneDetached(duration.remaining),
    sourcePlayerId: cloneDetached(source.sourcePlayerId),
    ignoreTurnNo: hasOwn(duration, 'ignoreTurnNo') ? cloneDetached(duration.ignoreTurnNo) : null,
  };
  return getShipVeilEffect(player);
}

function removeShipVeilEffect(player) {
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
    kind: 'sea-curse',
    id: `sea-curse:${index}`,
    ownerId: player?.id,
    targetType: 'player',
    targetId: player?.id,
    state: 'active',
    source: {
      backing: 'legendaryEffects.seaCurses',
      index,
      sourcePlayerId: cloneDetached(legacy.sourcePlayerId),
    },
    duration: { remaining: cloneDetached(legacy.remaining) },
    payload: { penalty: cloneDetached(legacy.penalty) },
  });
}

function listSeaCurseEffects(player) {
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
  const backing = ensurePlayerLegendaryEffectBacking(player);
  if (!Array.isArray(backing.seaCurses)) backing.seaCurses = [];
  backing.seaCurses.push({
    remaining: cloneDetached(duration.remaining),
    penalty: cloneDetached(payload.penalty),
    sourcePlayerId: hasOwn(source, 'sourcePlayerId') ? cloneDetached(source.sourcePlayerId) : null,
  });
  return seaCurseEffectFromLegacy(player, backing.seaCurses[backing.seaCurses.length - 1], backing.seaCurses.length - 1);
}

function removeSeaCurseEffect(player, index) {
  const curses = player?.legendaryEffects?.seaCurses;
  if (!Array.isArray(curses) || !Number.isInteger(index) || index < 0 || index >= curses.length) return null;
  const removed = seaCurseEffectFromLegacy(player, curses[index], index);
  curses.splice(index, 1);
  return removed;
}

function tickSeaCurseEffects(player) {
  const curses = listSeaCurseEffects(player);
  if (!curses.length) {
    if (player?.legendaryEffects && !Array.isArray(player.legendaryEffects.seaCurses)) player.legendaryEffects.seaCurses = [];
    return { active: [], expired: [] };
  }
  const activeLegacy = [];
  const expired = [];
  for (const effect of curses) {
    effect.duration.remaining = Math.max(0, (Number(effect.duration.remaining) || 0) - 1);
    if (!effect.duration.remaining) {
      expired.push(effect);
      continue;
    }
    activeLegacy.push({
      remaining: cloneDetached(effect.duration.remaining),
      penalty: cloneDetached(effect.payload.penalty),
      sourcePlayerId: hasOwn(effect.source, 'sourcePlayerId') ? cloneDetached(effect.source.sourcePlayerId) : null,
    });
  }
  const backing = ensurePlayerLegendaryEffectBacking(player);
  backing.seaCurses = activeLegacy;
  return { active: listSeaCurseEffects(player), expired };
}

function shipVeilReactionEffectFromLegacy(player, legacy = player?.legendaryEffects?.shipVeilReaction) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  return TemporaryEffect.view({
    kind: 'ship-veil-reaction',
    id: 'ship-veil-reaction',
    ownerId: player?.id,
    targetType: 'player',
    targetId: player?.id,
    state: 'active',
    source: { backing: 'legendaryEffects.shipVeilReaction' },
    duration: {
      expiry: cloneDetached(legacy.expiry),
      expiresOnPlayerId: cloneDetached(legacy.expiresOnPlayerId),
    },
    payload: {},
  });
}

function getShipVeilReaction(player) {
  return shipVeilReactionEffectFromLegacy(player);
}

function addShipVeilReaction(player, effect) {
  if (!player || typeof player !== 'object') throw new TypeError('addShipVeilReaction requires a player object.');
  const duration = effect?.duration && typeof effect.duration === 'object' ? effect.duration : (effect || {});
  const backing = ensurePlayerLegendaryEffectBacking(player);
  backing.shipVeilReaction = {
    expiry: cloneDetached(duration.expiry),
    expiresOnPlayerId: cloneDetached(duration.expiresOnPlayerId),
  };
  return getShipVeilReaction(player);
}

function removeShipVeilReaction(player) {
  const effect = getShipVeilReaction(player);
  if (player?.legendaryEffects && typeof player.legendaryEffects === 'object') delete player.legendaryEffects.shipVeilReaction;
  return effect;
}

function listPlayerLegendaryEffects(player) {
  return [
    getShipVeilEffect(player),
    ...listSeaCurseEffects(player),
    getShipVeilReaction(player),
  ].filter(Boolean);
}

function islandVeilEffectFromLegacy(island, legacy = island?.legendaryVeil) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return null;
  return TemporaryEffect.view({
    kind: 'island-veil',
    id: 'island-veil',
    ownerId: island?.ownerId || null,
    targetType: 'island',
    targetId: island?.id,
    state: 'active',
    source: {
      backing: 'legendaryVeil',
      sourcePlayerId: cloneDetached(legacy.sourcePlayerId),
    },
    duration: {
      remaining: cloneDetached(legacy.remaining),
      ignoreTurnNo: hasOwn(legacy, 'ignoreTurnNo') ? cloneDetached(legacy.ignoreTurnNo) : null,
    },
    payload: {},
  });
}

function getIslandVeilEffect(island) {
  return islandVeilEffectFromLegacy(island);
}

function addIslandVeilEffect(island, effect) {
  if (!island || typeof island !== 'object') throw new TypeError('addIslandVeilEffect requires an island object.');
  const input = effect || {};
  const duration = input.duration && typeof input.duration === 'object' ? input.duration : input;
  const source = input.source && typeof input.source === 'object' ? input.source : input;
  island.legendaryVeil = {
    remaining: cloneDetached(duration.remaining),
    sourcePlayerId: cloneDetached(source.sourcePlayerId),
    ignoreTurnNo: hasOwn(duration, 'ignoreTurnNo') ? cloneDetached(duration.ignoreTurnNo) : null,
  };
  return getIslandVeilEffect(island);
}

function removeIslandVeilEffect(island) {
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
    kind: 'island-veil-reaction',
    id: 'island-veil-reaction',
    ownerId: island?.ownerId || null,
    targetType: 'island',
    targetId: island?.id,
    state: 'active',
    source: {
      backing: 'legendaryVeilReaction',
      sourcePlayerId: cloneDetached(legacy.sourcePlayerId),
    },
    duration: {
      expiry: cloneDetached(legacy.expiry),
      expiresOnPlayerId: cloneDetached(legacy.expiresOnPlayerId),
    },
    payload: {},
  });
}

function getIslandVeilReaction(island) {
  return islandVeilReactionEffectFromLegacy(island);
}

function addIslandVeilReaction(island, effect) {
  if (!island || typeof island !== 'object') throw new TypeError('addIslandVeilReaction requires an island object.');
  const input = effect || {};
  const duration = input.duration && typeof input.duration === 'object' ? input.duration : input;
  const source = input.source && typeof input.source === 'object' ? input.source : input;
  island.legendaryVeilReaction = {
    expiry: cloneDetached(duration.expiry),
    sourcePlayerId: cloneDetached(source.sourcePlayerId),
    expiresOnPlayerId: cloneDetached(duration.expiresOnPlayerId),
  };
  return getIslandVeilReaction(island);
}

function removeIslandVeilReaction(island) {
  const effect = getIslandVeilReaction(island);
  if (island && typeof island === 'object') island.legendaryVeilReaction = null;
  return effect;
}

function listIslandLegendaryEffects(island) {
  return [getIslandVeilEffect(island), getIslandVeilReaction(island)].filter(Boolean);
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
  activeAssignmentTaskToLegacy,
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
  presenceOf,
  createLegacyFieldAdapter,
};
