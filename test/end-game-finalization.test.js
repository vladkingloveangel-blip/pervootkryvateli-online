'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldFinalizeAtRoundBoundary,
  finalizeGameAtRoundBoundary,
  completeRoundBoundaryAfterTurn,
} = require('../end-game-finalization');

const CIRCLES = 6;

function island(id, ownerId, buildings = [{ type: 'farm', level: 1 }]) {
  return { id, ownerId, buildings };
}

function roomAtLastTurn(overrides = {}) {
  const players = [
    { id: 'p1', ducats: 10, debt: 0, armyPoints: 1, fleetPoints: 2, visitedAnchors: ['red'], attackCountsThisRound: { p2: 1 } },
    { id: 'p2', ducats: 20, debt: 0, armyPoints: 3, fleetPoints: 4, visitedAnchors: ['blue'], attackCountsThisRound: { p1: 1 } },
  ];
  return {
    started: true,
    order: ['p1', 'p2'],
    players,
    islands: [island('i1', 'p1'), island('i2', 'p2')],
    discoveries: {},
    round: 3,
    circle: 6,
    completedTurns: 11,
    turnIndex: 1,
    phase: 'actions',
    roll: 4,
    movePoints: 5,
    actionsLeft: 2,
    endGameConsensus: {
      status: 'accepted',
      proposedById: 'p1',
      confirmedPlayerIds: ['p1', 'p2'],
      finishAfterRound: 3,
    },
    ...overrides,
  };
}

function clockHarness(calls) {
  return {
    circlesPerRound: CIRCLES,
    advanceRound(room) {
      calls.advanceRound += 1;
      room.round += 1;
      room.circle = 1;
      for (const island of room.islands) island.loadedRound = null;
      for (const player of room.players) {
        player.visitedAnchors = [];
        player.attackCountsThisRound = {};
      }
    },
  };
}

function finishPersonalTurn(room, calls) {
  if (room.phase === 'finished') {
    return completeRoundBoundaryAfterTurn(room, clockHarness(calls));
  }
  const n = room.order.length;
  room.completedTurns += 1;
  room.turnIndex = (room.turnIndex + 1) % n;
  const boundary = completeRoundBoundaryAfterTurn(room, clockHarness(calls));
  if (!boundary.finalized) {
    calls.beginTurn += 1;
    room.phase = 'navigation';
    room.roll = null;
    room.movePoints = null;
    room.actionsLeft = 3;
    room.players[room.turnIndex].ducats += 1000;
  }
  return boundary;
}

test('accepted consensus in an early circle does not finish before the sixth circle', () => {
  const room = roomAtLastTurn({ circle: 2, completedTurns: 3, round: 3 });
  const calls = { advanceRound: 0, beginTurn: 0 };
  const result = finishPersonalTurn(room, calls);

  assert.equal(result.finalized, false);
  assert.equal(room.finished, undefined);
  assert.equal(room.finalResult, undefined);
  assert.deepEqual([room.round, room.circle], [3, 3]);
  assert.equal(calls.advanceRound, 0);
  assert.equal(calls.beginTurn, 1);
});

test('accepted target round finalizes after the last player of the sixth circle without starting another round or turn', () => {
  const room = roomAtLastTurn();
  const calls = { advanceRound: 0, beginTurn: 0 };

  assert.equal(shouldFinalizeAtRoundBoundary(room, CIRCLES), true);
  const result = finishPersonalTurn(room, calls);

  assert.equal(result.finalized, true);
  assert.equal(result.changed, true);
  assert.equal(room.round, 3);
  assert.equal(room.circle, 6);
  assert.equal(room.turnIndex, 0);
  assert.equal(room.finished, true);
  assert.equal(room.phase, 'finished');
  assert.equal(room.roll, null);
  assert.equal(room.movePoints, null);
  assert.equal(room.actionsLeft, 0);
  assert.ok(room.finalResult);
  assert.equal(calls.advanceRound, 0);
  assert.equal(calls.beginTurn, 0);
});

test('without accepted consensus the legacy sixth-circle boundary advances the round and begins the next turn', () => {
  const room = roomAtLastTurn({ endGameConsensus: undefined });
  const calls = { advanceRound: 0, beginTurn: 0 };

  const result = finishPersonalTurn(room, calls);

  assert.equal(result.finalized, false);
  assert.deepEqual([room.round, room.circle], [4, 1]);
  assert.equal(room.phase, 'navigation');
  assert.equal(calls.advanceRound, 1);
  assert.equal(calls.beginTurn, 1);
});

