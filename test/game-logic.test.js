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
  applySeaVeilHostileReactionToShip,
  applySeaVeilHostileReactionToIsland,
  clearSeaVeilHostileReactionsAtTurnEnd,
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
  seaAttackPositionAllowed,
  attackCountThisRound,
  attackTargetsThisRound,
  canAttackPlayerThisRound,
  registerPlayerAttack,
  fleetArtillery,
  islandDefenseArmy,
  loseShipLevel,
  battleLevelLoss,
  awardFleetVictoryPoints,
  armyCapturePoints,
  awardArmyVictoryPoints,
  capturedBuildingRetentionOptions,
  removeCapturedBuildingForRetention,
  finalizeCapturedBuildingRetention,
  seaBattle,
  assaultIsland,
  areAllies,
  addAlliance,
  removeAlliance,
  jointSeaBattle,
  jointAssaultIsland,
  anchorAt,
  createAnchorDecks,
  drawAnchorCard,
  resolveAnchorEncounter,
  creditDucats,
  createSailingEventDeck,
  drawSailingEventCard,
  drawTreasureCard,
  createExpeditionDeck,
  drawLegendaryCard,
  discardDeckCard,
  emptyCargoHolds,
  fillCargoDirect,
  resolveMoneyTreasure,
  installShipUpgradeFree,
  buildFree,
  raidBuildingOptions,
  applyRaidDowngrade,
  applyFeudBuildingDowngrade,
  boardingUpgradeOptions,
  applyBoardingLoss,
  stormCellOptions,
  createFeudDecks,
  factionIdForIsland,
  stateExists,
  refreshFactionExistence,
  stateOwnedIslandIds,
  resolveStateMilitaryCapture,
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
  canDismissLandCompany,
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
  normalizeAssignmentCompatibility,
  normalizeStage6Compatibility,
  issueAssignment,
  offerAssignmentCards,
  chooseAssignmentOffer,
  assignmentEventMatches,
  assignmentRequiredAction,
  noteMoriAssignmentDeparture,
  advanceMoriAssignmentNavigation,
  completeAssignment,
  settleVassalTax,
  legendaryPlaceAt,
  legendaryPlaceRule,
  legendaryPlaceForIsland,
  claimLegendaryPlaceDiscovery,
  canTakeExpedition,
  takeExpedition,
  completeExpeditionAtArrival,
  playerAtExpeditionPlace,
} = require('../game-logic');
const { BALANCE, MAP_META, ASSIGNMENT_CARDS, FACTIONS, ESCORTS, HAZARDS, ISLAND_DEFS, BUILDINGS, CHARACTERS, ANCHORS, LEGENDARY_PLACES, LEGENDARY_CARDS, SAILING_EVENT_CARDS } = require('../game-data');

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
  assert.equal(consumeCharacter(p1, 'firstMate', room.round).ok, true);
  assert.equal(p1.character.id, 'firstMate');
  assert.equal(p1.characterUsedRound, room.round);
  assert.equal(consumeCharacter(p1, 'firstMate', room.round).ok, false);
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

// Одна погрузка заполняет основной и все активные свободные грузовые трюмы,
// а одна продажа в Цитадели продаёт весь груз флотилии.
{
  const room = { islands: cloneIslands(), round: 2 };
  const source = room.islands.find(i => i.id === 'bogamia');
  source.ownerId = 'p1';
  source.buildings.push({ type: 'farm', level: 1 });
  const p = {
    id: 'p1', row: 5, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], cargo: null, ducats: 0,
    escorts: [{ id: 'escort-1', type: 'cargo', special: false, cargo: null }],
  };
  const loaded = loadCargo(room, p, 'bogamia', 'provisions');
  assert.equal(loaded.ok, true);
  assert.equal(loaded.quantity, 7);
  assert.equal(p.cargo.quantity, 2);
  assert.equal(p.escorts[0].cargo.quantity, 5);
  p.row = 13; p.col = 13;
  const sold = sellCargo(room, p);
  assert.equal(sold.ok, true);
  assert.equal(sold.revenue, 7);
  assert.equal(p.ducats, 7);
  assert.equal(p.cargo, null);
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

  // Смена владельца не снимает общую отметку погрузки текущего раунда.
  island.ownerId = 'p2';
  const q = { id: 'p2', row: 5, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], cargo: null, ducats: 0 };
  assert.equal(canLoadCargo(room, q, island, 'provisions').ok, false);

  room.round = 4;
  assert.equal(canLoadCargo(room, q, island, 'provisions').ok, true);
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


// Зона мира включает только клетки с территорией Цитадели; соседнее море не защищено.
{
  assert.equal(isCitadelPeaceCell(13, 13), true);
  assert.equal(isCitadelPeaceCell(12, 13), false);
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
  assert.equal(a.fleetPoints, 2);
  assert.deepEqual(result.fleetPointAwards, [{ playerId: 'a', opponentId: 'b', points: 2 }]);
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
  assert.equal(b.fleetPoints, 2);
}

// Каноническая ничья морского боя не меняет уровни, дукаты, груз и не даёт пропуска хода.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const a = { id: 'a', row: 10, col: 10, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 5, cargo: { goodId: 'wood', quantity: 2 } };
  const b = { id: 'b', row: 10, col: 10, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 5, cargo: { goodId: 'stone', quantity: 2 } };
  room.players = [a, b];
  const result = seaBattle(room, a, b);
  assert.equal(result.outcome, 'tie');
  assert.equal(a.skipTurns || 0, 0);
  assert.equal(b.skipTurns || 0, 0);
  assert.equal(a.level, 1);
  assert.equal(b.level, 1);
  assert.equal(a.ducats, 5);
  assert.equal(b.ducats, 5);
  assert.deepEqual(a.cargo, { goodId: 'wood', quantity: 2 });
  assert.deepEqual(b.cargo, { goodId: 'stone', quantity: 2 });
  assert.equal(a.fleetPoints || 0, 0);
  assert.equal(b.fleetPoints || 0, 0);
}

// В первом раунде PvP запрещён. Со второго раунда морская атака разрешена
// с клетки цели или одной из восьми соседних, но только один раз на этого игрока за общий раунд.
{
  const room = { round: 1, islands: cloneIslands(), players: [] };
  const a = { id: 'a', row: 9, col: 9, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 5 };
  const b = { id: 'b', row: 10, col: 10, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 5 };
  room.players = [a, b];
  assert.equal(seaAttackPositionAllowed(a, b), true);
  assert.equal(seaBattle(room, a, b).ok, false);

  room.round = 2;
  assert.equal(seaBattle(room, a, b).ok, true);
  assert.equal(attackCountThisRound(room, a, b.id), 1);
  assert.deepEqual(attackTargetsThisRound(room, a), ['b']);
  a.row = 9; a.col = 9; b.row = 10; b.col = 10;
  assert.equal(seaBattle(room, a, b).ok, false);

  room.round = 3;
  assert.equal(attackCountThisRound(room, a, b.id), 0);
  assert.deepEqual(attackTargetsThisRound(room, a), []);
  assert.equal(canAttackPlayerThisRound(room, a, b.id).ok, true);
}

// Корабельный плотник предотвращает одну боевую потерю уровня за раунд и остаётся
// на корабле, помечаясь characterUsedRound. Без явного применения уровень теряется обычно.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const a = { id: 'a', row: 10, col: 10, shipClass: 'brigantine', level: 2, upgrades: [], escorts: [], ducats: 5, character: { id: 'shipCarpenter' } };
  const b = { id: 'b', row: 10, col: 10, shipClass: 'frigate', level: 2, upgrades: [], escorts: [], ducats: 5 };
  room.players = [a, b];
  const result = seaBattle(room, a, b, { shipCarpenterPlayerIds: ['a'] });
  assert.equal(result.outcome, 'defender');
  assert.equal(a.level, 2);
  assert.equal(a.character.id, 'shipCarpenter');
  assert.equal(a.characterUsedRound, room.round);
  assert.equal(result.levelLoss.prevented, true);
  assert.equal(result.levelLoss.preventedByCharacter, 'shipCarpenter');
}

// Плотник работает и при проигранном штурме, но предотвращает только потерю уровня:
// рота ландскнехтов всё равно погибает по правилу неудачного штурма.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'adia');
  const a = {
    id: 'a', row: island.cells[0][0], col: island.cells[0][1],
    shipClass: 'brigantine', level: 2, upgrades: [], escorts: [], ducats: 0,
    character: { id: 'shipCarpenter' }, landCompany: { army: 3, arsenalLevel: 1 },
  };
  room.players = [a];
  const result = assaultIsland(room, a, island, { shipCarpenterPlayerIds: ['a'] });
  assert.equal(result.outcome, 'defender');
  assert.equal(a.level, 2);
  assert.equal(a.character.id, 'shipCarpenter');
  assert.equal(a.characterUsedRound, room.round);
  assert.equal(a.landCompany, null);
  assert.equal(result.levelLoss.prevented, true);
}

// Ограничение очков флота хранится отдельно от дукатов/старого счётчика славы:
// против одного и того же соперника в одном раунде повторного начисления нет.
{
  const room = { round: 4 };
  const p = { id: 'p', fleetPoints: 0, glory: 7 };
  assert.deepEqual(awardFleetVictoryPoints(room, [p], 'q', 2), [{ playerId: 'p', opponentId: 'q', points: 2 }]);
  assert.deepEqual(awardFleetVictoryPoints(room, [p], 'q', 2), []);
  assert.equal(p.fleetPoints, 2);
  assert.equal(p.glory, 7);
  room.round = 5;
  assert.deepEqual(awardFleetVictoryPoints(room, [p], 'q', 2), [{ playerId: 'p', opponentId: 'q', points: 2 }]);
  assert.equal(p.fleetPoints, 4);
}

// Очки армии не смешиваются со славой и ограничиваются одним результатом против соперника за раунд.
{
  assert.deepEqual([0,1,4,5,8,9,12,13,16,17].map(armyCapturePoints), [0,1,1,2,2,3,3,4,4,5]);
  const room = { round: 4 };
  const p = { id: 'p', armyPoints: 0, glory: 9 };
  assert.deepEqual(awardArmyVictoryPoints(room, [p], 'q', 3), [{ playerId: 'p', opponentId: 'q', points: 3 }]);
  assert.deepEqual(awardArmyVictoryPoints(room, [p], 'q', 3), []);
  assert.deepEqual(awardArmyVictoryPoints(room, [p], null, 2), [{ playerId: 'p', opponentId: null, points: 2 }]);
  room.round = 5;
  assert.deepEqual(awardArmyVictoryPoints(room, [p], 'q', 3), [{ playerId: 'p', opponentId: 'q', points: 3 }]);
  assert.equal(p.armyPoints, 8);
  assert.equal(p.glory, 9);
}

// Успешная защита острова игрока даёт владельцу 3 очка армии.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'b';
  island.buildings = [{ type: 'fort', level: 1 }];
  const a = { id: 'a', row: 5, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, armyPoints: 0 };
  const b = { id: 'b', row: 1, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, armyPoints: 0 };
  room.players = [a, b];
  const result = assaultIsland(room, a, island);
  assert.equal(result.outcome, 'defender');
  assert.equal(b.armyPoints, 3);
  assert.deepEqual(result.armyPointAwards, [{ playerId: 'b', opponentId: 'a', points: 3 }]);
}

