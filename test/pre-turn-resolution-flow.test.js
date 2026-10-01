'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PRE_TURN_STAGES,
  preTurnResolutionFlowFromLegacy,
  preTurnResolutionFlowToLegacy,
  getPreTurnResolutionFlow,
  setPreTurnResolutionFlow,
  clearPreTurnResolutionFlow,
  getPreTurnStage,
  setPreTurnStage,
  setPreTurnActive,
  getPreTurnStageIndex,
  setPreTurnStageIndex,
  advancePreTurnStageIndex,
  setPreTurnCurrentPlayer,
  setPreTurnLastCard,
  getPreTurnObservatoryReplacementsUsed,
  incrementObservatoryReplacement,
  setPreTurnTaxResult,
} = require('../domain-state');
const { projectRoomForViewer } = require('../state-projection');

const ROOT = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(ROOT, name), 'utf8');

function legacyFixture(stage = 'feud') {
  return {
    active: true,
    personalTurn: true,
    turnPlayerId: 'p1',
    stage,
    playerIndex: 1,
    currentPlayerId: 'p2',
    lastCard: { playerId: 'p2', cardName: 'Карта', pending: true, source: 'feud' },
    observatoryReplacementsUsed: 1,
    politicalSnapshot: { p1: { suzerainId: 'lionia', enemyFactionIds: ['kadingir'], hadAssignment: false } },
    feudQueue: [{ playerId: 'p1', factionId: 'kadingir' }, { playerId: 'p2', factionId: 'mori' }],
    feudIndex: 1,
    assignmentQueue: [{ playerId: 'p1', factionId: 'lionia' }],
    assignmentIndex: 0,
    replacementQueue: [{ legacy: true }],
    replacementIndex: 3,
    taxResult: { due: 2, paid: 1, underpaid: 1 },
    futureField: { nested: ['preserve'] },
  };
}

function functionSlice(text, name, nextName) {
  const start = text.indexOf('function ' + name);
  const end = nextName ? text.indexOf('function ' + nextName, start + 1) : text.length;
  assert.ok(start >= 0, name + ' not found');
  assert.ok(end > start, 'end for ' + name + ' not found');
  return text.slice(start, end);
}

test('PreTurnResolutionFlow maps legacy feud to semantic political and round-trips exact legacy shape', () => {
  const legacy = legacyFixture();
  const flow = preTurnResolutionFlowFromLegacy(legacy);
  assert.equal(flow.stage, 'political');
  assert.deepEqual(flow.indexes, { sailing: 1, political: 1, assignment: 0, replacement: 3 });
  assert.deepEqual(flow.queues.political, legacy.feudQueue);
  assert.deepEqual(flow.queues.assignment, legacy.assignmentQueue);
  assert.deepEqual(flow.queues.replacement, legacy.replacementQueue);
  assert.deepEqual(flow.politicalSnapshot, legacy.politicalSnapshot);
  assert.deepEqual(flow.counters, { observatoryReplacementsUsed: 1 });
  assert.deepEqual(flow.lastCard, legacy.lastCard);
  assert.deepEqual(flow.taxResult, legacy.taxResult);
  assert.deepEqual(preTurnResolutionFlowToLegacy(flow), legacy);
  assert.equal(Object.keys(flow).includes('futureField'), false);
});

test('PreTurnResolutionFlow detached read prevents nested writes from mutating room.eventPhase', () => {
  const room = { eventPhase: legacyFixture() };
  const before = structuredClone(room.eventPhase);
  const flow = getPreTurnResolutionFlow(room);
  flow.stage = 'assignment';
  flow.currentPlayerId = 'changed';
  flow.indexes.political = 99;
  flow.queues.political[0].playerId = 'changed';
  flow.politicalSnapshot.p1.enemyFactionIds.push('pirates');
  flow.lastCard.pending = false;
  flow.counters.observatoryReplacementsUsed = 7;
  flow.taxResult.underpaid = 99;
  assert.deepEqual(room.eventPhase, before);
});

