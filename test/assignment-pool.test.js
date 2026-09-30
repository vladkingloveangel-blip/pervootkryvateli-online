'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ASSIGNMENT_CARDS } = require('../game-data');
const {
  createAssignmentDecks,
  drawAssignmentCard,
  issueAssignment,
  offerAssignmentCards,
  chooseAssignmentOffer,
  completeAssignment,
} = require('../game-logic');
const {
  expandAssignmentDefinitions,
  createAssignmentStorage,
  assignmentPool,
} = require('../assignment-pool');

function occurrenceKey(card) {
  return `${card.id || card.conditionKey}:${card.copy ?? 'legacy'}`;
}

function factionRoom(factionId, drawPile = [], discard = [], removed = []) {
  return {
    round: 1,
    islands: [],
    players: [],
    assignmentDecks: {
      [factionId]: {
        drawPile: drawPile.map(card => ({ ...card })),
        discard: discard.map(card => ({ ...card })),
        removed: removed.map(card => ({ ...card })),
      },
    },
  };
}

function player(id = 'p1') {
  return {
    id,
    name: id,
    level: 1,
    upgrades: [],
    ducats: 0,
    activeAssignment: null,
  };
}

function canonical(factionId, id, copy = 1) {
  const definition = (ASSIGNMENT_CARDS[factionId] || []).find(card => card.id === id);
  assert.ok(definition, `Missing canonical assignment ${factionId}/${id}`);
  return { ...definition, copy };
}

test('AssignmentPool initial storage exactly matches every faction assignment composition', () => {
  const storage = createAssignmentStorage(() => 0.5);
  assert.deepEqual(Object.keys(storage), Object.keys(ASSIGNMENT_CARDS));

  for (const factionId of Object.keys(ASSIGNMENT_CARDS)) {
    const expected = expandAssignmentDefinitions(ASSIGNMENT_CARDS[factionId])
      .map(occurrenceKey)
      .sort();
    const actual = storage[factionId].drawPile.map(occurrenceKey).sort();
    assert.deepEqual(actual, expected, factionId);
    assert.deepEqual(storage[factionId].discard, []);
    assert.deepEqual(storage[factionId].removed, []);
    assert.deepEqual(Object.keys(storage[factionId]).sort(), ['discard', 'drawPile', 'removed']);
  }

  const compatibility = createAssignmentDecks(() => 0.5);
  for (const factionId of Object.keys(ASSIGNMENT_CARDS)) {
    assert.deepEqual(
      compatibility[factionId].drawPile.map(occurrenceKey).sort(),
      storage[factionId].drawPile.map(occurrenceKey).sort()
    );
  }
});

test('AssignmentPool issues eligible occurrences and keeps them outside the available pool', () => {
  const room = factionRoom('lionia', [{ id: 'eligible', copy: 1, status: 'eligible' }]);
  const pool = assignmentPool(room, 'lionia', () => 0, {
    classify: (_room, _player, card) => card.status,
  });
  const offered = pool.offerEligible(player(), 1);
  assert.deepEqual(offered.map(card => card.id), ['eligible']);
  assert.equal(pool.remainingCount(), 0);
  assert.deepEqual(pool.availabilityCounts(), { available: 0, recyclable: 0, removed: 0 });
});

test('AssignmentPool temporary skip is not issued and becomes available on a future request', () => {
  const room = factionRoom('lionia', [{ id: 'later', copy: 1 }]);
  let eligibleNow = false;
  const pool = assignmentPool(room, 'lionia', () => 0, {
    classify: () => eligibleNow ? 'eligible' : 'skip',
  });

  assert.deepEqual(pool.offerEligible(player(), 1), []);
  assert.deepEqual(room.assignmentDecks.lionia.drawPile.map(card => card.id), ['later']);
  assert.deepEqual(room.assignmentDecks.lionia.removed, []);

  eligibleNow = true;
  assert.deepEqual(pool.offerEligible(player(), 1).map(card => card.id), ['later']);
});

test('AssignmentPool permanent remove moves occurrence to removed and never returns it', () => {
  const room = factionRoom('lionia', [{ id: 'invalid', copy: 1 }]);
  const pool = assignmentPool(room, 'lionia', () => 0, { classify: () => 'remove' });

  assert.deepEqual(pool.offerEligible(player(), 1), []);
  assert.deepEqual(room.assignmentDecks.lionia.drawPile, []);
  assert.deepEqual(room.assignmentDecks.lionia.discard, []);
  assert.deepEqual(room.assignmentDecks.lionia.removed.map(card => card.id), ['invalid']);
  assert.deepEqual(pool.offerEligible(player(), 1), []);
});