// Штурм независимого Агмора: защита 3 даёт 1 очко армии по канонической шкале.
{
  const room = { round: 1, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'agmor');
  const a = { id: 'a', row: 13, col: 7, shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, glory: 0, armyPoints: 0 };
  room.players = [a];
  assert.equal(islandDefenseArmy(room, island).total, 3);
  const result = assaultIsland(room, a, island);
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'attacker');
  assert.equal(island.ownerId, 'a');
  assert.equal(a.ducats, 5);
  assert.equal(a.glory, 0);
  assert.equal(a.armyPoints, 1);
  assert.deepEqual(result.armyPointAwards, [{ playerId: 'a', opponentId: null, points: 1 }]);
}

// Повторный военный захват уже покорённого ранее острова не приносит новые очки армии.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'b';
  island.firstMilitaryConquered = true;
  island.buildings = [{ type: 'fort', level: 1 }];
  const a = { id: 'a', row: 5, col: 1, shipClass: 'caravel', level: 2, upgrades: [], escorts: [], ducats: 0, armyPoints: 0 };
  const b = { id: 'b', row: 1, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, armyPoints: 0 };
  room.players = [a, b];
  const result = assaultIsland(room, a, island);
  assert.equal(result.outcome, 'attacker');
  assert.deepEqual(result.armyPointAwards, []);
  assert.equal(a.armyPoints, 0);
}

// После захвата сохраняется половина существовавшей инфраструктуры; новый владелец выбирает потери.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'b';
  island.buildings = [{ type: 'farm', level: 1 }, { type: 'fort', level: 1 }];
  const a = { id: 'a', row: 5, col: 1, shipClass: 'caravel', level: 7, upgrades: ['musketeers', 'pikemen'], escorts: [], ducats: 0, glory: 0, armyPoints: 0 };
  const b = { id: 'b', row: 1, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, armyPoints: 0 };
  room.players = [a, b];
  const result = assaultIsland(room, a, island);
  assert.equal(result.outcome, 'attacker');
  assert.deepEqual(result.captureRetention, { ratio: 0.5, initialCount: 2, keepCount: 1, removeCount: 1 });
  assert.equal(capturedBuildingRetentionOptions(island).length, 2);
  assert.equal(removeCapturedBuildingForRetention(room, a, island.id, 1).ok, true);
  finalizeCapturedBuildingRetention(island);
  assert.deepEqual(island.buildings.map(b => [b.type, b.level]), [['farm', 1]]);
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

// Прежней механики «третьей атаки за десять личных ходов» больше нет:
 // атака разрешается заново в новом общем раунде и не понижает постройки атакующего.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'kisalinia');
  island.ownerId = 'a';
  island.buildings = [{ type: 'farm', level: 3 }, { type: 'shipyard', level: 2 }, { type: 'fort', level: 1 }];
  const a = { id: 'a', row: 10, col: 10, shipClass: 'frigate', level: 6, upgrades: [], escorts: [], ducats: 20 };
  const b = { id: 'b', row: 10, col: 10, shipClass: 'frigate', level: 6, upgrades: [], escorts: [], ducats: 20 };
  room.players = [a, b];
  for (const round of [2, 3, 4]) {
    room.round = round;
    a.row = b.row = 10; a.col = b.col = 10;
    const result = seaBattle(room, a, b);
    assert.equal(result.ok, true);
    assert.equal(result.rebellion, undefined);
  }
  assert.deepEqual(island.buildings.map(b => [b.type, b.level]), [['farm',3],['shipyard',2],['fort',1]]);
}

// Морская атака, штурм острова игрока и враждебный эффект используют один общий
// лимит пары «нападающий — игрок-цель». Нейтральные цели в него не входят.
{
  const room = { round: 2, islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'b';
  const a = { id: 'a', row: 5, col: 1, shipClass: 'caravel', level: 2, upgrades: [], escorts: [], ducats: 0 };
  const b = { id: 'b', row: 1, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0 };
  room.players = [a, b];

  assert.equal(registerPlayerAttack(room, a, b.id).ok, true);
  assert.equal(registerPlayerAttack(room, a, b.id).ok, false);
  assert.equal(assaultIsland(room, a, island).ok, false);

  room.round = 3;
  assert.equal(assaultIsland(room, a, island).ok, true);
}


// Союз хранится попарно, не зависит от порядка ID и не образует цепочки из трёх игроков.
{
  const room = { alliances: [] };
  assert.equal(addAlliance(room, 'a', 'b'), true);
  assert.equal(areAllies(room, 'a', 'b'), true);
  assert.equal(areAllies(room, 'b', 'a'), true);
  assert.equal(addAlliance(room, 'b', 'a'), false);
  assert.equal(addAlliance(room, 'a', 'c'), false);
  assert.equal(addAlliance(room, 'c', 'b'), false);
  assert.deepEqual(room.alliances, [['a', 'b']]);
  assert.equal(removeAlliance(room, 'b', 'a'), true);
  assert.equal(areAllies(room, 'a', 'b'), false);
  assert.equal(addAlliance(room, 'c', 'b'), true);
}

// Совместный морской бой складывает артиллерию союзников. При поражении каждый
// участвовавший корабль проигравшей стороны теряет уровень; добыча делится победителями.
{
  const room = { round: 2, islands: cloneIslands(), players: [], alliances: [] };
  const a = { id: 'a', name: 'A', row: 10, col: 10, shipClass: 'frigate', level: 2, upgrades: [], escorts: [], ducats: 5, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {}, brokenAlliesThisTurn: [] };
  const c = { id: 'c', name: 'C', row: 9, col: 10, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 0 };
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
  assert.equal(a.fleetPoints, 2);
  assert.equal(c.fleetPoints, 2);
}

// Если побеждает совместная защита, уровни теряют все участвовавшие нападающие,
// а до 3 дукатов берутся только из казны инициатора и делятся защитниками.
{
  const room = { round: 2, islands: cloneIslands(), players: [], alliances: [] };
  const a = { id: 'a', name: 'A', row: 11, col: 11, shipClass: 'brigantine', level: 2, upgrades: [], escorts: [], ducats: 3, personalTurnNo: 1, attackedThisTurn: [], attackHistory: {}, brokenAlliesThisTurn: [] };
  const c = { id: 'c', name: 'C', row: 10, col: 11, shipClass: 'brigantine', level: 2, upgrades: [], escorts: [], ducats: 0 };
  const b = { id: 'b', name: 'B', row: 11, col: 11, shipClass: 'frigate', level: 3, upgrades: [], escorts: [], ducats: 0 };
  const d = { id: 'd', name: 'D', row: 10, col: 10, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 0 };
  room.players = [a, b, c, d];
  addAlliance(room, 'a', 'c');
  addAlliance(room, 'b', 'd');
  const result = jointSeaBattle(room, a, b, ['c'], ['d']);
  assert.equal(result.outcome, 'defender');
  assert.equal(a.level, 1);
  assert.equal(c.level, 1);
  assert.equal(a.ducats, 0);
  assert.equal(b.ducats + d.ducats, 3);
  assert.equal(b.fleetPoints, 2);
  assert.equal(d.fleetPoints, 2);
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
  const result = jointAssaultIsland(room, a, island, ['c'], []);
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
  const win = jointAssaultIsland(room2, a2, island2, ['c2'], []);
  assert.equal(win.outcome, 'attacker');
  assert.equal(island2.ownerId, 'a2');
  assert.equal(a2.armyPoints, 3); // защита 10 => 3 очка армии инициатору
  assert.equal(a2.glory, 0);
  assert.equal(c2.armyPoints || 0, 0); // при совместном захвате очки армии получает только инициатор
  assert.equal(c2.glory, 0);
}

// При успешной совместной защите острова 3 очка армии получает владелец острова, а не союзник защиты.
{
  const room = { round: 2, islands: cloneIslands(), players: [], alliances: [] };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'b';
  island.buildings = [{ type: 'fort', level: 1 }];
  const a = { id: 'a', name: 'A', row: 5, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, armyPoints: 0 };
  const c = { id: 'c', name: 'C', row: 5, col: 2, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, armyPoints: 0 };
  const b = { id: 'b', name: 'B', row: 5, col: 2, shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, armyPoints: 0 };
  const d = { id: 'd', name: 'D', row: 6, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, armyPoints: 0 };
  room.players = [a, b, c, d];
  addAlliance(room, 'a', 'c');
  addAlliance(room, 'b', 'd');
  const result = jointAssaultIsland(room, a, island, ['c'], ['d']);
  assert.equal(result.outcome, 'defender');
  assert.equal(b.armyPoints, 3);
  assert.equal(d.armyPoints, 0);
}

// При ничьей совместного штурма контроль не меняется и участвовавшие игроки ничего не теряют.
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
  const result = jointAssaultIsland(room, a, island, ['c'], ['d']);
  assert.equal(result.outcome, 'tie');
  for (const p of [a, b, c, d]) assert.equal(p.ducats, 10);
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

// Победа на синем якоре: награда +1 очко флота, карта уходит в сброс, клетка отмечается на раунд.
{
  const p = { id: 'p1', row: 5, col: 11, shipClass: 'frigate', level: 7, upgrades: ['falcons', 'culverins'], escorts: [], ducats: 1, debt: 0, glory: 0, fleetPoints: 0, visitedAnchors: [] };
  const room = { round: 2, players: [p], islands: cloneIslands(), anchorDecks: { blue: { drawPile: [{ id: 'test', name: 'Тестовый конвой', artillery: 4, reward: 8, quiet: false }], discard: [] } } };
  const result = resolveAnchorEncounter(room, p);
  assert.equal(result.triggered, true);
  assert.equal(result.outcome, 'win');
  assert.equal(result.actionCost, 1);
  assert.equal(p.ducats, 9);
  assert.equal(p.glory, 0);
  assert.equal(p.fleetPoints, 1);
  assert.equal(result.fleetPoints, 1);
  assert.equal(room.anchorDecks.blue.discard.length, 1);
  assert.deepEqual(room.anchorDecks.blue.discard.map(c => c.id), ['test']);
  assert.equal(p.visitedAnchors.includes('5,11'), true);
  const second = resolveAnchorEncounter(room, p);
  assert.equal(second.triggered, false);
  assert.equal(second.reason, 'already-visited');
}

// Жёлтый и красный якоря дают 2 и 3 очка флота соответственно.
{
  const yellow = { id: 'y', row: 10, col: 16, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 0, debt: 0, fleetPoints: 0, visitedAnchors: [] };
  const red = { id: 'r', row: 26, col: 21, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 0, debt: 0, fleetPoints: 0, visitedAnchors: [] };
  const roomY = { round: 2, players: [yellow], islands: cloneIslands(), anchorDecks: { yellow: { drawPile: [{ id: 'y-win', name: 'Жёлтый тест', artillery: 0, reward: 0, quiet: false }], discard: [] } } };
  const roomR = { round: 2, players: [red], islands: cloneIslands(), anchorDecks: { red: { drawPile: [{ id: 'r-win', name: 'Красный тест', artillery: 0, reward: 0, quiet: false }], discard: [] } } };
  assert.equal(resolveAnchorEncounter(roomY, yellow).fleetPoints, 2);
  assert.equal(yellow.fleetPoints, 2);
  assert.equal(resolveAnchorEncounter(roomR, red).fleetPoints, 3);
  assert.equal(red.fleetPoints, 3);
}

// Ограничение действует на конкретную клетку: другой синий якорь того же раунда можно разыграть.
{
  const p = { id: 'p1', row: 5, col: 11, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 0, debt: 0, fleetPoints: 0, visitedAnchors: [] };
  const room = { round: 2, players: [p], islands: cloneIslands(), anchorDecks: { blue: { drawPile: [
    { id: 'b1', name: 'Первый', artillery: 0, reward: 0, quiet: false },
    { id: 'b2', name: 'Второй', artillery: 0, reward: 0, quiet: false },
  ], discard: [] } } };
  assert.equal(resolveAnchorEncounter(room, p).outcome, 'win');
  p.row = 9; p.col = 1;
  assert.equal(resolveAnchorEncounter(room, p).outcome, 'win');
  assert.equal(p.fleetPoints, 2);
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

// Ничья на якоре не даёт награды и не накладывает дополнительных последствий.
{
  const p = { id: 'p1', row: 5, col: 25, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 10, debt: 0, glory: 0, visitedAnchors: [], skipTurns: 0 };
  const room = { round: 2, players: [p], islands: cloneIslands(), anchorDecks: { yellow: { drawPile: [{ id: 'tie', name: 'Ровный противник', artillery: 5, reward: 20, quiet: false }], discard: [] } } };
  const result = resolveAnchorEncounter(room, p);
  assert.equal(result.outcome, 'tie');
  assert.equal(p.skipTurns, 0);
  assert.equal(p.ducats, 10);
  assert.equal(p.glory, 0);
  assert.equal(p.fleetPoints || 0, 0);
}

// «На море тихо» не тратит действие и не меняет казну или очки флота.
{
  const p = { id: 'p1', row: 9, col: 1, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 10, debt: 0, glory: 0, visitedAnchors: [] };
  const room = { round: 2, players: [p], islands: cloneIslands(), anchorDecks: { blue: { drawPile: [{ id: 'calm', name: 'На море тихо', artillery: null, reward: 0, quiet: true }], discard: [] } } };
  const result = resolveAnchorEncounter(room, p);
  assert.equal(result.outcome, 'quiet');
  assert.equal(result.actionCost, 0);
  assert.equal(p.ducats, 10);
  assert.equal(p.glory, 0);
  assert.equal(p.fleetPoints || 0, 0);
}


// Колода событий содержит ровно 26 карт, включая два экземпляра «Найдено сокровище».
{
  const deck = createSailingEventDeck(() => 0.5);
  assert.equal(deck.drawPile.length, 26);
  assert.equal(deck.drawPile.filter(c => c.id === 'found-treasure').length, 2);
  const room = { eventDeck: deck };
  const card = drawSailingEventCard(room, () => 0.5);
  assert.ok(card);
  assert.equal(room.eventDeck.drawPile.length, 25);
  assert.equal(room.eventDeck.discard.length, 0);
}

// Сокровище в мобильной версии — независимый равновероятный цифровой результат.
{
  const room = { islands: cloneIslands() };
  assert.equal(drawTreasureCard(room, () => 0.00).id, 'income-x1');
  assert.equal(drawTreasureCard(room, () => 0.25).id, 'income-x2');
  assert.equal(drawTreasureCard(room, () => 0.50).id, 'income-x3');
  const diamonds = drawTreasureCard(room, () => 0.75);
  assert.equal(diamonds.id, 'full-diamonds-hold');
  assert.equal(diamonds.cargoGoodId, 'diamonds');

  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'farm', level: 1 }, { type: 'market', level: 1 }];
  const p = { id: 'p1', shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], cargo: null, ducats: 0, debt: 1 };
  const result = resolveMoneyTreasure(room, p, { id: 'income-x2', name: 'Доход ×2', multiplier: 2, minimum: 4 });
  assert.equal(result.amount, 4);
  assert.equal(p.debt, 0);
  assert.equal(p.ducats, 3);

  const loaded = fillCargoDirect(room, p, diamonds.cargoGoodId, 'main');
  assert.equal(loaded.ok, true);
  assert.equal(p.cargo.goodId, 'diamonds');
  assert.equal(p.cargo.quantity, 2);
}

