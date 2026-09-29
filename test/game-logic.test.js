const assert = require('node:assert/strict');
const {
  cloneIslands,
  reachableCells,
  mistPathReachableCells,
  navigationPassabilities,
  navigationAllowsHazards,
  hazardsAt,
  isShipProtected,
  isIslandProtected,
  applySeaVeilToShip,
  applySeaVeilToIsland,
  applySeaCurse,
  legendaryMovementPenalty,
  tickLegendaryEffectsForPlayer,
  applyHellfire,
  build,
  upgradeBuilding,
  marketIncomeForPlayer,
  hasOwnedBuilding,
  lighthouseDepartureBonus,
  bestAdmiraltyLevelAtPlayer,
  characterOptionsAtAdmiralty,
  takeCharacter,
  replaceCharacter,
  consumeCharacter,
  cartographerAnchorOptions,
  claimFreeIslandsAt,
  shipStats,
  shipUpgradeStatuses,
  fleetAdjustmentNeeds,
  setDisabledUpgrades,
  setLevelInactiveEscorts,
  shipCargoCapacity,
  buyShipLevel,
  buyShipUpgrade,
  removeShipUpgrade,
  shipyardSlotsForPlayer,
  ordinaryEscortExcess,
  removeEscortsForShipyard,
  escortUseLimit,
  escortPurchasePrice,
  escortStatuses,
  buyEscort,
  loadCargo,
  sellCargo,
  canLoadCargo,
  availableGoodsOnIsland,
  canUpgradeBuilding,
  cargoSaleValue,
  isCitadelCell,
  isCitadelPeaceCell,
  fleetArtillery,
  islandDefenseArmy,
  loseShipLevel,
  seaBattle,
  assaultIsland,
  areAllies,
  addAlliance,
  removeAlliance,
  jointSeaBattle,
  jointAssaultIsland,
  anchorAt,
  createAnchorDecks,
  resolveAnchorEncounter,
  creditDucats,
  createSailingEventDeck,
  drawSailingEventCard,
  createTreasureDeck,
  drawTreasureCard,
  createLegendaryDeck,
  drawLegendaryCard,
  discardDeckCard,
  emptyCargoHolds,
  fillCargoDirect,
  resolveMoneyTreasure,
  installShipUpgradeFree,
  buildFree,
  raidBuildingOptions,
  applyRaidDowngrade,
  boardingUpgradeOptions,
  applyBoardingLoss,
  stormCellOptions,
  createFeudDecks,
  factionIdForIsland,
  stateExists,
  refreshFactionExistence,
  fullSubjugationController,
  claimFullSubjugationPrize,
  canPlacePrizeBuilding,
  prizeBuildingPlacementOptions,
  placePrizeBuilding,
  islandConstraintReport,
  islandStatus,
  islandCorrectionOptions,
  removeIslandBuildingForCorrection,
  stoneworksSupportCapacity,
  bastionSupportSummary,
  bastionSupportChoiceNeeds,
  setInactiveBastions,
  supportedBastionIslandIds,
  canBuildBastion,
  buildBastion,
  canBuyCityGuard,
  buyCityGuard,
  canBuyPermanentGarrison,
  buyPermanentGarrison,
  canFormLandCompany,
  formLandCompany,
  dismissLandCompany,
  landCompanyAssaultArmy,
  addEnmity,
  canEnterVassalage,
  enterVassalage,
  rebelFromSuzerain,
  politicalBuildingOptions,
  removePlayerBuilding,
  politicalUpgradeOptions,
  politicalCargoOptions,
  discardRandomHeldCard,
  createAssignmentDecks,
  issueAssignment,
  offerAssignmentCards,
  chooseAssignmentOffer,
  canReplaceAssignment,
  replaceAssignment,
  assignmentEventMatches,
  completeAssignment,
  legendaryPlaceAt,
} = require('../game-logic');
const { BALANCE, MAP_META, ASSIGNMENT_CARDS, FACTIONS, ESCORTS, HAZARDS, ISLAND_DEFS, BUILDINGS, CHARACTERS, ANCHORS } = require('../game-data');

function has(cells, row, col) { return cells.some(c => c.row === row && c.col === col); }

// Рифы: фрегат проходит, бригантина — нет.
{
  const frigate = { row: 6, col: 6, shipClass: 'frigate' };
  const brigantine = { row: 6, col: 6, shipClass: 'brigantine' };
  assert.equal(has(reachableCells(frigate, 1), 6, 7), true);
  assert.equal(has(reachableCells(brigantine, 1), 6, 7), false);
}


// Защитные препятствия полностью закрывают доступные морские стороны островов.
// Клетки других островов не считаются морем и в периметр не включаются.
{
  const occupied = new Set(ISLAND_DEFS.flatMap(i => i.cells.map(([r, c]) => `${r},${c}`)));
  const checks = [
    ['chertonia', 'reef'],
    ['maikan', 'shoal'],
    ['mao', 'shoal'],
    ['atlantia', 'ice'],
  ];
  for (const [islandId, hazardType] of checks) {
    const island = ISLAND_DEFS.find(i => i.id === islandId);
    const barrier = new Set(HAZARDS[hazardType].map(([r, c]) => `${r},${c}`));
    for (const [row, col] of island.cells) {
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr > 27 || nc < 0 || nc > 27) continue;
        if (occupied.has(`${nr},${nc}`)) continue;
        assert.equal(
          barrier.has(`${nr},${nc}`),
          true,
          `${hazardType} должен закрывать берег ${islandId} у ${nr},${nc}`
        );
      }
    }
  }
}

// Легендарные места также полностью окружены своими препятствиями.
{
  const placeChecks = [
    ['pearl', 'reef'],
    ['abyss', 'shoal'],
    ['kraken', 'ice'],
  ];
  const placeCoords = {
    pearl: [10, 10],
    abyss: [12, 26],
    kraken: [24, 6],
  };
  for (const [placeId, hazardType] of placeChecks) {
    const [row, col] = placeCoords[placeId];
    const barrier = new Set(HAZARDS[hazardType].map(([r, c]) => `${r},${c}`));
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nr > 27 || nc < 0 || nc > 27) continue;
        assert.equal(
          barrier.has(`${nr},${nc}`),
          true,
          `${hazardType} должен полностью окружать ${placeId} у ${nr},${nc}`
        );
      }
    }
  }
}

// Мель пропускает только бригантину.
{
  const brigantine = { row: 5, col: 18, shipClass: 'brigantine' };
  const frigate = { row: 5, col: 18, shipClass: 'frigate' };
  assert.equal(has(reachableCells(brigantine, 1), 4, 18), true);
  assert.equal(has(reachableCells(frigate, 1), 4, 18), false);
}

// Льды пропускают только каракку.
{
  const carrack = { row: 22, col: 1, shipClass: 'carrack' };
  const frigate = { row: 22, col: 1, shipClass: 'frigate' };
  assert.equal(has(reachableCells(carrack, 1), 23, 1), true);
  assert.equal(has(reachableCells(frigate, 1), 23, 1), false);
}

// Каравелла может пересечь одну клетку суши Ренаики: вода -> берег -> вода.
{
  const caravel = { row: 5, col: 4, shipClass: 'caravel' };
  const frigate = { row: 5, col: 4, shipClass: 'frigate' };
  assert.equal(has(reachableCells(caravel, 2), 5, 6), true);
  assert.equal(has(reachableCells(frigate, 2), 5, 6), false);
  assert.equal(has(reachableCells(frigate, 1), 5, 5), true);
}

// Этап 3.3: навигационные улучшения расширяют проходимость основного корабля.
{
  const reefPilot = { row: 6, col: 6, shipClass: 'brigantine', level: 2, upgrades: ['reefPilot'] };
  assert.equal(has(reachableCells(reefPilot, 1), 6, 7), true);

  const leadLine = { row: 5, col: 18, shipClass: 'frigate', level: 2, upgrades: ['leadLine'] };
  assert.equal(has(reachableCells(leadLine, 1), 4, 18), true);

  const iceStem = { row: 22, col: 1, shipClass: 'frigate', level: 2, upgrades: ['iceStem'] };
  assert.equal(has(reachableCells(iceStem, 1), 23, 1), true);

  const portage = { row: 5, col: 4, shipClass: 'frigate', level: 2, upgrades: ['portageSleds'] };
  assert.equal(has(reachableCells(portage, 2), 5, 6), true);
}

// Если навигационное улучшение временно отключено потерей уровня, его проходимость не действует.
{
  const p = {
    row: 6, col: 6, shipClass: 'brigantine', level: 1,
    upgrades: ['falcons', 'reefPilot'], disabledUpgradeIds: ['reefPilot'],
  };
  assert.equal(has(reachableCells(p, 1), 6, 7), false);
  assert.equal(navigationPassabilities(p).has('reef'), false);
}

// Если на клетке одновременно несколько препятствий, нужны возможности для каждого.
{
  const combined = { shipClass: 'brigantine', level: 2, upgrades: ['reefPilot'] };
  assert.equal(navigationAllowsHazards(combined, ['shoal', 'reef']), true);
  assert.equal(navigationAllowsHazards({ shipClass: 'brigantine', level: 1, upgrades: [] }, ['shoal', 'reef']), false);
  assert.equal(navigationAllowsHazards({ shipClass: 'frigate', level: 1, upgrades: [] }, ['shoal', 'reef']), false);
}

// Маршрут состоит только из ортогональных шагов; можно остановиться раньше полной дальности.
{
  const p = { row: 6, col: 6, shipClass: 'frigate', level: 1, upgrades: [] };
  const one = reachableCells(p, 1);
  for (const cell of one) {
    if (cell.dist === 0) continue;
    assert.equal(Math.abs(cell.row - p.row) + Math.abs(cell.col - p.col), 1);
  }
  const three = reachableCells(p, 3);
  assert.equal(three.some(cell => cell.dist === 1), true);
  assert.equal(three.every(cell => cell.dist <= 3), true);
}

// Любой корабль может закончить движение на сухопутной береговой клетке,
// но пройти её насквозь может только каравелла или судно с салазками.
{
  const ordinary = { row: 5, col: 4, shipClass: 'frigate', level: 1, upgrades: [] };
  assert.equal(has(reachableCells(ordinary, 1), 5, 5), true);
  assert.equal(has(reachableCells(ordinary, 2), 5, 6), false);
  const sleds = { ...ordinary, level: 2, upgrades: ['portageSleds'] };
  assert.equal(has(reachableCells(sleds, 2), 5, 6), true);
}

// Карта препятствий возвращает все типы клетки, а не один случайно перезаписанный тип.
{
  for (let row = 0; row < 28; row++) {
    for (let col = 0; col < 28; col++) {
      const found = hazardsAt(row, col);
      assert.equal(new Set(found).size, found.length);
      assert.equal(found.every(type => ['reef', 'shoal', 'ice'].includes(type)), true);
    }
  }
}

// Свободный остров захватывается без действия.
{
  const room = { islands: cloneIslands() };
  const p = { id: 'p1', row: 5, col: 1 };
  const claims = claimFreeIslandsAt(room, p);
  assert.equal(claims.some(i => i.id === 'bogamia'), true);
  assert.equal(room.islands.find(i => i.id === 'bogamia').ownerId, 'p1');
}

// Базовая стройка: ферма -> рынок; рынок даёт 1 доход.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  const p = { id: 'p1', row: 5, col: 1, ducats: 14 };
  assert.equal(build(room, p, 'bogamia', 'market').ok, false);
  assert.equal(build(room, p, 'bogamia', 'farm').ok, true);
  assert.equal(build(room, p, 'bogamia', 'market').ok, true);
  assert.equal(p.ducats, 6);
  assert.equal(marketIncomeForPlayer(room, 'p1'), 1);
}

// Ветка, необходимая для верфи: Ферма III -> Поместье I и Лесопилка III -> Верфь I.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'kisalinia');
  island.ownerId = 'p1';
  const p = { id: 'p1', row: 16, col: 24, ducats: 200 };
  assert.equal(build(room, p, 'kisalinia', 'farm').ok, true);
  assert.equal(build(room, p, 'kisalinia', 'lumbermill').ok, true);
  assert.equal(upgradeBuilding(room, p, 'kisalinia', 0).afterName, 'Ферма II');
  assert.equal(upgradeBuilding(room, p, 'kisalinia', 0).afterName, 'Ферма III');
  assert.equal(upgradeBuilding(room, p, 'kisalinia', 0).afterName, 'Поместье I');
  assert.equal(upgradeBuilding(room, p, 'kisalinia', 1).afterName, 'Лесопилка II');
  assert.equal(upgradeBuilding(room, p, 'kisalinia', 1).afterName, 'Лесопилка III');
  assert.equal(upgradeBuilding(room, p, 'kisalinia', 1).afterName, 'Верфь I');
  assert.equal(shipyardSlotsForPlayer(room, 'p1'), 1);
}

