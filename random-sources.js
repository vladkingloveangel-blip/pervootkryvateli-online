'use strict';

// Semantic random-source helpers only. They own no room state and perform no persistence.
// Source-specific adapters in later slices may pass their existing storage arrays into these operations.

const ELIGIBILITY = Object.freeze({
  ELIGIBLE: 'eligible',
  SKIP: 'skip',
  REMOVE: 'remove',
});

function unitSample(rng = Math.random) {
  const raw = Number(rng());
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(0.999999999999, raw));
}

function randomIndex(length, rng = Math.random) {
  const size = Math.max(0, Math.floor(Number(length) || 0));
  if (!size) return -1;
  return Math.floor(unitSample(rng) * size);
}

function selectIndependent(values, rng = Math.random) {
  if (!Array.isArray(values) || !values.length) return null;
  return values[randomIndex(values.length, rng)] ?? null;
}

function shuffleWithRng(values, rng = Math.random) {
  const out = Array.isArray(values) ? [...values] : [];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, rng);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function refreshCyclicAvailable(available, recyclable, rng = Math.random) {
  if (!Array.isArray(available) || !Array.isArray(recyclable)) {
    throw new TypeError('Cyclic source storage must provide available and recyclable arrays.');
  }
  if (available.length || !recyclable.length) return false;
  const refreshed = shuffleWithRng(recyclable, rng);
  recyclable.splice(0, recyclable.length);
  available.push(...refreshed);
  return true;
}

function consumeCyclic(available, recyclable, rng = Math.random) {
  refreshCyclicAvailable(available, recyclable, rng);
  if (!available.length) return null;
  const occurrence = available.shift();
  recyclable.push(occurrence);
  return occurrence;
}

function peekOrderedCyclic(available, recyclable, rng = Math.random) {
  refreshCyclicAvailable(available, recyclable, rng);
  return available.length ? available[0] : null;
}

function requireKeyOf(keyOf) {
  if (typeof keyOf !== 'function') throw new TypeError('A keyOf function is required for reservable source operations.');
  return keyOf;
}

function reserveRecyclableOccurrence(recyclable, reserved, occurrence, keyOf) {
  if (!Array.isArray(recyclable) || !Array.isArray(reserved)) {
    throw new TypeError('Reservable cyclic storage must provide recyclable and reserved arrays.');
  }
  const key = requireKeyOf(keyOf)(occurrence);
  if (reserved.some(item => keyOf(item) === key)) return false;
  const index = recyclable.findIndex(item => keyOf(item) === key);
  if (index < 0) return false;
  const [stored] = recyclable.splice(index, 1);
  reserved.push(stored);
  return true;
}

function releaseReservedOccurrence(reserved, recyclable, key, keyOf) {
  if (!Array.isArray(recyclable) || !Array.isArray(reserved)) {
    throw new TypeError('Reservable cyclic storage must provide recyclable and reserved arrays.');
  }
  requireKeyOf(keyOf);
  const index = reserved.findIndex(item => keyOf(item) === key);
  if (index < 0) return false;
  const [released] = reserved.splice(index, 1);
  recyclable.push(released);
  return true;
}

function selectFilteredTasks(available, recyclable, removed, options = {}) {
  if (!Array.isArray(available) || !Array.isArray(recyclable) || !Array.isArray(removed)) {
    throw new TypeError('Filtered pool storage must provide available, recyclable and removed arrays.');
  }
  const classify = options.classify;
  if (typeof classify !== 'function') throw new TypeError('Filtered pool requires a classify function.');
  const rng = options.rng || Math.random;
  const wanted = Math.max(1, Math.floor(Number(options.count) || 1));
  const chosen = [];
  const skipped = [];
  let recycled = false;

  while (chosen.length < wanted) {
    if (!available.length) {
      if (recycled || !recyclable.length) break;
      available.push(...shuffleWithRng(recyclable, rng));
      recyclable.splice(0, recyclable.length);
      recycled = true;
    }

    const entry = available.shift();
    const status = classify(entry);
    if (status === ELIGIBILITY.ELIGIBLE) chosen.push(entry);
    else if (status === ELIGIBILITY.SKIP) skipped.push(entry);
    else if (status === ELIGIBILITY.REMOVE) removed.push(entry);
    else throw new Error(`Unknown eligibility status: ${String(status)}`);
  }

  if (skipped.length) {
    const restored = shuffleWithRng([...available, ...skipped], rng);
    available.splice(0, available.length, ...restored);
  }
  return chosen;
}

function reserveRandomEntry(available, reserved, options = {}) {
  if (!Array.isArray(available) || !Array.isArray(reserved)) {
    throw new TypeError('Reservable pool storage must provide available and reserved arrays.');
  }
  const keyOf = requireKeyOf(options.keyOf);
  const eligible = typeof options.eligible === 'function' ? options.eligible : () => true;
  const candidateIndexes = [];
  for (let i = 0; i < available.length; i++) {
    if (eligible(available[i])) candidateIndexes.push(i);
  }
  if (!candidateIndexes.length) return null;
  const pickedIndex = candidateIndexes[randomIndex(candidateIndexes.length, options.rng || Math.random)];
  const [entry] = available.splice(pickedIndex, 1);
  const key = keyOf(entry);
  if (reserved.some(item => keyOf(item) === key)) {
    available.splice(pickedIndex, 0, entry);
    throw new Error(`Entry is already reserved: ${String(key)}`);
  }
  reserved.push(entry);
  return entry;
}

function releaseReservedEntry(reserved, available, key, options = {}) {
  if (!Array.isArray(available) || !Array.isArray(reserved)) {
    throw new TypeError('Reservable pool storage must provide available and reserved arrays.');
  }
  const keyOf = requireKeyOf(options.keyOf);
  const index = reserved.findIndex(item => keyOf(item) === key);
  if (index < 0) return false;
  const [entry] = reserved.splice(index, 1);
  available.push(entry);
  if (options.rng) {
    const reordered = shuffleWithRng(available, options.rng);
    available.splice(0, available.length, ...reordered);
  }
  return true;
}

module.exports = {
  ELIGIBILITY,
  randomIndex,
  selectIndependent,
  shuffleWithRng,
  refreshCyclicAvailable,
  consumeCyclic,
  peekOrderedCyclic,
  reserveRecyclableOccurrence,
  releaseReservedOccurrence,
  selectFilteredTasks,
  reserveRandomEntry,
  releaseReservedEntry,
};
