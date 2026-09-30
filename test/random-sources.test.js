'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ELIGIBILITY,
  selectIndependent,
  consumeCyclic,
  peekOrderedCyclic,
  reserveRecyclableOccurrence,
  releaseReservedOccurrence,
  selectFilteredTasks,
  reserveRandomEntry,
  releaseReservedEntry,
} = require('../random-sources');
const {
  selectTreasureOutcome,
  selectLegendaryAbility,
  selectTreasureCandidates,
} = require('../digital-random-sources');
const { BALANCE, TREASURE_CARDS, LEGENDARY_CARDS, SAILING_EVENT_CARDS, FEUD_CARDS, POLITICAL_FACTION_ORDER } = require('../game-data');
const { drawTreasureCard, drawLegendaryCard, drawSailingEventCard, discardRandomHeldCard, createFeudDecks, drawFeudCard } = require('../game-logic');
const { createSeaEncounterStorage, seaEncounterSource } = require('../sea-encounter-source');
const {
  createSailingEventStorage,
  canonicalizeSailingEventOccurrence,
  sailingEventSource,
} = require('../sailing-event-source');
const {
  createPoliticalEffectStorage,
  canonicalizePoliticalEffectOccurrence,
  politicalEffectSource,
} = require('../political-effect-source');

function sequenceRng(values) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, `RNG sequence exhausted at call ${index + 1}`);
    return values[index++];
  };
}

test('independent selection allows repeats and does not remember previous outcomes', () => {
  const rng = sequenceRng([0.1, 0.1, 0.9]);
  const values = ['A', 'B'];
  assert.equal(selectIndependent(values, rng), 'A');
  assert.equal(selectIndependent(values, rng), 'A');
  assert.equal(selectIndependent(values, rng), 'B');
});

test('cyclic source does not repeat an occurrence before cycle refresh', () => {
  const available = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const recyclable = [];
  const firstCycle = [
    consumeCyclic(available, recyclable),
    consumeCyclic(available, recyclable),
    consumeCyclic(available, recyclable),
  ];
  assert.deepEqual(firstCycle.map(item => item.id), ['a', 'b', 'c']);
  assert.equal(new Set(firstCycle.map(item => item.id)).size, 3);
  const next = consumeCyclic(available, recyclable, sequenceRng([0, 0]));
  assert.ok(firstCycle.some(item => item.id === next.id));
});

test('ordered cyclic peek is stable, non-consuming, and matches next consume', () => {
  const available = [{ id: 'next' }, { id: 'later' }];
  const recyclable = [];
  const before = [...available];
  const first = peekOrderedCyclic(available, recyclable);
  const second = peekOrderedCyclic(available, recyclable);
  assert.equal(first.id, 'next');
  assert.strictEqual(second, first);
  assert.deepEqual(available, before);
  assert.deepEqual(recyclable, []);
  assert.strictEqual(consumeCyclic(available, recyclable), first);
});

test('reserved cyclic occurrence stays unavailable until release', () => {
  const keyOf = item => item.id;
  const available = [{ id: 'a' }, { id: 'b' }];
  const recyclable = [];
  const reserved = [];

  const a = consumeCyclic(available, recyclable);
  assert.equal(a.id, 'a');
  assert.equal(reserveRecyclableOccurrence(recyclable, reserved, a, keyOf), true);
  assert.deepEqual(reserved.map(keyOf), ['a']);

  assert.equal(consumeCyclic(available, recyclable).id, 'b');
  assert.equal(consumeCyclic(available, recyclable, () => 0).id, 'b');
  assert.deepEqual(reserved.map(keyOf), ['a']);

  assert.equal(releaseReservedOccurrence(reserved, recyclable, 'a', keyOf), true);
  assert.deepEqual(reserved, []);
  assert.ok(recyclable.some(item => item.id === 'a'));
});

