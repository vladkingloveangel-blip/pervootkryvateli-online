const {
  SHIPS,
  SHIP_LEVELS,
  SHIP_UPGRADES,
  ESCORTS,
  MILITARY_REWARDS,
  BUILDINGS,
  BUILDING_UPGRADES,
  GOODS,
  ISLAND_DEFS,
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
} = require('./game-data');

function cloneIslands() {
  return ISLAND_DEFS.map(def => ({
    ...def,
    cells: def.cells.map(([r, c]) => [r, c]),
    resources: [...def.resources],
    ownerId: null,
    buildings: [],
    rewardClaimed: false,
    firstMilitaryConquered: false,
    loadedRound: null,
    legendaryVeil: null,
    garrisonType: null,
  }));
}

function islandIdsAt(row, col) {
  return ISLAND_BY_CELL.get(cellKey(row, col)) || [];
}

function islandAt(room, row, col) {
  const ids = islandIdsAt(row, col);
  return ids.map(id => room.islands.find(i => i.id === id)).filter(Boolean);
}

const SPECIAL_LAND_SET = new Set(SPECIAL_LAND.map(([r, c]) => cellKey(r, c)));
const CITADEL_SET = new Set(CITADEL_CELLS.map(([r, c]) => cellKey(r, c)));
const LAND_SET = new Set(LAND_CELLS.map(([r, c]) => cellKey(r, c)));

function isCitadelCell(row, col) {
  return CITADEL_SET.has(cellKey(row, col));
}

function isCoast(row, col) {
  return islandIdsAt(row, col).length > 0 || SPECIAL_LAND_SET.has(cellKey(row, col));
}

function isLand(row, col) {
  return LAND_SET.has(cellKey(row, col)) || SPECIAL_LAND_SET.has(cellKey(row, col));
}

function hazardAt(row, col) {
  return HAZARD_BY_CELL.get(cellKey(row, col)) || null;
}

function hazardAllowed(shipClass, hazard) {
  if (!hazard) return true;
  if (hazard === 'reef') return shipClass === 'frigate';
  if (hazard === 'ice') return shipClass === 'carrack';
  if (hazard === 'shoal') return shipClass === 'brigantine';
  return false;
}


function anchorAt(row, col) {
  const color = ANCHOR_BY_CELL.get(cellKey(row, col)) || null;
  return color ? { color, ...ANCHORS[color] } : null;
}

