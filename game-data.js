const SHIPS = {
  brigantine: { id: 'brigantine', name: 'Бригантина', artillery: 3, army: 3, cargo: 2, moveMod: 1, passability: 'shoal' },
  frigate: { id: 'frigate', name: 'Фрегат', artillery: 5, army: 3, cargo: 2, moveMod: 0, passability: 'reef' },
  caravel: { id: 'caravel', name: 'Каравелла', artillery: 3, army: 5, cargo: 2, moveMod: 0, passability: 'land1' },
  carrack: { id: 'carrack', name: 'Каракка', artillery: 3, army: 4, cargo: 5, moveMod: -1, passability: 'ice' },
};

// Цена перехода платится именно за следующую ступень. statBonus прибавляется
// к артиллерии, войску и трюму исходного корабля; moveBonus — к движению.
const SHIP_LEVELS = {
  1: { level: 1, price: 0, statBonus: 0, moveBonus: 0 },
  2: { level: 2, price: 8, statBonus: 1, moveBonus: 0 },
  3: { level: 3, price: 11, statBonus: 2, moveBonus: 0 },
  4: { level: 4, price: 14, statBonus: 3, moveBonus: 1 },
  5: { level: 5, price: 17, statBonus: 4, moveBonus: 1 },
  6: { level: 6, price: 20, statBonus: 5, moveBonus: 1 },
  7: { level: 7, price: 23, statBonus: 6, moveBonus: 2 },
};

const SHIP_UPGRADES = {
  falcons: { id: 'falcons', name: 'Фальконы', branch: 'artillery', order: 1, price: 6, artillery: 2 },
  culverins: { id: 'culverins', name: 'Кулеврины', branch: 'artillery', order: 2, price: 10, artillery: 3, requires: 'falcons' },
  musketeers: { id: 'musketeers', name: 'Мушкетёры', branch: 'army', order: 1, price: 6, army: 2 },
  pikemen: { id: 'pikemen', name: 'Пикинёры', branch: 'army', order: 2, price: 10, army: 3, requires: 'musketeers' },
  orlop: { id: 'orlop', name: 'Орлоп-палуба', branch: 'cargo', order: 1, price: 6, cargo: 2 },
  sternStores: { id: 'sternStores', name: 'Кормовые кладовые', branch: 'cargo', order: 2, price: 10, cargo: 2, requires: 'orlop' },
  foreStengha: { id: 'foreStengha', name: 'Фор-стеньга', branch: 'speed', order: 1, price: 7, movement: 1 },
  foreMarsel: { id: 'foreMarsel', name: 'Фор-марсель', branch: 'speed', order: 2, price: 11, movement: 1, requires: 'foreStengha' },
};

const ESCORTS = {
  cargo: { id: 'cargo', name: 'Грузовой эскорт', artillery: 0, army: 0, cargo: 5 },
  combat: { id: 'combat', name: 'Боевой эскорт', artillery: 6, army: 0, cargo: 0 },
  // Пользовательская редакция: особое судно Ландина совмещает функции
  // боевого и грузового сопровождения, но по-прежнему занимает одно место
  // в общем пределе сопровождения. Место верфи ему не требуется.
  landin: { id: 'landin', name: 'Особое сопровождение Ландина', artillery: 6, army: 0, cargo: 5, special: true },
};

const COLORS = ['#e53935', '#1e88e5', '#43a047', '#8e24aa', '#fb8c00'];

// Разовая военная добыча карточек островов. Награды, связанные с ещё не
// реализованными колодами, хранятся как отложенные жетоны/карты у игрока.
const MILITARY_REWARDS = {
  agmor: { ducats: 6 },
  asigoriy: { ducats: 14, legendary: 1 },
  harash: { ducats: 8 },
  yukon: { ducats: 10 },
  atlantia: { ducats: 14 },
  adia: { ducats: 24, legendary: 1 },
  landin: { preserveBuildings: [{ type: 'fortress', level: 1 }], specialLandinEscort: true },
  frandia: { ducats: 12, preserveBuildings: [{ type: 'manor', level: 1 }] },
  eidon: { preserveBuildings: [{ type: 'fortress', level: 1 }, { type: 'manor', level: 1 }, { type: 'bank', level: 1 }] },
  kadingir: { ducats: 36, preserveBuildings: [{ type: 'bank', level: 1 }] },
  mao: { ducats: 2 },
  maikan: { ducats: 6 },
  suniksiya: { preserveBuildings: [{ type: 'farm', level: 1 }, { type: 'market', level: 1 }] },
  skull: { legendary: 1 },
  chertonia: { ducats: 6, preserveBuildings: [{ type: 'fort', level: 1 }] },
};