test('AssignmentPool refreshes discard once per search and preserves recyclable composition', () => {
  const recyclable = [
    { id: 'a', copy: 1 },
    { id: 'b', copy: 1 },
    { id: 'c', copy: 1 },
  ];
  const room = factionRoom('lionia', [], recyclable);
  const pool = assignmentPool(room, 'lionia', () => 0, { classify: () => 'eligible' });

  const offered = pool.offerEligible(player(), 1);
  assert.equal(offered.length, 1);
  assert.deepEqual(room.assignmentDecks.lionia.discard, []);
  const after = [...offered, ...room.assignmentDecks.lionia.drawPile].map(occurrenceKey).sort();
  assert.deepEqual(after, recyclable.map(occurrenceKey).sort());
});

test('ordinary issueAssignment reserves the occurrence through activeAssignment', () => {
  const card = canonical('lionia', 'lionia-ship-level');
  const p = player();
  const room = factionRoom('lionia', [card]);
  room.players.push(p);

  const issued = issueAssignment(room, p, 'lionia', () => 0);
  assert.equal(issued.ok, true);
  assert.equal(p.activeAssignment.card.id, card.id);
  assert.equal(room.assignmentDecks.lionia.drawPile.length, 0);
  assert.equal(room.assignmentDecks.lionia.discard.length, 0);
  assert.equal(room.assignmentDecks.lionia.removed.length, 0);
});

test('Embassy offer reserves two distinct available occurrences and they cannot be issued concurrently', () => {
  const first = canonical('lionia', 'lionia-ship-level');
  const second = canonical('lionia', 'lionia-yellow-a');
  const owner = player('owner');
  const other = player('other');
  const room = factionRoom('lionia', [first, second]);
  room.players.push(owner, other);

  const offered = offerAssignmentCards(room, owner, 'lionia', 2, () => 0);
  assert.equal(offered.ok, true);
  assert.equal(offered.cards.length, 2);
  assert.equal(new Set(offered.cards.map(occurrenceKey)).size, 2);
  assert.equal(room.assignmentDecks.lionia.drawPile.length, 0);

  const duplicateAttempt = issueAssignment(room, other, 'lionia', () => 0);
  assert.equal(duplicateAttempt.ok, false);
  assert.equal(duplicateAttempt.empty, true);
  assert.equal(other.activeAssignment, null);
});

test('Embassy choice returns only the unchosen candidate with existing randomization semantics', () => {
  const owner = player('owner');
  const room = factionRoom('lionia', [
    canonical('lionia', 'lionia-ship-level'),
    canonical('lionia', 'lionia-yellow-a'),
  ]);
  room.players.push(owner);

  const offered = offerAssignmentCards(room, owner, 'lionia', 2, () => 0);
  const chosenCard = offered.cards[0];
  const unchosenCard = offered.cards[1];
  const chosen = chooseAssignmentOffer(room, owner, 'lionia', offered.cards, chosenCard.id, () => 0);

  assert.equal(chosen.ok, true);
  assert.equal(owner.activeAssignment.card.id, chosenCard.id);
  assert.deepEqual(room.assignmentDecks.lionia.drawPile.map(occurrenceKey), [occurrenceKey(unchosenCard)]);
  assert.equal(room.assignmentDecks.lionia.discard.length, 0);
});

test('Embassy one-candidate case remains assignable without creating a pending-only state', () => {
  const owner = player('owner');
  const room = factionRoom('lionia', [canonical('lionia', 'lionia-ship-level')]);
  room.players.push(owner);

  const offered = offerAssignmentCards(room, owner, 'lionia', 2, () => 0);
  assert.equal(offered.cards.length, 1);
  const issued = chooseAssignmentOffer(room, owner, 'lionia', offered.cards, offered.cards[0].id, () => 0);
  assert.equal(issued.ok, true);
  assert.equal(owner.activeAssignment.card.id, offered.cards[0].id);
  assert.equal(room.assignmentDecks.lionia.drawPile.length, 0);
});

test('completeAssignment recycles a completed occurrence exactly once', () => {
  const p = player();
  const room = factionRoom('lionia', [canonical('lionia', 'lionia-ship-level')]);
  room.players.push(p);
  assert.equal(issueAssignment(room, p, 'lionia', () => 0).ok, true);

  const first = completeAssignment(room, p, { type: 'ship-level' });
  assert.equal(first.ok, true);
  assert.equal(first.matched, true);
  assert.equal(p.activeAssignment, null);
  assert.equal(room.assignmentDecks.lionia.discard.length, 1);

  const second = completeAssignment(room, p, { type: 'ship-level' });
  assert.equal(second.ok, false);
  assert.equal(second.matched, false);
  assert.equal(room.assignmentDecks.lionia.discard.length, 1);
});

