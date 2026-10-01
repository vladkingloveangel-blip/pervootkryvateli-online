'use strict';

function sameId(left, right) {
  return left !== undefined && left !== null
    && right !== undefined && right !== null
    && String(left) === String(right);
}

function participant(room, playerId) {
  return room?.players?.find(player => sameId(player?.id, playerId)) || null;
}

function currentConsensus(room) {
  const value = room?.endGameConsensus;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.status !== 'proposed' && value.status !== 'accepted') return null;
  return value;
}

function confirmedIds(consensus) {
  return Array.isArray(consensus?.confirmedPlayerIds)
    ? consensus.confirmedPlayerIds.map(id => String(id))
    : [];
}

function allPlayersConfirmed(room, consensus) {
  const confirmed = new Set(confirmedIds(consensus));
  return (room?.players || []).length > 0
    && room.players.every(player => confirmed.has(String(player.id)));
}

function finishAfterCurrentRound(room, consensus) {
  if (!allPlayersConfirmed(room, consensus)) return consensus;
  const round = Number(room?.round);
  if (!Number.isFinite(round)) {
    return { ok: false, error: 'Не удалось определить текущий раунд.' };
  }
  consensus.status = 'accepted';
  consensus.finishAfterRound = round;
  return consensus;
}

function endGameConsensusView(room) {
  const consensus = currentConsensus(room);
  if (!consensus) return null;
  return {
    status: consensus.status,
    proposedById: consensus.proposedById == null ? null : String(consensus.proposedById),
    confirmedPlayerIds: confirmedIds(consensus),
    finishAfterRound: consensus.finishAfterRound == null ? null : Number(consensus.finishAfterRound),
  };
}

function proposeEndGameConsensus(room, playerId) {
  if (!room?.started) return { ok: false, error: 'Завершение можно предложить только после начала партии.' };
  const player = participant(room, playerId);
  if (!player) return { ok: false, error: 'Игрок не является участником этой партии.' };

  const existing = currentConsensus(room);
  if (existing?.status === 'accepted') return { ok: false, error: 'Решение о завершении партии уже принято.' };
  if (existing?.status === 'proposed') return { ok: false, error: 'Предложение завершить партию уже ожидает решения игроков.' };

  room.endGameConsensus = {
    status: 'proposed',
    proposedById: String(player.id),
    confirmedPlayerIds: [String(player.id)],
    finishAfterRound: null,
  };

  const finalized = finishAfterCurrentRound(room, room.endGameConsensus);
  if (finalized?.ok === false) {
    delete room.endGameConsensus;
    return finalized;
  }
  return { ok: true, consensus: endGameConsensusView(room) };
}

function confirmEndGameConsensus(room, playerId) {
  if (!room?.started) return { ok: false, error: 'Партия ещё не началась.' };
  const player = participant(room, playerId);
  if (!player) return { ok: false, error: 'Игрок не является участником этой партии.' };

  const consensus = currentConsensus(room);
  if (!consensus) return { ok: false, error: 'Нет активного предложения завершить партию.' };
  if (consensus.status === 'accepted') {
    return { ok: true, consensus: endGameConsensusView(room), unchanged: true };
  }

  const playerKey = String(player.id);
  const ids = confirmedIds(consensus);
  if (!ids.includes(playerKey)) ids.push(playerKey);
  consensus.confirmedPlayerIds = ids;

  const finalized = finishAfterCurrentRound(room, consensus);
  if (finalized?.ok === false) return finalized;
  return { ok: true, consensus: endGameConsensusView(room) };
}

function rejectEndGameConsensus(room, playerId) {
  if (!room?.started) return { ok: false, error: 'Партия ещё не началась.' };
  const player = participant(room, playerId);
  if (!player) return { ok: false, error: 'Игрок не является участником этой партии.' };

  const consensus = currentConsensus(room);
  if (!consensus) return { ok: false, error: 'Нет активного предложения завершить партию.' };
  if (consensus.status === 'accepted') return { ok: false, error: 'Принятое единогласное решение уже не отменяется.' };
  if (sameId(consensus.proposedById, player.id)) {
    return { ok: false, error: 'Предложивший завершение уже считается подтвердившим решение.' };
  }

  delete room.endGameConsensus;
  return { ok: true, consensus: null };
}

module.exports = {
  endGameConsensusView,
  proposeEndGameConsensus,
  confirmEndGameConsensus,
  rejectEndGameConsensus,
};
