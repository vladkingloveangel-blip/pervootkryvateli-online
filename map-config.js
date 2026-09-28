// Canonical map definition for Первооткрыватели Online.
// Coordinates are zero-based [row, col] on a 28×28 logical grid.
// Visual art is intentionally NOT authoritative: labels, markers and gameplay
// objects are rendered separately so the background/art can be replaced later.

const MAP_META = {
  id: 'world-28-v2',
  revision: 4,
  rows: 28,
  cols: 28,
  coordinateBase: 0,
  visualLayers: {
    sea: '/assets/map-sea.webp',
    land: '/assets/map-land.webp',
    legacyReference: '/assets/map.png',
  },
  onlineOnly: {
    showPrintedLabels: false,
    showTeleportCrosses: false,
    showStartArrows: false,
  },
};

function rect(r0, r1, c0, c1) {
  const out = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) out.push([row, col]);
  }
  return out;
}

const ISLAND_DEFS = [
  { id: 'bogamia', name: 'Богамия', kind: 'free', area: 3, army: 0, resources: ['Лес'], reward: '', cells: [[5,1],[5,2],[6,1],[6,2]] },
  { id: 'renaika', name: 'Ренаика', kind: 'free', area: 3, army: 0, resources: ['Экзотические звери'], reward: '', cells: [[4,5],[5,5],[6,5]] },
  { id: 'rit', name: 'Рит', kind: 'free', area: 3, army: 0, resources: ['Камень'], reward: '', cells: [[1,6],[1,7],[2,6],[2,7]] },
  { id: 'sengoi', name: 'Сэнгой', kind: 'free', area: 3, army: 0, resources: ['Рудная жила'], reward: '', cells: [[25,14],[25,15],[26,14],[26,15]] },
  { id: 'adzai', name: 'Адзаи', kind: 'free', area: 4, army: 0, resources: ['Лес'], reward: '', cells: [[19,13],[19,14],[20,13],[20,14],[21,13],[21,14]] },
  { id: 'chertog', name: 'Чертог', kind: 'free', area: 4, army: 0, resources: ['Рудная жила'], reward: '«Путь сквозь туман» при первом получении', cells: [[4,15],[4,16],[5,14],[5,15],[5,16],[6,15],[6,16]] },
  { id: 'dalerog', name: 'Далерог', kind: 'free', area: 5, army: 0, resources: ['Лес'], reward: '', cells: [[17,9],[17,10],[18,9],[18,10],[19,9],[19,10]] },
  { id: 'kukokum', name: 'Кукокум', kind: 'free', area: 6, army: 0, resources: ['Рудная жила'], reward: '', cells: [[23,10],[24,9],[24,10],[25,9],[25,10],[26,9],[26,10]] },
  { id: 'raisk', name: 'Райск', kind: 'free', area: 7, army: 0, resources: ['Камень'], reward: '', cells: rect(2,4,10,12) },
  { id: 'erkalon', name: 'Эркалон', kind: 'free', area: 7, army: 0, resources: ['Камень'], reward: '', cells: [[17,0],[17,1],[17,2],[18,0],[18,1],[18,2],[18,3],[19,0],[19,1],[19,2],[19,3]] },
  { id: 'kisalinia', name: 'Кисалиния', kind: 'free', area: 10, army: 0, resources: ['Лес'], reward: 'Форт I при первом получении', cells: [[15,24],[15,25],[15,26],[16,23],[16,24],[16,25],[16,26],[16,27],[17,23],[17,24],[17,25],[17,26],[17,27]] },

  { id: 'agmor', name: 'Агмор', kind: 'independent', area: 3, army: 4, resources: ['Камень'], reward: '6 дукатов', cells: [[13,7],[13,8],[14,7],[14,8]] },
  { id: 'asigoriy', name: 'Асигорий', kind: 'independent', area: 4, army: 12, resources: ['Рудная жила'], reward: '14 дукатов + случайная легендарная карта', cells: [[19,23],[19,24],[19,25],[20,23],[20,24],[20,25],[21,24]] },
  { id: 'harash', name: 'Хараш', kind: 'independent', area: 4, army: 6, resources: ['Невольники'], reward: '8 дукатов', cells: [[6,24],[7,24],[7,25],[7,26],[8,24],[8,25],[8,26]] },
  { id: 'yukon', name: 'Юкон', kind: 'independent', area: 5, army: 9, resources: ['Лес'], reward: '10 дукатов', cells: rect(20,22,5,7) },
  { id: 'atlantia', name: 'Атлантия', kind: 'independent', area: 12, army: 11, resources: ['Самородное золото'], reward: '14 дукатов', specialMark: true, cells: [[24,0],[24,1],...rect(25,27,0,4)] },
  { id: 'adia', name: 'Адия', kind: 'independent', area: 14, army: 18, resources: ['Алмазы'], reward: '24 дуката + случайная легендарная карта', specialMark: true, cells: [[23,25],[23,26],...rect(24,27,24,27)] },

  { id: 'landin', name: 'Ландин', kind: 'state', faction: 'Королевство Лиония', area: 4, army: 12, resources: ['Рудная жила'], reward: '', cells: [[8,18],[8,19],[9,17],[9,18],[9,19]] },
  { id: 'frandia', name: 'Франдия', kind: 'state', faction: 'Королевство Лиония', area: 9, army: 15, resources: ['Лес'], reward: '12 дукатов', cells: [[10,18],[10,19],[11,18],[11,19],[12,17],[12,18],[12,19],[12,20],[13,17],[13,18],[13,19],[13,20]] },
  { id: 'eidon', name: 'Эйдон', kind: 'state', faction: 'Королевство Лиония', area: 10, army: 18, resources: ['Камень'], reward: '', cells: [[9,21],[10,20],[10,21],[10,22],[11,20],[11,21],[11,22],[12,20],[12,21],[12,22]] },
  { id: 'kadingir', name: 'Кадингир', kind: 'state', faction: 'Царство Кадингир', area: 12, army: 16, resources: ['Лес','Камень'], reward: '36 дукатов', rewardNotePending: true, cells: [[0,24],[0,25],[0,26],[0,27],[1,23],[1,24],[1,25],[1,26],[1,27],[2,23],[2,24],[2,25],[2,26],[2,27],[3,26],[3,27],[4,27]] },
  { id: 'mao', name: 'Мао', kind: 'state', faction: 'Майо', area: 2, army: 3, resources: ['Рудная жила'], reward: '2 дуката', cells: [[0,20],[1,20]] },
  { id: 'maikan', name: 'Майкан', kind: 'state', faction: 'Майо', area: 8, army: 6, resources: ['Невольники'], reward: '6 дукатов', cells: [[0,18],[0,19],[1,18],[1,19],[2,18],[2,19],[2,20],[3,18],[3,19],[3,20]] },
  { id: 'miyosi', name: 'Миёси', kind: 'state', faction: 'Сёгунат Мори', area: 5, army: 12, resources: ['Камень'], reward: '8 дукатов', cells: rect(18,19,17,19) },
  { id: 'mori', name: 'Мори', kind: 'state', faction: 'Сёгунат Мори', area: 8, army: 18, resources: ['Лес','Рудная жила'], reward: '18 дукатов', cells: rect(22,26,18,20) },
  { id: 'suniksiya', name: 'Суниксия', kind: 'state', faction: 'Вольная Суниксия', area: 7, army: 9, resources: ['Лес'], reward: '', cells: [[10,2],[10,3],[11,1],[11,2],[11,3],[11,4],[12,2],[12,3],[12,4],[13,2],[13,3]] },
  { id: 'skull', name: 'Череп', kind: 'state', faction: 'Пираты', area: 4, army: 7, resources: ['Рудная жила'], reward: '', specialMark: true, cells: [[8,12],[8,13],[9,12],[9,13]] },
  { id: 'chertonia', name: 'Чертония', kind: 'state', faction: 'Пираты', area: 6, army: 10, resources: ['Камень'], reward: '6 дукатов', cells: [[6,8],[6,9],[7,7],[7,8],[7,9],[8,7],[8,8],[8,9],[9,8],[9,9]] },
];