test('filtered pool distinguishes eligible, temporary skip, and permanent remove', () => {
  const available = [
    { id: 'later', status: ELIGIBILITY.SKIP },
    { id: 'invalid', status: ELIGIBILITY.REMOVE },
    { id: 'now', status: ELIGIBILITY.ELIGIBLE },
  ];
  const recyclable = [];
  const removed = [];
  const chosen = selectFilteredTasks(available, recyclable, removed, {
    count: 1,
    classify: entry => entry.status,
    rng: () => 0,
  });

  assert.deepEqual(chosen.map(item => item.id), ['now']);
  assert.deepEqual(removed.map(item => item.id), ['invalid']);
  assert.deepEqual(available.map(item => item.id), ['later']);
  assert.deepEqual(recyclable, []);
});

test('reservable random pool cannot issue the same entry twice concurrently', () => {
  const keyOf = item => item.id;
  const available = [{ id: 'a' }, { id: 'b' }];
  const reserved = [];

  const first = reserveRandomEntry(available, reserved, { keyOf, rng: () => 0 });
  const second = reserveRandomEntry(available, reserved, { keyOf, rng: () => 0 });
  assert.equal(first.id, 'a');
  assert.equal(second.id, 'b');
  assert.deepEqual(available, []);
  assert.deepEqual(reserved.map(keyOf), ['a', 'b']);

  assert.equal(releaseReservedEntry(reserved, available, 'a', { keyOf }), true);
  assert.deepEqual(available.map(keyOf), ['a']);
  assert.deepEqual(reserved.map(keyOf), ['b']);
  assert.equal(reserveRandomEntry(available, reserved, { keyOf, rng: () => 0 }).id, 'a');
});

test('helpers mutate only explicitly supplied storage arrays and add no room fields', () => {
  const room = { marker: 'unchanged', anchorDecks: { blue: { drawPile: [{ id: 'a' }], discard: [] } } };
  const beforeRoomKeys = Object.keys(room);
  const beforeDeckKeys = Object.keys(room.anchorDecks.blue);

  assert.equal(consumeCyclic(room.anchorDecks.blue.drawPile, room.anchorDecks.blue.discard).id, 'a');

  assert.deepEqual(Object.keys(room), beforeRoomKeys);
  assert.deepEqual(Object.keys(room.anchorDecks.blue), beforeDeckKeys);
  assert.equal(room.marker, 'unchanged');
});


test('treasure selector maps deterministic RNG boundaries to all four canonical outcomes', () => {
  assert.equal(TREASURE_CARDS.length, 4);
  const cases = [
    [0, 0],
    [0.249999999, 0],
    [0.25, 1],
    [0.5, 2],
    [0.75, 3],
    [0.999999999, 3],
  ];
  for (const [roll, index] of cases) {
    assert.equal(selectTreasureOutcome(() => roll).id, TREASURE_CARDS[index].id);
  }
  assert.deepEqual(
    [0, 0.25, 0.5, 0.75].map(roll => selectTreasureOutcome(() => roll).id),
    TREASURE_CARDS.map(definition => definition.id)
  );
});

test('treasure candidates are independent with replacement and may repeat', () => {
  const repeated = selectTreasureCandidates(2, sequenceRng([0, 0]));
  assert.deepEqual(repeated.map(item => item.id), [TREASURE_CARDS[0].id, TREASURE_CARDS[0].id]);

  const independent = selectTreasureCandidates(2, sequenceRng([0, 0.75]));
  assert.deepEqual(independent.map(item => item.id), [TREASURE_CARDS[0].id, TREASURE_CARDS[3].id]);
});

test('treasure selection ignores legacy room.treasureDeck and wrapper delegates to stateless selector', () => {
  let reads = 0;
  const legacyDeck = Object.freeze({ drawPile: Object.freeze([{ id: 'legacy' }]), discard: Object.freeze([]) });
  const room = {};
  Object.defineProperty(room, 'treasureDeck', {
    enumerable: true,
    get() { reads += 1; return legacyDeck; },
  });

  const direct = selectTreasureOutcome(() => 0.5);
  const wrapped = drawTreasureCard(room, () => 0.5);
  assert.deepEqual(wrapped, direct);
  assert.equal(reads, 0);
  assert.deepEqual(legacyDeck, { drawPile: [{ id: 'legacy' }], discard: [] });
});

