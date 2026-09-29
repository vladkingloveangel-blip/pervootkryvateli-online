// Compatibility entry point. Hand-authored balance lives in rules/.
const runtime = require('./rules/runtime');
const map = require('./map-config');
const rules = require('./rules');
const COLORS = ['#e53935', '#1e88e5', '#43a047', '#8e24aa', '#fb8c00'];
function cellKey(row, col) { return `${row},${col}`; }
const HAZARDS = Object.fromEntries(Object.entries(map.HAZARDS).map(([id, def]) => [id, def.cells]));
const ISLAND_BY_CELL = new Map();
for (const island of map.ISLAND_DEFS) {
  for (const [row, col] of island.cells) {
    const key = cellKey(row, col);
    if (!ISLAND_BY_CELL.has(key)) ISLAND_BY_CELL.set(key, []);
    ISLAND_BY_CELL.get(key).push(island.id);
  }
}
const HAZARD_BY_CELL = new Map();
for (const [type, cells] of Object.entries(HAZARDS)) {
  for (const [row, col] of cells) HAZARD_BY_CELL.set(cellKey(row, col), type);
}
const ANCHORS = Object.fromEntries(Object.entries(map.ANCHORS)
  .map(([id, anchor]) => [id, { ...anchor, glory: runtime.ANCHOR_GLORY[id] }]));
const ANCHOR_BY_CELL = new Map();
for (const [color, def] of Object.entries(ANCHORS)) {
  for (const [row, col] of def.cells) ANCHOR_BY_CELL.set(cellKey(row, col), color);
}
const LEGENDARY_PLACES = Object.fromEntries(Object.entries(map.LEGENDARY_PLACES).map(([id, place]) => {
  const rule = rules.legends.places.find(p => p.id === id);
  return [id, { ...place, reward: rule.unresolved ? null : rule.reward.type }];
}));
module.exports = {
  ...runtime, ...map, COLORS, HAZARDS, ANCHORS, LEGENDARY_PLACES,
  ISLAND_BY_CELL, HAZARD_BY_CELL, ANCHOR_BY_CELL, cellKey,
};
