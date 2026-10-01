'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { newDb } = require('pg-mem');
const { ANCHOR_CARDS, POLITICAL_FACTION_ORDER } = require('../game-data');
const {
  CURRENT_DIGITAL_MODEL_SCHEMA_VERSION,
  SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION,
  RANDOM_SOURCE_STATE_FIELD,
  migrateRoomState,
} = require('../save-migrations');
const { RoomStore } = require('../room-store');
const { seaEncounterSource } = require('../sea-encounter-source');
const { sailingEventSource, releaseStoredBenefitReservation } = require('../sailing-event-source');
const { politicalEffectSource } = require('../political-effect-source');

const logger = { log() {}, error() {} };
const anchorColor = Object.keys(ANCHOR_CARDS)[0];
const factionId = POLITICAL_FACTION_ORDER[0];

function pool() {
  const { Pool } = newDb({ noAstCoverageCheck: true }).adapters.createPg();
  return new Pool();
}

function v1Fixture() {
  const held = { id: 'held-event', copy: 7, unknownHeld: { keep: true } };
  return {
    code: 'ABCDE',
    digitalModelSchemaVersion: 1,
    rulesDataVersion: 'legacy-rules-data',
    rulesSchemaVersion: 77,
    runtimeProfile: 'legacy-runtime-profile',
    started: true,
    phase: 'actions',
    players: [{
      id: 'p1',
      socketId: 'stale-socket',
      connected: true,
      savedEventCards: [{
        id: 'held-benefit',
        kind: 'ship-master',
        sourceDeck: 'event',
        sourceCard: held,
      }],
      activeAssignment: { instanceId: 'assignment-1', card: { id: 'mori-a' } },
      activeExpedition: { instanceId: 'expedition-1', card: { id: 'exp-a' } },
      expeditionHistory: [{ definitionId: 'exp-old', completedRound: 2 }],
      legendaryCards: [{ id: 'sea-veil', copy: 2 }],
      specialCards: ['treasure-hunter'],
      namedPlaceCards: [{ placeId: 'place-1', claimedBy: 'p1' }],
      legendaryPlacesExplored: ['place-1'],
      activeTurnEffects: { movement: [{ id: 'effect-1', amount: 1 }] },
      nextTurnEffects: { moveBonus: 2 },
      futurePlayerField: { nested: ['keep', { exactly: true }] },
    }],
    islands: [{ id: 'island-1', ownerId: 'p1', futureIslandField: { keep: 9 } }],
    order: ['p1'],
    anchorDecks: {
      [anchorColor]: {
        drawPile: [{ id: 'sea-next', copy: 1 }, { id: 'sea-tail', copy: 2 }],
        discard: [{ id: 'sea-used', copy: 3 }],
        futureBucketField: { keep: 'sea' },
      },
    },
    eventDeck: {
      drawPile: [{ id: 'sail-next', copy: 1 }, { id: 'sail-tail', copy: 2 }],
      discard: [{ id: 'sail-used', copy: 3 }],
      futureBucketField: { keep: 'sailing' },
    },
    feudDecks: {
      [factionId]: {
        drawPile: [{ id: 'political-next', copy: 1 }, { id: 'political-tail', copy: 2 }],
        discard: [{ id: 'political-used', copy: 3 }],
        futureBucketField: { keep: 'political' },
      },
    },
    assignmentDecks: { mori: { drawPile: [{ id: 'assignment-a' }], discard: [], removed: [] } },
    expeditionDeck: { drawPile: [{ id: 'expedition-a' }] },
    pendingExpeditionRewards: [{ id: 'reward-1' }],
    pendingEvent: null,
    pendingFeud: null,
    pendingAssignmentChoice: { id: 'pending-assignment', playerId: 'p1' },
    pendingLegendaryReaction: { id: 'pending-legendary', playerId: 'p1' },
    eventPhase: { active: true, stage: 'assignment', assignmentIndex: 1 },
    unknownLegacyRoot: { nested: { array: [1, 2, { keep: 'yes' }] } },
  };
}

function sequence(values) {
  let index = 0;
  const rng = () => values[index++] ?? 0;
  rng.calls = () => index;
  return rng;
}

