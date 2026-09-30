'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../domain-state');

const contracts = [
  ['Task', Task, { kind: 'assignment', id: 'task-1', ownerId: 'p1', state: 'active', source: { factionId: 'mori' }, payload: { reward: 20 }, progress: { visits: 2 }, ignored: 'nope' }],
  ['ConsumableAbility', ConsumableAbility, { kind: 'legendary', id: 'ability-1', ownerId: 'p1', source: { placeId: 'legendary-1' }, payload: { effect: 'mist' }, ignored: 'nope' }],
  ['StoredBenefit', StoredBenefit, { kind: 'saved-event', id: 'benefit-1', ownerId: 'p1', state: 'stored', source: { occurrenceId: 'event-17', reservationKey: 'event-17#2' }, payload: { goodId: 'wood' }, ignored: 'nope' }],
  ['Discovery', Discovery, { kind: 'legendary-place', id: 'discovery-1', ownerId: 'p1', state: 'claimed', source: { placeId: 'atlantis' }, payload: { glory: 3 }, claimedById: 'p1', ignored: 'nope' }],
  ['TemporaryEffect', TemporaryEffect, { kind: 'sea-curse', id: 'effect-1', ownerId: 'p1', state: 'active', source: { playerId: 'p2' }, payload: { penalty: 1 }, duration: { remainingTurns: 2 }, ignored: 'nope' }],
  ['PendingResolution', PendingResolution, { kind: 'event-choice', id: 'pending-1', actorId: 'p1', state: 'waiting', source: { occurrenceId: 'event-9' }, payload: { cardName: 'Choice' }, options: [{ id: 'a' }, { id: 'b' }], ignored: 'nope' }],
  ['HistoryRecord', HistoryRecord, { kind: 'expedition', id: 'history-1', ownerId: 'p1', state: 'completed', source: { expeditionId: 'exp-1' }, payload: { reward: 25, completedRound: 4 }, completedAt: { round: 4 }, ignored: 'nope' }],
];

for (const [name, contract, legacy] of contracts) {
  test(`${name} view is detached and exposes only its explicit contract`, () => {
    const before = structuredClone(legacy);
    const view = contract.view(legacy);
    assert.equal(contract.is(view), true);
    assert.equal(Object.prototype.hasOwnProperty.call(view, 'ignored'), false);
    assert.equal(JSON.stringify(view).includes('ignored'), false);
    const nestedKey = Object.keys(view).find(key => view[key] && typeof view[key] === 'object');
    if (nestedKey) {
      if (Array.isArray(view[nestedKey])) view[nestedKey].push({ changed: true });
      else view[nestedKey].changed = true;
    }
    assert.deepEqual(legacy, before);
  });
}

test('Task keeps stable identity and progress-like payload through facade round-trip', () => {
  const legacy = { instanceId: 'legacy-slot', kind: 'assignment', id: 'task-42', ownerId: 'p1', progress: { completedStopCount: 2 }, payload: { reward: 30 }, unknownLegacy: { keep: true } };
  const view = Task.view(legacy);
  assert.equal(view.id, 'task-42');
  assert.deepEqual(view.progress, { completedStopCount: 2 });
  assert.deepEqual(Task.toLegacy(view), legacy);
});

test('ConsumableAbility collections preserve duplicates and instance ordering', () => {
  const legacy = [
    { kind: 'legendary', id: 'mist-path', source: { copy: 1 }, payload: { strength: 1 } },
    { kind: 'legendary', id: 'mist-path', source: { copy: 2 }, payload: { strength: 1 } },
  ];
  const views = ConsumableAbility.list(legacy);
  assert.equal(views.length, 2);
  assert.equal(views[0].id, views[1].id);
  assert.notStrictEqual(views[0], views[1]);
  assert.deepEqual(ConsumableAbility.listToLegacy(views), legacy);
});

test('semantic source/linkage, claim, duration, actor/options and completed data are representable without storage changes', () => {
  const benefit = StoredBenefit.view({ id: 'b', source: { reservationKey: 'event#3' }, payload: { ducats: 10 } });
  const discovery = Discovery.view({ id: 'd', claimedById: 'p2', source: { placeId: 'named-place' } });
  const effect = TemporaryEffect.view({ id: 'e', source: { abilityId: 'a1' }, duration: { remainingTurns: 2 }, payload: { movePenalty: 1 } });
  const pending = PendingResolution.view({ id: 'p', actorId: 'p3', options: [{ id: 'left' }, { id: 'right' }], payload: { continuation: 'events' } });
  const history = HistoryRecord.view({ id: 'h', completedAt: { round: 5 }, payload: { placeId: 'x', reward: 40 } });
  assert.equal(benefit.source.reservationKey, 'event#3');
  assert.equal(discovery.claimedById, 'p2');
  assert.equal(effect.duration.remainingTurns, 2);
  assert.deepEqual(pending.options.map(option => option.id), ['left', 'right']);
  assert.equal(history.payload.reward, 40);
});