// Cells where land occupies enough of the square to block ordinary sea movement.
const LAND_CELLS = [
  [5,1],[5,2],[6,2],[5,5],[1,6],[2,6],
  [2,11],[3,10],[3,12],[4,11],[4,12],
  [4,15],[5,15],[5,16],[6,16],[25,15],
  [20,13],[20,14],[21,14],[17,10],[18,9],[18,10],[19,10],
  [24,9],[24,10],[25,9],[25,10],[26,10],
  [17,1],[18,0],[18,1],[18,2],[19,1],[19,2],
  [16,24],[16,25],[16,26],[17,24],[17,25],[17,26],
  [13,7],[13,8],[14,8],[19,24],[20,24],
  [7,25],[8,24],[8,25],[20,6],[21,5],[21,6],[21,7],[22,6],
  [25,0],[25,1],[26,0],[26,1],[26,2],[26,3],[27,0],[27,1],[27,2],[27,3],
  [24,25],[24,26],[25,24],[25,25],[25,26],[25,27],[26,24],[26,25],[26,26],[26,27],[27,25],[27,26],[27,27],
  [8,18],[8,19],[9,18],[9,19],[11,18],[12,18],[12,19],[13,18],[13,19],
  [10,21],[11,20],[11,21],[11,22],[12,21],
  [0,25],[0,26],[0,27],[1,24],[1,25],[1,26],[1,27],[2,24],[2,25],[2,26],[2,27],[3,27],
  [0,20],[0,18],[1,18],[1,19],[2,18],[2,19],[2,20],[3,18],[3,19],
  [18,18],[19,18],[22,19],[23,18],[23,19],[23,20],[24,18],[24,19],[24,20],[25,18],[25,19],[25,20],[26,19],
  [11,2],[11,3],[12,2],[12,3],[13,3],[8,12],[9,12],[7,8],[7,9],[8,7],[8,8],[8,9],
];