test('stage mapping preserves sailing/assignment, maps political back to feud, and tolerates legacy unknown stage', () => {
  assert.deepEqual(PRE_TURN_STAGES, ['sailing', 'political', 'assignment']);
  for (const stage of ['sailing', 'assignment']) {
    const legacy = legacyFixture(stage);
    const flow = preTurnResolutionFlowFromLegacy(legacy);
    assert.equal(flow.stage, stage);
    assert.deepEqual(preTurnResolutionFlowToLegacy(flow), legacy);
  }
  const old = legacyFixture('assignment-replace');
  const oldFlow = preTurnResolutionFlowFromLegacy(old);
  assert.equal(oldFlow.stage, 'assignment-replace');
  assert.deepEqual(preTurnResolutionFlowToLegacy(oldFlow), old);
});

test('explicit facade helpers write only legacy eventPhase fields and semantic political never persists', () => {
  const room = { eventPhase: legacyFixture('sailing') };
  setPreTurnStage(room, 'political', { index: 0, currentPlayerId: 'p9' });
  assert.equal(getPreTurnStage(room), 'political');
  assert.equal(room.eventPhase.stage, 'feud');
  assert.equal(room.eventPhase.feudIndex, 0);
  assert.equal(room.eventPhase.currentPlayerId, 'p9');
  assert.equal(Object.hasOwn(room.eventPhase, 'politicalQueue'), false);
  assert.equal(Object.hasOwn(room.eventPhase, 'politicalIndex'), false);

  setPreTurnStageIndex(room, 'political', 4);
  assert.equal(getPreTurnStageIndex(room, 'political'), 4);
  assert.equal(advancePreTurnStageIndex(room, 'political'), 5);
  assert.equal(room.eventPhase.feudIndex, 5);
  setPreTurnCurrentPlayer(room, 'p2');
  setPreTurnLastCard(room, { playerId: 'p2', cardName: 'X', pending: false, source: 'feud' });
  assert.equal(room.eventPhase.currentPlayerId, 'p2');
  assert.equal(room.eventPhase.lastCard.cardName, 'X');
  assert.equal(getPreTurnObservatoryReplacementsUsed(room), 1);
  assert.equal(incrementObservatoryReplacement(room), 2);
  assert.equal(room.eventPhase.observatoryReplacementsUsed, 2);
  setPreTurnTaxResult(room, { due: 5 });
  assert.deepEqual(room.eventPhase.taxResult, { due: 5 });
  setPreTurnActive(room, false);
  assert.equal(room.eventPhase.active, false);
  clearPreTurnResolutionFlow(room);
  assert.equal(room.eventPhase, null);
});

test('new semantic flow persists exact old physical shape with replacement compatibility fields only', () => {
  const room = {};
  setPreTurnResolutionFlow(room, {
    active: true,
    personalTurn: true,
    turnPlayerId: 'p1',
    stage: 'political',
    currentPlayerId: 'p1',
    indexes: { sailing: 1, political: 0, assignment: 0, replacement: 0 },
    queues: {
      political: [{ playerId: 'p1', factionId: 'kadingir' }],
      assignment: [{ playerId: 'p1', factionId: 'lionia' }],
      replacement: [],
    },
    politicalSnapshot: { p1: { suzerainId: 'lionia', enemyFactionIds: ['kadingir'], hadAssignment: false } },
    counters: { observatoryReplacementsUsed: 0 },
    lastCard: null,
    taxResult: { due: 0 },
  });
  assert.deepEqual(room.eventPhase, {
    active: true,
    personalTurn: true,
    turnPlayerId: 'p1',
    stage: 'feud',
    currentPlayerId: 'p1',
    politicalSnapshot: { p1: { suzerainId: 'lionia', enemyFactionIds: ['kadingir'], hadAssignment: false } },
    lastCard: null,
    taxResult: { due: 0 },
    playerIndex: 1,
    feudIndex: 0,
    assignmentIndex: 0,
    replacementIndex: 0,
    feudQueue: [{ playerId: 'p1', factionId: 'kadingir' }],
    assignmentQueue: [{ playerId: 'p1', factionId: 'lionia' }],
    replacementQueue: [],
    observatoryReplacementsUsed: 0,
  });
  for (const key of ['preTurnFlow', 'resolutionFlow', 'eventFlow', 'preTurnResolution', 'flowState']) {
    assert.equal(Object.hasOwn(room, key), false);
  }
});