test('null, absent, empty-array and existing-record semantics stay distinct', () => {
  const target = { nullTask: null, abilities: [], task: { kind: 'assignment', id: 't1' } };
  assert.equal(presenceOf(target, 'missing'), 'absent');
  assert.equal(presenceOf(target, 'nullTask'), 'null');
  assert.equal(presenceOf(target, 'abilities'), 'empty-array');
  assert.equal(presenceOf(target, 'task'), 'value');
  assert.equal(Task.view(undefined), undefined);
  assert.equal(Task.view(null), null);
  assert.equal(ConsumableAbility.list(undefined), undefined);
  assert.equal(ConsumableAbility.list(null), null);
  assert.deepEqual(ConsumableAbility.list([]), []);
});

test('explicit field adapter writes only selected legacy backing and preserves legacy JSON shape', () => {
  const player = {
    id: 'p1',
    activeAssignment: { kind: 'assignment', id: 'task-1', progress: { count: 1 }, legacyOnly: { keep: true } },
    legendaryCards: [{ kind: 'legendary', id: 'same' }, { kind: 'legendary', id: 'same' }],
    neighbor: { untouched: true },
  };
  const beforeKeys = Object.keys(player);
  const taskAdapter = createLegacyFieldAdapter(player, 'activeAssignment', Task);
  const task = taskAdapter.read();
  task.progress.count = 2;
  taskAdapter.write(task);
  assert.equal(player.activeAssignment.progress.count, 2);
  assert.deepEqual(player.activeAssignment.legacyOnly, { keep: true });
  assert.deepEqual(player.neighbor, { untouched: true });
  assert.deepEqual(Object.keys(player), beforeKeys);

  const abilityAdapter = createLegacyFieldAdapter(player, 'legendaryCards', ConsumableAbility, { collection: true });
  const abilities = abilityAdapter.read();
  abilityAdapter.write(abilities);
  assert.deepEqual(player.legendaryCards.map(card => card.id), ['same', 'same']);
  assert.equal(Object.prototype.hasOwnProperty.call(player, 'abilities'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(player, 'tasks'), false);
});

test('legacy -> domain -> legacy round-trip is deepEqual and read-only facade leaves authoritative JSON byte-equivalent', () => {
  const room = {
    code: 'ABCDE',
    pendingEvent: { kind: 'event-choice', id: 'pending-1', actorId: 'p1', options: [{ id: 'a' }], legacyOnly: 'keep' },
    players: [{
      id: 'p1',
      activeAssignment: { kind: 'assignment', id: 'task-1', progress: { count: 1 }, legacyOnly: 7 },
      legendaryCards: [{ kind: 'legendary', id: 'ability-1', source: { placeId: 'x' }, legacyOnly: 8 }],
    }],
  };
  const before = structuredClone(room);
  const beforeJson = JSON.stringify(room);
  const player = room.players[0];
  const taskAdapter = createLegacyFieldAdapter(player, 'activeAssignment', Task);
  const abilityAdapter = createLegacyFieldAdapter(player, 'legendaryCards', ConsumableAbility, { collection: true });
  const pendingAdapter = createLegacyFieldAdapter(room, 'pendingEvent', PendingResolution);

  const task = taskAdapter.read();
  const abilities = abilityAdapter.read();
  const pending = pendingAdapter.read();
  assert.equal(JSON.stringify(room), beforeJson);
  assert.deepEqual(room, before);

  taskAdapter.write(task);
  abilityAdapter.write(abilities);
  pendingAdapter.write(pending);
  assert.deepEqual(room, before);
  assert.equal(JSON.stringify(room), beforeJson);
  for (const forbidden of ['tasks', 'abilities', 'benefits', 'discoveries', 'effects', 'pendingResolutions', 'historyRecords']) {
    assert.equal(Object.prototype.hasOwnProperty.call(room, forbidden), false);
    assert.equal(Object.prototype.hasOwnProperty.call(player, forbidden), false);
  }
});

test('adapter preserves absent/null/empty-array state and ABSENT removes only its backing field', () => {
  const target = { missingNeighbor: 1, nullable: null, entries: [] };
  const missing = createLegacyFieldAdapter(target, 'missing', Task);
  const nullable = createLegacyFieldAdapter(target, 'nullable', Task);
  const entries = createLegacyFieldAdapter(target, 'entries', ConsumableAbility, { collection: true });
  assert.equal(missing.read(), undefined);
  missing.write(missing.read());
  assert.equal(Object.prototype.hasOwnProperty.call(target, 'missing'), false);
  assert.equal(nullable.read(), null);
  nullable.write(nullable.read());
  assert.equal(target.nullable, null);
  assert.deepEqual(entries.read(), []);
  entries.write(entries.read());
  assert.deepEqual(target.entries, []);
  nullable.write(ABSENT);
  assert.equal(Object.prototype.hasOwnProperty.call(target, 'nullable'), false);
  assert.equal(target.missingNeighbor, 1);
});

test('domain helper metadata is non-enumerable and never copied into legacy state', () => {
  const legacy = { kind: 'assignment', id: 't1', payload: { nested: true } };
  const view = Task.view(legacy);
  assert.deepEqual(Object.keys(view).sort(), ['id', 'kind', 'payload']);
  assert.equal(JSON.stringify(view), JSON.stringify({ kind: 'assignment', id: 't1', payload: { nested: true } }));
  const written = Task.toLegacy(view);
  assert.deepEqual(written, legacy);
  assert.deepEqual(Object.getOwnPropertySymbols(written), []);
});