const GOODS = {
  provisions: { id: 'provisions', name: 'Провиант', price: 2 },
  wood: { id: 'wood', name: 'Лес', price: 3 },
  stone: { id: 'stone', name: 'Камень', price: 3 },
  ore: { id: 'ore', name: 'Руда', price: 3 },
  exotic: { id: 'exotic', name: 'Экзотические звери', price: 5 },
  slaves: { id: 'slaves', name: 'Невольники', price: 6 },
  gold: { id: 'gold', name: 'Самородное золото', price: 7 },
  diamonds: { id: 'diamonds', name: 'Алмазы', price: 8 },
};

const BUILDINGS = {
  farm: { id: 'farm', name: 'Ферма', branch: 'food', price: 3, area: 1, produces: 'provisions', buildable: true },
  manor: { id: 'manor', name: 'Поместье', branch: 'food', area: 2, produces: 'provisions', advanced: true, buildable: false },
  lumbermill: { id: 'lumbermill', name: 'Лесопилка', branch: 'wood', price: 4, area: 1, resource: 'Лес', produces: 'wood', buildable: true },
  shipyard: { id: 'shipyard', name: 'Верфь', branch: 'wood', area: 2, advanced: true, buildable: false },
  quarry: { id: 'quarry', name: 'Каменоломня', branch: 'stone', price: 4, area: 1, resource: 'Камень', produces: 'stone', buildable: true },
  stoneworks: { id: 'stoneworks', name: 'Каменотёсный двор', branch: 'stone', area: 2, advanced: true, buildable: false },
  mine: { id: 'mine', name: 'Рудник', branch: 'ore', price: 4, area: 1, resource: 'Рудная жила', produces: 'ore', buildable: true },
  arsenal: { id: 'arsenal', name: 'Арсенал', branch: 'ore', area: 2, advanced: true, buildable: false },
  fort: { id: 'fort', name: 'Форт', branch: 'fort', price: 5, area: 1, defense: 5, buildable: true },
  fortress: { id: 'fortress', name: 'Крепость', branch: 'fort', area: 2, defense: 12, advanced: true, buildable: false },
  market: { id: 'market', name: 'Рынок', branch: 'money', price: 6, area: 1, income: 1, buildable: true },
  bank: { id: 'bank', name: 'Банк', branch: 'money', area: 2, income: 4, advanced: true, buildable: false },
  bastion: { id: 'bastion', name: 'Бастион', branch: 'fort', price: 10, area: 1, defense: 8, buildable: false, fixedName: true },
  exotic: { id: 'exotic', name: 'Звероловный промысел', branch: 'rare-exotic', price: 8, area: 1, resource: 'Экзотические звери', unique: true, produces: 'exotic', buildable: true, fixedName: true },
  slaves: { id: 'slaves', name: 'Невольничий рынок', branch: 'rare-slaves', price: 8, area: 1, resource: 'Невольники', unique: true, produces: 'slaves', buildable: true, fixedName: true },
  gold: { id: 'gold', name: 'Золотой прииск', branch: 'rare-gold', price: 8, area: 1, resource: 'Самородное золото', unique: true, produces: 'gold', buildable: true, fixedName: true },
  diamonds: { id: 'diamonds', name: 'Алмазный прииск', branch: 'rare-diamonds', price: 8, area: 1, resource: 'Алмазы', unique: true, produces: 'diamonds', buildable: true, fixedName: true },
};