test('JSON restart with activeAssignment keeps the active occurrence unavailable', () => {
  const owner = player('owner');
  const room = factionRoom('lionia', [canonical('lionia', 'lionia-ship-level')]);
  room.players.push(owner);
  assert.equal(issueAssignment(room, owner, 'lionia', () => 0).ok, true);

  const restored = JSON.parse(JSON.stringify(room));
  const other = player('other');
  restored.players.push(other);
  const duplicateAttempt = issueAssignment(restored, other, 'lionia', () => 0);

  assert.equal(duplicateAttempt.ok, false);
  assert.equal(duplicateAttempt.empty, true);
  assert.equal(restored.players[0].activeAssignment.card.id, 'lionia-ship-level');
  assert.equal(restored.assignmentDecks.lionia.drawPile.length, 0);
});

test('JSON restart with pending Embassy options keeps all offered occurrences unavailable', () => {
  const owner = player('owner');
  const room = factionRoom('lionia', [
    canonical('lionia', 'lionia-ship-level'),
    canonical('lionia', 'lionia-yellow-a'),
  ]);
  room.players.push(owner);
  const offered = offerAssignmentCards(room, owner, 'lionia', 2, () => 0);
  room.pendingAssignmentChoice = {
    id: 'pending-embassy',
    kind: 'embassy',
    playerId: owner.id,
    factionId: 'lionia',
    options: offered.cards.map(card => ({ ...card })),
  };

  const restored = JSON.parse(JSON.stringify(room));
  const other = player('other');
  restored.players.push(other);
  const duplicateAttempt = issueAssignment(restored, other, 'lionia', () => 0);

  assert.equal(duplicateAttempt.ok, false);
  assert.equal(duplicateAttempt.empty, true);
  assert.equal(restored.pendingAssignmentChoice.options.length, 2);
  assert.equal(restored.assignmentDecks.lionia.drawPile.length, 0);
});

test('legacy assignment compatibility APIs keep their public return shapes', () => {
  const p = player();
  let room = factionRoom('lionia', [canonical('lionia', 'lionia-ship-level')]);
  room.players.push(p);
  const drawn = drawAssignmentCard(room, p, 'lionia', () => 0);
  assert.equal(drawn.id, 'lionia-ship-level');
  assert.equal(Object.hasOwn(drawn, 'copy'), true);

  const chooser = player('chooser');
  room = factionRoom('lionia', [
    canonical('lionia', 'lionia-ship-level'),
    canonical('lionia', 'lionia-yellow-a'),
  ]);
  room.players.push(chooser);
  const offered = offerAssignmentCards(room, chooser, 'lionia', 2, () => 0);
  assert.deepEqual(Object.keys(offered).sort(), ['cards', 'ok']);
  const chosen = chooseAssignmentOffer(room, chooser, 'lionia', offered.cards, offered.cards[0].id, () => 0);
  assert.equal(chosen.ok, true);
  assert.ok(chosen.assignment);
  assert.ok(chosen.assignment.card);
  const completed = completeAssignment(room, chooser, { type: chosen.assignment.card.type === 'ship-level' ? 'ship-level' : 'anchor-win', color: 'yellow' });
  assert.equal(typeof completed.ok, 'boolean');
  assert.equal(Object.hasOwn(completed, 'matched'), true);
});

test('AssignmentPool adds no room fields and persisted assignmentDecks keep only drawPile/discard/removed', () => {
  const room = factionRoom('lionia', [{ id: 'later', copy: 1 }]);
  room.marker = 'same';
  const beforeKeys = Object.keys(room).sort();
  const pool = assignmentPool(room, 'lionia', () => 0, { classify: () => 'skip' });
  pool.offerEligible(player(), 1);

  assert.deepEqual(Object.keys(room).sort(), beforeKeys);
  assert.equal(Object.hasOwn(room, 'assignmentPools'), false);
  assert.deepEqual(Object.keys(room.assignmentDecks.lionia).sort(), ['discard', 'drawPile', 'removed']);
});

test('AssignmentPool reserve/return/recycle/exclude operations use only legacy backing buckets', () => {
  const a = { id: 'a', copy: 1 };
  const b = { id: 'b', copy: 1 };
  const room = factionRoom('lionia', [a, b]);
  const pool = assignmentPool(room, 'lionia', () => 0, { classify: () => 'eligible' });

  assert.equal(pool.reserve(a).id, 'a');
  assert.equal(room.assignmentDecks.lionia.drawPile.some(card => card.id === 'a'), false);
  assert.equal(pool.returnUnchosen(a), 1);
  assert.equal(room.assignmentDecks.lionia.drawPile.some(card => card.id === 'a'), true);

  assert.equal(pool.excludePermanently(b), true);
  assert.equal(room.assignmentDecks.lionia.removed.some(card => card.id === 'b'), true);
  assert.equal(pool.returnUnchosen(b), 0);

  assert.equal(pool.reserve(a).id, 'a');
  assert.equal(pool.recycleCompleted(a), true);
  assert.deepEqual(pool.availabilityCounts(), { available: 0, recyclable: 1, removed: 1 });
  assert.deepEqual(Object.keys(room.assignmentDecks.lionia).sort(), ['discard', 'drawPile', 'removed']);
});
