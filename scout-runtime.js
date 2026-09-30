'use strict';

const SCOUT_MODES = Object.freeze(['garrison', 'money']);

function heldCharacterId(player) {
  return typeof player?.character === 'string' ? player.character : player?.character?.id || null;
}

function activePlayerId(room) {
  if (!room?.started || !Array.isArray(room.order) || !room.order.length) return null;
  return room.order[Number(room.turnIndex) || 0] || null;
}

function manhattanDistance(a, b) {
  const ar = Number(a?.row), ac = Number(a?.col), br = Number(b?.row), bc = Number(b?.col);
  if (![ar, ac, br, bc].every(Number.isFinite)) return Infinity;
  return Math.abs(ar - br) + Math.abs(ac - bc);
}

function islandManhattanDistance(player, island) {
  if (!Array.isArray(island?.cells) || !island.cells.length) return Infinity;
  let best = Infinity;
  for (const cell of island.cells) {
    if (!Array.isArray(cell) || cell.length < 2) continue;
    const row = Number(cell[0]), col = Number(cell[1]);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
    best = Math.min(best, Math.abs(Number(player?.row) - row) + Math.abs(Number(player?.col) - col));
  }
  return best;
}

function playerManhattanDistance(player, target) {
  return manhattanDistance(player, target);
}

function buildScoutRevealGrant(room, player, request, range = 4) {
  const mode = String(request?.mode || '');
  if (!SCOUT_MODES.includes(mode)) return { ok: false, error: 'Недопустимый режим Разведчика.' };

  const personalTurnNo = Number(player?.personalTurnNo) || 0;
  if (!personalTurnNo) return { ok: false, error: 'Не удалось определить текущий личный ход Разведчика.' };

  const maxRange = Math.max(0, Number(range) || 0);
  if (mode === 'garrison') {
    const islandId = String(request?.islandId || '');
    const island = (room?.islands || []).find(item => String(item.id) === islandId);
    if (!island) return { ok: false, error: 'Остров для разведки не найден.' };
    if (islandManhattanDistance(player, island) > maxRange) return { ok: false, error: 'Остров находится дальше радиуса Разведчика.' };
    return {
      ok: true,
      grant: {
        viewerPlayerId: String(player.id),
        mode: 'garrison',
        islandId: String(island.id),
        personalTurnNo,
      },
    };
  }

  const targetPlayerId = String(request?.targetPlayerId || '');
  if (targetPlayerId === String(player?.id || '')) return { ok: false, error: 'Разведчик не может смотреть собственные деньги.' };
  const target = (room?.players || []).find(item => String(item.id) === targetPlayerId);
  if (!target) return { ok: false, error: 'Игрок для разведки не найден.' };
  if (playerManhattanDistance(player, target) > maxRange) return { ok: false, error: 'Корабль игрока находится дальше радиуса Разведчика.' };
  return {
    ok: true,
    grant: {
      viewerPlayerId: String(player.id),
      mode: 'money',
      targetPlayerId: String(target.id),
      personalTurnNo,
    },
  };
}

function applyScoutUse({ room, playerId, request, characterRule, hasBlockingPending = false, consumeCharacter }) {
  if (!room) return { ok: false, error: 'Комната не найдена.' };
  const player = (room.players || []).find(item => String(item.id) === String(playerId || ''));
  if (!player || activePlayerId(room) !== String(player.id)) return { ok: false, error: 'Сейчас не ваш личный ход.' };
  if (room.phase !== 'actions') return { ok: false, error: 'Разведчик применяется только после завершения навигации.' };
  if (hasBlockingPending) return { ok: false, error: 'Сначала завершите обязательное решение.' };

  const actionCost = Math.max(0, Number(characterRule?.useActionCost) || 0);
  if ((Number(room.actionsLeft) || 0) < actionCost) return { ok: false, error: 'Для Разведчика нужен один доступный пункт действия.' };
  if (heldCharacterId(player) !== 'scout') return { ok: false, error: 'На корабле нет Разведчика.' };

  const range = Math.max(0, Number(characterRule?.effect?.range) || 0);
  const reveal = buildScoutRevealGrant(room, player, request, range);
  if (!reveal.ok) return reveal;

  if (typeof consumeCharacter !== 'function') return { ok: false, error: 'Механизм расходования Разведчика недоступен.' };
  const consumed = consumeCharacter(player, 'scout');
  if (!consumed?.ok) return consumed || { ok: false, error: 'Не удалось расходовать Разведчика.' };

  room.actionsLeft = (Number(room.actionsLeft) || 0) - actionCost;
  const existing = Array.isArray(room.scoutRevealGrants) ? room.scoutRevealGrants : [];
  room.scoutRevealGrants = [
    ...existing.filter(grant => String(grant?.viewerPlayerId || '') !== String(player.id)),
    reveal.grant,
  ];
  return { ok: true, mode: reveal.grant.mode, actionCost, actionsLeft: room.actionsLeft };
}