// Обычная ветвь развивается только последовательно и не может обгонять пищевую ступень.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'maikan');
  island.ownerId = 'p1';
  island.resources = ['Лес', 'Камень', 'Рудная жила'];
  const [row, col] = island.cells[0];
  const p = { id: 'p1', row, col, ducats: 2000 };
  assert.equal(build(room, p, island.id, 'farm').ok, true);
  assert.equal(build(room, p, island.id, 'lumbermill').ok, true);
  assert.equal(upgradeBuilding(room, p, island.id, 1).ok, false);
  assert.equal(upgradeBuilding(room, p, island.id, 0).afterName, 'Ферма II');
  assert.equal(upgradeBuilding(room, p, island.id, 1).afterName, 'Лесопилка II');
  assert.equal(build(room, p, island.id, 'shipyard').ok, false);
}

// Все шесть основных ветвей используют канонические последовательные цены.
// Превращение заменяет то же здание в том же слоте; доход и защита берутся из rules/.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'maikan');
  island.ownerId = 'p1';
  island.resources = ['Лес', 'Камень', 'Рудная жила'];
  const [row, col] = island.cells[0];
  const p = { id: 'p1', row, col, ducats: 5000, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [] };
  room.players.push(p);

  assert.equal(build(room, p, island.id, 'farm').ok, true);
  for (const target of [
    ['farm', 2], ['farm', 3], ['manor', 1], ['manor', 2], ['manor', 3],
  ]) {
    const result = upgradeBuilding(room, p, island.id, 0);
    assert.equal(result.ok, true);
    assert.equal(result.price, BUILDINGS[target[0]].levels[target[1]].price);
    assert.equal(result.building.type, target[0]);
    assert.equal(result.building.level, target[1]);
  }

  const branches = [
    ['lumbermill', [['lumbermill',2],['lumbermill',3],['shipyard',1],['shipyard',2],['shipyard',3]]],
    ['quarry', [['quarry',2],['quarry',3],['stoneworks',1],['stoneworks',2],['stoneworks',3]]],
    ['mine', [['mine',2],['mine',3],['arsenal',1],['arsenal',2],['arsenal',3]]],
    ['fort', [['fort',2],['fort',3],['fortress',1],['fortress',2],['fortress',3]]],
    ['market', [['market',2],['market',3],['bank',1],['bank',2],['bank',3]]],
  ];
  for (const [type, targets] of branches) {
    const beforeLength = island.buildings.length;
    const built = build(room, p, island.id, type);
    assert.equal(built.ok, true);
    const index = island.buildings.length - 1;
    const createdAt = island.buildings[index].createdAt;
    assert.equal(island.buildings.length, beforeLength + 1);
    for (const [targetType, targetLevel] of targets) {
      const result = upgradeBuilding(room, p, island.id, index);
      assert.equal(result.ok, true);
      assert.equal(result.price, BUILDINGS[targetType].levels[targetLevel].price);
      assert.equal(island.buildings[index].type, targetType);
      assert.equal(island.buildings[index].level, targetLevel);
      assert.equal(island.buildings[index].createdAt, createdAt);
      assert.equal(island.buildings.length, beforeLength + 1);
    }
  }
  assert.equal(marketIncomeForPlayer(room, p.id), BUILDINGS.bank.levels[3].income);
  assert.equal(islandDefenseArmy(room, island).fortifications, BUILDINGS.fortress.levels[3].defense);
}

// Первое торговое здание повышается только по пищевой ветви. Второе требует
// укрепление той же строительной ступени; после удаления первого второе становится первым.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'maikan');
  island.ownerId = 'p1';
  island.buildings = [
    { type: 'manor', level: 3 },
    { type: 'market', level: 1 },
    { type: 'lumbermill', level: 1 },
    { type: 'quarry', level: 1 },
    { type: 'mine', level: 1 },
  ];
  const [row, col] = island.cells[0];
  const p = { id: 'p1', row, col, ducats: 5000, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [] };
  room.players.push(p);

  assert.equal(upgradeBuilding(room, p, island.id, 1).afterName, 'Рынок II');
  assert.equal(upgradeBuilding(room, p, island.id, 1).afterName, 'Рынок III');
  assert.equal(upgradeBuilding(room, p, island.id, 1).afterName, 'Банк I');

  assert.equal(build(room, p, island.id, 'market').ok, false);
  assert.equal(build(room, p, island.id, 'fort').ok, true);
  assert.equal(build(room, p, island.id, 'market').ok, true);
  const fortIndex = island.buildings.findIndex(b => b.type === 'fort');
  const secondIndex = island.buildings.map((b, i) => BUILDINGS[b.type]?.branch === 'money' ? i : -1).filter(i => i >= 0)[1];

  assert.equal(upgradeBuilding(room, p, island.id, secondIndex).ok, false);
  assert.equal(upgradeBuilding(room, p, island.id, fortIndex).afterName, 'Форт II');
  assert.equal(upgradeBuilding(room, p, island.id, secondIndex).afterName, 'Рынок II');
  assert.equal(upgradeBuilding(room, p, island.id, secondIndex).ok, false);
  assert.equal(upgradeBuilding(room, p, island.id, fortIndex).afterName, 'Форт III');
  assert.equal(upgradeBuilding(room, p, island.id, secondIndex).afterName, 'Рынок III');
  assert.equal(upgradeBuilding(room, p, island.id, secondIndex).ok, false);
  assert.equal(upgradeBuilding(room, p, island.id, fortIndex).afterName, 'Крепость I');
  assert.equal(upgradeBuilding(room, p, island.id, secondIndex).afterName, 'Банк I');
  assert.equal(build(room, p, island.id, 'market').ok, false);
  assert.equal(marketIncomeForPlayer(room, p.id), BUILDINGS.bank.levels[1].income * 2);

  const firstIndex = island.buildings.findIndex(b => BUILDINGS[b.type]?.branch === 'money');
  island.buildings.splice(firstIndex, 1);
  const fortressIndex = island.buildings.findIndex(b => b.type === 'fortress');
  island.buildings.splice(fortressIndex, 1);
  const remainingTradeIndex = island.buildings.findIndex(b => BUILDINGS[b.type]?.branch === 'money');
  assert.equal(upgradeBuilding(room, p, island.id, remainingTradeIndex).afterName, 'Банк II');
  assert.equal(build(room, p, island.id, 'market').ok, false);
}

// Общественные здания не входят в обычные ветви, требуют пищевой источник,
// уникальны по названию на острове и используют канонические цены.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'maikan');
  island.ownerId = 'p1';
  island.area = 20;
  const [row, col] = island.cells[0];
  const p = { id: 'p1', row, col, ducats: 500 };
  room.players.push(p);
  island.buildings = [{ type: 'farm', level: 1 }];
  for (const type of ['lighthouse', 'observatory', 'embassy', 'cartography', 'admiralty']) {
    const before = p.ducats;
    const result = build(room, p, island.id, type);
    assert.equal(result.ok, true, type);
    assert.equal(before - p.ducats, BUILDINGS[type].price);
  }
  assert.equal(build(room, p, island.id, 'lighthouse').ok, false);
  assert.equal(hasOwnedBuilding(room, p.id, 'observatory'), true);
  assert.equal(islandConstraintReport(island).branchViolations.length, 0);
}

// Дворец строится только в уже существующем городе/крупном порту.
// Сам Дворец не может быть зданием, которое создаёт требуемый городской статус.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'maikan');
  island.ownerId = 'p1'; island.area = 20;
  const [row, col] = island.cells[0];
  const p = { id: 'p1', row, col, ducats: 500 };
  room.players.push(p);
  island.buildings = [{ type: 'manor', level: 1 }, { type: 'market', level: 1 }, { type: 'fort', level: 1 }, { type: 'lumbermill', level: 1 }];
  assert.equal(build(room, p, island.id, 'palace').ok, false);
  island.buildings.push({ type: 'quarry', level: 1 });
  assert.equal(islandStatus(island), 'Город');
  assert.equal(build(room, p, island.id, 'palace').ok, true);
}

// Адмиралтейство I/II/III требует пищевую ступень I/II/III и повышается
// последовательно без дополнительной клетки.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'maikan');
  island.ownerId = 'p1'; island.area = 20;
  const [row, col] = island.cells[0];
  const p = { id: 'p1', row, col, ducats: 500 };
  room.players.push(p);
  island.buildings = [{ type: 'farm', level: 1 }];
  assert.equal(build(room, p, island.id, 'admiralty').ok, true);
  assert.equal(bestAdmiraltyLevelAtPlayer(room, p), 1);
  assert.equal(upgradeBuilding(room, p, island.id, 1).ok, false);
  island.buildings[0].level = 2;
  assert.equal(upgradeBuilding(room, p, island.id, 1).afterName, 'Адмиралтейство II');
  assert.equal(upgradeBuilding(room, p, island.id, 1).ok, false);
  island.buildings[0].level = 3;
  assert.equal(upgradeBuilding(room, p, island.id, 1).afterName, 'Адмиралтейство III');
  assert.equal(island.buildings.length, 2);
}

// Маяк даёт ровно +1 только при начале навигации у своего острова с Маяком;
// несколько маяков игрока не складываются.
{
  const room = { islands: cloneIslands(), players: [] };
  const a = room.islands.find(i => i.id === 'maikan');
  const b = room.islands.find(i => i.id === 'bogamia');
  a.ownerId = b.ownerId = 'p1';
  a.buildings = [{ type: 'lighthouse', level: 1 }];
  b.buildings = [{ type: 'lighthouse', level: 1 }];
  const p = { id: 'p1', row: a.cells[0][0], col: a.cells[0][1] };
  room.players.push(p);
  assert.equal(lighthouseDepartureBonus(room, p), 1);
  p.row = 0; p.col = 0;
  assert.equal(lighthouseDepartureBonus(room, p), 0);
}

// Персонаж берётся только у подходящего Адмиралтейства, один на основной корабль,
// недоступен второму игроку, а замена неиспользованного персонажа ограничена одним разом за раунд.
{
  const room = { round: 3, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'maikan');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'admiralty', level: 3 }];
  const [row, col] = island.cells[0];
  const p1 = { id: 'p1', row, col, character: null, characterReplacedRound: null };
  const p2 = { id: 'p2', row, col, character: null, characterReplacedRound: null };
  room.players.push(p1, p2);
  assert.equal(characterOptionsAtAdmiralty(room, p1).length, 6);
  assert.equal(takeCharacter(room, p1, 'navigator').ok, true);
  island.ownerId = 'p2';
  assert.equal(characterOptionsAtAdmiralty(room, p2).some(c => c.id === 'navigator'), false);
  island.ownerId = 'p1';
  assert.equal(replaceCharacter(room, p1, 'cartographer').ok, true);
  assert.equal(replaceCharacter(room, p1, 'firstMate').ok, false);
  room.round = 4;
  assert.equal(replaceCharacter(room, p1, 'firstMate').ok, true);
  island.buildings = [];
  assert.equal(p1.character.id, 'firstMate');
  assert.equal(consumeCharacter(p1, 'firstMate').ok, true);
  assert.equal(p1.character, null);
}

// Картограф использует манхэттенскую дальность до клеток якорей.
{
  const first = Object.entries(ANCHORS)[0];
  const [color, anchor] = first;
  const [row, col] = anchor.cells[0];
  const options = cartographerAnchorOptions({ row, col });
  assert.equal(options.some(o => o.color === color && o.distance === 0), true);
}

// Посольство может выдать две допустимые карты, выбранная становится активной,
// а невыбранная возвращается в колоду и перемешивается.
{
  const room = { round: 2, islands: cloneIslands(), assignmentDecks: createAssignmentDecks(() => 0.25) };
  const p = { id: 'p1', level: 1, upgrades: [], activeAssignment: null, replacedAssignmentConditions: [] };
  const offered = offerAssignmentCards(room, p, 'lionia', 2, () => 0.25);
  assert.equal(offered.ok, true);
  assert.equal(offered.cards.length, 2);
  const unchosen = offered.cards[1].id;
  const result = chooseAssignmentOffer(room, p, 'lionia', offered.cards, offered.cards[0].id, () => 0.25);
  assert.equal(result.ok, true);
  assert.equal(p.activeAssignment.card.id, offered.cards[0].id);
  assert.equal(room.assignmentDecks.lionia.drawPile.some(c => c.id === unchosen), true);
}

// Уровни II–VI: новые характеристики без бонуса движения; VII читается для старых комнат.
{
  const p = { shipClass: 'frigate', level: 4, upgrades: [] };
  assert.deepEqual(shipStats(p), { artillery: 8, army: 6, cargo: 5, moveMod: 0 });
  p.shipClass = 'carrack';
  p.level = 7;
  p.upgrades = ['orlop', 'sternStores'];
  assert.equal(shipCargoCapacity(p), 14);
  assert.equal(shipStats(p).moveMod, 1); // −1 класса +2 уровня VII
}

// Покупка уровня только в Цитадели и последовательно.
{
  const p = { row: 5, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], ducats: 30 };
  assert.equal(buyShipLevel(p).ok, false);
  p.row = 13; p.col = 13;
  const result = buyShipLevel(p);
  assert.equal(result.ok, true);
  assert.equal(result.price, 10);
  assert.equal(p.level, 2);
  assert.equal(p.ducats, 20);
}

