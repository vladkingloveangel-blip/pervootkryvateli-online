'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  FINISHED_GAMEPLAY_ERROR,
  FINISHED_ROOM_ALLOWED_EVENTS,
  isFinishedRoom,
  finishedGameEventError,
} = require('../finished-game-lock');
const { finalizeGameAtRoundBoundary } = require('../end-game-finalization');

function finishedRoom() {
  return {
    started: true,
    finished: true,
    phase: 'finished',
    round: 3,
    circle: 6,
    turnIndex: 0,
    completedTurns: 12,
    roll: null,
    movePoints: null,
    actionsLeft: 0,
    order: ['p1', 'p2'],
    players: [
      { id: 'p1', ducats: 20, debt: 0, armyPoints: 2, fleetPoints: 3 },
      { id: 'p2', ducats: 15, debt: 0, armyPoints: 4, fleetPoints: 5 },
    ],
    islands: [
      { id: 'i1', ownerId: 'p1', buildings: [{ type: 'farm', level: 1 }] },
      { id: 'i2', ownerId: 'p2', buildings: [{ type: 'farm', level: 1 }] },
    ],
    discoveries: { kraken: { ownerId: 'p1' } },
    endGameConsensus: {
      status: 'accepted',
      proposedById: 'p1',
      confirmedPlayerIds: ['p1', 'p2'],
      finishAfterRound: 3,
    },
    finalResult: {
      finishedRound: 3,
      playerMetrics: [
        { playerId: 'p1', metrics: { islands: 1, wealth: 20, army: 2, fleet: 3, prestige: 0, legendaryPlaces: 1 } },
        { playerId: 'p2', metrics: { islands: 1, wealth: 15, army: 4, fleet: 5, prestige: 0, legendaryPlaces: 0 } },
      ],
      titles: Array.from({ length: 6 }, (_, index) => ({ id: 'title-' + index, winnerIds: [] })),
    },
  };
}

test('central finished-game guard blocks representative gameplay socket events regardless of payload validity', () => {
  const room = finishedRoom();
  const before = structuredClone(room);
  const attempts = [
    ['moveTo', { row: 0, col: 0 }],
    ['build', { islandId: 'i1', buildingType: 'farm' }],
    ['attackShip', { targetPlayerId: 'p2' }],
    ['playLegendary', { source: 'legendary', index: 0 }],
    ['takeExpedition', { expeditionId: 'expedition-any' }],
    ['respondEvent', { eventId: 'valid-looking', choice: 'keep' }],
    ['endTurn', {}],
  ];

  for (const [event, payload] of attempts) {
    assert.equal(finishedGameEventError(room, event, payload), FINISHED_GAMEPLAY_ERROR, event);
  }
  assert.deepEqual(room, before);
});

test('finished-game whitelist keeps lifecycle, reconnect and admin observation available but does not allow joining gameplay', () => {
  const room = finishedRoom();
  for (const event of [
    'listMyRooms', 'goHome', 'adminListRooms', 'adminWatchRoom', 'adminStopWatching',
    'adminCloseRoom', 'createRoom', 'resumeRoom', 'closeRoom', 'disconnect',
  ]) {
    assert.equal(FINISHED_ROOM_ALLOWED_EVENTS.has(event), true, event);
    assert.equal(finishedGameEventError(room, event), null, event);
  }
  assert.equal(finishedGameEventError(room, 'joinRoom', { code: 'ABCDE' }), FINISHED_GAMEPLAY_ERROR);
});

test('accepted consensus confirmation remains idempotently allowed while proposal and rejection are locked', () => {
  const room = finishedRoom();
  assert.equal(finishedGameEventError(room, 'confirmEndGame'), null);
  assert.equal(finishedGameEventError(room, 'proposeEndGame'), FINISHED_GAMEPLAY_ERROR);
  assert.equal(finishedGameEventError(room, 'rejectEndGame'), FINISHED_GAMEPLAY_ERROR);

  room.endGameConsensus.status = 'proposed';
  assert.equal(finishedGameEventError(room, 'confirmEndGame'), FINISHED_GAMEPLAY_ERROR);
});

test('unfinished rooms keep accepting the same gameplay event classes through the central guard', () => {
  const room = finishedRoom();
  room.finished = false;
  room.phase = 'actions';
  for (const event of ['moveTo', 'build', 'attackShip', 'playLegendary', 'takeExpedition', 'respondEvent', 'endTurn']) {
    assert.equal(finishedGameEventError(room, event, { valid: true }), null, event);
  }
  assert.equal(isFinishedRoom(room), false);
});

test('repeated finalization preserves the original finalResult snapshot even after source metrics are changed', () => {
  const room = finishedRoom();
  const original = structuredClone(room.finalResult);
  room.players[0].ducats = 9999;
  room.players[0].armyPoints = 9999;
  room.islands.push({ id: 'late-island', ownerId: 'p1', buildings: [{ type: 'palace', level: 1 }] });
  room.discoveries.abyss = { ownerId: 'p1' };

  const result = finalizeGameAtRoundBoundary(room, 6);

  assert.equal(result.finalized, true);
  assert.equal(result.changed, false);
  assert.deepEqual(room.finalResult, original);
});

test('server applies one central guard before socket handlers and keeps finished maintenance/continuations inert', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  const socketStart = source.indexOf('function onSocketEvent(socket, event, handler)');
  const socketEnd = source.indexOf('\nfunction makeCode', socketStart);
  const socketBody = source.slice(socketStart, socketEnd);
  const guardAt = socketBody.indexOf('finishedGameEventError(');
  const handlerAt = socketBody.indexOf('handler(...args');
  assert.ok(guardAt > 0, 'central finished-game guard is present in onSocketEvent');
  assert.equal(socketBody.includes('assignmentPriorityError('), false, 'assignment availability no longer blocks socket commands');
  assert.ok(handlerAt > guardAt, 'finished-game guard runs before the event handler');

  const emitStart = source.indexOf('function emitRoom(room)');
  const emitEnd = source.indexOf('\nfunction emitConsensusRoom', emitStart);
  const emitBody = source.slice(emitStart, emitEnd);
  assert.ok(emitBody.includes('if (!isFinishedRoom(room))'));
  assert.ok(emitBody.indexOf('queueIslandCorrectionIfNeeded') > emitBody.indexOf('if (!isFinishedRoom(room))'));
  assert.ok(emitBody.indexOf('queueEscortCapacityDecisionsIfNeeded') > emitBody.indexOf('if (!isFinishedRoom(room))'));

  for (const name of ['processEventPhase', 'startEventPhase', 'finishEventPhase', 'advanceRound', 'beginTurn', 'continueTurnAfterCards']) {
    const start = source.indexOf('function ' + name + '(room');
    const end = source.indexOf('\nfunction ', start + 1);
    const body = source.slice(start, end);
    assert.ok(body.includes('if (isFinishedRoom(room)) return;'), name + ' is inert after finish');
  }
});

test('resumeRoom remains reachable for an in-memory finished room without exposing a gameplay bypass', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf("onSocketEvent(socket, 'resumeRoom'");
  const end = source.indexOf("\n  onSocketEvent(socket, 'changeShip'", start);
  const body = source.slice(start, end);

  assert.ok(start > 0);
  assert.ok(body.includes('attachPlayer(socket, room, player)'));
  assert.ok(body.includes('emitRoom(room)'));
  assert.equal(body.includes('finalResult ='), false);
  assert.equal(body.includes('beginTurn('), false);
  assert.equal(body.includes('advanceRound('), false);
});
