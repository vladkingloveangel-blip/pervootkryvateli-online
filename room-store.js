const { migrateRoomState } = require('./save-migrations');

// Keep the complete server state, including decks and pending decisions, private.
function roomSnapshot(room) {
  const snapshot = JSON.parse(JSON.stringify(room));
  for (const player of snapshot.players) {
    player.socketId = null;
    player.connected = false;
  }
  return snapshot;
}

function isUnfinished(room) {
  return !room.finished && !room.endedAt && room.phase !== 'finished';
}

class RoomStore {
  constructor(db, { retryMs = 1000, logger = console } = {}) {
    this.db = db;
    this.retryMs = retryMs;
    this.logger = logger;
    this.pending = new Map();
    this.running = null;
    this.lastError = null;
    this.restored = 0;
  }

  async init(rooms) {
    if (!this.db) return;
    await this.db.query(`CREATE TABLE IF NOT EXISTS game_rooms (
      code TEXT PRIMARY KEY,
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const result = await this.db.query('SELECT code, state FROM game_rooms');
    // Validate everything before making the restored rooms available.
    const restored = [];
    const migratedSnapshots = [];
    for (const row of result.rows) {
      let room;
      let migration;
      try {
        migration = migrateRoomState(row.state);
        room = migration.state;
      } catch (err) {
        throw new Error(`Invalid saved room: ${row.code}: ${err.message}`);
      }
      if (!room || room.code !== row.code || !Array.isArray(room.players) || !Array.isArray(room.islands) || !Array.isArray(room.order)) {
        throw new Error(`Invalid saved room: ${row.code}`);
      }
      const snapshot = roomSnapshot(room);
      if (migration.migrated) migratedSnapshots.push(snapshot);
      if (isUnfinished(room)) restored.push(snapshot);
    }
    // Resave only after every row has migrated and validated successfully.
    for (const snapshot of migratedSnapshots) {
      await this.db.query('UPDATE game_rooms SET state = $2::jsonb, updated_at = NOW() WHERE code = $1', [snapshot.code, JSON.stringify(snapshot)]);
    }
    for (const room of restored) rooms.set(room.code, room);
    this.restored = restored.length;
    this.logger.log(`Game rooms database ready. Restored ${this.restored} unfinished rooms.`);
  }

  save(room) {
    return this.enqueue(room.code, isUnfinished(room) ? roomSnapshot(room) : null);
  }

  remove(code) {
    return this.enqueue(code, null);
  }

  enqueue(code, snapshot) {
    if (!this.db) return Promise.resolve();
    // A newer snapshot (or deletion) supersedes an older pending write.
    // In-flight writes always finish before the next operation for this code.
    this.pending.set(code, { snapshot });
    return this.flush();
  }

  async drain() {
    while (this.pending.size) {
      const [code, operation] = this.pending.entries().next().value;
      try {
        if (operation.snapshot === null) {
          await this.db.query('DELETE FROM game_rooms WHERE code = $1', [code]);
        } else {
          await this.db.query(`INSERT INTO game_rooms (code, state) VALUES ($1, $2::jsonb)
            ON CONFLICT (code) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
          [code, JSON.stringify(operation.snapshot)]);
        }
        if (this.pending.get(code) === operation) this.pending.delete(code);
        this.lastError = null;
      } catch (err) {
        this.lastError = err;
        this.logger.error('Game rooms persistence failed; retrying:', err.message);
        await new Promise(resolve => setTimeout(resolve, this.retryMs));
      }
    }
  }

  async flush() {
    while (this.pending.size || this.running) {
      if (!this.running) this.running = this.drain().finally(() => { this.running = null; });
      await this.running;
    }
  }
}

module.exports = { RoomStore, roomSnapshot, isUnfinished };