// Улучшения занимают места уровня; второе улучшение ветви требует первое.
{
  const p = { row: 13, col: 13, shipClass: 'frigate', level: 2, upgrades: [], ducats: 50 };
  assert.equal(buyShipUpgrade(p, 'culverins').ok, false);
  assert.equal(buyShipUpgrade(p, 'falcons').ok, true);
  assert.equal(buyShipUpgrade(p, 'culverins').ok, true);
  assert.equal(shipStats(p).artillery, 9); // 5 +1 за II уровень +1 +2
  assert.equal(buyShipUpgrade(p, 'musketeers').ok, false); // мест больше нет
  assert.equal(removeShipUpgrade(p, 'falcons').ok, false); // сначала второе
  assert.equal(removeShipUpgrade(p, 'culverins').ok, true);
  assert.equal(removeShipUpgrade(p, 'falcons').ok, true);
}

// Обычное сопровождение требует место верфи и ограничивается уровнем основного корабля.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'kisalinia');
  island.ownerId = 'p1';
  island.buildings.push({ type: 'shipyard', level: 1 });
  const p = { id: 'p1', row: 13, col: 13, shipClass: 'frigate', level: 3, upgrades: [], escorts: [], nextEscortId: 0, ducats: 100 };
  assert.equal(escortUseLimit(p), 2);
  const one = buyEscort(room, p, 'cargo');
  assert.equal(one.ok, true);
  assert.equal(one.price, 10);
  assert.equal(buyEscort(room, p, 'combat').ok, false); // только одно место верфи
  island.buildings[0].level = 2;
  const two = buyEscort(room, p, 'combat');
  assert.equal(two.ok, true);
  assert.equal(two.price, 15);
  assert.equal(buyEscort(room, p, 'combat').ok, false); // уровень III допускает два
  p.level = 5;
  island.buildings[0].level = 3;
  const three = buyEscort(room, p, 'combat');
  assert.equal(three.ok, true);
  assert.equal(three.price, 20);
}

// Ферма загружает основной трюм полностью. Для бригантины I это 2 провианта.
{
  const room = { islands: cloneIslands(), round: 1 };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings.push({ type: 'farm', level: 1 });
  const p = { id: 'p1', row: 5, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], cargo: null, ducats: 0 };
  const result = loadCargo(room, p, 'bogamia', 'provisions');
  assert.equal(result.ok, true);
  assert.deepEqual(p.cargo, { goodId: 'provisions', quantity: 2 });
  assert.equal(island.loadedRound, 1);
}

// Грузовой эскорт имеет отдельный трюм 5 и может продать его в Цитадели.
{
  const room = { islands: cloneIslands(), round: 2 };
  const source = room.islands.find(i => i.id === 'bogamia');
  source.ownerId = 'p1';
  source.buildings.push({ type: 'farm', level: 1 });
  const yard = room.islands.find(i => i.id === 'kisalinia');
  yard.ownerId = 'p1';
  yard.buildings.push({ type: 'shipyard', level: 1 });
  const p = {
    id: 'p1', row: 5, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], cargo: null, ducats: 0,
    escorts: [{ id: 'escort-1', type: 'cargo', special: false, cargo: null }],
  };
  const loaded = loadCargo(room, p, 'bogamia', 'provisions', 'escort-1');
  assert.equal(loaded.ok, true);
  assert.equal(p.escorts[0].cargo.quantity, 5);
  p.row = 13; p.col = 13;
  const sold = sellCargo(room, p, 'escort-1');
  assert.equal(sold.ok, true);
  assert.equal(sold.revenue, 5);
  assert.equal(p.ducats, 5);
  assert.equal(p.escorts[0].cargo, null);
}

// С одного острова нельзя грузиться второй раз в том же раунде.
{
  const room = { islands: cloneIslands(), round: 3 };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings.push({ type: 'farm', level: 1 });
  const p = { id: 'p1', row: 5, col: 1, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], cargo: null, ducats: 0 };
  assert.equal(loadCargo(room, p, 'bogamia', 'provisions').ok, true);
  p.cargo = null;
  assert.equal(canLoadCargo(room, p, island, 'provisions').ok, false);
  room.round = 4;
  assert.equal(canLoadCargo(room, p, island, 'provisions').ok, true);
}

// Продажа основного груза возможна только в Цитадели.
{
  const room = { islands: cloneIslands() };
  const p = { id: 'p1', row: 5, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], cargo: { goodId: 'wood', quantity: 2 }, ducats: 1 };
  assert.equal(cargoSaleValue(p), 4);
  assert.equal(sellCargo(room, p).ok, false);
  p.row = 13; p.col = 13;
  assert.equal(isCitadelCell(p.row, p.col), true);
  const sold = sellCargo(room, p);
  assert.equal(sold.ok, true);
  assert.equal(sold.revenue, 4);
  assert.equal(p.ducats, 5);
  assert.equal(p.cargo, null);
}


// Зона мира включает клетки Цитадели и соседние морские клетки.
{
  assert.equal(isCitadelPeaceCell(13, 13), true);
  assert.equal(isCitadelPeaceCell(12, 13), true);
  assert.equal(isCitadelPeaceCell(5, 1), false);
}

// Морской бой сравнивает суммарную артиллерию флотилии, переносит до 3 дукатов
// и понижает уровень проигравшего.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const a = { id: 'a', row: 5, col: 10, shipClass: 'frigate', level: 2, upgrades: ['falcons'], escorts: [], ducats: 10, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {} };
  const b = { id: 'b', row: 5, col: 10, shipClass: 'brigantine', level: 2, upgrades: [], escorts: [], ducats: 2, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {} };
  room.players = [a, b];
  assert.equal(fleetArtillery(room, a), 7); // 5 +1 уровень +1 фальконы
  const result = seaBattle(room, a, b);
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'attacker');
  assert.equal(result.loot, 2);
  assert.equal(b.level, 1);
  assert.equal(a.ducats, 12);
  assert.equal(b.ducats, 0);
}

// При поражении корабля I уровня он не получает уровень 0, а возвращается на старт.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const a = { id: 'a', row: 10, col: 10, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 4, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {} };
  const b = { id: 'b', row: 10, col: 10, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 4, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {} };
  room.players = [a, b];
  const result = seaBattle(room, a, b);
  assert.equal(result.outcome, 'defender');
  assert.equal(a.level, 1);
  assert.deepEqual([a.row, a.col], [0, 0]);
}

// Ничья морского боя заставляет обоих пропустить следующий личный ход.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const a = { id: 'a', row: 10, col: 10, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 5, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {} };
  const b = { id: 'b', row: 10, col: 10, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 5, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {} };
  room.players = [a, b];
  const result = seaBattle(room, a, b);
  assert.equal(result.outcome, 'tie');
  assert.equal(a.skipTurns, 1);
  assert.equal(b.skipTurns, 1);
}

// В первом раунде морской PvP запрещён, и одну цель нельзя атаковать дважды за один личный ход.
{
  const room = { round: 1, islands: cloneIslands(), players: [] };
  const a = { id: 'a', row: 10, col: 10, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 5, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {} };
  const b = { id: 'b', row: 10, col: 10, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 5, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {} };
  room.players = [a, b];
  assert.equal(seaBattle(room, a, b).ok, false);
  room.round = 2;
  assert.equal(seaBattle(room, a, b).ok, true);
  a.row = b.row = 10; a.col = b.col = 10;
  assert.equal(seaBattle(room, a, b).ok, false);
}

// Штурм независимого Агмора: каравелла I (войско 5) побеждает гарнизон 3,
// получает остров, 5 дукатов и 2 славы за первое военное покорение.
{
  const room = { round: 1, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'agmor');
  const a = { id: 'a', row: 13, col: 7, shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, glory: 0 };
  room.players = [a];
  assert.equal(islandDefenseArmy(room, island).total, 3);
  const result = assaultIsland(room, a, island, 'preserve');
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'attacker');
  assert.equal(island.ownerId, 'a');
  assert.equal(a.ducats, 5);
  assert.equal(a.glory, 2);
  assert.equal(island.firstMilitaryConquered, true);
}

// Разорение при успешном штурме удаляет инфраструктуру.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'b';
  island.buildings = [{ type: 'farm', level: 1 }, { type: 'fort', level: 1 }];
  const a = { id: 'a', row: 5, col: 1, shipClass: 'caravel', level: 7, upgrades: ['musketeers', 'pikemen'], escorts: [], ducats: 0, glory: 0 };
  const b = { id: 'b', row: 1, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0 };
  room.players = [a, b];
  assert.equal(islandDefenseArmy(room, island).total, 4);
  const result = assaultIsland(room, a, island, 'raze');
  assert.equal(result.outcome, 'attacker');
  assert.equal(island.buildings.length, 0);
  assert.equal(island.ownerId, 'a');
}

// Если корабль владельца находится на острове, его войско добавляется к защите.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'b';
  island.buildings = [{ type: 'fort', level: 1 }];
  const b = { id: 'b', row: 5, col: 2, shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 10 };
  room.players = [b];
  const defense = islandDefenseArmy(room, island);
  assert.equal(defense.fortifications, 4);
  assert.equal(defense.ownerShip, 5);
  assert.equal(defense.total, 9);
}

// Третья атака на один корабль в пределах десяти личных ходов вызывает бунт владений:
// все постройки выше I уровня атакующего понижаются на одну ступень.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'kisalinia');
  island.ownerId = 'a';
  island.buildings = [{ type: 'farm', level: 3 }, { type: 'shipyard', level: 2 }, { type: 'fort', level: 1 }];
  const a = { id: 'a', row: 10, col: 10, shipClass: 'frigate', level: 7, upgrades: [], escorts: [], ducats: 20, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {} };
  const b = { id: 'b', row: 10, col: 10, shipClass: 'brigantine', level: 7, upgrades: [], escorts: [], ducats: 20 };
  room.players = [a, b];
  let result = seaBattle(room, a, b);
  assert.equal(result.rebellion, false);
  for (const turnNo of [5, 9]) {
    a.personalTurnNo = turnNo;
    a.attackedThisTurn = [];
    a.row = b.row = 10; a.col = b.col = 10;
    result = seaBattle(room, a, b);
  }
  assert.equal(result.rebellion, true);
  assert.equal(island.buildings[0].level, 2);
  assert.equal(island.buildings[1].level, 1);
  assert.equal(island.buildings[2].level, 1);
}


// Союз хранится попарно и не зависит от порядка ID.
{
  const room = { alliances: [] };
  assert.equal(addAlliance(room, 'a', 'b'), true);
  assert.equal(areAllies(room, 'a', 'b'), true);
  assert.equal(areAllies(room, 'b', 'a'), true);
  assert.equal(addAlliance(room, 'b', 'a'), false);
  assert.equal(removeAlliance(room, 'b', 'a'), true);
  assert.equal(areAllies(room, 'a', 'b'), false);
}

// Совместный морской бой складывает артиллерию союзников. При поражении каждый
// участвовавший корабль проигравшей стороны теряет уровень; добыча делится победителями.
{
  const room = { round: 2, islands: cloneIslands(), players: [], alliances: [] };
  const a = { id: 'a', name: 'A', row: 10, col: 10, shipClass: 'frigate', level: 2, upgrades: [], escorts: [], ducats: 5, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {}, brokenAlliesThisTurn: [] };
  const c = { id: 'c', name: 'C', row: 10, col: 10, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 0 };
  const b = { id: 'b', name: 'B', row: 10, col: 10, shipClass: 'brigantine', level: 3, upgrades: [], escorts: [], ducats: 3 };
  room.players = [a, b, c];
  addAlliance(room, 'a', 'c');
  const result = jointSeaBattle(room, a, b, ['c'], []);
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'attacker');
  assert.equal(result.attackerPower, 11); // фрегат II = 6, союзный фрегат I = 5
  assert.equal(result.defenderPower, 6); // бригантина III = 6
  assert.equal(b.level, 2);
  assert.equal(result.loot, 3);
  assert.equal(a.ducats + c.ducats, 8); // было 5, добыча +3 поделена 2+1
  assert.equal(Object.values(result.lootShares).reduce((x, y) => x + y, 0), 3);
}

// Если побеждает совместная защита, уровни теряют все участвовавшие нападающие,
// а до 3 дукатов берутся только из казны инициатора и делятся защитниками.
{
  const room = { round: 2, islands: cloneIslands(), players: [], alliances: [] };
  const a = { id: 'a', name: 'A', row: 11, col: 11, shipClass: 'brigantine', level: 2, upgrades: [], escorts: [], ducats: 3, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {}, brokenAlliesThisTurn: [] };
  const c = { id: 'c', name: 'C', row: 11, col: 11, shipClass: 'brigantine', level: 2, upgrades: [], escorts: [], ducats: 0 };
  const b = { id: 'b', name: 'B', row: 11, col: 11, shipClass: 'frigate', level: 3, upgrades: [], escorts: [], ducats: 0 };
  const d = { id: 'd', name: 'D', row: 11, col: 11, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 0 };
  room.players = [a, b, c, d];
  addAlliance(room, 'a', 'c');
  addAlliance(room, 'b', 'd');
  const result = jointSeaBattle(room, a, b, ['c'], ['d']);
  assert.equal(result.outcome, 'defender');
  assert.equal(a.level, 1);
  assert.equal(c.level, 1);
  assert.equal(a.ducats, 0);
  assert.equal(b.ducats + d.ducats, 3);
}