test('JSON restart preserves stage/cursors/queues/snapshot/counter/card/tax without reads rebuilding or mutating', () => {
  const original = {
    eventPhase: legacyFixture(),
    pendingFeud: { id: 'pending', playerId: 'p2', factionId: 'mori', options: [{ id: 'one' }] },
  };
  const restarted = JSON.parse(JSON.stringify(original));
  const before = structuredClone(restarted);
  const flow = getPreTurnResolutionFlow(restarted);
  assert.equal(flow.stage, 'political');
  assert.equal(flow.indexes.political, 1);
  assert.deepEqual(flow.queues.political, original.eventPhase.feudQueue);
  assert.deepEqual(flow.politicalSnapshot, original.eventPhase.politicalSnapshot);
  assert.equal(flow.counters.observatoryReplacementsUsed, 1);
  assert.deepEqual(flow.lastCard, original.eventPhase.lastCard);
  assert.deepEqual(flow.taxResult, original.eventPhase.taxResult);
  assert.deepEqual(restarted, before);
  assert.deepEqual(preTurnResolutionFlowToLegacy(flow), original.eventPhase);
});

test('public projection keeps legacy feud stage for actor and minimal envelope for non-actor', () => {
  const roomView = {
    version: '0.33.0',
    code: 'ABCDE',
    started: true,
    hostId: 'p1',
    leaderId: 'p1',
    round: 1,
    circle: 6,
    turnIndex: 0,
    activePlayerId: null,
    players: [],
    islands: [],
    eventPhase: {
      active: true,
      personalTurn: true,
      currentPlayerId: 'p1',
      playerIndex: 1,
      totalPlayers: 1,
      stage: 'feud',
      observatoryReplacementsUsed: 1,
      feudIndex: 1,
      feudTotal: 2,
      assignmentIndex: 0,
      assignmentTotal: 1,
      replacementIndex: 0,
      replacementTotal: 0,
      lastCard: { playerId: 'p1', cardName: 'X', pending: true, source: 'feud' },
      politicalSnapshot: { secret: true },
      taxResult: { secret: true },
      feudQueue: [{ secret: true }],
    },
  };
  const actor = projectRoomForViewer(roomView, { viewerId: 'p1' }).eventPhase;
  assert.equal(actor.stage, 'feud');
  assert.equal(Object.hasOwn(actor, 'politicalSnapshot'), false);
  assert.equal(Object.hasOwn(actor, 'taxResult'), false);
  assert.equal(Object.hasOwn(actor, 'feudQueue'), false);
  const opponent = projectRoomForViewer(roomView, { viewerId: 'p2' }).eventPhase;
  assert.deepEqual(opponent, { active: true, personalTurn: true, currentPlayerId: 'p1' });
});