test('legendary selector allows repeats and follows BALANCE.legendaryPool.typeIds', () => {
  const originalIds = [...BALANCE.legendaryPool.typeIds];
  const customIds = [originalIds.at(-1), originalIds[0]];
  BALANCE.legendaryPool.typeIds = customIds;
  try {
    const first = selectLegendaryAbility(() => 0);
    const repeated = selectLegendaryAbility(() => 0);
    const second = selectLegendaryAbility(() => 0.75);
    assert.equal(first.id, customIds[0]);
    assert.equal(repeated.id, customIds[0]);
    assert.equal(second.id, customIds[1]);
  } finally {
    BALANCE.legendaryPool.typeIds = originalIds;
  }
});

test('legendary selection ignores legacy room.legendaryDeck and wrapper delegates to stateless selector', () => {
  let reads = 0;
  const legacyDeck = Object.freeze({ drawPile: Object.freeze([{ id: 'legacy' }]), discard: Object.freeze([]) });
  const room = {};
  Object.defineProperty(room, 'legendaryDeck', {
    enumerable: true,
    get() { reads += 1; return legacyDeck; },
  });

  const direct = selectLegendaryAbility(() => 0.75);
  const wrapped = drawLegendaryCard(room, () => 0.75);
  assert.deepEqual(wrapped, direct);
  assert.equal(reads, 0);
});

test('treasure and legendary results are detached clones of canonical definitions', () => {
  const treasureCanonical = JSON.parse(JSON.stringify(TREASURE_CARDS[0]));
  const legendaryId = BALANCE.legendaryPool.typeIds[0];
  const legendaryDefinition = LEGENDARY_CARDS.find(item => item.id === legendaryId);
  const legendaryCanonical = JSON.parse(JSON.stringify(legendaryDefinition));

  const treasure = selectTreasureOutcome(() => 0);
  const legendary = selectLegendaryAbility(() => 0);
  treasure.effect.type = 'mutated-treasure';
  legendary.effect.type = 'mutated-legendary';

  assert.deepEqual(TREASURE_CARDS[0], treasureCanonical);
  assert.deepEqual(legendaryDefinition, legendaryCanonical);
});


test('SeaEncounterSource peek is stable, non-consuming, and next consume returns the peeked occurrence', () => {
  const room = {
    anchorDecks: {
      blue: { drawPile: [{ id: 'first' }, { id: 'second' }], discard: [] },
      yellow: { drawPile: [{ id: 'yellow' }], discard: [] },
      red: { drawPile: [{ id: 'red' }], discard: [] },
    },
  };
  const source = seaEncounterSource(room, 'blue', () => 0.5);
  const before = JSON.stringify(room.anchorDecks.blue);
  const firstPeek = source.peekNext();
  const secondPeek = source.peekNext();

  assert.strictEqual(firstPeek, secondPeek);
  assert.equal(firstPeek.id, 'first');
  assert.equal(JSON.stringify(room.anchorDecks.blue), before);
  assert.strictEqual(source.consumeNext(), firstPeek);
  assert.equal(source.remainingCount(), 1);
  assert.equal(room.anchorDecks.blue.discard.length, 0);
});

test('SeaEncounterSource operations are isolated by anchor color', () => {
  const room = {
    anchorDecks: {
      blue: { drawPile: [{ id: 'blue' }], discard: [] },
      yellow: { drawPile: [{ id: 'yellow' }], discard: [] },
      red: { drawPile: [{ id: 'red' }], discard: [] },
    },
  };
  const yellowBefore = JSON.stringify(room.anchorDecks.yellow);
  const redBefore = JSON.stringify(room.anchorDecks.red);
  assert.equal(seaEncounterSource(room, 'blue').consumeNext().id, 'blue');
  assert.equal(JSON.stringify(room.anchorDecks.yellow), yellowBefore);
  assert.equal(JSON.stringify(room.anchorDecks.red), redBefore);
});