// Цифровой легендарный пул содержит четыре типа и выбирает независимо с возвращением.
{
  assert.equal(BALANCE.legendaryPool.mode,'random-with-replacement');
  assert.equal(BALANCE.legendaryPool.selection,'uniform');
  assert.deepEqual(
    [0,0.25,0.5,0.75].map(value=>drawLegendaryCard(null,()=>value).id),
    ['sea-veil','hellfire','mist-path','sea-curse']
  );
  assert.equal(drawLegendaryCard(null,()=>0).id,'sea-veil');
  assert.equal(drawLegendaryCard(null,()=>0).id,'sea-veil'); // тот же тип может выпасть повторно
}

// Адия открывается как легендарное место только первым военным завоеванием.
// Её собственная военная награда остаётся отдельной: первый захват даёт
// 20 дукатов, легендарную карту острова и ещё одну карту за легендарное открытие.
{
  const islands = cloneIslands();
  const adia = islands.find(island => island.id === 'adia');
  adia.army = 0;
  const [row,col] = adia.cells[0];
  const player = {
    id:'digital-legendary-player', name:'Digital', row, col, shipClass:'brigantine', level:1,
    upgrades:[], escorts:[], ducats:0, debt:0, armyPoints:0,
    attackCountsThisRound:{}, namedPlaceCards:[], legendaryCards:[],
  };
  const room = {
    round:2, islands, players:[player], alliances:[], factionState:{},
    legendaryPlacesExplored:{},
  };
  const result = jointAssaultIsland(room, player, adia, [], [], { rng:()=>0 });
  assert.equal(result.ok,true);
  assert.equal(result.outcome,'attacker');
  assert.equal(player.ducats,20);
  assert.equal(result.legendaryDiscovery.first,true);
  assert.equal(result.legendaryDiscovery.namedCard.id,'place-adia');
  assert.equal(result.legendaryDiscovery.legendaryCard.id,'sea-veil');
  assert.equal(room.legendaryPlacesExplored.adia,'digital-legendary-player');
  assert.deepEqual(player.namedPlaceCards.map(card=>card.id),['place-adia']);
  assert.deepEqual(player.legendaryCards.map(card=>card.id),['sea-veil','sea-veil']);
  assert.equal(Object.hasOwn(player,'pendingLegendary'),false);
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

// «Набег» позволяет выбрать любую свою постройку и понижает её ровно на одну строительную ступень.
// Исходная форма I при таком понижении удаляется.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'farm', level: 3 }, { type: 'market', level: 1 }];
  const p = { id: 'p1' };
  const opts = raidBuildingOptions(room, p);
  assert.equal(opts.length, 2);
  const farmResult = applyRaidDowngrade(room, p, island.id, 0);
  assert.equal(farmResult.ok, true);
  assert.equal(farmResult.removed, false);
  assert.equal(island.buildings[0].level, 2);
  const marketResult = applyRaidDowngrade(room, p, island.id, 1);
  assert.equal(marketResult.ok, true);
  assert.equal(marketResult.removed, true);
  assert.equal(marketResult.afterName, null);
  assert.deepEqual(island.buildings, [{ type: 'farm', level: 2 }]);
}

// Продвинутая форма I при «Набеге» возвращается в исходную форму III.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'bank', level: 1 }];
  const p = { id: 'p1' };
  const result = applyRaidDowngrade(room, p, island.id, 0);
  assert.equal(result.ok, true);
  assert.equal(result.removed, false);
  assert.deepEqual([island.buildings[0].type, island.buildings[0].level], ['market', 3]);
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

// Уровень корабля увеличивает число действий на II, IV и VI уровнях.
{
  const expected = [3, 4, 4, 5, 5, 6];
  for (let level = 1; level <= 6; level += 1) {
    assert.equal(shipStats({ shipClass: 'brigantine', level, upgrades: [] }).actionsPerTurn, expected[level - 1]);
  }
}

// Шторм предлагает допустимые береговые клетки целевого острова.
// В.21 сохраняет старый id для save-compatibility, но staging-канон переносит к Ренаике.
{
  const room = { islands: cloneIslands() };
  const p = { shipClass: 'frigate' };
  const storm = SAILING_EVENT_CARDS.find(card => card.id === 'storm-chertonia');
  assert.ok(storm);
  assert.equal(storm.name, 'Шторм: Ренаика');
  assert.equal(storm.islandId, 'renaika');
  assert.deepEqual(stormCellOptions(room, p, storm.islandId), [{ row: 4, col: 5 }]);
  assert.deepEqual(stormCellOptions(room, p, 'kadingir'), [{ row: 0, col: 24 }]);
  assert.deepEqual(stormCellOptions(room, p, 'landin'), [{ row: 9, col: 17 }]);
}

// Колода событий плавания содержит ровно 26 физических карт и использует канонический
// тип turn-effect с эффектом текущего личного хода. Старое сохранение карты next-turn
// при чтении нормализуется по id к актуальной мастер-карте.
{
  const deck = createSailingEventDeck(() => 0.5);
  assert.equal(deck.drawPile.length, 26);
  const timed = deck.drawPile.filter(card => card.type === 'turn-effect');
  assert.equal(timed.length, 9);
  assert.equal(timed.every(card => card.timing === 'current-personal-turn'), true);
  assert.equal(deck.drawPile.some(card => card.type === 'next-turn' || card.timing === 'next-personal-turn'), false);

  const room = {
    eventDeck: {
      drawPile: [{ id: 'tailwind-1', name: 'legacy', type: 'next-turn', effect: 'moveBonus', value: 99, timing: 'next-personal-turn' }],
      discard: [],
    },
  };
  const restored = drawSailingEventCard(room, () => 0.5);
  assert.equal(restored.id, 'tailwind-1');
  assert.equal(restored.masterCardId, 'tailwind-1');
  assert.equal(restored.type, 'turn-effect');
  assert.equal(restored.effect, 'moveBonus');
  assert.equal(restored.value, 1);
  assert.equal(restored.timing, 'current-personal-turn');
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

// Реактивный «Покров моря» против враждебной легендарной карты не создаёт
// трёхходовый эффект: он защищает только до конца текущего хода источника.
{
  const room = { islands: cloneIslands(), players: [] };
  const source = { id:'source', legendaryEffects:{ seaCurses:[] } };
  const target = { id:'target', legendaryEffects:{ seaCurses:[] } };
  room.players.push(source,target);
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = target.id;

  assert.equal(applySeaVeilHostileReactionToShip(target, source.id).ok,true);
  assert.equal(isShipProtected(target),true);
  assert.equal(target.legendaryEffects.shipVeil,undefined);
  assert.equal(target.legendaryEffects.shipVeilReaction.expiry,'end-of-current-turn');

  assert.equal(applySeaVeilHostileReactionToIsland(island,target,source.id).ok,true);
  assert.equal(isIslandProtected(island),true);
  assert.equal(island.legendaryVeil,null);
  assert.equal(island.legendaryVeilReaction.expiry,'end-of-current-turn');

  const expired = clearSeaVeilHostileReactionsAtTurnEnd(room,source.id);
  assert.equal(expired.length,2);
  assert.equal(isShipProtected(target),false);
  assert.equal(isIslandProtected(island),false);
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

// «Пламя Ада» понижает каждое здание на одну строительную ступень:
 // исходная форма I удаляется, продвинутая I возвращается в исходную III.
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
  assert.equal(result.changed, 3);
  assert.deepEqual(island.buildings.map(b => [b.type, b.level]), [
    ['farm', 2],
    ['market', 3], // Банк I -> Рынок III
  ]);
  assert.equal(result.changes.some(change => change.beforeName.includes('Рынок') && change.removed), true);
}

// Каждая из шести политических фракций имеет колоду вражды из 10 карт.
{
  const decks = createFeudDecks(() => 0.5);
  assert.deepEqual(Object.keys(decks).sort(), ['kadingir', 'lionia', 'mayo', 'mori', 'pirates', 'suniksiya']);
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

// Владение прежними островами игроками само по себе не прекращает государство:
 // прекращение — отдельное необратимое состояние после квалифицирующего военного захвата.
{
  const room = { islands: cloneIslands(), players: [], factionState: {} };
  const p = { id: 'p1', suzerainId: null, vassalGiftIslandId: null, enemyFactionIds: ['lionia'] };
  room.players.push(p);
  for (const id of ['landin', 'frandia', 'eidon']) room.islands.find(i => i.id === id).ownerId = 'p1';
  assert.equal(stateOwnedIslandIds(room, 'lionia').length, 0);
  assert.equal(stateExists(room, 'lionia'), true);
  refreshFactionExistence(room);
  assert.equal(room.factionState.lionia.exists, true);
  assert.deepEqual(p.enemyFactionIds, ['lionia']);
}

// Политические карты могут выбирать постройки, улучшения, трюмы и закрытые удерживаемые карты.
{
  const room = {
    islands: cloneIslands(),
    eventDeck: { drawPile: [], discard: [] },
  };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'fort', level: 2 }, { type: 'farm', level: 1 }];
  const p = {
    id: 'p1', shipClass: 'frigate', level: 2, upgrades: ['falcons', 'musketeers'],
    cargo: { goodId: 'wood', quantity: 3 }, escorts: [],
    specialCards: ['Путь сквозь туман'], legendaryCards: [], savedEventCards: [],
    activeAssignment: { id: 'assignment-test', instanceId: 'assignment-test-1', text: 'Закрытое поручение' },
  };
  assert.equal(politicalBuildingOptions(room, p, { aboveLevelOne: true }).length, 1);
  assert.equal(politicalBuildingOptions(room, p, { fortsOnly: true }).length, 1);
  assert.equal(politicalUpgradeOptions(p, 'army').length, 1);
  assert.equal(politicalCargoOptions(room, p).length, 1);
  assert.equal(discardRandomHeldCard(room, p, () => 0).discarded.name, 'Путь сквозь туман');
  assert.deepEqual(p.specialCards, []);
  assert.equal(p.activeAssignment.id, 'assignment-test');
  assert.equal(discardRandomHeldCard(room, p, () => 0).discarded, null);
  assert.equal(p.activeAssignment.id, 'assignment-test');
  const removed = removePlayerBuilding(room, p, 'bogamia', 1);
  assert.equal(removed.ok, true);
  assert.equal(island.buildings.length, 1);
}