test('server orchestration uses facade with exact blockers, cursor timing, queue snapshot and tax-once start', () => {
  const server = source('server.js');
  const process = functionSlice(server, 'processEventPhase', 'startEventPhase');
  const start = functionSlice(server, 'startEventPhase', 'finishEventPhase');
  const finishPendingFeud = functionSlice(server, 'finishPendingFeudCard', 'completePendingFeud');

  for (const family of ['event', 'feud', 'assignment-choice']) {
    assert.ok(process.includes("hasPendingResolution(room, '" + family + "')"));
  }
  assert.match(process, /room\.pendingIslandCorrection/);
  assert.match(process, /room\.pendingFleetAdjustment/);
  assert.doesNotMatch(process, /hasPendingDecision\(room\)/);
  assert.match(process, /safety\+\+ < 160/);
  assert.ok((process.match(/queueEscortCapacityDecisionsIfNeeded\(room\)/g) || []).length >= 2);

  assert.match(process, /flow\.stage === 'sailing'/);
  assert.match(process, /flow\.stage === 'political'/);
  assert.match(process, /flow\.stage === 'assignment'/);
  assert.doesNotMatch(process, /eventPhase\.(stage|playerIndex|feudIndex|assignmentIndex|currentPlayerId|lastCard|observatoryReplacementsUsed|taxResult)/);

  const assignmentAdvance = process.indexOf("advancePreTurnStageIndex(room, 'assignment')");
  const embassyPending = process.indexOf("setPendingLegacy(room, 'assignment-choice'");
  assert.ok(assignmentAdvance >= 0 && embassyPending > assignmentAdvance);

  const feudResolve = process.indexOf('resolveFeudCard(room');
  const feudPendingReturn = process.indexOf('if (resolved.pending) return;', feudResolve);
  const feudAdvance = process.indexOf("advancePreTurnStageIndex(room, 'political')", feudResolve);
  const fleetPause = process.indexOf('queueFleetAdjustment(room, player', feudResolve);
  const islandPause = process.indexOf('queueIslandCorrectionIfNeeded(room, null', feudResolve);
  assert.ok(feudResolve >= 0 && feudPendingReturn > feudResolve && feudAdvance > feudPendingReturn);
  assert.ok(fleetPause > feudAdvance && islandPause > feudAdvance);

  assert.ok(finishPendingFeud.indexOf('politicalEffectSource(room, pending.factionId).markUsed') < finishPendingFeud.indexOf('setPreTurnLastCard'));
  assert.ok(finishPendingFeud.indexOf('setPreTurnLastCard') < finishPendingFeud.indexOf("clearPendingResolution(room, 'feud')"));
  assert.ok(finishPendingFeud.indexOf("clearPendingResolution(room, 'feud')") < finishPendingFeud.indexOf("advancePreTurnStageIndex(room, 'political')"));

  for (const token of ['eventPoliticalSnapshot(room)', 'buildFeudQueue(room, snapshot)', 'buildAssignmentQueue(room, snapshot)', 'applyVassalTaxForTurn(room, snapshot, player.id)']) {
    assert.equal(start.split(token).length - 1, 1, token);
  }
  assert.ok(start.indexOf('setPreTurnResolutionFlow(room') < start.indexOf('applyVassalTaxForTurn(room, snapshot, player.id)'));
  assert.ok(start.indexOf('applyVassalTaxForTurn(room, snapshot, player.id)') < start.indexOf('setPreTurnTaxResult(room, taxResult)'));
});

test('Observatory replacement counter increments only in replace branch and facade itself has zero RNG/source rebuilding', () => {
  const server = source('server.js');
  const observatoryStart = server.indexOf("if (pending.kind === 'observatory')");
  const observatoryEnd = server.indexOf("if (pending.kind === 'cargo')", observatoryStart);
  const block = server.slice(observatoryStart, observatoryEnd);
  const replace = block.indexOf("if (choice === 'replace')");
  const increment = block.indexOf('incrementObservatoryReplacement(room)');
  const replaceObserved = block.indexOf('replaceObserved(first)');
  assert.ok(replace >= 0 && increment > replace && replaceObserved > increment);
  assert.equal((block.match(/incrementObservatoryReplacement\(room\)/g) || []).length, 1);

  const domain = source('domain-state.js');
  const facadeStart = domain.indexOf('const PRE_TURN_RESOLUTION_FLOW_LEGACY_SNAPSHOT');
  const facadeEnd = domain.indexOf('const RESOLUTION_QUEUE_FIELD', facadeStart);
  const facade = domain.slice(facadeStart, facadeEnd);
  assert.doesNotMatch(facade, /Math\.random|\brng\b|drawSailingEventCard|drawFeudCard|offerAssignmentCards|buildFeudQueue|buildAssignmentQueue|eventPoliticalSnapshot|applyVassalTaxForTurn/);
});

test('normal server runtime has no direct sensitive eventPhase management and initializes target preTurnResolutionFlow', () => {
  const server = source('server.js');
  assert.doesNotMatch(server, /room\.eventPhase\??\.(stage|playerIndex|feudIndex|assignmentIndex|currentPlayerId|lastCard|observatoryReplacementsUsed|taxResult)/);
  assert.equal(server.split('\n').filter(line => line.includes('room.eventPhase =')).length, 0);
  assert.match(server, /preTurnResolutionFlow: null/);
  assert.match(server, /clearPreTurnResolutionFlow\(room\)/);
  for (const field of ['preTurnFlow', 'resolutionFlow', 'eventFlow', 'preTurnResolution', 'flowState']) {
    assert.doesNotMatch(server, new RegExp('room\\.' + field + '\\b'));
  }
});