test('SeaEncounterSource first cycle preserves occurrence multiplicities without repeats', () => {
  const room = { anchorDecks: createSeaEncounterStorage(() => 0.5) };
  const source = seaEncounterSource(room, 'blue', () => 0.5);
  const occurrences = [];
  while (source.remainingCount()) {
    const occurrence = source.consumeNext();
    occurrences.push(occurrence);
    source.markUsed(occurrence);
  }
  assert.equal(occurrences.length, 10);
  assert.equal(new Set(occurrences.map(item => `${item.id}:${item.copy}`)).size, 10);
  assert.equal(occurrences.filter(item => item.id === 'smugglers').length, 2);
  assert.equal(room.anchorDecks.blue.discard.length, 10);
});

test('SeaEncounterSource refresh preserves the exact color multiset', () => {
  const room = { anchorDecks: createSeaEncounterStorage(() => 0.25) };
  const source = seaEncounterSource(room, 'yellow', () => 0.25);
  while (source.remainingCount()) {
    const occurrence = source.consumeNext();
    source.markUsed(occurrence);
  }
  const before = room.anchorDecks.yellow.discard
    .map(item => `${item.id}:${item.copy}`)
    .sort();
  assert.equal(source.peekNext() != null, true);
  const after = room.anchorDecks.yellow.drawPile
    .map(item => `${item.id}:${item.copy}`)
    .sort();
  assert.deepEqual(after, before);
  assert.deepEqual(room.anchorDecks.yellow.discard, []);
});

test('SeaEncounterSource boundary peek materializes one stable next occurrence in legacy backing storage', () => {
  const room = {
    anchorDecks: {
      blue: {
        drawPile: [],
        discard: [{ id: 'a', copy: 1 }, { id: 'b', copy: 1 }, { id: 'c', copy: 1 }],
      },
    },
  };
  const rng = sequenceRng([0, 0]);
  const source = seaEncounterSource(room, 'blue', rng);
  const firstPeek = source.peekNext();
  const serializedAfterPeek = JSON.stringify(room);
  const secondPeek = source.peekNext();

  assert.strictEqual(secondPeek, firstPeek);
  assert.equal(room.anchorDecks.blue.drawPile.length, 3);
  assert.equal(room.anchorDecks.blue.discard.length, 0);

  const restored = JSON.parse(serializedAfterPeek);
  const restoredSource = seaEncounterSource(restored, 'blue', () => {
    throw new Error('restored consume must not need RNG after boundary peek');
  });
  assert.deepEqual(restoredSource.consumeNext(), firstPeek);
});

test('SeaEncounterSource adds no new room state fields', () => {
  const room = {
    marker: 'same',
    anchorDecks: {
      blue: { drawPile: [{ id: 'a' }], discard: [] },
      yellow: { drawPile: [], discard: [] },
      red: { drawPile: [], discard: [] },
    },
  };
  const keysBefore = Object.keys(room).sort();
  const source = seaEncounterSource(room, 'blue');
  source.peekNext();
  source.consumeNext();
  source.markUsed({ id: 'used' });
  assert.deepEqual(Object.keys(room).sort(), keysBefore);
  assert.equal(Object.hasOwn(room, 'seaEncounterSources'), false);
  assert.equal(room.marker, 'same');
});

test('drawAnchorCard keeps legacy return shape while delegating consume lifecycle to SeaEncounterSource', () => {
  const room = {
    anchorDecks: {
      blue: { drawPile: [{ id: 'legacy-shape' }], discard: [] },
    },
  };
  const drawn = require('../game-logic').drawAnchorCard(room, 'blue', () => 0.5);
  assert.deepEqual(Object.keys(drawn).sort(), ['card', 'deck']);
  assert.equal(drawn.card.id, 'legacy-shape');
  assert.strictEqual(drawn.deck, room.anchorDecks.blue);
  assert.equal(room.anchorDecks.blue.drawPile.length, 0);
  assert.equal(room.anchorDecks.blue.discard.length, 0);
});


function eventOccurrenceKey(occurrence) {
  return `${occurrence.masterCardId || occurrence.id}:${occurrence.copy ?? 'legacy'}`;
}