const CITADEL = {
  id: 'citadel',
  name: 'Цитадель',
  type: 'hub',
  ownable: false,
  combatAllowed: false,
  services: ['sell-cargo','buy-ship-level','buy-ship-upgrade','buy-escort'],
  cells: [[13,13],[13,14],[14,13],[14,14]],
};
const CITADEL_CELLS = CITADEL.cells;
const SPECIAL_LAND = CITADEL_CELLS;

// Hazards remain separate from artwork and are interactive/passability data.
const HAZARDS = {
  reef: { id: 'reef', name: 'Рифы', marker: 'black-triangle', cells: [[6,7],[6,10],[7,7],[7,10],[8,6],[8,10],[9,7],[9,8],[9,9],[9,10]] },
  ice: { id: 'ice', name: 'Льды', marker: 'white-triangle', cells: [[23,0],[23,1],[23,2],[23,3],[23,4],[24,5],[25,5],[26,5],[27,5]] },
  shoal: { id: 'shoal', name: 'Мели', marker: 'yellow-triangle', cells: [[0,21],[1,21],[2,21],[3,21],[4,18],[4,19],[4,20],[4,21],[11,25],[11,27],[12,25],[12,27],[13,25],[13,26],[13,27]] },
};

const ANCHORS = {
  blue: { id: 'blue', name: 'Синий якорь', battleTier: 1, glory: 1, cells: [[5,11],[9,1],[16,5],[22,11]] },
  yellow: { id: 'yellow', name: 'Жёлтый якорь', visualColor: 'orange', battleTier: 2, glory: 3, cells: [[5,25],[10,16],[18,21]] },
  red: { id: 'red', name: 'Красный якорь', battleTier: 3, glory: 6, cells: [[26,21]] },
};

const LEGENDARY_PLACES = {
  kraken: { id: 'kraken', name: 'Кракен', type: 'legendary-sea-place', row: 24, col: 6, reward: 'legendary' },
  abyss: { id: 'abyss', name: 'Бездна', type: 'legendary-sea-place', row: 12, col: 26, reward: 'treasure' },
  pharaoh: { id: 'pharaoh', name: 'Фараон', type: 'legendary-sea-place', row: 5, col: 23, reward: 'treasure' },
  pearl: { id: 'pearl', name: 'Жемчужина', type: 'legendary-sea-place', row: 10, col: 10, reward: 'treasure' },
  vortex: { id: 'vortex', name: 'Воронка', type: 'legendary-sea-place', row: 15, col: 1, reward: null },
  icebergs: { id: 'icebergs', name: 'Асберги', type: 'legendary-sea-place', row: 27, col: 12, reward: null },
  rose: { id: 'rose', name: 'Роза', type: 'legendary-sea-place', row: 1, col: 15, reward: null },
};

// Board-game-only printed helpers. Kept as semantic data but hidden online.
// Teleport cells are intentionally not rendered. Exact event mapping can be
// connected later without requiring visible X markers.
const PRINT_HELPERS = {
  teleportCrosses: { visibleOnline: false, cells: [] },
  startArrows: { visibleOnline: false },
};

module.exports = {
  MAP_META,
  ISLAND_DEFS,
  LAND_CELLS,
  CITADEL,
  CITADEL_CELLS,
  SPECIAL_LAND,
  HAZARDS,
  ANCHORS,
  LEGENDARY_PLACES,
  PRINT_HELPERS,
};