test('1 -> 2 migrates only the three source families into semantic persisted backing', () => {
  const raw = v1Fixture();
  const before = structuredClone(raw);
  const result = migrateRoomState(raw);

  assert.equal(result.migrated, true);
  assert.equal(result.fromVersion, 1);
  assert.equal(result.toVersion, SOURCE_STATE_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(result.state.digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(raw, before);
  assert.equal(Object.hasOwn(result.state, 'anchorDecks'), false);
  assert.equal(Object.hasOwn(result.state, 'eventDeck'), false);
  assert.equal(Object.hasOwn(result.state, 'feudDecks'), false);

  const sources = result.state[RANDOM_SOURCE_STATE_FIELD];
  assert.deepEqual(sources.seaEncounter[anchorColor].available, before.anchorDecks[anchorColor].drawPile);
  assert.deepEqual(sources.seaEncounter[anchorColor].recyclable, before.anchorDecks[anchorColor].discard);
  assert.deepEqual(sources.seaEncounter[anchorColor].futureBucketField, { keep: 'sea' });
  assert.deepEqual(sources.sailingEvent.available, before.eventDeck.drawPile);
  assert.deepEqual(sources.sailingEvent.recyclable, before.eventDeck.discard);
  assert.deepEqual(sources.sailingEvent.reserved, [before.players[0].savedEventCards[0].sourceCard]);
  assert.deepEqual(sources.sailingEvent.futureBucketField, { keep: 'sailing' });
  assert.deepEqual(sources.politicalEffect[factionId].available, before.feudDecks[factionId].drawPile);
  assert.deepEqual(sources.politicalEffect[factionId].recyclable, before.feudDecks[factionId].discard);
  assert.deepEqual(sources.politicalEffect[factionId].reserved, []);
  assert.deepEqual(sources.politicalEffect[factionId].futureBucketField, { keep: 'political' });

  for (const field of ['assignmentDecks','expeditionDeck','pendingExpeditionRewards','pendingEvent','pendingFeud','pendingAssignmentChoice','pendingLegendaryReaction','eventPhase']) {
    assert.deepEqual(result.state[field], before[field], field);
  }
  assert.deepEqual(result.state.players, before.players);
  assert.deepEqual(result.state.unknownLegacyRoot, before.unknownLegacyRoot);
  assert.equal(result.state.rulesDataVersion, before.rulesDataVersion);
  assert.equal(result.state.rulesSchemaVersion, before.rulesSchemaVersion);
  assert.equal(result.state.runtimeProfile, before.runtimeProfile);
});

test('unversioned old save chains 0 -> 1 -> 2 without mutating input or calling RNG', () => {
  const raw = v1Fixture();
  delete raw.digitalModelSchemaVersion;
  const before = structuredClone(raw);
  const originalRandom = Math.random;
  let calls = 0;
  Math.random = () => { calls += 1; throw new Error('migration must not use RNG'); };
  try {
    const result = migrateRoomState(raw);
    assert.equal(result.fromVersion, 0);
    assert.equal(result.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
    assert.equal(result.migrated, true);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(calls, 0);
  assert.deepEqual(raw, before);
});

test('known next outcomes and remaining order are identical after migration', () => {
  const legacy = v1Fixture();
  legacy.players[0].savedEventCards = [];
  const migrated = migrateRoomState(legacy).state;
  const noRng = () => { throw new Error('known next must not need RNG'); };

  const legacySea = seaEncounterSource(structuredClone(legacy), anchorColor, noRng);
  const migratedSea = seaEncounterSource(migrated, anchorColor, noRng);
  assert.deepEqual(migratedSea.peekNext(), legacySea.peekNext());
  assert.deepEqual(
    migrated[RANDOM_SOURCE_STATE_FIELD].seaEncounter[anchorColor].available.map(x => x.id),
    legacy.anchorDecks[anchorColor].drawPile.map(x => x.id)
  );

  const legacySailingRoom = structuredClone(legacy);
  const migratedSailingRoom = migrateRoomState(legacy).state;
  assert.deepEqual(
    sailingEventSource(migratedSailingRoom, noRng).consumeNext(),
    sailingEventSource(legacySailingRoom, noRng).consumeNext()
  );

  const legacyPoliticalRoom = structuredClone(legacy);
  const migratedPoliticalRoom = migrateRoomState(legacy).state;
  assert.deepEqual(
    politicalEffectSource(migratedPoliticalRoom, factionId, noRng).consumeNext(),
    politicalEffectSource(legacyPoliticalRoom, factionId, noRng).consumeNext()
  );
});

test('empty available + recyclable refresh preserves legacy RNG semantics for all three source types', () => {
  const raw = v1Fixture();
  raw.players[0].savedEventCards = [];
  raw.anchorDecks[anchorColor] = { drawPile: [], discard: [{ id: 'sa', copy: 1 }, { id: 'sb', copy: 2 }, { id: 'sc', copy: 3 }] };
  raw.eventDeck = { drawPile: [], discard: [{ id: 'ea', copy: 1 }, { id: 'eb', copy: 2 }, { id: 'ec', copy: 3 }] };
  raw.feudDecks[factionId] = { drawPile: [], discard: [{ id: 'pa', copy: 1 }, { id: 'pb', copy: 2 }, { id: 'pc', copy: 3 }] };

  for (const family of ['sea','sailing','political']) {
    const oldRoom = structuredClone(raw);
    const newRoom = migrateRoomState(raw).state;
    const oldRng = sequence([0.8, 0.1]);
    const newRng = sequence([0.8, 0.1]);
    let oldOutcome;
    let newOutcome;
    if (family === 'sea') {
      oldOutcome = seaEncounterSource(oldRoom, anchorColor, oldRng).consumeNext();
      newOutcome = seaEncounterSource(newRoom, anchorColor, newRng).consumeNext();
    } else if (family === 'sailing') {
      oldOutcome = sailingEventSource(oldRoom, oldRng).consumeNext();
      newOutcome = sailingEventSource(newRoom, newRng).consumeNext();
    } else {
      oldOutcome = politicalEffectSource(oldRoom, factionId, oldRng).consumeNext();
      newOutcome = politicalEffectSource(newRoom, factionId, newRng).consumeNext();
    }
    assert.deepEqual(newOutcome, oldOutcome, family);
    assert.equal(newRng.calls(), oldRng.calls(), family);
  }
});

test('held Sailing occurrence migrates to reserved and releases exactly once', () => {
  const raw = v1Fixture();
  const held = raw.players[0].savedEventCards[0].sourceCard;
  const migrated = migrateRoomState(raw).state;
  const sailing = migrated[RANDOM_SOURCE_STATE_FIELD].sailingEvent;
  assert.deepEqual(sailing.reserved, [held]);
  assert.equal(sailing.available.some(x => x.id === held.id), false);
  assert.equal(sailing.recyclable.some(x => x.id === held.id), false);

  const benefit = { source: { deck: 'event', occurrence: held } };
  assert.equal(releaseStoredBenefitReservation(migrated, benefit), true);
  assert.equal(releaseStoredBenefitReservation(migrated, benefit), false);
  assert.equal(sailing.reserved.length, 0);
  assert.equal(sailing.recyclable.filter(x => x.id === held.id).length, 1);
});

test('pending Sailing and Political occurrences survive migration without redraw or reselection', () => {
  const raw = v1Fixture();
  raw.players[0].savedEventCards = [];
  const pendingSailing = { id: 'pending-sailing', copy: 9, payload: { keep: true } };
  raw.pendingEvent = { id: 'pe', origin: 'event-phase', kind: 'observatory', eventCard: pendingSailing, options: [{ id: 'keep' }, { id: 'replace' }] };
  const pendingPolitical = { id: 'pending-political', copy: 8, payload: { keep: true } };
  raw.pendingFeud = { id: 'pf', factionId, feudCard: pendingPolitical, kind: 'remove-building' };

  // Deliberately place them in legacy buckets too: migration must reserve, not make them drawable.
  raw.eventDeck.drawPile.unshift(structuredClone(pendingSailing));
  raw.feudDecks[factionId].drawPile.unshift(structuredClone(pendingPolitical));

  const beforePendingEvent = structuredClone(raw.pendingEvent);
  const beforePendingFeud = structuredClone(raw.pendingFeud);
  const migrated = migrateRoomState(raw).state;
  const sailing = migrated[RANDOM_SOURCE_STATE_FIELD].sailingEvent;
  const political = migrated[RANDOM_SOURCE_STATE_FIELD].politicalEffect[factionId];

  assert.deepEqual(migrated.pendingEvent, beforePendingEvent);
  assert.deepEqual(migrated.pendingFeud, beforePendingFeud);
  assert.equal(sailing.available.some(x => x.id === pendingSailing.id), false);
  assert.equal(sailing.reserved.filter(x => x.id === pendingSailing.id).length, 1);
  assert.equal(political.available.some(x => x.id === pendingPolitical.id), false);
  assert.equal(political.reserved.filter(x => x.id === pendingPolitical.id).length, 1);

  assert.equal(sailingEventSource(migrated, () => { throw new Error('no RNG'); }).markUsed(pendingSailing), true);
  assert.equal(politicalEffectSource(migrated, factionId, () => { throw new Error('no RNG'); }).markUsed(pendingPolitical), true);
  assert.equal(sailing.recyclable.filter(x => x.id === pendingSailing.id).length, 1);
  assert.equal(political.recyclable.filter(x => x.id === pendingPolitical.id).length, 1);
});

test('old pending continuation matches migrated continuation for Observatory replace and Political finish', () => {
  const old = v1Fixture();
  old.players[0].savedEventCards = [];
  const first = { id: 'observed-first', copy: 1 };
  old.pendingEvent = { id: 'obs', origin: 'event-phase', kind: 'observatory', eventCard: first };
  old.eventDeck = { drawPile: [{ id: 'mandatory-second', copy: 2 }], discard: [] };
  const feud = { id: 'pending-feud-card', copy: 4 };
  old.pendingFeud = { id: 'feud', factionId, feudCard: feud };
  old.feudDecks[factionId] = { drawPile: [{ id: 'political-next', copy: 5 }], discard: [] };

  const oldRoom = structuredClone(old);
  const newRoom = migrateRoomState(old).state;
  const oldSailing = sailingEventSource(oldRoom, () => 0);
  const newSailing = sailingEventSource(newRoom, () => 0);
  assert.deepEqual(newSailing.replaceObserved(newRoom.pendingEvent.eventCard), oldSailing.replaceObserved(oldRoom.pendingEvent.eventCard));

  const oldPolitical = politicalEffectSource(oldRoom, factionId, () => 0);
  const newPolitical = politicalEffectSource(newRoom, factionId, () => 0);
  assert.equal(newPolitical.markUsed(newRoom.pendingFeud.feudCard), oldPolitical.markUsed(oldRoom.pendingFeud.feudCard));
  assert.deepEqual(newPolitical.consumeNext(), oldPolitical.consumeNext());
});

test('already-current version 2 room is a content-exact no-op and second migration is idempotent', () => {
  const current = migrateRoomState(v1Fixture()).state;
  const direct = migrateRoomState(current);
  assert.equal(direct.migrated, false);
  assert.equal(direct.fromVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.equal(direct.toVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.deepEqual(direct.state, current);

  const second = migrateRoomState(direct.state);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.state, current);
});

test('malformed and future digital model schema versions are rejected', () => {
  for (const version of [-1, 0.5, '2', NaN]) {
    assert.throws(() => migrateRoomState({ ...v1Fixture(), digitalModelSchemaVersion: version }), /Invalid digital model schema version/);
  }
  assert.throws(
    () => migrateRoomState({ ...v1Fixture(), digitalModelSchemaVersion: CURRENT_DIGITAL_MODEL_SCHEMA_VERSION + 1 }),
    /Unsupported future digital model schema version/
  );
});

test('RoomStore.init migrates v1 source backing before validation without rewriting DB row immediately', async () => {
  const db = pool();
  const setup = new RoomStore(db, { logger });
  await setup.init(new Map());
  const raw = v1Fixture();
  await db.query('INSERT INTO game_rooms (code, state) VALUES ($1,$2::jsonb)', [raw.code, JSON.stringify(raw)]);

  const rooms = new Map();
  await new RoomStore(db, { logger }).init(rooms);
  const restored = rooms.get(raw.code);
  assert.equal(restored.digitalModelSchemaVersion, CURRENT_DIGITAL_MODEL_SCHEMA_VERSION);
  assert.ok(restored[RANDOM_SOURCE_STATE_FIELD]);
  assert.equal(Object.hasOwn(restored, 'anchorDecks'), false);
  assert.equal(Object.hasOwn(restored, 'eventDeck'), false);
  assert.equal(Object.hasOwn(restored, 'feudDecks'), false);
  assert.equal(restored.players[0].socketId, null);
  assert.equal(restored.players[0].connected, false);

  const persisted = (await db.query('SELECT state FROM game_rooms WHERE code = $1', [raw.code])).rows[0].state;
  assert.equal(persisted.digitalModelSchemaVersion, 1);
  assert.ok(persisted.anchorDecks);
  assert.ok(persisted.eventDeck);
  assert.ok(persisted.feudDecks);
});

test('invalid saved rooms keep Invalid saved room contract and guest/no-DB mode remains safe', async () => {
  const db = pool();
  const store = new RoomStore(db, { logger });
  await store.init(new Map());
  await db.query('INSERT INTO game_rooms (code, state) VALUES ($1,$2::jsonb)', ['BROKE', '{}']);
  await assert.rejects(store.init(new Map()), /Invalid saved room: BROKE/);

  const guest = new RoomStore(null, { logger });
  await guest.init(new Map());
  await guest.save(v1Fixture());
  await guest.remove('ABCDE');
  await guest.flush();
});

test('6.2 migration does not start later migration families', () => {
  const source = fs.readFileSync(require.resolve('../save-migrations'), 'utf8');
  const forbiddenFamilies = [
    'assignmentDecks',
    'expeditionDeck',
    'pendingExpeditionRewards',
    'activeAssignment',
    'activeExpedition',
    'expeditionHistory',
    'legendaryCards',
    'specialCards',
    'namedPlaceCards',
    'legendaryPlacesExplored',
    'activeTurnEffects',
    'nextTurnEffects',
    'pendingAssignmentChoice',
    'pendingLegendaryReaction',
    'eventPhase',
  ];
  for (const field of forbiddenFamilies) assert.equal(source.includes(field), false, field);
});