test('SailingEventSource initial cycle preserves all 26 canonical occurrences and multiplicities', () => {
  const storage = createSailingEventStorage(() => 0.5);
  const expectedCount = SAILING_EVENT_CARDS.reduce((sum, definition) => sum + Math.max(1, Number(definition.quantity) || 1), 0);
  assert.equal(expectedCount, 26);
  assert.equal(storage.drawPile.length, 26);
  assert.equal(storage.discard.length, 0);
  for (const definition of SAILING_EVENT_CARDS) {
    assert.equal(
      storage.drawPile.filter(occurrence => occurrence.id === definition.id).length,
      Math.max(1, Number(definition.quantity) || 1),
      definition.id
    );
  }
});

test('SailingEventSource consume keeps occurrence outside recyclable state until markUsed', () => {
  const room = { eventDeck: { drawPile: [{ id: 'a', copy: 1 }, { id: 'b', copy: 1 }], discard: [] } };
  const source = sailingEventSource(room, () => 0);
  const first = source.consumeNext();
  assert.equal(first.id, 'a');
  assert.equal(room.eventDeck.drawPile.length, 1);
  assert.equal(room.eventDeck.discard.length, 0);

  assert.equal(source.markUsed(first), true);
  assert.equal(room.eventDeck.discard.length, 1);
  assert.equal(eventOccurrenceKey(room.eventDeck.discard[0]), eventOccurrenceKey(first));
  assert.equal(source.consumeNext().id, 'b');
});

test('SailingEventSource does not reissue a used occurrence before refresh', () => {
  const room = {
    eventDeck: {
      drawPile: [{ id: 'a', copy: 1 }, { id: 'b', copy: 1 }, { id: 'c', copy: 1 }],
      discard: [],
    },
  };
  const source = sailingEventSource(room, () => 0);
  const first = source.consumeNext();
  source.markUsed(first);
  assert.equal(source.consumeNext().id, 'b');
  assert.equal(source.consumeNext().id, 'c');
  assert.equal(room.eventDeck.drawPile.length, 0);
  assert.equal(room.eventDeck.discard.length, 1);
  assert.equal(source.consumeNext().id, 'a');
});

test('SailingEventSource refresh preserves the exact occurrence multiset', () => {
  const room = { eventDeck: createSailingEventStorage(() => 0.25) };
  const source = sailingEventSource(room, () => 0.25);
  const firstCycle = [];
  while (source.remainingCount()) {
    const occurrence = source.consumeNext();
    firstCycle.push(eventOccurrenceKey(occurrence));
    source.markUsed(occurrence);
  }
  const expected = [...firstCycle].sort();
  const refreshedFirst = source.consumeNext();
  const refreshedKeys = [eventOccurrenceKey(refreshedFirst), ...room.eventDeck.drawPile.map(eventOccurrenceKey)].sort();
  assert.deepEqual(refreshedKeys, expected);
  assert.equal(room.eventDeck.discard.length, 0);
});

test('pending sailing event remains outside source across JSON restart and does not trigger a redraw', () => {
  const room = {
    eventDeck: {
      drawPile: [{ id: 'tailwind-2', copy: 1 }, { id: 'calm', copy: 1 }],
      discard: [],
    },
    pendingEvent: null,
  };
  const source = sailingEventSource(room, () => 0);
  const pendingOccurrence = source.consumeNext();
  room.pendingEvent = { kind: 'cargo', eventCard: { ...pendingOccurrence } };
  assert.equal(room.eventDeck.drawPile.some(item => eventOccurrenceKey(item) === eventOccurrenceKey(pendingOccurrence)), false);
  assert.equal(room.eventDeck.discard.some(item => eventOccurrenceKey(item) === eventOccurrenceKey(pendingOccurrence)), false);

  const restored = JSON.parse(JSON.stringify(room));
  const restoredSource = sailingEventSource(restored, () => {
    throw new Error('pending restart must not need RNG while available outcomes remain');
  });
  assert.equal(restored.pendingEvent.eventCard.id, pendingOccurrence.id);
  assert.equal(restoredSource.remainingCount(), 1);
  assert.equal(restoredSource.consumeNext().id, 'calm');
});