// Все шесть обычных ветвей используют цены редакции 0.9. Продвинутые формы
// занимают две клетки; их специальные способности подключаются отдельными модулями.
const BUILDING_UPGRADES = {
  farm: {
    1: { type: 'farm', level: 2, price: 4 },
    2: { type: 'farm', level: 3, price: 5 },
    3: { type: 'manor', level: 1, price: 8 },
  },
  manor: {
    1: { type: 'manor', level: 2, price: 9 },
    2: { type: 'manor', level: 3, price: 10 },
  },
  lumbermill: {
    1: { type: 'lumbermill', level: 2, price: 5 },
    2: { type: 'lumbermill', level: 3, price: 6 },
    3: { type: 'shipyard', level: 1, price: 10 },
  },
  shipyard: {
    1: { type: 'shipyard', level: 2, price: 8 },
    2: { type: 'shipyard', level: 3, price: 8 },
  },
  quarry: {
    1: { type: 'quarry', level: 2, price: 5 },
    2: { type: 'quarry', level: 3, price: 6 },
    3: { type: 'stoneworks', level: 1, price: 10 },
  },
  stoneworks: {
    1: { type: 'stoneworks', level: 2, price: 8 },
    2: { type: 'stoneworks', level: 3, price: 8 },
  },
  mine: {
    1: { type: 'mine', level: 2, price: 5 },
    2: { type: 'mine', level: 3, price: 6 },
    3: { type: 'arsenal', level: 1, price: 10 },
  },
  arsenal: {
    1: { type: 'arsenal', level: 2, price: 8 },
    2: { type: 'arsenal', level: 3, price: 8 },
  },
  fort: {
    1: { type: 'fort', level: 2, price: 6 },
    2: { type: 'fort', level: 3, price: 7 },
    3: { type: 'fortress', level: 1, price: 12 },
  },
  fortress: {
    1: { type: 'fortress', level: 2, price: 14 },
    2: { type: 'fortress', level: 3, price: 16 },
  },
  market: {
    1: { type: 'market', level: 2, price: 7 },
    2: { type: 'market', level: 3, price: 8 },
    3: { type: 'bank', level: 1, price: 12 },
  },
  bank: {
    1: { type: 'bank', level: 2, price: 14 },
    2: { type: 'bank', level: 3, price: 16 },
  },
};

const {
  MAP_META,
  ISLAND_DEFS,
  LAND_CELLS,
  CITADEL,
  CITADEL_CELLS,
  SPECIAL_LAND,
  HAZARDS: MAP_HAZARDS,
  ANCHORS,
  LEGENDARY_PLACES,
  PRINT_HELPERS,
} = require('./map-config');

// game-logic historically consumes HAZARDS as type -> cells arrays.
const HAZARDS = Object.fromEntries(
  Object.entries(MAP_HAZARDS).map(([type, def]) => [type, def.cells])
);

function cellKey(row, col) { return `${row},${col}`; }

