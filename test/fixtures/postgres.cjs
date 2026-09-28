// Test-only Postgres emulator. Persist rows to a temporary file across real
// server-process restarts; production always uses the actual pg driver.
const fs = require('node:fs');
const Module = require('node:module');
const { newDb } = require('pg-mem');
const { Pool } = newDb().adapters.createPg();
const filename = process.env.TEST_DB_FILE;
const seed = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : {};
const tables = new Set();
class TestPool extends Pool {
  async query(sql, params) {
    const result = await super.query(sql, params);
    const match = sql.match(/CREATE TABLE IF NOT EXISTS (users|game_rooms)/);
    if (match && !tables.has(match[1])) {
      const table = match[1];
      tables.add(table);
      for (const row of seed[table] || []) {
        const columns = Object.keys(row);
        await super.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')})`, columns.map(k => k === 'state' ? JSON.stringify(row[k]) : row[k]));
      }
    }
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
      const data = {};
      for (const table of tables) data[table] = (await super.query('SELECT * FROM ' + table)).rows;
      fs.writeFileSync(filename, JSON.stringify(data));
    }
    return result;
  }
}
const load = Module._load;
Module._load = function(request, ...args) { return request === 'pg' ? { Pool: TestPool } : load.call(this, request, ...args); };