// Каноническое понижение по карте вражды удаляет исходную форму I,
// а продвинутую форму I возвращает в исходную форму III.
{
  const room = { islands: cloneIslands() };
  const island = room.islands.find(i => i.id === 'bogamia');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'farm', level: 1 }, { type: 'bank', level: 1 }];
  const p = { id: 'p1' };
  const removed = applyFeudBuildingDowngrade(room, p, island.id, 0);
  assert.equal(removed.ok, true);
  assert.equal(removed.removed, true);
  assert.deepEqual(island.buildings, [{ type: 'bank', level: 1 }]);
  const lowered = applyFeudBuildingDowngrade(room, p, island.id, 0);
  assert.equal(lowered.ok, true);
  assert.equal(lowered.removed, false);
  assert.equal(island.buildings[0].type, 'market');
  assert.equal(island.buildings[0].level, 3);
}

// Карта вражды может уничтожить груз из любого собственного грузового трюма,
// включая временно неактивное сопровождение: уже погруженный груз на нём сохраняется физически.
{
  const room = { islands: cloneIslands() };
  const p = {
    id: 'p1',
    cargo: null,
    shipClass: 'brigantine',
    level: 1,
    upgrades: [],
    escorts: [{ id: 'cargo-old', type: 'cargo', cargo: { goodId: 'wood', quantity: 5 } }],
    levelInactiveEscortIds: ['cargo-old'],
  };
  const options = politicalCargoOptions(room, p);
  assert.deepEqual(options.map(o => o.id), ['cargo-old']);
}

// Приложение Д активирует шесть отдельных колод ровно по десять карт,
// включая две карты штрафа движения Сёгуната Мори.
{
  const decks = createFeudDecks(() => 0.5);
  assert.deepEqual(Object.keys(decks), ['lionia', 'kadingir', 'mori', 'mayo', 'suniksiya', 'pirates']);
  for (const deck of Object.values(decks)) assert.equal(deck.drawPile.length, 10);
  assert.equal(decks.mori.drawPile.filter(card => card.type === 'movement-penalty' && card.amount === 2).length, 2);
}

// Пять колод поручений содержат ровно 49 карт: Лиония 10, Кадингир 10, Мори 10, Суниксия 10, пираты 9.
{
  assert.deepEqual(Object.keys(ASSIGNMENT_CARDS), ['lionia', 'kadingir', 'mori', 'suniksiya', 'pirates']);
  assert.equal(ASSIGNMENT_CARDS.lionia.length, 10);
  assert.equal(ASSIGNMENT_CARDS.kadingir.length, 10);
  assert.equal(ASSIGNMENT_CARDS.mori.length, 10);
  assert.equal(ASSIGNMENT_CARDS.suniksiya.length, 10);
  assert.equal(ASSIGNMENT_CARDS.pirates.length, 9);
  assert.equal(Object.values(ASSIGNMENT_CARDS).flat().length, 49);
  const decks = createAssignmentDecks(() => 0.5);
  assert.deepEqual(Object.fromEntries(Object.entries(decks).map(([id, deck]) => [id, deck.drawPile.length])), {
    lionia: 10, kadingir: 10, mori: 10, suniksiya: 10, pirates: 9,
  });
  for (const deck of Object.values(decks)) assert.deepEqual(deck.removed, []);
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

// Вольная Суниксия удерживает половину нечётной награды с округлением удержанной доли вниз.
{
  const card = ASSIGNMENT_CARDS.suniksiya.find(c => c.id === 'suniksiya-delivery-any');
  const room = { assignmentDecks: createAssignmentDecks(() => 0.5) };
  const p = { id: 'p1', ducats: 1, debt: 2, activeAssignment: { instanceId: 'odd-1', factionId: 'suniksiya', card: { ...card } } };
  const result = completeAssignment(room, p, { type: 'delivery', goodId: 'wood', assignmentInstanceId: 'odd-1', fullHold: true });
  assert.equal(result.ok, true);
  assert.equal(result.gross, 5);
  assert.equal(result.rewardShare, 0.5);
  assert.equal(result.withheld, 2);
  assert.equal(result.paid, 3);
  assert.equal(result.credit.debtPaid, 2);
  assert.equal(result.credit.net, 1);
  assert.equal(p.debt, 0);
  assert.equal(p.ducats, 2);
}

// Сёгунат Мори не удерживает долю награды: расчёт выплаты остаётся полным независимо от типа поручения.
{
  const card = { id: 'mori-reward-test', text: 'Тест выплаты Мори', reward: 7, type: 'ship-level', factionId: 'mori' };
  const room = { assignmentDecks: { mori: { drawPile: [], discard: [], removed: [] } } };
  const p = { id: 'p1', ducats: 0, debt: 0, activeAssignment: { instanceId: 'mori-pay-1', factionId: 'mori', card: { ...card } } };
  const result = completeAssignment(room, p, { type: 'ship-level' });
  assert.equal(result.ok, true);
  assert.equal(result.rewardShare, 0);
  assert.equal(result.withheld, 0);
  assert.equal(result.paid, 7);
  assert.equal(p.ducats, 7);
}

// Налог Лионии и Кадингира составляет ровно 2 дуката; недоплата не создаёт долг, а ограничивает ход двумя действиями.
{
  const paid = { ducats: 5, debt: 4, nextActionLimit: null };
  const full = settleVassalTax(paid, 'lionia');
  assert.equal(full.applies, true);
  assert.equal(full.due, 2);
  assert.equal(full.paid, 2);
  assert.equal(full.underpaid, false);
  assert.equal(full.actionLimit, null);
  assert.equal(paid.ducats, 3);
  assert.equal(paid.debt, 4);

  const short = { ducats: 1, debt: 6, nextActionLimit: null };
  const partial = settleVassalTax(short, 'kadingir');
  assert.equal(partial.due, 2);
  assert.equal(partial.paid, 1);
  assert.equal(partial.underpaid, true);
  assert.equal(partial.actionLimit, 2);
  assert.equal(short.ducats, 0);
  assert.equal(short.debt, 6);
  assert.equal(short.nextActionLimit, 2);

  const repeated = settleVassalTax(short, 'kadingir');
  assert.equal(repeated.paid, 0);
  assert.equal(repeated.actionLimit, 2);
  assert.equal(short.nextActionLimit, 2);
  assert.equal(short.debt, 6);
}

// У Суниксии, пиратов и Мори налог не взимается и лимит действий налогом не меняется.
{
  for (const factionId of ['suniksiya', 'pirates', 'mori']) {
    const p = { ducats: 1, debt: 0, nextActionLimit: null };
    const result = settleVassalTax(p, factionId);
    assert.equal(result.applies, false, factionId);
    assert.equal(result.due, 0, factionId);
    assert.equal(p.ducats, 1, factionId);
    assert.equal(p.nextActionLimit, null, factionId);
  }
}
// Доставка засчитывается только полным трюмом, полученным после выдачи именно текущего поручения.
{
  const card = ASSIGNMENT_CARDS.suniksiya.find(c => c.id === 'suniksiya-delivery-ore');
  const p = { activeAssignment: { instanceId: 'delivery-1', factionId: 'suniksiya', card: { ...card } } };
  assert.equal(assignmentEventMatches(p, { type: 'delivery', goodId: 'ore', assignmentInstanceId: null, fullHold: true }), false);
  assert.equal(assignmentEventMatches(p, { type: 'delivery', goodId: 'wood', assignmentInstanceId: 'delivery-1', fullHold: true }), false);
  assert.equal(assignmentEventMatches(p, { type: 'delivery', goodId: 'ore', assignmentInstanceId: 'delivery-1', fullHold: false }), false);
  assert.equal(assignmentEventMatches(p, { type: 'delivery', goodId: 'ore', assignmentInstanceId: 'delivery-1', fullHold: true }), true);
}

// Продажа сохраняет размер трюма и метку текущего поручения для проверки доставки.
{
  const room = { islands: cloneIslands() };
  const p = {
    id: 'p1', row: 13, col: 13, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, debt: 0,
    cargo: { goodId: 'ore', quantity: 2, assignmentInstanceId: 'delivery-sale' },
  };
  const sold = sellCargo(room, p);
  assert.equal(sold.ok, true);
  assert.equal(sold.quantity, 2);
  assert.equal(sold.capacity, 2);
  assert.equal(sold.assignmentInstanceId, 'delivery-sale');
}
// Сокровище не засчитывается задним числом: получение и разрешение относятся к текущему поручению.
{
  const card = ASSIGNMENT_CARDS.suniksiya.find(c => c.id === 'suniksiya-treasure');
  const p = { activeAssignment: { instanceId: 'treasure-1', factionId: 'suniksiya', card: { ...card } } };
  assert.equal(assignmentEventMatches(p, { type: 'treasure-resolved', assignmentInstanceId: null }), false);
  assert.equal(assignmentEventMatches(p, { type: 'treasure-resolved', assignmentInstanceId: 'old-assignment' }), false);
  assert.equal(assignmentEventMatches(p, { type: 'treasure-resolved', assignmentInstanceId: 'treasure-1' }), true);
}

// Переход к верфи и дальнейшее улучшение верфи считаются действием по тому же поручению.
{
  const card = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-shipyard-forest');
  const p = { activeAssignment: { instanceId: 'yard-1', factionId: 'lionia', card: { ...card } } };
  const base = { type: 'building-action', islandId: 'test', islandResources: ['Лес'], branch: 'wood' };
  assert.equal(assignmentEventMatches(p, { ...base, buildingType: 'sawmill', previousBuildingType: null }), false);
  assert.equal(assignmentEventMatches(p, { ...base, buildingType: 'shipyard', previousBuildingType: 'lumbermill' }), true);
  assert.equal(assignmentEventMatches(p, { ...base, buildingType: 'shipyard', previousBuildingType: 'shipyard' }), true);
}

// Переход крепости III в бастион остаётся улучшением защитной ветви поручения.
{
  const card = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-frandia-fort');
  const p = { activeAssignment: { instanceId: 'fort-1', factionId: 'lionia', card: { ...card } } };
  assert.equal(assignmentEventMatches(p, {
    type: 'building-action', islandId: 'frandia', islandResources: [], buildingType: 'bastion', previousBuildingType: 'fortress', branch: 'fort',
  }), true);
}

// Приоритет появляется только когда поручение реально можно выполнить на текущей клетке и есть действие.
{
  const card = ASSIGNMENT_CARDS.kadingir.find(c => c.id === 'kadingir-market');
  const islands = cloneIslands();
  const island = islands.find(i => i.id === 'kadingir');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'farm', level: 1 }];
  const [row, col] = island.cells[0];
  const p = {
    id: 'p1', row, col, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 100,
    savedEventCards: [], activeAssignment: { instanceId: 'priority-build', factionId: 'kadingir', card: { ...card } },
  };
  const room = { round: 2, islands, players: [p], alliances: [] };
  const required = assignmentRequiredAction(room, p, 2);
  assert.equal(required.kind, 'building');
  assert.equal(required.buildOptions.some(option => option.islandId === 'kadingir' && option.buildingType === 'market'), true);
  assert.equal(assignmentRequiredAction(room, p, 0), null);
  p.row = 13; p.col = 13;
  assert.equal(assignmentRequiredAction(room, p, 2), null);
}