const ISLAND_BY_CELL = new Map();
for (const island of ISLAND_DEFS) {
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


const ANCHOR_CARDS = {
  blue: [
    { id: 'merchant-convoy-a', name: 'Купеческий конвой A', quantity: 1, artillery: 4, reward: 8 },
    { id: 'merchant-convoy-b', name: 'Купеческий конвой Б', quantity: 1, artillery: 4, reward: 8 },
    { id: 'trade-flotilla-a', name: 'Торговая флотилия А', quantity: 1, artillery: 4, reward: 9 },
    { id: 'trade-flotilla-b', name: 'Торговая флотилия Б', quantity: 1, artillery: 4, reward: 9 },
    { id: 'smugglers', name: 'Контрабандисты', quantity: 2, artillery: 4, reward: 10 },
    { id: 'pirates-a', name: 'Пираты A', quantity: 1, artillery: 6, reward: 12 },
    { id: 'pirates-b', name: 'Пираты Б', quantity: 1, artillery: 9, reward: 15 },
    { id: 'pirates-c', name: 'Пираты В', quantity: 1, artillery: 12, reward: 18 },
    { id: 'calm-sea', name: 'На море тихо', quantity: 1, artillery: null, reward: 0, quiet: true },
  ],
  yellow: [
    { id: 'pirate-frigate-a', name: 'Пиратский фрегат А', quantity: 1, artillery: 13, reward: 18 },
    { id: 'pirate-frigate-b', name: 'Пиратский фрегат Б', quantity: 1, artillery: 14, reward: 20 },
    { id: 'sea-patrol-a', name: 'Морской патруль А', quantity: 1, artillery: 15, reward: 22 },
    { id: 'sea-patrol-b', name: 'Морской патруль Б', quantity: 1, artillery: 16, reward: 24 },
    { id: 'corsair-frigate-a', name: 'Корсарский фрегат А', quantity: 1, artillery: 17, reward: 26 },
    { id: 'corsair-frigate-b', name: 'Корсарский фрегат Б', quantity: 1, artillery: 18, reward: 28 },
    { id: 'rebel-frigate-a', name: 'Мятежный фрегат А', quantity: 1, artillery: 19, reward: 30 },
    { id: 'rebel-frigate-b', name: 'Мятежный фрегат Б', quantity: 1, artillery: 20, reward: 32 },
    { id: 'corsair-escort', name: 'Корсарское сопровождение', quantity: 1, artillery: 22, reward: 36 },
    { id: 'calm-sea', name: 'На море тихо', quantity: 1, artillery: null, reward: 0, quiet: true },
  ],
  red: [
    { id: 'abyss-armada', name: 'Армада Бездны', quantity: 1, artillery: 23, reward: 34 },
    { id: 'ghost-ship', name: 'Корабль-призрак', quantity: 1, artillery: 24, reward: 38 },
    { id: 'crimson-flagship', name: 'Багровый флагман', quantity: 1, artillery: 25, reward: 42 },
    { id: 'black-galleon', name: 'Чёрный галеон', quantity: 1, artillery: 26, reward: 46 },
    { id: 'mayo-hunters', name: 'Охотники Майо', quantity: 1, artillery: 27, reward: 50 },
    { id: 'leviathan', name: 'Левиафан', quantity: 1, artillery: 28, reward: 54 },
    { id: 'corsair-squadron', name: 'Корсарская эскадра', quantity: 1, artillery: 29, reward: 58 },
    { id: 'gun-squadron', name: 'Пушечная эскадра', quantity: 1, artillery: 30, reward: 62 },
    { id: 'lord-of-storms', name: 'Властелин штормов', quantity: 1, artillery: 32, reward: 66 },
    { id: 'last-expedition', name: 'Последняя экспедиция', quantity: 1, artillery: 33, reward: 70 },
  ],
};


// Колода событий плавания: 26 карт по редакции правил 0.9.
// type описывает машинно-исполняемый эффект; quantity разворачивается в копии.
const SAILING_EVENT_CARDS = [
  { id: 'found-treasure', name: 'Найдено сокровище', quantity: 2, type: 'treasure' },
  { id: 'found-legendary', name: 'Найдена легендарная карта', quantity: 1, type: 'legendary' },
  { id: 'found-ore', name: 'Найден груз руды', quantity: 1, type: 'found-cargo', goodId: 'ore' },
  { id: 'found-wood', name: 'Найден груз леса', quantity: 1, type: 'found-cargo', goodId: 'wood' },
  { id: 'found-stone', name: 'Найден груз камня', quantity: 1, type: 'found-cargo', goodId: 'stone' },
  { id: 'ship-master', name: 'Судовой мастер', quantity: 1, type: 'save-card', savedKind: 'ship-master' },
  { id: 'mist-path', name: 'Карта «Путь сквозь туман»', quantity: 1, type: 'special-card', cardName: 'Путь сквозь туман' },
  { id: 'sea-veil', name: 'Карта «Покров моря»', quantity: 1, type: 'special-card', cardName: 'Покров моря' },
  { id: 'market-blueprint', name: 'Чертёж рынка', quantity: 1, type: 'save-card', savedKind: 'market-blueprint' },
  { id: 'farm-blueprint', name: 'Чертёж фермы', quantity: 1, type: 'save-card', savedKind: 'farm-blueprint' },
  { id: 'tailwind-1', name: 'Попутный ветер +1', quantity: 1, type: 'next-turn', effect: 'moveBonus', value: 1 },
  { id: 'tailwind-2', name: 'Попутный ветер +2', quantity: 1, type: 'next-turn', effect: 'moveBonus', value: 2 },
  { id: 'tailwind-3', name: 'Попутный ветер +3', quantity: 1, type: 'next-turn', effect: 'moveBonus', value: 3 },
  { id: 'fortune', name: 'Удача Фортуны', quantity: 1, type: 'next-turn', effect: 'bestOfTwo', value: true },
  { id: 'breakdown', name: 'Поломка', quantity: 1, type: 'next-turn', effect: 'noNavigation', value: true },
  { id: 'calm-1', name: 'Штиль 1', quantity: 1, type: 'next-turn', effect: 'movePenalty', value: 1 },
  { id: 'calm-2', name: 'Штиль 2', quantity: 1, type: 'next-turn', effect: 'movePenalty', value: 2 },
  { id: 'calm-3', name: 'Штиль 3', quantity: 1, type: 'next-turn', effect: 'movePenalty', value: 3 },
  { id: 'raid', name: 'Набег', quantity: 1, type: 'raid' },
  { id: 'boarding', name: 'Абордаж', quantity: 1, type: 'boarding' },
  { id: 'storm-chertonia', name: 'Шторм: Чертония', quantity: 1, type: 'storm', islandId: 'chertonia' },
  { id: 'storm-kadingir', name: 'Шторм: Кадингир', quantity: 1, type: 'storm', islandId: 'kadingir' },
  { id: 'storm-landin', name: 'Шторм: Ландин', quantity: 1, type: 'storm', islandId: 'landin' },
  { id: 'military-levy', name: 'Военная подать', quantity: 1, type: 'treasury-loss', percent: 30 },
  { id: 'famine', name: 'Голод', quantity: 1, type: 'next-turn', effect: 'noIncome', value: true },
];

// Четыре карты сокровищ. Денежные разрешаются сразу, полный трюм руды
// при отсутствии пустого трюма сохраняется до позднего применения.
const TREASURE_CARDS = [
  { id: 'income-x1', name: 'Доход ×1', multiplier: 1, minimum: 2 },
  { id: 'income-x2', name: 'Доход ×2', multiplier: 2, minimum: 4 },
  { id: 'income-x3', name: 'Доход ×3', multiplier: 3, minimum: 6 },
  { id: 'full-ore-hold', name: 'Полный трюм руды', cargoGoodId: 'ore' },
];

// Случайная легендарная колода: правила задают 8 карт четырёх видов, но не указывают
// количество каждого вида. Для MVP 0.16 используется временная симметричная раскладка 2×4;
// её можно заменить, когда будет утверждён точный состав физических карт.
const LEGENDARY_CARDS = [
  { id: 'sea-veil', name: 'Покров моря', quantity: 2 },
  { id: 'hellfire', name: 'Пламя Ада', quantity: 2 },
  { id: 'mist-path', name: 'Путь сквозь туман', quantity: 2 },
  { id: 'sea-curse', name: 'Морское проклятие', quantity: 2 },
];



// Политическая система главы 8. В редакции 0.9 отдельные карточки отношений и
// колоды вражды перечислены для пяти фракций ниже. Сёгунат Мори присутствует на
// карте как государственный владелец островов, но в книге для него не задана
// отдельная карточка отношений/колода вражды, поэтому в политический модуль MVP
// он пока не включён.
const FACTIONS = {
  lionia: {
    id: 'lionia', name: 'Королевство Лиония', originalIslandIds: ['landin', 'frandia', 'eidon'],
    canHaveVassal: true, giftIslandId: 'frandia', tax: 2,
    fullConquestPrize: { preserveBuildings: [{ type: 'market', level: 1 }, { type: 'market', level: 1 }], razeDucats: 60 },
  },
  kadingir: {
    id: 'kadingir', name: 'Царство Кадингир', originalIslandIds: ['kadingir'],
    canHaveVassal: true, giftIslandId: 'kadingir', tax: 2,
    fullConquestPrize: { preserveBuildings: [{ type: 'bank', level: 1 }, { type: 'market', level: 1 }], razeDucats: 48 },
  },
  mayo: {
    id: 'mayo', name: 'Майо', originalIslandIds: ['mao', 'maikan'],
    canHaveVassal: false, giftIslandId: null, tax: 0,
    fullConquestPrize: { preserveBuildings: [{ type: 'market', level: 1 }], razeDucats: 4 },
  },
  suniksiya: {
    id: 'suniksiya', name: 'Вольная Суниксия', originalIslandIds: ['suniksiya'],
    canHaveVassal: true, giftIslandId: 'suniksiya', tax: 0, rewardShare: 0.5,
    fullConquestPrize: { preserveBuildings: [{ type: 'market', level: 1 }, { type: 'market', level: 1 }], razeDucats: 12 },
  },
  pirates: {
    id: 'pirates', name: 'Пираты', originalIslandIds: ['skull', 'chertonia'],
    canHaveVassal: true, giftIslandId: 'chertonia', tax: 0, rewardShare: 0.5,
    fullConquestPrize: { preserveBuildings: [{ type: 'market', level: 1 }, { type: 'market', level: 1 }], razeDucats: 12 },
  },
};



// 39 поручений сюзерена из главы 10. Каждая строка — отдельная карта.
// conditionKey объединяет только одинаковые условия: он нужен для правила,
// запрещающего одному игроку второй раз платно заменить то же условие.
const ASSIGNMENT_CARDS = {
  lionia: [
    { id: 'lionia-asigoriy', conditionKey: 'capture:asigoriy', text: 'Покорить Асигорий', reward: 12, type: 'capture-island', islandId: 'asigoriy' },
    { id: 'lionia-chertonia', conditionKey: 'capture:chertonia', text: 'Захватить Чертонию', reward: 9, type: 'capture-island', islandId: 'chertonia' },
    { id: 'lionia-skull', conditionKey: 'capture:skull', text: 'Захватить Череп', reward: 7, type: 'capture-island', islandId: 'skull' },
    { id: 'lionia-frandia-fort', conditionKey: 'build:frandia:fort', text: 'Построить форт на Франдии или улучшить его', reward: 5, type: 'build-branch', islandId: 'frandia', branch: 'fort' },
    { id: 'lionia-shipyard-forest', conditionKey: 'build:forest:shipyard', text: 'Построить верфь на любом своём острове с лесом или улучшить её', reward: 9, type: 'build-type', buildingType: 'shipyard', resource: 'Лес' },
    { id: 'lionia-frandia-market', conditionKey: 'build:frandia:money', text: 'Построить рынок на Франдии или улучшить его', reward: 5, type: 'build-branch', islandId: 'frandia', branch: 'money' },
    { id: 'lionia-ship-level', conditionKey: 'ship-level', text: 'Повысить общий уровень основного корабля', reward: 5, type: 'ship-level' },
    { id: 'lionia-yellow-a', conditionKey: 'anchor:yellow', text: 'Победить на жёлтом морском якоре, экземпляр А', reward: 6, type: 'anchor-win', colors: ['yellow'] },
    { id: 'lionia-yellow-b', conditionKey: 'anchor:yellow', text: 'Победить на жёлтом морском якоре, экземпляр Б', reward: 6, type: 'anchor-win', colors: ['yellow'] },
    { id: 'lionia-yellow-c', conditionKey: 'anchor:yellow', text: 'Победить на жёлтом морском якоре, экземпляр В', reward: 6, type: 'anchor-win', colors: ['yellow'] },
  ],
  kadingir: [
    { id: 'kadingir-harash', conditionKey: 'capture:harash', text: 'Захватить Хараш', reward: 7, type: 'capture-island', islandId: 'harash' },
    { id: 'kadingir-abyss', conditionKey: 'visit:abyss', text: 'Посетить Бездну', reward: 5, type: 'visit-place', placeId: 'abyss' },
    { id: 'kadingir-fort', conditionKey: 'build:kadingir:fort', text: 'Построить форт на Кадингире или улучшить его', reward: 5, type: 'build-branch', islandId: 'kadingir', branch: 'fort' },
    { id: 'kadingir-farm', conditionKey: 'build:kadingir:food', text: 'Построить ферму на Кадингире или улучшить её', reward: 4, type: 'build-branch', islandId: 'kadingir', branch: 'food' },
    { id: 'kadingir-market', conditionKey: 'build:kadingir:money', text: 'Построить рынок на Кадингире или улучшить его', reward: 4, type: 'build-branch', islandId: 'kadingir', branch: 'money' },
    { id: 'kadingir-quarry', conditionKey: 'build:kadingir:stone', text: 'Построить или улучшить каменоломню на Кадингире', reward: 5, type: 'build-branch', islandId: 'kadingir', branch: 'stone' },
    { id: 'kadingir-ship-level', conditionKey: 'ship-level', text: 'Повысить общий уровень основного корабля', reward: 5, type: 'ship-level' },
    { id: 'kadingir-cargo-upgrade', conditionKey: 'upgrade:cargo', text: 'Увеличить вместимость основного корабля улучшением', reward: 5, type: 'stat-upgrade', branch: 'cargo' },
    { id: 'kadingir-speed-upgrade', conditionKey: 'upgrade:speed', text: 'Увеличить скорость основного корабля улучшением', reward: 6, type: 'stat-upgrade', branch: 'speed' },
    { id: 'kadingir-delivery', conditionKey: 'delivery:any', text: 'Доставить и продать полный трюм любого товара в Цитадели', reward: 8, type: 'delivery', goodIds: null },
  ],
  pirates: [
    { id: 'pirates-kraken', conditionKey: 'visit:kraken', text: 'Посетить Кракена', reward: 8, type: 'visit-place', placeId: 'kraken' },
    { id: 'pirates-abyss', conditionKey: 'visit:abyss', text: 'Посетить Бездну', reward: 8, type: 'visit-place', placeId: 'abyss' },
    { id: 'pirates-pharaoh', conditionKey: 'visit:pharaoh', text: 'Посетить Фараона', reward: 8, type: 'visit-place', placeId: 'pharaoh' },
    { id: 'pirates-pearl', conditionKey: 'visit:pearl', text: 'Посетить Жемчужину', reward: 8, type: 'visit-place', placeId: 'pearl' },
    { id: 'pirates-attack-player-island', conditionKey: 'attack:player-island', text: 'Напасть на остров другого игрока', reward: 8, type: 'attack-player-island' },
    { id: 'pirates-mao', conditionKey: 'capture:mao', text: 'Захватить Мао', reward: 10, type: 'capture-island', islandId: 'mao' },
    { id: 'pirates-anchor-a', conditionKey: 'anchor:blue-yellow', text: 'Победить на синем или жёлтом морском якоре, экземпляр А', reward: 6, type: 'anchor-win', colors: ['blue', 'yellow'] },
    { id: 'pirates-anchor-b', conditionKey: 'anchor:blue-yellow', text: 'Победить на синем или жёлтом морском якоре, экземпляр Б', reward: 6, type: 'anchor-win', colors: ['blue', 'yellow'] },
    { id: 'pirates-artillery-upgrade', conditionKey: 'upgrade:artillery', text: 'Увеличить артиллерию основного корабля улучшением', reward: 6, type: 'stat-upgrade', branch: 'artillery' },
  ],
  suniksiya: [
    { id: 'suniksiya-kraken', conditionKey: 'visit:kraken', text: 'Посетить Кракена', reward: 8, type: 'visit-place', placeId: 'kraken' },
    { id: 'suniksiya-farm', conditionKey: 'build:suniksiya:food', text: 'Построить ферму на Суниксии или улучшить её', reward: 6, type: 'build-branch', islandId: 'suniksiya', branch: 'food' },
    { id: 'suniksiya-market', conditionKey: 'build:suniksiya:money', text: 'Построить рынок на Суниксии или улучшить его', reward: 6, type: 'build-branch', islandId: 'suniksiya', branch: 'money' },
    { id: 'suniksiya-delivery-any', conditionKey: 'delivery:any', text: 'Доставить полный трюм любого товара в Цитадель', reward: 5, type: 'delivery', goodIds: null },
    { id: 'suniksiya-delivery-provisions', conditionKey: 'delivery:provisions', text: 'Доставить полный трюм провианта в Цитадель', reward: 4, type: 'delivery', goodIds: ['provisions'] },
    { id: 'suniksiya-delivery-wood-stone', conditionKey: 'delivery:wood-stone', text: 'Доставить полный трюм леса или камня в Цитадель', reward: 10, type: 'delivery', goodIds: ['wood', 'stone'] },
    { id: 'suniksiya-delivery-ore', conditionKey: 'delivery:ore', text: 'Доставить полный трюм руды в Цитадель', reward: 6, type: 'delivery', goodIds: ['ore'] },
    { id: 'suniksiya-cargo-upgrade', conditionKey: 'upgrade:cargo', text: 'Увеличить вместимость основного корабля улучшением', reward: 6, type: 'stat-upgrade', branch: 'cargo' },
    { id: 'suniksiya-speed-upgrade', conditionKey: 'upgrade:speed', text: 'Увеличить скорость основного корабля улучшением', reward: 7, type: 'stat-upgrade', branch: 'speed' },
    { id: 'suniksiya-treasure', conditionKey: 'treasure:random', text: 'Получить и разрешить случайную карту сокровища', reward: 7, type: 'treasure-resolved' },
  ],
};

const POLITICAL_FACTION_ORDER = ['lionia', 'kadingir', 'mayo', 'suniksiya', 'pirates'];

// Пять колод вражды по 10 карт. Выбор конкретной постройки/улучшения/трюма
// делается пострадавшим игроком через интерфейс, когда карта этого требует.
const FEUD_CARDS = {
  lionia: [
    { id: 'building-choice', name: 'Удалить здание или понизить его на уровень', quantity: 3, type: 'building-choice' },
    { id: 'reclaim-island', name: 'Лиония возвращает свой исходный остров', quantity: 1, type: 'reclaim-island' },
    { id: 'ship-level-loss', name: 'Основной корабль теряет один общий уровень', quantity: 1, type: 'ship-level-loss' },
    { id: 'treasury-50', name: 'Потеря 50% дукатов', quantity: 1, type: 'treasury-percent', percent: 50 },
    { id: 'skip-income', name: 'Пропуск дохода в ближайшем личном ходу', quantity: 2, type: 'skip-income' },
    { id: 'treasury-30', name: 'Потеря 30% дукатов', quantity: 1, type: 'treasury-percent', percent: 30 },
    { id: 'remove-forts', name: 'Удалить до двух фортов или крепостей', quantity: 1, type: 'remove-forts', count: 2 },
  ],
  kadingir: [
    { id: 'building-downgrade', name: 'Одно своё здание теряет уровень', quantity: 2, type: 'building-downgrade' },
    { id: 'skip-income', name: 'Пропуск дохода в ближайшем личном ходу', quantity: 2, type: 'skip-income' },
    { id: 'ship-level-loss', name: 'Основной корабль теряет один общий уровень', quantity: 1, type: 'ship-level-loss' },
    { id: 'treasury-10', name: 'Потеря 10% дукатов', quantity: 1, type: 'treasury-percent', percent: 10 },
    { id: 'building-choice', name: 'Удалить здание или понизить его на уровень', quantity: 1, type: 'building-choice' },
    { id: 'treasury-20', name: 'Потеря 20% дукатов', quantity: 1, type: 'treasury-percent', percent: 20 },
    { id: 'remove-army-upgrade', name: 'Снять одно улучшение войска', quantity: 1, type: 'remove-upgrade', branch: 'army' },
    { id: 'remove-fort', name: 'Удалить один форт или крепость', quantity: 1, type: 'remove-forts', count: 1 },
  ],
  pirates: [
    { id: 'building-choice', name: 'Удалить здание или понизить его на уровень', quantity: 1, type: 'building-choice' },
    { id: 'skip-income', name: 'Пропуск дохода в ближайшем личном ходу', quantity: 2, type: 'skip-income' },
    { id: 'treasury-20', name: 'Потеря 20% дукатов', quantity: 1, type: 'treasury-percent', percent: 20 },
    { id: 'remove-army-upgrade', name: 'Снять одно улучшение войска', quantity: 1, type: 'remove-upgrade', branch: 'army' },
    { id: 'remove-any-upgrade', name: 'Снять любое улучшение корабля', quantity: 1, type: 'remove-upgrade' },
    { id: 'treasury-10', name: 'Потеря 10% дукатов', quantity: 1, type: 'treasury-percent', percent: 10 },
    { id: 'discard-held', name: 'Сбросить случайную удерживаемую карту', quantity: 1, type: 'discard-random-held' },
    { id: 'remove-artillery-upgrade', name: 'Снять одно улучшение артиллерии', quantity: 1, type: 'remove-upgrade', branch: 'artillery' },
    { id: 'none', name: 'Нет события', quantity: 1, type: 'none' },
  ],
  mayo: [
    { id: 'treasury-10', name: 'Потеря 10% дукатов', quantity: 2, type: 'treasury-percent', percent: 10 },
    { id: 'skip-income', name: 'Пропуск дохода в ближайшем личном ходу', quantity: 2, type: 'skip-income' },
    { id: 'building-downgrade', name: 'Одно своё здание теряет уровень', quantity: 1, type: 'building-downgrade' },
    { id: 'remove-any-upgrade', name: 'Снять любое улучшение корабля', quantity: 1, type: 'remove-upgrade' },
    { id: 'discard-held', name: 'Сбросить случайную удерживаемую карту', quantity: 1, type: 'discard-random-held' },
    { id: 'treasury-2', name: 'Потеря 2 дуката', quantity: 1, type: 'treasury-flat', amount: 2 },
    { id: 'none', name: 'Нет события', quantity: 2, type: 'none' },
  ],
  suniksiya: [
    { id: 'treasury-20', name: 'Потеря 20% дукатов', quantity: 2, type: 'treasury-percent', percent: 20 },
    { id: 'skip-income', name: 'Пропуск дохода в ближайшем личном ходу', quantity: 2, type: 'skip-income' },
    { id: 'treasury-3', name: 'Потеря 3 дуката', quantity: 1, type: 'treasury-flat', amount: 3 },
    { id: 'discard-held', name: 'Сбросить случайную удерживаемую карту', quantity: 1, type: 'discard-random-held' },
    { id: 'remove-cargo', name: 'Снять один груз из своего трюма', quantity: 1, type: 'remove-cargo' },
    { id: 'building-downgrade', name: 'Одно своё здание теряет уровень', quantity: 1, type: 'building-downgrade' },
    { id: 'none', name: 'Нет события', quantity: 2, type: 'none' },
  ],
};

const ANCHOR_BY_CELL = new Map();
for (const [color, def] of Object.entries(ANCHORS)) {
  for (const [row, col] of def.cells) ANCHOR_BY_CELL.set(cellKey(row, col), color);
}

module.exports = {
  MAP_META,
  CITADEL,
  PRINT_HELPERS,
  SHIPS,
  SHIP_LEVELS,
  SHIP_UPGRADES,
  ESCORTS,
  MILITARY_REWARDS,
  COLORS,
  BUILDINGS,
  BUILDING_UPGRADES,
  GOODS,
  ISLAND_DEFS,
  HAZARDS,
  ISLAND_BY_CELL,
  HAZARD_BY_CELL,
  ANCHORS,
  ANCHOR_CARDS,
  ANCHOR_BY_CELL,
  SAILING_EVENT_CARDS,
  TREASURE_CARDS,
  LEGENDARY_CARDS,
  LEGENDARY_PLACES,
  ASSIGNMENT_CARDS,
  FACTIONS,
  POLITICAL_FACTION_ORDER,
  FEUD_CARDS,
  SPECIAL_LAND,
  CITADEL_CELLS,
  LAND_CELLS,
  cellKey,
};