// Союзники не могут атаковать друг друга, а игрок, разорвавший союз, не может
// атаковать бывшего союзника в тот же личный ход.
{
  const room = { round: 2, islands: cloneIslands(), players: [], alliances: [] };
  const a = { id: 'a', name: 'A', row: 9, col: 9, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 5, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {}, brokenAlliesThisTurn: [] };
  const b = { id: 'b', name: 'B', row: 9, col: 9, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 5 };
  room.players = [a, b];
  addAlliance(room, 'a', 'b');
  assert.equal(jointSeaBattle(room, a, b).ok, false);
  removeAlliance(room, 'a', 'b');
  a.brokenAlliesThisTurn = ['b'];
  assert.equal(jointSeaBattle(room, a, b).ok, false);
}

// Совместный штурм складывает войско союзников, но захваченный остров получает инициатор.
{
  const room = { round: 2, islands: cloneIslands(), players: [], alliances: [] };
  const island = room.islands.find(i => i.id === 'asigoriy'); // защита 10
  const a = { id: 'a', name: 'A', row: 19, col: 24, shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, glory: 0, brokenAlliesThisTurn: [] };
  const c = { id: 'c', name: 'C', row: 20, col: 24, shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, glory: 0 };
  room.players = [a, c];
  addAlliance(room, 'a', 'c');
  const result = jointAssaultIsland(room, a, island, 'preserve', ['c'], []);
  assert.equal(result.ok, true);
  assert.equal(result.attackerPower, 10); // 5 + 5
  assert.equal(result.defense.total, 10);
  assert.equal(result.outcome, 'tie');
  // Усиливаем инициатора на ступень, затем повторяем в новой копии острова.
  const room2 = { round: 2, islands: cloneIslands(), players: [], alliances: [] };
  const island2 = room2.islands.find(i => i.id === 'asigoriy');
  const a2 = { ...a, id: 'a2', row: 19, col: 24, level: 3, ducats: 0, glory: 0, attackedThisTurn: [], attackHistory: {}, brokenAlliesThisTurn: [] };
  const c2 = { ...c, id: 'c2', row: 20, col: 24, ducats: 0, glory: 0 };
  room2.players = [a2, c2];
  addAlliance(room2, 'a2', 'c2');
  const win = jointAssaultIsland(room2, a2, island2, 'preserve', ['c2'], []);
  assert.equal(win.outcome, 'attacker');
  assert.equal(island2.ownerId, 'a2');
  assert.equal(a2.glory, 4); // защита 10 => 4 славы инициатору
  assert.equal(c2.glory, 0);
}

// При ничьей совместного штурма 30% казны теряет каждый реально участвовавший игрок обеих сторон.
{
  const room = { round: 2, islands: cloneIslands(), players: [], alliances: [] };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'b';
  const a = { id: 'a', name: 'A', row: 5, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 10, glory: 0, brokenAlliesThisTurn: [] };
  const c = { id: 'c', name: 'C', row: 5, col: 2, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 10 };
  const b = { id: 'b', name: 'B', row: 5, col: 2, shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 10 };
  const d = { id: 'd', name: 'D', row: 6, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 10 };
  room.players = [a, b, c, d];
  addAlliance(room, 'a', 'c');
  addAlliance(room, 'b', 'd');
  // Атака: 3+3=6; защита: владелец 5 + союзник 3 = 8, значит не ничья.
  // Даём инициатору мушкетёров (+1) и II уровень (+1): 5+3=8.
  a.upgrades = ['musketeers']; a.level = 2;
  const result = jointAssaultIsland(room, a, island, 'preserve', ['c'], ['d']);
  assert.equal(result.outcome, 'tie');
  for (const p of [a, b, c, d]) assert.equal(p.ducats, 7);
}



// Якоря откалиброваны по карте: четыре синих, три жёлтых и один красный.
{
  assert.equal(anchorAt(5, 11).color, 'blue');
  assert.equal(anchorAt(10, 16).color, 'yellow');
  assert.equal(anchorAt(26, 21).color, 'red');
  assert.equal(anchorAt(0, 0), null);
}

// Морские колоды имеют правильный размер: 10 карт каждого цвета; у синей
// «Контрабандисты» присутствуют в двух экземплярах.
{
  const decks = createAnchorDecks(() => 0.5);
  assert.equal(decks.blue.drawPile.length, 10);
  assert.equal(decks.yellow.drawPile.length, 10);
  assert.equal(decks.red.drawPile.length, 10);
  assert.equal(decks.blue.drawPile.filter(c => c.id === 'smugglers').length, 2);
}

// Победа на синем якоре: награда + слава, карта уходит в сброс, визит отмечается.
{
  const p = { id: 'p1', row: 5, col: 11, shipClass: 'frigate', level: 7, upgrades: ['falcons', 'culverins'], escorts: [], ducats: 1, debt: 0, glory: 0, visitedAnchors: [] };
  const room = { round: 2, players: [p], islands: cloneIslands(), anchorDecks: { blue: { drawPile: [{ id: 'test', name: 'Тестовый конвой', artillery: 4, reward: 8, quiet: false }], discard: [] } } };
  const result = resolveAnchorEncounter(room, p);
  assert.equal(result.triggered, true);
  assert.equal(result.outcome, 'win');
  assert.equal(result.actionCost, 1);
  assert.equal(p.ducats, 9);
  assert.equal(p.glory, 1);
  assert.equal(room.anchorDecks.blue.discard.length, 1);
  assert.equal(p.visitedAnchors.includes('5,11'), true);
  const second = resolveAnchorEncounter(room, p);
  assert.equal(second.triggered, false);
  assert.equal(second.reason, 'already-visited');
}

// Поражение на якоре берёт 30% казны, но минимум 2; нехватка создаёт долг.
{
  const p = { id: 'p1', row: 26, col: 21, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 1, debt: 0, glory: 0, visitedAnchors: [] };
  const room = { round: 1, players: [p], islands: cloneIslands(), anchorDecks: { red: { drawPile: [{ id: 'test-red', name: 'Красный тест', artillery: 99, reward: 70, quiet: false }], discard: [] } } };
  const result = resolveAnchorEncounter(room, p);
  assert.equal(result.outcome, 'loss');
  assert.equal(result.penalty.required, 2);
  assert.equal(result.penalty.paid, 1);
  assert.equal(result.penalty.addedDebt, 1);
  assert.equal(p.ducats, 0);
  assert.equal(p.debt, 1);
  assert.equal(p.level, 1); // поражение на якоре уровень не снижает
}

// Любое новое поступление сначала гасит долг.
{
  const p = { ducats: 4, debt: 7 };
  const c1 = creditDucats(p, 5);
  assert.deepEqual(c1, { gross: 5, debtPaid: 5, net: 0, debtRemaining: 2 });
  assert.equal(p.ducats, 4);
  assert.equal(p.debt, 2);
  const c2 = creditDucats(p, 6);
  assert.equal(c2.debtPaid, 2);
  assert.equal(c2.net, 4);
  assert.equal(p.ducats, 8);
  assert.equal(p.debt, 0);
}

// Ничья на якоре не даёт награды и заставляет пропустить следующий личный ход.
{
  const p = { id: 'p1', row: 5, col: 25, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 10, debt: 0, glory: 0, visitedAnchors: [], skipTurns: 0 };
  const room = { round: 2, players: [p], islands: cloneIslands(), anchorDecks: { yellow: { drawPile: [{ id: 'tie', name: 'Ровный противник', artillery: 5, reward: 20, quiet: false }], discard: [] } } };
  const result = resolveAnchorEncounter(room, p);
  assert.equal(result.outcome, 'tie');
  assert.equal(p.skipTurns, 1);
  assert.equal(p.ducats, 10);
  assert.equal(p.glory, 0);
}

// «На море тихо» не тратит действие и не меняет казну/славу.
{
  const p = { id: 'p1', row: 9, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 10, debt: 0, glory: 0, visitedAnchors: [] };
  const room = { round: 2, players: [p], islands: cloneIslands(), anchorDecks: { blue: { drawPile: [{ id: 'calm', name: 'На море тихо', artillery: null, reward: 0, quiet: true }], discard: [] } } };
  const result = resolveAnchorEncounter(room, p);
  assert.equal(result.outcome, 'quiet');
  assert.equal(result.actionCost, 0);
  assert.equal(p.ducats, 10);
  assert.equal(p.glory, 0);
}


// Колода событий содержит ровно 26 карт, включая два экземпляра «Найдено сокровище».
{
  const deck = createSailingEventDeck(() => 0.5);
  assert.equal(deck.drawPile.length, 26);
  assert.equal(deck.drawPile.filter(c => c.id === 'found-treasure').length, 2);
  const room = { eventDeck: deck };
  const card = drawSailingEventCard(room, () => 0.5);
  assert.ok(card);
  discardDeckCard(room.eventDeck, card);
  assert.equal(room.eventDeck.drawPile.length, 25);
  assert.equal(room.eventDeck.discard.length, 1);
}

// Сокровища: четыре карты, денежная карта учитывает текущий доход и сначала гасит долг.
{
  const room = { islands: cloneIslands(), treasureDeck: createTreasureDeck(() => 0.5) };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'farm', level: 1 }, { type: 'market', level: 1 }];
  const p = { id: 'p1', ducats: 0, debt: 1 };
  const result = resolveMoneyTreasure(room, p, { id: 'income-x2', name: 'Доход ×2', multiplier: 2, minimum: 4 });
  assert.equal(result.amount, 4);
  assert.equal(p.debt, 0);
  assert.equal(p.ducats, 3);
  assert.equal(room.treasureDeck.drawPile.length, 4);
}

// Легендарная колода содержит восемь карт: по две каждого из четырёх видов.
{
  const room = { legendaryDeck: createLegendaryDeck(() => 0.5) };
  assert.equal(room.legendaryDeck.drawPile.length, 8);
  const names = new Map();
  for (const card of room.legendaryDeck.drawPile) names.set(card.id, (names.get(card.id) || 0) + 1);
  assert.deepEqual([...names.values()].sort(), [2, 2, 2, 2]);
  assert.ok(drawLegendaryCard(room));
  assert.equal(room.legendaryDeck.drawPile.length, 7);
}

// Найденный груз можно положить напрямую в любой пустой активный трюм до полной вместимости.
{
  const room = { islands: cloneIslands() };
  const p = { id: 'p1', shipClass: 'carrack', level: 1, upgrades: [], escorts: [], cargo: null };
  const holds = emptyCargoHolds(room, p);
  assert.equal(holds.length, 1);
  assert.equal(holds[0].capacity, 5);
  const loaded = fillCargoDirect(room, p, 'ore', 'main');
  assert.equal(loaded.ok, true);
  assert.equal(p.cargo.quantity, 5);
  assert.equal(emptyCargoHolds(room, p).length, 0);
}

// «Судовой мастер» устанавливает улучшение бесплатно, но сохраняет обычные требования места и Цитадели.
{
  const p = { row: 13, col: 13, shipClass: 'frigate', level: 1, ducats: 0, upgrades: [] };
  const result = installShipUpgradeFree(p, 'falcons');
  assert.equal(result.ok, true);
  assert.equal(p.ducats, 0);
  assert.deepEqual(p.upgrades, ['falcons']);
  assert.equal(installShipUpgradeFree(p, 'culverins').ok, false); // нет второго слота на I уровне
}

// Чертёж строит бесплатно, но остальные условия строительства сохраняются.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  const p = { id: 'p1', row: 5, col: 1, ducats: 0 };
  assert.equal(buildFree(room, p, 'bogamia', 'market').ok, false); // нужна пищевая ветвь
  assert.equal(buildFree(room, p, 'bogamia', 'farm').ok, true);
  assert.equal(p.ducats, 0);
}

// «Набег» даёт только постройки выше I уровня и понижает выбранную ровно на одну ступень.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'farm', level: 3 }, { type: 'market', level: 1 }];
  const p = { id: 'p1' };
  const opts = raidBuildingOptions(room, p);
  assert.equal(opts.length, 1);
  const result = applyRaidDowngrade(room, p, opts[0].islandId, opts[0].buildingIndex);
  assert.equal(result.ok, true);
  assert.equal(island.buildings[0].level, 2);
}

// «Абордаж» может принудительно снять первое улучшение ветви; второе остаётся в слоте, но перестаёт действовать.
{
  const p = { shipClass: 'frigate', level: 2, upgrades: ['falcons', 'culverins'] };
  assert.equal(shipStats(p).artillery, 9); // 5 + уровень 1 + 2 + 3
  const opts = boardingUpgradeOptions(p);
  assert.equal(opts.length, 2);
  const result = applyBoardingLoss(p, 'falcons');
  assert.equal(result.ok, true);
  assert.deepEqual(p.upgrades, ['culverins']);
  assert.equal(shipStats(p).artillery, 6); // кулеврины без фальконов не действуют
}

