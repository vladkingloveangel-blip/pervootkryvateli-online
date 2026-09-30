const domainState = require('./domain-state');
const { Task, getActiveAssignmentTask, assignTask, completeAssignmentTask } = domainState;
const { BALANCE, MAP_META } = require('./game-data');
const { selectTreasureOutcome, selectLegendaryAbility, selectTreasureCandidates } = require('./digital-random-sources');
const { createSeaEncounterStorage, seaEncounterSource } = require('./sea-encounter-source');
const { createSailingEventStorage, canonicalizeSailingEventOccurrence, sailingEventSource } = require('./sailing-event-source');
const { createPoliticalEffectStorage, politicalEffectSource } = require('./political-effect-source');
const { createAssignmentStorage, assignmentPool } = require('./assignment-pool');
const { createExpeditionStorage, expeditionPool } = require('./expedition-pool');
const {
  SHIPS,
  SHIP_LEVELS,
  SHIP_UPGRADES,
  ESCORTS,
  MILITARY_REWARDS,
  BUILDINGS,
  BUILDING_UPGRADES,
  CHARACTERS,
  GOODS,
  ISLAND_DEFS,
  ISLAND_BY_CELL,
  HAZARDS,
  ANCHORS,
  ANCHOR_CARDS,
  ANCHOR_BY_CELL,
  LEGENDARY_PLACES,
  LEGENDARY_PLACE_RULES,
  NAMED_PLACE_CARDS,
  EXPEDITION_CARDS,
  ASSIGNMENT_CARDS,
  FACTIONS,
  POLITICAL_FACTION_ORDER,
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
    garrisonDefense: null,
    garrisonOrigin: null,
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
const HAZARD_SETS = Object.fromEntries(Object.entries(HAZARDS)
  .map(([type, cells]) => [type, new Set(cells.map(([r, c]) => cellKey(r, c))) ]));

function isCitadelCell(row, col) {
  return CITADEL_SET.has(cellKey(row, col));
}

function isCoast(row, col) {
  return islandIdsAt(row, col).length > 0 || SPECIAL_LAND_SET.has(cellKey(row, col));
}

function isLand(row, col) {
  return LAND_SET.has(cellKey(row, col)) || SPECIAL_LAND_SET.has(cellKey(row, col));
}

function hazardsAt(row, col) {
  const key = cellKey(row, col);
  return Object.entries(HAZARD_SETS).filter(([, cells]) => cells.has(key)).map(([type]) => type);
}

function navigationPassabilities(player) {
  const out = new Set();
  const innate = SHIPS[player?.shipClass]?.passability;
  if (innate) out.add(innate);
  for (const id of activeUpgradeIds(player)) {
    const passability = SHIP_UPGRADES[id]?.passability;
    if (passability) out.add(passability);
  }
  return out;
}

function navigationAllowsHazards(player, hazards) {
  const passabilities = navigationPassabilities(player);
  return (hazards || []).every(hazard => passabilities.has(hazard));
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
  return createSeaEncounterStorage(rng);
}

function drawAnchorCard(room, color, rng = Math.random) {
  const source = seaEncounterSource(room, color, rng);
  if (!source) return null;
  const card = source.consumeNext();
  return card ? { card, deck: source.compatibilityStorage() } : null;
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
  return createSailingEventStorage(rng);
}

function createExpeditionDeck(rng = Math.random) {
  return createExpeditionStorage(rng);
}

function drawCyclingDeckCard(deck, rng = Math.random) {
  if (!deck) return null;
  if (!deck.drawPile?.length && deck.discard?.length) {
    deck.drawPile = shuffleCards(deck.discard, rng);
    deck.discard = [];
  }
  return deck.drawPile?.shift() || null;
}

function canonicalSailingEventCard(rawCard) {
  return canonicalizeSailingEventOccurrence(rawCard);
}

function drawSailingEventCard(room, rng = Math.random) {
  return sailingEventSource(room, rng)?.consumeNext() || null;
}

function drawTreasureCard(_room, rng = Math.random) {
  return selectTreasureOutcome(rng);
}

function treasureHunterCandidates(rng = Math.random) {
  const count = CHARACTERS.treasureHunter?.effect?.draw;
  return selectTreasureCandidates(count, rng);
}

function drawLegendaryCard(_room, rng = Math.random) {
  return selectLegendaryAbility(rng);
}

function discardDeckCard(deck, card) {
  if (!deck || !card) return;
  deck.discard ||= [];
  deck.discard.push({ ...card });
}



function createFeudDecks(rng = Math.random) {
  return createPoliticalEffectStorage(rng);
}

function drawFeudCard(room, factionId, rng = Math.random) {
  return politicalEffectSource(room, factionId, rng)?.consumeNext() || null;
}



function createAssignmentDecks(rng = Math.random) {
  return createAssignmentStorage(rng);
}

function assignmentBranchAtMaximum(island, branch) {
  if (!island || !branch) return false;
  const branchBuildings = (island.buildings || []).filter(building => BUILDINGS[building.type]?.branch === branch);
  const globalLimit = Math.max(0, ...Object.values(BALANCE.branchLimits || {}).map(value => Number(value) || 0));
  if (!globalLimit || branchBuildings.length < globalLimit) return false;
  return branchBuildings.every(building => !upgradeForBuilding(building));
}

function assignmentCardEligibility(room, player, card) {
  if (!room || !player || !card) return 'remove';

  if (card.type === 'capture-island') {
    const island = room.islands?.find(item => item.id === card.islandId);
    if (!island) return 'remove';
    return island.ownerId === player.id ? 'skip' : 'eligible';
  }

  if (card.type === 'ship-level') {
    return (Number(player.level) || 1) >= BALANCE.maxShipLevel ? 'skip' : 'eligible';
  }

  if (card.type === 'stat-upgrade') {
    const candidates = Object.values(SHIP_UPGRADES)
      .filter(upgrade => upgrade.branch === card.branch && !upgrade.retired);
    if (!candidates.length) return 'remove';
    const installed = new Set(player.upgrades || []);
    return candidates.every(upgrade => installed.has(upgrade.id)) ? 'skip' : 'eligible';
  }

  if (card.type === 'build-branch') {
    if (!card.islandId || !Object.values(BUILDINGS).some(building => building.branch === card.branch)) return 'remove';
    const island = room.islands?.find(item => item.id === card.islandId);
    if (!island) return 'remove';
    if (island.ownerId === player.id && assignmentBranchAtMaximum(island, card.branch)) return 'skip';
    return 'eligible';
  }

  if (card.type === 'build-type') {
    const building = BUILDINGS[card.buildingType];
    if (!building || !card.resource) return 'remove';
    const resourceIslands = (room.islands || []).filter(island => (island.resources || []).includes(card.resource));
    if (!resourceIslands.length) return 'remove';
    const ownResourceIslands = resourceIslands.filter(island => island.ownerId === player.id);
    const otherResourceIslands = resourceIslands.filter(island => island.ownerId !== player.id);
    if (otherResourceIslands.length) return 'eligible';
    if (ownResourceIslands.length && ownResourceIslands.every(island => assignmentBranchAtMaximum(island, building.branch))) return 'skip';
    return 'eligible';
  }

  if (card.type === 'visit-place') return LEGENDARY_PLACES[card.placeId] ? 'eligible' : 'remove';

  if (card.type === 'visit-island') {
    return room.islands?.some(island => island.id === card.islandId) ? 'eligible' : 'remove';
  }

  if (card.type === 'visit-route') {
    const route = Array.isArray(card.route) ? card.route : [];
    if (!route.length) return 'remove';
    for (const stop of route) {
      if (stop.islandId && !room.islands?.some(island => island.id === stop.islandId)) return 'remove';
      if (stop.mapObjectId && stop.mapObjectId !== 'citadel') return 'remove';
      if (!stop.islandId && !stop.mapObjectId) return 'remove';
    }
    return 'eligible';
  }

  if (card.type === 'anchor-win') {
    const colors = Array.isArray(card.colors) ? card.colors : [];
    return colors.length && colors.every(color => ANCHORS[color]) ? 'eligible' : 'remove';
  }

  if (card.type === 'delivery') {
    if (card.goodIds == null) return 'eligible';
    if (!Array.isArray(card.goodIds) || !card.goodIds.length) return 'remove';
    return card.goodIds.every(goodId => GOODS[goodId]) ? 'eligible' : 'remove';
  }

  if (card.type === 'attack-player-island' || card.type === 'treasure-resolved') return 'eligible';

  return 'remove';
}

function assignmentPoolFor(room, factionId, rng = Math.random) {
  return assignmentPool(room, factionId, rng, { classify: assignmentCardEligibility });
}

function drawAssignmentCandidates(room, player, factionId, count = 1, rng = Math.random) {
  return assignmentPoolFor(room, factionId, rng)?.offerEligible(player, count) || [];
}

function drawAssignmentCard(room, player, factionId, rng = Math.random) {
  return drawAssignmentCandidates(room, player, factionId, 1, rng)[0] || null;
}

function discardAssignmentCard(room, factionId, card) {
  if (!card) return false;
  return assignmentPoolFor(room, factionId)?.recycleCompleted(card) || false;
}

function ensureAssignmentPlayer(player) {
  if (!player) return player;
  player.activeAssignment ||= null;
  return player;
}

function moriAssignmentStops(card) {
  if (!card) return [];
  if (card.type === 'visit-island' && card.islandId) return [{ islandId: card.islandId }];
  if (card.type === 'visit-route' && Array.isArray(card.route)) return card.route.map(stop => ({ ...stop }));
  return [];
}

function moriStopMatches(room, player, stop, row = player?.row, col = player?.col) {
  if (!room || !player || !stop) return false;
  if (stop.islandId) {
    const island = room.islands?.find(item => item.id === stop.islandId);
    return Boolean(island?.cells?.some(([r, c]) => r === Number(row) && c === Number(col)));
  }
  if (stop.mapObjectId === 'citadel') return isCitadelCell(row, col);
  return false;
}

function moriStopLabel(room, stop) {
  if (stop?.islandId) return room?.islands?.find(item => item.id === stop.islandId)?.name || stop.islandId;
  if (stop?.mapObjectId === 'citadel') return 'Цитадель';
  return 'пункт маршрута';
}

function createMoriAssignmentProgress(room, player, card) {
  const stops = moriAssignmentStops(card);
  if (!stops.length) return null;
  const startsOnFirstStop = moriStopMatches(room, player, stops[0]);
  return {
    kind: 'mori-service',
    nextStopIndex: 0,
    completedStopCount: 0,
    departureRequired: startsOnFirstStop,
    departureSatisfied: !startsOnFirstStop,
    completedStops: [],
  };
}

function ensureMoriAssignmentProgress(room, player) {
  const task = getActiveAssignmentTask(player);
  const card = task?.payload;
  if (!task || !card || task.source?.factionId !== 'mori') return null;
  if (!['visit-island', 'visit-route'].includes(card.type)) return null;
  if (!task.progress || task.progress.kind !== 'mori-service') {
    task.progress = createMoriAssignmentProgress(room, player, card);
  }
  task.progress.completedStops ||= [];
  task.progress.nextStopIndex = Math.max(0, Number(task.progress.nextStopIndex) || 0);
  task.progress.completedStopCount = Math.max(0, Number(task.progress.completedStopCount) || task.progress.completedStops.length || 0);
  assignTask(player, task);
  return { task, progress: task.progress };
}

function noteMoriAssignmentDeparture(room, player) {
  const ensured = ensureMoriAssignmentProgress(room, player);
  const task = ensured?.task;
  const progress = ensured?.progress;
  if (!task || !progress || progress.nextStopIndex !== 0 || !progress.departureRequired || progress.departureSatisfied) {
    return { ok: Boolean(progress), changed: false, progress };
  }
  const firstStop = moriAssignmentStops(task.payload)[0];
  if (!firstStop || moriStopMatches(room, player, firstStop)) return { ok: true, changed: false, progress };
  progress.departureSatisfied = true;
  assignTask(player, task);
  return { ok: true, changed: true, progress };
}
function advanceMoriAssignmentNavigation(room, player, from = null) {
  const ensured = ensureMoriAssignmentProgress(room, player);
  const task = ensured?.task;
  const progress = ensured?.progress;
  const card = task?.payload;
  if (!task || !card || !progress) return { ok: false, active: false };
  const stops = moriAssignmentStops(card);
  if (!stops.length || progress.nextStopIndex >= stops.length) return { ok: false, active: true };

  const targetIndex = progress.nextStopIndex;
  const target = stops[targetIndex];
  let departureChanged = false;

  if (targetIndex === 0 && progress.departureRequired && !progress.departureSatisfied) {
    const fromKnown = Number.isFinite(Number(from?.row)) && Number.isFinite(Number(from?.col));
    const fromAtTarget = fromKnown ? moriStopMatches(room, player, target, Number(from.row), Number(from.col)) : true;
    const nowAtTarget = moriStopMatches(room, player, target);
    if (!fromAtTarget || !nowAtTarget) {
      progress.departureSatisfied = true;
      departureChanged = true;
      assignTask(player, task);
    }
    if (!progress.departureSatisfied) {
      return { ok: true, active: true, departureChanged: false, progressed: false, completionEvent: null, progress };
    }
  }

  if (!moriStopMatches(room, player, target)) {
    return { ok: true, active: true, departureChanged, progressed: false, completionEvent: null, progress };
  }

  const stopRecord = {
    index: targetIndex,
    islandId: target.islandId || null,
    mapObjectId: target.mapObjectId || null,
    label: moriStopLabel(room, target),
  };
  progress.completedStops[targetIndex] = stopRecord;
  progress.completedStopCount = Math.max(progress.completedStopCount, targetIndex + 1);
  progress.nextStopIndex = targetIndex + 1;
  assignTask(player, task);

  if (progress.nextStopIndex >= stops.length) {
    return {
      ok: true, active: true, departureChanged, progressed: true, completed: true, stop: stopRecord, progress,
      completionEvent: {
        type: card.type === 'visit-island' ? 'mori-visit-island' : 'mori-visit-route',
        assignmentInstanceId: task.id,
        completedStopCount: stops.length,
        islandId: target.islandId || null,
        mapObjectId: target.mapObjectId || null,
      },
    };
  }

  return {
    ok: true, active: true, departureChanged, progressed: true, completed: false, stop: stopRecord, progress, completionEvent: null,
  };
}

function normalizeAssignmentCompatibility(room, rng = Math.random) {
  if (!room || !Array.isArray(room.players)) return { changed: false, resumeEventPhase: false };
  let changed = false;
  let resumeEventPhase = false;
  const canonicalDecks = createAssignmentDecks(rng);
  room.assignmentDecks ||= {};

  // Retire obsolete prize-building/capture-mode state from restored rooms.
  if (Object.hasOwn(room, 'pendingStatePrize')) {
    delete room.pendingStatePrize;
    changed = true;
  }
  if (room.pendingBattle && Object.hasOwn(room.pendingBattle, 'captureMode')) {
    delete room.pendingBattle.captureMode;
    changed = true;
  }
  if (room.pendingLegendaryReaction && Object.hasOwn(room.pendingLegendaryReaction, 'captureMode')) {
    delete room.pendingLegendaryReaction.captureMode;
    changed = true;
  }
  if (Object.hasOwn(room, 'legendaryDeck')) {
    delete room.legendaryDeck;
    changed = true;
  }

  for (const factionId of Object.keys(ASSIGNMENT_CARDS)) {
    if (!room.assignmentDecks[factionId]) {
      const reservedIds = new Set(room.players
        .map(player => getActiveAssignmentTask(player))
        .filter(task => task?.source?.factionId === factionId && task.payload?.id)
        .map(task => task.payload.id));
      if (room.pendingAssignmentChoice?.kind === 'embassy' && room.pendingAssignmentChoice.factionId === factionId) {
        for (const card of room.pendingAssignmentChoice.options || []) if (card?.id) reservedIds.add(card.id);
      }
      const restoredDeck = canonicalDecks[factionId];
      restoredDeck.drawPile = restoredDeck.drawPile.filter(card => !reservedIds.has(card.id));
      room.assignmentDecks[factionId] = restoredDeck;
      changed = true;
      continue;
    }
    const deck = room.assignmentDecks[factionId];
    for (const key of ['drawPile', 'discard', 'removed']) {
      if (!Array.isArray(deck[key])) { deck[key] = []; changed = true; }
    }
  }

  for (const player of room.players) {
    if (Object.hasOwn(player, 'replacedAssignmentConditions')) {
      delete player.replacedAssignmentConditions;
      changed = true;
    }
    const pendingLegendary = Math.max(0, Math.floor(Number(player.pendingLegendary) || 0));
    if (pendingLegendary > 0) {
      player.legendaryCards ||= [];
      for (let i = 0; i < pendingLegendary; i++) {
        const card = drawLegendaryCard(room, rng);
        if (card) player.legendaryCards.push(card);
      }
      delete player.pendingLegendary;
      changed = true;
    } else if (Object.hasOwn(player, 'pendingLegendary')) {
      delete player.pendingLegendary;
      changed = true;
    }
    const assignment = player.activeAssignment;
    if (!assignment?.card) continue;
    if (!assignment.instanceId) {
      assignment.instanceId = ['legacy', player.id || 'player', assignment.factionId || 'unknown', assignment.card.id || assignment.card.conditionKey || 'assignment', Number(assignment.issuedRound) || Number(room.round) || 1].join(':');
      changed = true;
    }
    if (assignment.factionId === 'mori' && ['visit-island', 'visit-route'].includes(assignment.card.type) && !assignment.progress) {
      assignment.progress = createMoriAssignmentProgress(room, player, assignment.card);
      changed = true;
    }
  }

  if (room.pendingAssignmentChoice && room.pendingAssignmentChoice.kind !== 'embassy') {
    room.pendingAssignmentChoice = null;
    changed = true;
  }

  if (room.eventPhase?.active && room.eventPhase.stage === 'assignment-replace') {
    room.eventPhase.stage = 'assignment';
    room.eventPhase.assignmentQueue ||= [];
    room.eventPhase.assignmentIndex = room.eventPhase.assignmentQueue.length;
    delete room.eventPhase.replacementQueue;
    delete room.eventPhase.replacementIndex;
    changed = true;
    resumeEventPhase = true;
  }

  return { changed, resumeEventPhase };
}

function normalizeStage6Compatibility(room, rng = Math.random) {
  const base = normalizeAssignmentCompatibility(room, rng);
  if (!room || !Array.isArray(room.players)) return base;
  let changed = Boolean(base.changed);

  if (!room.legendaryPlacesExplored || typeof room.legendaryPlacesExplored !== 'object' || Array.isArray(room.legendaryPlacesExplored)) {
    room.legendaryPlacesExplored = {};
    changed = true;
  }

  // Recover the public first-discovery registry from any saved named cards before
  // filling missing player-facing arrays.
  for (const player of room.players) {
    if (!Array.isArray(player.namedPlaceCards)) continue;
    for (const saved of player.namedPlaceCards) {
      const canonical = NAMED_PLACE_CARDS.find(card => card.id === saved?.id || card.placeId === saved?.placeId);
      if (!canonical || room.legendaryPlacesExplored[canonical.placeId]) continue;
      room.legendaryPlacesExplored[canonical.placeId] = player.id;
      changed = true;
    }
  }

  for (const player of room.players) {
    if (!Array.isArray(player.namedPlaceCards)) {
      player.namedPlaceCards = [];
      changed = true;
    }
    for (const card of NAMED_PLACE_CARDS) {
      if (room.legendaryPlacesExplored[card.placeId] !== player.id) continue;
      if (player.namedPlaceCards.some(saved => saved?.id === card.id)) continue;
      player.namedPlaceCards.push(JSON.parse(JSON.stringify(card)));
      changed = true;
    }

    if (!Array.isArray(player.expeditionHistory)) {
      player.expeditionHistory = [];
      changed = true;
    } else {
      const validExpeditionPlaces = new Set(EXPEDITION_CARDS.map(card => card.placeId));
      const filteredHistory = player.expeditionHistory.filter(item => validExpeditionPlaces.has(item?.placeId));
      if (filteredHistory.length !== player.expeditionHistory.length) {
        player.expeditionHistory = filteredHistory;
        changed = true;
      }
    }
    if (!Object.hasOwn(player, 'activeExpedition')) {
      player.activeExpedition = null;
      changed = true;
    }
    if (player.activeExpedition) {
      const active = player.activeExpedition;
      const canonical = EXPEDITION_CARDS.find(card => card.id === active.cardId || card.placeId === active.placeId);
      if (!canonical) {
        player.activeExpedition = null;
        changed = true;
      } else {
        if (!active.cardId) { active.cardId = canonical.id; changed = true; }
        if (!active.name) { active.name = canonical.name; changed = true; }
        if (!active.placeId) { active.placeId = canonical.placeId; changed = true; }
        if (!active.card) { active.card = { ...canonical }; changed = true; }
      }
    }
    if (!Object.hasOwn(player, 'expeditionDrawRound')) {
      player.expeditionDrawRound = null;
      changed = true;
    }
    if (!Number.isFinite(Number(player.expeditionsDrawnThisRound))) {
      player.expeditionsDrawnThisRound = 0;
      changed = true;
    }
    if (!Array.isArray(player.legendaryCards)) {
      player.legendaryCards = [];
      changed = true;
    }
    if (!player.legendaryEffects || typeof player.legendaryEffects !== 'object' || Array.isArray(player.legendaryEffects)) {
      player.legendaryEffects = { seaCurses: [] };
      changed = true;
    } else if (!Array.isArray(player.legendaryEffects.seaCurses)) {
      player.legendaryEffects.seaCurses = [];
      changed = true;
    }
    if (!Array.isArray(player.savedEventCards)) {
      player.savedEventCards = [];
      changed = true;
    }
  }

  const reservedExpeditionIds = new Set(room.players.map(player => player.activeExpedition?.cardId).filter(Boolean));
  if (!room.expeditionDeck || !Array.isArray(room.expeditionDeck.drawPile)) {
    room.expeditionDeck = createExpeditionDeck(rng);
    room.expeditionDeck.drawPile = room.expeditionDeck.drawPile.filter(card => !reservedExpeditionIds.has(card.id));
    changed = true;
  } else {
    const canonicalIds = new Set(EXPEDITION_CARDS.map(card => card.id));
    const filteredDeck = room.expeditionDeck.drawPile.filter(card => canonicalIds.has(card?.id) && !reservedExpeditionIds.has(card.id));
    if (filteredDeck.length !== room.expeditionDeck.drawPile.length) {
      room.expeditionDeck.drawPile = filteredDeck;
      changed = true;
    }
  }
  if (!Array.isArray(room.pendingExpeditionRewards)) {
    room.pendingExpeditionRewards = [];
    changed = true;
  }

  return { ...base, changed };
}

function assignAssignmentCard(room, player, factionId, card, rng = Math.random) {
  ensureAssignmentPlayer(player);
  if (getActiveAssignmentTask(player)) return { ok: false, error: 'У игрока уже есть активное поручение.' };
  if (!card) return { ok: false, empty: true, error: 'Подходящего поручения сейчас нет.' };
  const issuedRound = Number(room.round) || 1;
  const semantic = {
    kind: 'assignment',
    id: [factionId, card.id, Date.now(), Math.floor((Number(rng()) || 0) * 1e9)].join(':'),
    ownerId: player.id,
    state: 'active',
    source: { factionId, issuedRound },
    payload: { ...card },
  };
  if (factionId === 'mori' && ['visit-island', 'visit-route'].includes(card.type)) {
    semantic.progress = createMoriAssignmentProgress(room, player, card);
  }
  assignTask(player, Task.view(semantic));
  return { ok: true, assignment: player.activeAssignment };
}

function issueAssignment(room, player, factionId, rng = Math.random) {
  ensureAssignmentPlayer(player);
  if (getActiveAssignmentTask(player)) return { ok: false, error: 'У игрока уже есть активное поручение.' };
  const card = drawAssignmentCard(room, player, factionId, rng);
  return assignAssignmentCard(room, player, factionId, card, rng);
}

function offerAssignmentCards(room, player, factionId, count = 2, rng = Math.random) {
  ensureAssignmentPlayer(player);
  if (getActiveAssignmentTask(player)) return { ok: false, error: 'У игрока уже есть активное поручение.', cards: [] };
  const pool = assignmentPoolFor(room, factionId, rng);
  return { ok: true, cards: pool?.offerEligible(player, count) || [] };
}

function chooseAssignmentOffer(room, player, factionId, offeredCards, cardId, rng = Math.random) {
  ensureAssignmentPlayer(player);
  if (getActiveAssignmentTask(player)) return { ok: false, error: 'У игрока уже есть активное поручение.' };
  const pool = assignmentPoolFor(room, factionId, rng);
  if (!pool) return { ok: false, error: 'Колода поручений не найдена.' };
  const choice = pool.chooseOffered(offeredCards, cardId);
  if (!choice.chosen) return { ok: false, error: 'Выберите одно из предложенных поручений.' };
  return assignAssignmentCard(room, player, factionId, choice.chosen, rng);
}


function assignmentBuildingRequirement(room, player, task) {
  const card = task?.payload;
  if (!card || !['build-branch', 'build-type'].includes(card.type)) return null;

  const targetBranch = card.type === 'build-branch'
    ? card.branch
    : BUILDINGS[card.buildingType]?.branch;
  if (!targetBranch) return null;

  const islands = (room?.islands || []).filter(island => {
    if (island.ownerId !== player.id || !playerOnIsland(player, island)) return false;
    if (card.type === 'build-branch') return island.id === card.islandId;
    return !card.resource || (island.resources || []).includes(card.resource);
  });

  const buildOptions = [];
  const upgradeOptions = [];
  const bastionOptions = [];
  const blueprintOptions = [];
  const saved = player.savedEventCards || [];

  for (const island of islands) {
    if (card.type === 'build-branch') {
      for (const [buildingType, def] of Object.entries(BUILDINGS)) {
        if (def.branch !== targetBranch) continue;
        if (canBuild(room, player, island, buildingType).ok) {
          buildOptions.push({ islandId: island.id, buildingType });
        }
      }
    } else if (canBuild(room, player, island, card.buildingType).ok) {
      buildOptions.push({ islandId: island.id, buildingType: card.buildingType });
    }

    for (const [buildingIndex, building] of (island.buildings || []).entries()) {
      const allowed = canUpgradeBuilding(room, player, island, buildingIndex);
      if (!allowed.ok) continue;
      if (card.type === 'build-branch') {
        if (BUILDINGS[building.type]?.branch === targetBranch) {
          upgradeOptions.push({ islandId: island.id, buildingIndex });
        }
      } else if (building.type === card.buildingType || allowed.target?.type === card.buildingType) {
        upgradeOptions.push({ islandId: island.id, buildingIndex });
      }
    }

    if (card.type === 'build-branch' && targetBranch === 'fort') {
      for (const buildingIndex of fortressThreeIndices(island)) {
        if (canBuildBastion(room, player, island, buildingIndex).ok) {
          bastionOptions.push({ islandId: island.id, buildingIndex });
        }
      }
    }

    for (const held of saved) {
      const buildingType = held.kind === 'market-blueprint' ? 'market'
        : held.kind === 'farm-blueprint' ? 'farm'
          : null;
      if (!buildingType) continue;
      const def = BUILDINGS[buildingType];
      const matches = card.type === 'build-branch'
        ? def?.branch === targetBranch
        : buildingType === card.buildingType;
      if (!matches || !canBuildFree(room, player, island, buildingType).ok) continue;
      blueprintOptions.push({ islandId: island.id, savedCardId: held.id, buildingType });
    }
  }

  if (!buildOptions.length && !upgradeOptions.length && !bastionOptions.length && !blueprintOptions.length) return null;
  return {
    kind: 'building',
    assignmentInstanceId: task.id,
    text: card.text,
    buildOptions,
    upgradeOptions,
    bastionOptions,
    blueprintOptions,
  };
}

function assignmentAssaultAvailable(room, player, island, playerOwnedOnly = false) {
  if (!room || !player || !island || !playerOnIsland(player, island)) return false;
  if (island.ownerId === player.id) return false;
  if (!island.ownerId && island.kind === 'free') return false;
  if (isIslandProtected(island) || isCitadelPeaceCell(player.row, player.col)) return false;

  if (island.ownerId) {
    const owner = (room.players || []).find(p => p.id === island.ownerId);
    if (!owner || owner.id === player.id) return false;
    if (areAllies(room, player, owner) || isFormerAllyBlocked(player, owner.id)) return false;
    if (!canAttackPlayerThisRound(room, player, owner.id).ok) return false;
  } else if (playerOwnedOnly) {
    return false;
  }

  return true;
}

function assignmentDeliveryHoldIds(room, player, task) {
  const card = task?.payload;
  if (!card || card.type !== 'delivery') return [];
  const ids = ['main', ...(player.escorts || []).map(escort => escort.id)];
  const out = [];
  for (const holdId of ids) {
    const allowed = canSellCargo(room, player, holdId);
    if (!allowed.ok) continue;
    const cargo = allowed.hold?.cargo;
    if (!cargo || cargo.assignmentInstanceId !== task.id) continue;
    if ((Number(cargo.quantity) || 0) !== (Number(allowed.hold.capacity) || 0)) continue;
    if (card.goodIds && !card.goodIds.includes(cargo.goodId)) continue;
    out.push(allowed.hold.id);
  }
  return out;
}

function assignmentRequiredAction(room, player, actionsLeft = 0) {
  const task = getActiveAssignmentTask(player);
  const card = task?.payload;
  if (!room || !player || !task || !card || (Number(actionsLeft) || 0) <= 0) return null;

  if (card.type === 'build-branch' || card.type === 'build-type') {
    return assignmentBuildingRequirement(room, player, task);
  }

  if (card.type === 'ship-level') {
    if (!canBuyShipLevel(player).ok) return null;
    return { kind: 'ship-level', assignmentInstanceId: task.id, text: card.text };
  }

  if (card.type === 'stat-upgrade') {
    const upgradeIds = Object.entries(SHIP_UPGRADES)
      .filter(([, upgrade]) => upgrade.branch === card.branch && !upgrade.retired)
      .filter(([upgradeId]) => canBuyShipUpgrade(player, upgradeId).ok)
      .map(([upgradeId]) => upgradeId);
    const atCitadel = isCitadelCell(player.row, player.col);
    const shipMasterIds = atCitadel
      ? (player.savedEventCards || []).filter(saved => saved.kind === 'ship-master').map(saved => saved.id)
      : [];
    const freeUpgradeIds = atCitadel
      ? Object.entries(SHIP_UPGRADES)
        .filter(([, upgrade]) => upgrade.branch === card.branch && !upgrade.retired)
        .filter(([upgradeId]) => canInstallShipUpgradeFree(player, upgradeId).ok)
        .map(([upgradeId]) => upgradeId)
      : [];
    if (!upgradeIds.length && !(shipMasterIds.length && freeUpgradeIds.length)) return null;
    return {
      kind: 'ship-upgrade',
      assignmentInstanceId: task.id,
      text: card.text,
      upgradeIds,
      shipMasterIds,
      freeUpgradeIds,
    };
  }

  if (card.type === 'anchor-win') {
    const anchor = anchorAt(player.row, player.col);
    const colors = card.colors?.length ? card.colors : ['blue', 'yellow'];
    const visitKey = cellKey(player.row, player.col);
    if (!anchor || !colors.includes(anchor.color) || (player.visitedAnchors || []).includes(visitKey)) return null;
    return { kind: 'anchor', assignmentInstanceId: task.id, text: card.text, color: anchor.color };
  }

  if (card.type === 'delivery') {
    const holdIds = assignmentDeliveryHoldIds(room, player, task);
    if (!holdIds.length) return null;
    return { kind: 'delivery', assignmentInstanceId: task.id, text: card.text, holdIds };
  }

  if (card.type === 'attack-player-island') {
    const islandIds = (room.islands || [])
      .filter(island => assignmentAssaultAvailable(room, player, island, true))
      .map(island => island.id);
    if (!islandIds.length) return null;
    return { kind: 'assault', assignmentInstanceId: task.id, text: card.text, islandIds };
  }

  if (card.type === 'capture-island') {
    const island = (room.islands || []).find(item => item.id === card.islandId);
    if (!assignmentAssaultAvailable(room, player, island, false)) return null;
    return { kind: 'assault', assignmentInstanceId: task.id, text: card.text, islandIds: [card.islandId] };
  }

  if (card.type === 'treasure-resolved') {
    if (!emptyCargoHolds(room, player).length) return null;
    const savedCardIds = (player.savedEventCards || [])
      .filter(saved => saved.kind === 'treasure-cargo' && saved.assignmentInstanceId === task.id)
      .map(saved => saved.id);
    if (!savedCardIds.length) return null;
    return { kind: 'treasure', assignmentInstanceId: task.id, text: card.text, savedCardIds };
  }

  // Visits are resolved on arrival. Mori island/route progress is activated separately in 5.8.4.
  return null;
}

function assignmentEventMatches(player, event) {
  const task = getActiveAssignmentTask(player);
  const card = task?.payload;
  if (!task || !card || !event) return false;
  if (card.type === 'capture-island') return event.type === 'capture-island' && event.islandId === card.islandId;
  if (card.type === 'build-branch') return event.type === 'building-action' && event.branch === card.branch && (!card.islandId || event.islandId === card.islandId);
  if (card.type === 'build-type') {
    if (event.type !== 'building-action') return false;
    const matchesType = event.buildingType === card.buildingType || event.previousBuildingType === card.buildingType;
    return matchesType && (!card.resource || (event.islandResources || []).includes(card.resource));
  }
  if (card.type === 'ship-level') return event.type === 'ship-level';
  if (card.type === 'stat-upgrade') return event.type === 'ship-upgrade' && event.branch === card.branch;
  if (card.type === 'anchor-win') {
    const colors = card.colors?.length ? card.colors : ['blue', 'yellow'];
    return event.type === 'anchor-win' && colors.includes(event.color);
  }
  if (card.type === 'visit-place') return event.type === 'visit-place' && event.placeId === card.placeId;
  if (card.type === 'visit-island') {
    return event.type === 'mori-visit-island' && event.assignmentInstanceId === task.id && event.islandId === card.islandId;
  }
  if (card.type === 'visit-route') {
    const route = Array.isArray(card.route) ? card.route : [];
    return event.type === 'mori-visit-route' && event.assignmentInstanceId === task.id && event.completedStopCount === route.length;
  }
  if (card.type === 'attack-player-island') return event.type === 'attack-player-island';
  if (card.type === 'treasure-resolved') {
    return event.type === 'treasure-resolved' && event.assignmentInstanceId === task.id;
  }
  if (card.type === 'delivery') {
    if (event.type !== 'delivery' || event.fullHold !== true) return false;
    if (event.assignmentInstanceId !== task.id) return false;
    return !card.goodIds || card.goodIds.includes(event.goodId);
  }
  return false;
}

function assignmentRewardShare(factionId) {
  return Math.max(0, Math.min(1, Number(FACTIONS[factionId]?.rewardShare) || 0));
}

function completeAssignment(room, player, event) {
  ensureAssignmentPlayer(player);
  if (!assignmentEventMatches(player, event)) return { ok: false, matched: false };
  const task = getActiveAssignmentTask(player);
  const card = task.payload;
  const factionId = task.source?.factionId;
  const gross = Math.max(0, Math.floor(Number(card.reward) || 0));
  const rewardShare = assignmentRewardShare(factionId);
  const withheld = Math.floor(gross * rewardShare);
  const paid = Math.max(0, gross - withheld);
  const credit = creditDucats(player, paid);
  discardAssignmentCard(room, factionId, card);
  const assignment = completeAssignmentTask(player);
  return { ok: true, matched: true, assignment, gross, rewardShare, withheld, paid, credit };
}

function settleVassalTax(player, factionId) {
  const faction = FACTIONS[factionId];
  const due = Math.max(0, Math.floor(Number(faction?.tax) || 0));
  if (!player || !faction || due <= 0) {
    return { ok: true, applies: false, factionId: factionId || null, due: 0, paid: 0, underpaid: false, actionLimit: null };
  }

  const before = Math.max(0, Math.floor(Number(player.ducats) || 0));
  const paid = Math.min(before, due);
  player.ducats = before - paid;
  const underpaid = paid < due;
  let actionLimit = null;

  if (underpaid) {
    const normalLimit = Math.max(0, Math.floor(Number(BALANCE.session.actionsPerTurn) || 0));
    const penaltyLimit = Math.max(0, Math.floor(Number(BALANCE.session.taxUnderpaymentActionLimit) || 0));
    const existing = player.nextActionLimit == null ? NaN : Number(player.nextActionLimit);
    const baseLimit = Number.isFinite(existing) && existing >= 0 ? existing : normalLimit;
    actionLimit = Math.min(baseLimit, penaltyLimit);
    player.nextActionLimit = actionLimit;
  }

  return {
    ok: true,
    applies: true,
    factionId,
    factionName: faction.name,
    due,
    paid,
    underpaid,
    actionLimit,
  };
}

function legendaryPlaceAt(row, col) {
  return Object.values(LEGENDARY_PLACES).find(p => p.row === Number(row) && p.col === Number(col)) || null;
}

function legendaryPlaceRule(placeId) {
  return LEGENDARY_PLACE_RULES.find(place => place.id === String(placeId || '')) || null;
}

function legendaryPlaceForIsland(islandId) {
  return LEGENDARY_PLACE_RULES.find(place => place.kind === 'island' && place.islandId === String(islandId || '')) || null;
}

function namedPlaceCardFor(placeId) {
  return NAMED_PLACE_CARDS.find(card => card.placeId === String(placeId || '')) || null;
}

function claimLegendaryPlaceDiscovery(room, player, placeId, rng = Math.random) {
  const place = legendaryPlaceRule(placeId);
  if (!room || !player || !place) return { ok: false, first: false, place: place || null, namedCard: null, legendaryCards: [] };
  room.legendaryPlacesExplored ||= {};
  const exploredBy = room.legendaryPlacesExplored[place.id] || null;
  if (exploredBy) return { ok: true, first: false, place, exploredBy, namedCard: null, legendaryCards: [] };

  room.legendaryPlacesExplored[place.id] = player.id;
  const card = namedPlaceCardFor(place.id);
  player.namedPlaceCards ||= [];
  let namedCard = null;
  if (card && !player.namedPlaceCards.some(item => item.id === card.id)) {
    namedCard = JSON.parse(JSON.stringify(card));
    player.namedPlaceCards.push(namedCard);
  }

  const legendaryCards = [];
  const count = place.reward?.type === 'legendary' ? Math.max(0, Number(place.reward.count) || 0) : 0;
  player.legendaryCards ||= [];
  for (let i = 0; i < count; i++) {
    const legendary = drawLegendaryCard(room, rng);
    if (legendary) {
      player.legendaryCards.push(legendary);
      legendaryCards.push(legendary);
    }
  }
  return {
    ok: true,
    first: true,
    place,
    exploredBy: player.id,
    namedCard,
    legendaryCards,
    legendaryCard: legendaryCards[0] || null,
  };
}

function expeditionHistory(player) {
  player.expeditionHistory ||= [];
  return player.expeditionHistory;
}

function expeditionCompletionCount(player, placeId) {
  return expeditionHistory(player).filter(item => item.placeId === String(placeId || '')).length;
}

function playerAtExpeditionPlace(room, player, placeId) {
  const place = legendaryPlaceRule(placeId);
  if (!room || !player || !place) return false;
  if (place.kind === 'sea') {
    const mapPlace = LEGENDARY_PLACES[place.mapPlaceId || place.id];
    return Boolean(mapPlace && Number(player.row) === Number(mapPlace.row) && Number(player.col) === Number(mapPlace.col));
  }
  const island = room.islands?.find(item => item.id === place.islandId);
  return Boolean(island && playerOnIsland(player, island));
}

function expeditionCardEligibleForPlayer(player, card) {
  const limit = Math.max(1, Number(BALANCE.expeditionLimits?.completionsPerPlacePerPlayer) || 1);
  return Boolean(card?.placeId) && expeditionCompletionCount(player, card.placeId) < limit;
}

function expeditionPoolFor(room, rng = Math.random) {
  return expeditionPool(room, rng, { isEligible: expeditionCardEligibleForPlayer });
}

function canTakeExpedition(room, player) {
  if (!room || !player) return { ok: false, error: 'Игрок экспедиции не найден.' };
  const cartographyIsland = (room.islands || []).find(island =>
    island.ownerId === player.id
    && playerOnIsland(player, island)
    && (island.buildings || []).some(building => building.type === 'cartography')
  );
  if (BUILDINGS.cartography?.effect?.type !== 'expedition-access' || !cartographyIsland) {
    return { ok: false, error: 'Экспедицию берут на клетке своего острова с Картографической палатой.' };
  }
  if (player.activeExpedition) return { ok: false, error: 'Сначала завершите текущую экспедицию.' };
  const perRound = Math.max(1, Number(BALANCE.expeditionLimits?.drawsPerRound) || 1);
  const takenThisRound = Number(player.expeditionDrawRound) === Number(room.round)
    ? Math.max(1, Number(player.expeditionsDrawnThisRound) || 1)
    : 0;
  if (takenThisRound >= perRound) return { ok: false, error: 'В текущем общем раунде экспедиция уже получалась.' };
  const pool = expeditionPoolFor(room);
  if (!pool?.hasEligible(player)) {
    return { ok: false, error: 'В колоде нет доступной экспедиции на ещё не завершённое вами место.' };
  }
  return { ok: true, islandId: cartographyIsland.id };
}

function takeExpedition(room, player, rng = Math.random) {
  const allowed = canTakeExpedition(room, player);
  if (!allowed.ok) return allowed;
  const card = expeditionPoolFor(room, rng)?.takeEligible(player) || null;
  if (!card) return { ok: false, error: 'В колоде нет доступной экспедиции.' };

  const startedAtTarget = playerAtExpeditionPlace(room, player, card.placeId);
  player.activeExpedition = {
    card: { ...card },
    cardId: card.id,
    name: card.name,
    placeId: card.placeId,
    acceptedRound: Number(room.round) || 1,
    startedAtTarget,
    departedAfterIssue: false,
  };
  player.expeditionDrawRound = Number(room.round) || 1;
  player.expeditionsDrawnThisRound = 1;
  return { ok: true, expedition: player.activeExpedition, requiresLeaveAndReturn: startedAtTarget, actionCost: 1, islandId: allowed.islandId };
}

function completeExpeditionAtArrival(room, player, rng = Math.random) {
  const active = player?.activeExpedition;
  if (!room || !player || !active) return { ok: true, active: false, completed: false };
  const atTarget = playerAtExpeditionPlace(room, player, active.placeId);
  if (!atTarget) {
    if (active.startedAtTarget) active.departedAfterIssue = true;
    return { ok: true, active: true, completed: false, departedAfterIssue: Boolean(active.departedAfterIssue) };
  }
  if (active.startedAtTarget && !active.departedAfterIssue) {
    return { ok: true, active: true, completed: false, requiresLeaveAndReturn: true };
  }

  const card = active.card || EXPEDITION_CARDS.find(item => item.id === active.cardId);
  if (!card) return { ok: false, active: true, completed: false, error: 'Карта активной экспедиции не найдена.' };
  const place = legendaryPlaceRule(active.placeId);
  const history = expeditionHistory(player);
  if (!history.some(item => item.placeId === active.placeId)) {
    history.push({
      placeId: active.placeId,
      name: place?.name || card.name,
      cardId: card.id,
      completedRound: Number(room.round) || 1,
    });
  }
  expeditionPoolFor(room, rng)?.returnCompleted(card);
  player.activeExpedition = null;
  return { ok: true, active: false, completed: true, card: { ...card }, place, reward: card.reward ? { ...card.reward } : null };
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
  if (!room || !FACTIONS[factionId]) return false;
  return room.factionState?.[factionId]?.ceased !== true;
}

function stateOwnedIslandIds(room, factionId) {
  const faction = FACTIONS[factionId];
  if (!room || !faction) return [];
  return (faction.originalIslandIds || []).filter(islandId => {
    const island = room.islands?.find(i => i.id === islandId);
    return Boolean(island && !island.ownerId);
  });
}

function clearCeasedStateRelations(room, factionId) {
  for (const player of room?.players || []) {
    ensurePoliticalPlayer(player);
    player.enemyFactionIds = player.enemyFactionIds.filter(id => id !== factionId);
    if (player.suzerainId === factionId) {
      const task = getActiveAssignmentTask(player);
      if (task?.payload) discardAssignmentCard(room, factionId, task.payload);
      player.suzerainId = null;
      player.vassalGiftIslandId = null;
      completeAssignmentTask(player);
    }
  }
}

function refreshFactionExistence(room) {
  room.factionState ||= {};
  const changes = [];
  for (const factionId of POLITICAL_FACTION_ORDER) {
    const state = (room.factionState[factionId] ||= {});
    const before = state.exists;
    const exists = state.ceased !== true;
    state.exists = exists;
    if (before !== undefined && before !== exists) changes.push({ factionId, before, exists });
    if (!exists) clearCeasedStateRelations(room, factionId);
  }
  return changes;
}

function resolveStateMilitaryCapture(room, player, island, previousOwnerId = null) {
  if (!room || !player || !island || previousOwnerId) return null;
  const factionId = factionIdForIsland(island);
  const faction = FACTIONS[factionId];
  if (!faction || !stateExists(room, factionId)) return null;
  if (stateOwnedIslandIds(room, factionId).length) return null;

  room.factionState ||= {};
  const state = (room.factionState[factionId] ||= {});
  if (state.ceased) return null;

  state.ceased = true;
  state.ceasedRound = Number(room.round) || null;
  state.ceasedByPlayerId = player.id;
  state.ceasedOnIslandId = island.id;
  state.fullConquestClaimed = true; // legacy field retained for saved-room compatibility
  state.fullConquestPlayerId = player.id;
  state.fullConquestRound = Number(room.round) || null;

  const prize = faction.fullConquestPrize || {};
  const amountUnresolved = Boolean(prize.amountUnresolved);
  const ducats = amountUnresolved ? null : Math.max(0, Math.floor(Number(prize.ducats) || 0));
  state.finalPrizeAmountUnresolved = amountUnresolved;
  state.finalPrizeDucats = ducats;

  clearCeasedStateRelations(room, factionId);

  const result = {
    triggered: true,
    factionId,
    factionName: faction.name,
    stateCeased: true,
    playerId: player.id,
    islandId: island.id,
    ducats,
    amountUnresolved,
    excludesIslandDucats: prize.excludesIslandDucats !== false,
    credit: null,
  };
  if (!amountUnresolved && ducats > 0) result.credit = creditDucats(player, ducats);
  return result;
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
  const currentVassal = room.players?.find(p => p.id !== player.id && p.suzerainId === factionId);
  if (currentVassal) return { ok: false, error: `У ${faction.name} уже есть вассал.` };
  if (player.enemyFactionIds.includes(factionId)) return { ok: false, error: 'Правила не описывают вступление в подданство при действующей вражде; это состояние не меняется автоматически.' };
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
  const task = getActiveAssignmentTask(player);
  if (task?.payload) discardAssignmentCard(room, factionId, task.payload);
  player.suzerainId = null;
  player.vassalGiftIslandId = null;
  completeAssignmentTask(player);
  if (!player.enemyFactionIds.includes(factionId)) player.enemyFactionIds.push(factionId);
  refreshFactionExistence(room);
  return { ok: true, faction, gift: returned ? gift : null, returned };
}

function politicalBuildingOptions(room, player, { aboveLevelOne = false, fortsOnly = false, buildingTypes = null } = {}) {
  const allowedTypes = Array.isArray(buildingTypes) && buildingTypes.length ? new Set(buildingTypes) : null;
  const out = [];
  for (const island of room?.islands || []) {
    if (island.ownerId !== player?.id) continue;
    (island.buildings || []).forEach((building, buildingIndex) => {
      if (aboveLevelOne && buildingStage(building) <= 1) return;
      if (fortsOnly && !['fort', 'fortress'].includes(building.type)) return;
      if (allowedTypes && !allowedTypes.has(building.type)) return;
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
  for (const escort of player?.escorts || []) {
    if ((ESCORTS[escort.type]?.cargo || 0) <= 0 || !escort.cargo) continue;
    out.push({ id: escort.id, name: ESCORTS[escort.type]?.name || 'Судно сопровождения', goodId: escort.cargo.goodId, quantity: escort.cargo.quantity });
  }
  return out;
}

function discardRandomHeldCard(room, player, rng = Math.random) {
  // Активное поручение — отдельная Task, а не held inventory; случайный сброс
  // карты вражды выбирает только реальные held entries и не затрагивает поручение.
  const refs = [];
  (player?.specialCards || []).forEach((name, index) => refs.push({ source: 'special', index, name }));
  (player?.legendaryCards || []).forEach((card, index) => refs.push({ source: 'legendary', index, name: card.name, card }));
  (player?.savedEventCards || []).forEach((card, index) => refs.push({ source: 'saved-event', index, name: card.name, card }));
  if (!refs.length) return { ok: true, discarded: null };
  const ref = refs[Math.floor(rng() * refs.length)];
  if (ref.source === 'special') player.specialCards.splice(ref.index, 1);
  else if (ref.source === 'legendary') {
    player.legendaryCards.splice(ref.index, 1);
  } else {
    const [card] = player.savedEventCards.splice(ref.index, 1);
    if (card?.sourceCard && card.sourceDeck === 'event') {
      sailingEventSource(room)?.releaseReserved(card.sourceCard);
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
  const activeTask = getActiveAssignmentTask(player);
  if (activeTask?.id) cargo.assignmentInstanceId = activeTask.id;
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
  if (!upgrade || upgrade.retired) return { ok: false, error: 'Это улучшение больше не устанавливается.' };
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Улучшения устанавливаются только в Цитадели.' };
  player.upgrades ||= [];
  if (player.upgrades.includes(upgradeId)) return { ok: false, error: 'Такое улучшение уже установлено.' };
  if (repeatsInnatePassability(player, upgrade)) return { ok: false, error: 'Этот класс корабля уже проходит такое препятствие без улучшения.' };
  if (player.upgrades.length >= shipUpgradeSlotLimit(player)) return { ok: false, error: 'Нет свободного места для улучшения на текущем уровне корабля.' };
  const branchCountValue = player.upgrades.filter(id => SHIP_UPGRADES[id]?.branch === upgrade.branch).length;
  if (branchCountValue >= BALANCE.maxBranchUpgrades) return { ok: false, error: 'В этой ветви уже установлены два улучшения.' };
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
  const building = { type, ...(def.singleStage ? {} : { level: 1 }), createdAt: Date.now(), freeCard: true };
  island.buildings.push(building);
  return { ok: true, island, building: { ...def, displayName: buildingDisplayName(building) } };
}

function raidBuildingOptions(room, player) {
  const options = [];
  for (const island of room?.islands || []) {
    if (island.ownerId !== player.id) continue;
    (island.buildings || []).forEach((building, index) => {
      options.push({ islandId: island.id, islandName: island.name, buildingIndex: index, name: buildingDisplayName(building) });
    });
  }
  return options;
}

function applyRaidDowngrade(room, player, islandId, buildingIndex) {
  const island = room?.islands?.find(i => i.id === islandId && i.ownerId === player.id);
  const index = Number(buildingIndex);
  if (!island || !Number.isInteger(index) || !island.buildings?.[index]) return { ok: false, error: 'Постройка не найдена.' };
  const before = island.buildings[index];
  const beforeName = buildingDisplayName(before);
  if (buildingStage(before) <= 1) {
    island.buildings.splice(index, 1);
    return { ok: true, island, beforeName, afterName: null, removed: true };
  }
  island.buildings[index] = downgradeBuildingOneStep(before);
  return { ok: true, island, beforeName, afterName: buildingDisplayName(island.buildings[index]), removed: false };
}

function applyFeudBuildingDowngrade(room, player, islandId, buildingIndex) {
  const island = room?.islands?.find(i => i.id === islandId && i.ownerId === player?.id);
  const index = Number(buildingIndex);
  if (!island || !Number.isInteger(index) || !island.buildings?.[index]) return { ok: false, error: 'Постройка не найдена.' };
  const before = island.buildings[index];
  const beforeName = buildingDisplayName(before);
  if (buildingStage(before) <= 1) {
    island.buildings.splice(index, 1);
    return { ok: true, island, beforeName, afterName: null, removed: true };
  }
  island.buildings[index] = downgradeBuildingOneStep(before);
  return { ok: true, island, beforeName, afterName: buildingDisplayName(island.buildings[index]), removed: false };
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
  return (island.cells || []).filter(([row, col]) => navigationAllowsHazards(player, hazardsAt(row, col))).map(([row, col]) => ({ row, col }));
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
  const required = Math.max(BALANCE.combat.anchorLoss.minimum, Math.floor(treasury * BALANCE.combat.anchorLoss.ratio));
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
    fleetPoints: 0,
    actionCost: card.quiet ? 0 : 1,
    reward: null,
    penalty: null,
  };

  if (!card.quiet) {
    if (result.fleetPower > card.artillery) {
      result.outcome = 'win';
      result.reward = creditDucats(player, card.reward);
      result.fleetPoints = Math.max(0, Math.floor(Number(BALANCE.fleetScoring?.anchor?.[anchor.color]) || 0));
      player.fleetPoints = Math.max(0, Number(player.fleetPoints) || 0) + result.fleetPoints;
    } else if (result.fleetPower < card.artillery) {
      result.outcome = 'loss';
      result.penalty = anchorLoss(player);
    }
  }

  seaEncounterSource(room, anchor.color, rng).markUsed(card);
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
    fleetPoints: result.fleetPoints,
    reward: result.reward ? { ...result.reward } : null,
    penalty: result.penalty ? { ...result.penalty } : null,
  };
  return result;
}

function reachableCells(player, maxDistance) {
  const limit = Math.max(0, Number(maxDistance) || 0);
  const passabilities = navigationPassabilities(player);
  const canCrossLand = passabilities.has('land1');
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
      if (row < 0 || row >= MAP_META.rows || col < 0 || col >= MAP_META.cols) continue;
      const hazards = hazardsAt(row, col);
      if (!hazards.every(hazard => passabilities.has(hazard))) continue;

      const nextLand = isLand(row, col);
      const currentLand = isLand(cur.row, cur.col);
      const nd = cur.dist + 1;

      if (nextLand) {
        if (canCrossLand) {
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
  return reachableCells(player, MAP_META.rows * MAP_META.cols);
}

function ensureLegendaryEffects(player) {
  player.legendaryEffects ||= {};
  player.legendaryEffects.seaCurses ||= [];
  return player.legendaryEffects;
}

function isShipProtected(player) {
  return Math.max(0, Number(player?.legendaryEffects?.shipVeil?.remaining) || 0) > 0
    || Boolean(player?.legendaryEffects?.shipVeilReaction);
}

function isIslandProtected(island) {
  return Math.max(0, Number(island?.legendaryVeil?.remaining) || 0) > 0
    || Boolean(island?.legendaryVeilReaction);
}

function applySeaVeilHostileReactionToShip(player, sourcePlayerId) {
  if (!player || !sourcePlayerId) return { ok: false, error: 'Цель реактивного «Покрова моря» не найдена.' };
  const expiry = BALANCE.legendaryEffects['sea-veil'].hostileCardReactionExpiry;
  if (expiry !== 'end-of-current-turn') return { ok: false, error: 'Неизвестная длительность реактивного «Покрова моря».' };
  const effects = ensureLegendaryEffects(player);
  effects.shipVeilReaction = { expiry, expiresOnPlayerId: String(sourcePlayerId) };
  return { ok: true, expiry };
}

function applySeaVeilHostileReactionToIsland(island, sourcePlayer, sourceTurnPlayerId) {
  if (!island || !sourcePlayer || !sourceTurnPlayerId) return { ok: false, error: 'Цель реактивного «Покрова моря» не найдена.' };
  const expiry = BALANCE.legendaryEffects['sea-veil'].hostileCardReactionExpiry;
  if (expiry !== 'end-of-current-turn') return { ok: false, error: 'Неизвестная длительность реактивного «Покрова моря».' };
  island.legendaryVeilReaction = {
    expiry,
    sourcePlayerId: String(sourcePlayer.id || ''),
    expiresOnPlayerId: String(sourceTurnPlayerId),
  };
  return { ok: true, expiry };
}

function clearSeaVeilHostileReactionsAtTurnEnd(room, endingPlayerId) {
  const endingId = String(endingPlayerId || '');
  if (!room || !endingId) return [];
  const expired = [];
  for (const player of room.players || []) {
    const reaction = player?.legendaryEffects?.shipVeilReaction;
    if (reaction?.expiresOnPlayerId !== endingId) continue;
    delete player.legendaryEffects.shipVeilReaction;
    expired.push({ kind: 'ship', playerId: player.id });
  }
  for (const island of room.islands || []) {
    const reaction = island?.legendaryVeilReaction;
    if (reaction?.expiresOnPlayerId !== endingId) continue;
    island.legendaryVeilReaction = null;
    expired.push({ kind: 'island', islandId: island.id, playerId: reaction.sourcePlayerId || null });
  }
  return expired;
}

function applySeaVeilToShip(player, options = {}) {
  if (!player) return { ok: false, error: 'Корабль не найден.' };
  const effects = ensureLegendaryEffects(player);
  effects.shipVeil = {
    remaining: BALANCE.legendaryEffects['sea-veil'].durationPersonalTurns,
    sourcePlayerId: String(options.sourcePlayerId || player.id || ''),
    ignoreTurnNo: options.ignoreCurrentTurn ? (Number(player.personalTurnNo) || 0) : null,
  };
  return { ok: true, remaining: BALANCE.legendaryEffects['sea-veil'].durationPersonalTurns };
}

function applySeaVeilToIsland(island, sourcePlayer, options = {}) {
  if (!island || !sourcePlayer) return { ok: false, error: 'Цель защиты не найдена.' };
  island.legendaryVeil = {
    remaining: BALANCE.legendaryEffects['sea-veil'].durationPersonalTurns,
    sourcePlayerId: String(sourcePlayer.id || ''),
    ignoreTurnNo: options.ignoreCurrentTurn ? (Number(sourcePlayer.personalTurnNo) || 0) : null,
  };
  return { ok: true, remaining: BALANCE.legendaryEffects['sea-veil'].durationPersonalTurns };
}

function applySeaCurse(target, sourcePlayerId = null) {
  if (!target) return { ok: false, error: 'Корабль-цель не найден.' };
  const effects = ensureLegendaryEffects(target);
  effects.seaCurses.push({ remaining: BALANCE.legendaryEffects['sea-curse'].durationPersonalTurns, penalty: BALANCE.legendaryEffects['sea-curse'].amount, sourcePlayerId: sourcePlayerId ? String(sourcePlayerId) : null });
  return { ok: true, remaining: BALANCE.legendaryEffects['sea-curse'].durationPersonalTurns, penalty: BALANCE.legendaryEffects['sea-curse'].amount };
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
  const nextBuildings = [];
  for (const building of island.buildings || []) {
    const beforeName = buildingDisplayName(building);
    if (buildingStage(building) <= 1) {
      changed += 1;
      changes.push({ beforeName, afterName: null, removed: true });
      continue;
    }
    const after = downgradeBuildingOneStep(building);
    const afterName = buildingDisplayName(after);
    changed += 1;
    changes.push({ beforeName, afterName, removed: false });
    nextBuildings.push(after);
  }
  island.buildings = nextBuildings;
  return { ok: true, changed, changes, island };
}

function roman(level) {
  return ['', 'I', 'II', 'III'][Number(level) || 1] || String(level);
}

function buildingDisplayName(building) {
  const def = BUILDINGS[building?.type];
  if (!def) return building?.type || 'Постройка';
  if (def.fixedName || (def.category === 'public' && def.id !== 'admiralty')) return def.name;
  return `${def.name} ${roman(building.level || 1)}`;
}

function buildingCount(island, type) {
  return island.buildings.filter(b => b.type === type).length;
}

function branchCount(island, branch) {
  return island.buildings.filter(b => BUILDINGS[b.type]?.branch === branch).length;
}

function hasOwnedBuilding(room, playerId, type) {
  return (room?.islands || []).some(island =>
    island.ownerId === playerId && (island.buildings || []).some(building => building.type === type));
}

function ownedIslandAtPlayer(room, player) {
  return (room?.islands || []).find(island => island.ownerId === player?.id && playerOnIsland(player, island)) || null;
}

function lighthouseDepartureBonus(room, player) {
  const island = ownedIslandAtPlayer(room, player);
  return island && (island.buildings || []).some(building => building.type === 'lighthouse')
    ? Math.max(0, Number(BUILDINGS.lighthouse?.effect?.amount) || 0)
    : 0;
}

function bestAdmiraltyLevelAtPlayer(room, player) {
  let best = 0;
  for (const island of room?.islands || []) {
    if (island.ownerId !== player?.id || !playerOnIsland(player, island)) continue;
    for (const building of island.buildings || []) {
      if (building.type === 'admiralty') best = Math.max(best, Number(building.level) || 1);
    }
  }
  return best;
}

function heldCharacterId(player) {
  return typeof player?.character === 'string' ? player.character : player?.character?.id || null;
}

function characterOptionsAtAdmiralty(room, player, { replacing = false } = {}) {
  const admiraltyLevel = bestAdmiraltyLevelAtPlayer(room, player);
  if (!admiraltyLevel) return [];
  const currentId = heldCharacterId(player);
  const unavailable = new Set((room?.players || [])
    .filter(other => other.id !== player.id)
    .map(heldCharacterId)
    .filter(Boolean));
  return Object.values(CHARACTERS)
    .filter(character => character.admiraltyLevel <= admiraltyLevel)
    .filter(character => !unavailable.has(character.id))
    .filter(character => !replacing || character.id !== currentId)
    .map(character => ({ ...character }));
}

function canTakeCharacter(room, player, characterId) {
  if (!room || !player) return { ok: false, error: 'Игрок не найден.' };
  if (heldCharacterId(player)) return { ok: false, error: 'На основном корабле уже есть персонаж.' };
  const character = characterOptionsAtAdmiralty(room, player).find(item => item.id === characterId);
  if (!character) return { ok: false, error: 'Этот персонаж недоступен в текущем Адмиралтействе.' };
  return { ok: true, character };
}

function takeCharacter(room, player, characterId) {
  const allowed = canTakeCharacter(room, player, characterId);
  if (!allowed.ok) return allowed;
  player.character = { id: allowed.character.id };
  return { ok: true, character: allowed.character };
}

function canReplaceCharacter(room, player, characterId) {
  if (!heldCharacterId(player)) return { ok: false, error: 'На основном корабле нет персонажа для замены.' };
  if (Number(player.characterReplacedRound) === Number(room?.round)) {
    return { ok: false, error: 'Неиспользованного персонажа уже заменяли в этом раунде.' };
  }
  const character = characterOptionsAtAdmiralty(room, player, { replacing: true }).find(item => item.id === characterId);
  if (!character) return { ok: false, error: 'Этот персонаж недоступен для замены в текущем Адмиралтействе.' };
  return { ok: true, character };
}

function replaceCharacter(room, player, characterId) {
  const allowed = canReplaceCharacter(room, player, characterId);
  if (!allowed.ok) return allowed;
  const previousId = heldCharacterId(player);
  player.character = { id: allowed.character.id };
  player.characterReplacedRound = Number(room.round) || 1;
  return { ok: true, previousId, character: allowed.character };
}

function consumeCharacter(player, expectedId) {
  const id = heldCharacterId(player);
  if (!id || (expectedId && id !== expectedId)) return { ok: false, error: 'Нужный персонаж не находится на основном корабле.' };
  const character = CHARACTERS[id];
  player.character = null;
  return { ok: true, character };
}

function cartographerAnchorOptions(player) {
  const range = Math.max(0, Number(CHARACTERS.cartographer?.effect?.range) || 0);
  const out = [];
  for (const [color, anchor] of Object.entries(ANCHORS)) {
    let distance = Infinity;
    for (const [row, col] of anchor.cells || []) {
      distance = Math.min(distance, Math.abs(Number(player?.row) - row) + Math.abs(Number(player?.col) - col));
    }
    if (distance <= range) out.push({ id: color, color, name: anchor.name, distance });
  }
  return out.sort((a, b) => a.distance - b.distance || a.color.localeCompare(b.color));
}

function tradeBuildingIndices(island) {
  const out = [];
  for (const [index, building] of (island?.buildings || []).entries()) {
    if (BUILDINGS[building.type]?.branch === 'money') out.push(index);
  }
  return out;
}

function strongestFortificationStage(room, island) {
  let stage = 0;
  const supportedBastions = island?.ownerId ? new Set(supportedBastionIslandIds(room, island.ownerId)) : new Set();
  for (const building of island?.buildings || []) {
    if (BUILDINGS[building.type]?.branch !== 'fort') continue;
    if (building.type === 'bastion' && !supportedBastions.has(island.id)) continue;
    stage = Math.max(stage, buildingStage(building));
  }
  return stage;
}

function additionalTradeFortificationError(room, island, buildingIndex, target) {
  if (BUILDINGS[target?.type]?.branch !== 'money') return null;
  const tradeIndices = tradeBuildingIndices(island);
  const additional = buildingIndex == null ? tradeIndices.length > 0 : tradeIndices[0] !== buildingIndex;
  if (!additional) return null;
  const requiredStage = buildingStage(target);
  const availableStage = strongestFortificationStage(room, island);
  if (availableStage >= requiredStage) return null;
  return `Для дополнительного здания ветви рынка нужно действующее укрепление строительной ступени ${requiredStage} или выше.`;
}

function buildingStage(building) {
  const def = BUILDINGS[building?.type];
  if (def?.singleStage) return 1;
  const level = Math.max(1, Math.min(3, Number(building?.level) || 1));
  const stage = def?.levels?.[level]?.foodStage;
  return Math.max(1, Number(stage) || level);
}

function foodStage(island) {
  let max = 0;
  for (const b of island.buildings) {
    if (BUILDINGS[b.type]?.branch === 'food') max = Math.max(max, buildingStage(b));
  }
  return max;
}

function buildingArea(building) {
  const level = Math.max(1, Math.min(3, Number(building?.level) || 1));
  const def = BUILDINGS[building?.type];
  return Math.max(0, Number(def?.levels?.[level]?.area ?? def?.area) || 0);
}

function usedArea(island) {
  return island.buildings.reduce((sum, b) => sum + buildingArea(b), 0);
}

function countsAsAdvancedForStatus(building) {
  const def = BUILDINGS[building?.type];
  return Boolean(def?.advanced || def?.countsAsAdvanced);
}

function islandStatus(island) {
  const manors = island.buildings.filter(b => b.type === 'manor');
  const bestManor = manors.reduce((m, b) => Math.max(m, Number(b.level) || 1), 0);
  const nonFood = island.buildings.filter(b => BUILDINGS[b.type]?.branch !== 'food');
  const advancedNonFood = nonFood.filter(countsAsAdvancedForStatus).length;

  if (bestManor >= BALANCE.ranks.port.manorLevel && nonFood.length >= BALANCE.ranks.port.otherBuildings && advancedNonFood >= BALANCE.ranks.port.advancedOtherBuildings) return 'Крупный порт';
  if (bestManor >= BALANCE.ranks.city.manorLevel && nonFood.length >= BALANCE.ranks.city.otherBuildings) return 'Город';
  if (island.buildings.some(b => BUILDINGS[b.type]?.branch === 'food')) return 'Поселение';
  return 'Без поселения';
}

function effectiveArea(island) {
  const status = islandStatus(island);
  if (status === 'Крупный порт') return island.area + BALANCE.ranks.port.areaBonus;
  if (status === 'Город') return island.area + BALANCE.ranks.city.areaBonus;
  return island.area;
}

function branchLimitFor(island) {
  const status = islandStatus(island);
  if (status === 'Крупный порт') return BALANCE.branchLimits.port;
  if (status === 'Город') return BALANCE.branchLimits.city;
  return BALANCE.branchLimits.settlement;
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
  if (!island) return { legal: true, status: 'Без поселения', usedArea: 0, effectiveArea: 0, overArea: 0, branchLimit: BALANCE.branchLimits.settlement, branchViolations: [] };
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
  return (island.buildings || []).map((building, buildingIndex) => {
    const def = BUILDINGS[building.type];
    return {
      buildingIndex,
      name: buildingDisplayName(building),
      type: building.type,
      ...(def?.singleStage ? {} : { level: Number(building.level) || 1 }),
      area: buildingArea(building),
      branch: def?.branch || null,
      branchName: BUILDING_BRANCH_NAMES[def?.branch] || null,
    };
  });
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
      if (b.type === 'stoneworks') slots += BUILDINGS.stoneworks.levels[Number(b.level) || 1]?.bastionSlots || 0;
    }
  }
  return slots;
}

function ownedBastionIslandIds(room, playerId) {
  return (room?.islands || [])
    .filter(island => island.ownerId === playerId && (island.buildings || []).some(b => b.type === 'bastion'))
    .map(island => island.id);
}

function normalizeInactiveBastionIds(room, player) {
  if (!player) return [];
  const owned = ownedBastionIslandIds(room, player.id);
  const valid = new Set(owned);
  const inactive = [];
  for (const id of player.inactiveBastionIslandIds || []) {
    const value = String(id);
    if (valid.has(value) && !inactive.includes(value)) inactive.push(value);
  }
  if (owned.length <= stoneworksSupportCapacity(room, player.id)) inactive.length = 0;
  player.inactiveBastionIslandIds = inactive;
  return inactive;
}

function bastionSupportChoiceNeeds(room, player) {
  if (!room || !player) return { capacity: 0, count: 0, owned: [], requiredInactive: 0, selectedInactive: [], needsChoice: false };
  const owned = ownedBastionIslandIds(room, player.id);
  const capacity = stoneworksSupportCapacity(room, player.id);
  const requiredInactive = Math.max(0, owned.length - capacity);
  const selectedInactive = normalizeInactiveBastionIds(room, player);
  return {
    capacity,
    count: owned.length,
    owned,
    requiredInactive,
    selectedInactive: [...selectedInactive],
    needsChoice: selectedInactive.length !== requiredInactive,
  };
}

function supportedBastionIslandIds(room, playerId) {
  const player = room?.players?.find(p => p.id === playerId);
  if (!player) return [];
  const needs = bastionSupportChoiceNeeds(room, player);
  if (needs.needsChoice) return [];
  const inactive = new Set(needs.selectedInactive);
  return needs.owned.filter(id => !inactive.has(id));
}

function bastionSupportSummary(room, playerId) {
  const player = room?.players?.find(p => p.id === playerId);
  if (!player) return { capacity: 0, count: 0, supported: [], unsupported: [], requiredInactive: 0, selectedInactive: [], choiceRequired: false };
  const needs = bastionSupportChoiceNeeds(room, player);
  const supported = needs.needsChoice ? [] : needs.owned.filter(id => !needs.selectedInactive.includes(id));
  return {
    capacity: needs.capacity,
    count: needs.count,
    supported,
    unsupported: needs.needsChoice ? [...needs.owned] : [...needs.selectedInactive],
    requiredInactive: needs.requiredInactive,
    selectedInactive: [...needs.selectedInactive],
    choiceRequired: needs.needsChoice,
  };
}

function setInactiveBastions(room, player, islandIds) {
  if (!room || !player) return { ok: false, error: 'Игрок не найден.' };
  const needs = bastionSupportChoiceNeeds(room, player);
  const unique = [];
  for (const id of islandIds || []) {
    const value = String(id);
    if (!unique.includes(value)) unique.push(value);
  }
  if (unique.length !== needs.requiredInactive) {
    return { ok: false, error: `Нужно выбрать ровно ${needs.requiredInactive} временно неактивных бастионов.` };
  }
  const owned = new Set(needs.owned);
  if (unique.some(id => !owned.has(id))) return { ok: false, error: 'Выбранный бастион больше не принадлежит игроку.' };
  player.inactiveBastionIslandIds = unique;
  return { ok: true, support: bastionSupportSummary(room, player.id) };
}

function fortressThreeIndices(island) {
  const indices = [];
  for (const [index, building] of (island?.buildings || []).entries()) {
    if (building.type === 'fortress' && Number(building.level) === 3) indices.push(index);
  }
  return indices;
}

function canBuildBastion(room, player, island, buildingIndex = null) {
  if (!room || !player || !island) return { ok: false, error: 'Остров не найден.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Бастион можно создать только на своём острове.' };
  if (!playerOnIsland(player, island)) return { ok: false, error: 'Основной корабль должен находиться на клетке этого острова.' };
  if ((Number(player.ducats) || 0) < BUILDINGS.bastion.price) return { ok: false, error: `Для бастиона нужно ${BUILDINGS.bastion.price} дукатов.` };
  if ((island.buildings || []).some(b => b.type === 'bastion')) return { ok: false, error: 'На одном острове может быть только один бастион.' };
  if (foodStage(island) < BUILDINGS.fortress.levels[3].foodStage) return { ok: false, error: 'Для превращения крепости III нужна пищевая ветвь строительной ступени 6.' };

  const options = fortressThreeIndices(island);
  let index = Number(buildingIndex);
  if (!Number.isInteger(index) || !options.includes(index)) {
    if (buildingIndex == null && options.length === 1) index = options[0];
    else if (!options.length) return { ok: false, error: 'Для бастиона нужна крепость III на этом острове.' };
    else return { ok: false, error: 'Выберите крепость III, которая превращается в бастион.' };
  }

  const support = bastionSupportSummary(room, player.id);
  if (support.count >= support.capacity) return { ok: false, error: 'Нет свободного места поддержки каменотёсного двора.' };

  const current = island.buildings[index];
  const target = { ...current, type: 'bastion', level: 1 };
  const buildings = island.buildings.map((b, i) => i === index ? target : { ...b });
  const candidate = cloneIslandWithBuildings(island, buildings);
  if (usedArea(candidate) > effectiveArea(candidate)) return { ok: false, error: 'После превращения превышена площадь острова.' };
  if (branchCount(candidate, 'fort') > branchLimitFor(candidate)) return { ok: false, error: `Для статуса «${islandStatus(candidate)}» превышен предел защитной ветви.` };
  return { ok: true, support, index, current, target };
}

function buildBastion(room, player, islandId, buildingIndex = null) {
  const island = room?.islands?.find(i => i.id === islandId);
  const allowed = canBuildBastion(room, player, island, buildingIndex);
  if (!allowed.ok) return allowed;
  player.ducats -= BUILDINGS.bastion.price;
  island.buildings[allowed.index] = { ...allowed.target, upgradedAt: Date.now() };
  normalizeInactiveBastionIds(room, player);
  const building = island.buildings[allowed.index];
  const support = bastionSupportSummary(room, player.id);
  return { ok: true, island, building, buildingIndex: allowed.index, price: BUILDINGS.bastion.price, support, name: 'Бастион' };
}

function prioritizeBastionSupport() {
  return { ok: false, error: 'Поддержка бастионов выбирается только при обязательном решении после изменения числа мест каменотёсных дворов.' };
}

function clearIslandGarrison(island) {
  if (!island) return null;
  island.garrisonType = null;
  island.garrisonDefense = null;
  island.garrisonOrigin = null;
  return null;
}

function normalizeIslandGarrison(island) {
  if (!island?.garrisonType) return clearIslandGarrison(island);
  const status = islandStatus(island);
  const storedDefense = Math.max(0, Number(island.garrisonDefense) || 0);

  if (island.garrisonType === 'permanent') {
    if (status === 'Крупный порт') {
      island.garrisonDefense = [BALANCE.garrisons.permanentDirect.defense, BALANCE.garrisons.permanentUpgrade.defense].includes(storedDefense)
        ? storedDefense
        : BALANCE.garrisons.permanentUpgrade.defense;
      island.garrisonOrigin ||= 'legacy-permanent';
      return island.garrisonType;
    }
    if (status === 'Город') {
      island.garrisonType = 'guard';
      island.garrisonDefense = BALANCE.garrisons.downgradedGuard.defense;
      island.garrisonOrigin = 'downgraded-permanent';
      return island.garrisonType;
    }
    return clearIslandGarrison(island);
  }

  if (island.garrisonType === 'guard') {
    if (!['Город', 'Крупный порт'].includes(status)) return clearIslandGarrison(island);
    island.garrisonDefense = storedDefense > 0 ? storedDefense : BALANCE.garrisons.guard.defense;
    island.garrisonOrigin ||= 'guard';
    return island.garrisonType;
  }

  return clearIslandGarrison(island);
}

function garrisonDefenseValue(island) {
  const kind = normalizeIslandGarrison(island);
  return kind ? Math.max(0, Number(island.garrisonDefense) || 0) : 0;
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
  if (status !== 'Город') return { ok: false, error: 'Городскую стражу можно назначить только своему городу.' };
  normalizeIslandGarrison(island);
  if (island.garrisonType) return { ok: false, error: 'На острове уже есть городской отряд.' };
  if ((Number(player.ducats) || 0) < BALANCE.garrisons.guard.price) return { ok: false, error: `Для городской стражи нужно ${BALANCE.garrisons.guard.price} дукатов.` };
  return { ok: true, status, ...BALANCE.garrisons.guard };
}

function buyCityGuard(room, player, islandId) {
  const island = room?.islands?.find(i => i.id === islandId);
  const allowed = canBuyCityGuard(room, player, island);
  if (!allowed.ok) return allowed;
  player.ducats -= allowed.price;
  island.garrisonType = 'guard';
  island.garrisonDefense = allowed.defense;
  island.garrisonOrigin = 'guard';
  return { ok: true, island, price: allowed.price, defense: allowed.defense, mode: 'guard' };
}

function canBuyPermanentGarrison(room, player, island) {
  if (!room || !player || !island) return { ok: false, error: 'Остров не найден.' };
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Постоянный гарнизон покупают только в Цитадели.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Гарнизон можно назначить только своему острову.' };
  if (islandStatus(island) !== 'Крупный порт') return { ok: false, error: 'Постоянный гарнизон можно назначить только крупному порту.' };
  normalizeIslandGarrison(island);
  if (island.garrisonType === 'permanent') return { ok: false, error: 'На острове уже есть постоянный гарнизон.' };
  if (island.garrisonType && island.garrisonType !== 'guard') return { ok: false, error: 'На острове уже есть другой городской отряд.' };
  const mode = island.garrisonType === 'guard' ? 'upgrade' : 'direct';
  const spec = mode === 'upgrade' ? BALANCE.garrisons.permanentUpgrade : BALANCE.garrisons.permanentDirect;
  if ((Number(player.ducats) || 0) < spec.price) return { ok: false, error: `Для постоянного гарнизона нужно ${spec.price} дукатов.` };
  return { ok: true, mode, price: spec.price, defense: spec.defense };
}

function buyPermanentGarrison(room, player, islandId) {
  const island = room?.islands?.find(i => i.id === islandId);
  const allowed = canBuyPermanentGarrison(room, player, island);
  if (!allowed.ok) return allowed;
  player.ducats -= allowed.price;
  island.garrisonType = 'permanent';
  island.garrisonDefense = allowed.defense;
  island.garrisonOrigin = allowed.mode === 'upgrade' ? 'guard-upgrade' : 'direct';
  return { ok: true, island, price: allowed.price, defense: allowed.defense, mode: allowed.mode };
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
  return {
    ok: true,
    arsenalLevel,
    army: BALANCE.landCompany.armyByArsenalLevel[arsenalLevel],
    discardedCargo: player.cargo ? { ...player.cargo } : null,
  };
}

function formLandCompany(room, player, islandId) {
  const island = room?.islands?.find(i => i.id === islandId);
  const allowed = canFormLandCompany(room, player, island);
  if (!allowed.ok) return allowed;
  const discardedCargo = allowed.discardedCargo ? { ...allowed.discardedCargo } : null;
  player.cargo = null;
  player.landCompany = {
    army: allowed.army,
    arsenalLevel: allowed.arsenalLevel,
    sourceIslandId: island.id,
    formedAt: Date.now(),
  };
  return { ok: true, island, company: { ...player.landCompany }, discardedCargo };
}

function canDismissLandCompany(room, player) {
  if (!room || !player?.landCompany) return { ok: false, error: 'Роты ландскнехтов нет.' };
  const island = (room.islands || []).find(candidate =>
    candidate.ownerId === player.id && playerOnIsland(player, candidate) && arsenalLevelOnIsland(candidate) > 0);
  if (!island) return { ok: false, error: 'Вернуть роту можно только у своего острова с арсеналом.' };
  return { ok: true, island };
}

function dismissLandCompany(room, player) {
  const allowed = canDismissLandCompany(room, player);
  if (!allowed.ok) return allowed;
  const company = { ...player.landCompany };
  player.landCompany = null;
  return { ok: true, company, island: allowed.island };
}

function landCompanyAssaultArmy(player) {
  return Math.max(0, Number(player?.landCompany?.army) || 0);
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
  if (def.unique && buildingCount(island, type) >= 1) return { ok: false, error: 'Такое здание на острове уже есть.' };
  if (type === 'palace' && !['Город', 'Крупный порт'].includes(islandStatus(island))) {
    return { ok: false, error: 'Дворец можно строить только в уже существующем городе или крупном порту.' };
  }

  const candidateBuilding = { type, ...(def.singleStage ? {} : { level: 1 }) };
  const candidate = cloneIslandWithBuildings(island, [...island.buildings, candidateBuilding]);
  if (usedArea(candidate) > effectiveArea(candidate)) return { ok: false, error: 'На острове не хватает свободной площади.' };

  if (!def.unique && branchCount(candidate, def.branch) > branchLimitFor(candidate)) {
    return { ok: false, error: `Для статуса «${islandStatus(candidate)}» превышен предел построек этой ветви.` };
  }

  const fortificationError = additionalTradeFortificationError(room, island, null, candidateBuilding);
  if (fortificationError) return { ok: false, error: fortificationError };

  return { ok: true };
}

function build(room, player, islandId, type) {
  const island = room.islands.find(i => i.id === islandId);
  if (!island) return { ok: false, error: 'Остров не найден.' };
  const allowed = canBuild(room, player, island, type);
  if (!allowed.ok) return allowed;
  const def = BUILDINGS[type];
  player.ducats -= def.price;
  const building = { type, ...(def.singleStage ? {} : { level: 1 }), createdAt: Date.now() };
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

  const fortificationError = additionalTradeFortificationError(room, island, index, target);
  if (fortificationError) return { ok: false, error: fortificationError };

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
  return { ok: true, island, price: allowed.next.price, beforeName, afterName, previousBuilding: { ...allowed.current }, building: island.buildings[allowed.index] };
}

function marketIncomeForPlayer(room, playerId) {
  let income = 0;
  for (const island of room.islands) {
    if (island.ownerId !== playerId) continue;
    for (const b of island.buildings) {
      const def = BUILDINGS[b.type];
      income += Number(def?.levels?.[Number(b.level) || 1]?.income ?? def?.income) || 0;
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

function readableShipLevel(player) {
  const raw = Math.floor(Number(player?.level) || 1);
  const level = Math.max(1, Math.min(BALANCE.maxReadableShipLevel, raw));
  return SHIP_LEVELS[level] ? level : 1;
}

function shipUpgradeSlotLimit(player) {
  const level = readableShipLevel(player);
  return Math.max(1, Number(SHIP_LEVELS[level]?.upgradeSlots) || 1);
}

function repeatsInnatePassability(player, upgrade) {
  return Boolean(upgrade?.passability && SHIPS[player?.shipClass]?.passability === upgrade.passability);
}

function requiredDisabledUpgradeCount(player) {
  const slots = shipUpgradeSlotLimit(player);
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
  const level = readableShipLevel(player);
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
  const current = readableShipLevel(player);
  if (current >= BALANCE.maxShipLevel) return { ok: false, error: `Достигнут максимальный уровень корабля (${BALANCE.maxShipLevel}).` };
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
  if (!upgrade || upgrade.retired) return { ok: false, error: 'Неизвестное улучшение корабля.' };
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Улучшения устанавливаются только в Цитадели.' };
  player.upgrades ||= [];
  if (player.upgrades.includes(upgradeId)) return { ok: false, error: 'Такое улучшение уже установлено.' };
  if (repeatsInnatePassability(player, upgrade)) return { ok: false, error: 'Этот класс корабля уже проходит такое препятствие без улучшения.' };
  if (player.upgrades.length >= shipUpgradeSlotLimit(player)) return { ok: false, error: 'Нет свободного места для улучшения на текущем уровне корабля.' };
  const branchCountValue = player.upgrades.filter(id => SHIP_UPGRADES[id]?.branch === upgrade.branch).length;
  if (branchCountValue >= BALANCE.maxBranchUpgrades) return { ok: false, error: 'В этой ветви уже установлены два улучшения.' };
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
    const second = (player.upgrades || []).find(id => SHIP_UPGRADES[id]?.branch === upgrade.branch && SHIP_UPGRADES[id]?.order === BALANCE.maxBranchUpgrades);
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
    for (const b of island.buildings) if (b.type === 'shipyard') slots += BUILDINGS.shipyard.levels[Number(b.level) || 1]?.escortSlots || 0;
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

// Compatibility only: current rules never create a Landin escort. This helper is
// retained solely to finish restored legacy pending decisions.
function createLandinEscort(player) {
  player.escorts ||= [];
  if (player.escorts.some(e => e.type === 'landin')) return { ok: false, error: 'Особое сопровождение Ландина уже получено.' };
  if (player.escorts.length >= BALANCE.maxEscorts) return { ok: false, error: `Для сопровождения Ландина нужно заменить одно из ${BALANCE.maxEscorts} имеющихся судов.` };
  player.nextEscortId = (Number(player.nextEscortId) || 0) + 1;
  const escort = { id: `escort-${player.nextEscortId}`, type: 'landin', special: true, cargo: null };
  player.escorts.push(escort);
  return { ok: true, escort };
}

function replaceEscortWithLandin(player, escortId) {
  player.escorts ||= [];
  if (player.escorts.some(e => e.type === 'landin')) return { ok: false, error: 'Особое сопровождение Ландина уже получено.' };
  if (player.escorts.length < BALANCE.maxEscorts) return createLandinEscort(player);
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
  const level = Math.max(1, Math.min(BALANCE.maxReadableShipLevel, Number(player?.level) || 1));
  return SHIP_LEVELS[Math.min(level, BALANCE.maxShipLevel)].escortLimit;
}

function escortPurchasePrice(player) {
  const count = (player?.escorts || []).length;
  return BALANCE.escortPrices[count] ?? null;
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
  if (!def || def.retired) return { ok: false, error: 'Этот тип сопровождения не продаётся.' };
  if (!isCitadelCell(player.row, player.col)) return { ok: false, error: 'Сопровождение покупают только в Цитадели.' };
  player.escorts ||= [];
  if (player.escorts.length >= BALANCE.maxEscorts) return { ok: false, error: `Одновременно можно иметь не более ${BALANCE.maxEscorts} судов сопровождения.` };
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

function islandLoadingLimit() {
  return Math.max(1, Math.floor(Number(BALANCE.loadingLimitPerIslandPerRound) || 1));
}

function canLoadCargo(room, player, island, goodId, holdId = 'main') {
  const good = GOODS[goodId];
  if (!good) return { ok: false, error: 'Неизвестный товар.' };
  if (!island) return { ok: false, error: 'Остров не найден.' };
  if (island.ownerId !== player.id) return { ok: false, error: 'Загружать товар можно только на своём острове.' };
  const here = island.cells.some(([r, c]) => r === player.row && c === player.col);
  if (!here) return { ok: false, error: 'Основной корабль должен находиться на клетке этого острова.' };
  if (islandLoadingLimit() === 1 && island.loadedRound === room.round) return { ok: false, error: 'С этого острова уже выполнялась погрузка в текущем раунде.' };
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
  const activeTask = getActiveAssignmentTask(player);
  if (activeTask?.id) cargo.assignmentInstanceId = activeTask.id;
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
  const capacity = Math.max(0, Number(allowed.hold.capacity) || 0);
  const credit = creditDucats(player, allowed.revenue);
  allowed.hold.setCargo(null);
  return { ok: true, good: allowed.good, revenue: allowed.revenue, credit, quantity: allowed.quantity, capacity, holdId: allowed.hold.id, holdName: allowed.hold.name, assignmentInstanceId };
}


function playerOnIsland(player, island) {
  return Boolean(player && island?.cells?.some(([r, c]) => r === player.row && c === player.col));
}

function isCitadelPeaceCell(row, col) {
  // Зона мира — только клетки, на которых есть территория Цитадели.
  // Соседние морские клетки этой защиты не получают.
  return isCitadelCell(row, col);
}

function seaAttackPositionAllowed(attacker, defender) {
  if (!attacker || !defender) return false;
  const dr = Math.abs(Number(attacker.row) - Number(defender.row));
  const dc = Math.abs(Number(attacker.col) - Number(defender.col));
  return Number.isFinite(dr) && Number.isFinite(dc) && dr <= 1 && dc <= 1;
}

function fleetArtillery(room, player) {
  const escortArtillery = escortStatuses(room, player)
    .filter(e => e.active)
    .reduce((sum, e) => sum + (Number(ESCORTS[e.type]?.artillery) || 0), 0);
  return shipStats(player).artillery + escortArtillery;
}

function buildingDefenseValue(building) {
  const def = BUILDINGS[building?.type];
  const level = Math.max(1, Math.min(3, Number(building?.level) || 1));
  return Number(def?.levels?.[level]?.defense ?? def?.defense) || 0;
}

function islandDefenseArmy(room, island) {
  if (!island) return { total: 0, garrison: 0, hiredGarrison: 0, fortifications: 0, bastions: 0, ownerShip: 0, ownerShipPresent: false };
  const garrison = island.ownerId ? 0 : (Number(island.army) || 0);
  const supported = island.ownerId ? new Set(supportedBastionIslandIds(room, island.ownerId)) : new Set();
  let fortifications = 0;
  let bastions = 0;
  for (const b of island.buildings || []) {
    if (b.type === 'bastion') {
      if (supported.has(island.id)) bastions += BUILDINGS.bastion.defense;
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
  const before = Math.max(1, Math.min(BALANCE.maxReadableShipLevel, Number(player.level) || 1));
  if (before > 1) {
    player.level = before - 1;
    const adjustment = fleetAdjustmentNeeds(player);
    // Если после потери уровня нужно выбрать отключаемые улучшения, обрезку груза
    // откладываем до выбора владельца: итоговая вместимость зависит от его решения.
    const cargoDiscarded = adjustment.upgradeChoiceNeeded ? 0 : trimMainCargoToCapacity(player);
    return { before, after: player.level, returnedToStart: false, cargoDiscarded, adjustment };
  }
  const [startRow, startCol] = MAP_META.startCell;
  player.row = startRow;
  player.col = startCol;
  return { before: 1, after: 1, returnedToStart: true, cargoDiscarded: 0, adjustment: fleetAdjustmentNeeds(player) };
}

function battleLevelLoss(room, player, options = {}) {
  const before = Math.max(1, Math.min(BALANCE.maxReadableShipLevel, Number(player?.level) || 1));
  const useShipCarpenter = Boolean(options.useShipCarpenter);
  const preventLevels = Math.max(0, Number(CHARACTERS.shipCarpenter?.effect?.levels) || 0);
  if (useShipCarpenter && preventLevels >= 1 && heldCharacterId(player) === 'shipCarpenter') {
    consumeCharacter(player, 'shipCarpenter');
    return {
      before,
      after: before,
      returnedToStart: false,
      cargoDiscarded: 0,
      adjustment: fleetAdjustmentNeeds(player),
      prevented: true,
      preventedLevels: Math.min(1, preventLevels),
      preventedByCharacter: 'shipCarpenter',
    };
  }
  return { ...loseShipLevel(room, player), prevented: false, preventedByCharacter: null };
}

function treasuryLoss30(player) {
  const loss = Math.floor((Number(player?.ducats) || 0) * BALANCE.treasuryLossRatio);
  player.ducats = Math.max(0, (Number(player?.ducats) || 0) - loss);
  return loss;
}

function gloryForDefense(defense) {
  const d = Math.max(0, Number(defense) || 0);
  return BALANCE.gloryCapture.find(band => d >= band.min && (band.max == null || d <= band.max)).points;
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
    bastion: { type: 'fortress', level: 3 },
    bank: { type: 'market', level: 3 },
  }[building?.type];
  return back ? { ...building, ...back } : { ...building };
}

function attackCountThisRound(room, attacker, defenderId) {
  if (!room || !attacker || !defenderId) return 0;
  if (Number(attacker.attackLimitRound) !== Number(room.round)) return 0;
  return Math.max(0, Number(attacker.attackCountsThisRound?.[String(defenderId)]) || 0);
}

function attackTargetsThisRound(room, attacker) {
  if (!room || !attacker || Number(attacker.attackLimitRound) !== Number(room.round)) return [];
  return Object.entries(attacker.attackCountsThisRound || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([id]) => id);
}

function canAttackPlayerThisRound(room, attacker, defenderId) {
  if (!room || !attacker || !defenderId) return { ok: false, error: 'Не удалось проверить предел нападений.' };
  if (Number(room.round) === 1) return { ok: false, error: 'В первом раунде игроки не нападают друг на друга.' };
  const limit = Math.max(0, Number(BALANCE.combat?.attacksPerOpponentPerRound) || 0);
  const count = attackCountThisRound(room, attacker, defenderId);
  if (count >= limit) {
    return { ok: false, error: 'На одного конкретного игрока можно нападать не более одного раза за общий раунд.' };
  }
  return { ok: true, count, limit };
}

function registerPlayerAttack(room, attacker, defenderId) {
  const check = canAttackPlayerThisRound(room, attacker, defenderId);
  if (!check.ok) return check;
  const round = Number(room.round) || 1;
  if (Number(attacker.attackLimitRound) !== round) {
    attacker.attackLimitRound = round;
    attacker.attackCountsThisRound = {};
  }
  const id = String(defenderId);
  attacker.attackCountsThisRound ||= {};
  attacker.attackCountsThisRound[id] = (Number(attacker.attackCountsThisRound[id]) || 0) + 1;
  return { ok: true, count: attacker.attackCountsThisRound[id], limit: check.limit };
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

function alliancePartnerId(room, playerId) {
  const id = String(typeof playerId === 'string' ? playerId : playerId?.id || '');
  if (!id) return null;
  for (const pair of room?.alliances || []) {
    if (String(pair?.[0] || '') === id) return String(pair?.[1] || '') || null;
    if (String(pair?.[1] || '') === id) return String(pair?.[0] || '') || null;
  }
  return null;
}

function addAlliance(room, aId, bId) {
  if (!room || !aId || !bId || aId === bId) return false;
  room.alliances ||= [];
  if (areAllies(room, aId, bId)) return false;
  if (alliancePartnerId(room, aId) || alliancePartnerId(room, bId)) return false;
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

function fleetVictoryAlreadyScored(room, player, opponentId) {
  if (!room || !player || !opponentId) return false;
  if (Number(player.fleetPointRound) !== Number(room.round)) return false;
  const limit = Math.max(1, Number(BALANCE.fleetScoring?.perOpponentPerRound) || 1);
  const opponent = String(opponentId);
  const count = (player.fleetPointOpponentIds || []).filter(id => String(id) === opponent).length;
  return count >= limit;
}

function awardFleetVictoryPoints(room, winners, opponentId, points) {
  const round = Number(room?.round) || 1;
  const amount = Math.max(0, Math.floor(Number(points) || 0));
  const awards = [];
  for (const player of winners || []) {
    if (!player || !opponentId) continue;
    if (Number(player.fleetPointRound) !== round) {
      player.fleetPointRound = round;
      player.fleetPointOpponentIds = [];
    }
    player.fleetPointOpponentIds ||= [];
    const opponent = String(opponentId);
    if (fleetVictoryAlreadyScored(room, player, opponent)) continue;
    player.fleetPointOpponentIds.push(opponent);
    player.fleetPoints = Math.max(0, Number(player.fleetPoints) || 0) + amount;
    awards.push({ playerId: player.id, opponentId: opponent, points: amount });
  }
  return awards;
}

function armyCapturePoints(defense) {
  const value = Math.max(0, Number(defense) || 0);
  const band = (BALANCE.armyScoring?.capture || []).find(item =>
    value >= Number(item.min || 0) && (item.max == null || value <= Number(item.max)));
  return Math.max(0, Math.floor(Number(band?.points) || 0));
}

function armyVictoryAlreadyScored(room, player, opponentId) {
  if (!room || !player || !opponentId) return false;
  if (Number(player.armyPointRound) !== Number(room.round)) return false;
  const limit = Math.max(1, Number(BALANCE.armyScoring?.perOpponentPerRound) || 1);
  const opponent = String(opponentId);
  return (player.armyPointOpponentIds || []).filter(id => String(id) === opponent).length >= limit;
}

function awardArmyVictoryPoints(room, winners, opponentId, points) {
  const round = Number(room?.round) || 1;
  const amount = Math.max(0, Math.floor(Number(points) || 0));
  if (amount <= 0) return [];
  const awards = [];
  for (const player of winners || []) {
    if (!player) continue;
    if (opponentId) {
      if (Number(player.armyPointRound) !== round) { player.armyPointRound = round; player.armyPointOpponentIds = []; }
      player.armyPointOpponentIds ||= [];
      const opponent = String(opponentId);
      if (armyVictoryAlreadyScored(room, player, opponent)) continue;
      player.armyPointOpponentIds.push(opponent);
    }
    player.armyPoints = Math.max(0, Number(player.armyPoints) || 0) + amount;
    awards.push({ playerId: player.id, opponentId: opponentId ? String(opponentId) : null, points: amount });
  }
  return awards;
}

function captureRetentionPlan(island) {
  const buildings = Array.isArray(island?.buildings) ? island.buildings : [];
  const ratio = Math.max(0, Math.min(1, Number(BALANCE.combat?.capturedBuildingsKeptRatio) || 0));
  const initialCount = buildings.length;
  const keepCount = Math.floor(initialCount * ratio);
  const removeCount = Math.max(0, initialCount - keepCount);
  if (removeCount > 0) for (const building of buildings) building.captureRetentionPending = true;
  return { ratio, initialCount, keepCount, removeCount };
}

function capturedBuildingRetentionOptions(island) {
  if (!island) return [];
  return islandCorrectionOptions(island).filter(option => Boolean(island.buildings?.[option.buildingIndex]?.captureRetentionPending));
}

function removeCapturedBuildingForRetention(room, player, islandId, buildingIndex) {
  const island = room?.islands?.find(i => i.id === islandId);
  if (!island || island.ownerId !== player?.id) return { ok: false, error: 'Выбирать судьбу построек может только новый владелец острова.' };
  const index = Number(buildingIndex);
  const building = Number.isInteger(index) && index >= 0 ? island.buildings?.[index] : null;
  if (!building?.captureRetentionPending) return { ok: false, error: 'Эта постройка не относится к инфраструктуре, захваченной в текущем штурме.' };
  const oldGarrison = island.garrisonType || null;
  const [removed] = island.buildings.splice(index, 1);
  const newGarrison = normalizeIslandGarrison(island);
  return { ok: true, island, building: removed, name: buildingDisplayName(removed), garrisonChanged: oldGarrison !== newGarrison, oldGarrison, newGarrison: newGarrison || null };
}

function finalizeCapturedBuildingRetention(island) {
  for (const building of island?.buildings || []) delete building.captureRetentionPending;
}

function jointSeaBattle(room, attacker, defender, attackerAllyIds = [], defenderAllyIds = [], options = {}) {
  if (!room || !attacker || !defender) return { ok: false, error: 'Участник морского боя не найден.' };
  if (attacker.id === defender.id) return { ok: false, error: 'Нельзя атаковать собственный корабль.' };
  if (room.round === 1) return { ok: false, error: 'В первом раунде игроки не нападают друг на друга.' };
  if (!seaAttackPositionAllowed(attacker, defender)) return { ok: false, error: 'Для морской атаки нужно находиться на клетке цели или на одной из восьми соседних клеток.' };
  if (isCitadelPeaceCell(attacker.row, attacker.col) || isCitadelPeaceCell(defender.row, defender.col)) return { ok: false, error: 'В зоне мира Цитадели морские бои запрещены.' };
  if (areAllies(room, attacker, defender)) return { ok: false, error: 'Союзники не могут нападать друг на друга.' };
  if (isFormerAllyBlocked(attacker, defender.id)) return { ok: false, error: 'В этот личный ход нельзя атаковать бывшего союзника.' };

  const attackingAllies = uniquePlayersByIds(room, attackerAllyIds).filter(p => p.id !== attacker.id && p.id !== defender.id);
  const defendingAllies = uniquePlayersByIds(room, defenderAllyIds).filter(p => p.id !== attacker.id && p.id !== defender.id);
  if (attackingAllies.length > 1 || defendingAllies.length > 1) return { ok: false, error: 'В совместном бою у каждой стороны может участвовать только один союзник.' };
  const used = new Set([attacker.id, defender.id]);

  for (const p of attackingAllies) {
    if (used.has(p.id)) return { ok: false, error: 'Один корабль не может участвовать за обе стороны.' };
    if (!areAllies(room, attacker, p)) return { ok: false, error: `${p.name || 'Игрок'} не является союзником инициатора.` };
    if (areAllies(room, defender, p)) return { ok: false, error: `${p.name || 'Игрок'} связан союзом с целью и не может атаковать её.` };
    if (!seaAttackPositionAllowed(p, defender)) return { ok: false, error: `${p.name || 'Союзник'} должен находиться на клетке цели или на одной из восьми соседних клеток.` };
    used.add(p.id);
  }
  for (const p of defendingAllies) {
    if (used.has(p.id)) return { ok: false, error: 'Один корабль не может участвовать за обе стороны.' };
    if (!areAllies(room, defender, p)) return { ok: false, error: `${p.name || 'Игрок'} не является союзником защитника.` };
    if (areAllies(room, attacker, p)) return { ok: false, error: `${p.name || 'Игрок'} не может участвовать против своего союзника.` };
    if (!seaAttackPositionAllowed(p, defender)) return { ok: false, error: `${p.name || 'Союзник'} должен находиться на клетке цели или на одной из восьми соседних клеток.` };
    used.add(p.id);
  }

  const attackers = [attacker, ...attackingAllies];
  const defenders = [defender, ...defendingAllies];
  const skipRegistrationIds = new Set((options.skipAttackRegistrationIds || []).map(String));
  for (const participant of attackers) {
    if (skipRegistrationIds.has(String(participant.id))) continue;
    const check = canAttackPlayerThisRound(room, participant, defender.id);
    if (!check.ok) return { ...check, attackerId: participant.id };
  }
  for (const participant of attackers) {
    if (skipRegistrationIds.has(String(participant.id))) continue;
    registerPlayerAttack(room, participant, defender.id);
  }
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
    fleetPointAwards: [],
  };

  if (attackerPower === defenderPower) {
    // Каноническая ничья не накладывает дополнительных последствий.
  } else {
    const attackerWon = attackerPower > defenderPower;
    const winners = attackerWon ? attackers : defenders;
    const losers = attackerWon ? defenders : attackers;
    const treasurySource = attackerWon ? defender : attacker;
    result.outcome = attackerWon ? 'attacker' : 'defender';
    result.winnerIds = winners.map(p => p.id);
    result.loserIds = losers.map(p => p.id);
    const carpenterIds = new Set((options.shipCarpenterPlayerIds || []).map(String));
    for (const p of losers) {
      result.levelLosses.push({
        playerId: p.id,
        ...battleLevelLoss(room, p, { useShipCarpenter: carpenterIds.has(String(p.id)) }),
      });
    }
    if (result.levelLosses.length === 1) result.levelLoss = result.levelLosses[0];
    const fleetPoints = attackerWon ? BALANCE.fleetScoring.playerVictory : BALANCE.fleetScoring.defenseVictory;
    result.fleetPointAwards = awardFleetVictoryPoints(room, winners, attackerWon ? defender.id : attacker.id, fleetPoints);
    const loot = Math.min(BALANCE.combat.lootMax, Math.max(0, Number(treasurySource.ducats) || 0));
    treasurySource.ducats -= loot;
    result.loot = loot;
    result.lootSourceId = treasurySource.id;
    result.lootShares = splitLoot(loot, winners, attackerWon ? attacker.id : defender.id);
  }

  return result;
}

function seaBattle(room, attacker, defender, options = {}) {
  return jointSeaBattle(room, attacker, defender, [], [], options);
}

function grantMilitaryReward(room, player, island, options = {}) {
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
      const card = drawLegendaryCard(room, options.rng || Math.random);
      if (card) { player.legendaryCards.push(card); drawn += 1; }
    }
    if (drawn) notes.push(`легендарная карта ×${drawn}`);
  }
  return notes;
}

function jointAssaultIsland(room, attacker, island, attackerAllyIds = [], defenderAllyIds = [], options = {}) {
  if (!room || !attacker || !island) return { ok: false, error: 'Цель штурма не найдена.' };
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
  if (attackingAllies.length > 1 || defendingAllies.length > 1) return { ok: false, error: 'В совместном штурме у каждой стороны может участвовать только один союзник.' };
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
    if (areAllies(room, attacker, p)) return { ok: false, error: `${p.name || 'Игрок'} не может участвовать против своего союзника.` };
    if (!playerOnIsland(p, island)) return { ok: false, error: `${p.name || 'Союзник'} должен находиться на клетке этого острова.` };
    used.add(p.id);
  }

  const attackers = [attacker, ...attackingAllies];
  if (defender) {
    const skipRegistrationIds = new Set((options.skipAttackRegistrationIds || []).map(String));
    for (const participant of attackers) {
      if (skipRegistrationIds.has(String(participant.id))) continue;
      const check = canAttackPlayerThisRound(room, participant, defender.id);
      if (!check.ok) return { ...check, attackerId: participant.id };
    }
    for (const participant of attackers) {
      if (skipRegistrationIds.has(String(participant.id))) continue;
      registerPlayerAttack(room, participant, defender.id);
    }
  }
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
    rewardNotes: [],
    glory: 0,
    armyPointAwards: [],
    captureRetention: null,
    levelLosses: [],
    discardedLandCompanies: [],
    treasuryLosses: {},
  };

  if (attackerPower > defense.total) {
    result.outcome = 'attacker';
    result.previousOwnerId = island.ownerId || null;
    // §8.4 halves infrastructure only when an island is captured from another player.
    result.captureRetention = result.previousOwnerId ? captureRetentionPlan(island) : null;
    island.ownerId = attacker.id;
    const firstMilitaryConquest = !island.firstMilitaryConquered;
    if (firstMilitaryConquest) island.firstMilitaryConquered = true;
    if (firstMilitaryConquest) result.armyPointAwards = awardArmyVictoryPoints(room, [attacker], result.previousOwnerId, armyCapturePoints(defense.total));

    result.statePrize = resolveStateMilitaryCapture(room, attacker, island, result.previousOwnerId);
    const replaceIslandCash = Boolean(
      result.statePrize?.triggered
      && !result.statePrize.amountUnresolved
      && result.statePrize.excludesIslandDucats
    );
    result.rewardNotes = grantMilitaryReward(room, attacker, island, { skipDucats: replaceIslandCash, rng: options.rng || Math.random });
    if (firstMilitaryConquest) {
      const legendaryPlace = legendaryPlaceForIsland(island.id);
      if (legendaryPlace) {
        result.legendaryDiscovery = claimLegendaryPlaceDiscovery(room, attacker, legendaryPlace.id, options.rng || Math.random);
      }
    }
    if (result.statePrize?.triggered) {
      if (result.statePrize.amountUnresolved) {
        result.rewardNotes.push(`итоговый приз ${result.statePrize.factionName}: сумма ожидает решения автора`);
      } else {
        const c = result.statePrize.credit;
        result.rewardNotes.push(c?.debtPaid
          ? `итоговый приз ${result.statePrize.factionName}: ${result.statePrize.ducats} дукатов (${c.debtPaid} в долг, ${c.net} в казну)`
          : `итоговый приз ${result.statePrize.factionName}: +${result.statePrize.ducats || 0} дукатов`);
      }
    }
  } else if (attackerPower < defense.total) {
    result.outcome = 'defender';
    if (defender) result.armyPointAwards = awardArmyVictoryPoints(room, [defender], attacker.id, BALANCE.armyScoring?.defenseVictory);
    const carpenterIds = new Set((options.shipCarpenterPlayerIds || []).map(String));
    for (const p of attackers) {
      result.levelLosses.push({
        playerId: p.id,
        ...battleLevelLoss(room, p, { useShipCarpenter: carpenterIds.has(String(p.id)) }),
      });
      if (p.landCompany) {
        result.discardedLandCompanies.push({ playerId: p.id, army: landCompanyAssaultArmy(p) });
        p.landCompany = null;
      }
    }
    if (result.levelLosses.length === 1) result.levelLoss = result.levelLosses[0];
  } else {
    // Каноническая ничья штурма не меняет контроль и не накладывает потерь.
  }
  return result;
}

function assaultIsland(room, attacker, island, options = {}) {
  return jointAssaultIsland(room, attacker, island, [], [], options);
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
    garrisonDefense: garrisonDefenseValue(island),
    availableGoods: availableGoodsOnIsland(island),
    buildings: island.buildings.map((b, index) => {
      const next = upgradeForBuilding(b);
      return {
        index,
        type: b.type,
        ...(BUILDINGS[b.type]?.singleStage ? {} : { level: b.level }),
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
  domainState,
  cloneIslands,
  islandAt,
  reachableCells,
  mistPathReachableCells,
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
  canBuild,
  upgradeBuilding,
  canUpgradeBuilding,
  buildingDisplayName,
  stoneworksSupportCapacity,
  bastionSupportSummary,
  bastionSupportChoiceNeeds,
  setInactiveBastions,
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
  canDismissLandCompany,
  dismissLandCompany,
  landCompanyAssaultArmy,
  marketIncomeForPlayer,
  hasOwnedBuilding,
  lighthouseDepartureBonus,
  bestAdmiraltyLevelAtPlayer,
  characterOptionsAtAdmiralty,
  canTakeCharacter,
  takeCharacter,
  canReplaceCharacter,
  replaceCharacter,
  consumeCharacter,
  cartographerAnchorOptions,
  claimFreeIslandsAt,
  publicIsland,
  usedArea,
  effectiveArea,
  islandStatus,
  islandConstraintReport,
  islandCorrectionOptions,
  removeIslandBuildingForCorrection,
  shipStats,
  navigationPassabilities,
  navigationAllowsHazards,
  hazardsAt,
  readableShipLevel,
  shipUpgradeSlotLimit,
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
  drawTreasureCard,
  treasureHunterCandidates,
  createExpeditionDeck,
  createFeudDecks,
  drawFeudCard,
  createAssignmentDecks,
  normalizeAssignmentCompatibility,
  normalizeStage6Compatibility,
  drawAssignmentCard,
  getActiveAssignmentTask,
  assignTask,
  completeAssignmentTask,
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
  factionIdForIsland,
  stateExists,
  refreshFactionExistence,
  stateOwnedIslandIds,
  resolveStateMilitaryCapture,
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
  applyFeudBuildingDowngrade,
  boardingUpgradeOptions,
  applyBoardingLoss,
  stormCellOptions,
  creditDucats,
  anchorLoss,
  fleetArtillery,
  islandDefenseArmy,
  loseShipLevel,
  battleLevelLoss,
  fleetVictoryAlreadyScored,
  awardFleetVictoryPoints,
  armyCapturePoints,
  armyVictoryAlreadyScored,
  awardArmyVictoryPoints,
  captureRetentionPlan,
  capturedBuildingRetentionOptions,
  removeCapturedBuildingForRetention,
  finalizeCapturedBuildingRetention,
  gloryForDefense,
  areAllies,
  alliancePartnerId,
  addAlliance,
  removeAlliance,
  playerOnIsland,
  jointSeaBattle,
  seaBattle,
  jointAssaultIsland,
  assaultIsland,
  seaAttackPositionAllowed,
  attackCountThisRound,
  attackTargetsThisRound,
  canAttackPlayerThisRound,
  registerPlayerAttack,
  isCitadelCell,
};
