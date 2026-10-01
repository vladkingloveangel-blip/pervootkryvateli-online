'use strict';

const { calculateFinalScoring } = require('./final-scoring');

function acceptedForCurrentRound(room) {
  const consensus = room?.endGameConsensus;
  if (!consensus || consensus.status !== 'accepted') return false;
  const finishAfterRound = Number(consensus.finishAfterRound);
  const currentRound = Number(room?.round);
  return Number.isFinite(finishAfterRound)
    && Number.isFinite(currentRound)
    && finishAfterRound === currentRound;
}

function shouldFinalizeAtRoundBoundary(room, circlesPerRound) {
  return acceptedForCurrentRound(room)
    && Number(room?.circle) === Number(circlesPerRound);
}

function finalizeGameAtRoundBoundary(room, circlesPerRound) {
  if (!room || typeof room !== 'object') return { finalized: false, changed: false };
  if ((room.finished === true || room.phase === 'finished') && room.finalResult) {
    return { finalized: true, changed: false, finalResult: room.finalResult };
  }
  if (!shouldFinalizeAtRoundBoundary(room, circlesPerRound)) {
    return { finalized: false, changed: false };
  }

  const finishedRound = Number(room.round);
  const scoring = calculateFinalScoring(room);
  room.finalResult = {
    finishedRound,
    playerMetrics: scoring.playerMetrics,
    titles: scoring.titles,
  };
  room.finished = true;
  room.phase = 'finished';
  room.roll = null;
  room.movePoints = null;
  room.actionsLeft = 0;

  return { finalized: true, changed: true, finalResult: room.finalResult };
}

function completeRoundBoundaryAfterTurn(room, options = {}) {
  if (!room || typeof room !== 'object') return { finalized: false, changed: false, roundBoundary: false };
  if (room.phase === 'finished') {
    return {
      finalized: Boolean(room.finalResult),
      changed: false,
      roundBoundary: true,
      finalResult: room.finalResult || null,
    };
  }

  const n = Array.isArray(room.order) ? room.order.length : 0;
  if (!n || (Number(room.completedTurns) || 0) % n !== 0) {
    return { finalized: false, changed: false, roundBoundary: false };
  }

  const circlesPerRound = Number(options.circlesPerRound);
  if (!Number.isFinite(circlesPerRound) || circlesPerRound < 1) {
    throw new TypeError('completeRoundBoundaryAfterTurn requires circlesPerRound >= 1.');
  }
  if (typeof options.advanceRound !== 'function') {
    throw new TypeError('completeRoundBoundaryAfterTurn requires an advanceRound callback.');
  }

  const finalization = finalizeGameAtRoundBoundary(room, circlesPerRound);
  if (finalization.finalized) return { ...finalization, roundBoundary: true };

  room.circle = (Number(room.circle) || 1) + 1;
  if (room.circle > circlesPerRound) options.advanceRound(room);
  return { finalized: false, changed: true, roundBoundary: true };
}

module.exports = {
  shouldFinalizeAtRoundBoundary,
  finalizeGameAtRoundBoundary,
  completeRoundBoundaryAfterTurn,
};
