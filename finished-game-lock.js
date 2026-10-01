'use strict';

const FINISHED_GAMEPLAY_ERROR = 'Партия уже завершена. Игровые действия недоступны.';

const FINISHED_ROOM_ALLOWED_EVENTS = new Set([
  'listMyRooms',
  'goHome',
  'adminListRooms',
  'adminWatchRoom',
  'adminStopWatching',
  'adminCloseRoom',
  'createRoom',
  'resumeRoom',
  'closeRoom',
  'disconnect',
]);

function isFinishedRoom(room) {
  return Boolean(room && (room.finished === true || room.phase === 'finished'));
}

function finishedGameEventError(room, event, _data = null) {
  if (!isFinishedRoom(room)) return null;
  if (FINISHED_ROOM_ALLOWED_EVENTS.has(String(event || ''))) return null;
  if (event === 'confirmEndGame' && room.endGameConsensus?.status === 'accepted') return null;
  return FINISHED_GAMEPLAY_ERROR;
}

module.exports = {
  FINISHED_GAMEPLAY_ERROR,
  FINISHED_ROOM_ALLOWED_EVENTS,
  isFinishedRoom,
  finishedGameEventError,
};