// Шторм предлагает допустимые береговые клетки целевого острова.
{
  const room = { islands: cloneIslands() };
  const p = { shipClass: 'frigate' };
  const options = stormCellOptions(room, p, 'landin');
  assert.ok(options.length > 0);
  const island = room.islands.find(i => i.id === 'landin');
  assert.equal(options.every(o => island.cells.some(([r,c]) => r === o.row && c === o.col)), true);
}

// «Путь сквозь туман» использует те же запреты препятствий, но без лимита d6.
{
  const frigate = { row: 6, col: 6, shipClass: 'frigate' };
  const brigantine = { row: 6, col: 6, shipClass: 'brigantine' };
  const fr = mistPathReachableCells(frigate);
  const br = mistPathReachableCells(brigantine);
  assert.equal(has(fr, 6, 7), true);   // риф доступен фрегату
  assert.equal(has(br, 6, 7), false); // и запрещён бригантине
  assert.ok(fr.length > 100);
}

// «Покров моря» защищает корабль и остров ровно три следующих личных хода;
// текущий ход при проактивном применении в срок не входит.
{
  const room = { islands: cloneIslands() };
  const p = { id: 'p1', personalTurnNo: 5, legendaryEffects: { seaCurses: [] } };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  applySeaVeilToShip(p, { sourcePlayerId: p.id, ignoreCurrentTurn: true });
  applySeaVeilToIsland(island, p, { ignoreCurrentTurn: true });
  assert.equal(isShipProtected(p), true);
  assert.equal(isIslandProtected(island), true);
  tickLegendaryEffectsForPlayer(room, p); // конец хода 5 не считается
  assert.equal(p.legendaryEffects.shipVeil.remaining, 3);
  assert.equal(island.legendaryVeil.remaining, 3);
  for (let turn = 6; turn <= 8; turn++) {
    p.personalTurnNo = turn;
    tickLegendaryEffectsForPlayer(room, p);
  }
  assert.equal(isShipProtected(p), false);
  assert.equal(isIslandProtected(island), false);
}

// «Морское проклятие» даёт −3 к движению три личных хода и может складываться.
{
  const room = { islands: cloneIslands() };
  const p = { id: 'p1', personalTurnNo: 1, legendaryEffects: { seaCurses: [] } };
  applySeaCurse(p, 'enemy-a');
  applySeaCurse(p, 'enemy-b');
  assert.equal(legendaryMovementPenalty(p), 6);
  tickLegendaryEffectsForPlayer(room, p);
  assert.equal(legendaryMovementPenalty(p), 6);
  p.personalTurnNo = 2; tickLegendaryEffectsForPlayer(room, p);
  p.personalTurnNo = 3; tickLegendaryEffectsForPlayer(room, p);
  assert.equal(legendaryMovementPenalty(p), 0);
}

// «Пламя Ада» снижает каждое здание выше I уровня на одну ступень, I уровень не трогает.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'enemy';
  island.buildings = [
    { type: 'farm', level: 3 },
    { type: 'market', level: 1 },
    { type: 'bank', level: 1 },
  ];
  const attacker = { id: 'a', row: 5, col: 1 };
  const result = applyHellfire(room, attacker, island);
  assert.equal(result.ok, true);
  assert.equal(result.changed, 2);
  assert.deepEqual(island.buildings.map(b => [b.type, b.level]), [
    ['farm', 2],
    ['market', 1],
    ['market', 3], // Банк I -> Рынок III
  ]);
}

// Каждая из пяти политических фракций имеет колоду вражды из 10 карт.
{
  const decks = createFeudDecks(() => 0.5);
  assert.deepEqual(Object.keys(decks).sort(), ['kadingir', 'lionia', 'mayo', 'pirates', 'suniksiya']);
  for (const deck of Object.values(decks)) assert.equal(deck.drawPile.length, 10);
}

// При вступлении в подданство Лионии Франдия сразу передаётся вассалу.
{
  const room = { islands: cloneIslands(), players: [], factionState: {} };
  const landin = room.islands.find(i => i.id === 'landin');
  const p = {
    id: 'p1', row: landin.cells[0][0], col: landin.cells[0][1],
    suzerainId: null, vassalGiftIslandId: null, enemyFactionIds: [], activeAssignment: null,
  };
  room.players.push(p);
  assert.equal(factionIdForIsland(landin), 'lionia');
  assert.equal(canEnterVassalage(room, p, 'lionia').ok, true);
  const joined = enterVassalage(room, p, 'lionia');
  assert.equal(joined.ok, true);
  assert.equal(p.suzerainId, 'lionia');
  assert.equal(p.vassalGiftIslandId, 'frandia');
  assert.equal(room.islands.find(i => i.id === 'frandia').ownerId, 'p1');
  assert.equal(stateExists(room, 'lionia'), true);
}

// Мятеж прекращает подданство, возвращает подаренный остров государству и создаёт вражду.
{
  const room = { islands: cloneIslands(), players: [], factionState: {} };
  const landin = room.islands.find(i => i.id === 'landin');
  const p = { id: 'p1', row: landin.cells[0][0], col: landin.cells[0][1], suzerainId: null, vassalGiftIslandId: null, enemyFactionIds: [], activeAssignment: { id: 'x' } };
  room.players.push(p);
  assert.equal(enterVassalage(room, p, 'lionia').ok, true);
  const rebellion = rebelFromSuzerain(room, p);
  assert.equal(rebellion.ok, true);
  assert.equal(rebellion.returned, true);
  assert.equal(p.suzerainId, null);
  assert.equal(p.activeAssignment, null);
  assert.equal(p.enemyFactionIds.includes('lionia'), true);
  assert.equal(room.islands.find(i => i.id === 'frandia').ownerId, null);
}

// Государство исчезает, когда все его исходные острова принадлежат не-вассалам; старая вражда снимается.
{
  const room = { islands: cloneIslands(), players: [], factionState: {} };
  const p = { id: 'p1', suzerainId: null, vassalGiftIslandId: null, enemyFactionIds: ['lionia'] };
  room.players.push(p);
  for (const id of ['landin', 'frandia', 'eidon']) room.islands.find(i => i.id === id).ownerId = 'p1';
  assert.equal(stateExists(room, 'lionia'), false);
  refreshFactionExistence(room);
  assert.equal(room.factionState.lionia.exists, false);
  assert.deepEqual(p.enemyFactionIds, []);
  assert.equal(addEnmity(room, p, 'lionia').ok, false);
}

// Политические карты могут выбирать постройки, улучшения, трюмы и закрытые удерживаемые карты.
{
  const room = {
    islands: cloneIslands(),
    legendaryDeck: { drawPile: [], discard: [] },
    eventDeck: { drawPile: [], discard: [] },
    treasureDeck: { drawPile: [], discard: [] },
  };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'fort', level: 2 }, { type: 'farm', level: 1 }];
  const p = {
    id: 'p1', shipClass: 'frigate', level: 2, upgrades: ['falcons', 'musketeers'],
    cargo: { goodId: 'wood', quantity: 3 }, escorts: [],
    specialCards: ['Путь сквозь туман'], legendaryCards: [], savedEventCards: [],
  };
  assert.equal(politicalBuildingOptions(room, p, { aboveLevelOne: true }).length, 1);
  assert.equal(politicalBuildingOptions(room, p, { fortsOnly: true }).length, 1);
  assert.equal(politicalUpgradeOptions(p, 'army').length, 1);
  assert.equal(politicalCargoOptions(room, p).length, 1);
  assert.equal(discardRandomHeldCard(room, p, () => 0).discarded.name, 'Путь сквозь туман');
  assert.deepEqual(p.specialCards, []);
  const removed = removePlayerBuilding(room, p, 'bogamia', 1);
  assert.equal(removed.ok, true);
  assert.equal(island.buildings.length, 1);
}


// Все четыре колоды поручений содержат ровно 39 карт: 10 + 10 + 9 + 10.
{
  assert.equal(ASSIGNMENT_CARDS.lionia.length, 10);
  assert.equal(ASSIGNMENT_CARDS.kadingir.length, 10);
  assert.equal(ASSIGNMENT_CARDS.pirates.length, 9);
  assert.equal(ASSIGNMENT_CARDS.suniksiya.length, 10);
  assert.equal(Object.values(ASSIGNMENT_CARDS).flat().length, 39);
  const decks = createAssignmentDecks(() => 0.5);
  assert.equal(decks.lionia.drawPile.length, 10);
  assert.equal(decks.kadingir.drawPile.length, 10);
  assert.equal(decks.pirates.drawPile.length, 9);
  assert.equal(decks.suniksiya.drawPile.length, 10);
}

// Поручение засчитывает нужное событие и выплачивает полную награду Лионии.
{
  const card = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-ship-level');
  const room = { assignmentDecks: createAssignmentDecks(() => 0.5) };
  const p = { id: 'p1', ducats: 3, debt: 0, activeAssignment: { instanceId: 'a1', factionId: 'lionia', card: { ...card } }, replacedAssignmentConditions: [] };
  assert.equal(assignmentEventMatches(p, { type: 'ship-level' }), true);
  const result = completeAssignment(room, p, { type: 'ship-level' });
  assert.equal(result.ok, true);
  assert.equal(result.gross, 5);
  assert.equal(result.withheld, 0);
  assert.equal(p.ducats, 8);
  assert.equal(p.activeAssignment, null);
}

// Пираты и Вольная Суниксия удерживают половину отдельной награды поручения.
{
  const card = ASSIGNMENT_CARDS.pirates.find(c => c.id === 'pirates-kraken');
  const room = { assignmentDecks: createAssignmentDecks(() => 0.5) };
  const p = { id: 'p1', ducats: 0, debt: 0, activeAssignment: { instanceId: 'a2', factionId: 'pirates', card: { ...card } }, replacedAssignmentConditions: [] };
  const result = completeAssignment(room, p, { type: 'visit-place', placeId: 'kraken' });
  assert.equal(result.ok, true);
  assert.equal(result.gross, 8);
  assert.equal(result.withheld, 4);
  assert.equal(result.paid, 4);
  assert.equal(p.ducats, 4);
}

// Доставка засчитывается только грузом, полученным после выдачи именно текущего поручения.
{
  const card = ASSIGNMENT_CARDS.suniksiya.find(c => c.id === 'suniksiya-delivery-ore');
  const p = { activeAssignment: { instanceId: 'delivery-1', factionId: 'suniksiya', card: { ...card } } };
  assert.equal(assignmentEventMatches(p, { type: 'delivery', goodId: 'ore', assignmentInstanceId: null }), false);
  assert.equal(assignmentEventMatches(p, { type: 'delivery', goodId: 'wood', assignmentInstanceId: 'delivery-1' }), false);
  assert.equal(assignmentEventMatches(p, { type: 'delivery', goodId: 'ore', assignmentInstanceId: 'delivery-1' }), true);
}

// Платная замена стоит 2 дуката и навсегда отмечает условие, чтобы его нельзя было заменить повторно.
{
  const oldCard = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-yellow-a');
  const newCard = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-ship-level');
  const room = { round: 2, islands: cloneIslands(), assignmentDecks: { lionia: { drawPile: [{ ...newCard }], discard: [] } } };
  const p = { id: 'p1', suzerainId: 'lionia', level: 1, upgrades: [], ducats: 5, activeAssignment: { instanceId: 'old', factionId: 'lionia', card: { ...oldCard } }, replacedAssignmentConditions: [] };
  assert.equal(canReplaceAssignment(p).ok, true);
  const result = replaceAssignment(room, p, () => 0.4);
  assert.equal(result.ok, true);
  assert.equal(p.ducats, 3);
  assert.equal(p.replacedAssignmentConditions.includes('anchor:yellow'), true);
  assert.equal(p.activeAssignment.card.id, 'lionia-ship-level');
  p.activeAssignment = { instanceId: 'again', factionId: 'lionia', card: { ...oldCard } };
  assert.equal(canReplaceAssignment(p).ok, false);
}

// При выдаче карта захвата уже принадлежащего игроку острова пропускается.
{
  const capture = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-asigoriy');
  const level = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-ship-level');
  const islands = cloneIslands();
  islands.find(i => i.id === 'asigoriy').ownerId = 'p1';
  const room = { round: 3, islands, assignmentDecks: { lionia: { drawPile: [{ ...capture }, { ...level }], discard: [] } } };
  const p = { id: 'p1', level: 1, upgrades: [], suzerainId: 'lionia', activeAssignment: null, replacedAssignmentConditions: [] };
  const result = issueAssignment(room, p, 'lionia', () => 0.3);
  assert.equal(result.ok, true);
  assert.equal(result.assignment.card.id, 'lionia-ship-level');
}

// Координаты морских легендарных мест доступны серверу для поручений посещения.
{
  assert.equal(legendaryPlaceAt(24, 6)?.id, 'kraken');
  assert.equal(legendaryPlaceAt(12, 26)?.id, 'abyss');
  assert.equal(legendaryPlaceAt(0, 0), null);
}