// «Судовой мастер» может сделать улучшение обязательным по поручению только там,
// где такое улучшение вообще допустимо устанавливать — в Цитадели.
{
  const card = ASSIGNMENT_CARDS.kadingir.find(c => c.type === 'stat-upgrade' && c.branch === 'cargo');
  const p = {
    id: 'p1', row: 0, col: 0, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0,
    savedEventCards: [{ id: 'master-1', kind: 'ship-master' }],
    activeAssignment: { instanceId: 'priority-master', factionId: 'kadingir', card: { ...card } },
  };
  const room = { round: 2, islands: cloneIslands(), players: [p], alliances: [] };
  assert.equal(assignmentRequiredAction(room, p, 1), null);
  let citadel = null;
  for (let row = 0; row < MAP_META.rows && !citadel; row++) {
    for (let col = 0; col < MAP_META.cols; col++) {
      if (isCitadelCell(row, col)) { citadel = [row, col]; break; }
    }
  }
  assert.ok(citadel);
  [p.row, p.col] = citadel;
  const required = assignmentRequiredAction(room, p, 1);
  assert.equal(required.kind, 'ship-upgrade');
  assert.deepEqual(required.shipMasterIds, ['master-1']);
  assert.ok(required.freeUpgradeIds.length > 0);
}

// Захват, якорь и доставка создают обязательное следующее действие только при доступной цели.
{
  const islands = cloneIslands();
  const asigoriy = islands.find(i => i.id === 'asigoriy');
  const captureCard = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-asigoriy');
  const p = {
    id: 'p1', row: asigoriy.cells[0][0], col: asigoriy.cells[0][1],
    shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 20, cargo: null,
    savedEventCards: [], visitedAnchors: [], activeAssignment: { instanceId: 'capture-1', factionId: 'lionia', card: { ...captureCard } },
  };
  const room = { round: 2, islands, players: [p], alliances: [] };
  assert.deepEqual(assignmentRequiredAction(room, p, 1).islandIds, ['asigoriy']);

  const anchorCard = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-yellow-a');
  const [ar, ac] = ANCHORS.yellow.cells[0];
  p.row = ar; p.col = ac;
  p.activeAssignment = { instanceId: 'anchor-1', factionId: 'lionia', card: { ...anchorCard } };
  assert.equal(assignmentRequiredAction(room, p, 1).kind, 'anchor');
  p.visitedAnchors = [ar + ',' + ac];
  assert.equal(assignmentRequiredAction(room, p, 1), null);

  const deliveryCard = ASSIGNMENT_CARDS.suniksiya.find(c => c.id === 'suniksiya-delivery-ore');
  p.row = 13; p.col = 13; p.visitedAnchors = [];
  p.activeAssignment = { instanceId: 'delivery-current', factionId: 'suniksiya', card: { ...deliveryCard } };
  p.cargo = { goodId: 'ore', quantity: 2, assignmentInstanceId: 'delivery-current' };
  const delivery = assignmentRequiredAction(room, p, 1);
  assert.equal(delivery.kind, 'delivery');
  assert.deepEqual(delivery.holdIds, ['main']);
  p.cargo.assignmentInstanceId = 'old';
  assert.equal(assignmentRequiredAction(room, p, 1), null);
}

// Отложенное сокровище имеет приоритет только если было получено уже при текущем поручении.
{
  const card = ASSIGNMENT_CARDS.suniksiya.find(c => c.id === 'suniksiya-treasure');
  const p = {
    id: 'p1', row: 13, col: 13, shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], cargo: null,
    savedEventCards: [{ id: 'treasure-new', kind: 'treasure-cargo', assignmentInstanceId: 'treasure-current' }],
    activeAssignment: { instanceId: 'treasure-current', factionId: 'suniksiya', card: { ...card } },
  };
  const room = { round: 2, islands: cloneIslands(), players: [p], alliances: [] };
  assert.deepEqual(assignmentRequiredAction(room, p, 1).savedCardIds, ['treasure-new']);
  p.savedEventCards[0].assignmentInstanceId = 'old';
  assert.equal(assignmentRequiredAction(room, p, 1), null);
}

// Одиночное поручение Мори выполняется завершением навигации у нужного берега;
// владение островом, атака и разовая награда для этого не нужны.
{
  const card = ASSIGNMENT_CARDS.mori.find(c => c.id === 'mori-1');
  const islands = cloneIslands();
  const target = islands.find(i => i.id === card.islandId);
  target.ownerId = 'other-player';
  const p = { id: 'p1', row: MAP_META.startCell[0], col: MAP_META.startCell[1], ducats: 0, debt: 0, activeAssignment: null };
  const room = { round: 3, islands, players: [p], assignmentDecks: { mori: { drawPile: [{ ...card }], discard: [], removed: [] } } };
  const issued = issueAssignment(room, p, 'mori', () => 0.5);
  assert.equal(issued.ok, true);
  assert.equal(issued.assignment.progress.departureRequired, false);
  const from = { row: p.row, col: p.col };
  [p.row, p.col] = target.cells[0];
  const visit = advanceMoriAssignmentNavigation(room, p, from);
  assert.equal(visit.completed, true);
  assert.equal(visit.completionEvent.type, 'mori-visit-island');
  const completed = completeAssignment(room, p, visit.completionEvent);
  assert.equal(completed.ok, true);
  assert.equal(completed.gross, 8);
  assert.equal(completed.withheld, 0);
  assert.equal(p.ducats, 8);
  assert.equal(target.ownerId, 'other-player');
}

// Если карта выдана уже на береговой клетке цели, стояние на месте не засчитывается:
// сначала нужно покинуть все клетки этого берега, затем завершить последующую навигацию после возврата.
{
  const card = ASSIGNMENT_CARDS.mori.find(c => c.id === 'mori-2');
  const islands = cloneIslands();
  const target = islands.find(i => i.id === card.islandId);
  const p = { id: 'p1', row: target.cells[0][0], col: target.cells[0][1], ducats: 0, debt: 0, activeAssignment: null };
  const room = { round: 3, islands, players: [p], assignmentDecks: { mori: { drawPile: [{ ...card }], discard: [], removed: [] } } };
  const issued = issueAssignment(room, p, 'mori', () => 0.5);
  assert.equal(issued.assignment.progress.departureRequired, true);
  assert.equal(issued.assignment.progress.departureSatisfied, false);

  const standing = advanceMoriAssignmentNavigation(room, p, { row: p.row, col: p.col });
  assert.equal(standing.progressed, false);
  assert.equal(standing.completionEvent, null);

  const [awayRow, awayCol] = MAP_META.startCell;
  p.row = awayRow; p.col = awayCol;
  const left = noteMoriAssignmentDeparture(room, p);
  assert.equal(left.changed, true);
  assert.equal(p.activeAssignment.progress.departureSatisfied, true);

  const from = { row: p.row, col: p.col };
  [p.row, p.col] = target.cells[0];
  const returned = advanceMoriAssignmentNavigation(room, p, from);
  assert.equal(returned.completed, true);
  assert.equal(returned.completionEvent.assignmentInstanceId, p.activeAssignment.instanceId);
}

// Двухточечный маршрут Мори идёт строго по порядку; второй пункт до первого ничего не даёт.
// Отметка первого пункта хранится внутри activeAssignment и переживает сериализацию сохранения.
{
  const card = ASSIGNMENT_CARDS.mori.find(c => c.id === 'mori-9');
  const islands = cloneIslands();
  const firstIsland = islands.find(i => i.id === card.route[0].islandId);
  const secondIsland = islands.find(i => i.id === card.route[1].islandId);
  let p = { id: 'p1', row: MAP_META.startCell[0], col: MAP_META.startCell[1], ducats: 0, debt: 0, activeAssignment: null };
  const room = { round: 4, islands, players: [p], assignmentDecks: { mori: { drawPile: [{ ...card }], discard: [], removed: [] } } };
  assert.equal(issueAssignment(room, p, 'mori', () => 0.5).ok, true);

  let from = { row: p.row, col: p.col };
  [p.row, p.col] = secondIsland.cells[0];
  const wrongOrder = advanceMoriAssignmentNavigation(room, p, from);
  assert.equal(wrongOrder.progressed, false);
  assert.equal(p.activeAssignment.progress.nextStopIndex, 0);

  from = { row: p.row, col: p.col };
  [p.row, p.col] = firstIsland.cells[0];
  const first = advanceMoriAssignmentNavigation(room, p, from);
  assert.equal(first.progressed, true);
  assert.equal(first.completed, false);
  assert.equal(first.stop.islandId, 'renaika');
  assert.equal(p.activeAssignment.progress.nextStopIndex, 1);
  assert.equal(p.activeAssignment.progress.completedStopCount, 1);

  p = JSON.parse(JSON.stringify(p));
  room.players = [p];
  assert.equal(p.activeAssignment.progress.completedStops[0].islandId, 'renaika');
  assert.equal(p.activeAssignment.progress.nextStopIndex, 1);

  from = { row: p.row, col: p.col };
  [p.row, p.col] = secondIsland.cells[0];
  const second = advanceMoriAssignmentNavigation(room, p, from);
  assert.equal(second.completed, true);
  assert.equal(second.completionEvent.completedStopCount, 2);
  const completed = completeAssignment(room, p, second.completionEvent);
  assert.equal(completed.ok, true);
  assert.equal(completed.gross, 16);
  assert.equal(p.ducats, 16);
}

