'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  activateNextTurnEffects,
  getPendingAssignmentChoiceResolution,
} = require('../domain-state');
const { assignmentPool } = require('../assignment-pool');

const ROOT = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function functionSlice(text, name, nextName) {
  const start = text.indexOf('function ' + name);
  const end = nextName ? text.indexOf('function ' + nextName, start + 1) : text.length;
  assert.ok(start >= 0, name + ' not found');
  assert.ok(end > start, 'end for ' + name + ' not found');
  return text.slice(start, end);
}

test('CHECKPOINT G audit: pendingDecisionError uses PendingResolution facade only for migrated pending families', () => {
  const server = source('server.js');
  const block = functionSlice(server, 'pendingDecisionError', 'fleetAdjustmentOptions');
  for (const family of ['event', 'feud', 'assignment-choice', 'legendary-reaction']) {
    assert.ok(block.includes("hasPendingResolution(room, '" + family + "')"), family);
  }
  for (const legacy of ['pendingEvent', 'pendingFeud', 'pendingAssignmentChoice', 'pendingLegendaryReaction']) {
    assert.equal(block.includes('room?.' + legacy), false, legacy);
    assert.equal(block.includes('room.' + legacy), false, legacy);
  }
  for (const allowed of ['pendingAlliance', 'pendingBattle', 'pendingIslandCorrection', 'pendingFleetAdjustment']) {
    assert.equal(block.includes(allowed), true, allowed);
  }
});

test('CHECKPOINT G audit: AssignmentPool Embassy reservations read detached PendingResolution facade', () => {
  const assignment = source('assignment-pool.js');
  const block = functionSlice(assignment, 'reservedOccurrences', 'assignmentPool');
  assert.match(block, /getPendingAssignmentChoiceResolution\(room\)/);
  assert.doesNotMatch(block, /room\??\.pendingAssignmentChoice/);
  assert.match(block, /pending\.payload\?\.factionId/);
  assert.match(block, /pending\.options/);
});

test('Embassy reservation facade preserves option order and occurrence copy identity without extra source RNG', () => {
  const pendingOptions = [
    { id: 'same-id', copy: 1, marker: 'first' },
    { id: 'same-id', copy: 2, marker: 'second' },
  ];
  const room = {
    players: [],
    assignmentDecks: {
      lionia: {
        drawPile: [
          { ...pendingOptions[0] },
          { ...pendingOptions[1] },
          { id: 'same-id', copy: 3, marker: 'free' },
        ],
        discard: [],
        removed: [],
      },
    },
    pendingAssignmentChoice: {
      id: 'embassy-pending',
      kind: 'embassy',
      playerId: 'owner',
      factionId: 'lionia',
      options: pendingOptions.map(option => ({ ...option })),
    },
  };
  const beforePending = structuredClone(room.pendingAssignmentChoice);
  const detached = getPendingAssignmentChoiceResolution(room);
  detached.options[0].marker = 'detached-change';
  assert.deepEqual(room.pendingAssignmentChoice, beforePending);

  let rngCalls = 0;
  const pool = assignmentPool(room, 'lionia', () => { rngCalls += 1; return 0; }, {
    classify: () => 'eligible',
  });
  const offered = pool.offerEligible({ id: 'other', activeAssignment: null }, 1);

  assert.deepEqual(offered.map(card => [card.id, card.copy, card.marker]), [['same-id', 3, 'free']]);
  assert.deepEqual(room.pendingAssignmentChoice, beforePending);
  assert.deepEqual(room.assignmentDecks.lionia.drawPile.map(card => card.copy).sort(), [1, 2]);
  assert.equal(rngCalls, 1); // only the existing skipped-occurrence restore shuffle
});

test('TemporaryEffect facade promotes nextTurnEffects with exact overwrite, numeric and boolean semantics', () => {
  const player = {
    id: 'p1',
    activeTurnEffects: { moveBonus: 99, movePenalty: 88, noIncome: true },
    nextTurnEffects: {
      moveBonus: 3,
      movePenalty: 2,
      bestOfTwo: true,
      noIncome: false,
      noNavigation: true,
    },
  };
  const effects = activateNextTurnEffects(player);

  assert.deepEqual(player.activeTurnEffects, {
    moveBonus: 3,
    movePenalty: 2,
    bestOfTwo: true,
    noIncome: false,
    noNavigation: true,
  });
  assert.deepEqual(player.nextTurnEffects, {});
  assert.deepEqual(effects.map(effect => [effect.source.key, effect.payload.value]), [
    ['moveBonus', 3],
    ['movePenalty', 2],
    ['bestOfTwo', true],
    ['noIncome', false],
    ['noNavigation', true],
  ]);
  assert.equal(Object.hasOwn(player, 'temporaryEffects'), false);
  assert.equal(Object.hasOwn(player, 'effects'), false);
});

test('CHECKPOINT G audit: beginTurn delegates next-turn activation to TemporaryEffect facade', () => {
  const server = source('server.js');
  const block = functionSlice(server, 'beginTurn', 'endTurnInternal');
  assert.match(block, /activateNextTurnEffects\(p\)/);
  assert.doesNotMatch(block, /p\.activeTurnEffects\s*=/);
  assert.doesNotMatch(block, /p\.nextTurnEffects\s*=/);
});