test('saved found-cargo and save-card occurrences stay reserved outside source until release', () => {
  for (const kind of ['found-cargo', 'ship-master']) {
    const room = {
      eventDeck: {
        drawPile: [{ id: kind === 'found-cargo' ? 'found-wood' : 'ship-master', copy: 1 }, { id: 'other', copy: 1 }],
        discard: [],
      },
    };
    const source = sailingEventSource(room, () => 0);
    const occurrence = source.consumeNext();
    const player = {
      savedEventCards: [{
        id: 'saved',
        kind,
        sourceDeck: 'event',
        sourceCard: { ...occurrence },
      }],
    };

    assert.equal(room.eventDeck.drawPile.some(item => eventOccurrenceKey(item) === eventOccurrenceKey(occurrence)), false);
    assert.equal(room.eventDeck.discard.length, 0);
    assert.equal(player.savedEventCards[0].sourceCard.id, occurrence.id);

    const [saved] = player.savedEventCards.splice(0, 1);
    assert.equal(source.releaseReserved(saved.sourceCard), true);
    assert.equal(room.eventDeck.discard.length, 1);
    assert.equal(eventOccurrenceKey(room.eventDeck.discard[0]), eventOccurrenceKey(occurrence));
    assert.equal(player.savedEventCards.length, 0);
  }
});

test('random held-card discard releases a saved sailing occurrence exactly once', () => {
  const sourceCard = { id: 'ship-master', masterCardId: 'ship-master', copy: 1, name: 'Судовой мастер' };
  const room = { eventDeck: { drawPile: [{ id: 'other', copy: 1 }], discard: [] } };
  const player = {
    specialCards: [],
    legendaryCards: [],
    savedEventCards: [{
      id: 'saved-1',
      kind: 'ship-master',
      name: 'Судовой мастер',
      sourceDeck: 'event',
      sourceCard: { ...sourceCard },
    }],
  };

  const first = discardRandomHeldCard(room, player, () => 0);
  assert.equal(first.discarded.source, 'saved-event');
  assert.equal(player.savedEventCards.length, 0);
  assert.equal(room.eventDeck.discard.length, 1);
  assert.equal(eventOccurrenceKey(room.eventDeck.discard[0]), eventOccurrenceKey(sourceCard));

  const second = discardRandomHeldCard(room, player, () => 0);
  assert.equal(second.discarded, null);
  assert.equal(room.eventDeck.discard.length, 1);
});

test('drawSailingEventCard delegates to source and preserves legacy canonicalization', () => {
  const room = {
    eventDeck: {
      drawPile: [{ id: 'tailwind-1', name: 'legacy', type: 'next-turn', effect: 'moveBonus', value: 99, timing: 'next-personal-turn', copy: 1 }],
      discard: [],
    },
  };
  const drawn = drawSailingEventCard(room, () => 0.5);
  const canonical = canonicalizeSailingEventOccurrence({ id: 'tailwind-1', copy: 1 });
  assert.equal(drawn.masterCardId, 'tailwind-1');
  assert.equal(drawn.type, canonical.type);
  assert.equal(drawn.effect, canonical.effect);
  assert.equal(drawn.value, canonical.value);
  assert.equal(drawn.timing, canonical.timing);
  assert.equal(room.eventDeck.drawPile.length, 0);
  assert.equal(room.eventDeck.discard.length, 0);
});

test('SailingEventSource adds no persisted room fields and keeps legacy eventDeck shape', () => {
  const room = {
    marker: 'same',
    eventDeck: { drawPile: [{ id: 'a', copy: 1 }], discard: [] },
  };
  const roomKeys = Object.keys(room).sort();
  const deckKeys = Object.keys(room.eventDeck).sort();
  const source = sailingEventSource(room, () => 0);
  const outcome = source.consumeNext();
  source.markUsed(outcome);

  assert.deepEqual(Object.keys(room).sort(), roomKeys);
  assert.deepEqual(Object.keys(room.eventDeck).sort(), deckKeys);
  assert.equal(Object.hasOwn(room, 'sailingEventSource'), false);
  assert.equal(room.marker, 'same');
});


function politicalOccurrenceKey(occurrence) {
  return `${occurrence.masterCardId || occurrence.id}:${occurrence.copy ?? 'legacy'}`;
}