// Второй канонический маршрут Мори умеет завершаться в Цитадели без отдельного действия.
{
  const card = ASSIGNMENT_CARDS.mori.find(c => c.id === 'mori-10');
  const islands = cloneIslands();
  const firstIsland = islands.find(i => i.id === card.route[0].islandId);
  let citadel = null;
  for (let row = 0; row < MAP_META.rows && !citadel; row++) {
    for (let col = 0; col < MAP_META.cols; col++) {
      if (isCitadelCell(row, col)) { citadel = [row, col]; break; }
    }
  }
  assert.ok(citadel);
  const p = { id: 'p1', row: MAP_META.startCell[0], col: MAP_META.startCell[1], ducats: 0, debt: 0, activeAssignment: null };
  const room = { round: 4, islands, players: [p], assignmentDecks: { mori: { drawPile: [{ ...card }], discard: [], removed: [] } } };
  assert.equal(issueAssignment(room, p, 'mori', () => 0.5).ok, true);

  let from = { row: p.row, col: p.col };
  [p.row, p.col] = firstIsland.cells[0];
  const first = advanceMoriAssignmentNavigation(room, p, from);
  assert.equal(first.progressed, true);
  assert.equal(first.completed, false);

  from = { row: p.row, col: p.col };
  [p.row, p.col] = citadel;
  const finish = advanceMoriAssignmentNavigation(room, p, from);
  assert.equal(finish.completed, true);
  assert.equal(finish.stop.mapObjectId, 'citadel');
  assert.equal(finish.completionEvent.type, 'mori-visit-route');
  assert.equal(assignmentRequiredAction(room, p, 3), null);
}
// Платная замена поручения удалена из активного runtime.
{
  assert.equal(BALANCE.assignmentReplacementPrice, undefined);
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
  assert.equal(room.assignmentDecks.lionia.drawPile.some(card => card.id === 'lionia-asigoriy'), true);
  assert.equal(room.assignmentDecks.lionia.removed.length, 0);
}

// Необратимо невозможная карта удаляется из колоды и не возвращается в обычный цикл.
{
  const valid = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-ship-level');
  const broken = { id: 'broken-capture', type: 'capture-island', islandId: 'missing-island', text: 'broken', reward: 0, factionId: 'lionia' };
  const room = { round: 2, islands: cloneIslands(), assignmentDecks: { lionia: { drawPile: [broken, { ...valid }], discard: [] } } };
  const p = { id: 'p1', level: 1, upgrades: [], activeAssignment: null };
  const result = issueAssignment(room, p, 'lionia', () => 0.5);
  assert.equal(result.ok, true);
  assert.equal(result.assignment.card.id, valid.id);
  assert.deepEqual(room.assignmentDecks.lionia.removed.map(card => card.id), ['broken-capture']);
}

// При одной выдаче Посольство просматривает доступные карты один раз:
// временно недопустимая карта возвращается после выдачи, а сброс при необходимости перемешивается в колоду.
{
  const ownCapture = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-asigoriy');
  const first = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-ship-level');
  const second = ASSIGNMENT_CARDS.lionia.find(c => c.id === 'lionia-yellow-a');
  const islands = cloneIslands();
  islands.find(i => i.id === 'asigoriy').ownerId = 'p1';
  const room = {
    round: 2,
    islands,
    assignmentDecks: { lionia: { drawPile: [{ ...ownCapture }, { ...first }], discard: [{ ...second }], removed: [] } },
  };
  const p = { id: 'p1', level: 1, upgrades: [], activeAssignment: null };
  const offered = offerAssignmentCards(room, p, 'lionia', 2, () => 0.5);
  assert.deepEqual(offered.cards.map(card => card.id), [first.id, second.id]);
  assert.equal(room.assignmentDecks.lionia.drawPile.filter(card => card.id === ownCapture.id).length, 1);
  assert.equal(room.assignmentDecks.lionia.removed.length, 0);
}

// Поручение на уже достигший максимум здания временно пропускается для этого игрока.
{
  const maxed = ASSIGNMENT_CARDS.kadingir.find(c => c.id === 'kadingir-market');
  const next = ASSIGNMENT_CARDS.kadingir.find(c => c.id === 'kadingir-ship-level');
  const islands = cloneIslands();
  const island = islands.find(i => i.id === 'kadingir');
  island.ownerId = 'p1';
  island.buildings = [{ type: 'bank', level: 3 }, { type: 'bank', level: 3 }];
  const room = { round: 2, islands, assignmentDecks: { kadingir: { drawPile: [{ ...maxed }, { ...next }], discard: [], removed: [] } } };
  const p = { id: 'p1', level: 1, upgrades: [], activeAssignment: null };
  const result = issueAssignment(room, p, 'kadingir', () => 0.5);
  assert.equal(result.ok, true);
  assert.equal(result.assignment.card.id, next.id);
  assert.equal(room.assignmentDecks.kadingir.drawPile.some(card => card.id === maxed.id), true);
}

// Одновременно у игрока может быть только одно активное поручение.
{
  const room = { round: 2, islands: cloneIslands(), assignmentDecks: createAssignmentDecks(() => 0.5) };
  const p = { id: 'p1', level: 1, upgrades: [], activeAssignment: null };
  assert.equal(issueAssignment(room, p, 'lionia', () => 0.5).ok, true);
  const second = issueAssignment(room, p, 'lionia', () => 0.5);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'У игрока уже есть активное поручение.');
}

// Совместимость 5.8 переводит старое состояние поручений без потери остального состояния комнаты.
{
  const moriCard = ASSIGNMENT_CARDS.mori.find(c => c.id === 'mori-1');
  const islands = cloneIslands();
  const target = islands.find(i => i.id === moriCard.islandId);
  const p = {
    id: 'p1', row: target.cells[0][0], col: target.cells[0][1], ducats: 4, debt: 0,
    replacedAssignmentConditions: ['old-paid-condition'],
    pendingLegendary: 2,
    legendaryCards: [],
    activeAssignment: { factionId: 'mori', card: { ...moriCard }, issuedRound: 3 },
  };
  const room = {
    round: 6, islands, players: [p],
    legendaryDeck: { drawPile:[{id:'legacy-card'}], discard:[], total:8, unresolved:'R05' },
    assignmentDecks: { lionia: { drawPile: [], discard: [] } },
    pendingAssignmentChoice: { id: 'old-paid-choice', playerId: 'p1', factionId: 'mori' },
    eventPhase: { active: true, stage: 'assignment-replace', assignmentQueue: [{ playerId: 'p1', factionId: 'mori' }], replacementQueue: ['p1'], replacementIndex: 0 },
  };
  const result = normalizeAssignmentCompatibility(room, () => 0.5);
  assert.equal(result.changed, true);
  assert.equal(result.resumeEventPhase, true);
  assert.deepEqual(Object.keys(room.assignmentDecks), ['lionia','kadingir','mori','suniksiya','pirates']);
  assert.equal(room.assignmentDecks.mori.drawPile.length, 9); // активная карта не дублируется в восстановленной колоде
  assert.deepEqual(room.assignmentDecks.lionia.removed, []);
  assert.equal(Object.hasOwn(p, 'replacedAssignmentConditions'), false);
  assert.equal(Object.hasOwn(room,'legendaryDeck'),false);
  assert.equal(Object.hasOwn(p,'pendingLegendary'),false);
  assert.deepEqual(p.legendaryCards.map(card=>card.id),['mist-path','mist-path']);
  assert.match(p.activeAssignment.instanceId, /^legacy:p1:mori:mori-1:/);
  assert.equal(p.activeAssignment.progress.kind, 'mori-service');
  assert.equal(p.activeAssignment.progress.departureRequired, true);
  assert.equal(p.activeAssignment.progress.departureSatisfied, false);
  assert.equal(room.pendingAssignmentChoice, null);
  assert.equal(room.eventPhase.stage, 'assignment');
  assert.equal(room.eventPhase.assignmentIndex, room.eventPhase.assignmentQueue.length);
  assert.equal(Object.hasOwn(room.eventPhase, 'replacementQueue'), false);
  assert.equal(Object.hasOwn(room.eventPhase, 'replacementIndex'), false);
  assert.equal(normalizeAssignmentCompatibility(room, () => 0.5).changed, false);
}

// Финализация 6.7 восстанавливает поля этапа 6 и удаляет из старых сохранений
// отменённые экспедиции на Атлантию, Адию и Череп.
{
  const p = {
    id:'stage6-legacy',
    namedPlaceCards:[],
    legendaryCards:[],
    legendaryEffects:{ seaCurses:[] },
    activeExpedition:{ cardId:'expedition-atlantia', placeId:'atlantia', name:'Атлантия', acceptedRound:4, startedAtTarget:false, departedAfterIssue:false },
    expeditionHistory:[{ placeId:'atlantia', name:'Атлантия', cardId:'expedition-atlantia', completedRound:3 }],
  };
  const room = {
    round:5,
    islands:cloneIslands(),
    players:[p],
    legendaryPlacesExplored:{ kraken:p.id },
    assignmentDecks:createAssignmentDecks(()=>0.5),
    expeditionDeck:{ drawPile:createExpeditionDeck(()=>0.5).drawPile.concat([{ id:'expedition-atlantia', placeId:'atlantia', name:'Атлантия' }]) },
  };
  const result = normalizeStage6Compatibility(room,()=>0.5);
  assert.equal(result.changed,true);
  assert.deepEqual(p.namedPlaceCards.map(card=>card.id),['place-kraken']);
  assert.deepEqual(p.expeditionHistory,[]);
  assert.equal(p.activeExpedition,null);
  assert.equal(p.expeditionDrawRound,null);
  assert.equal(p.expeditionsDrawnThisRound,0);
  assert.equal(room.expeditionDeck.drawPile.length,7);
  assert.equal(room.expeditionDeck.drawPile.some(card=>['expedition-atlantia','expedition-adia','expedition-skull'].includes(card.id)),false);
  assert.deepEqual(room.pendingExpeditionRewards,[]);
  assert.equal(normalizeStage6Compatibility(room,()=>0.5).changed,false);
}

// Семь морских легендарных мест остаются координатными объектами карты, а три
// легендарных острова связаны с островами и открываются первым военным завоеванием.
{
  assert.equal(legendaryPlaceAt(24, 6)?.id, 'kraken');
  assert.equal(legendaryPlaceAt(12, 26)?.id, 'abyss');
  assert.equal(legendaryPlaceAt(0, 0), null);
  assert.equal(legendaryPlaceRule('kraken')?.kind, 'sea');
  assert.equal(legendaryPlaceForIsland('atlantia')?.id, 'atlantia');
  assert.equal(legendaryPlaceForIsland('adia')?.id, 'adia');
  assert.equal(legendaryPlaceForIsland('skull')?.id, 'skull');
  assert.equal(legendaryPlaceForIsland('kraken'), null);
}