// Итоговые призы полного подчинения заданы для всех пяти политических государств.
{
  assert.deepEqual(FACTIONS.lionia.fullConquestPrize.preserveBuildings.map(x => x.type), ['market', 'market']);
  assert.equal(FACTIONS.lionia.fullConquestPrize.razeDucats, 60);
  assert.deepEqual(FACTIONS.kadingir.fullConquestPrize.preserveBuildings.map(x => x.type), ['bank', 'market']);
  assert.equal(FACTIONS.kadingir.fullConquestPrize.razeDucats, 50);
  assert.equal(FACTIONS.mayo.fullConquestPrize.razeDucats, 10);
  assert.equal(FACTIONS.suniksiya.fullConquestPrize.razeDucats, 30);
  assert.equal(FACTIONS.pirates.fullConquestPrize.razeDucats, 20);
}

// Полное подчинение требует, чтобы все исходные острова фракции принадлежали одному игроку,
// и один и тот же итоговый приз нельзя получить второй раз.
{
  const room = { islands: cloneIslands(), players: [{ id: 'p1' }], factionState: {}, round: 3 };
  const p = room.players[0];
  for (const id of ['landin', 'frandia']) room.islands.find(i => i.id === id).ownerId = p.id;
  assert.equal(fullSubjugationController(room, 'lionia'), null);
  room.islands.find(i => i.id === 'eidon').ownerId = p.id;
  assert.equal(fullSubjugationController(room, 'lionia'), p.id);
  const first = claimFullSubjugationPrize(room, p, 'lionia', 'preserve');
  assert.equal(first.triggered, true);
  assert.equal(first.buildings.length, 2);
  assert.equal(room.factionState.lionia.fullConquestClaimed, true);
  assert.equal(claimFullSubjugationPrize(room, p, 'lionia', 'preserve'), null);
}

// Кадингир: при сохранении Банк I карточки острова совпадает с Банком I итогового приза,
// поэтому второй такой банк не создаётся; остаётся разместить только Рынок I.
{
  const room = { islands: cloneIslands(), players: [], factionState: {}, round: 2, legendaryDeck: createLegendaryDeck() };
  const island = room.islands.find(i => i.id === 'kadingir');
  island.army = 0;
  const p = { id: 'p1', row: island.cells[0][0], col: island.cells[0][1], shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, debt: 0, glory: 0, enemyFactionIds: [] };
  room.players.push(p);
  const result = assaultIsland(room, p, island, 'preserve');
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'attacker');
  assert.equal(p.ducats, 30);
  assert.equal(island.buildings.filter(b => b.type === 'bank').length, 1);
  assert.equal(result.statePrize.triggered, true);
  assert.deepEqual(result.statePrize.deduplicatedBuildings.map(b => b.type), ['bank']);
  assert.deepEqual(result.statePrize.buildings.map(b => b.type), ['market']);
  const options = prizeBuildingPlacementOptions(room, p, result.statePrize.buildings[0]);
  assert.equal(options.some(o => o.islandId === 'kadingir'), false);
  const placed = placePrizeBuilding(room, p, 'kadingir', result.statePrize.buildings[0], { factionId: 'kadingir' });
  assert.equal(placed.ok, false);
  assert.equal(island.buildings.filter(b => b.type === 'market').length, 0);
}

// Кадингир: при разорении последнего острова итоговые 50 дукатов являются общей денежной
// добычей финального захвата, а не складываются с 30 дукатами карточки острова.
{
  const room = { islands: cloneIslands(), players: [], factionState: {}, round: 2, legendaryDeck: createLegendaryDeck() };
  const island = room.islands.find(i => i.id === 'kadingir');
  island.army = 0;
  const p = { id: 'p1', row: island.cells[0][0], col: island.cells[0][1], shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, debt: 0, glory: 0, enemyFactionIds: [] };
  room.players.push(p);
  const result = assaultIsland(room, p, island, 'raze');
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'attacker');
  assert.equal(result.statePrize.ducats, 50);
  assert.equal(p.ducats, 50);
}

// Призовая постройка игнорирует обычные требования фермы/форта и положения корабля,
// но всё равно обязана помещаться по площади и пределу ветви.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'market', level: 1 }, { type: 'market', level: 1 }];
  const p = { id: 'p1', row: 0, col: 0 };
  assert.equal(canPlacePrizeBuilding(room, p, island, { type: 'market', level: 1 }).ok, false);
  island.buildings = [];
  assert.equal(canPlacePrizeBuilding(room, p, island, { type: 'bank', level: 1 }).ok, true);
}


// Крепость III превращается в бастион на той же клетке и требует свободное место
// поддержки каменотёсного двора. Бастион даёт канонические +10 защиты.
{
  const room = { islands: cloneIslands(), players: [] };
  const supportIsland = room.islands.find(i => i.id === 'raisk');
  const target = room.islands.find(i => i.id === 'bogamia');
  supportIsland.ownerId = 'p1';
  supportIsland.buildings = [{ type: 'stoneworks', level: 1 }];
  target.ownerId = 'p1';
  target.buildings = [{ type: 'manor', level: 3 }, { type: 'fortress', level: 3, createdAt: 123 }];
  const p = { id: 'p1', row: target.cells[0][0], col: target.cells[0][1], shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 20, inactiveBastionIslandIds: [] };
  room.players.push(p);
  assert.equal(stoneworksSupportCapacity(room, p.id), 1);
  assert.equal(canBuildBastion(room, p, target, 1).ok, true);
  const beforeArea = islandConstraintReport(target).usedArea;
  const built = buildBastion(room, p, target.id, 1);
  assert.equal(built.ok, true);
  assert.equal(p.ducats, 10);
  assert.equal(target.buildings.length, 2);
  assert.equal(target.buildings[1].type, 'bastion');
  assert.equal(target.buildings[1].createdAt, 123);
  assert.equal(islandConstraintReport(target).usedArea, beforeArea);
  assert.deepEqual(supportedBastionIslandIds(room, p.id), [target.id]);
  assert.equal(islandDefenseArmy(room, target).fortifications, 0);
  assert.equal(islandDefenseArmy(room, target).bastions, BUILDINGS.bastion.defense);
  assert.equal(canBuildBastion(room, p, target, 1).ok, false);
}

// После потери поддержки движок не выбирает бастион сам: владелец обязан указать
// временно неактивный. При восстановлении достаточной поддержки бастион включается снова.
{
  const room = { islands: cloneIslands(), players: [] };
  const a = room.islands.find(i => i.id === 'bogamia');
  const b = room.islands.find(i => i.id === 'renaika');
  const support = room.islands.find(i => i.id === 'raisk');
  for (const island of [a, b, support]) island.ownerId = 'p1';
  a.buildings = [{ type: 'farm', level: 1 }, { type: 'bastion', level: 1 }];
  b.buildings = [{ type: 'farm', level: 1 }, { type: 'bastion', level: 1 }];
  support.buildings = [{ type: 'stoneworks', level: 2 }];
  const p = { id: 'p1', row: a.cells[0][0], col: a.cells[0][1], shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, inactiveBastionIslandIds: [] };
  room.players.push(p);
  assert.deepEqual(new Set(supportedBastionIslandIds(room, p.id)), new Set([a.id, b.id]));
  support.buildings[0].level = 1;
  const needs = bastionSupportChoiceNeeds(room, p);
  assert.equal(needs.requiredInactive, 1);
  assert.equal(needs.needsChoice, true);
  assert.deepEqual(supportedBastionIslandIds(room, p.id), []);
  assert.equal(setInactiveBastions(room, p, [b.id]).ok, true);
  assert.deepEqual(supportedBastionIslandIds(room, p.id), [a.id]);
  assert.equal(islandDefenseArmy(room, a).bastions, 10);
  assert.equal(islandDefenseArmy(room, b).bastions, 0);
  support.buildings[0].level = 2;
  assert.deepEqual(new Set(supportedBastionIslandIds(room, p.id)), new Set([a.id, b.id]));
  assert.deepEqual(p.inactiveBastionIslandIds, []);
}

// Понижение бастиона возвращает крепость III, а не оставляет бастион неизменным.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'manor', level: 3 }, { type: 'bastion', level: 1 }];
  const p = { id: 'p1' };
  room.players.push(p);
  const result = applyRaidDowngrade(room, p, island.id, 1);
  assert.equal(result.ok, true);
  assert.equal(result.afterName, 'Крепость III');
  assert.deepEqual([island.buildings[1].type, island.buildings[1].level], ['fortress', 3]);
}

// После превращения базовой добывающей постройки её исходный товар больше не производится.
// Верфь, каменотёсный двор и арсенал используют те же данные уровней, что и остальные ветви.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'maikan');
  island.ownerId = 'p1';
  island.resources = ['Лес', 'Камень', 'Рудная жила'];
  const [row, col] = island.cells[0];
  const p = { id: 'p1', row, col, ducats: 1000 };
  room.players.push(p);
  for (const [baseType, advancedType, goodId] of [
    ['lumbermill', 'shipyard', 'wood'],
    ['quarry', 'stoneworks', 'stone'],
    ['mine', 'arsenal', 'ore'],
  ]) {
    island.buildings = [{ type: 'manor', level: 3 }, { type: baseType, level: 3 }];
    assert.equal(availableGoodsOnIsland(island).includes(goodId), true);
    const result = upgradeBuilding(room, p, island.id, 1);
    assert.equal(result.ok, true);
    assert.equal(result.building.type, advancedType);
    assert.equal(availableGoodsOnIsland(island).includes(goodId), false);
    if (advancedType === 'shipyard') assert.equal(shipyardSlotsForPlayer(room, p.id), BUILDINGS.shipyard.levels[1].escortSlots);
  }
}

// Четыре редких промысла доступны только на I уровне, требуют свой ресурс и ферму/
// поместье, стоят по данным rules/ и не получают выдуманные уровни II–III при открытом R07.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'maikan');
  island.ownerId = 'p1';
  const [row, col] = island.cells[0];
  const p = { id: 'p1', row, col, ducats: 1000 };
  room.players.push(p);
  const rare = [
    ['exotic', 'Экзотические звери'],
    ['slaves', 'Невольники'],
    ['gold', 'Самородное золото'],
    ['diamonds', 'Алмазы'],
  ];
  for (const [type, resource] of rare) {
    island.resources = [resource];
    island.buildings = [{ type: 'farm', level: 1 }];
    const before = p.ducats;
    const built = build(room, p, island.id, type);
    assert.equal(built.ok, true);
    assert.equal(before - p.ducats, BUILDINGS[type].price);
    const index = island.buildings.findIndex(b => b.type === type);
    assert.equal(canUpgradeBuilding(room, p, island, index).ok, false);
    assert.equal(build(room, p, island.id, type).ok, false);
    island.buildings = [{ type: 'farm', level: 1 }];
    island.resources = [];
    assert.equal(build(room, p, island.id, type).ok, false);
  }
}

// Арсенал снаряжает одну роту, которая занимает основной трюм и добавляет войско
// только к штурму. После проигранного штурма рота сбрасывается.
{
  const room = { islands: cloneIslands(), players: [] };
  const home = room.islands.find(i => i.id === 'bogamia');
  home.ownerId = 'p1';
  home.buildings = [{ type: 'arsenal', level: 2 }];
  const p = { id: 'p1', row: home.cells[0][0], col: home.cells[0][1], shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, cargo: null };
  room.players.push(p);
  assert.equal(canFormLandCompany(room, p, home).ok, true);
  assert.equal(formLandCompany(room, p, home.id).company.army, 4);
  assert.equal(landCompanyAssaultArmy(p), 4);
  assert.equal(canLoadCargo(room, p, home, 'provisions', 'main').ok, false);

  const enemy = room.islands.find(i => i.id === 'adia');
  p.row = enemy.cells[0][0]; p.col = enemy.cells[0][1];
  const loss = assaultIsland(room, p, enemy, 'preserve');
  assert.equal(loss.ok, true);
  assert.equal(loss.outcome, 'defender');
  assert.equal(p.landCompany, null);
}

// При победе или ничьей штурма рота сохраняется, а потеря уровня корабля сама по себе
// не меняет заранее зафиксированную силу роты.
{
  const room = { islands: cloneIslands(), players: [] };
  const enemy = room.islands.find(i => i.id === 'agmor');
  const p = { id: 'p1', row: enemy.cells[0][0], col: enemy.cells[0][1], shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, cargo: null, landCompany: { army: 3, arsenalLevel: 1 } };
  room.players.push(p);
  const win = assaultIsland(room, p, enemy, 'preserve');
  assert.equal(win.outcome, 'attacker');
  assert.equal(p.landCompany.army, 3);
}