test('PoliticalEffectSource initial sources preserve each faction canonical 10-occurrence multiset', () => {
  const storage = createPoliticalEffectStorage(() => 0.5);
  assert.deepEqual(Object.keys(storage), POLITICAL_FACTION_ORDER);
  for (const factionId of POLITICAL_FACTION_ORDER) {
    const definitions = FEUD_CARDS[factionId] || [];
    assert.equal(storage[factionId].drawPile.length, 10, factionId);
    assert.equal(storage[factionId].discard.length, 0, factionId);
    for (const definition of definitions) {
      assert.equal(
        storage[factionId].drawPile.filter(occurrence => occurrence.id === definition.id).length,
        Math.max(1, Number(definition.quantity) || 1),
        `${factionId}:${definition.id}`
      );
    }
  }
});

test('PoliticalEffectSource faction sources are independent', () => {
  const room = { feudDecks: createPoliticalEffectStorage(() => 0.5) };
  const lioniaBefore = JSON.stringify(room.feudDecks.lionia);
  const kadingir = politicalEffectSource(room, 'kadingir', () => 0);
  const drawn = kadingir.consumeNext();
  assert.ok(drawn);
  assert.equal(kadingir.remainingCount(), 9);
  assert.equal(JSON.stringify(room.feudDecks.lionia), lioniaBefore);
});

test('PoliticalEffectSource consume keeps occurrence outside recyclable state until markUsed', () => {
  const room = { feudDecks: { kadingir: { drawPile: [{ id: 'a', copy: 1 }, { id: 'b', copy: 1 }], discard: [] } } };
  const source = politicalEffectSource(room, 'kadingir', () => 0);
  const first = source.consumeNext();
  assert.equal(first.id, 'a');
  assert.deepEqual(room.feudDecks.kadingir.drawPile, [{ id: 'b', copy: 1 }]);
  assert.deepEqual(room.feudDecks.kadingir.discard, []);
});

test('PoliticalEffectSource markUsed returns an occurrence exactly once', () => {
  const room = { feudDecks: { kadingir: { drawPile: [{ id: 'a', copy: 1 }], discard: [] } } };
  const source = politicalEffectSource(room, 'kadingir', () => 0);
  const outcome = source.consumeNext();
  assert.equal(source.markUsed(outcome), true);
  assert.equal(source.markUsed(outcome), false);
  assert.equal(room.feudDecks.kadingir.discard.length, 1);
  assert.equal(politicalOccurrenceKey(room.feudDecks.kadingir.discard[0]), politicalOccurrenceKey(outcome));
});

test('PoliticalEffectSource does not reissue an occurrence before cycle refresh', () => {
  const room = { feudDecks: { kadingir: { drawPile: [{ id: 'a', copy: 1 }, { id: 'b', copy: 1 }, { id: 'c', copy: 1 }], discard: [] } } };
  const source = politicalEffectSource(room, 'kadingir', () => 0);
  const firstCycle = [];
  for (let i = 0; i < 3; i++) {
    const occurrence = source.consumeNext();
    firstCycle.push(politicalOccurrenceKey(occurrence));
    source.markUsed(occurrence);
  }
  assert.equal(new Set(firstCycle).size, 3);
  const refreshed = source.consumeNext();
  assert.ok(firstCycle.includes(politicalOccurrenceKey(refreshed)));
});

test('PoliticalEffectSource refresh preserves the exact canonical multiset', () => {
  const room = { feudDecks: createPoliticalEffectStorage(() => 0.25) };
  const source = politicalEffectSource(room, 'kadingir', () => 0.25);
  const firstCycle = [];
  while (source.remainingCount()) {
    const occurrence = source.consumeNext();
    firstCycle.push(politicalOccurrenceKey(occurrence));
    source.markUsed(occurrence);
  }
  assert.equal(firstCycle.length, 10);
  const refreshedFirst = source.consumeNext();
  const refreshed = [politicalOccurrenceKey(refreshedFirst), ...room.feudDecks.kadingir.drawPile.map(politicalOccurrenceKey)].sort();
  assert.deepEqual(refreshed, [...firstCycle].sort());
  assert.equal(room.feudDecks.kadingir.discard.length, 0);
});