// Первая отметка легендарного места закрепляет единственную открытую именную карту
// за первооткрывателем; повторный визит другого игрока её не передаёт.
{
  const room = { legendaryPlacesExplored: {} };
  const firstPlayer = { id: 'p1', namedPlaceCards: [], legendaryCards: [] };
  const secondPlayer = { id: 'p2', namedPlaceCards: [], legendaryCards: [] };
  const first = claimLegendaryPlaceDiscovery(room, firstPlayer, 'kraken', ()=>0.75);
  assert.equal(first.first, true);
  assert.equal(first.namedCard.id, 'place-kraken');
  assert.equal(first.legendaryCard.id, 'sea-curse');
  assert.equal(room.legendaryPlacesExplored.kraken, 'p1');
  assert.deepEqual(firstPlayer.namedPlaceCards.map(card=>card.id), ['place-kraken']);
  assert.deepEqual(firstPlayer.legendaryCards.map(card=>card.id), ['sea-curse']);
  const repeat = claimLegendaryPlaceDiscovery(room, secondPlayer, 'kraken', ()=>0);
  assert.equal(repeat.first, false);
  assert.equal(repeat.exploredBy, 'p1');
  assert.deepEqual(secondPlayer.namedPlaceCards, []);
  assert.deepEqual(secondPlayer.legendaryCards, []);
}

// Легендарный остров открывается первым военным завоеванием. Обычная военная
// награда острова остаётся отдельной; последующий захват не повторяет награду места.
{
  const islands = cloneIslands();
  const atlantia = islands.find(island => island.id === 'atlantia');
  atlantia.army = 0;
  const [row,col] = atlantia.cells[0];
  const firstPlayer = { id:'p1', name:'One', row, col, shipClass:'brigantine', level:1, upgrades:[], escorts:[], ducats:0, debt:0, armyPoints:0, attackCountsThisRound:{}, namedPlaceCards:[], legendaryCards:[] };
  const room = { round:2, islands, players:[firstPlayer], alliances:[], factionState:{}, legendaryPlacesExplored:{} };

  const first = jointAssaultIsland(room, firstPlayer, atlantia, [], [], { rng:()=>0.25 });
  assert.equal(first.ok, true);
  assert.equal(first.outcome, 'attacker');
  assert.equal(first.legendaryDiscovery.first, true);
  assert.equal(first.legendaryDiscovery.namedCard.id, 'place-atlantia');
  assert.equal(first.legendaryDiscovery.legendaryCard.id, 'hellfire');
  assert.equal(firstPlayer.ducats, 15);
  assert.deepEqual(firstPlayer.namedPlaceCards.map(card=>card.id), ['place-atlantia']);
  assert.deepEqual(firstPlayer.legendaryCards.map(card=>card.id), ['hellfire']);
  assert.equal(atlantia.rewardClaimed, true);

  firstPlayer.row = 0; firstPlayer.col = 0;
  const secondPlayer = { id:'p2', name:'Two', row, col, shipClass:'brigantine', level:1, upgrades:[], escorts:[], ducats:0, debt:0, armyPoints:0, attackCountsThisRound:{}, namedPlaceCards:[], legendaryCards:[] };
  room.players.push(secondPlayer);
  const second = jointAssaultIsland(room, secondPlayer, atlantia);
  assert.equal(second.ok, true);
  assert.equal(second.outcome, 'attacker');
  assert.equal(second.legendaryDiscovery, undefined);
  assert.equal(secondPlayer.ducats, 0);
  assert.deepEqual(secondPlayer.namedPlaceCards, []);
  assert.deepEqual(secondPlayer.legendaryCards, []);
  assert.equal(room.legendaryPlacesExplored.atlantia, 'p1');
}

// Экспедиционная колода содержит только 7 морских мест. Получение возможно только
// за одно действие на клетке собственного острова с Картографической палатой.
{
  const expeditionDeck = createExpeditionDeck(() => 0.5);
  assert.equal(expeditionDeck.drawPile.length, 7);
  const krakenIndex = expeditionDeck.drawPile.findIndex(card => card.id === 'expedition-kraken');
  const [krakenCard] = expeditionDeck.drawPile.splice(krakenIndex, 1);
  expeditionDeck.drawPile.unshift(krakenCard);

  const islands = cloneIslands();
  const home = islands.find(island => island.id === 'maikan');
  home.ownerId = 'p1';
  home.buildings = [{ type:'farm', level:1 }, { type:'cartography', level:1 }];
  const [homeRow,homeCol] = home.cells[0];
  const p = {
    id:'p1',
    row:homeRow,
    col:homeCol,
    activeExpedition:null,
    expeditionHistory:[],
    expeditionDrawRound:null,
    expeditionsDrawnThisRound:0,
  };
  const room = { round:2, islands, players:[p], expeditionDeck };

  assert.equal(canTakeExpedition(room, p).ok, true);
  const taken = takeExpedition(room, p, () => 0.5);
  assert.equal(taken.ok, true);
  assert.equal(taken.actionCost, 1);
  assert.equal(taken.expedition.cardId, 'expedition-kraken');
  assert.equal(taken.requiresLeaveAndReturn, false);
  assert.equal(room.expeditionDeck.drawPile.length, 6);
  assert.equal(canTakeExpedition(room, p).ok, false);

  p.row = LEGENDARY_PLACES.kraken.row;
  p.col = LEGENDARY_PLACES.kraken.col;
  const completed = completeExpeditionAtArrival(room, p, () => 0.5);
  assert.equal(completed.completed, true);
  assert.equal(p.activeExpedition, null);
  assert.deepEqual(p.expeditionHistory.map(item=>item.placeId), ['kraken']);
  assert.equal(room.expeditionDeck.drawPile.length, 7);
  assert.equal(canTakeExpedition(room, p).ok, false); // не у своего острова и выдача этого раунда использована

  room.round = 3;
  p.row = homeRow; p.col = homeCol;
  const returnedIndex = room.expeditionDeck.drawPile.findIndex(card => card.id === 'expedition-kraken');
  const [returnedKraken] = room.expeditionDeck.drawPile.splice(returnedIndex, 1);
  room.expeditionDeck.drawPile.unshift(returnedKraken);
  const next = takeExpedition(room, p, () => 0.5);
  assert.equal(next.ok, true);
  assert.notEqual(next.expedition.placeId, 'kraken'); // завершённое место временно откладывается
  assert.equal(room.expeditionDeck.drawPile.some(card => card.id === 'expedition-kraken'), true); // затем возвращается и перемешивается
}

// Новый цифровой канон: экспедиций на Атлантию, Адию и Череп нет.
{
  const expeditionDeck = createExpeditionDeck(() => 0.5);
  assert.equal(expeditionDeck.drawPile.length, 7);
  assert.equal(expeditionDeck.drawPile.some(card => ['atlantia','adia','skull'].includes(card.placeId)), false);
}

// Все шесть государств присутствуют в политическом runtime. Итоговые призы — только денежные;
// авторское решение фиксирует итоговый приз Кадингира в 50 дукатов.
{
  assert.deepEqual(
    ['lionia','kadingir','mori','mayo','suniksiya','pirates'].filter(id => Boolean(FACTIONS[id])),
    ['lionia','kadingir','mori','mayo','suniksiya','pirates']
  );
  assert.deepEqual(
    [FACTIONS.lionia.fullConquestPrize.ducats, FACTIONS.kadingir.fullConquestPrize.ducats, FACTIONS.mori.fullConquestPrize.ducats, FACTIONS.mayo.fullConquestPrize.ducats, FACTIONS.suniksiya.fullConquestPrize.ducats, FACTIONS.pirates.fullConquestPrize.ducats],
    [60,50,40,10,30,20]
  );
  assert.equal(FACTIONS.kadingir.fullConquestPrize.amountUnresolved, undefined);
  assert.equal(FACTIONS.lionia.fullConquestPrize.preserveBuildings, undefined);
  assert.equal(FACTIONS.lionia.fullConquestPrize.razeDucats, undefined);
}

// Последний остров, которым ещё владеет само государство, прекращает Лионию и даёт приз инициатору,
// даже если прежние острова Лионии принадлежат другим игрокам. Вассал освобождается, вражда исчезает.
{
  const room = { islands: cloneIslands(), players: [], factionState: {}, round: 3 };
  const landin = room.islands.find(i => i.id === 'landin');
  const frandia = room.islands.find(i => i.id === 'frandia');
  const eidon = room.islands.find(i => i.id === 'eidon');
  landin.ownerId = 'other';
  frandia.ownerId = 'vassal';
  eidon.army = 0;
  eidon.buildings = [{ type: 'farm', level: 1 }, { type: 'market', level: 1 }];
  const attacker = { id: 'attacker', row: eidon.cells[0][0], col: eidon.cells[0][1], shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, debt: 0, enemyFactionIds: ['lionia'] };
  const vassal = { id: 'vassal', suzerainId: 'lionia', vassalGiftIslandId: 'frandia', enemyFactionIds: [], activeAssignment: null };
  const enemy = { id: 'enemy', suzerainId: null, vassalGiftIslandId: null, enemyFactionIds: ['lionia'] };
  room.players.push(attacker, vassal, enemy, { id: 'other' });
  refreshFactionExistence(room);
  assert.deepEqual(stateOwnedIslandIds(room, 'lionia'), ['eidon']);
  const result = assaultIsland(room, attacker, eidon);
  assert.equal(result.outcome, 'attacker');
  assert.equal(result.statePrize.triggered, true);
  assert.equal(result.statePrize.ducats, 60);
  assert.equal(attacker.ducats, 60); // 30 острова не складываются с итоговыми 60
  assert.equal(result.captureRetention, null);
  assert.equal(eidon.buildings.length, 2); // государственные постройки не делятся пополам как постройки игрока
  assert.equal(room.factionState.lionia.ceased, true);
  assert.equal(stateExists(room, 'lionia'), false);
  refreshFactionExistence(room);
  assert.equal(vassal.suzerainId, null);
  assert.equal(frandia.ownerId, 'vassal'); // распад государства не отбирает подаренный остров
  assert.deepEqual(attacker.enemyFactionIds, []);
  assert.deepEqual(enemy.enemyFactionIds, []);
  assert.equal(addEnmity(room, enemy, 'lionia').ok, false);
}

// Мирная передача единственного острова вассалу не прекращает государство и не даёт итоговый приз.
{
  const room = { islands: cloneIslands(), players: [], factionState: {}, round: 2 };
  const island = room.islands.find(i => i.id === 'kadingir');
  const p = { id: 'p1', row: island.cells[0][0], col: island.cells[0][1], suzerainId: null, vassalGiftIslandId: null, enemyFactionIds: [], ducats: 0 };
  room.players.push(p);
  assert.equal(enterVassalage(room, p, 'kadingir').ok, true);
  assert.equal(island.ownerId, p.id);
  assert.equal(stateOwnedIslandIds(room, 'kadingir').length, 0);
  assert.equal(stateExists(room, 'kadingir'), true);
  assert.equal(room.factionState.kadingir?.fullConquestClaimed || false, false);
}

// Действующий вассал блокирует второго даже после утраты подаренного острова.
{
  const room = { islands: cloneIslands(), players: [], factionState: {} };
  const landin = room.islands.find(i => i.id === 'landin');
  const first = { id: 'a', row: landin.cells[0][0], col: landin.cells[0][1], suzerainId: null, vassalGiftIslandId: null, enemyFactionIds: [] };
  const second = { id: 'b', row: landin.cells[0][0], col: landin.cells[0][1], suzerainId: null, vassalGiftIslandId: null, enemyFactionIds: [] };
  room.players.push(first, second);
  assert.equal(enterVassalage(room, first, 'lionia').ok, true);
  room.islands.find(i => i.id === 'frandia').ownerId = 'third';
  assert.equal(canEnterVassalage(room, second, 'lionia').ok, false);
}