// Городская стража и постоянный гарнизон покупаются в Цитадели и участвуют в защите.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'raisk');
  island.ownerId = 'p1';
  // Поместье I + ещё четыре непищевых здания = город.
  island.buildings = [
    { type: 'manor', level: 1 }, { type: 'farm', level: 1 }, { type: 'fort', level: 1 },
    { type: 'market', level: 1 }, { type: 'lumbermill', level: 1 }, { type: 'quarry', level: 1 },
  ];
  const p = { id: 'p1', row: 13, col: 13, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 40 };
  room.players.push(p);
  assert.equal(canBuyCityGuard(room, p, island).ok, true);
  assert.equal(buyCityGuard(room, p, island.id).ok, true);
  assert.equal(island.garrisonType, 'guard');
  assert.equal(islandDefenseArmy(room, island).hiredGarrison, 5);

  // Превращаем остров в крупный порт, сохраняя стражу, затем заменяем её гарнизоном.
  island.buildings = [
    { type: 'manor', level: 2 },
    { type: 'shipyard', level: 1 }, { type: 'stoneworks', level: 1 },
    { type: 'arsenal', level: 1 }, { type: 'fortress', level: 1 },
    { type: 'bank', level: 1 }, { type: 'lumbermill', level: 1 },
  ];
  assert.equal(canBuyPermanentGarrison(room, p, island).ok, true);
  assert.equal(buyPermanentGarrison(room, p, island.id).ok, true);
  assert.equal(island.garrisonType, 'permanent');
  assert.equal(islandDefenseArmy(room, island).hiredGarrison, 10);

  // Потеря крупного порта, но сохранение города автоматически переводит гарнизон в стражу.
  island.buildings = [
    { type: 'manor', level: 1 }, { type: 'farm', level: 1 }, { type: 'fort', level: 1 },
    { type: 'market', level: 1 }, { type: 'lumbermill', level: 1 }, { type: 'quarry', level: 1 },
  ];
  assert.equal(islandDefenseArmy(room, island).hiredGarrison, 5);
  assert.equal(island.garrisonType, 'guard');

  // Потеря статуса города распускает стражу.
  island.buildings = [{ type: 'farm', level: 1 }];
  assert.equal(islandDefenseArmy(room, island).hiredGarrison, 0);
  assert.equal(island.garrisonType, null);
}


// Потеря статуса города снижает предел обычной ветви с 2 до 1. Если после понижения
// поместья на острове остаются два рынка, остров требует выбора владельца.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'raisk');
  island.ownerId = 'p1';
  island.buildings = [
    { type: 'manor', level: 1 },
    { type: 'market', level: 1 }, { type: 'market', level: 1 },
    { type: 'fort', level: 1 }, { type: 'lumbermill', level: 1 },
  ];
  const p = { id: 'p1' };
  room.players.push(p);
  assert.equal(islandConstraintReport(island).legal, true);
  assert.equal(islandConstraintReport(island).status, 'Город');
  const downgraded = applyRaidDowngrade(room, p, island.id, 0);
  assert.equal(downgraded.ok, true);
  const report = islandConstraintReport(island);
  assert.equal(report.status, 'Поселение');
  assert.equal(report.legal, false);
  assert.equal(report.branchViolations.some(v => v.branch === 'money' && v.count === 2 && v.limit === 1), true);
  assert.equal(islandCorrectionOptions(island).length, 5);
  const marketIndex = island.buildings.findIndex(b => b.type === 'market');
  const fixed = removeIslandBuildingForCorrection(room, p, island.id, marketIndex);
  assert.equal(fixed.ok, true);
  assert.equal(fixed.after.legal, true);
}

// Потеря крупного порта может убрать +2 площади. Если после понижения поместья остров
// становится городом и здания уже не помещаются, отчёт требует освободить площадь.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'maikan'); // базовая площадь 8
  island.ownerId = 'p1';
  island.buildings = [
    { type: 'manor', level: 2 },
    { type: 'shipyard', level: 1 }, { type: 'lumbermill', level: 1 },
    { type: 'stoneworks', level: 1 }, { type: 'quarry', level: 1 },
    { type: 'arsenal', level: 1 }, { type: 'mine', level: 1 },
    { type: 'fortress', level: 1 }, { type: 'fort', level: 1 },
    { type: 'market', level: 1 },
  ];
  const p = { id: 'p1' };
  room.players.push(p);
  const before = islandConstraintReport(island);
  assert.equal(before.status, 'Крупный порт');
  assert.equal(before.usedArea, 10);
  assert.equal(before.effectiveArea, 10);
  assert.equal(before.legal, true);
  const downgraded = applyRaidDowngrade(room, p, island.id, 0);
  assert.equal(downgraded.ok, true);
  const after = islandConstraintReport(island);
  assert.equal(after.status, 'Город');
  assert.equal(after.usedArea, 10);
  assert.equal(after.effectiveArea, 9);
  assert.equal(after.overArea, 1);
  assert.equal(after.legal, false);
}

// При обязательном удалении статус и гарнизон пересчитываются сразу: если остров
// перестаёт быть городом, городская стража распускается без компенсации.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'raisk');
  island.ownerId = 'p1';
  island.garrisonType = 'guard';
  island.buildings = [
    { type: 'manor', level: 1 },
    { type: 'market', level: 1 }, { type: 'market', level: 1 },
    { type: 'fort', level: 1 }, { type: 'lumbermill', level: 1 },
  ];
  const p = { id: 'p1' };
  room.players.push(p);
  applyRaidDowngrade(room, p, island.id, 0); // город -> поселение, 2 рынка при лимите 1
  const result = removeIslandBuildingForCorrection(room, p, island.id, island.buildings.findIndex(b => b.type === 'market'));
  assert.equal(result.ok, true);
  assert.equal(result.garrisonChanged, true);
  assert.equal(result.newGarrison, null);
  assert.equal(island.garrisonType, null);
}


// Исходный гарнизон действует только пока остров не принадлежит игроку;
// после получения острова он равен нулю и возвращается вместе с исходным владельцем.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'asigoriy');
  assert.equal(island.area, 4);
  assert.deepEqual(island.resourceIds, ['ore']);
  assert.equal(islandDefenseArmy(room, island).garrison, 10);
  const p = { id: 'p1', row: 0, col: 0, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [] };
  room.players.push(p);
  island.ownerId = p.id;
  assert.equal(islandDefenseArmy(room, island).garrison, 0);
  island.ownerId = null;
  assert.equal(islandDefenseArmy(room, island).garrison, 10);
}

// Бастион уже в модели состояния считается продвинутой формой ветви укреплений
// для статуса крупного порта; строительство бастиона остаётся блоком 4.3.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'maikan');
  island.ownerId = 'p1';
  island.buildings = [
    { type: 'manor', level: 2 },
    { type: 'bastion', level: 1 },
    { type: 'shipyard', level: 1 }, { type: 'lumbermill', level: 1 },
    { type: 'quarry', level: 1 }, { type: 'mine', level: 1 }, { type: 'market', level: 1 },
  ];
  const report = islandConstraintReport(island);
  assert.equal(report.status, 'Крупный порт');
  assert.equal(report.usedArea, 7);
  assert.equal(report.effectiveArea, 10);
  assert.equal(report.legal, true);
}


// После снижения уровня владелец сам выбирает, какое лишнее улучшение временно
// отключить. Выбор влияет на характеристики, но само улучшение остаётся установленным.
{
  const room = { islands: cloneIslands(), players: [] };
  const p = {
    id: 'p1', row: 13, col: 13, shipClass: 'frigate', level: 4, ducats: 0,
    upgrades: ['falcons', 'culverins', 'musketeers', 'pikemen'], disabledUpgradeIds: [],
    escorts: [], levelInactiveEscortIds: [], cargo: null,
  };
  room.players.push(p);
  const loss = loseShipLevel(room, p);
  assert.equal(loss.after, 3);
  const needs = fleetAdjustmentNeeds(p);
  assert.equal(needs.upgradeCount, 1);
  assert.equal(needs.upgradeChoiceNeeded, true);
  const chosen = setDisabledUpgrades(p, ['culverins']);
  assert.equal(chosen.ok, true);
  assert.deepEqual(p.disabledUpgradeIds, ['culverins']);
  assert.equal(shipUpgradeStatuses(p).find(u => u.id === 'culverins').active, false);
  assert.equal(shipUpgradeStatuses(p).find(u => u.id === 'falcons').active, true);
  assert.equal(shipStats(p).artillery, 8); // 5 базовых +2 уровень III +1 Фальконы
}

// Если отключены грузовые улучшения, излишек основного груза сбрасывается только
// после окончательного выбора владельца.
{
  const room = { islands: cloneIslands(), players: [] };
  const p = {
    id: 'p1', row: 13, col: 13, shipClass: 'carrack', level: 3, ducats: 0,
    upgrades: ['orlop', 'sternStores', 'falcons'], disabledUpgradeIds: [],
    escorts: [], levelInactiveEscortIds: [], cargo: { goodId: 'wood', quantity: 10 },
  };
  room.players.push(p);
  const loss = loseShipLevel(room, p);
  assert.equal(loss.after, 2);
  assert.equal(loss.cargoDiscarded, 0);
  assert.equal(p.cargo.quantity, 10);
  const chosen = setDisabledUpgrades(p, ['sternStores']);
  assert.equal(chosen.ok, true);
  assert.equal(shipStats(p).cargo, 7); // каракка 5 + бонус II уровня 1 + орлоп 1
  assert.equal(chosen.cargoDiscarded, 3);
  assert.equal(p.cargo.quantity, 7);
}

// При снижении уровня лишнее сопровождение не уничтожается: владелец выбирает
// временно неактивное судно, а груз на нём сохраняется.
{
  const room = { islands: cloneIslands(), players: [] };
  const yard = room.islands.find(i => i.id === 'raisk');
  yard.ownerId = 'p1';
  yard.buildings = [{ type: 'shipyard', level: 3 }];
  const p = {
    id: 'p1', row: 13, col: 13, shipClass: 'frigate', level: 5, ducats: 0,
    upgrades: [], disabledUpgradeIds: [], levelInactiveEscortIds: [],
    escorts: [
      { id: 'e1', type: 'cargo', special: false, cargo: { goodId: 'ore', quantity: 5 } },
      { id: 'e2', type: 'combat', special: false, cargo: null },
      { id: 'e3', type: 'combat', special: false, cargo: null },
    ],
  };
  room.players.push(p);
  loseShipLevel(room, p); // V -> IV, лимит сопровождения 3 -> 2
  const needs = fleetAdjustmentNeeds(p);
  assert.equal(needs.escortCount, 1);
  assert.equal(needs.escortChoiceNeeded, true);
  const chosen = setLevelInactiveEscorts(p, ['e1']);
  assert.equal(chosen.ok, true);
  const statuses = escortStatuses(room, p);
  assert.equal(statuses.find(e => e.id === 'e1').active, false);
  assert.equal(statuses.find(e => e.id === 'e1').inactiveReason, 'level');
  assert.equal(p.escorts.find(e => e.id === 'e1').cargo.quantity, 5);
  assert.equal(statuses.filter(e => e.active).length, 2);
}

// После восстановления нужного уровня лишняя отметка отключения снимается
// автоматически, и сопровождение снова действует.
{
  const room = { islands: cloneIslands(), players: [] };
  const yard = room.islands.find(i => i.id === 'raisk');
  yard.ownerId = 'p1';
  yard.buildings = [{ type: 'shipyard', level: 3 }];
  const p = {
    id: 'p1', row: 13, col: 13, shipClass: 'frigate', level: 4, ducats: 100,
    upgrades: [], disabledUpgradeIds: [], levelInactiveEscortIds: ['e3'],
    escorts: [
      { id: 'e1', type: 'cargo', special: false, cargo: null },
      { id: 'e2', type: 'combat', special: false, cargo: null },
      { id: 'e3', type: 'combat', special: false, cargo: null },
    ],
  };
  room.players.push(p);
  assert.equal(escortStatuses(room, p).filter(e => e.active).length, 2);
  const raised = buyShipLevel(p);
  assert.equal(raised.ok, true);
  assert.equal(p.level, 5);
  assert.deepEqual(p.levelInactiveEscortIds, []);
  assert.equal(escortStatuses(room, p).filter(e => e.active).length, 3);
}

// Обязательная потеря первого улучшения ветви оставляет второе установленным,
// но его бонус не действует до восстановления первого.
{
  const p = {
    id: 'p1', row: 13, col: 13, shipClass: 'frigate', level: 2, ducats: 0,
    upgrades: ['falcons', 'culverins'], disabledUpgradeIds: [], escorts: [], levelInactiveEscortIds: [], cargo: null,
  };
  const removed = applyBoardingLoss(p, 'falcons');
  assert.equal(removed.ok, true);
  assert.deepEqual(p.upgrades, ['culverins']);
  assert.equal(shipUpgradeStatuses(p)[0].missingRequirement, true);
  assert.equal(shipStats(p).artillery, 6); // базовые 5 + бонус II уровня 1, без кулеврин
}

// Этап 3.2: обычные ветви требуют первую ступень, а навигационные
// улучшения являются отдельными одноуровневыми ветвями.
{
  const p = { row: 13, col: 13, shipClass: 'carrack', level: 6, ducats: 100, upgrades: [], escorts: [] };
  assert.equal(buyShipUpgrade(p, 'culverins').ok, false);
  assert.equal(buyShipUpgrade(p, 'falcons').ok, true);
  assert.equal(buyShipUpgrade(p, 'culverins').ok, true);
  assert.equal(buyShipUpgrade(p, 'falcons').ok, false);
  assert.equal(buyShipUpgrade(p, 'leadLine').ok, true);
  assert.equal(buyShipUpgrade(p, 'reefPilot').ok, true);
  assert.equal(buyShipUpgrade(p, 'portageSleds').ok, true);
  assert.deepEqual(p.upgrades, ['falcons', 'culverins', 'leadLine', 'reefPilot', 'portageSleds']);
}

