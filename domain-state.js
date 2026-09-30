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
const TemporaryEffect = defineContract('TemporaryEffect', ['kind', 'id', 'ownerId', 'state', 'source', 'payload', 'duration']);
const PendingResolution = defineContract('PendingResolution', ['kind', 'id', 'actorId', 'state', 'source', 'payload', 'options']);
const HistoryRecord = defineContract('HistoryRecord', ['kind', 'id', 'ownerId', 'state', 'source', 'payload', 'completedAt']);

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
  presenceOf,
  createLegacyFieldAdapter,
};