function normalizeScoutRevealGrant(room, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const viewerId = raw.viewerPlayerId == null ? '' : String(raw.viewerPlayerId);
  if (!viewerId || activePlayerId(room) !== viewerId) return null;
  const viewer = (room?.players || []).find(item => String(item.id) === viewerId);
  if (!viewer) return null;

  const personalTurnNo = Number(viewer.personalTurnNo) || 0;
  if (!personalTurnNo || Number(raw.personalTurnNo) !== personalTurnNo) return null;

  if (raw.mode === 'money') {
    if (raw.targetPlayerId == null) return null;
    const targetPlayerId = String(raw.targetPlayerId);
    if (!targetPlayerId || targetPlayerId === viewerId) return null;
    const target = (room?.players || []).find(item => String(item.id) === targetPlayerId);
    if (!target) return null;
    return { viewerPlayerId: viewerId, mode: 'money', targetPlayerId, personalTurnNo };
  }

  if (raw.mode === 'garrison') {
    if (raw.islandId == null) return null;
    const islandId = String(raw.islandId);
    if (!islandId || !(room?.islands || []).some(item => String(item.id) === islandId)) return null;
    return { viewerPlayerId: viewerId, mode: 'garrison', islandId, personalTurnNo };
  }

  return null;
}

function activeScoutRevealGrants(room, viewerPlayerId) {
  const viewerId = viewerPlayerId == null ? null : String(viewerPlayerId);
  if (viewerId === null || activePlayerId(room) !== viewerId) return [];

  let activeGrant = null;
  for (const raw of Array.isArray(room?.scoutRevealGrants) ? room.scoutRevealGrants : []) {
    const grant = normalizeScoutRevealGrant(room, raw);
    if (grant && grant.viewerPlayerId === viewerId) activeGrant = grant;
  }
  return activeGrant ? [activeGrant] : [];
}

function normalizeScoutRevealGrants(room) {
  if (!room || typeof room !== 'object') return { changed: false, grants: [] };
  const previous = room.scoutRevealGrants;
  let activeGrant = null;
  for (const raw of Array.isArray(previous) ? previous : []) {
    const grant = normalizeScoutRevealGrant(room, raw);
    if (grant) activeGrant = grant;
  }
  const grants = activeGrant ? [activeGrant] : [];
  const changed = !Array.isArray(previous) || JSON.stringify(previous) !== JSON.stringify(grants);
  room.scoutRevealGrants = grants;
  return { changed, grants };
}

function scoutViewerContext(room, viewerPlayerId) {
  const viewerId = viewerPlayerId == null ? null : String(viewerPlayerId);
  return { viewerId, scoutRevealGrants: activeScoutRevealGrants(room, viewerId) };
}

function clearScoutRevealGrants(room, viewerPlayerId) {
  if (!room || !Array.isArray(room.scoutRevealGrants)) return 0;
  const viewerId = String(viewerPlayerId || '');
  const before = room.scoutRevealGrants.length;
  room.scoutRevealGrants = room.scoutRevealGrants.filter(grant => String(grant?.viewerPlayerId || '') !== viewerId);
  return before - room.scoutRevealGrants.length;
}

module.exports = {
  SCOUT_MODES,
  activePlayerId,
  manhattanDistance,
  islandManhattanDistance,
  playerManhattanDistance,
  buildScoutRevealGrant,
  applyScoutUse,
  activeScoutRevealGrants,
  normalizeScoutRevealGrants,
  scoutViewerContext,
  clearScoutRevealGrants,
};