test('pending feud occurrence stays outside PoliticalEffectSource across JSON restart', () => {
  const room = {
    feudDecks: { kadingir: { drawPile: [{ id: 'pending', copy: 1 }, { id: 'next', copy: 1 }], discard: [] } },
    pendingFeud: null,
  };
  const source = politicalEffectSource(room, 'kadingir', () => 0);
  const pending = source.consumeNext();
  room.pendingFeud = { factionId: 'kadingir', feudCard: { ...pending } };
  assert.equal(room.feudDecks.kadingir.drawPile.some(item => politicalOccurrenceKey(item) === politicalOccurrenceKey(pending)), false);
  assert.equal(room.feudDecks.kadingir.discard.some(item => politicalOccurrenceKey(item) === politicalOccurrenceKey(pending)), false);

  const restored = JSON.parse(JSON.stringify(room));
  const before = JSON.stringify(restored.feudDecks.kadingir);
  const restoredSource = politicalEffectSource(restored, 'kadingir', () => { throw new Error('restart must not consume or refresh pending feud'); });
  assert.equal(restored.pendingFeud.feudCard.id, 'pending');
  assert.equal(restoredSource.remainingCount(), 1);
  assert.equal(JSON.stringify(restored.feudDecks.kadingir), before);
});

test('resolved pending feud occurrence returns to recyclable state exactly once', () => {
  const room = { feudDecks: { kadingir: { drawPile: [{ id: 'next', copy: 1 }], discard: [] } } };
  const pending = { id: 'pending', copy: 1 };
  const source = politicalEffectSource(room, 'kadingir', () => 0);
  assert.equal(source.markUsed(pending), true);
  assert.equal(source.markUsed(pending), false);
  assert.deepEqual(room.feudDecks.kadingir.discard.map(politicalOccurrenceKey), ['pending:1']);
});

test('drawFeudCard remains a compatibility wrapper with consume-only semantics', () => {
  const room = { feudDecks: { kadingir: { drawPile: [{ id: 'legacy-draw', copy: 1 }], discard: [] } } };
  const drawn = drawFeudCard(room, 'kadingir', () => 0.5);
  assert.equal(drawn.id, 'legacy-draw');
  assert.equal(room.feudDecks.kadingir.drawPile.length, 0);
  assert.equal(room.feudDecks.kadingir.discard.length, 0);
});

test('PoliticalEffectSource preserves legacy masterCardId canonicalization', () => {
  const canonical = FEUD_CARDS.kadingir[0];
  const raw = { id: 'legacy-instance', masterCardId: canonical.id, name: 'legacy name', type: 'none', copy: 1 };
  const normalized = canonicalizePoliticalEffectOccurrence('kadingir', raw);
  assert.equal(normalized.id, canonical.id);
  assert.equal(normalized.masterCardId, canonical.id);
  assert.equal(normalized.name, canonical.name);
  assert.equal(normalized.type, canonical.type);
  assert.equal(normalized.copy, 1);
});

test('PoliticalEffectSource adds no new room fields and keeps legacy feudDeck save shape', () => {
  const room = { marker: 'same', feudDecks: createFeudDecks(() => 0.5) };
  const roomKeys = Object.keys(room).sort();
  const factionShapes = Object.fromEntries(Object.entries(room.feudDecks).map(([id, deck]) => [id, Object.keys(deck).sort()]));
  const source = politicalEffectSource(room, 'kadingir', () => 0);
  const outcome = source.consumeNext();
  source.markUsed(outcome);

  assert.deepEqual(Object.keys(room).sort(), roomKeys);
  assert.equal(Object.hasOwn(room, 'politicalEffectSources'), false);
  assert.equal(room.marker, 'same');
  for (const factionId of POLITICAL_FACTION_ORDER) {
    assert.deepEqual(Object.keys(room.feudDecks[factionId]).sort(), factionShapes[factionId]);
    assert.deepEqual(Object.keys(room.feudDecks[factionId]).sort(), ['discard', 'drawPile']);
  }
});