// Сёгунат Мори участвует в подданстве и имеет свою десятикарточную колоду поручений в 5.8.1.
{
  const room = { islands: cloneIslands(), players: [], factionState: {} };
  const mori = room.islands.find(i => i.id === 'mori');
  const p = { id: 'p1', row: mori.cells[0][0], col: mori.cells[0][1], suzerainId: null, vassalGiftIslandId: null, enemyFactionIds: [] };
  room.players.push(p);
  const joined = enterVassalage(room, p, 'mori');
  assert.equal(joined.ok, true);
  assert.equal(joined.gift.id, 'miyosi');
  assert.equal(p.suzerainId, 'mori');
  assert.equal(ASSIGNMENT_CARDS.mori.length, 10);
}

// Авторское решение по Кадингиру: итоговый приз равен 50 дукатам.
// Он заменяет денежную награду карточки последнего государственного острова и не складывается с её 30 дукатами.
{
  const room = { islands: cloneIslands(), players: [], factionState: {}, round: 2 };
  const island = room.islands.find(i => i.id === 'kadingir');
  island.army = 0;
  const p = { id: 'p1', row: island.cells[0][0], col: island.cells[0][1], shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, debt: 0, glory: 0, enemyFactionIds: [] };
  room.players.push(p);
  const result = assaultIsland(room, p, island);
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'attacker');
  assert.equal(result.statePrize.triggered, true);
  assert.equal(result.statePrize.amountUnresolved, false);
  assert.equal(result.statePrize.ducats, 50);
  assert.equal(result.statePrize.playerId, p.id);
  assert.equal(p.ducats, 50);
  assert.equal(result.rewardNotes.some(note => note.includes('итоговый приз Царство Кадингир: +50 дукатов')), true);
  assert.equal(island.buildings.length, 0); // legacy Банк I больше не подмешивается к карточке Кадингира
  assert.equal(stateExists(room, 'kadingir'), false);
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

// Четыре редких промысла вообще не имеют уровней: требуют свой ресурс и ферму/
// поместье, стоят по данным rules/ и существуют как одноэтапные постройки без I/II/III.
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
    assert.equal(Object.hasOwn(island.buildings[index], 'level'), false);
    assert.equal(canUpgradeBuilding(room, p, island, index).ok, false);
    assert.equal(build(room, p, island.id, type).ok, false);
    island.buildings = [{ type: 'farm', level: 1 }];
    island.resources = [];
    assert.equal(build(room, p, island.id, type).ok, false);
  }
}

// Арсенал снаряжает одну роту бесплатно за действие. Рота занимает весь основной
// трюм: существующий груз автоматически сбрасывается без выручки, а сила фиксируется
// по уровню арсенала в момент снаряжения.
{
  const room = { islands: cloneIslands(), players: [] };
  const home = room.islands.find(i => i.id === 'bogamia');
  home.ownerId = 'p1';
  home.buildings = [{ type: 'arsenal', level: 2 }];
  const p = {
    id: 'p1', row: home.cells[0][0], col: home.cells[0][1],
    shipClass: 'brigantine', level: 2, upgrades: [], escorts: [], ducats: 0,
    cargo: { goodId: 'wood', quantity: 2 },
  };
  room.players.push(p);
  assert.equal(canFormLandCompany(room, p, home).ok, true);
  const formed = formLandCompany(room, p, home.id);
  assert.equal(formed.company.army, 4);
  assert.deepEqual(formed.discardedCargo, { goodId: 'wood', quantity: 2 });
  assert.equal(p.cargo, null);
  assert.equal(landCompanyAssaultArmy(p), 4);
  assert.equal(canLoadCargo(room, p, home, 'provisions', 'main').ok, false);

  // Понижение арсенала/уровня корабля не пересчитывает уже подготовленную силу.
  home.buildings[0].level = 1;
  p.level = 1;
  assert.equal(landCompanyAssaultArmy(p), 4);

  // Добровольный возврат возможен только у собственного острова с арсеналом.
  p.row = 13; p.col = 13;
  assert.equal(canDismissLandCompany(room, p).ok, false);
  assert.equal(dismissLandCompany(room, p).ok, false);
  p.row = home.cells[0][0]; p.col = home.cells[0][1];
  assert.equal(canDismissLandCompany(room, p).ok, true);
  assert.equal(dismissLandCompany(room, p).ok, true);
  assert.equal(p.landCompany, null);
}

// Рота участвует только в штурме: после проигранного штурма она сбрасывается,
// при победе или ничьей сохраняется.
{
  const room = { islands: cloneIslands(), players: [] };
  const home = room.islands.find(i => i.id === 'bogamia');
  home.ownerId = 'p1';
  home.buildings = [{ type: 'arsenal', level: 2 }];
  const p = { id: 'p1', row: home.cells[0][0], col: home.cells[0][1], shipClass: 'brigantine', level: 1, upgrades: [], escorts: [], ducats: 0, cargo: null };
  room.players.push(p);
  formLandCompany(room, p, home.id);
  const enemy = room.islands.find(i => i.id === 'adia');
  p.row = enemy.cells[0][0]; p.col = enemy.cells[0][1];
  const loss = assaultIsland(room, p, enemy);
  assert.equal(loss.ok, true);
  assert.equal(loss.outcome, 'defender');
  assert.equal(p.landCompany, null);

  const room2 = { islands: cloneIslands(), players: [] };
  const weak = room2.islands.find(i => i.id === 'agmor');
  const p2 = { id: 'p2', row: weak.cells[0][0], col: weak.cells[0][1], shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, cargo: null, landCompany: { army: 3, arsenalLevel: 1 } };
  room2.players.push(p2);
  const win = assaultIsland(room2, p2, weak);
  assert.equal(win.outcome, 'attacker');
  assert.equal(p2.landCompany.army, 3);
}

// Городская стража и постоянный гарнизон используют канонические три варианта
// покупки: стража города 5/+1, замена стражи в крупном порту 10/+3,
// прямая покупка в крупном порту 15/+2.
{
  const room = { islands: cloneIslands(), players: [] };
  const island = room.islands.find(i => i.id === 'raisk');
  island.ownerId = 'p1';
  island.buildings = [
    { type: 'manor', level: 1 }, { type: 'farm', level: 1 }, { type: 'fort', level: 1 },
    { type: 'market', level: 1 }, { type: 'lumbermill', level: 1 }, { type: 'quarry', level: 1 },
  ];
  const p = { id: 'p1', row: 13, col: 13, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 100 };
  room.players.push(p);
  assert.equal(islandStatus(island), 'Город');
  const guard = buyCityGuard(room, p, island.id);
  assert.equal(guard.ok, true);
  assert.equal(guard.price, 5);
  assert.equal(islandDefenseArmy(room, island).hiredGarrison, 1);

  island.buildings = [
    { type: 'manor', level: 2 },
    { type: 'shipyard', level: 1 }, { type: 'stoneworks', level: 1 },
    { type: 'arsenal', level: 1 }, { type: 'fortress', level: 1 },
    { type: 'bank', level: 1 }, { type: 'lumbermill', level: 1 },
  ];
  assert.equal(islandStatus(island), 'Крупный порт');
  const upgraded = buyPermanentGarrison(room, p, island.id);
  assert.deepEqual([upgraded.mode, upgraded.price, upgraded.defense], ['upgrade', 10, 3]);
  assert.equal(islandDefenseArmy(room, island).hiredGarrison, 3);

  island.buildings = [
    { type: 'manor', level: 1 }, { type: 'farm', level: 1 }, { type: 'fort', level: 1 },
    { type: 'market', level: 1 }, { type: 'lumbermill', level: 1 }, { type: 'quarry', level: 1 },
  ];
  assert.equal(islandDefenseArmy(room, island).hiredGarrison, 3);
  assert.equal(island.garrisonType, 'guard');

  island.buildings = [{ type: 'farm', level: 1 }];
  assert.equal(islandDefenseArmy(room, island).hiredGarrison, 0);
  assert.equal(island.garrisonType, null);

  island.buildings = [
    { type: 'manor', level: 2 },
    { type: 'shipyard', level: 1 }, { type: 'stoneworks', level: 1 },
    { type: 'arsenal', level: 1 }, { type: 'fortress', level: 1 },
    { type: 'bank', level: 1 }, { type: 'lumbermill', level: 1 },
  ];
  assert.equal(canBuyCityGuard(room, p, island).ok, false);
  const direct = buyPermanentGarrison(room, p, island.id);
  assert.deepEqual([direct.mode, direct.price, direct.defense], ['direct', 15, 2]);
  assert.equal(islandDefenseArmy(room, island).hiredGarrison, 2);
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


// Финальный smoke 5.9: активные потребители этапа 5 работают совместно в одном runtime.
// Союзный морской бой расходует единый предел каждого атакующего, начисляет очки флота;
// исчезновение государства выдаёт итоговый приз; налоговая санкция использует тот же политический профиль.
{
  const battleRoom = { round: 2, islands: cloneIslands(), players: [], alliances: [] };
  const a = { id: 'stage5-a', name: 'A', row: 10, col: 10, shipClass: 'frigate', level: 2, upgrades: [], escorts: [], ducats: 5, brokenAlliesThisTurn: [] };
  const ally = { id: 'stage5-ally', name: 'Ally', row: 9, col: 10, shipClass: 'frigate', level: 1, upgrades: [], escorts: [], ducats: 0, brokenAlliesThisTurn: [] };
  const target = { id: 'stage5-target', name: 'Target', row: 10, col: 10, shipClass: 'brigantine', level: 3, upgrades: [], escorts: [], ducats: 3, brokenAlliesThisTurn: [] };
  battleRoom.players = [a, ally, target];
  assert.equal(addAlliance(battleRoom, a.id, ally.id), true);
  const sea = jointSeaBattle(battleRoom, a, target, [ally.id], []);
  assert.equal(sea.ok, true);
  assert.equal(sea.outcome, 'attacker');
  assert.equal(a.fleetPoints, 2);
  assert.equal(ally.fleetPoints, 2);
  assert.equal(canAttackPlayerThisRound(battleRoom, a, target.id).ok, false);
  assert.equal(canAttackPlayerThisRound(battleRoom, ally, target.id).ok, false);
  assert.equal(jointSeaBattle(battleRoom, a, target, [ally.id], []).ok, false);

  const stateRoom = { islands: cloneIslands(), players: [], factionState: {}, round: 2 };
  const kadingir = stateRoom.islands.find(i => i.id === 'kadingir');
  kadingir.army = 0;
  const conqueror = {
    id: 'stage5-conqueror', row: kadingir.cells[0][0], col: kadingir.cells[0][1],
    shipClass: 'caravel', level: 1, upgrades: [], escorts: [], ducats: 0, debt: 0, enemyFactionIds: [],
  };
  stateRoom.players = [conqueror];
  const conquest = assaultIsland(stateRoom, conqueror, kadingir);
  assert.equal(conquest.outcome, 'attacker');
  assert.equal(conquest.statePrize.triggered, true);
  assert.equal(conquest.statePrize.ducats, 50);
  assert.equal(conqueror.ducats, 50);
  assert.equal(stateExists(stateRoom, 'kadingir'), false);

  const taxed = { ducats: 1, debt: 0, nextActionLimit: null };
  const tax = settleVassalTax(taxed, 'lionia');
  assert.equal(tax.underpaid, true);
  assert.equal(tax.paid, 1);
  assert.equal(taxed.nextActionLimit, 2);

  const assignmentDecks = createAssignmentDecks(() => 0.5);
  assert.equal(Object.values(assignmentDecks).reduce((sum, deck) => sum + deck.drawPile.length, 0), 49);
  assert.deepEqual(Object.keys(createFeudDecks(() => 0.5)), ['lionia','kadingir','mori','mayo','suniksiya','pirates']);
}

console.log('game-logic tests: OK');