test('accepted consensus for a future round does not finish the current round', () => {
  const room = roomAtLastTurn({
    endGameConsensus: {
      status: 'accepted',
      proposedById: 'p1',
      confirmedPlayerIds: ['p1', 'p2'],
      finishAfterRound: 4,
    },
  });
  const calls = { advanceRound: 0, beginTurn: 0 };

  finishPersonalTurn(room, calls);

  assert.equal(room.finished, undefined);
  assert.equal(room.finalResult, undefined);
  assert.deepEqual([room.round, room.circle], [4, 1]);
  assert.equal(calls.advanceRound, 1);
  assert.equal(calls.beginTurn, 1);
});

test('final scoring sees state changes made immediately before the last endTurn', () => {
  const room = roomAtLastTurn();
  room.players[1].ducats = 77;
  room.players[1].debt = 7;
  room.players[1].armyPoints = 11;
  room.players[1].fleetPoints = 12;
  const calls = { advanceRound: 0, beginTurn: 0 };

  finishPersonalTurn(room, calls);

  const p2 = room.finalResult.playerMetrics.find(entry => entry.playerId === 'p2');
  assert.deepEqual(p2.metrics, {
    islands: 1,
    wealth: 70,
    army: 11,
    fleet: 12,
    prestige: 0,
    legendaryPlaces: 0,
  });
});

test('finalResult contains all six canonical titles and no overall winner', () => {
  const room = roomAtLastTurn();
  const calls = { advanceRound: 0, beginTurn: 0 };

  finishPersonalTurn(room, calls);

  assert.equal(room.finalResult.finishedRound, 3);
  assert.equal(room.finalResult.titles.length, 6);
  assert.deepEqual(room.finalResult.titles.map(entry => entry.id).sort(), [
    'army', 'fleet', 'islands', 'legendaryPlaces', 'prestige', 'wealth',
  ]);
  assert.equal(Object.hasOwn(room.finalResult, 'winnerId'), false);
  assert.equal(Object.hasOwn(room.finalResult, 'overallScore'), false);
});

test('finalization does not run next-round income/navigation or round reset callbacks', () => {
  const room = roomAtLastTurn();
  room.islands[0].loadedRound = 3;
  const beforeAnchors = structuredClone(room.players.map(player => player.visitedAnchors));
  const beforeAttacks = structuredClone(room.players.map(player => player.attackCountsThisRound));
  const beforeDucats = room.players[0].ducats;
  const calls = { advanceRound: 0, beginTurn: 0 };

  finishPersonalTurn(room, calls);

  assert.equal(calls.advanceRound, 0);
  assert.equal(calls.beginTurn, 0);
  assert.equal(room.islands[0].loadedRound, 3);
  assert.deepEqual(room.players.map(player => player.visitedAnchors), beforeAnchors);
  assert.deepEqual(room.players.map(player => player.attackCountsThisRound), beforeAttacks);
  assert.equal(room.players[0].ducats, beforeDucats);
  assert.equal(room.phase, 'finished');
});

test('finalization is idempotent and a repeated end-turn boundary cannot resume play or change finalResult', () => {
  const room = roomAtLastTurn();
  const calls = { advanceRound: 0, beginTurn: 0 };
  finishPersonalTurn(room, calls);

  const beforeResult = structuredClone(room.finalResult);
  const beforeClock = {
    round: room.round,
    circle: room.circle,
    completedTurns: room.completedTurns,
    turnIndex: room.turnIndex,
    phase: room.phase,
  };

  const repeated = finishPersonalTurn(room, calls);
  const directRepeated = finalizeGameAtRoundBoundary(room, CIRCLES);

  assert.equal(repeated.finalized, true);
  assert.equal(repeated.changed, false);
  assert.equal(directRepeated.finalized, true);
  assert.equal(directRepeated.changed, false);
  assert.deepEqual(room.finalResult, beforeResult);
  assert.deepEqual({
    round: room.round,
    circle: room.circle,
    completedTurns: room.completedTurns,
    turnIndex: room.turnIndex,
    phase: room.phase,
  }, beforeClock);
  assert.equal(calls.advanceRound, 0);
  assert.equal(calls.beginTurn, 0);
});