// Класс не может покупать или бесплатно устанавливать навигационное улучшение,
// которое дублирует его врождённую проходимость.
{
  const pairs = [
    ['brigantine', 'leadLine'],
    ['frigate', 'reefPilot'],
    ['carrack', 'iceStem'],
    ['caravel', 'portageSleds'],
  ];
  for (const [shipClass, upgradeId] of pairs) {
    const buyer = { row: 13, col: 13, shipClass, level: 6, ducats: 100, upgrades: [], escorts: [] };
    assert.equal(buyShipUpgrade(buyer, upgradeId).ok, false, `${shipClass} / ${upgradeId}`);
    assert.equal(installShipUpgradeFree({ ...buyer, upgrades: [] }, upgradeId).ok, false, `free ${shipClass} / ${upgradeId}`);
  }
}

// После потери места выбранное улучшение остаётся установленным, но не действует;
// при восстановлении уровня оно автоматически снова становится активным.
{
  const room = { islands: cloneIslands(), players: [] };
  const p = {
    id: 'stage-3-2', row: 13, col: 13, shipClass: 'carrack', level: 2, ducats: 100,
    upgrades: ['falcons', 'leadLine'], disabledUpgradeIds: [], escorts: [], levelInactiveEscortIds: [], cargo: null,
  };
  room.players.push(p);
  const loss = loseShipLevel(room, p);
  assert.equal(loss.after, 1);
  assert.equal(setDisabledUpgrades(p, ['leadLine']).ok, true);
  assert.equal(shipUpgradeStatuses(p).find(u => u.id === 'leadLine').active, false);
  assert.deepEqual(p.upgrades, ['falcons', 'leadLine']);
  assert.equal(buyShipLevel(p).ok, true);
  assert.deepEqual(p.disabledUpgradeIds, []);
  assert.equal(shipUpgradeStatuses(p).find(u => u.id === 'leadLine').active, true);
}

// Этап 3.4: каноническое сопровождение состоит только из грузовых и боевых судов,
// использует цены 10/15/20, предел уровня 1/1/2/2/3/3 и общий максимум три.
{
  const room = { islands: cloneIslands() };
  const yard = room.islands.find(i => i.id === 'raisk');
  yard.ownerId = 'p1';
  yard.buildings = [{ type: 'shipyard', level: 3 }];
  const p = {
    id: 'p1', row: 13, col: 13, shipClass: 'frigate', level: 5, ducats: 100,
    upgrades: [], escorts: [], levelInactiveEscortIds: [],
  };
  assert.equal(shipyardSlotsForPlayer(room, p.id), 3);
  assert.deepEqual([1,2,3,4,5,6].map(level => escortUseLimit({ level })), [1,1,2,2,3,3]);
  assert.equal(escortPurchasePrice(p), BALANCE.escortPrices[0]);
  const first = buyEscort(room, p, 'cargo');
  assert.equal(first.ok, true);
  assert.equal(first.price, BALANCE.escortPrices[0]);
  assert.equal(ESCORTS[first.escort.type].cargo, 5);
  assert.equal(escortPurchasePrice(p), BALANCE.escortPrices[1]);
  const second = buyEscort(room, p, 'combat');
  assert.equal(second.ok, true);
  assert.equal(second.price, BALANCE.escortPrices[1]);
  assert.equal(ESCORTS[second.escort.type].artillery, 5);
  assert.equal(escortPurchasePrice(p), BALANCE.escortPrices[2]);
  const third = buyEscort(room, p, 'cargo');
  assert.equal(third.ok, true);
  assert.equal(third.price, BALANCE.escortPrices[2]);
  assert.equal(p.escorts.length, 3);
  assert.equal(escortPurchasePrice(p), null);
  assert.equal(buyEscort(room, p, 'combat').ok, false);
}

// Места нескольких собственных верфей складываются; без свободного места новое
// сопровождение купить нельзя даже при достаточном уровне и количестве дукатов.
{
  const room = { islands: cloneIslands() };
  const a = room.islands.find(i => i.id === 'raisk');
  const b = room.islands.find(i => i.id === 'bogamia');
  a.ownerId = b.ownerId = 'p1';
  a.buildings = [{ type: 'shipyard', level: 1 }];
  b.buildings = [{ type: 'shipyard', level: 2 }];
  const p = { id: 'p1', row: 13, col: 13, shipClass: 'frigate', level: 6, ducats: 100, upgrades: [], escorts: [] };
  assert.equal(shipyardSlotsForPlayer(room, p.id), 3);
  assert.equal(buyEscort(room, p, 'cargo').ok, true);
  assert.equal(buyEscort(room, p, 'combat').ok, true);
  assert.equal(buyEscort(room, p, 'cargo').ok, true);

  b.ownerId = 'other';
  assert.equal(shipyardSlotsForPlayer(room, p.id), 1);
  assert.equal(ordinaryEscortExcess(room, p), 2);
}

// При потере места верфи владелец выбирает конкретные лишние обычные суда:
// они удаляются, а находившийся на них груз теряется.
{
  const room = { islands: cloneIslands() };
  const yard = room.islands.find(i => i.id === 'kisalinia');
  yard.ownerId = 'p1';
  yard.buildings = [{ type: 'shipyard', level: 2 }];
  const p = {
    id: 'p1', shipClass: 'frigate', level: 6, upgrades: [], levelInactiveEscortIds: [],
    escorts: [
      { id: 'e1', type: 'cargo', special: false, cargo: { goodId: 'ore', quantity: 5 } },
      { id: 'e2', type: 'combat', special: false, cargo: null },
      { id: 'e3', type: 'cargo', special: false, cargo: { goodId: 'wood', quantity: 5 } },
    ],
  };
  assert.equal(ordinaryEscortExcess(room, p), 1);
  assert.equal(removeEscortsForShipyard(room, p, []).ok, false);
  const removed = removeEscortsForShipyard(room, p, ['e3']);
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.removed[0].cargoDiscarded, { goodId: 'wood', quantity: 5 });
  assert.equal(p.escorts.some(e => e.id === 'e3'), false);
  assert.equal(ordinaryEscortExcess(room, p), 0);
}

// Потеря уровня не удаляет лишнее сопровождение: выбранное судно становится
// неактивным, сохраняет груз, не даёт артиллерию и не может продавать груз.
{
  const room = { islands: cloneIslands(), players: [] };
  const yard = room.islands.find(i => i.id === 'raisk');
  yard.ownerId = 'p1';
  yard.buildings = [{ type: 'shipyard', level: 3 }];
  const p = {
    id: 'p1', row: 13, col: 13, shipClass: 'frigate', level: 5, ducats: 0,
    upgrades: [], disabledUpgradeIds: [], levelInactiveEscortIds: [],
    cargo: null,
    escorts: [
      { id: 'e1', type: 'combat', special: false, cargo: null },
      { id: 'e2', type: 'combat', special: false, cargo: null },
      { id: 'e3', type: 'cargo', special: false, cargo: { goodId: 'ore', quantity: 5 } },
    ],
  };
  room.players.push(p);
  loseShipLevel(room, p);
  assert.equal(p.escorts.length, 3);

  assert.equal(setLevelInactiveEscorts(p, ['e3']).ok, true);
  assert.equal(escortStatuses(room, p).find(e => e.id === 'e3').active, false);
  assert.equal(p.escorts.find(e => e.id === 'e3').cargo.quantity, 5);
  assert.equal(sellCargo(room, p, 'e3').ok, false);
  assert.equal(p.escorts.find(e => e.id === 'e3').cargo.quantity, 5);

  assert.equal(setLevelInactiveEscorts(p, ['e1']).ok, true);
  assert.equal(escortStatuses(room, p).find(e => e.id === 'e1').active, false);
  assert.equal(fleetArtillery(room, p), shipStats(p).artillery + ESCORTS.combat.artillery);
}

// Ландин отсутствует в каноническом каталоге правил и не продаётся; его retired-проекция
// остаётся читаемой только для старых сохранений.
{
  assert.equal(ESCORTS.landin.retired, true);
  const room = { islands: cloneIslands() };
  const p = { id: 'legacy', row: 13, col: 13, shipClass: 'frigate', level: 6, ducats: 100, upgrades: [], escorts: [] };
  assert.equal(buyEscort(room, p, 'landin').ok, false);

  const old = {
    id: 'legacy', row: 13, col: 13, shipClass: 'frigate', level: 6, upgrades: [],
    levelInactiveEscortIds: [],
    escorts: [{ id: 'old-landin', type: 'landin', special: true, cargo: { goodId: 'ore', quantity: 5 } }],
  };
  assert.equal(fleetArtillery(room, old), shipStats(old).artillery + ESCORTS.landin.artillery);
  assert.equal(old.escorts[0].cargo.quantity, 5);
}

// Этап 3.5: все переходы VI→V→IV→III→II→I теряют ровно один уровень,
// а обязательная потеря на I возвращает на общую стартовую клетку.
{
  const room = { islands: cloneIslands(), players: [] };
  for (let level = 6; level >= 2; level--) {
    const p = {
      id: `loss-${level}`, row: 9, col: 9, shipClass: 'brigantine', level,
      ducats: 0, upgrades: [], disabledUpgradeIds: [], escorts: [], levelInactiveEscortIds: [], cargo: null,
    };
    const before = shipStats(p);
    const result = loseShipLevel(room, p);
    assert.equal(result.before, level);
    assert.equal(result.after, level - 1);
    assert.equal(result.returnedToStart, false);
    assert.equal(p.level, level - 1);
    assert.equal(shipStats(p).artillery, before.artillery - 1);
  }

  const first = {
    id: 'loss-I', row: 9, col: 9, shipClass: 'brigantine', level: 1,
    ducats: 0, upgrades: [], disabledUpgradeIds: [], escorts: [], levelInactiveEscortIds: [], cargo: null,
  };
  const returned = loseShipLevel(room, first);
  assert.equal(returned.returnedToStart, true);
  assert.equal(first.level, 1);
  assert.deepEqual([first.row, first.col], MAP_META.startCell);
}

// Если при потере уровня выбора улучшений не требуется, основной трюм сразу
// сокращается до новой вместимости. Сбрасывается только излишек.
{
  const room = { islands: cloneIslands(), players: [] };
  const p = {
    id: 'cargo-loss', row: 7, col: 7, shipClass: 'carrack', level: 2,
    ducats: 0, upgrades: [], disabledUpgradeIds: [], escorts: [], levelInactiveEscortIds: [],
    cargo: { goodId: 'wood', quantity: 6 },
  };
  const loss = loseShipLevel(room, p);
  assert.equal(loss.after, 1);
  assert.equal(loss.cargoDiscarded, 1);
  assert.equal(shipCargoCapacity(p), 5);
  assert.equal(p.cargo.quantity, 5);
}

// Полная матрица врождённой проходимости и соответствующих навигационных улучшений.
// Неподходящий класс без нужной возможности препятствие не проходит.
{
  const cases = [
    { passability: 'reef', nativeClass: 'frigate', upgrade: 'reefPilot', from: [6,6], to: [6,7], distance: 1 },
    { passability: 'shoal', nativeClass: 'brigantine', upgrade: 'leadLine', from: [5,18], to: [4,18], distance: 1 },
    { passability: 'ice', nativeClass: 'carrack', upgrade: 'iceStem', from: [22,1], to: [23,1], distance: 1 },
    { passability: 'land1', nativeClass: 'caravel', upgrade: 'portageSleds', from: [5,4], to: [5,6], distance: 2 },
  ];
  const classes = ['brigantine','frigate','caravel','carrack'];
  for (const item of cases) {
    for (const shipClass of classes) {
      const plain = { row: item.from[0], col: item.from[1], shipClass, level: 2, upgrades: [] };
      assert.equal(
        has(reachableCells(plain, item.distance), item.to[0], item.to[1]),
        shipClass === item.nativeClass,
        `${shipClass} / ${item.passability}`
      );
      if (shipClass !== item.nativeClass) {
        const improved = { ...plain, upgrades: [item.upgrade] };
        assert.equal(has(reachableCells(improved, item.distance), item.to[0], item.to[1]), true, `${shipClass} + ${item.upgrade}`);
      }
    }
  }
}

// Берег остаётся допустимой конечной клеткой для обычного корабля, но без
// land1 сквозное прохождение через сухопутную клетку запрещено.
{
  const frigate = { row: 5, col: 4, shipClass: 'frigate', level: 1, upgrades: [] };
  assert.equal(has(reachableCells(frigate, 1), 5, 5), true);
  assert.equal(has(reachableCells(frigate, 2), 5, 6), false);
  const withSleds = { ...frigate, level: 2, upgrades: ['portageSleds'] };
  assert.equal(has(reachableCells(withSleds, 2), 5, 6), true);
}

console.log('game-logic tests: OK');