function shuffleCards(cards, rng = Math.random) {
  const out = cards.map(card => ({ ...card }));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.max(0, Math.min(0.999999999, Number(rng()) || 0)) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function createAnchorDecks(rng = Math.random) {
  const decks = {};
  for (const [color, defs] of Object.entries(ANCHOR_CARDS)) {
    const cards = [];
    for (const def of defs) {
      const count = Math.max(1, Number(def.quantity) || 1);
      for (let i = 0; i < count; i++) cards.push({ ...def, copy: i + 1 });
    }
    decks[color] = { drawPile: shuffleCards(cards, rng), discard: [] };
  }
  return decks;
}

function drawAnchorCard(room, color, rng = Math.random) {
  if (!ANCHOR_CARDS[color]) return null;
  room.anchorDecks ||= createAnchorDecks(rng);
  room.anchorDecks[color] ||= { drawPile: [], discard: [] };
  const deck = room.anchorDecks[color];
  if (!deck.drawPile.length && deck.discard.length) {
    deck.drawPile = shuffleCards(deck.discard, rng);
    deck.discard = [];
  }
  const card = deck.drawPile.shift() || null;
  return card ? { card, deck } : null;
}


function expandCardDefinitions(defs) {
  const cards = [];
  for (const def of defs || []) {
    const count = Math.max(1, Number(def.quantity) || 1);
    for (let i = 0; i < count; i++) cards.push({ ...def, copy: i + 1 });
  }
  return cards;
}

function createSailingEventDeck(rng = Math.random) {
  return { drawPile: shuffleCards(expandCardDefinitions(SAILING_EVENT_CARDS), rng), discard: [] };
}

function createTreasureDeck(rng = Math.random) {
  return { drawPile: shuffleCards(expandCardDefinitions(TREASURE_CARDS), rng), discard: [] };
}

function createLegendaryDeck(rng = Math.random) {
  return { drawPile: shuffleCards(expandCardDefinitions(LEGENDARY_CARDS), rng), discard: [] };
}

function drawCyclingDeckCard(deck, rng = Math.random) {
  if (!deck) return null;
  if (!deck.drawPile?.length && deck.discard?.length) {
    deck.drawPile = shuffleCards(deck.discard, rng);
    deck.discard = [];
  }
  return deck.drawPile?.shift() || null;
}

function drawSailingEventCard(room, rng = Math.random) {
  room.eventDeck ||= createSailingEventDeck(rng);
  return drawCyclingDeckCard(room.eventDeck, rng);
}

function drawTreasureCard(room, rng = Math.random) {
  room.treasureDeck ||= createTreasureDeck(rng);
  return drawCyclingDeckCard(room.treasureDeck, rng);
}

function drawLegendaryCard(room, rng = Math.random) {
  room.legendaryDeck ||= createLegendaryDeck(rng);
  return drawCyclingDeckCard(room.legendaryDeck, rng);
}

function discardDeckCard(deck, card) {
  if (!deck || !card) return;
  deck.discard ||= [];
  deck.discard.push({ ...card });
}



function createFeudDecks(rng = Math.random) {
  const out = {};
  for (const factionId of POLITICAL_FACTION_ORDER) {
    out[factionId] = { drawPile: shuffleCards(expandCardDefinitions(FEUD_CARDS[factionId] || []), rng), discard: [] };
  }
  return out;
}

function drawFeudCard(room, factionId, rng = Math.random) {
  room.feudDecks ||= createFeudDecks(rng);
  const deck = room.feudDecks[factionId];
  return deck ? drawCyclingDeckCard(deck, rng) : null;
}



function createAssignmentDecks(rng = Math.random) {
  const out = {};
  for (const factionId of Object.keys(ASSIGNMENT_CARDS)) {
    out[factionId] = { drawPile: shuffleCards(expandCardDefinitions(ASSIGNMENT_CARDS[factionId] || []), rng), discard: [] };
  }
  return out;
}

function assignmentCardPossible(room, player, card) {
  if (!room || !player || !card) return false;
  if (card.type === 'capture-island') {
    const island = room.islands?.find(i => i.id === card.islandId);
    return Boolean(island && island.ownerId !== player.id);
  }
  if (card.type === 'ship-level') return (Number(player.level) || 1) < 7;
  if (card.type === 'stat-upgrade') {
    const installed = new Set(player.upgrades || []);
    return Object.values(SHIP_UPGRADES).some(u => u.branch === card.branch && !installed.has(u.id));
  }
  if (card.type === 'build-branch' && card.islandId) return Boolean(room.islands?.some(i => i.id === card.islandId));
  if (card.type === 'build-type' && card.resource) return Boolean(room.islands?.some(i => (i.resources || []).includes(card.resource)));
  if (card.type === 'visit-place') return Boolean(LEGENDARY_PLACES[card.placeId]);
  return true;
}

function drawAssignmentCard(room, player, factionId, rng = Math.random) {
  room.assignmentDecks ||= createAssignmentDecks(rng);
  const deck = room.assignmentDecks[factionId];
  if (!deck) return null;
  if (!deck.drawPile?.length && deck.discard?.length) {
    deck.drawPile = shuffleCards(deck.discard, rng);
    deck.discard = [];
  }
  const attempts = deck.drawPile?.length || 0;
  const skipped = [];
  let card = null;
  for (let i = 0; i < attempts; i++) {
    const candidate = deck.drawPile.shift();
    if (!candidate) break;
    if (assignmentCardPossible(room, player, candidate)) { card = candidate; break; }
    skipped.push(candidate);
  }
  if (skipped.length) deck.drawPile.push(...shuffleCards(skipped, rng));
  return card;
}

function discardAssignmentCard(room, factionId, card) {
  if (!room?.assignmentDecks?.[factionId] || !card) return;
  discardDeckCard(room.assignmentDecks[factionId], card);
}

function ensureAssignmentPlayer(player) {
  if (!player) return player;
  player.activeAssignment ||= null;
  player.replacedAssignmentConditions ||= [];
  return player;
}

function issueAssignment(room, player, factionId, rng = Math.random) {
  ensureAssignmentPlayer(player);
  if (player.activeAssignment) return { ok: false, error: 'У игрока уже есть активное поручение.' };
  const card = drawAssignmentCard(room, player, factionId, rng);
  if (!card) return { ok: false, empty: true, error: 'Подходящего поручения сейчас нет.' };
  player.activeAssignment = {
    instanceId: `${factionId}:${card.id}:${Date.now()}:${Math.floor((Number(rng()) || 0) * 1e9)}`,
    factionId,
    card: { ...card },
    issuedRound: Number(room.round) || 1,
  };
  return { ok: true, assignment: player.activeAssignment };
}

function canReplaceAssignment(player) {
  ensureAssignmentPlayer(player);
  if (!player.activeAssignment) return { ok: false, error: 'Нет активного поручения.' };
  if ((Number(player.ducats) || 0) < 2) return { ok: false, error: 'Для замены поручения нужно 2 дуката.' };
  const key = player.activeAssignment.card?.conditionKey;
  if (key && player.replacedAssignmentConditions.includes(key)) return { ok: false, error: 'Поручение с таким условием уже заменялось вами за плату в этой партии.' };
  return { ok: true };
}

function replaceAssignment(room, player, rng = Math.random) {
  const allowed = canReplaceAssignment(player);
  if (!allowed.ok) return allowed;
  const previous = player.activeAssignment;
  const key = previous.card?.conditionKey;
  player.ducats -= 2;
  if (key && !player.replacedAssignmentConditions.includes(key)) player.replacedAssignmentConditions.push(key);
  discardAssignmentCard(room, previous.factionId, previous.card);
  player.activeAssignment = null;
  const next = issueAssignment(room, player, player.suzerainId || previous.factionId, rng);
  return { ok: true, previous, next: next.ok ? next.assignment : null, noReplacement: !next.ok };
}

function assignmentEventMatches(player, event) {
  const assignment = player?.activeAssignment;
  const card = assignment?.card;
  if (!assignment || !card || !event) return false;
  if (card.type === 'capture-island') return event.type === 'capture-island' && event.islandId === card.islandId;
  if (card.type === 'build-branch') return event.type === 'building-action' && event.branch === card.branch && (!card.islandId || event.islandId === card.islandId);
  if (card.type === 'build-type') return event.type === 'building-action' && event.buildingType === card.buildingType && (!card.resource || (event.islandResources || []).includes(card.resource));
  if (card.type === 'ship-level') return event.type === 'ship-level';
  if (card.type === 'stat-upgrade') return event.type === 'ship-upgrade' && event.branch === card.branch;
  if (card.type === 'anchor-win') return event.type === 'anchor-win' && (card.colors || []).includes(event.color);
  if (card.type === 'visit-place') return event.type === 'visit-place' && event.placeId === card.placeId;
  if (card.type === 'attack-player-island') return event.type === 'attack-player-island';
  if (card.type === 'treasure-resolved') return event.type === 'treasure-resolved';
  if (card.type === 'delivery') {
    if (event.type !== 'delivery') return false;
    if (event.assignmentInstanceId !== assignment.instanceId) return false;
    return !card.goodIds || card.goodIds.includes(event.goodId);
  }
  return false;
}

function completeAssignment(room, player, event) {
  ensureAssignmentPlayer(player);
  if (!assignmentEventMatches(player, event)) return { ok: false, matched: false };
  const assignment = player.activeAssignment;
  const card = assignment.card;
  const faction = FACTIONS[assignment.factionId] || {};
  const gross = Math.max(0, Math.floor(Number(card.reward) || 0));
  const withheld = faction.rewardShare ? Math.floor(gross * Number(faction.rewardShare)) : 0;
  const paid = Math.max(0, gross - withheld);
  const credit = creditDucats(player, paid);
  discardAssignmentCard(room, assignment.factionId, card);
  player.activeAssignment = null;
  return { ok: true, matched: true, assignment, gross, withheld, paid, credit };
}

function legendaryPlaceAt(row, col) {
  return Object.values(LEGENDARY_PLACES).find(p => p.row === Number(row) && p.col === Number(col)) || null;
}

function factionIdByName(name) {
  return POLITICAL_FACTION_ORDER.find(id => FACTIONS[id]?.name === name) || null;
}

function factionIdForIsland(island) {
  if (!island?.faction) return null;
  return factionIdByName(island.faction);
}

function ensurePoliticalPlayer(player) {
  if (!player) return player;
  player.suzerainId ||= null;
  player.vassalGiftIslandId ||= null;
  player.enemyFactionIds ||= [];
  return player;
}

function stateExists(room, factionId) {
  const faction = FACTIONS[factionId];
  if (!room || !faction) return false;
  for (const islandId of faction.originalIslandIds || []) {
    const island = room.islands?.find(i => i.id === islandId);
    if (!island) continue;
    if (!island.ownerId) return true;
    const owner = room.players?.find(p => p.id === island.ownerId);
    if (owner?.suzerainId === factionId) return true;
  }
  return false;
}

function refreshFactionExistence(room) {
  room.factionState ||= {};
  const changes = [];
  for (const factionId of POLITICAL_FACTION_ORDER) {
    const before = room.factionState[factionId]?.exists;
    const exists = stateExists(room, factionId);
    room.factionState[factionId] ||= { exists: true };
    room.factionState[factionId].exists = exists;
    if (before !== undefined && before !== exists) changes.push({ factionId, before, exists });
    if (!exists) {
      for (const player of room.players || []) {
        ensurePoliticalPlayer(player);
        player.enemyFactionIds = player.enemyFactionIds.filter(id => id !== factionId);
        if (player.suzerainId === factionId) {
          if (player.activeAssignment?.card) discardAssignmentCard(room, factionId, player.activeAssignment.card);
          player.suzerainId = null;
          player.vassalGiftIslandId = null;
          player.activeAssignment = null;
        }
      }
    }
  }
  return changes;
}


function fullSubjugationController(room, factionId) {
  const faction = FACTIONS[factionId];
  if (!room || !faction?.originalIslandIds?.length) return null;
  let ownerId = null;
  for (const islandId of faction.originalIslandIds) {
    const island = room.islands?.find(i => i.id === islandId);
    if (!island?.ownerId) return null;
    if (ownerId == null) ownerId = island.ownerId;
    if (island.ownerId !== ownerId) return null;
  }
  return ownerId;
}

function buildingSpecKey(spec) {
  return `${String(spec?.type || '')}:${Math.max(1, Number(spec?.level) || 1)}`;
}

function subtractBuildingRewards(prizeBuildings, overlappingBuildings) {
  const overlap = new Map();
  for (const spec of overlappingBuildings || []) {
    const key = buildingSpecKey(spec);
    overlap.set(key, (overlap.get(key) || 0) + 1);
  }
  const remaining = [];
  const deduplicated = [];
  for (const spec of prizeBuildings || []) {
    const key = buildingSpecKey(spec);
    const count = overlap.get(key) || 0;
    if (count > 0) {
      overlap.set(key, count - 1);
      deduplicated.push({ ...spec });
    } else {
      remaining.push({ ...spec });
    }
  }
  return { remaining, deduplicated };
}

function claimFullSubjugationPrize(room, player, factionId, captureMode = 'preserve', overlappingBuildings = []) {
  const faction = FACTIONS[factionId];
  if (!room || !player || !faction?.fullConquestPrize) return null;
  room.factionState ||= {};
  room.factionState[factionId] ||= { exists: stateExists(room, factionId) };
  const state = room.factionState[factionId];
  if (state.fullConquestClaimed) return null;
  if (fullSubjugationController(room, factionId) !== player.id) return null;

  const mode = captureMode === 'raze' ? 'raze' : 'preserve';
  const prize = faction.fullConquestPrize;
  state.fullConquestClaimed = true;
  state.fullConquestPlayerId = player.id;
  state.fullConquestMode = mode;
  state.fullConquestRound = Number(room.round) || null;

  if (mode === 'raze') {
    return {
      triggered: true,
      factionId,
      factionName: faction.name,
      mode,
      ducats: Math.max(0, Math.floor(Number(prize.razeDucats) || 0)),
      buildings: [],
      allBuildings: [],
      deduplicatedBuildings: [],
    };
  }

  const allBuildings = (prize.preserveBuildings || []).map(spec => ({ ...spec }));
  const dedupe = subtractBuildingRewards(allBuildings, overlappingBuildings);
  return {
    triggered: true,
    factionId,
    factionName: faction.name,
    mode,
    ducats: 0,
    buildings: dedupe.remaining,
    allBuildings,
    deduplicatedBuildings: dedupe.deduplicated,
  };
}

function addEnmity(room, player, factionId) {
  if (!player || !FACTIONS[factionId] || !stateExists(room, factionId)) return { ok: false, added: false };
  ensurePoliticalPlayer(player);
  if (player.enemyFactionIds.includes(factionId)) return { ok: true, added: false };
  player.enemyFactionIds.push(factionId);
  return { ok: true, added: true, faction: FACTIONS[factionId] };
}

function canEnterVassalage(room, player, factionId) {
  const faction = FACTIONS[factionId];
  if (!room || !player || !faction) return { ok: false, error: 'Государство не найдено.' };
  ensurePoliticalPlayer(player);
  if (!faction.canHaveVassal) return { ok: false, error: `${faction.name} не принимает подданство.` };
  if (!stateExists(room, factionId)) return { ok: false, error: `${faction.name} больше не существует.` };
  if (player.suzerainId) return { ok: false, error: 'Игрок может быть вассалом только одного государства.' };
  if (player.enemyFactionIds.includes(factionId)) return { ok: false, error: 'Правила не описывают вступление в подданство при действующей вражде; в MVP сначала это состояние должно исчезнуть вместе с государством.' };
  const gift = room.islands?.find(i => i.id === faction.giftIslandId);
  if (!gift || gift.ownerId) return { ok: false, error: 'Остров, который сюзерен должен передать, уже не принадлежит государству.' };
  const here = islandAt(room, player.row, player.col).find(i => !i.ownerId && factionIdForIsland(i) === factionId);
  if (!here) return { ok: false, error: `Для вступления остановитесь на клетке острова, которым владеет ${faction.name}.` };
  return { ok: true, faction, gift, here };
}

function enterVassalage(room, player, factionId) {
  const allowed = canEnterVassalage(room, player, factionId);
  if (!allowed.ok) return allowed;
  ensurePoliticalPlayer(player);
  player.suzerainId = factionId;
  player.vassalGiftIslandId = allowed.gift.id;
  allowed.gift.ownerId = player.id;
  refreshFactionExistence(room);
  return { ok: true, faction: allowed.faction, gift: allowed.gift };
}

function rebelFromSuzerain(room, player) {
  ensurePoliticalPlayer(player);
  const factionId = player.suzerainId;
  const faction = FACTIONS[factionId];
  if (!faction) return { ok: false, error: 'Игрок не является вассалом.' };
  const giftIslandId = player.vassalGiftIslandId || faction.giftIslandId;
  const gift = room.islands?.find(i => i.id === giftIslandId);
  let returned = false;
  if (gift?.ownerId === player.id) {
    gift.ownerId = null;
    returned = true;
  }
  if (player.activeAssignment?.card) discardAssignmentCard(room, factionId, player.activeAssignment.card);
  player.suzerainId = null;
  player.vassalGiftIslandId = null;
  player.activeAssignment = null;
  if (!player.enemyFactionIds.includes(factionId)) player.enemyFactionIds.push(factionId);
  refreshFactionExistence(room);
  return { ok: true, faction, gift: returned ? gift : null, returned };
}

function politicalBuildingOptions(room, player, { aboveLevelOne = false, fortsOnly = false } = {}) {
  const out = [];
  for (const island of room?.islands || []) {
    if (island.ownerId !== player?.id) continue;
    (island.buildings || []).forEach((building, buildingIndex) => {
      if (aboveLevelOne && buildingStage(building) <= 1) return;
      if (fortsOnly && !['fort', 'fortress'].includes(building.type)) return;
      out.push({ islandId: island.id, islandName: island.name, buildingIndex, name: buildingDisplayName(building), canDowngrade: buildingStage(building) > 1 });
    });
  }
  return out;
}

function removePlayerBuilding(room, player, islandId, buildingIndex) {
  const island = room?.islands?.find(i => i.id === islandId && i.ownerId === player?.id);
  const index = Number(buildingIndex);
  if (!island || !Number.isInteger(index) || !island.buildings?.[index]) return { ok: false, error: 'Постройка не найдена.' };
  const [building] = island.buildings.splice(index, 1);
  return { ok: true, island, name: buildingDisplayName(building), building };
}

function politicalUpgradeOptions(player, branch = null) {
  return (player?.upgrades || [])
    .filter(id => !branch || SHIP_UPGRADES[id]?.branch === branch)
    .map(id => ({ id, name: SHIP_UPGRADES[id]?.name || id, branch: SHIP_UPGRADES[id]?.branch || null }));
}

function politicalCargoOptions(room, player) {
  const out = [];
  if (player?.cargo) out.push({ id: 'main', name: 'Основной трюм', goodId: player.cargo.goodId, quantity: player.cargo.quantity });
  for (const escort of escortStatuses(room, player || {}).filter(e => e.active && (ESCORTS[e.type]?.cargo || 0) > 0 && e.cargo)) {
    out.push({ id: escort.id, name: ESCORTS[e.type]?.name || 'Судно сопровождения', goodId: escort.cargo.goodId, quantity: escort.cargo.quantity });
  }
  return out;
}

function discardRandomHeldCard(room, player, rng = Math.random) {
  const refs = [];
  (player?.specialCards || []).forEach((name, index) => refs.push({ source: 'special', index, name }));
  (player?.legendaryCards || []).forEach((card, index) => refs.push({ source: 'legendary', index, name: card.name, card }));
  (player?.savedEventCards || []).forEach((card, index) => refs.push({ source: 'saved-event', index, name: card.name, card }));
  if (!refs.length) return { ok: true, discarded: null };
  const ref = refs[Math.floor(rng() * refs.length)];
  if (ref.source === 'special') player.specialCards.splice(ref.index, 1);
  else if (ref.source === 'legendary') {
    const [card] = player.legendaryCards.splice(ref.index, 1);
    discardDeckCard(room.legendaryDeck, card);
  } else {
    const [card] = player.savedEventCards.splice(ref.index, 1);
    if (card?.sourceCard) {
      if (card.sourceDeck === 'treasure') discardDeckCard(room.treasureDeck, card.sourceCard);
      else discardDeckCard(room.eventDeck, card.sourceCard);
    }
  }
  return { ok: true, discarded: ref };
}

function emptyCargoHolds(room, player) {
  const out = [];
  const main = holdFor(room, player, 'main');
  if (main && !main.blockedByLandCompany && !main.cargo && main.capacity > 0) out.push({ id: 'main', name: main.name, capacity: main.capacity });
  for (const escort of player?.escorts || []) {
    const hold = holdFor(room, player, escort.id);
    if (hold && !hold.cargo && hold.capacity > 0) out.push({ id: hold.id, name: hold.name, capacity: hold.capacity });
  }
  return out;
}

function fillCargoDirect(room, player, goodId, holdId = 'main') {
  const good = GOODS[goodId];
  if (!good) return { ok: false, error: 'Неизвестный товар.' };
  const hold = holdFor(room, player, holdId);
  if (!hold) return { ok: false, error: 'Выбранный трюм недоступен.' };
  if (hold.blockedByLandCompany) return { ok: false, error: 'Основной трюм занят ротой ландскнехтов.' };
  if (hold.cargo) return { ok: false, error: 'Выбранный трюм уже занят.' };
  if (hold.capacity <= 0) return { ok: false, error: 'У выбранного судна нет грузового трюма.' };
  const cargo = { goodId, quantity: hold.capacity };
  if (player.activeAssignment?.instanceId) cargo.assignmentInstanceId = player.activeAssignment.instanceId;
  hold.setCargo(cargo);
  return { ok: true, good, holdId: hold.id, holdName: hold.name, quantity: hold.capacity };
}

function resolveMoneyTreasure(room, player, card) {
  if (!card || !card.multiplier) return { ok: false, error: 'Это не денежная карта сокровища.' };
  const income = marketIncomeForPlayer(room, player.id);
  const amount = Math.max(Number(card.minimum) || 0, income * (Number(card.multiplier) || 0));
  const credit = creditDucats(player, amount);
  return { ok: true, income, amount, credit, card };
}

function canInstallShipUpgradeFree(player, upgradeId) {
  const upgrade = SHIP_UPGRADES[upgradeId];
  if (!upgrade) return { ok: false, error: 'Неизвестное улучшение корабля.' };
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Улучшения устанавливаются только в Цитадели.' };
  player.upgrades ||= [];
  if (player.upgrades.includes(upgradeId)) return { ok: false, error: 'Такое улучшение уже установлено.' };
  if (player.upgrades.length >= Math.max(1, Number(player.level) || 1)) return { ok: false, error: 'Нет свободного места для улучшения на текущем уровне корабля.' };
  const branchCountValue = player.upgrades.filter(id => SHIP_UPGRADES[id]?.branch === upgrade.branch).length;
  if (branchCountValue >= 2) return { ok: false, error: 'В этой ветви уже установлены два улучшения.' };
  if (upgrade.requires && !player.upgrades.includes(upgrade.requires)) return { ok: false, error: `Сначала установите «${SHIP_UPGRADES[upgrade.requires].name}».` };
  return { ok: true, upgrade };
}

function installShipUpgradeFree(player, upgradeId) {
  const allowed = canInstallShipUpgradeFree(player, upgradeId);
  if (!allowed.ok) return allowed;
  player.upgrades.push(upgradeId);
  return { ok: true, upgrade: allowed.upgrade, stats: shipStats(player) };
}

function canBuildFree(room, player, island, type) {
  const original = Math.max(0, Number(player.ducats) || 0);
  const price = BUILDINGS[type]?.price;
  if (price == null) return { ok: false, error: 'Неизвестная постройка.' };
  player.ducats = Math.max(original, price);
  const result = canBuild(room, player, island, type);
  player.ducats = original;
  return result;
}

function buildFree(room, player, islandId, type) {
  const island = room.islands.find(i => i.id === islandId);
  if (!island) return { ok: false, error: 'Остров не найден.' };
  const allowed = canBuildFree(room, player, island, type);
  if (!allowed.ok) return allowed;
  const def = BUILDINGS[type];
  const building = { type, level: 1, createdAt: Date.now(), freeCard: true };
  island.buildings.push(building);
  return { ok: true, island, building: { ...def, displayName: buildingDisplayName(building) } };
}

function raidBuildingOptions(room, player) {
  const options = [];
  for (const island of room?.islands || []) {
    if (island.ownerId !== player.id) continue;
    (island.buildings || []).forEach((building, index) => {
      if (buildingStage(building) > 1) options.push({ islandId: island.id, islandName: island.name, buildingIndex: index, name: buildingDisplayName(building) });
    });
  }
  return options;
}

function applyRaidDowngrade(room, player, islandId, buildingIndex) {
  const island = room?.islands?.find(i => i.id === islandId && i.ownerId === player.id);
  const index = Number(buildingIndex);
  if (!island || !Number.isInteger(index) || !island.buildings?.[index]) return { ok: false, error: 'Постройка не найдена.' };
  const before = island.buildings[index];
  if (buildingStage(before) <= 1) return { ok: false, error: 'Нужно выбрать постройку выше I уровня.' };
  island.buildings[index] = downgradeBuildingOneStep(before);
  return { ok: true, island, beforeName: buildingDisplayName(before), afterName: buildingDisplayName(island.buildings[index]) };
}

function boardingUpgradeOptions(player) {
  return (player?.upgrades || []).map(id => ({ id, name: SHIP_UPGRADES[id]?.name || id }));
}

function applyBoardingLoss(player, upgradeId) {
  const id = String(upgradeId || '');
  const index = (player?.upgrades || []).indexOf(id);
  if (index < 0) return { ok: false, error: 'Улучшение не установлено.' };
  const name = SHIP_UPGRADES[id]?.name || id;
  player.upgrades.splice(index, 1);
  normalizeDisabledUpgradeIds(player);
  const cargoDiscarded = trimMainCargoToCapacity(player);
  return { ok: true, id, name, cargoDiscarded, stats: shipStats(player) };
}

function stormCellOptions(room, player, islandId) {
  const island = room?.islands?.find(i => i.id === islandId);
  if (!island) return [];
  return (island.cells || []).filter(([row, col]) => hazardAllowed(player.shipClass, hazardAt(row, col))).map(([row, col]) => ({ row, col }));
}

function creditDucats(player, amount) {
  const gross = Math.max(0, Math.floor(Number(amount) || 0));
  const debtBefore = Math.max(0, Math.floor(Number(player?.debt) || 0));
  const debtPaid = Math.min(gross, debtBefore);
  const net = gross - debtPaid;
  player.debt = debtBefore - debtPaid;
  player.ducats = Math.max(0, Math.floor(Number(player?.ducats) || 0)) + net;
  return { gross, debtPaid, net, debtRemaining: player.debt };
}

function anchorLoss(player) {
  const treasury = Math.max(0, Math.floor(Number(player?.ducats) || 0));
  const required = Math.max(2, Math.floor(treasury * 0.30));
  const paid = Math.min(treasury, required);
  const addedDebt = required - paid;
  player.ducats = treasury - paid;
  player.debt = Math.max(0, Math.floor(Number(player?.debt) || 0)) + addedDebt;
  return { required, paid, addedDebt, debt: player.debt };
}

function resolveAnchorEncounter(room, player, rng = Math.random) {
  if (!room || !player) return { ok: false, error: 'Партия или игрок не найдены.' };
  const anchor = anchorAt(player.row, player.col);
  if (!anchor) return { ok: true, triggered: false, reason: 'not-anchor' };

  player.visitedAnchors ||= [];
  const visitKey = cellKey(player.row, player.col);
  if (player.visitedAnchors.includes(visitKey)) {
    return { ok: true, triggered: false, reason: 'already-visited', anchor };
  }

  const drawn = drawAnchorCard(room, anchor.color, rng);
  if (!drawn?.card) return { ok: false, error: `Колода «${anchor.name}» пуста.` };
  const card = drawn.card;
  player.visitedAnchors.push(visitKey);

  const result = {
    ok: true,
    triggered: true,
    anchor,
    card: { id: card.id, name: card.name, artillery: card.artillery, reward: card.reward, quiet: Boolean(card.quiet) },
    fleetPower: fleetArtillery(room, player),
    outcome: card.quiet ? 'quiet' : 'tie',
    glory: 0,
    actionCost: card.quiet ? 0 : 1,
    reward: null,
    penalty: null,
  };

  if (!card.quiet) {
    if (result.fleetPower > card.artillery) {
      result.outcome = 'win';
      result.reward = creditDucats(player, card.reward);
      result.glory = anchor.glory;
      player.glory = (Number(player.glory) || 0) + anchor.glory;
    } else if (result.fleetPower < card.artillery) {
      result.outcome = 'loss';
      result.penalty = anchorLoss(player);
    } else {
      player.skipTurns = (Number(player.skipTurns) || 0) + 1;
    }
  }

  drawn.deck.discard.push(card);
  player.lastAnchorEncounter = {
    round: room.round,
    row: player.row,
    col: player.col,
    color: anchor.color,
    anchorName: anchor.name,
    cardName: card.name,
    cardArtillery: card.artillery,
    rewardValue: card.reward,
    fleetPower: result.fleetPower,
    outcome: result.outcome,
    glory: result.glory,
    reward: result.reward ? { ...result.reward } : null,
    penalty: result.penalty ? { ...result.penalty } : null,
  };
  return result;
}

function reachableCells(player, maxDistance) {
  const limit = Math.max(0, Number(maxDistance) || 0);
  const shipClass = player.shipClass;
  const startLand = isLand(player.row, player.col);
  const queue = [{ row: player.row, col: player.col, dist: 0, landStreak: startLand ? 1 : 0 }];
  const seen = new Map();
  const reachable = new Map();
  seen.set(`${player.row},${player.col},${startLand ? 1 : 0}`, 0);
  reachable.set(cellKey(player.row, player.col), 0);

  while (queue.length) {
    const cur = queue.shift();
    if (cur.dist >= limit) continue;
    const neighbors = [
      [cur.row - 1, cur.col],
      [cur.row + 1, cur.col],
      [cur.row, cur.col - 1],
      [cur.row, cur.col + 1],
    ];

    for (const [row, col] of neighbors) {
      if (row < 0 || row > 27 || col < 0 || col > 27) continue;
      const hazard = hazardAt(row, col);
      if (!hazardAllowed(shipClass, hazard)) continue;

      const nextLand = isLand(row, col);
      const currentLand = isLand(cur.row, cur.col);
      const nd = cur.dist + 1;

      if (nextLand) {
        if (shipClass === 'caravel') {
          if (cur.landStreak >= 1) continue;
          const stateKey = `${row},${col},1`;
          if ((seen.get(stateKey) ?? Infinity) <= nd) continue;
          seen.set(stateKey, nd);
          if ((reachable.get(cellKey(row, col)) ?? Infinity) > nd) reachable.set(cellKey(row, col), nd);
          queue.push({ row, col, dist: nd, landStreak: 1 });
        } else {
          // Остальные суда могут войти на сухопутную береговую клетку с воды и остановиться,
          // но не проходят через сушу.
          if (currentLand || !isCoast(row, col)) continue;
          if ((reachable.get(cellKey(row, col)) ?? Infinity) > nd) reachable.set(cellKey(row, col), nd);
        }
        continue;
      }

      const stateKey = `${row},${col},0`;
      if ((seen.get(stateKey) ?? Infinity) <= nd) continue;
      seen.set(stateKey, nd);
      if ((reachable.get(cellKey(row, col)) ?? Infinity) > nd) reachable.set(cellKey(row, col), nd);
      queue.push({ row, col, dist: nd, landStreak: 0 });
    }
  }

  return [...reachable.entries()].map(([key, dist]) => {
    const [row, col] = key.split(',').map(Number);
    return { row, col, dist };
  });
}



function mistPathReachableCells(player) {
  // Карта 28×28: 784 шага гарантированно достаточно, чтобы обойти любую
  // допустимую связную область. Используем те же правила препятствий, что и
  // обычная навигация, но без ограничения броском d6.
  return reachableCells(player, 784);
}

function ensureLegendaryEffects(player) {
  player.legendaryEffects ||= {};
  player.legendaryEffects.seaCurses ||= [];
  return player.legendaryEffects;
}

function isShipProtected(player) {
  return Math.max(0, Number(player?.legendaryEffects?.shipVeil?.remaining) || 0) > 0;
}

function isIslandProtected(island) {
  return Math.max(0, Number(island?.legendaryVeil?.remaining) || 0) > 0;
}

function applySeaVeilToShip(player, options = {}) {
  if (!player) return { ok: false, error: 'Корабль не найден.' };
  const effects = ensureLegendaryEffects(player);
  effects.shipVeil = {
    remaining: 3,
    sourcePlayerId: String(options.sourcePlayerId || player.id || ''),
    ignoreTurnNo: options.ignoreCurrentTurn ? (Number(player.personalTurnNo) || 0) : null,
  };
  return { ok: true, remaining: 3 };
}

function applySeaVeilToIsland(island, sourcePlayer, options = {}) {
  if (!island || !sourcePlayer) return { ok: false, error: 'Цель защиты не найдена.' };
  island.legendaryVeil = {
    remaining: 3,
    sourcePlayerId: String(sourcePlayer.id || ''),
    ignoreTurnNo: options.ignoreCurrentTurn ? (Number(sourcePlayer.personalTurnNo) || 0) : null,
  };
  return { ok: true, remaining: 3 };
}

function applySeaCurse(target, sourcePlayerId = null) {
  if (!target) return { ok: false, error: 'Корабль-цель не найден.' };
  const effects = ensureLegendaryEffects(target);
  effects.seaCurses.push({ remaining: 3, penalty: 3, sourcePlayerId: sourcePlayerId ? String(sourcePlayerId) : null });
  return { ok: true, remaining: 3, penalty: 3 };
}

function legendaryMovementPenalty(player) {
  return (player?.legendaryEffects?.seaCurses || [])
    .filter(e => (Number(e.remaining) || 0) > 0)
    .reduce((sum, e) => sum + Math.max(0, Number(e.penalty) || 0), 0);
}

function tickLegendaryEffectsForPlayer(room, player) {
  if (!room || !player) return { expired: [] };
  const expired = [];
  const turnNo = Number(player.personalTurnNo) || 0;
  const effects = ensureLegendaryEffects(player);

  if (effects.shipVeil) {
    if (effects.shipVeil.ignoreTurnNo === turnNo) {
      effects.shipVeil.ignoreTurnNo = null;
    } else {
      effects.shipVeil.remaining = Math.max(0, (Number(effects.shipVeil.remaining) || 0) - 1);
      if (!effects.shipVeil.remaining) { delete effects.shipVeil; expired.push('Покров моря: корабль'); }
    }
  }

  effects.seaCurses = (effects.seaCurses || []).filter(effect => {
    effect.remaining = Math.max(0, (Number(effect.remaining) || 0) - 1);
    if (!effect.remaining) { expired.push('Морское проклятие'); return false; }
    return true;
  });

  for (const island of room.islands || []) {
    const veil = island.legendaryVeil;
    if (!veil || veil.sourcePlayerId !== player.id) continue;
    if (veil.ignoreTurnNo === turnNo) {
      veil.ignoreTurnNo = null;
      continue;
    }
    veil.remaining = Math.max(0, (Number(veil.remaining) || 0) - 1);
    if (!veil.remaining) {
      island.legendaryVeil = null;
      expired.push(`Покров моря: ${island.name}`);
    }
  }
  return { expired };
}

function applyHellfire(room, attacker, island) {
  if (!room || !attacker || !island) return { ok: false, error: 'Цель «Пламени Ада» не найдена.' };
  if (!playerOnIsland(attacker, island)) return { ok: false, error: 'Для «Пламени Ада» корабль должен находиться на клетке чужого острова.' };
  if (island.ownerId === attacker.id) return { ok: false, error: '«Пламя Ада» нельзя применять к своему острову.' };
  if (isIslandProtected(island)) return { ok: false, error: 'Остров защищён «Покровом моря».' };
  let changed = 0;
  const changes = [];
  island.buildings = (island.buildings || []).map(building => {
    if (buildingStage(building) <= 1) return building;
    const beforeName = buildingDisplayName(building);
    const after = downgradeBuildingOneStep(building);
    const afterName = buildingDisplayName(after);
    changed += 1;
    changes.push({ beforeName, afterName });
    return after;
  });
  return { ok: true, changed, changes, island };
}

function roman(level) {
  return ['', 'I', 'II', 'III'][Number(level) || 1] || String(level);
}

function buildingDisplayName(building) {
  const def = BUILDINGS[building?.type];
  if (!def) return building?.type || 'Постройка';
  if (def.fixedName) return def.name;
  return `${def.name} ${roman(building.level || 1)}`;
}

function buildingCount(island, type) {
  return island.buildings.filter(b => b.type === type).length;
}

function branchCount(island, branch) {
  return island.buildings.filter(b => BUILDINGS[b.type]?.branch === branch).length;
}

function buildingStage(building) {
  const level = Math.max(1, Math.min(3, Number(building?.level) || 1));
  if (['farm', 'lumbermill', 'quarry', 'mine', 'fort', 'market'].includes(building?.type)) return level;
  if (['manor', 'shipyard', 'stoneworks', 'arsenal', 'fortress', 'bank'].includes(building?.type)) return 3 + level;
  return level;
}

function foodStage(island) {
  let max = 0;
  for (const b of island.buildings) {
    if (BUILDINGS[b.type]?.branch === 'food') max = Math.max(max, buildingStage(b));
  }
  return max;
}

function usedArea(island) {
  return island.buildings.reduce((sum, b) => sum + (BUILDINGS[b.type]?.area || 0), 0);
}

function islandStatus(island) {
  const manors = island.buildings.filter(b => b.type === 'manor');
  const bestManor = manors.reduce((m, b) => Math.max(m, Number(b.level) || 1), 0);
  const nonFood = island.buildings.filter(b => BUILDINGS[b.type]?.branch !== 'food');
  const advancedNonFood = nonFood.filter(b => BUILDINGS[b.type]?.advanced).length;

  if (bestManor >= 2 && nonFood.length >= 6 && advancedNonFood >= 2) return 'Крупный порт';
  if (bestManor >= 1 && island.buildings.length - 1 >= 4) return 'Город';
  if (island.buildings.some(b => BUILDINGS[b.type]?.branch === 'food')) return 'Поселение';
  return 'Без поселения';
}

function effectiveArea(island) {
  const status = islandStatus(island);
  if (status === 'Крупный порт') return island.area + 2;
  if (status === 'Город') return island.area + 1;
  return island.area;
}

function branchLimitFor(island) {
  const status = islandStatus(island);
  if (status === 'Крупный порт') return 4;
  if (status === 'Город') return 3;
  return 2;
}

const LIMITED_BUILDING_BRANCHES = ['food', 'wood', 'stone', 'ore', 'fort', 'money'];
const BUILDING_BRANCH_NAMES = {
  food: 'пищевая',
  wood: 'лес / верфь',
  stone: 'камень / каменотёсный двор',
  ore: 'руда / арсенал',
  fort: 'форт / крепость',
  money: 'рынок / банк',
};

function islandConstraintReport(island) {
  if (!island) return { legal: true, status: 'Без поселения', usedArea: 0, effectiveArea: 0, overArea: 0, branchLimit: 2, branchViolations: [] };
  const status = islandStatus(island);
  const used = usedArea(island);
  const area = effectiveArea(island);
  const limit = branchLimitFor(island);
  const branchViolations = LIMITED_BUILDING_BRANCHES
    .map(branch => ({
      branch,
      name: BUILDING_BRANCH_NAMES[branch] || branch,
      count: branchCount(island, branch),
      limit,
    }))
    .filter(item => item.count > item.limit);
  return {
    legal: used <= area && branchViolations.length === 0,
    status,
    usedArea: used,
    effectiveArea: area,
    overArea: Math.max(0, used - area),
    branchLimit: limit,
    branchViolations,
  };
}

function islandCorrectionOptions(island) {
  if (!island) return [];
  return (island.buildings || []).map((building, buildingIndex) => ({
    buildingIndex,
    name: buildingDisplayName(building),
    type: building.type,
    level: Number(building.level) || 1,
    area: BUILDINGS[building.type]?.area || 0,
    branch: BUILDINGS[building.type]?.branch || null,
    branchName: BUILDING_BRANCH_NAMES[BUILDINGS[building.type]?.branch] || null,
  }));
}

function removeIslandBuildingForCorrection(room, player, islandId, buildingIndex) {
  const island = room?.islands?.find(i => i.id === islandId);
  if (!island || island.ownerId !== player?.id) return { ok: false, error: 'Исправлять можно только свой остров.' };
  const before = islandConstraintReport(island);
  if (before.legal) return { ok: false, error: 'Остров уже соответствует ограничениям площади и ветвей.' };
  const index = Number(buildingIndex);
  if (!Number.isInteger(index) || index < 0 || !island.buildings?.[index]) return { ok: false, error: 'Постройка для удаления не найдена.' };
  const oldGarrison = island.garrisonType || null;
  const [building] = island.buildings.splice(index, 1);
  const newGarrison = normalizeIslandGarrison(island);
  const after = islandConstraintReport(island);
  return {
    ok: true,
    island,
    building,
    name: buildingDisplayName(building),
    before,
    after,
    garrisonChanged: oldGarrison !== newGarrison,
    oldGarrison,
    newGarrison: newGarrison || null,
  };
}

function stoneworksSupportCapacity(room, playerId) {
  let slots = 0;
  for (const island of room?.islands || []) {
    if (island.ownerId !== playerId) continue;
    for (const b of island.buildings || []) {
      if (b.type === 'stoneworks') slots += Math.max(1, Math.min(3, Number(b.level) || 1));
    }
  }
  return slots;
}

function ownedBastionIslandIds(room, playerId) {
  return (room?.islands || [])
    .filter(island => island.ownerId === playerId && (island.buildings || []).some(b => b.type === 'bastion'))
    .map(island => island.id);
}

function normalizeBastionPriority(room, player) {
  if (!player) return [];
  const valid = ownedBastionIslandIds(room, player.id);
  const validSet = new Set(valid);
  const existing = (player.bastionPriority || []).filter(id => validSet.has(id));
  for (const id of valid) if (!existing.includes(id)) existing.push(id);
  player.bastionPriority = existing;
  return existing;
}

function supportedBastionIslandIds(room, playerId) {
  const player = room?.players?.find(p => p.id === playerId);
  if (!player) return [];
  const priority = normalizeBastionPriority(room, player);
  return priority.slice(0, stoneworksSupportCapacity(room, playerId));
}

function bastionSupportSummary(room, playerId) {
  const owned = ownedBastionIslandIds(room, playerId);
  const supported = supportedBastionIslandIds(room, playerId);
  return {
    capacity: stoneworksSupportCapacity(room, playerId),
    count: owned.length,
    supported,
    unsupported: owned.filter(id => !supported.includes(id)),
  };
}

function canBuildBastion(room, player, island) {
  if (!room || !player || !island) return { ok: false, error: 'Остров не найден.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Бастион можно строить только на своём острове.' };
  if (!playerOnIsland(player, island)) return { ok: false, error: 'Основной корабль должен находиться на клетке этого острова.' };
  if ((Number(player.ducats) || 0) < 10) return { ok: false, error: 'Для бастиона нужно 10 дукатов.' };
  if (foodStage(island) < 1) return { ok: false, error: 'Для бастиона нужна ферма или поместье I или выше.' };
  if ((island.buildings || []).some(b => b.type === 'bastion')) return { ok: false, error: 'На одном острове может быть только один бастион.' };
  const support = bastionSupportSummary(room, player.id);
  if (support.count >= support.capacity) return { ok: false, error: 'Нет свободного места поддержки каменотёсного двора.' };
  const candidate = cloneIslandWithBuildings(island, [...island.buildings, { type: 'bastion', level: 1 }]);
  if (usedArea(candidate) > effectiveArea(candidate)) return { ok: false, error: 'На острове не хватает свободной площади.' };
  if (branchCount(candidate, 'fort') > branchLimitFor(candidate)) return { ok: false, error: `Для статуса «${islandStatus(candidate)}» превышен предел защитной ветви.` };
  return { ok: true, support };
}

function buildBastion(room, player, islandId) {
  const island = room?.islands?.find(i => i.id === islandId);
  const allowed = canBuildBastion(room, player, island);
  if (!allowed.ok) return allowed;
  player.ducats -= 10;
  const building = { type: 'bastion', level: 1, createdAt: Date.now() };
  island.buildings.push(building);
  player.bastionPriority ||= [];
  if (!player.bastionPriority.includes(island.id)) player.bastionPriority.push(island.id);
  const support = bastionSupportSummary(room, player.id);
  return { ok: true, island, building, price: 10, support, name: 'Бастион' };
}

function prioritizeBastionSupport(room, player, islandId) {
  if (!room || !player) return { ok: false, error: 'Игрок не найден.' };
  const island = room.islands?.find(i => i.id === islandId);
  if (!island || island.ownerId !== player.id || !(island.buildings || []).some(b => b.type === 'bastion')) {
    return { ok: false, error: 'На выбранном своём острове нет бастиона.' };
  }
  const priority = normalizeBastionPriority(room, player).filter(id => id !== islandId);
  player.bastionPriority = [islandId, ...priority];
  return { ok: true, support: bastionSupportSummary(room, player.id) };
}

function normalizeIslandGarrison(island) {
  if (!island?.garrisonType) return null;
  const status = islandStatus(island);
  if (island.garrisonType === 'permanent' && status !== 'Крупный порт') {
    island.garrisonType = status === 'Город' ? 'guard' : null;
  } else if (island.garrisonType === 'guard' && status !== 'Город' && status !== 'Крупный порт') {
    island.garrisonType = null;
  }
  return island.garrisonType;
}

function garrisonDefenseValue(island) {
  const kind = normalizeIslandGarrison(island);
  if (kind === 'permanent') return 10;
  if (kind === 'guard') return 5;
  return 0;
}

function garrisonDisplayName(island) {
  const kind = normalizeIslandGarrison(island);
  return kind === 'permanent' ? 'Постоянный гарнизон' : kind === 'guard' ? 'Городская стража' : null;
}

function canBuyCityGuard(room, player, island) {
  if (!room || !player || !island) return { ok: false, error: 'Остров не найден.' };
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Городскую стражу покупают только в Цитадели.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Стражу можно назначить только своему острову.' };
  const status = islandStatus(island);
  if (!['Город', 'Крупный порт'].includes(status)) return { ok: false, error: 'Городскую стражу можно назначить только городу или крупному порту.' };
  normalizeIslandGarrison(island);
  if (island.garrisonType) return { ok: false, error: 'На острове уже есть городской отряд.' };
  if ((Number(player.ducats) || 0) < 6) return { ok: false, error: 'Для городской стражи нужно 6 дукатов.' };
  return { ok: true, status };
}

function buyCityGuard(room, player, islandId) {
  const island = room?.islands?.find(i => i.id === islandId);
  const allowed = canBuyCityGuard(room, player, island);
  if (!allowed.ok) return allowed;
  player.ducats -= 6;
  island.garrisonType = 'guard';
  return { ok: true, island, price: 6, defense: 5 };
}

function canBuyPermanentGarrison(room, player, island) {
  if (!room || !player || !island) return { ok: false, error: 'Остров не найден.' };
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Постоянный гарнизон покупают только в Цитадели.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Гарнизон можно назначить только своему острову.' };
  if (islandStatus(island) !== 'Крупный порт') return { ok: false, error: 'Постоянный гарнизон можно назначить только крупному порту.' };
  normalizeIslandGarrison(island);
  if (island.garrisonType !== 'guard') return { ok: false, error: 'Постоянный гарнизон заменяет уже имеющуюся городскую стражу.' };
  if ((Number(player.ducats) || 0) < 12) return { ok: false, error: 'Для постоянного гарнизона нужно 12 дукатов.' };
  return { ok: true };
}

function buyPermanentGarrison(room, player, islandId) {
  const island = room?.islands?.find(i => i.id === islandId);
  const allowed = canBuyPermanentGarrison(room, player, island);
  if (!allowed.ok) return allowed;
  player.ducats -= 12;
  island.garrisonType = 'permanent';
  return { ok: true, island, price: 12, defense: 10 };
}

function arsenalLevelOnIsland(island) {
  return (island?.buildings || [])
    .filter(b => b.type === 'arsenal')
    .reduce((max, b) => Math.max(max, Math.max(1, Math.min(3, Number(b.level) || 1))), 0);
}

function canFormLandCompany(room, player, island) {
  if (!room || !player || !island) return { ok: false, error: 'Остров не найден.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Роту можно снарядить только на своём острове.' };
  if (!playerOnIsland(player, island)) return { ok: false, error: 'Основной корабль должен находиться на клетке этого острова.' };
  const arsenalLevel = arsenalLevelOnIsland(island);
  if (!arsenalLevel) return { ok: false, error: 'На острове нужен арсенал.' };
  if (player.landCompany) return { ok: false, error: 'У игрока уже есть рота ландскнехтов.' };
  if (player.cargo) return { ok: false, error: 'Основной трюм занят грузом. Рота занимает весь основной трюм.' };
  return { ok: true, arsenalLevel, army: arsenalLevel + 2 };
}

function formLandCompany(room, player, islandId) {
  const island = room?.islands?.find(i => i.id === islandId);
  const allowed = canFormLandCompany(room, player, island);
  if (!allowed.ok) return allowed;
  player.landCompany = {
    army: allowed.army,
    arsenalLevel: allowed.arsenalLevel,
    sourceIslandId: island.id,
    formedAt: Date.now(),
  };
  return { ok: true, island, company: { ...player.landCompany } };
}

function dismissLandCompany(player) {
  if (!player?.landCompany) return { ok: false, error: 'Роты ландскнехтов нет.' };
  const company = { ...player.landCompany };
  player.landCompany = null;
  return { ok: true, company };
}

function landCompanyAssaultArmy(player) {
  return Math.max(0, Number(player?.landCompany?.army) || 0);
}


function canPlacePrizeBuilding(room, player, island, spec) {
  if (!room || !player || !island || !spec) return { ok: false, error: 'Наградная постройка не найдена.' };
  const def = BUILDINGS[spec.type];
  if (!def) return { ok: false, error: 'Неизвестный тип наградной постройки.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Призовую постройку можно разместить только на своём острове.' };
  const building = { type: spec.type, level: Math.max(1, Number(spec.level) || 1) };
  if (def.unique && buildingCount(island, building.type) >= 1) return { ok: false, error: 'Такая уникальная постройка уже есть на острове.' };

  const candidate = cloneIslandWithBuildings(island, [...island.buildings, building]);
  if (usedArea(candidate) > effectiveArea(candidate)) return { ok: false, error: 'На острове не хватает свободной площади.' };
  if (!def.unique && branchCount(candidate, def.branch) > branchLimitFor(candidate)) {
    return { ok: false, error: `Для статуса «${islandStatus(candidate)}» превышен предел построек этой ветви.` };
  }
  return { ok: true, building, candidate };
}

function prizeBuildingPlacementOptions(room, player, spec) {
  const out = [];
  for (const island of room?.islands || []) {
    if (island.ownerId !== player?.id) continue;
    const allowed = canPlacePrizeBuilding(room, player, island, spec);
    if (!allowed.ok) continue;
    out.push({
      islandId: island.id,
      islandName: island.name,
      status: islandStatus(island),
      usedArea: usedArea(island),
      effectiveArea: effectiveArea(island),
      afterUsedArea: usedArea(allowed.candidate),
      afterEffectiveArea: effectiveArea(allowed.candidate),
      branchLimit: branchLimitFor(allowed.candidate),
    });
  }
  return out;
}

function placePrizeBuilding(room, player, islandId, spec, meta = {}) {
  const island = room?.islands?.find(i => i.id === islandId);
  if (!island) return { ok: false, error: 'Остров для наградной постройки не найден.' };
  const allowed = canPlacePrizeBuilding(room, player, island, spec);
  if (!allowed.ok) return allowed;
  const building = {
    ...allowed.building,
    reward: true,
    statePrize: true,
    statePrizeFactionId: meta.factionId || null,
    createdAt: Date.now(),
  };
  island.buildings.push(building);
  return { ok: true, island, building, name: buildingDisplayName(building) };
}

function cloneIslandWithBuildings(island, buildings) {
  return { ...island, buildings: buildings.map(b => ({ ...b })) };
}

function canBuild(room, player, island, type) {
  const def = BUILDINGS[type];
  if (!def || def.buildable === false) return { ok: false, error: 'Эту постройку нельзя возвести напрямую.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Строить можно только на своём острове.' };
  const here = island.cells.some(([r, c]) => r === player.row && c === player.col);
  if (!here) return { ok: false, error: 'Основной корабль должен находиться на клетке этого острова.' };
  if (player.ducats < def.price) return { ok: false, error: `Не хватает дукатов: нужно ${def.price}.` };

  const hasFood = foodStage(island) >= 1;
  if (type !== 'farm' && !hasFood) return { ok: false, error: 'Сначала нужна ферма или поместье.' };
  if (def.resource && !island.resources.includes(def.resource)) return { ok: false, error: `На острове нет ресурса «${def.resource}».` };
  if (def.unique && buildingCount(island, type) >= 1) return { ok: false, error: 'Такой редкий промысел на острове уже есть.' };

  const candidate = cloneIslandWithBuildings(island, [...island.buildings, { type, level: 1 }]);
  if (usedArea(candidate) > effectiveArea(candidate)) return { ok: false, error: 'На острове не хватает свободной площади.' };

  if (!def.unique && branchCount(candidate, def.branch) > branchLimitFor(candidate)) {
    return { ok: false, error: `Для статуса «${islandStatus(candidate)}» превышен предел построек этой ветви.` };
  }

  if (type === 'market' && branchCount(island, 'money') >= 1 && branchCount(island, 'fort') < 1) {
    return { ok: false, error: 'Для второго рынка нужен действующий форт I или крепость.' };
  }

  return { ok: true };
}

function build(room, player, islandId, type) {
  const island = room.islands.find(i => i.id === islandId);
  if (!island) return { ok: false, error: 'Остров не найден.' };
  const allowed = canBuild(room, player, island, type);
  if (!allowed.ok) return allowed;
  const def = BUILDINGS[type];
  player.ducats -= def.price;
  const building = { type, level: 1, createdAt: Date.now() };
  island.buildings.push(building);
  return { ok: true, island, building: { ...def, displayName: buildingDisplayName(building) } };
}

function upgradeForBuilding(building) {
  return BUILDING_UPGRADES[building?.type]?.[Number(building?.level) || 1] || null;
}

function canUpgradeBuilding(room, player, island, buildingIndex) {
  if (!island) return { ok: false, error: 'Остров не найден.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Улучшать можно только постройки своего острова.' };
  const here = island.cells.some(([r, c]) => r === player.row && c === player.col);
  if (!here) return { ok: false, error: 'Основной корабль должен находиться на клетке этого острова.' };
  const index = Number(buildingIndex);
  if (!Number.isInteger(index) || index < 0 || index >= island.buildings.length) return { ok: false, error: 'Постройка не найдена.' };
  const current = island.buildings[index];
  const next = upgradeForBuilding(current);
  if (!next) return { ok: false, error: 'Для этой постройки нет следующей доступной ступени.' };
  if (player.ducats < next.price) return { ok: false, error: `Не хватает дукатов: нужно ${next.price}.` };

  const target = { ...current, type: next.type, level: next.level };
  const targetBranch = BUILDINGS[target.type]?.branch;
  const targetStage = buildingStage(target);
  if (targetBranch !== 'food' && foodStage(island) < targetStage) {
    return { ok: false, error: `Пищевая ветвь должна быть не ниже ступени ${targetStage}.` };
  }

  const buildings = island.buildings.map((b, i) => i === index ? target : { ...b });
  const candidate = cloneIslandWithBuildings(island, buildings);
  if (usedArea(candidate) > effectiveArea(candidate)) return { ok: false, error: 'Для улучшения не хватает площади острова.' };
  return { ok: true, current, next, target, index };
}

function upgradeBuilding(room, player, islandId, buildingIndex) {
  const island = room.islands.find(i => i.id === islandId);
  const allowed = canUpgradeBuilding(room, player, island, buildingIndex);
  if (!allowed.ok) return allowed;
  const beforeName = buildingDisplayName(allowed.current);
  player.ducats -= allowed.next.price;
  island.buildings[allowed.index] = { ...allowed.target, upgradedAt: Date.now() };
  const afterName = buildingDisplayName(island.buildings[allowed.index]);
  return { ok: true, island, price: allowed.next.price, beforeName, afterName, building: island.buildings[allowed.index] };
}

function marketIncomeForPlayer(room, playerId) {
  let income = 0;
  for (const island of room.islands) {
    if (island.ownerId !== playerId) continue;
    for (const b of island.buildings) {
      if (b.type === 'market') income += Number(b.level) || 1;
      if (b.type === 'bank') income += 3 + (Number(b.level) || 1);
    }
  }
  return income;
}

function claimFreeIslandsAt(room, player) {
  const claims = [];
  for (const island of islandAt(room, player.row, player.col)) {
    if (island.kind !== 'free' || island.ownerId) continue;
    island.ownerId = player.id;
    claims.push(island);
  }
  return claims;
}

function requiredDisabledUpgradeCount(player) {
  const slots = Math.max(1, Number(player?.level) || 1);
  return Math.max(0, (player?.upgrades || []).length - slots);
}

function cleanedDisabledUpgradeIds(player) {
  const installed = new Set(player?.upgrades || []);
  const out = [];
  for (const id of player?.disabledUpgradeIds || []) {
    if (!installed.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function effectiveDisabledUpgradeIds(player) {
  const required = requiredDisabledUpgradeCount(player);
  const disabled = cleanedDisabledUpgradeIds(player).slice(0, required);
  if (disabled.length < required) {
    for (const id of [...(player?.upgrades || [])].reverse()) {
      if (disabled.includes(id)) continue;
      disabled.push(id);
      if (disabled.length >= required) break;
    }
  }
  return disabled;
}

function normalizeDisabledUpgradeIds(player) {
  const required = requiredDisabledUpgradeCount(player);
  player.disabledUpgradeIds = cleanedDisabledUpgradeIds(player).slice(0, required);
  return player.disabledUpgradeIds;
}

function setDisabledUpgrades(player, ids) {
  const required = requiredDisabledUpgradeCount(player);
  const installed = new Set(player?.upgrades || []);
  const unique = [];
  for (const id of ids || []) {
    if (!installed.has(id)) return { ok: false, error: 'Можно отключать только установленные улучшения.' };
    if (!unique.includes(id)) unique.push(id);
  }
  if (unique.length !== required) {
    return { ok: false, error: `Нужно выбрать ровно ${required} улучшений для временного отключения.` };
  }
  player.disabledUpgradeIds = unique;
  const cargoDiscarded = trimMainCargoToCapacity(player);
  return { ok: true, disabledUpgradeIds: [...unique], cargoDiscarded, stats: shipStats(player) };
}

function shipUpgradeStatuses(player) {
  const disabled = new Set(effectiveDisabledUpgradeIds(player));
  const installed = new Set(player?.upgrades || []);
  return (player?.upgrades || []).map(id => {
    const upgrade = SHIP_UPGRADES[id];
    const missingRequirement = Boolean(upgrade?.requires && !installed.has(upgrade.requires));
    const disabledByLevel = disabled.has(id);
    return {
      id,
      name: upgrade?.name || id,
      branch: upgrade?.branch || null,
      active: !disabledByLevel && !missingRequirement,
      disabledByLevel,
      missingRequirement,
    };
  });
}

function activeUpgradeIds(player) {
  const disabled = new Set(effectiveDisabledUpgradeIds(player));
  const installed = new Set(player?.upgrades || []);
  return (player?.upgrades || []).filter(id => {
    if (disabled.has(id)) return false;
    const upgrade = SHIP_UPGRADES[id];
    return !upgrade?.requires || installed.has(upgrade.requires);
  });
}

function shipStats(player) {
  const base = SHIPS[player?.shipClass] || SHIPS.brigantine;
  const level = Math.max(1, Math.min(7, Number(player?.level) || 1));
  const levelDef = SHIP_LEVELS[level];
  const stats = {
    artillery: base.artillery + levelDef.statBonus,
    army: base.army + levelDef.statBonus,
    cargo: base.cargo + levelDef.statBonus,
    moveMod: base.moveMod + levelDef.moveBonus,
  };
  for (const id of activeUpgradeIds(player)) {
    const u = SHIP_UPGRADES[id];
    if (!u) continue;
    stats.artillery += u.artillery || 0;
    stats.army += u.army || 0;
    stats.cargo += u.cargo || 0;
    stats.moveMod += u.movement || 0;
  }
  return stats;
}

function shipCargoCapacity(player) {
  return shipStats(player).cargo;
}

function canBuyShipLevel(player) {
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Повышать уровень корабля можно только в Цитадели.' };
  const current = Math.max(1, Math.min(7, Number(player.level) || 1));
  if (current >= 7) return { ok: false, error: 'Корабль уже достиг VII уровня.' };
  const next = SHIP_LEVELS[current + 1];
  if (player.ducats < next.price) return { ok: false, error: `Для уровня ${current + 1} нужно ${next.price} дукатов.` };
  return { ok: true, current, next };
}

function buyShipLevel(player) {
  const allowed = canBuyShipLevel(player);
  if (!allowed.ok) return allowed;
  player.ducats -= allowed.next.price;
  player.level = allowed.next.level;
  normalizeDisabledUpgradeIds(player);
  normalizeLevelInactiveEscortIds(player);
  const cargoDiscarded = trimMainCargoToCapacity(player);
  return { ok: true, level: player.level, price: allowed.next.price, stats: shipStats(player), cargoDiscarded };
}

function canBuyShipUpgrade(player, upgradeId) {
  const upgrade = SHIP_UPGRADES[upgradeId];
  if (!upgrade) return { ok: false, error: 'Неизвестное улучшение корабля.' };
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Улучшения устанавливаются только в Цитадели.' };
  player.upgrades ||= [];
  if (player.upgrades.includes(upgradeId)) return { ok: false, error: 'Такое улучшение уже установлено.' };
  if (player.upgrades.length >= Math.max(1, Number(player.level) || 1)) return { ok: false, error: 'Нет свободного места для улучшения на текущем уровне корабля.' };
  const branchCountValue = player.upgrades.filter(id => SHIP_UPGRADES[id]?.branch === upgrade.branch).length;
  if (branchCountValue >= 2) return { ok: false, error: 'В этой ветви уже установлены два улучшения.' };
  if (upgrade.requires && !player.upgrades.includes(upgrade.requires)) {
    return { ok: false, error: `Сначала установите «${SHIP_UPGRADES[upgrade.requires].name}».` };
  }
  if (player.ducats < upgrade.price) return { ok: false, error: `Не хватает дукатов: нужно ${upgrade.price}.` };
  return { ok: true, upgrade };
}

function buyShipUpgrade(player, upgradeId) {
  const allowed = canBuyShipUpgrade(player, upgradeId);
  if (!allowed.ok) return allowed;
  player.ducats -= allowed.upgrade.price;
  player.upgrades.push(upgradeId);
  return { ok: true, upgrade: allowed.upgrade, stats: shipStats(player) };
}

function canRemoveShipUpgrade(player, upgradeId) {
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Снимать улучшения можно только в Цитадели.' };
  const upgrade = SHIP_UPGRADES[upgradeId];
  if (!upgrade || !(player.upgrades || []).includes(upgradeId)) return { ok: false, error: 'Улучшение не установлено.' };
  if (upgrade.order === 1) {
    const second = (player.upgrades || []).find(id => SHIP_UPGRADES[id]?.branch === upgrade.branch && SHIP_UPGRADES[id]?.order === 2);
    if (second) return { ok: false, error: 'Сначала нужно снять второе улучшение этой ветви.' };
  }
  return { ok: true, upgrade };
}

function removeShipUpgrade(player, upgradeId) {
  const allowed = canRemoveShipUpgrade(player, upgradeId);
  if (!allowed.ok) return allowed;
  player.upgrades = player.upgrades.filter(id => id !== upgradeId);
  normalizeDisabledUpgradeIds(player);
  const cargoDiscarded = trimMainCargoToCapacity(player);
  return { ok: true, upgrade: allowed.upgrade, stats: shipStats(player), cargoDiscarded };
}

function shipyardSlotsForPlayer(room, playerId) {
  let slots = 0;
  for (const island of room.islands) {
    if (island.ownerId !== playerId) continue;
    for (const b of island.buildings) if (b.type === 'shipyard') slots += Math.max(1, Math.min(3, Number(b.level) || 1));
  }
  return slots;
}

function ordinaryEscortExcess(room, player) {
  const ordinaryCount = (player?.escorts || []).filter(e => !e.special).length;
  return Math.max(0, ordinaryCount - shipyardSlotsForPlayer(room, player?.id));
}

function removeEscortById(player, escortId) {
  player.escorts ||= [];
  const index = player.escorts.findIndex(e => e.id === escortId);
  if (index < 0) return { ok: false, error: 'Судно сопровождения не найдено.' };
  const [escort] = player.escorts.splice(index, 1);
  player.levelInactiveEscortIds = (player.levelInactiveEscortIds || []).filter(id => id !== escort.id);
  normalizeLevelInactiveEscortIds(player);
  return { ok: true, escort, cargoDiscarded: escort.cargo ? { ...escort.cargo } : null };
}

function removeEscortsForShipyard(room, player, ids) {
  const required = ordinaryEscortExcess(room, player);
  const unique = [];
  for (const id of ids || []) if (!unique.includes(String(id))) unique.push(String(id));
  if (unique.length !== required) return { ok: false, error: `Нужно выбрать ровно ${required} обычных судов сопровождения для удаления.` };
  for (const id of unique) {
    const escort = (player?.escorts || []).find(e => e.id === id);
    if (!escort) return { ok: false, error: 'Выбранное сопровождение не найдено.' };
    if (escort.special) return { ok: false, error: 'Особое сопровождение Ландина не занимает место верфи и не удаляется из-за потери места верфи.' };
  }
  const removed = [];
  for (const id of unique) {
    const result = removeEscortById(player, id);
    if (!result.ok) return result;
    removed.push(result);
  }
  return { ok: true, removed };
}

function createLandinEscort(player) {
  player.escorts ||= [];
  if (player.escorts.some(e => e.type === 'landin')) return { ok: false, error: 'Особое сопровождение Ландина уже получено.' };
  if (player.escorts.length >= 3) return { ok: false, error: 'Для сопровождения Ландина нужно заменить одно из трёх имеющихся судов.' };
  player.nextEscortId = (Number(player.nextEscortId) || 0) + 1;
  const escort = { id: `escort-${player.nextEscortId}`, type: 'landin', special: true, cargo: null };
  player.escorts.push(escort);
  return { ok: true, escort };
}

function replaceEscortWithLandin(player, escortId) {
  player.escorts ||= [];
  if (player.escorts.some(e => e.type === 'landin')) return { ok: false, error: 'Особое сопровождение Ландина уже получено.' };
  if (player.escorts.length < 3) return createLandinEscort(player);
  const removed = removeEscortById(player, String(escortId || ''));
  if (!removed.ok) return removed;
  const created = createLandinEscort(player);
  if (!created.ok) {
    player.escorts.push(removed.escort);
    return created;
  }
  return { ok: true, escort: created.escort, replaced: removed.escort, cargoDiscarded: removed.cargoDiscarded };
}

function escortUseLimit(player) {
  const level = Math.max(1, Math.min(7, Number(player?.level) || 1));
  if (level <= 2) return 1;
  if (level <= 4) return 2;
  return 3;
}

function escortPurchasePrice(player) {
  const count = (player?.escorts || []).length;
  return [8, 12, 16][count] ?? null;
}

function requiredLevelInactiveEscortCount(player) {
  return Math.max(0, (player?.escorts || []).length - escortUseLimit(player));
}

function cleanedLevelInactiveEscortIds(player) {
  const owned = new Set((player?.escorts || []).map(e => e.id));
  const out = [];
  for (const id of player?.levelInactiveEscortIds || []) {
    if (!owned.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function effectiveLevelInactiveEscortIds(player) {
  const required = requiredLevelInactiveEscortCount(player);
  const disabled = cleanedLevelInactiveEscortIds(player).slice(0, required);
  if (disabled.length < required) {
    for (const escort of [...(player?.escorts || [])].reverse()) {
      if (disabled.includes(escort.id)) continue;
      disabled.push(escort.id);
      if (disabled.length >= required) break;
    }
  }
  return disabled;
}

function normalizeLevelInactiveEscortIds(player) {
  const required = requiredLevelInactiveEscortCount(player);
  player.levelInactiveEscortIds = cleanedLevelInactiveEscortIds(player).slice(0, required);
  return player.levelInactiveEscortIds;
}

function setLevelInactiveEscorts(player, ids) {
  const required = requiredLevelInactiveEscortCount(player);
  const owned = new Set((player?.escorts || []).map(e => e.id));
  const unique = [];
  for (const id of ids || []) {
    if (!owned.has(id)) return { ok: false, error: 'Можно отключать только имеющиеся суда сопровождения.' };
    if (!unique.includes(id)) unique.push(id);
  }
  if (unique.length !== required) {
    return { ok: false, error: `Нужно выбрать ровно ${required} судов сопровождения для временного отключения.` };
  }
  player.levelInactiveEscortIds = unique;
  return { ok: true, inactiveEscortIds: [...unique] };
}

function escortStatuses(room, player) {
  const levelInactive = new Set(effectiveLevelInactiveEscortIds(player));
  const shipyardSlots = shipyardSlotsForPlayer(room, player.id);
  let usedOrdinary = 0;
  return (player.escorts || []).map(e => {
    let active = !levelInactive.has(e.id);
    let inactiveReason = active ? null : 'level';
    if (active && !e.special) {
      if (usedOrdinary >= shipyardSlots) {
        active = false;
        inactiveReason = 'shipyard';
      } else {
        usedOrdinary += 1;
      }
    }
    return { ...e, active, inactiveReason };
  });
}

function fleetAdjustmentNeeds(player) {
  const requiredUpgrades = requiredDisabledUpgradeCount(player);
  const chosenUpgrades = cleanedDisabledUpgradeIds(player).slice(0, requiredUpgrades);
  const requiredEscorts = requiredLevelInactiveEscortCount(player);
  const chosenEscorts = cleanedLevelInactiveEscortIds(player).slice(0, requiredEscorts);
  return {
    upgradeCount: requiredUpgrades,
    upgradeChoiceNeeded: chosenUpgrades.length !== requiredUpgrades,
    escortCount: requiredEscorts,
    escortChoiceNeeded: chosenEscorts.length !== requiredEscorts,
    needsChoice: chosenUpgrades.length !== requiredUpgrades || chosenEscorts.length !== requiredEscorts,
  };
}

function canBuyEscort(room, player, type) {
  const def = ESCORTS[type];
  if (!def) return { ok: false, error: 'Неизвестный тип сопровождения.' };
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Сопровождение покупают только в Цитадели.' };
  player.escorts ||= [];
  if (player.escorts.length >= 3) return { ok: false, error: 'Одновременно можно иметь не более трёх судов сопровождения.' };
  if (player.escorts.length >= escortUseLimit(player)) return { ok: false, error: 'Текущий уровень основного корабля не позволяет использовать ещё одно сопровождение.' };
  const ordinaryCount = player.escorts.filter(e => !e.special).length;
  const shipyardSlots = shipyardSlotsForPlayer(room, player.id);
  if (ordinaryCount >= shipyardSlots) return { ok: false, error: 'Нет свободного места верфи. Развейте лесопилку до верфи на одном из своих островов.' };
  const price = escortPurchasePrice(player);
  if (price == null) return { ok: false, error: 'Лимит сопровождения достигнут.' };
  if (player.ducats < price) return { ok: false, error: `Не хватает дукатов: нужно ${price}.` };
  return { ok: true, def, price };
}

function buyEscort(room, player, type) {
  const allowed = canBuyEscort(room, player, type);
  if (!allowed.ok) return allowed;
  player.ducats -= allowed.price;
  player.nextEscortId = (Number(player.nextEscortId) || 0) + 1;
  const escort = { id: `escort-${player.nextEscortId}`, type, special: false, cargo: null };
  player.escorts.push(escort);
  return { ok: true, escort, def: allowed.def, price: allowed.price };
}

function availableGoodsOnIsland(island) {
  const ids = [];
  for (const building of island.buildings) {
    const goodId = BUILDINGS[building.type]?.produces;
    if (goodId && GOODS[goodId] && !ids.includes(goodId)) ids.push(goodId);
  }
  return ids;
}

function findEscort(player, escortId) {
  return (player.escorts || []).find(e => e.id === escortId) || null;
}

function holdFor(room, player, holdId = 'main') {
  if (!holdId || holdId === 'main') return { id: 'main', name: 'Основной трюм', capacity: shipCargoCapacity(player), cargo: player.cargo || null, blockedByLandCompany: Boolean(player?.landCompany), setCargo: cargo => { player.cargo = cargo; } };
  const escort = findEscort(player, holdId);
  if (!escort) return null;
  const status = escortStatuses(room, player).find(e => e.id === escort.id);
  const def = ESCORTS[escort.type];
  if (!status?.active || !def || def.cargo <= 0) return null;
  return { id: escort.id, name: def.name, capacity: def.cargo, cargo: escort.cargo || null, setCargo: cargo => { escort.cargo = cargo; } };
}

function canLoadCargo(room, player, island, goodId, holdId = 'main') {
  const good = GOODS[goodId];
  if (!good) return { ok: false, error: 'Неизвестный товар.' };
  if (!island) return { ok: false, error: 'Остров не найден.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Загружать товар можно только на своём острове.' };
  const here = island.cells.some(([r, c]) => r === player.row && c === player.col);
  if (!here) return { ok: false, error: 'Основной корабль должен находиться на клетке этого острова.' };
  if (island.loadedRound === room.round) return { ok: false, error: 'С этого острова уже выполнялась погрузка в текущем раунде.' };
  if (!availableGoodsOnIsland(island).includes(goodId)) return { ok: false, error: `На острове нет действующего источника товара «${good.name}».` };
  const hold = holdFor(room, player, holdId);
  if (!hold) return { ok: false, error: 'Выбранный трюм недоступен.' };
  if (hold.blockedByLandCompany) return { ok: false, error: 'Основной трюм занят ротой ландскнехтов.' };
  if (hold.cargo) return { ok: false, error: 'Выбранный трюм уже занят.' };
  if (hold.capacity <= 0) return { ok: false, error: 'У выбранного судна нет грузового трюма.' };
  return { ok: true, good, hold, capacity: hold.capacity };
}

function loadCargo(room, player, islandId, goodId, holdId = 'main') {
  const island = room.islands.find(i => i.id === islandId);
  const allowed = canLoadCargo(room, player, island, goodId, holdId);
  if (!allowed.ok) return allowed;
  const cargo = { goodId, quantity: allowed.capacity };
  if (player.activeAssignment?.instanceId) cargo.assignmentInstanceId = player.activeAssignment.instanceId;
  allowed.hold.setCargo(cargo);
  island.loadedRound = room.round;
  return { ok: true, island, good: allowed.good, quantity: allowed.capacity, holdId: allowed.hold.id, holdName: allowed.hold.name };
}

function cargoForHold(player, holdId = 'main') {
  if (!holdId || holdId === 'main') return player?.cargo || null;
  return findEscort(player, holdId)?.cargo || null;
}

function cargoSaleValue(player, holdId = 'main') {
  const cargo = cargoForHold(player, holdId);
  if (!cargo) return 0;
  const good = GOODS[cargo.goodId];
  if (!good) return 0;
  return good.price * cargo.quantity;
}

function canSellCargo(room, player, holdId = 'main') {
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Продать груз можно только в Цитадели.' };
  const hold = holdFor(room, player, holdId);
  if (!hold) return { ok: false, error: 'Выбранный трюм недоступен.' };
  if (!hold.cargo) return { ok: false, error: 'Выбранный трюм пуст.' };
  const good = GOODS[hold.cargo.goodId];
  if (!good) return { ok: false, error: 'Неизвестный товар в трюме.' };
  return { ok: true, good, hold, revenue: good.price * hold.cargo.quantity, quantity: hold.cargo.quantity };
}

function sellCargo(room, player, holdId = 'main') {
  const allowed = canSellCargo(room, player, holdId);
  if (!allowed.ok) return allowed;
  const assignmentInstanceId = allowed.hold.cargo?.assignmentInstanceId || null;
  const credit = creditDucats(player, allowed.revenue);
  allowed.hold.setCargo(null);
  return { ok: true, good: allowed.good, revenue: allowed.revenue, credit, quantity: allowed.quantity, holdId: allowed.hold.id, holdName: allowed.hold.name, assignmentInstanceId };
}


function playerOnIsland(player, island) {
  return Boolean(player && island?.cells?.some(([r, c]) => r === player.row && c === player.col));
}

function isCitadelPeaceCell(row, col) {
  if (isCitadelCell(row, col)) return true;
  for (const [r, c] of CITADEL_CELLS) {
    if (Math.abs(r - row) + Math.abs(c - col) !== 1) continue;
    // По правилам в зону мира входят морские клетки, соседние по стороне с берегом Цитадели.
    if (!isLand(row, col)) return true;
  }
  return false;
}

function fleetArtillery(room, player) {
  const escortArtillery = escortStatuses(room, player)
    .filter(e => e.active)
    .reduce((sum, e) => sum + (Number(ESCORTS[e.type]?.artillery) || 0), 0);
  return shipStats(player).artillery + escortArtillery;
}

function buildingDefenseValue(building) {
  const level = Math.max(1, Math.min(3, Number(building?.level) || 1));
  if (building?.type === 'fort') return [0, 5, 7, 9][level];
  if (building?.type === 'fortress') return [0, 12, 15, 18][level];
  if (building?.type === 'bastion') return 8;
  return Number(BUILDINGS[building?.type]?.defense) || 0;
}

function islandDefenseArmy(room, island) {
  if (!island) return { total: 0, garrison: 0, hiredGarrison: 0, fortifications: 0, bastions: 0, ownerShip: 0, ownerShipPresent: false };
  const garrison = island.ownerId ? 0 : (Number(island.army) || 0);
  const supported = island.ownerId ? new Set(supportedBastionIslandIds(room, island.ownerId)) : new Set();
  let fortifications = 0;
  let bastions = 0;
  for (const b of island.buildings || []) {
    if (b.type === 'bastion') {
      if (supported.has(island.id)) bastions += 8;
    } else {
      fortifications += buildingDefenseValue(b);
    }
  }
  const hiredGarrison = garrisonDefenseValue(island);
  let ownerShip = 0;
  let ownerShipPresent = false;
  if (island.ownerId) {
    const owner = room.players?.find(p => p.id === island.ownerId);
    if (owner && playerOnIsland(owner, island)) {
      ownerShipPresent = true;
      ownerShip = shipStats(owner).army;
    }
  }
  return { total: garrison + hiredGarrison + fortifications + bastions + ownerShip, garrison, hiredGarrison, fortifications, bastions, ownerShip, ownerShipPresent };
}

function trimMainCargoToCapacity(player) {
  if (!player?.cargo) return 0;
  const capacity = shipCargoCapacity(player);
  const old = Number(player.cargo.quantity) || 0;
  if (old <= capacity) return 0;
  player.cargo.quantity = capacity;
  if (capacity <= 0) player.cargo = null;
  return old - capacity;
}

function loseShipLevel(room, player) {
  const before = Math.max(1, Math.min(7, Number(player.level) || 1));
  if (before > 1) {
    player.level = before - 1;
    const adjustment = fleetAdjustmentNeeds(player);
    // Если после потери уровня нужно выбрать отключаемые улучшения, обрезку груза
    // откладываем до выбора владельца: итоговая вместимость зависит от его решения.
    const cargoDiscarded = adjustment.upgradeChoiceNeeded ? 0 : trimMainCargoToCapacity(player);
    return { before, after: player.level, returnedToStart: false, cargoDiscarded, adjustment };
  }
  player.row = 0;
  player.col = 0;
  return { before: 1, after: 1, returnedToStart: true, cargoDiscarded: 0, adjustment: fleetAdjustmentNeeds(player) };
}

function treasuryLoss30(player) {
  const loss = Math.floor((Number(player?.ducats) || 0) * 0.30);
  player.ducats = Math.max(0, (Number(player?.ducats) || 0) - loss);
  return loss;
}

function gloryForDefense(defense) {
  const d = Math.max(0, Number(defense) || 0);
  if (d === 0) return 0;
  if (d <= 4) return 2;
  if (d <= 8) return 3;
  if (d <= 12) return 4;
  if (d <= 16) return 6;
  return 8;
}

function downgradeBuildingOneStep(building) {
  const level = Math.max(1, Math.min(3, Number(building?.level) || 1));
  if (level > 1) return { ...building, level: level - 1 };
  const back = {
    manor: { type: 'farm', level: 3 },
    shipyard: { type: 'lumbermill', level: 3 },
    stoneworks: { type: 'quarry', level: 3 },
    arsenal: { type: 'mine', level: 3 },
    fortress: { type: 'fort', level: 3 },
    bank: { type: 'market', level: 3 },
  }[building?.type];
  return back ? { ...building, ...back } : { ...building };
}

function downgradePlayerBuildings(room, playerId) {
  let changed = 0;
  for (const island of room.islands || []) {
    if (island.ownerId !== playerId) continue;
    island.buildings = (island.buildings || []).map(b => {
      const stage = buildingStage(b);
      if (stage <= 1) return b;
      changed += 1;
      return downgradeBuildingOneStep(b);
    });
  }
  return changed;
}

function registerShipAttack(room, attacker, defenderId) {
  attacker.attackedThisTurn ||= [];
  if (attacker.attackedThisTurn.includes(defenderId)) {
    return { ok: false, error: 'Один и тот же корабль можно атаковать не более одного раза за личный ход.' };
  }
  attacker.attackedThisTurn.push(defenderId);
  attacker.attackHistory ||= {};
  const turnNo = Math.max(1, Number(attacker.personalTurnNo) || 1);
  const minTurn = turnNo - 9;
  const history = (attacker.attackHistory[defenderId] || []).filter(n => n >= minTurn);
  history.push(turnNo);
  const rebellion = history.length >= 3;
  attacker.attackHistory[defenderId] = rebellion ? [] : history;
  return { ok: true, rebellion };
}

function allianceKey(aId, bId) {
  return [String(aId || ''), String(bId || '')].sort().join('::');
}

function areAllies(room, a, b) {
  const aId = typeof a === 'string' ? a : a?.id;
  const bId = typeof b === 'string' ? b : b?.id;
  if (!aId || !bId || aId === bId) return false;
  const key = allianceKey(aId, bId);
  return (room?.alliances || []).some(pair => allianceKey(pair[0], pair[1]) === key);
}

function addAlliance(room, aId, bId) {
  if (!room || !aId || !bId || aId === bId) return false;
  room.alliances ||= [];
  if (areAllies(room, aId, bId)) return false;
  room.alliances.push([String(aId), String(bId)]);
  return true;
}

function removeAlliance(room, aId, bId) {
  if (!room?.alliances) return false;
  const key = allianceKey(aId, bId);
  const before = room.alliances.length;
  room.alliances = room.alliances.filter(pair => allianceKey(pair[0], pair[1]) !== key);
  return room.alliances.length !== before;
}

function uniquePlayersByIds(room, ids) {
  const out = [];
  const seen = new Set();
  for (const raw of ids || []) {
    const id = String(raw || '');
    if (!id || seen.has(id)) continue;
    const p = room.players?.find(x => x.id === id);
    if (!p) continue;
    seen.add(id);
    out.push(p);
  }
  return out;
}

function isFormerAllyBlocked(attacker, targetId) {
  return (attacker?.brokenAlliesThisTurn || []).includes(String(targetId || ''));
}

function splitLoot(loot, winners, priorityId) {
  const shares = {};
  if (!loot || !winners.length) return shares;
  const base = Math.floor(loot / winners.length);
  let remainder = loot - base * winners.length;
  for (const p of winners) shares[p.id] = base;
  if (remainder > 0) {
    const priority = winners.find(p => p.id === priorityId) || winners[0];
    shares[priority.id] = (shares[priority.id] || 0) + remainder;
    remainder = 0;
  }
  for (const p of winners) creditDucats(p, shares[p.id] || 0);
  return shares;
}

function jointSeaBattle(room, attacker, defender, attackerAllyIds = [], defenderAllyIds = []) {
  if (!room || !attacker || !defender) return { ok: false, error: 'Участник морского боя не найден.' };
  if (attacker.id === defender.id) return { ok: false, error: 'Нельзя атаковать собственный корабль.' };
  if (room.round === 1) return { ok: false, error: 'В первом раунде игроки не нападают друг на друга.' };
  if (attacker.row !== defender.row || attacker.col !== defender.col) return { ok: false, error: 'Для морского боя корабли должны находиться на одной клетке.' };
  if (isCitadelPeaceCell(attacker.row, attacker.col)) return { ok: false, error: 'В зоне мира Цитадели морские бои запрещены.' };
  if (areAllies(room, attacker, defender)) return { ok: false, error: 'Союзники не могут нападать друг на друга.' };
  if (isFormerAllyBlocked(attacker, defender.id)) return { ok: false, error: 'В этот личный ход нельзя атаковать бывшего союзника.' };

  const attackingAllies = uniquePlayersByIds(room, attackerAllyIds).filter(p => p.id !== attacker.id && p.id !== defender.id);
  const defendingAllies = uniquePlayersByIds(room, defenderAllyIds).filter(p => p.id !== attacker.id && p.id !== defender.id);
  const used = new Set([attacker.id, defender.id]);

  for (const p of attackingAllies) {
    if (used.has(p.id)) return { ok: false, error: 'Один корабль не может участвовать за обе стороны.' };
    if (!areAllies(room, attacker, p)) return { ok: false, error: `${p.name || 'Игрок'} не является союзником инициатора.` };
    if (areAllies(room, defender, p)) return { ok: false, error: `${p.name || 'Игрок'} связан союзом с целью и не может атаковать её.` };
    if (p.row !== defender.row || p.col !== defender.col) return { ok: false, error: `${p.name || 'Союзник'} находится не на клетке корабля-цели.` };
    used.add(p.id);
  }
  for (const p of defendingAllies) {
    if (used.has(p.id)) return { ok: false, error: 'Один корабль не может участвовать за обе стороны.' };
    if (!areAllies(room, defender, p)) return { ok: false, error: `${p.name || 'Игрок'} не является союзником защитника.` };
    if (areAllies(room, attacker, p) || isFormerAllyBlocked(attacker, p.id)) return { ok: false, error: `${p.name || 'Игрок'} не может участвовать против инициатора в этом бою.` };
    if (p.row !== defender.row || p.col !== defender.col) return { ok: false, error: `${p.name || 'Союзник'} находится не на клетке корабля-цели.` };
    used.add(p.id);
  }

  const attackRegistration = registerShipAttack(room, attacker, defender.id);
  if (!attackRegistration.ok) return attackRegistration;

  const attackers = [attacker, ...attackingAllies];
  const defenders = [defender, ...defendingAllies];
  const attackerPower = attackers.reduce((sum, p) => sum + fleetArtillery(room, p), 0);
  const defenderPower = defenders.reduce((sum, p) => sum + fleetArtillery(room, p), 0);
  const result = {
    ok: true,
    attackerPower,
    defenderPower,
    attackerParticipantIds: attackers.map(p => p.id),
    defenderParticipantIds: defenders.map(p => p.id),
    outcome: 'tie',
    loot: 0,
    lootShares: {},
    levelLosses: [],
    rebellion: false,
    downgradedBuildings: 0,
  };

  if (attackerPower === defenderPower) {
    for (const p of [...attackers, ...defenders]) p.skipTurns = (Number(p.skipTurns) || 0) + 1;
  } else {
    const attackerWon = attackerPower > defenderPower;
    const winners = attackerWon ? attackers : defenders;
    const losers = attackerWon ? defenders : attackers;
    const treasurySource = attackerWon ? defender : attacker;
    result.outcome = attackerWon ? 'attacker' : 'defender';
    result.winnerIds = winners.map(p => p.id);
    result.loserIds = losers.map(p => p.id);
    for (const p of losers) result.levelLosses.push({ playerId: p.id, ...loseShipLevel(room, p) });
    if (result.levelLosses.length === 1) result.levelLoss = result.levelLosses[0];
    const loot = Math.min(3, Math.max(0, Number(treasurySource.ducats) || 0));
    treasurySource.ducats -= loot;
    result.loot = loot;
    result.lootSourceId = treasurySource.id;
    result.lootShares = splitLoot(loot, winners, attackerWon ? attacker.id : defender.id);
  }

  if (attackRegistration.rebellion) {
    result.rebellion = true;
    result.downgradedBuildings = downgradePlayerBuildings(room, attacker.id);
  }
  return result;
}

function seaBattle(room, attacker, defender) {
  return jointSeaBattle(room, attacker, defender, [], []);
}

function addRewardBuilding(island, spec) {
  if (!BUILDINGS[spec.type]) return null;
  const building = { type: spec.type, level: spec.level || 1, reward: true, createdAt: Date.now() };
  island.buildings.push(building);
  return buildingDisplayName(building);
}

function grantMilitaryReward(room, player, island, captureMode, options = {}) {
  const notes = [];
  if (island.rewardClaimed) return notes;
  island.rewardClaimed = true;
  const reward = MILITARY_REWARDS[island.id];
  if (!reward) return notes;

  if (reward.ducats && !options.skipDucats) {
    const credit = creditDucats(player, reward.ducats);
    notes.push(credit.debtPaid ? `${reward.ducats} дукатов: ${credit.debtPaid} в погашение долга, ${credit.net} в казну` : `+${reward.ducats} дукатов`);
  }
  if (reward.legendary) {
    player.legendaryCards ||= [];
    let drawn = 0;
    for (let i = 0; i < reward.legendary; i++) {
      const card = drawLegendaryCard(room);
      if (card) { player.legendaryCards.push(card); drawn += 1; }
    }
    if (drawn) notes.push(`легендарная карта ×${drawn}`);
  }
  if (captureMode === 'preserve') {
    for (const spec of reward.preserveBuildings || []) {
      const name = addRewardBuilding(island, spec);
      if (name) notes.push(name);
    }
    if (reward.specialLandinEscort) {
      player.escorts ||= [];
      if (player.escorts.length < 3) {
        const created = createLandinEscort(player);
        if (created.ok) notes.push('особое сопровождение Ландина: +6 артиллерии и трюм 5');
      } else {
        player.pendingLandinEscort = true;
        notes.push('особое сопровождение Ландина заменит одно из трёх имеющихся судов по выбору владельца');
      }
    }
  }
  return notes;
}

function jointAssaultIsland(room, attacker, island, captureMode = 'preserve', attackerAllyIds = [], defenderAllyIds = []) {
  if (!room || !attacker || !island) return { ok: false, error: 'Цель штурма не найдена.' };
  if (!['preserve', 'raze'].includes(captureMode)) return { ok: false, error: 'Неизвестный результат захвата.' };
  if (!playerOnIsland(attacker, island)) return { ok: false, error: 'Для штурма основной корабль должен находиться на клетке этого острова.' };
  if (isCitadelPeaceCell(attacker.row, attacker.col)) return { ok: false, error: 'В зоне мира Цитадели штурм запрещён.' };
  if (island.ownerId === attacker.id) return { ok: false, error: 'Нельзя штурмовать собственный остров.' };
  if (!island.ownerId && island.kind === 'free') return { ok: false, error: 'Свободный остров получают без штурма при остановке у берега.' };
  if (island.ownerId && room.round === 1) return { ok: false, error: 'В первом раунде нельзя нападать на острова других игроков.' };

  const defender = island.ownerId ? room.players?.find(p => p.id === island.ownerId) : null;
  if (defender && areAllies(room, attacker, defender)) return { ok: false, error: 'Нельзя штурмовать остров союзника.' };
  if (defender && isFormerAllyBlocked(attacker, defender.id)) return { ok: false, error: 'В этот личный ход нельзя атаковать остров бывшего союзника.' };

  const attackingAllies = uniquePlayersByIds(room, attackerAllyIds).filter(p => p.id !== attacker.id && p.id !== defender?.id);
  const defendingAllies = uniquePlayersByIds(room, defenderAllyIds).filter(p => p.id !== attacker.id && p.id !== defender?.id);
  const used = new Set([attacker.id]);
  if (defender) used.add(defender.id);

  for (const p of attackingAllies) {
    if (used.has(p.id)) return { ok: false, error: 'Один корабль не может участвовать за обе стороны.' };
    if (!areAllies(room, attacker, p)) return { ok: false, error: `${p.name || 'Игрок'} не является союзником инициатора.` };
    if (defender && areAllies(room, defender, p)) return { ok: false, error: `${p.name || 'Игрок'} связан союзом с владельцем острова и не может участвовать в штурме.` };
    if (!playerOnIsland(p, island)) return { ok: false, error: `${p.name || 'Союзник'} должен находиться на клетке этого острова.` };
    used.add(p.id);
  }
  for (const p of defendingAllies) {
    if (!defender) return { ok: false, error: 'У нейтрального или государственного острова нет союзников-игроков.' };
    if (used.has(p.id)) return { ok: false, error: 'Один корабль не может участвовать за обе стороны.' };
    if (!areAllies(room, defender, p)) return { ok: false, error: `${p.name || 'Игрок'} не является союзником владельца острова.` };
    if (areAllies(room, attacker, p) || isFormerAllyBlocked(attacker, p.id)) return { ok: false, error: `${p.name || 'Игрок'} не может участвовать против инициатора в этом штурме.` };
    if (!playerOnIsland(p, island)) return { ok: false, error: `${p.name || 'Союзник'} должен находиться на клетке этого острова.` };
    used.add(p.id);
  }

  const attackers = [attacker, ...attackingAllies];
  const ownerParticipates = Boolean(defender && playerOnIsland(defender, island));
  const defenders = [...(ownerParticipates ? [defender] : []), ...defendingAllies];
  const baseDefense = islandDefenseArmy(room, island);
  const defenderAllyPower = defendingAllies.reduce((sum, p) => sum + shipStats(p).army, 0);
  const defense = {
    ...baseDefense,
    alliedShips: defenderAllyPower,
    alliedShipIds: defendingAllies.map(p => p.id),
    total: baseDefense.total + defenderAllyPower,
  };
  const attackerPower = attackers.reduce((sum, p) => sum + shipStats(p).army + landCompanyAssaultArmy(p), 0);
  const result = {
    ok: true,
    attackerPower,
    defense,
    attackerParticipantIds: attackers.map(p => p.id),
    defenderParticipantIds: defenders.map(p => p.id),
    outcome: 'tie',
    captureMode,
    rewardNotes: [],
    glory: 0,
    levelLosses: [],
    discardedLandCompanies: [],
    treasuryLosses: {},
  };

  if (attackerPower > defense.total) {
    result.outcome = 'attacker';
    result.previousOwnerId = island.ownerId || null;
    if (captureMode === 'raze') island.buildings = [];
    island.ownerId = attacker.id;
    if (!island.firstMilitaryConquered) {
      island.firstMilitaryConquered = true;
      result.glory = gloryForDefense(defense.total);
      attacker.glory = (Number(attacker.glory) || 0) + result.glory;
    }

    const islandRewardWasClaimable = !island.rewardClaimed;
    const factionId = factionIdForIsland(island);
    const overlap = islandRewardWasClaimable && captureMode === 'preserve'
      ? (MILITARY_REWARDS[island.id]?.preserveBuildings || [])
      : [];
    result.statePrize = factionId ? claimFullSubjugationPrize(room, attacker, factionId, captureMode, overlap) : null;

    // При разорении последнего острова итоговый денежный приз государства является
    // всей денежной добычей этого финального захвата. Это не складывается с
    // денежной наградой карточки острова (явно оговорено для Кадингира).
    const replaceIslandCash = Boolean(result.statePrize?.triggered && result.statePrize.mode === 'raze' && result.statePrize.ducats > 0);
    result.rewardNotes = grantMilitaryReward(room, attacker, island, captureMode, { skipDucats: replaceIslandCash });
    if (replaceIslandCash) {
      result.statePrize.credit = creditDucats(attacker, result.statePrize.ducats);
      const c = result.statePrize.credit;
      result.rewardNotes.push(c.debtPaid
        ? `итоговый приз ${result.statePrize.factionName}: ${result.statePrize.ducats} дукатов (${c.debtPaid} в долг, ${c.net} в казну)`
        : `итоговый приз ${result.statePrize.factionName}: +${result.statePrize.ducats} дукатов`);
    }
  } else if (attackerPower < defense.total) {
    result.outcome = 'defender';
    for (const p of attackers) {
      result.levelLosses.push({ playerId: p.id, ...loseShipLevel(room, p) });
      if (p.landCompany) {
        result.discardedLandCompanies.push({ playerId: p.id, army: landCompanyAssaultArmy(p) });
        p.landCompany = null;
      }
    }
    if (result.levelLosses.length === 1) result.levelLoss = result.levelLosses[0];
  } else {
    for (const p of [...attackers, ...defenders]) result.treasuryLosses[p.id] = treasuryLoss30(p);
    result.attackerTreasuryLoss = result.treasuryLosses[attacker.id] || 0;
    result.defenderTreasuryLoss = defender ? (result.treasuryLosses[defender.id] || 0) : 0;
  }
  return result;
}

function assaultIsland(room, attacker, island, captureMode = 'preserve') {
  return jointAssaultIsland(room, attacker, island, captureMode, [], []);
}

function publicIsland(island, room = null) {
  normalizeIslandGarrison(island);
  const supportedBastions = island.ownerId && room ? new Set(supportedBastionIslandIds(room, island.ownerId)) : new Set();
  return {
    id: island.id,
    name: island.name,
    kind: island.kind,
    faction: island.faction || null,
    area: island.area,
    army: island.army,
    resources: island.resources,
    reward: island.reward,
    cells: island.cells,
    ownerId: island.ownerId,
    loadedRound: island.loadedRound,
    rewardClaimed: Boolean(island.rewardClaimed),
    firstMilitaryConquered: Boolean(island.firstMilitaryConquered),
    legendaryVeil: island.legendaryVeil ? { remaining: Number(island.legendaryVeil.remaining) || 0, sourcePlayerId: island.legendaryVeil.sourcePlayerId || null } : null,
    garrisonType: island.garrisonType || null,
    garrisonName: garrisonDisplayName(island),
    availableGoods: availableGoodsOnIsland(island),
    buildings: island.buildings.map((b, index) => {
      const next = upgradeForBuilding(b);
      return {
        index,
        type: b.type,
        level: b.level,
        name: buildingDisplayName(b),
        supported: b.type === 'bastion' ? supportedBastions.has(island.id) : null,
        nextUpgrade: next ? { type: next.type, level: next.level, price: next.price, name: buildingDisplayName({ type: next.type, level: next.level }) } : null,
      };
    }),
    usedArea: usedArea(island),
    effectiveArea: effectiveArea(island),
    status: islandStatus(island),
    constraints: islandConstraintReport(island),
  };
}

module.exports = {
  cloneIslands,
  islandAt,
  reachableCells,
  mistPathReachableCells,
  isShipProtected,
  isIslandProtected,
  applySeaVeilToShip,
  applySeaVeilToIsland,
  applySeaCurse,
  legendaryMovementPenalty,
  tickLegendaryEffectsForPlayer,
  applyHellfire,
  build,
  canBuild,
  upgradeBuilding,
  canUpgradeBuilding,
  buildingDisplayName,
  canPlacePrizeBuilding,
  prizeBuildingPlacementOptions,
  placePrizeBuilding,
  stoneworksSupportCapacity,
  bastionSupportSummary,
  supportedBastionIslandIds,
  canBuildBastion,
  buildBastion,
  prioritizeBastionSupport,
  normalizeIslandGarrison,
  garrisonDefenseValue,
  garrisonDisplayName,
  canBuyCityGuard,
  buyCityGuard,
  canBuyPermanentGarrison,
  buyPermanentGarrison,
  canFormLandCompany,
  formLandCompany,
  dismissLandCompany,
  landCompanyAssaultArmy,
  marketIncomeForPlayer,
  claimFreeIslandsAt,
  publicIsland,
  usedArea,
  effectiveArea,
  islandStatus,
  islandConstraintReport,
  islandCorrectionOptions,
  removeIslandBuildingForCorrection,
  shipStats,
  shipUpgradeStatuses,
  fleetAdjustmentNeeds,
  setDisabledUpgrades,
  setLevelInactiveEscorts,
  normalizeDisabledUpgradeIds,
  normalizeLevelInactiveEscortIds,
  shipCargoCapacity,
  canBuyShipLevel,
  buyShipLevel,
  canBuyShipUpgrade,
  buyShipUpgrade,
  canRemoveShipUpgrade,
  removeShipUpgrade,
  shipyardSlotsForPlayer,
  ordinaryEscortExcess,
  removeEscortById,
  removeEscortsForShipyard,
  createLandinEscort,
  replaceEscortWithLandin,
  escortUseLimit,
  escortPurchasePrice,
  escortStatuses,
  canBuyEscort,
  buyEscort,
  availableGoodsOnIsland,
  canLoadCargo,
  loadCargo,
  cargoSaleValue,
  canSellCargo,
  sellCargo,
  isCitadelPeaceCell,
  anchorAt,
  createAnchorDecks,
  drawAnchorCard,
  resolveAnchorEncounter,
  createSailingEventDeck,
  drawSailingEventCard,
  createTreasureDeck,
  drawTreasureCard,
  createLegendaryDeck,
  createFeudDecks,
  drawFeudCard,
  createAssignmentDecks,
  drawAssignmentCard,
  issueAssignment,
  canReplaceAssignment,
  replaceAssignment,
  assignmentEventMatches,
  completeAssignment,
  legendaryPlaceAt,
  factionIdForIsland,
  stateExists,
  refreshFactionExistence,
  fullSubjugationController,
  claimFullSubjugationPrize,
  addEnmity,
  canEnterVassalage,
  enterVassalage,
  rebelFromSuzerain,
  politicalBuildingOptions,
  removePlayerBuilding,
  politicalUpgradeOptions,
  politicalCargoOptions,
  discardRandomHeldCard,
  drawLegendaryCard,
  discardDeckCard,
  emptyCargoHolds,
  fillCargoDirect,
  resolveMoneyTreasure,
  canInstallShipUpgradeFree,
  installShipUpgradeFree,
  canBuildFree,
  buildFree,
  raidBuildingOptions,
  applyRaidDowngrade,
  boardingUpgradeOptions,
  applyBoardingLoss,
  stormCellOptions,
  creditDucats,
  anchorLoss,
  fleetArtillery,
  islandDefenseArmy,
  loseShipLevel,
  gloryForDefense,
  areAllies,
  addAlliance,
  removeAlliance,
  playerOnIsland,
  jointSeaBattle,
  seaBattle,
  jointAssaultIsland,
  assaultIsland,
  downgradePlayerBuildings,
  isCitadelCell,
};
