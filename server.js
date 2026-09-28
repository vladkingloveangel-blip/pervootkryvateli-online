const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SHIPS, SHIP_LEVELS, SHIP_UPGRADES, ESCORTS, COLORS, BUILDINGS, GOODS, CITADEL_CELLS, ANCHORS, FACTIONS, POLITICAL_FACTION_ORDER, ASSIGNMENT_CARDS, LEGENDARY_PLACES } = require('./game-data');
const {
  cloneIslands,
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
  upgradeBuilding,
  buildingDisplayName,
  prizeBuildingPlacementOptions,
  placePrizeBuilding,
  islandConstraintReport,
  islandCorrectionOptions,
  removeIslandBuildingForCorrection,
  normalizeIslandGarrison,
  stoneworksSupportCapacity,
  bastionSupportSummary,
  buildBastion,
  prioritizeBastionSupport,
  buyCityGuard,
  buyPermanentGarrison,
  formLandCompany,
  dismissLandCompany,
  marketIncomeForPlayer,
  claimFreeIslandsAt,
  publicIsland,
  shipStats,
  shipUpgradeStatuses,
  fleetAdjustmentNeeds,
  setDisabledUpgrades,
  setLevelInactiveEscorts,
  buyShipLevel,
  buyShipUpgrade,
  removeShipUpgrade,
  shipyardSlotsForPlayer,
  ordinaryEscortExcess,
  removeEscortsForShipyard,
  replaceEscortWithLandin,
  escortUseLimit,
  escortPurchasePrice,
  escortStatuses,
  buyEscort,
  loadCargo,
  sellCargo,
  cargoSaleValue,
  isCitadelCell,
  isCitadelPeaceCell,
  fleetArtillery,
  islandDefenseArmy,
  loseShipLevel,
  areAllies,
  addAlliance,
  removeAlliance,
  playerOnIsland,
  jointSeaBattle,
  seaBattle,
  jointAssaultIsland,
  assaultIsland,
  createAnchorDecks,
  resolveAnchorEncounter,
  creditDucats,
  createSailingEventDeck,
  drawSailingEventCard,
  createTreasureDeck,
  drawTreasureCard,
  createLegendaryDeck,
  createFeudDecks,
  drawFeudCard,
  createAssignmentDecks,
  issueAssignment,
  canReplaceAssignment,
  replaceAssignment,
  assignmentEventMatches,
  completeAssignment,
  legendaryPlaceAt,
  factionIdForIsland,
  stateExists,
  refreshFactionExistence,
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
  installShipUpgradeFree,
  buildFree,
  raidBuildingOptions,
  applyRaidDowngrade,
  boardingUpgradeOptions,
  applyBoardingLoss,
  stormCellOptions,
} = require('./game-logic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const rooms = new Map();

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return crypto.randomBytes(4).toString('hex').slice(0, 5).toUpperCase();
}

function token() { return crypto.randomBytes(18).toString('base64url'); }
function cleanName(name) {
  const s = String(name || '').trim().replace(/\s+/g, ' ');
  return s.slice(0, 24) || 'Мореплаватель';
}
function getRoom(code) { return rooms.get(String(code || '').trim().toUpperCase()); }
function rollD6() { return 1 + Math.floor(Math.random() * 6); }
function ackSafe(ack, payload) { if (typeof ack === 'function') ack(payload); }
const ROMAN_SERVER = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function currentPlayer(room) {
  if (!room?.started || !room.order.length) return null;
  return room.players.find(p => p.id === room.order[room.turnIndex]) || null;
}

function ownerIslandCount(room, playerId) {
  return room.islands.filter(i => i.ownerId === playerId).length;
}

function publicRoom(room, viewerId = null) {
  const active = room.phase === 'event' ? null : currentPlayer(room);
  const viewerIsActive = active && active.id === viewerId;
  const reachable = viewerIsActive && room.phase === 'navigation' && room.roll !== null
    ? reachableCells(active, room.movePoints)
    : [];
  const mistReachable = viewerIsActive && room.phase === 'actions' && (Number(room.actionsLeft) || 0) > 0 && playerHasLegendaryKind(active, 'mist-path')
    ? mistPathReachableCells(active)
    : [];

  return {
    version: '0.17.0',
    code: room.code,
    started: room.started,
    hostId: room.hostId,
    round: room.round,
    circle: room.circle,
    turnIndex: room.turnIndex,
    activePlayerId: active?.id || null,
    eventPhase: room.eventPhase ? {
      active: Boolean(room.eventPhase.active),
      currentPlayerId: room.eventPhase.currentPlayerId || null,
      playerIndex: Number(room.eventPhase.playerIndex) || 0,
      totalPlayers: room.order.length,
      stage: room.eventPhase.stage || 'sailing',
      feudIndex: Number(room.eventPhase.feudIndex) || 0,
      feudTotal: room.eventPhase.feudQueue?.length || 0,
      assignmentIndex: Number(room.eventPhase.assignmentIndex) || 0,
      assignmentTotal: room.eventPhase.assignmentQueue?.length || 0,
      replacementIndex: Number(room.eventPhase.replacementIndex) || 0,
      replacementTotal: room.eventPhase.replacementQueue?.length || 0,
      lastCard: room.eventPhase.lastCard ? { ...room.eventPhase.lastCard } : null,
    } : null,
    pendingEvent: room.pendingEvent ? {
      id: room.pendingEvent.id,
      playerId: room.pendingEvent.playerId,
      kind: room.pendingEvent.kind,
      cardName: room.pendingEvent.cardName,
      viewerCanRespond: room.pendingEvent.playerId === viewerId,
      options: room.pendingEvent.playerId === viewerId ? (room.pendingEvent.options || []).map(o => ({ ...o })) : [],
      goodId: room.pendingEvent.playerId === viewerId ? (room.pendingEvent.goodId || null) : null,
      islandId: room.pendingEvent.playerId === viewerId ? (room.pendingEvent.islandId || null) : null,
    } : null,
    pendingFeud: room.pendingFeud ? {
      id: room.pendingFeud.id,
      playerId: room.pendingFeud.playerId,
      factionId: room.pendingFeud.factionId,
      factionName: FACTIONS[room.pendingFeud.factionId]?.name || room.pendingFeud.factionId,
      cardName: room.pendingFeud.cardName,
      kind: room.pendingFeud.kind,
      remaining: Number(room.pendingFeud.remaining) || 0,
      viewerCanRespond: room.pendingFeud.playerId === viewerId,
      options: room.pendingFeud.playerId === viewerId ? (room.pendingFeud.options || []).map(o => ({ ...o })) : [],
    } : null,
    pendingAssignmentChoice: room.pendingAssignmentChoice ? {
      id: room.pendingAssignmentChoice.id,
      playerId: room.pendingAssignmentChoice.playerId,
      factionId: room.pendingAssignmentChoice.factionId,
      factionName: FACTIONS[room.pendingAssignmentChoice.factionId]?.name || room.pendingAssignmentChoice.factionId,
      assignment: assignmentPublic(room.pendingAssignmentChoice.assignment),
      canReplace: Boolean(room.pendingAssignmentChoice.canReplace),
      replaceError: room.pendingAssignmentChoice.replaceError || null,
      viewerCanRespond: room.pendingAssignmentChoice.playerId === viewerId,
    } : null,
    pendingStatePrize: room.pendingStatePrize ? {
      id: room.pendingStatePrize.id,
      playerId: room.pendingStatePrize.playerId,
      factionId: room.pendingStatePrize.factionId,
      factionName: FACTIONS[room.pendingStatePrize.factionId]?.name || room.pendingStatePrize.factionId,
      remaining: room.pendingStatePrize.remainingBuildings?.length || 0,
      currentBuilding: room.pendingStatePrize.remainingBuildings?.[0] ? {
        ...room.pendingStatePrize.remainingBuildings[0],
        name: buildingDisplayName(room.pendingStatePrize.remainingBuildings[0]),
      } : null,
      viewerCanRespond: room.pendingStatePrize.playerId === viewerId,
      options: room.pendingStatePrize.playerId === viewerId ? (room.pendingStatePrize.options || []).map(o => ({ ...o })) : [],
      lost: room.pendingStatePrize.playerId === viewerId ? [...(room.pendingStatePrize.lost || [])] : [],
    } : null,
    pendingIslandCorrection: room.pendingIslandCorrection ? {
      id: room.pendingIslandCorrection.id,
      playerId: room.pendingIslandCorrection.playerId,
      islandId: room.pendingIslandCorrection.islandId,
      islandName: room.pendingIslandCorrection.islandName,
      reason: room.pendingIslandCorrection.reason || 'После потери статуса остров нужно привести к допустимым ограничениям.',
      report: room.pendingIslandCorrection.report ? {
        ...room.pendingIslandCorrection.report,
        branchViolations: (room.pendingIslandCorrection.report.branchViolations || []).map(v => ({ ...v })),
      } : null,
      viewerCanRespond: room.pendingIslandCorrection.playerId === viewerId,
      options: room.pendingIslandCorrection.playerId === viewerId ? (room.pendingIslandCorrection.options || []).map(o => ({ ...o })) : [],
      removed: room.pendingIslandCorrection.playerId === viewerId ? [...(room.pendingIslandCorrection.removed || [])] : [],
    } : null,
    pendingFleetAdjustment: room.pendingFleetAdjustment ? {
      id: room.pendingFleetAdjustment.id,
      playerId: room.pendingFleetAdjustment.playerId,
      stage: room.pendingFleetAdjustment.stage,
      reason: room.pendingFleetAdjustment.reason || 'Требуется обязательное решение по составу флотилии.',
      required: Number(room.pendingFleetAdjustment.required) || 0,
      viewerCanRespond: room.pendingFleetAdjustment.playerId === viewerId,
      options: room.pendingFleetAdjustment.playerId === viewerId ? (room.pendingFleetAdjustment.options || []).map(o => ({ ...o })) : [],
    } : null,
    pendingLegendaryReaction: room.pendingLegendaryReaction ? {
      id: room.pendingLegendaryReaction.id,
      kind: room.pendingLegendaryReaction.kind,
      sourcePlayerId: room.pendingLegendaryReaction.sourcePlayerId,
      targetPlayerId: room.pendingLegendaryReaction.targetPlayerId || null,
      islandId: room.pendingLegendaryReaction.islandId || null,
      viewerCanRespond: room.pendingLegendaryReaction.targetPlayerId === viewerId,
      veilOptions: room.pendingLegendaryReaction.targetPlayerId === viewerId ? legendaryCardRefs(playerById(room, viewerId), 'sea-veil') : [],
    } : null,
    eventDecks: {
      sailing: { remaining: room.eventDeck?.drawPile?.length || 0, discard: room.eventDeck?.discard?.length || 0 },
      treasure: { remaining: room.treasureDeck?.drawPile?.length || 0, discard: room.treasureDeck?.discard?.length || 0 },
      legendary: { remaining: room.legendaryDeck?.drawPile?.length || 0, discard: room.legendaryDeck?.discard?.length || 0 },
    },
    factions: POLITICAL_FACTION_ORDER.map(factionId => {
      const f = FACTIONS[factionId];
      const vassal = room.players.find(p => p.suzerainId === factionId);
      const gift = f.giftIslandId ? room.islands.find(i => i.id === f.giftIslandId) : null;
      const viewer = room.players.find(p => p.id === viewerId);
      const canJoin = viewer && room.started && active?.id === viewerId && room.phase === 'actions' && (Number(room.actionsLeft) || 0) > 0
        ? canEnterVassalage(room, viewer, factionId)
        : { ok: false };
      return {
        id: factionId, name: f.name, exists: stateExists(room, factionId), canHaveVassal: Boolean(f.canHaveVassal),
        giftIslandId: f.giftIslandId || null, giftIslandName: gift?.name || null, vassalPlayerId: vassal?.id || null,
        tax: Number(f.tax) || 0, rewardShare: Number(f.rewardShare) || 0, canJoin: Boolean(canJoin.ok),
        fullConquestPrize: f.fullConquestPrize ? {
          preserveBuildings: (f.fullConquestPrize.preserveBuildings || []).map(spec => ({ ...spec, name: buildingDisplayName(spec) })),
          razeDucats: Number(f.fullConquestPrize.razeDucats) || 0,
        } : null,
        fullConquestClaimed: Boolean(room.factionState?.[factionId]?.fullConquestClaimed),
        fullConquestPlayerId: room.factionState?.[factionId]?.fullConquestPlayerId || null,
        fullConquestMode: room.factionState?.[factionId]?.fullConquestMode || null,
      };
    }),
    feudDecks: Object.fromEntries(POLITICAL_FACTION_ORDER.map(id => [id, { remaining: room.feudDecks?.[id]?.drawPile?.length || 0, discard: room.feudDecks?.[id]?.discard?.length || 0 }])),
    assignmentDecks: Object.fromEntries(Object.keys(ASSIGNMENT_CARDS).map(id => [id, { remaining: room.assignmentDecks?.[id]?.drawPile?.length || 0, discard: room.assignmentDecks?.[id]?.discard?.length || 0 }])),
    legendaryPlaces: Object.values(LEGENDARY_PLACES).map(place => ({ ...place, exploredBy: room.legendaryPlacesExplored?.[place.id] || null })),
    alliances: (room.alliances || []).map(pair => [...pair]),
    pendingAlliance: room.pendingAlliance && (room.pendingAlliance.fromId === viewerId || room.pendingAlliance.toId === viewerId)
      ? { ...room.pendingAlliance, viewerRole: room.pendingAlliance.fromId === viewerId ? 'sender' : 'recipient' }
      : null,
    pendingBattle: room.pendingBattle ? {
      id: room.pendingBattle.id,
      kind: room.pendingBattle.kind,
      attackerId: room.pendingBattle.attackerId,
      targetPlayerId: room.pendingBattle.targetPlayerId || null,
      islandId: room.pendingBattle.islandId || null,
      captureMode: room.pendingBattle.captureMode || null,
      invites: room.pendingBattle.invites.map(inv => ({
        playerId: inv.playerId,
        side: inv.side,
        status: inv.response === true ? 'joined' : inv.response === false ? 'declined' : 'pending',
      })),
      viewerInvite: room.pendingBattle.invites.some(inv => inv.playerId === viewerId && inv.response == null),
    } : null,
    log: room.log.slice(-100),
    reachableCells: reachable,
    mistReachableCells: mistReachable,
    citadelCells: CITADEL_CELLS,
    anchorCells: Object.entries(ANCHORS).flatMap(([color, def]) => def.cells.map(([row, col]) => ({ color, row, col, name: def.name, glory: def.glory }))),
    anchorDecks: Object.fromEntries(Object.entries(room.anchorDecks || {}).map(([color, deck]) => [color, { remaining: deck.drawPile?.length || 0, discard: deck.discard?.length || 0 }])),
    buildingCatalog: Object.fromEntries(Object.entries(BUILDINGS).filter(([, b]) => b.buildable !== false).map(([id, b]) => [id, {
      id: b.id,
      name: b.fixedName ? b.name : buildingDisplayName({ type: id, level: 1 }),
      price: b.price,
      area: b.area,
      resource: b.resource || null,
      produces: b.produces || null,
    }])),
    goodsCatalog: Object.fromEntries(Object.entries(GOODS).map(([id, g]) => [id, {
      id: g.id, name: g.name, price: g.price,
    }])),
    shipLevelCatalog: Object.fromEntries(Object.entries(SHIP_LEVELS).map(([level, d]) => [level, { ...d }])),
    shipUpgradeCatalog: Object.fromEntries(Object.entries(SHIP_UPGRADES).map(([id, u]) => [id, {
      id: u.id, name: u.name, branch: u.branch, order: u.order, price: u.price, requires: u.requires || null,
      artillery: u.artillery || 0, army: u.army || 0, cargo: u.cargo || 0, movement: u.movement || 0,
    }])),
    escortCatalog: Object.fromEntries(Object.entries(ESCORTS).map(([id, e]) => [id, { ...e }])),
    islands: room.islands.map(i => {
      const view = publicIsland(i, room);
      const defense = islandDefenseArmy(room, i);
      return { ...view, defenseArmy: defense.total, defenseBreakdown: defense };
    }),
    players: room.players.map(p => {
      const stats = shipStats(p);
      const escorts = escortStatuses(room, p).map(e => ({
        id: e.id,
        type: e.type,
        special: Boolean(e.special),
        active: Boolean(e.active),
        inactiveReason: e.inactiveReason || null,
        cargo: e.cargo ? { ...e.cargo, value: cargoSaleValue(p, e.id) } : null,
      }));
      const cargoEscortCapacity = escorts.filter(e => e.active).reduce((sum, e) => sum + (Number(ESCORTS[e.type]?.cargo) || 0), 0);
      const level = Math.max(1, Math.min(7, Number(p.level) || 1));
      const nextLevel = level < 7 ? SHIP_LEVELS[level + 1] : null;
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        shipClass: p.shipClass,
        ducats: p.ducats,
        debt: Number(p.debt) || 0,
        glory: Number(p.glory) || 0,
        level,
        row: p.row,
        col: p.col,
        connected: p.connected,
        islandCount: ownerIslandCount(room, p.id),
        suzerainId: p.suzerainId || null,
        vassalGiftIslandId: p.vassalGiftIslandId || null,
        enemyFactionIds: [...(p.enemyFactionIds || [])],
        activeAssignment: p.id === viewerId ? assignmentPublic(p.activeAssignment) : null,
        hasActiveAssignment: Boolean(p.activeAssignment),
        replacedAssignmentConditions: p.id === viewerId ? [...(p.replacedAssignmentConditions || [])] : [],
        nextActionLimit: p.id === viewerId ? (p.nextActionLimit || null) : null,
        specialCards: p.id === viewerId ? [...(p.specialCards || [])] : [],
        specialCardCount: (p.specialCards || []).length,
        legendaryCards: p.id === viewerId ? (p.legendaryCards || []).map((c, handIndex) => ({ id: c.id, name: c.name, handIndex })) : [],
        legendaryCardCount: (p.legendaryCards || []).length,
        playableLegendaryCards: p.id === viewerId ? allLegendaryCardRefs(p) : [],
        legendaryStatus: {
          shipVeilTurns: Number(p.legendaryEffects?.shipVeil?.remaining) || 0,
          seaCurseTurns: (p.legendaryEffects?.seaCurses || []).map(e => Number(e.remaining) || 0),
          seaCursePenalty: legendaryMovementPenalty(p),
        },
        savedEventCards: p.id === viewerId ? (p.savedEventCards || []).map(c => ({ id: c.id, kind: c.kind, name: c.name, goodId: c.goodId || null })) : [],
        savedEventCardCount: (p.savedEventCards || []).length,
        nextTurnEffects: p.id === viewerId ? { ...(p.nextTurnEffects || {}) } : {},
        activeTurnEffects: p.id === viewerId ? { ...(p.activeTurnEffects || {}) } : {},
        landCompany: p.landCompany ? { ...p.landCompany } : null,
        bastionSupportCapacity: stoneworksSupportCapacity(room, p.id),
        bastionCount: bastionSupportSummary(room, p.id).count,
        supportedBastionIslandIds: bastionSupportSummary(room, p.id).supported,
        cargo: p.cargo ? { ...p.cargo, value: cargoSaleValue(p, 'main') } : null,
        cargoCapacity: stats.cargo,
        stats,
        assaultArmy: (stats.army || 0) + (Number(p.landCompany?.army) || 0),
        fleetArtillery: fleetArtillery(room, p),
        totalCargoCapacity: stats.cargo + cargoEscortCapacity,
        upgrades: shipUpgradeStatuses(p),
        disabledUpgradeIds: p.id === viewerId ? [...(p.disabledUpgradeIds || [])] : [],
        upgradeSlots: level,
        escorts,
        levelInactiveEscortIds: p.id === viewerId ? [...(p.levelInactiveEscortIds || [])] : [],
        shipyardSlots: shipyardSlotsForPlayer(room, p.id),
        escortUseLimit: escortUseLimit(p),
        nextEscortPrice: escortPurchasePrice(p),
        nextLevel: nextLevel ? { level: nextLevel.level, price: nextLevel.price } : null,
        atCitadel: isCitadelCell(p.row, p.col),
        inPeaceZone: isCitadelPeaceCell(p.row, p.col),
        skipTurns: Number(p.skipTurns) || 0,
        pendingLegendary: Number(p.pendingLegendary) || 0,
        pendingLandinEscort: Boolean(p.pendingLandinEscort),
        visitedAnchors: [...(p.visitedAnchors || [])],
        lastAnchorEncounter: p.lastAnchorEncounter ? { ...p.lastAnchorEncounter } : null,
        phase: p.id === active?.id ? room.phase : 'waiting',
        roll: p.id === active?.id ? room.roll : null,
        movePoints: p.id === active?.id ? room.movePoints : null,
        actionsLeft: p.id === active?.id ? room.actionsLeft : null,
        allyIds: (room.alliances || []).flatMap(pair => pair[0] === p.id ? [pair[1]] : pair[1] === p.id ? [pair[0]] : []),
        brokenAlliesThisTurn: p.id === viewerId ? [...(p.brokenAlliesThisTurn || [])] : [],
        isYou: p.id === viewerId,
      };
    }),
    order: room.order,
  };
}

function emitRoom(room) {
  queueIslandCorrectionIfNeeded(room);
  queueEscortCapacityDecisionsIfNeeded(room);
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('roomState', publicRoom(room, p.id));
  }
}

function log(room, text) {
  room.log.push({ t: Date.now(), text });
  if (room.log.length > 240) room.log.shift();
}

function playerById(room, id) {
  return room?.players?.find(p => p.id === String(id || '')) || null;
}



function assignmentPublic(assignment) {
  if (!assignment?.card) return null;
  const card = assignment.card;
  return {
    instanceId: assignment.instanceId,
    factionId: assignment.factionId,
    id: card.id,
    conditionKey: card.conditionKey,
    text: card.text,
    reward: Number(card.reward) || 0,
    type: card.type,
    issuedRound: Number(assignment.issuedRound) || null,
  };
}

function trackAssignment(room, player, event) {
  if (!room || !player?.activeAssignment) return null;
  const result = completeAssignment(room, player, event);
  if (!result?.ok) return null;
  const factionName = FACTIONS[result.assignment.factionId]?.name || result.assignment.factionId;
  const withheldText = result.withheld ? ` ${factionName} удерживает ${result.withheld}; игроку причитается ${result.paid}.` : '';
  const debtText = result.credit?.debtPaid ? ` Из выплаты ${result.credit.debtPaid} ушло в погашение долга; в казну ${result.credit.net}.` : '';
  log(room, `${player.name} выполняет поручение «${result.assignment.card.text}». Награда ${result.gross} дукатов.${withheldText}${debtText}`);
  return result;
}

function assignmentBuildingEvent(island, building) {
  const def = BUILDINGS[building?.type];
  return {
    type: 'building-action',
    islandId: island?.id || null,
    islandResources: [...(island?.resources || [])],
    buildingType: building?.type || null,
    branch: def?.branch || null,
  };
}

function deliveryAssignmentMatch(player, result) {
  if (!player?.activeAssignment || !result) return false;
  return assignmentEventMatches(player, {
    type: 'delivery',
    goodId: result.good?.id,
    assignmentInstanceId: result.assignmentInstanceId || null,
  });
}

function buildAssignmentQueue(room, snapshot) {
  const queue = [];
  for (const playerId of room.order || []) {
    const snap = snapshot?.[playerId];
    if (!snap?.suzerainId || snap.hadAssignment) continue;
    if (!ASSIGNMENT_CARDS[snap.suzerainId]) continue;
    queue.push({ playerId, factionId: snap.suzerainId });
  }
  return queue;
}

function buildAssignmentReplaceQueue(room) {
  return (room.order || []).filter(id => {
    const p = playerById(room, id);
    return Boolean(p?.suzerainId && p.activeAssignment);
  });
}

function refreshPoliticsWithLog(room) {
  const changes = refreshFactionExistence(room);
  for (const change of changes) {
    if (change.before === true && change.exists === false) log(room, `${FACTIONS[change.factionId]?.name || change.factionId} прекращает существование. Вражда с ним у всех игроков прекращается.`);
  }
  return changes;
}

function markEnmity(room, player, factionId, reason = '') {
  if (!player || !factionId) return false;
  const result = addEnmity(room, player, factionId);
  if (result.added) log(room, `${player.name} становится врагом государства ${result.faction.name}${reason ? `: ${reason}` : '.'}`);
  return Boolean(result.added);
}

function hostilityFactionForPlayer(target) {
  return target?.suzerainId || null;
}

function hostilityFactionForIsland(room, island) {
  if (!island) return null;
  if (island.ownerId) return hostilityFactionForPlayer(playerById(room, island.ownerId));
  return factionIdForIsland(island);
}

function autoRebelBeforeStateAttack(room, attacker, island) {
  const factionId = island && !island.ownerId ? factionIdForIsland(island) : null;
  if (!factionId || attacker?.suzerainId !== factionId) return null;
  const result = rebelFromSuzerain(room, attacker);
  if (result.ok) {
    const returned = result.returned ? ` Подаренный остров ${result.gift.name} возвращён государству.` : '';
    log(room, `${attacker.name} нападает на собственного сюзерена и автоматически объявляет мятеж.${returned}`);
  }
  return result;
}

function markAttackHostilityAgainstPlayer(room, attacker, target, reason = 'нападение на вассала') {
  const factionId = hostilityFactionForPlayer(target);
  if (factionId) markEnmity(room, attacker, factionId, reason);
}

function markAttackHostilityAgainstIsland(room, attacker, island, reason = 'нападение на владение государства или вассала') {
  const factionId = hostilityFactionForIsland(room, island);
  if (factionId) markEnmity(room, attacker, factionId, reason);
}

function hasPendingDecision(room) {
  return Boolean(room?.pendingAlliance || room?.pendingBattle || room?.pendingEvent || room?.pendingFeud || room?.pendingAssignmentChoice || room?.pendingStatePrize || room?.pendingIslandCorrection || room?.pendingFleetAdjustment || room?.pendingLegendaryReaction);
}

function pendingDecisionError(room) {
  if (room?.pendingAlliance) return 'Сначала завершите предложение союза.';
  if (room?.pendingBattle) return 'Сначала завершите текущий совместный бой.';
  if (room?.pendingEvent) return 'Сначала разрешите карту общей Фазы событий.';
  if (room?.pendingFeud) return 'Сначала разрешите карту вражды.';
  if (room?.pendingAssignmentChoice) return 'Сначала решите, оставлять ли поручение сюзерена.';
  if (room?.pendingStatePrize) return 'Сначала разместите призовые здания за полное подчинение государства.';
  if (room?.pendingIslandCorrection) return 'Сначала удалите лишние постройки с острова после потери статуса.';
  if (room?.pendingFleetAdjustment) return 'Сначала завершите обязательную настройку сопровождения или флотилии.';
  if (room?.pendingLegendaryReaction) return 'Сначала разрешите реакцию «Покров моря».';
  return null;
}

function fleetAdjustmentOptions(room, player, stage) {
  if (stage === 'upgrades') {
    return shipUpgradeStatuses(player).map(u => ({
      id: u.id,
      name: u.name,
      missingRequirement: Boolean(u.missingRequirement),
    }));
  }
  if (stage === 'escorts' || stage === 'landin-replace' || stage === 'shipyard-remove') {
    const catalog = ESCORTS;
    return escortStatuses(room, player)
      .filter(e => stage !== 'shipyard-remove' || !e.special)
      .map(e => ({
        id: e.id,
        name: catalog[e.type]?.name || e.type,
        type: e.type,
        special: Boolean(e.special),
        hasCargo: Boolean(e.cargo),
        cargoText: e.cargo ? `${GOODS[e.cargo.goodId]?.name || e.cargo.goodId} ×${e.cargo.quantity}` : null,
        artillery: Number(catalog[e.type]?.artillery) || 0,
        cargoCapacity: Number(catalog[e.type]?.cargo) || 0,
      }));
  }
  return [];
}

function fleetDecisionActivationBlocked(room) {
  return Boolean(
    room?.pendingAlliance || room?.pendingBattle || room?.pendingEvent || room?.pendingFeud ||
    room?.pendingAssignmentChoice || room?.pendingStatePrize || room?.pendingIslandCorrection ||
    room?.pendingLegendaryReaction
  );
}

function enqueueFleetDecision(room, item) {
  room.fleetAdjustmentQueue ||= [];
  const stage = item.stage || 'level';
  const duplicate = room.fleetAdjustmentQueue.some(x => x.playerId === item.playerId && (x.stage || 'level') === stage);
  const pendingSame = room.pendingFleetAdjustment?.playerId === item.playerId && room.pendingFleetAdjustment?.stage === stage;
  if (!duplicate && !pendingSame) room.fleetAdjustmentQueue.push({ ...item, stage });
}

function activateNextFleetAdjustment(room) {
  if (room?.pendingFleetAdjustment) return true;
  if (fleetDecisionActivationBlocked(room)) return false;
  room.fleetAdjustmentQueue ||= [];
  while (room.fleetAdjustmentQueue.length) {
    const item = room.fleetAdjustmentQueue.shift();
    const player = playerById(room, item.playerId);
    if (!player) continue;

    if (item.stage === 'landin-replace') {
      if (!player.pendingLandinEscort) continue;
      if ((player.escorts || []).length < 3) {
        const granted = replaceEscortWithLandin(player, null);
        if (granted.ok) {
          player.pendingLandinEscort = false;
          log(room, `${player.name} получает особое сопровождение Ландина: +6 артиллерии и отдельный трюм 5.`);
        }
        continue;
      }
      room.pendingFleetAdjustment = {
        id: crypto.randomUUID(), playerId: player.id, stage: 'landin-replace', required: 1,
        reason: item.reason || 'Особое сопровождение Ландина должно заменить одно из трёх имеющихся судов сопровождения.',
        options: fleetAdjustmentOptions(room, player, 'landin-replace'),
      };
      log(room, `${player.name}: выберите одно судно сопровождения, которое заменит особое сопровождение Ландина.`);
      return true;
    }

    if (item.stage === 'shipyard-remove') {
      const required = ordinaryEscortExcess(room, player);
      if (required <= 0) continue;
      room.pendingFleetAdjustment = {
        id: crypto.randomUUID(), playerId: player.id, stage: 'shipyard-remove', required,
        reason: item.reason || 'После потери мест верфи лишние обычные суда сопровождения должны быть удалены вместе с грузом.',
        options: fleetAdjustmentOptions(room, player, 'shipyard-remove'),
      };
      log(room, `${player.name}: после потери мест верфи нужно удалить ${required} обычных судов сопровождения.`);
      return true;
    }

    const needs = fleetAdjustmentNeeds(player);
    const stage = needs.upgradeChoiceNeeded ? 'upgrades' : (needs.escortChoiceNeeded ? 'escorts' : null);
    if (!stage) continue;
    const required = stage === 'upgrades' ? needs.upgradeCount : needs.escortCount;
    room.pendingFleetAdjustment = {
      id: crypto.randomUUID(), playerId: player.id, stage, required,
      reason: item.reason || 'После снижения уровня корабля нужно выбрать временно неактивные элементы флотилии.',
      options: fleetAdjustmentOptions(room, player, stage),
    };
    const what = stage === 'upgrades' ? 'улучшений' : 'судов сопровождения';
    log(room, `${player.name}: после снижения уровня корабля нужно выбрать ${required} временно неактивных ${what}.`);
    return true;
  }
  return false;
}

function queueFleetAdjustment(room, player, reason = '') {
  if (!room || !player) return false;
  const needs = fleetAdjustmentNeeds(player);
  if (!needs.needsChoice) return false;
  enqueueFleetDecision(room, { playerId: player.id, stage: 'level', reason });
  if (!room.pendingFleetAdjustment) activateNextFleetAdjustment(room);
  return true;
}

function queueShipyardEscortRemoval(room, player, reason = '') {
  if (!room || !player || ordinaryEscortExcess(room, player) <= 0) return false;
  enqueueFleetDecision(room, { playerId: player.id, stage: 'shipyard-remove', reason });
  if (!room.pendingFleetAdjustment) activateNextFleetAdjustment(room);
  return true;
}

function queueLandinEscortReplacement(room, player, reason = '') {
  if (!room || !player?.pendingLandinEscort) return false;
  enqueueFleetDecision(room, { playerId: player.id, stage: 'landin-replace', reason });
  if (!room.pendingFleetAdjustment) activateNextFleetAdjustment(room);
  return true;
}

function queueEscortCapacityDecisionsIfNeeded(room) {
  if (!room?.started) return false;
  let queued = false;
  for (const player of room.players || []) {
    if (player.pendingLandinEscort) queued = queueLandinEscortReplacement(room, player, 'Награда Ландина заменяет одно из судов сопровождения и не увеличивает общий предел сверх трёх.') || queued;
    if (ordinaryEscortExcess(room, player) > 0) queued = queueShipyardEscortRemoval(room, player, 'После потери места верфи выберите лишнее обычное сопровождение для удаления; его груз будет потерян.') || queued;
    if (fleetAdjustmentNeeds(player).needsChoice) queued = queueFleetAdjustment(room, player, 'Текущий уровень основного корабля допускает меньше активных элементов флотилии.') || queued;
  }
  if (!room.pendingFleetAdjustment) activateNextFleetAdjustment(room);
  return Boolean(room.pendingFleetAdjustment || queued);
}

function queueFleetAdjustmentsForLosses(room, losses, reason = '') {
  let queued = false;
  for (const loss of losses || []) {
    const player = playerById(room, loss.playerId);
    if (player && queueFleetAdjustment(room, player, reason)) queued = true;
  }
  return queued;
}

function advanceFleetAdjustment(room) {
  const pending = room?.pendingFleetAdjustment;
  if (!pending) return false;
  const player = playerById(room, pending.playerId);
  if (!player) {
    room.pendingFleetAdjustment = null;
    return activateNextFleetAdjustment(room);
  }
  const needs = fleetAdjustmentNeeds(player);
  if (needs.upgradeChoiceNeeded) {
    pending.stage = 'upgrades';
    pending.required = needs.upgradeCount;
    pending.options = fleetAdjustmentOptions(room, player, 'upgrades');
    return true;
  }
  if (needs.escortChoiceNeeded) {
    pending.stage = 'escorts';
    pending.required = needs.escortCount;
    pending.options = fleetAdjustmentOptions(room, player, 'escorts');
    return true;
  }
  room.pendingFleetAdjustment = null;
  if (activateNextFleetAdjustment(room)) return true;
  if (queueEscortCapacityDecisionsIfNeeded(room)) return true;
  if (!queueIslandCorrectionIfNeeded(room, null, 'последствия боя или изменения флотилии') && room.eventPhase?.active) processEventPhase(room);
  return false;
}

function legendaryKindFromName(name) {
  const value = String(name || '');
  if (value === 'Покров моря') return 'sea-veil';
  if (value === 'Пламя Ада') return 'hellfire';
  if (value === 'Путь сквозь туман') return 'mist-path';
  if (value === 'Морское проклятие') return 'sea-curse';
  return null;
}

function allLegendaryCardRefs(player) {
  if (!player) return [];
  const out = [];
  (player.legendaryCards || []).forEach((card, index) => out.push({
    source: 'legendary', index, id: card.id, kind: card.id, name: card.name,
  }));
  (player.specialCards || []).forEach((name, index) => {
    const kind = legendaryKindFromName(name);
    if (kind) out.push({ source: 'special', index, id: kind, kind, name });
  });
  return out;
}

function legendaryCardRefs(player, kind) {
  return allLegendaryCardRefs(player).filter(ref => ref.kind === kind);
}

function playerHasLegendaryKind(player, kind) {
  return legendaryCardRefs(player, kind).length > 0;
}

function peekLegendaryCard(player, ref) {
  if (!player || !ref) return null;
  const source = String(ref.source || '');
  const index = Number(ref.index);
  if (!Number.isInteger(index) || index < 0) return null;
  if (source === 'legendary') {
    const card = player.legendaryCards?.[index];
    return card ? { source, index, kind: card.id, name: card.name, card } : null;
  }
  if (source === 'special') {
    const name = player.specialCards?.[index];
    const kind = legendaryKindFromName(name);
    return kind ? { source, index, kind, name, card: { id: kind, name } } : null;
  }
  return null;
}

function consumeLegendaryCard(room, player, ref) {
  const found = peekLegendaryCard(player, ref);
  if (!found) return null;
  if (found.source === 'legendary') {
    const [card] = player.legendaryCards.splice(found.index, 1);
    discardDeckCard(room.legendaryDeck, card);
    return { ...found, card };
  }
  player.specialCards.splice(found.index, 1);
  return found;
}

function allianceNames(room, ids) {
  return (ids || []).map(id => playerById(room, id)?.name || 'Игрок').join(', ');
}

function sameCell(a, b) {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

function eligibleSeaBattleInvites(room, attacker, defender, inviteAttackers = true) {
  const attackerInvites = [];
  const defenderInvites = [];
  for (const p of room.players || []) {
    if (!p.connected || p.id === attacker.id || p.id === defender.id) continue;
    if (!sameCell(p, defender)) continue;
    if (inviteAttackers && areAllies(room, attacker, p) && !areAllies(room, defender, p)) {
      attackerInvites.push(p.id);
      continue;
    }
    if (areAllies(room, defender, p) && !areAllies(room, attacker, p) && !(attacker.brokenAlliesThisTurn || []).includes(p.id)) {
      defenderInvites.push(p.id);
    }
  }
  return { attackerInvites, defenderInvites };
}

function eligibleAssaultInvites(room, attacker, island, inviteAttackers = true) {
  const defender = island.ownerId ? playerById(room, island.ownerId) : null;
  const attackerInvites = [];
  const defenderInvites = [];
  for (const p of room.players || []) {
    if (!p.connected || p.id === attacker.id || p.id === defender?.id) continue;
    if (!playerOnIsland(p, island)) continue;
    if (inviteAttackers && areAllies(room, attacker, p) && (!defender || !areAllies(room, defender, p))) {
      attackerInvites.push(p.id);
      continue;
    }
    if (defender && areAllies(room, defender, p) && !areAllies(room, attacker, p) && !(attacker.brokenAlliesThisTurn || []).includes(p.id)) {
      defenderInvites.push(p.id);
    }
  }
  return { attackerInvites, defenderInvites };
}

function acceptedIds(pending, side) {
  return pending.invites.filter(inv => inv.side === side && inv.response === true).map(inv => inv.playerId);
}

function allBattleInvitesAnswered(pending) {
  return pending.invites.every(inv => inv.response === true || inv.response === false);
}

function describeLevelLoss(room, loss) {
  const player = playerById(room, loss.playerId);
  if (loss.returnedToStart) return `${player?.name || 'Игрок'}: I уровень → старт`;
  const cargo = loss.cargoDiscarded ? `, сброшено груза ${loss.cargoDiscarded}` : '';
  return `${player?.name || 'Игрок'}: ${loss.before} → ${loss.after}${cargo}`;
}

function logSeaBattleResult(room, attacker, defender, result) {
  const attackNames = allianceNames(room, result.attackerParticipantIds);
  const defenseNames = allianceNames(room, result.defenderParticipantIds);
  const score = `${result.attackerPower}:${result.defenderPower}`;
  if (result.outcome === 'tie') {
    log(room, `Морской бой ${attacker.name} против ${defender.name}: ${score}. Ничья. Участники атаки: ${attackNames}; защиты: ${defenseNames}. Все участники пропускают следующий личный ход.`);
  } else {
    const winners = result.outcome === 'attacker' ? attackNames : defenseNames;
    const losses = (result.levelLosses || []).map(loss => describeLevelLoss(room, loss)).join('; ') || 'без потери уровней';
    const shares = Object.entries(result.lootShares || {}).filter(([, amount]) => amount > 0).map(([id, amount]) => `${playerById(room, id)?.name || 'Игрок'} +${amount}`).join(', ');
    log(room, `Морской бой ${attacker.name} против ${defender.name}: ${score}. Побеждают: ${winners}. Потери уровней: ${losses}. Добыча ${result.loot} дукатов${shares ? ` (${shares})` : ''}.`);
  }
  if (result.rebellion) log(room, `Бунт владений ${attacker.name}: понижено построек выше I уровня: ${result.downgradedBuildings}.`);
}


function otherPendingDecisionExists(room) {
  return Boolean(room?.pendingAlliance || room?.pendingBattle || room?.pendingEvent || room?.pendingFeud || room?.pendingAssignmentChoice || room?.pendingStatePrize || room?.pendingFleetAdjustment || room?.pendingLegendaryReaction);
}

function normalizeOwnedGarrisonsWithLog(room) {
  for (const island of room?.islands || []) {
    if (!island.ownerId || !island.garrisonType) continue;
    const before = island.garrisonType;
    const after = normalizeIslandGarrison(island);
    if (before === after) continue;
    const owner = playerById(room, island.ownerId);
    if (before === 'permanent' && after === 'guard') {
      log(room, `${owner?.name || 'Игрок'}: ${island.name} перестал быть крупным портом — постоянный гарнизон становится городской стражей (+5).`);
    } else if (before && !after) {
      log(room, `${owner?.name || 'Игрок'}: ${island.name} потерял статус города — городской отряд распущен без возврата платы.`);
    }
  }
}

function firstIllegalOwnedIsland(room, preferredIslandId = null) {
  const owned = (room?.islands || []).filter(i => i.ownerId && playerById(room, i.ownerId));
  const ordered = preferredIslandId
    ? [...owned.filter(i => i.id === preferredIslandId), ...owned.filter(i => i.id !== preferredIslandId)]
    : owned;
  for (const island of ordered) {
    const report = islandConstraintReport(island);
    if (!report.legal) return { island, report, player: playerById(room, island.ownerId) };
  }
  return null;
}

function refreshPendingIslandCorrection(room) {
  const pending = room?.pendingIslandCorrection;
  if (!pending) return false;
  const island = room.islands?.find(i => i.id === pending.islandId);
  const player = playerById(room, pending.playerId);
  if (!island || !player || island.ownerId !== player.id) {
    room.pendingIslandCorrection = null;
    return false;
  }
  const report = islandConstraintReport(island);
  if (report.legal) {
    log(room, `${player.name}: ${island.name} снова соответствует ограничениям статуса «${report.status}»: площадь ${report.usedArea}/${report.effectiveArea}, предел ветви ${report.branchLimit}.`);
    room.pendingIslandCorrection = null;
    return false;
  }
  pending.islandName = island.name;
  pending.report = report;
  pending.options = islandCorrectionOptions(island);
  return true;
}

function queueIslandCorrectionIfNeeded(room, preferredIslandId = null, reason = '') {
  if (!room?.started) return false;
  normalizeOwnedGarrisonsWithLog(room);
  if (room.pendingIslandCorrection) return refreshPendingIslandCorrection(room);
  if (otherPendingDecisionExists(room)) return false;
  const found = firstIllegalOwnedIsland(room, preferredIslandId);
  if (!found) return false;
  room.pendingIslandCorrection = {
    id: crypto.randomUUID(),
    playerId: found.player.id,
    islandId: found.island.id,
    islandName: found.island.name,
    reason: reason || 'После потери статуса остров превысил доступную площадь или предел построек одной ветви.',
    report: found.report,
    options: islandCorrectionOptions(found.island),
    removed: [],
  };
  const branches = found.report.branchViolations.map(v => `${v.name}: ${v.count}/${v.limit}`).join(', ');
  const area = found.report.overArea > 0 ? ` площадь ${found.report.usedArea}/${found.report.effectiveArea}` : '';
  log(room, `${found.player.name}: ${found.island.name} требует немедленного исправления после потери статуса «${found.report.status}».${area}${branches ? `${area ? ';' : ''} ветви: ${branches}` : ''}. Владелец должен удалить постройки без компенсации.`);
  return true;
}

function continueAfterIslandCorrection(room) {
  if (queueIslandCorrectionIfNeeded(room)) return;
  if (room.eventPhase?.active) processEventPhase(room);
}

function advanceStatePrizePlacement(room) {
  const pending = room?.pendingStatePrize;
  if (!pending) return false;
  const player = playerById(room, pending.playerId);
  if (!player) { room.pendingStatePrize = null; return false; }

  while ((pending.remainingBuildings || []).length) {
    const spec = pending.remainingBuildings[0];
    const options = prizeBuildingPlacementOptions(room, player, spec);
    if (options.length) {
      pending.options = options;
      return true;
    }
    const name = buildingDisplayName(spec);
    pending.lost ||= [];
    pending.lost.push(name);
    pending.remainingBuildings.shift();
    log(room, `${player.name}: ${name} из итогового приза ${FACTIONS[pending.factionId]?.name || pending.factionId} невозможно разместить — эта часть приза пропадает.`);
  }

  log(room, `${player.name} завершает размещение итогового приза ${FACTIONS[pending.factionId]?.name || pending.factionId}.`);
  room.pendingStatePrize = null;
  return false;
}

function queueStatePrizeFromAssault(room, attacker, result) {
  const prize = result?.statePrize;
  if (!prize?.triggered) return false;
  const factionName = prize.factionName || FACTIONS[prize.factionId]?.name || prize.factionId;

  if (prize.mode === 'raze') {
    log(room, `${attacker.name} впервые подчиняет все исходные острова ${factionName} разорением последнего острова. Итоговый денежный приз: ${prize.ducats} дукатов.`);
    return false;
  }

  const all = (prize.allBuildings || []).map(buildingDisplayName);
  const dedup = (prize.deduplicatedBuildings || []).map(buildingDisplayName);
  const remaining = (prize.buildings || []).map(spec => ({ ...spec }));
  const dedupText = dedup.length ? ` Уже полученные одновременно одинаковые награды не дублируются: ${dedup.join(', ')}.` : '';
  log(room, `${attacker.name} впервые подчиняет все исходные острова ${factionName} с сохранением последнего острова. Итоговый приз: ${all.join(', ') || 'без зданий'}.${dedupText}`);

  if (!remaining.length) return false;
  room.pendingStatePrize = {
    id: crypto.randomUUID(),
    playerId: attacker.id,
    factionId: prize.factionId,
    remainingBuildings: remaining,
    options: [],
    lost: [],
  };
  return advanceStatePrizePlacement(room);
}

function logAssaultResult(room, attacker, island, result) {
  const attackNames = allianceNames(room, result.attackerParticipantIds);
  const defenseNames = allianceNames(room, result.defenderParticipantIds);
  if (result.outcome === 'attacker') {
    const modeText = result.captureMode === 'raze' ? 'разоряет постройки' : 'сохраняет инфраструктуру';
    const rewardText = result.rewardNotes.length ? ` Награда: ${result.rewardNotes.join(', ')}.` : '';
    const gloryText = result.glory ? ` Слава +${result.glory}.` : '';
    log(room, `${attacker.name} и союзники [${attackNames}] штурмуют ${island.name}: войско ${result.attackerPower} против защиты ${result.defense.total}. Остров получает инициатор ${attacker.name}; ${modeText}.${gloryText}${rewardText}`);
    trackAssignment(room, attacker, { type: 'capture-island', islandId: island.id });
  } else if (result.outcome === 'defender') {
    const losses = (result.levelLosses || []).map(loss => describeLevelLoss(room, loss)).join('; ');
    const companies = (result.discardedLandCompanies || []).map(x => `${playerById(room, x.playerId)?.name || 'Игрок'} теряет роту +${x.army}`).join('; ');
    log(room, `Штурм ${island.name}: ${result.attackerPower}:${result.defense.total}. Защита устояла${defenseNames ? ` [${defenseNames}]` : ''}. Потери нападающих: ${[losses, companies].filter(Boolean).join('; ') || 'нет'}.`);
  } else {
    const losses = Object.entries(result.treasuryLosses || {}).map(([id, amount]) => `${playerById(room, id)?.name || 'Игрок'} −${amount}`).join(', ');
    log(room, `Штурм ${island.name}: ${result.attackerPower}:${result.defense.total}. Ничья, контроль не меняется. Потери казны участников: ${losses || 'нет'}.`);
  }
}

function beginSeaBattleResolution(room, attacker, target, inviteAllies) {
  const eligible = eligibleSeaBattleInvites(room, attacker, target, Boolean(inviteAllies));
  const invites = [
    ...eligible.attackerInvites.map(playerId => ({ playerId, side: 'attacker', response: null })),
    ...eligible.defenderInvites.map(playerId => ({ playerId, side: 'defender', response: null })),
  ];
  if (!invites.length) {
    const result = jointSeaBattle(room, attacker, target, [], []);
    if (!result.ok) return result;
    logSeaBattleResult(room, attacker, target, result);
    const fleetPending = queueFleetAdjustmentsForLosses(room, result.levelLosses, 'Потеря уровня после морского боя.');
    if (!fleetPending) queueIslandCorrectionIfNeeded(room, null, 'последствия морского боя и бунта владений');
    log(room, `Осталось действий: ${room.actionsLeft}.`);
    return { ok: true, result, fleetPending };
  }
  room.pendingBattle = {
    id: crypto.randomUUID(), kind: 'sea', attackerId: attacker.id, targetPlayerId: target.id,
    invites, captureMode: null,
  };
  const invitedAttackers = allianceNames(room, eligible.attackerInvites);
  const invitedDefenders = allianceNames(room, eligible.defenderInvites);
  log(room, `${attacker.name} объявляет морской бой против ${target.name}. ${invitedAttackers ? `К атаке приглашены: ${invitedAttackers}. ` : ''}${invitedDefenders ? `К защите приглашены: ${invitedDefenders}.` : ''}`);
  return { ok: true, pending: true };
}

function beginAssaultResolution(room, attacker, island, captureMode, inviteAllies) {
  const owner = island.ownerId ? playerById(room, island.ownerId) : null;
  const eligible = eligibleAssaultInvites(room, attacker, island, Boolean(inviteAllies));
  const invites = [
    ...eligible.attackerInvites.map(playerId => ({ playerId, side: 'attacker', response: null })),
    ...eligible.defenderInvites.map(playerId => ({ playerId, side: 'defender', response: null })),
  ];
  if (!invites.length) {
    const result = jointAssaultIsland(room, attacker, island, captureMode, [], []);
    if (!result.ok) return result;
    logAssaultResult(room, attacker, island, result);
    if (result.outcome === 'attacker') {
      queueStatePrizeFromAssault(room, attacker, result);
      refreshPoliticsWithLog(room);
    }
    const fleetPending = queueFleetAdjustmentsForLosses(room, result.levelLosses, `Потеря уровня после штурма ${island.name}.`);
    if (!fleetPending) queueIslandCorrectionIfNeeded(room, null, `последствия штурма ${island.name}`);
    log(room, `Осталось действий: ${room.actionsLeft}.`);
    return { ok: true, result, fleetPending };
  }
  room.pendingBattle = {
    id: crypto.randomUUID(), kind: 'assault', attackerId: attacker.id, islandId: island.id,
    captureMode, invites, targetPlayerId: owner?.id || null,
  };
  const invitedAttackers = allianceNames(room, eligible.attackerInvites);
  const invitedDefenders = allianceNames(room, eligible.defenderInvites);
  log(room, `${attacker.name} объявляет штурм ${island.name}. ${invitedAttackers ? `К атаке приглашены: ${invitedAttackers}. ` : ''}${invitedDefenders ? `К защите приглашены: ${invitedDefenders}.` : ''}`);
  return { ok: true, pending: true };
}

function resolvePendingLegendaryReaction(room, useVeil, cardRef = null) {
  const pending = room?.pendingLegendaryReaction;
  if (!pending) return { ok: false, error: 'Реакция больше не ожидается.' };
  const target = playerById(room, pending.targetPlayerId);
  const source = playerById(room, pending.sourcePlayerId);
  if (!target || !source) return { ok: false, error: 'Участник реакции не найден.' };

  if (useVeil) {
    const found = peekLegendaryCard(target, cardRef);
    if (!found || found.kind !== 'sea-veil') return { ok: false, error: 'Выберите доступную карту «Покров моря».' };
    consumeLegendaryCard(room, target, cardRef);
    if (pending.kind === 'sea-attack') {
      applySeaVeilToShip(target, { sourcePlayerId: target.id, ignoreCurrentTurn: false });
      log(room, `${target.name} реакцией разыгрывает «Покров моря». Морская атака ${source.name} отменена; корабль защищён на три следующих личных хода ${target.name}.`);
    } else {
      const island = room.islands.find(i => i.id === pending.islandId);
      if (!island) return { ok: false, error: 'Остров реакции не найден.' };
      applySeaVeilToIsland(island, target, { ignoreCurrentTurn: false });
      const what = pending.kind === 'hellfire' ? '«Пламя Ада»' : 'штурм';
      log(room, `${target.name} реакцией разыгрывает «Покров моря». ${what} ${source.name} отменён; ${island.name} защищён на три следующих личных хода ${target.name}.`);
    }
    room.pendingLegendaryReaction = null;
    return { ok: true, canceled: true };
  }

  room.pendingLegendaryReaction = null;
  if (pending.kind === 'sea-attack') {
    const result = beginSeaBattleResolution(room, source, target, pending.inviteAllies);
    return result;
  }
  if (pending.kind === 'assault') {
    const island = room.islands.find(i => i.id === pending.islandId);
    return beginAssaultResolution(room, source, island, pending.captureMode, pending.inviteAllies);
  }
  if (pending.kind === 'hellfire') {
    const island = room.islands.find(i => i.id === pending.islandId);
    const result = applyHellfire(room, source, island);
    if (!result.ok) return result;
    const detail = result.changed ? result.changes.map(x => `${x.beforeName} → ${x.afterName}`).join(', ') : 'построек выше I уровня нет';
    log(room, `${source.name}: «Пламя Ада» поражает ${island.name}: ${detail}.`);
    return { ok: true, result };
  }
  return { ok: false, error: 'Неизвестный тип реакции.' };
}

function resolvePendingBattle(room) {
  const pending = room.pendingBattle;
  if (!pending || !allBattleInvitesAnswered(pending)) return null;
  const attacker = playerById(room, pending.attackerId);
  let result;
  if (pending.kind === 'sea') {
    const defender = playerById(room, pending.targetPlayerId);
    result = jointSeaBattle(room, attacker, defender, acceptedIds(pending, 'attacker'), acceptedIds(pending, 'defender'));
    if (result.ok) logSeaBattleResult(room, attacker, defender, result);
  } else {
    const island = room.islands.find(i => i.id === pending.islandId);
    result = jointAssaultIsland(room, attacker, island, pending.captureMode, acceptedIds(pending, 'attacker'), acceptedIds(pending, 'defender'));
    if (result.ok) {
      logAssaultResult(room, attacker, island, result);
      if (result.outcome === 'attacker') {
        queueStatePrizeFromAssault(room, attacker, result);
        refreshPoliticsWithLog(room);
      }
    }
  }
  if (!result?.ok) log(room, `Совместный бой не удалось разрешить: ${result?.error || 'неизвестная ошибка'}`);
  room.pendingBattle = null;
  if (result?.ok) {
    const reason = pending.kind === 'sea' ? 'Потеря уровня после совместного морского боя.' : 'Потеря уровня после совместного штурма.';
    const fleetPending = queueFleetAdjustmentsForLosses(room, result.levelLosses, reason);
    if (!fleetPending) queueIslandCorrectionIfNeeded(room, null, 'последствия совместного боя');
  }
  return result;
}

function handleAnchorStop(room, player) {
  const result = resolveAnchorEncounter(room, player);
  if (!result?.ok || !result.triggered) return result;
  room.actionsLeft = Math.max(0, (Number(room.actionsLeft) || 0) - (result.actionCost || 0));
  const card = result.card;
  if (result.outcome === 'quiet') {
    log(room, `${player.name} останавливается на ${result.anchor.name.toLowerCase()}: «${card.name}». Карта не расходует действие.`);
    return result;
  }
  if (result.outcome === 'win') {
    const credit = result.reward;
    const debtText = credit?.debtPaid ? ` Из награды ${credit.debtPaid} уходит в погашение долга; в казну ${credit.net}.` : '';
    log(room, `${player.name}: ${result.anchor.name}, «${card.name}» (артиллерия ${card.artillery}). Флотилия ${result.fleetPower} — победа: награда ${card.reward} дукатов, слава +${result.glory}.${debtText} Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, player, { type: 'anchor-win', color: result.anchor.color || anchorAt(player.row, player.col)?.color });
  } else if (result.outcome === 'loss') {
    const p = result.penalty;
    const debtText = p.addedDebt ? ` Недостающие ${p.addedDebt} записаны в долг; общий долг ${p.debt}.` : '';
    log(room, `${player.name}: ${result.anchor.name}, «${card.name}» (артиллерия ${card.artillery}). Флотилия ${result.fleetPower} — поражение: штраф ${p.required} дукатов, уплачено ${p.paid}.${debtText} Уровень корабля не снижается. Осталось действий: ${room.actionsLeft}.`);
  } else {
    log(room, `${player.name}: ${result.anchor.name}, «${card.name}» — ничья ${result.fleetPower}:${card.artillery}. Награды нет; ${player.name} пропустит следующий личный ход. Осталось действий: ${room.actionsLeft}.`);
  }
  return result;
}


function saveHeldEventCard(player, card, kind, extra = {}) {
  player.savedEventCards ||= [];
  const saved = {
    id: crypto.randomUUID(),
    kind,
    name: card?.name || 'Сохранённая карта',
    sourceDeck: 'event',
    sourceCard: card ? { ...card } : null,
    ...extra,
  };
  player.savedEventCards.push(saved);
  return saved;
}

function applyNextTurnEffect(player, effect, value) {
  player.nextTurnEffects ||= {};
  if (effect === 'moveBonus' || effect === 'movePenalty') {
    player.nextTurnEffects[effect] = (Number(player.nextTurnEffects[effect]) || 0) + (Number(value) || 0);
  } else {
    player.nextTurnEffects[effect] = Boolean(value);
  }
}

function queueEventDecision(room, player, card, kind, options, extra = {}) {
  room.pendingEvent = {
    id: crypto.randomUUID(),
    playerId: player.id,
    cardName: card.name,
    kind,
    options: (options || []).map(o => ({ ...o })),
    eventCard: { ...card },
    origin: 'event-phase',
    ...extra,
  };
  room.eventPhase.currentPlayerId = player.id;
  room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: card.name, pending: true };
}

function resolveSailingEventCard(room, player, card) {
  if (!card) return { pending: false, holdEventCard: false };
  const resultBase = { pending: false, holdEventCard: false };

  if (card.type === 'treasure') {
    const treasure = drawTreasureCard(room);
    if (!treasure) {
      log(room, `${player.name}: «${card.name}», но колода сокровищ пуста.`);
      return resultBase;
    }
    if (treasure.multiplier) {
      const result = resolveMoneyTreasure(room, player, treasure);
      discardDeckCard(room.treasureDeck, treasure);
      trackAssignment(room, player, { type: 'treasure-resolved' });
      const debtText = result.credit.debtPaid ? `; ${result.credit.debtPaid} ушло в погашение долга` : '';
      log(room, `${player.name}: «${card.name}» → сокровище «${treasure.name}». Доход рынков/банков ${result.income}; получено ${result.amount} дукатов${debtText}.`);
      return resultBase;
    }
    const holds = emptyCargoHolds(room, player);
    if (!holds.length) {
      player.savedEventCards ||= [];
      player.savedEventCards.push({ id: crypto.randomUUID(), kind: 'treasure-cargo', name: treasure.name, goodId: treasure.cargoGoodId, sourceDeck: 'treasure', sourceCard: { ...treasure } });
      log(room, `${player.name}: «${card.name}» → «${treasure.name}». Пустого трюма нет; карта сокровища сохранена в закрытой руке.`);
      return resultBase;
    }
    if (holds.length === 1) {
      const loaded = fillCargoDirect(room, player, treasure.cargoGoodId, holds[0].id);
      discardDeckCard(room.treasureDeck, treasure);
      trackAssignment(room, player, { type: 'treasure-resolved' });
      log(room, `${player.name}: «${card.name}» → «${treasure.name}». ${loaded.holdName} заполнен рудой ×${loaded.quantity}.`);
      return resultBase;
    }
    queueEventDecision(room, player, card, 'cargo', holds, { goodId: treasure.cargoGoodId, treasureCard: { ...treasure } });
    log(room, `${player.name}: «${card.name}» → «${treasure.name}». Нужно выбрать один пустой трюм.`);
    return { pending: true, holdEventCard: false };
  }

  if (card.type === 'legendary') {
    const legendary = drawLegendaryCard(room);
    if (legendary) {
      player.legendaryCards ||= [];
      player.legendaryCards.push(legendary);
      log(room, `${player.name}: «${card.name}». Получена одна случайная легендарная карта в закрытую руку.`);
    } else log(room, `${player.name}: «${card.name}», но легендарная колода пуста.`);
    return resultBase;
  }

  if (card.type === 'found-cargo') {
    const holds = emptyCargoHolds(room, player);
    const goodName = GOODS[card.goodId]?.name || card.goodId;
    if (!holds.length) {
      saveHeldEventCard(player, card, 'found-cargo', { goodId: card.goodId });
      log(room, `${player.name}: «${card.name}». Пустого трюма нет; карта сохранена в закрытой руке.`);
      return { pending: false, holdEventCard: true };
    }
    if (holds.length === 1) {
      const loaded = fillCargoDirect(room, player, card.goodId, holds[0].id);
      log(room, `${player.name}: «${card.name}». ${loaded.holdName} заполнен товаром «${goodName}» ×${loaded.quantity}.`);
      return resultBase;
    }
    queueEventDecision(room, player, card, 'cargo', holds, { goodId: card.goodId });
    log(room, `${player.name}: «${card.name}». Нужно выбрать один пустой трюм.`);
    return { pending: true, holdEventCard: false };
  }

  if (card.type === 'save-card') {
    saveHeldEventCard(player, card, card.savedKind);
    log(room, `${player.name}: «${card.name}». Карта сохранена в закрытой руке для позднего применения.`);
    return { pending: false, holdEventCard: true };
  }

  if (card.type === 'special-card') {
    player.specialCards ||= [];
    player.specialCards.push(card.cardName);
    log(room, `${player.name}: «${card.name}». Получена одноразовая карта «${card.cardName}».`);
    return resultBase;
  }

  if (card.type === 'next-turn') {
    applyNextTurnEffect(player, card.effect, card.value);
    const descriptions = {
      moveBonus: `к обычной навигации +${card.value}`,
      movePenalty: `к обычной навигации −${card.value}`,
      bestOfTwo: 'при навигации два d6, используется лучший',
      noNavigation: 'обычная навигация запрещена',
      noIncome: 'доход рынков и банков не начисляется',
    };
    log(room, `${player.name}: «${card.name}». В ближайший личный ход: ${descriptions[card.effect] || 'временный эффект'}.`);
    return resultBase;
  }

  if (card.type === 'raid') {
    const options = raidBuildingOptions(room, player);
    if (!options.length) {
      log(room, `${player.name}: «${card.name}». Построек выше I уровня нет — карта ничего не делает.`);
      return resultBase;
    }
    queueEventDecision(room, player, card, 'raid', options);
    log(room, `${player.name}: «${card.name}». Нужно выбрать одну свою постройку выше I уровня для понижения.`);
    return { pending: true, holdEventCard: false };
  }

  if (card.type === 'boarding') {
    const options = boardingUpgradeOptions(player);
    if (!options.length) {
      log(room, `${player.name}: «${card.name}». Установленных улучшений нет — карта ничего не делает.`);
      return resultBase;
    }
    queueEventDecision(room, player, card, 'boarding', options);
    log(room, `${player.name}: «${card.name}». Нужно снять одно установленное улучшение корабля.`);
    return { pending: true, holdEventCard: false };
  }

  if (card.type === 'storm') {
    const island = room.islands.find(i => i.id === card.islandId);
    const options = stormCellOptions(room, player, card.islandId);
    if (!options.length) {
      log(room, `${player.name}: «${card.name}». Для класса корабля нет допустимой клетки назначения.`);
      return resultBase;
    }
    if (options.length === 1) {
      player.row = options[0].row; player.col = options[0].col;
      handleArrival(room, player);
      log(room, `${player.name}: «${card.name}». Флотилия немедленно перенесена к берегу ${island?.name || 'острова'}.`);
      return resultBase;
    }
    queueEventDecision(room, player, card, 'storm', options, { islandId: card.islandId });
    log(room, `${player.name}: «${card.name}». Нужно выбрать допустимую клетку берега ${island?.name || 'острова'}.`);
    return { pending: true, holdEventCard: false };
  }

  if (card.type === 'treasury-loss') {
    const before = Math.max(0, Math.floor(Number(player.ducats) || 0));
    const loss = Math.floor(before * (Number(card.percent) || 0) / 100);
    player.ducats = before - loss;
    log(room, `${player.name}: «${card.name}». Потеряно ${loss} дукатов (30% казны).`);
    return resultBase;
  }

  log(room, `${player.name}: «${card.name}». Эффект карты пока не распознан.`);
  return resultBase;
}


function eventPoliticalSnapshot(room) {
  const snapshot = {};
  for (const player of room.players || []) {
    snapshot[player.id] = {
      suzerainId: player.suzerainId || null,
      enemyFactionIds: [...(player.enemyFactionIds || [])],
      hadAssignment: Boolean(player.activeAssignment),
    };
  }
  return snapshot;
}

function applyVassalTaxes(room, snapshot) {
  for (const playerId of room.order || []) {
    const player = playerById(room, playerId);
    const suzerainId = snapshot?.[playerId]?.suzerainId;
    const tax = Math.max(0, Number(FACTIONS[suzerainId]?.tax) || 0);
    if (!player || !tax) continue;
    const before = Math.max(0, Math.floor(Number(player.ducats) || 0));
    const paid = Math.min(before, tax);
    player.ducats = before - paid;
    if (paid < tax) {
      player.nextActionLimit = Math.min(Number(player.nextActionLimit) || 3, 2);
      log(room, `${player.name}: налог ${FACTIONS[suzerainId].name} — уплачено ${paid} из ${tax}. Долг не возникает; в ближайшем личном ходу максимум два действия.`);
    } else {
      log(room, `${player.name} платит налог ${FACTIONS[suzerainId].name}: ${tax} дуката.`);
    }
  }
}

function buildFeudQueue(room, snapshot) {
  const queue = [];
  for (const playerId of room.order || []) {
    for (const factionId of POLITICAL_FACTION_ORDER) {
      if ((snapshot?.[playerId]?.enemyFactionIds || []).includes(factionId)) queue.push({ playerId, factionId });
    }
  }
  return queue;
}

function queueFeudDecision(room, player, factionId, card, kind, options, extra = {}) {
  room.pendingFeud = {
    id: crypto.randomUUID(), playerId: player.id, factionId, cardName: card.name, kind,
    options: (options || []).map(o => ({ ...o })), feudCard: { ...card }, ...extra,
  };
  room.eventPhase.currentPlayerId = player.id;
  room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: card.name, factionId, factionName: FACTIONS[factionId]?.name, pending: true, source: 'feud' };
}

function removeCargoByHold(player, holdId) {
  if (holdId === 'main') {
    if (!player.cargo) return null;
    const cargo = player.cargo; player.cargo = null; return cargo;
  }
  const escort = (player.escorts || []).find(e => e.id === holdId);
  if (!escort?.cargo) return null;
  const cargo = escort.cargo; escort.cargo = null; return cargo;
}

function resolveFeudCard(room, player, factionId, card) {
  const factionName = FACTIONS[factionId]?.name || factionId;
  const immediate = { pending: false };
  if (!card) return immediate;

  if (card.type === 'none') {
    log(room, `${player.name}: карта вражды ${factionName} — «${card.name}». Эффекта нет.`);
    return immediate;
  }
  if (card.type === 'treasury-percent') {
    const before = Math.max(0, Math.floor(Number(player.ducats) || 0));
    const loss = Math.floor(before * (Number(card.percent) || 0) / 100);
    player.ducats = before - loss;
    log(room, `${player.name}: карта вражды ${factionName} — потеря ${loss} дукатов (${card.percent}% казны).`);
    return immediate;
  }
  if (card.type === 'treasury-flat') {
    const before = Math.max(0, Math.floor(Number(player.ducats) || 0));
    const loss = Math.min(before, Math.max(0, Number(card.amount) || 0));
    player.ducats = before - loss;
    log(room, `${player.name}: карта вражды ${factionName} — потеря ${loss} дукатов.`);
    return immediate;
  }
  if (card.type === 'skip-income') {
    applyNextTurnEffect(player, 'noIncome', true);
    log(room, `${player.name}: карта вражды ${factionName} — в ближайшем личном ходу доход рынков и банков пропускается.`);
    return immediate;
  }
  if (card.type === 'ship-level-loss') {
    const loss = loseShipLevel(room, player);
    log(room, `${player.name}: карта вражды ${factionName} — ${describeLevelLoss(room, { playerId: player.id, ...loss })}.`);
    return immediate;
  }
  if (card.type === 'discard-random-held') {
    const result = discardRandomHeldCard(room, player);
    log(room, result.discarded ? `${player.name}: карта вражды ${factionName} — случайно сброшена удерживаемая карта «${result.discarded.name}».` : `${player.name}: карта вражды ${factionName} — удерживаемых карт нет.`);
    return immediate;
  }
  if (card.type === 'reclaim-island') {
    const originalIds = new Set(FACTIONS[factionId]?.originalIslandIds || []);
    const options = room.islands.filter(i => i.ownerId === player.id && originalIds.has(i.id)).map(i => ({ islandId: i.id, name: i.name }));
    if (!options.length) {
      const loss = Math.min(Math.max(0, Number(player.ducats) || 0), 4);
      player.ducats -= loss;
      log(room, `${player.name}: ${factionName} не может вернуть исходный остров; вместо этого потеряно ${loss} дукатов.`);
      return immediate;
    }
    if (options.length === 1) {
      const island = room.islands.find(i => i.id === options[0].islandId);
      island.ownerId = null;
      refreshFactionExistence(room);
      log(room, `${player.name}: ${factionName} возвращает себе ${island.name} вместе с постройками.`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'reclaim-island', options);
    log(room, `${player.name}: ${factionName} возвращает один исходный остров. Нужно выбрать остров.`);
    return { pending: true };
  }
  if (card.type === 'building-downgrade') {
    const options = politicalBuildingOptions(room, player, { aboveLevelOne: true });
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — зданий выше I уровня нет.`); return immediate; }
    if (options.length === 1) {
      const result = applyRaidDowngrade(room, player, options[0].islandId, options[0].buildingIndex);
      log(room, `${player.name}: ${result.beforeName} на ${result.island.name} понижено до ${result.afterName}.`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'building-downgrade', options);
    return { pending: true };
  }
  if (card.type === 'building-choice') {
    const options = politicalBuildingOptions(room, player);
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — построек нет.`); return immediate; }
    queueFeudDecision(room, player, factionId, card, 'building-choice', options);
    return { pending: true };
  }
  if (card.type === 'remove-forts') {
    const options = politicalBuildingOptions(room, player, { fortsOnly: true });
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — фортов и крепостей нет.`); return immediate; }
    const count = Math.min(Math.max(1, Number(card.count) || 1), options.length);
    if (options.length <= count) {
      const names = [];
      for (const option of [...options].sort((a,b) => b.buildingIndex - a.buildingIndex)) {
        const result = removePlayerBuilding(room, player, option.islandId, option.buildingIndex);
        if (result.ok) names.push(`${result.name} (${result.island.name})`);
      }
      log(room, `${player.name}: карта вражды ${factionName} удаляет ${names.join(', ')}.`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'remove-forts', options, { remaining: count });
    return { pending: true };
  }
  if (card.type === 'remove-upgrade') {
    const options = politicalUpgradeOptions(player, card.branch || null);
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — подходящих улучшений нет.`); return immediate; }
    if (options.length === 1) {
      const result = applyBoardingLoss(player, options[0].id);
      log(room, `${player.name}: карта вражды ${factionName} снимает улучшение «${result.name}».`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'remove-upgrade', options);
    return { pending: true };
  }
  if (card.type === 'remove-cargo') {
    const options = politicalCargoOptions(room, player);
    if (!options.length) { log(room, `${player.name}: карта вражды ${factionName} — груза нет.`); return immediate; }
    if (options.length === 1) {
      const cargo = removeCargoByHold(player, options[0].id);
      log(room, `${player.name}: карта вражды ${factionName} уничтожает груз ${GOODS[cargo.goodId]?.name || cargo.goodId} ×${cargo.quantity}.`);
      return immediate;
    }
    queueFeudDecision(room, player, factionId, card, 'remove-cargo', options);
    return { pending: true };
  }
  log(room, `${player.name}: карта вражды ${factionName} «${card.name}» не потребовала эффекта.`);
  return immediate;
}

function processEventPhase(room) {
  if (!room.eventPhase?.active || room.pendingEvent || room.pendingFeud || room.pendingAssignmentChoice || room.pendingIslandCorrection || room.pendingFleetAdjustment) return;
  if (queueEscortCapacityDecisionsIfNeeded(room)) return;
  let safety = 0;
  while (room.eventPhase.active && !room.pendingEvent && !room.pendingFeud && !room.pendingAssignmentChoice && !room.pendingIslandCorrection && !room.pendingFleetAdjustment && safety++ < 160) {
    if (room.eventPhase.stage === 'sailing') {
      const index = Number(room.eventPhase.playerIndex) || 0;
      if (index >= room.order.length) {
        room.eventPhase.stage = 'feud';
        room.eventPhase.feudIndex = 0;
        room.eventPhase.currentPlayerId = room.eventPhase.feudQueue?.[0]?.playerId || null;
        log(room, 'Фаза событий: карты плавания разрешены. Начинается выдача карт вражды по статусам, зафиксированным в начале фазы.');
        continue;
      }
      const playerId = room.order[index];
      const player = playerById(room, playerId);
      room.eventPhase.currentPlayerId = playerId;
      if (!player) { room.eventPhase.playerIndex += 1; continue; }
      const card = drawSailingEventCard(room);
      if (!card) { log(room, `Фаза событий: для ${player.name} не удалось взять карту события.`); room.eventPhase.playerIndex += 1; continue; }
      room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: card.name, pending: false, source: 'sailing' };
      log(room, `Фаза событий: ${player.name} открывает «${card.name}».`);
      const resolved = resolveSailingEventCard(room, player, card);
      if (resolved.pending) return;
      if (!resolved.holdEventCard) discardDeckCard(room.eventDeck, card);
      room.eventPhase.playerIndex += 1;
      continue;
    }

    if (room.eventPhase.stage === 'feud') {
      const index = Number(room.eventPhase.feudIndex) || 0;
      const queue = room.eventPhase.feudQueue || [];
      if (index >= queue.length) {
        room.eventPhase.stage = 'assignment';
        room.eventPhase.assignmentIndex = 0;
        room.eventPhase.currentPlayerId = room.eventPhase.assignmentQueue?.[0]?.playerId || null;
        log(room, 'Фаза событий: карты вражды разрешены. Начинается выдача поручений сюзерена.');
        continue;
      }
      const item = queue[index];
      const player = playerById(room, item.playerId);
      room.eventPhase.currentPlayerId = item.playerId;
      if (!player || !stateExists(room, item.factionId)) { room.eventPhase.feudIndex += 1; continue; }
      const card = drawFeudCard(room, item.factionId);
      if (!card) { room.eventPhase.feudIndex += 1; continue; }
      room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: card.name, factionId: item.factionId, factionName: FACTIONS[item.factionId]?.name, pending: false, source: 'feud' };
      log(room, `Фаза событий: ${player.name} получает карту вражды от ${FACTIONS[item.factionId]?.name}: «${card.name}».`);
      const resolved = resolveFeudCard(room, player, item.factionId, card);
      if (resolved.pending) return;
      discardDeckCard(room.feudDecks[item.factionId], card);
      room.eventPhase.feudIndex += 1;
      if (queueFleetAdjustment(room, player, `Карта вражды ${FACTIONS[item.factionId]?.name || item.factionId}: «${card.name}».`)) return;
      if (queueIslandCorrectionIfNeeded(room, null, `карта вражды ${FACTIONS[item.factionId]?.name || item.factionId}: «${card.name}»`)) return;
      continue;
    }

    if (room.eventPhase.stage === 'assignment') {
      const index = Number(room.eventPhase.assignmentIndex) || 0;
      const queue = room.eventPhase.assignmentQueue || [];
      if (index >= queue.length) {
        room.eventPhase.stage = 'assignment-replace';
        room.eventPhase.replacementQueue = buildAssignmentReplaceQueue(room);
        room.eventPhase.replacementIndex = 0;
        room.eventPhase.currentPlayerId = room.eventPhase.replacementQueue?.[0] || null;
        log(room, 'Фаза событий: выдача поручений завершена. Вассалы могут по одному разу заменить активное поручение за 2 дуката.');
        continue;
      }
      const item = queue[index];
      const player = playerById(room, item.playerId);
      room.eventPhase.currentPlayerId = item.playerId;
      room.eventPhase.assignmentIndex += 1;
      if (!player || player.suzerainId !== item.factionId || player.activeAssignment || !stateExists(room, item.factionId)) continue;
      const issued = issueAssignment(room, player, item.factionId);
      if (!issued.ok) {
        log(room, `${player.name}: у ${FACTIONS[item.factionId]?.name || item.factionId} сейчас нет подходящего поручения.`);
        continue;
      }
      room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: issued.assignment.card.text, factionId: item.factionId, factionName: FACTIONS[item.factionId]?.name, pending: false, source: 'assignment' };
      log(room, `${player.name} получает поручение ${FACTIONS[item.factionId]?.name}: «${issued.assignment.card.text}». Награда ${issued.assignment.card.reward} дукатов.`);
      continue;
    }

    if (room.eventPhase.stage === 'assignment-replace') {
      const index = Number(room.eventPhase.replacementIndex) || 0;
      const queue = room.eventPhase.replacementQueue || [];
      if (index >= queue.length) { finishEventPhase(room); return; }
      const playerId = queue[index];
      const player = playerById(room, playerId);
      room.eventPhase.currentPlayerId = playerId;
      if (!player?.suzerainId || !player.activeAssignment || !player.connected) { room.eventPhase.replacementIndex += 1; continue; }
      const allowed = canReplaceAssignment(player);
      if (!allowed.ok) { room.eventPhase.replacementIndex += 1; continue; }
      room.pendingAssignmentChoice = {
        id: crypto.randomUUID(), playerId: player.id, factionId: player.suzerainId,
        assignment: player.activeAssignment, canReplace: true, replaceError: null,
      };
      room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: player.activeAssignment.card.text, factionId: player.suzerainId, factionName: FACTIONS[player.suzerainId]?.name, pending: true, source: 'assignment-replace' };
      return;
    }

    finishEventPhase(room);
  }
}

function startEventPhase(room) {
  room.phase = 'event';
  room.roll = null;
  room.movePoints = null;
  room.actionsLeft = 0;
  room.pendingAlliance = null;
  room.pendingBattle = null;
  room.pendingEvent = null;
  room.pendingFeud = null;
  room.pendingAssignmentChoice = null;
  room.pendingFleetAdjustment = null;
  room.fleetAdjustmentQueue = [];
  room.pendingLegendaryReaction = null;
  const snapshot = eventPoliticalSnapshot(room);
  room.eventPhase = {
    active: true, stage: 'sailing', playerIndex: 0, currentPlayerId: room.order[0] || null, lastCard: null,
    politicalSnapshot: snapshot,
    feudQueue: buildFeudQueue(room, snapshot), feudIndex: 0,
    assignmentQueue: buildAssignmentQueue(room, snapshot), assignmentIndex: 0,
    replacementQueue: [], replacementIndex: 0,
  };
  log(room, `Раунд ${room.round}: начинается общая Фаза событий. Политические статусы, активные поручения и вражда зафиксированы.`);
  applyVassalTaxes(room, snapshot);
  processEventPhase(room);
}

function finishEventPhase(room) {
  if (room.eventPhase) room.eventPhase.active = false;
  room.pendingEvent = null;
  room.pendingFeud = null;
  room.pendingAssignmentChoice = null;
  room.round += 1;
  room.circle = 1;
  for (const island of room.islands) island.loadedRound = null;
  for (const player of room.players) player.visitedAnchors = [];
  refreshFactionExistence(room);
  log(room, `Фаза событий завершена. Начинается раунд ${room.round}: ограничения погрузки и отметки посещённых якорей сброшены.`);
  beginTurn(room);
}

function finishPendingFeudCard(room, pending) {
  discardDeckCard(room.feudDecks[pending.factionId], pending.feudCard);
  room.eventPhase.lastCard = { playerId: pending.playerId, playerName: playerById(room, pending.playerId)?.name || 'Игрок', cardName: pending.cardName, factionId: pending.factionId, factionName: FACTIONS[pending.factionId]?.name, pending: false, source: 'feud' };
  room.pendingFeud = null;
  room.eventPhase.feudIndex += 1;
  if (!queueIslandCorrectionIfNeeded(room, null, `карта вражды ${FACTIONS[pending.factionId]?.name || pending.factionId}: «${pending.cardName}»`)) processEventPhase(room);
}

function completePendingFeud(room, pending, choice) {
  const player = playerById(room, pending.playerId);
  if (!player) return { ok: false, error: 'Игрок карты вражды не найден.' };
  const factionName = FACTIONS[pending.factionId]?.name || pending.factionId;
  if (pending.kind === 'reclaim-island') {
    const island = room.islands.find(i => i.id === choice?.islandId && i.ownerId === player.id && (FACTIONS[pending.factionId]?.originalIslandIds || []).includes(i.id));
    if (!island) return { ok: false, error: 'Недопустимый остров.' };
    island.ownerId = null; refreshFactionExistence(room);
    log(room, `${player.name}: ${factionName} возвращает себе ${island.name} вместе с постройками.`);
  } else if (pending.kind === 'building-downgrade') {
    const result = applyRaidDowngrade(room, player, choice?.islandId, choice?.buildingIndex);
    if (!result.ok) return result;
    log(room, `${player.name}: ${result.beforeName} на ${result.island.name} понижено до ${result.afterName}.`);
  } else if (pending.kind === 'building-choice') {
    const mode = String(choice?.mode || '');
    if (mode === 'delete') {
      const result = removePlayerBuilding(room, player, choice?.islandId, choice?.buildingIndex);
      if (!result.ok) return result;
      log(room, `${player.name}: карта вражды ${factionName} удаляет ${result.name} на ${result.island.name}.`);
    } else if (mode === 'downgrade') {
      const result = applyRaidDowngrade(room, player, choice?.islandId, choice?.buildingIndex);
      if (!result.ok) return result;
      log(room, `${player.name}: карта вражды ${factionName} понижает ${result.beforeName} на ${result.island.name} до ${result.afterName}.`);
    } else return { ok: false, error: 'Выберите удаление или понижение.' };
  } else if (pending.kind === 'remove-forts') {
    const option = (pending.options || []).find(o => o.islandId === choice?.islandId && o.buildingIndex === Number(choice?.buildingIndex));
    if (!option) return { ok: false, error: 'Недопустимое укрепление.' };
    const result = removePlayerBuilding(room, player, option.islandId, option.buildingIndex);
    if (!result.ok) return result;
    log(room, `${player.name}: карта вражды ${factionName} удаляет ${result.name} на ${result.island.name}.`);
    const remaining = Math.max(0, (Number(pending.remaining) || 1) - 1);
    const options = politicalBuildingOptions(room, player, { fortsOnly: true });
    if (remaining > 0 && options.length) {
      pending.remaining = Math.min(remaining, options.length);
      pending.options = options;
      return { ok: true, pending: true };
    }
  } else if (pending.kind === 'remove-upgrade') {
    const result = applyBoardingLoss(player, choice?.upgradeId);
    if (!result.ok) return result;
    log(room, `${player.name}: карта вражды ${factionName} снимает улучшение «${result.name}».`);
  } else if (pending.kind === 'remove-cargo') {
    const option = (pending.options || []).find(o => o.id === choice?.holdId);
    if (!option) return { ok: false, error: 'Недопустимый трюм.' };
    const cargo = removeCargoByHold(player, option.id);
    if (!cargo) return { ok: false, error: 'В выбранном трюме уже нет груза.' };
    log(room, `${player.name}: карта вражды ${factionName} уничтожает груз ${GOODS[cargo.goodId]?.name || cargo.goodId} ×${cargo.quantity}.`);
  } else return { ok: false, error: 'Неизвестное решение карты вражды.' };

  finishPendingFeudCard(room, pending);
  return { ok: true };
}


function finishPendingEvent(room, pending) {
  const origin = pending.origin || 'event-phase';
  if (origin === 'event-phase') {
    if (pending.eventCard) discardDeckCard(room.eventDeck, pending.eventCard);
    room.pendingEvent = null;
    if (room.eventPhase?.active) {
      room.eventPhase.lastCard = { playerId: pending.playerId, playerName: playerById(room, pending.playerId)?.name || 'Игрок', cardName: pending.cardName, pending: false, source: 'sailing' };
      room.eventPhase.playerIndex += 1;
      if (!queueIslandCorrectionIfNeeded(room, null, `событие плавания «${pending.cardName}»`)) processEventPhase(room);
    }
  } else {
    room.pendingEvent = null;
  }
}

function completePendingEvent(room, pending) {
  const player = playerById(room, pending.playerId);
  if (!player) return { ok: false, error: 'Игрок карты события не найден.' };
  const choice = pending.choice || {};
  if (pending.kind === 'cargo') {
    const result = fillCargoDirect(room, player, pending.goodId, choice.holdId);
    if (!result.ok) return result;
    if (pending.treasureCard) {
      discardDeckCard(room.treasureDeck, pending.treasureCard);
      trackAssignment(room, player, { type: 'treasure-resolved' });
    }
    log(room, `${player.name}: «${pending.cardName}». ${result.holdName} заполнен товаром «${result.good.name}» ×${result.quantity}.`);
  } else if (pending.kind === 'raid') {
    const result = applyRaidDowngrade(room, player, choice.islandId, choice.buildingIndex);
    if (!result.ok) return result;
    log(room, `${player.name}: «${pending.cardName}». ${result.beforeName} на ${result.island.name} понижено до ${result.afterName}.`);
  } else if (pending.kind === 'boarding') {
    const result = applyBoardingLoss(player, choice.upgradeId);
    if (!result.ok) return result;
    log(room, `${player.name}: «${pending.cardName}». Снято улучшение «${result.name}».`);
  } else if (pending.kind === 'storm') {
    const option = (pending.options || []).find(o => o.row === choice.row && o.col === choice.col);
    if (!option) return { ok: false, error: 'Недопустимая клетка шторма.' };
    player.row = option.row; player.col = option.col;
    handleArrival(room, player);
    const island = room.islands.find(i => i.id === pending.islandId);
    log(room, `${player.name}: «${pending.cardName}». Флотилия немедленно перенесена к берегу ${island?.name || 'острова'}.`);
  } else return { ok: false, error: 'Неизвестный тип решения события.' };
  finishPendingEvent(room, pending);
  return { ok: true };
}

function discardSavedCardToDeck(room, saved) {
  if (!saved?.sourceCard) return;
  if (saved.sourceDeck === 'treasure') discardDeckCard(room.treasureDeck, saved.sourceCard);
  else discardDeckCard(room.eventDeck, saved.sourceCard);
}

function takeSavedCard(player, savedCardId) {
  const index = (player.savedEventCards || []).findIndex(c => c.id === savedCardId);
  if (index < 0) return null;
  return { card: player.savedEventCards[index], index };
}

function determineOrder(room) {
  const unresolved = new Set(room.players.map(p => p.id));
  const scores = new Map();
  let safety = 0;
  while (unresolved.size && safety++ < 100) {
    const groups = new Map();
    for (const id of unresolved) {
      const r = rollD6();
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(id);
    }
    unresolved.clear();
    for (const [r, ids] of groups.entries()) {
      if (ids.length === 1) scores.set(ids[0], (scores.get(ids[0]) || 0) * 10 + r);
      else {
        for (const id of ids) {
          scores.set(id, (scores.get(id) || 0) * 10 + r);
          unresolved.add(id);
        }
      }
    }
  }
  return [...room.players]
    .sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0))
    .map(p => p.id);
}

function beginTurn(room) {
  room.phase = 'navigation';
  room.roll = null;
  room.movePoints = null;
  room.actionsLeft = 3;
  const p = currentPlayer(room);
  if (!p) return;

  p.personalTurnNo = (Number(p.personalTurnNo) || 0) + 1;
  p.attackedThisTurn = [];
  p.brokenAlliesThisTurn = [];
  const actionLimit = Math.max(0, Math.min(3, Number(p.nextActionLimit) || 3));
  room.actionsLeft = actionLimit;
  p.nextActionLimit = null;
  p.activeTurnEffects = { ...(p.nextTurnEffects || {}) };
  p.nextTurnEffects = {};
  if (actionLimit < 3) log(room, `${p.name}: из-за недоплаченного налога в этом личном ходу доступно максимум ${actionLimit} действия.`);

  if ((Number(p.skipTurns) || 0) > 0) {
    p.skipTurns -= 1;
    log(room, `${p.name} пропускает личный ход из-за ничьей в бою.`);
    endTurnInternal(room);
    return;
  }

  const noIncome = Boolean(p.activeTurnEffects?.noIncome);
  const income = marketIncomeForPlayer(room, p.id);
  if (noIncome) {
    log(room, `${p.name}: действует «Голод» — доход рынков и банков в этом личном ходу не начисляется.`);
  } else if (income > 0) {
    const credit = creditDucats(p, income);
    const debtText = credit.debtPaid ? ` (${credit.debtPaid} в погашение долга, ${credit.net} в казну)` : '';
    log(room, `${p.name} получает ${income} дукатов дохода от рынков и банков${debtText}.`);
  }

  if (p.activeTurnEffects?.noNavigation) {
    room.phase = 'actions';
    room.movePoints = 0;
    log(room, `Ход: ${p.name}. Из-за «Поломки» обычная навигация недоступна; сразу начинается фаза действий.`);
    return;
  }

  const effects = [];
  if (p.activeTurnEffects?.moveBonus) effects.push(`попутный ветер +${p.activeTurnEffects.moveBonus}`);
  if (p.activeTurnEffects?.movePenalty) effects.push(`штиль −${p.activeTurnEffects.movePenalty}`);
  if (p.activeTurnEffects?.bestOfTwo) effects.push('Удача Фортуны: два d6');
  log(room, `Ход: ${p.name}. Навигация.${effects.length ? ` Эффекты: ${effects.join(', ')}.` : ''}`);
}

function endTurnInternal(room) {
  const n = room.order.length;
  if (!n) return;
  const ending = currentPlayer(room);
  if (ending) {
    ending.activeTurnEffects = {};
    const tick = tickLegendaryEffectsForPlayer(room, ending);
    for (const expired of tick.expired || []) log(room, `${ending.name}: заканчивается эффект «${expired}».`);
  }
  room.completedTurns += 1;
  room.turnIndex = (room.turnIndex + 1) % n;
  if (room.completedTurns % n === 0) {
    room.circle += 1;
    if (room.circle > 5) {
      startEventPhase(room);
      return;
    }
  }
  beginTurn(room);
}

function applyFreeClaimReward(room, player, island) {
  if (island.rewardClaimed) return;
  if (island.id === 'chertog') {
    player.specialCards ||= [];
    player.specialCards.push('Путь сквозь туман');
    island.rewardClaimed = true;
    log(room, `${player.name} получает одноразовую карту «Путь сквозь туман» за Чертог.`);
  } else if (island.id === 'kisalinia') {
    island.buildings.push({ type: 'fort', level: 1, createdAt: Date.now(), reward: true });
    island.rewardClaimed = true;
    log(room, `${player.name} получает Форт I на Кисалинии.`);
  }
}


function handleLegendaryPlaceStop(room, player) {
  const place = legendaryPlaceAt(player.row, player.col);
  if (!place) return null;
  trackAssignment(room, player, { type: 'visit-place', placeId: place.id });
  room.legendaryPlacesExplored ||= {};
  if (room.legendaryPlacesExplored[place.id]) return { place, first: false };
  room.legendaryPlacesExplored[place.id] = player.id;
  log(room, `${player.name} первым исследует легендарное место «${place.name}».`);

  if (place.reward === 'legendary') {
    const card = drawLegendaryCard(room);
    if (card) {
      player.legendaryCards ||= [];
      player.legendaryCards.push(card);
      log(room, `${player.name}: награда «${place.name}» — случайная легендарная карта.`);
    }
  } else if (place.reward === 'treasure') {
    const treasure = drawTreasureCard(room);
    if (!treasure) return { place, first: true };
    if (treasure.multiplier) {
      const result = resolveMoneyTreasure(room, player, treasure);
      discardDeckCard(room.treasureDeck, treasure);
      trackAssignment(room, player, { type: 'treasure-resolved' });
      log(room, `${player.name}: награда «${place.name}» — сокровище «${treasure.name}», получено ${result.amount} дукатов.`);
    } else {
      const holds = emptyCargoHolds(room, player);
      if (!holds.length) {
        player.savedEventCards ||= [];
        player.savedEventCards.push({ id: crypto.randomUUID(), kind: 'treasure-cargo', name: treasure.name, goodId: treasure.cargoGoodId, sourceDeck: 'treasure', sourceCard: { ...treasure } });
        log(room, `${player.name}: награда «${place.name}» — «${treasure.name}». Пустого трюма нет; карта сохранена.`);
      } else if (holds.length === 1) {
        const loaded = fillCargoDirect(room, player, treasure.cargoGoodId, holds[0].id);
        discardDeckCard(room.treasureDeck, treasure);
        trackAssignment(room, player, { type: 'treasure-resolved' });
        log(room, `${player.name}: награда «${place.name}» — «${treasure.name}». ${loaded.holdName} заполнен рудой ×${loaded.quantity}.`);
      } else {
        room.pendingEvent = {
          id: crypto.randomUUID(), playerId: player.id, kind: 'cargo', cardName: `${place.name}: ${treasure.name}`,
          options: holds.map(o => ({ ...o })), goodId: treasure.cargoGoodId, treasureCard: { ...treasure }, origin: 'legendary-place',
        };
        log(room, `${player.name}: награда «${place.name}» — «${treasure.name}». Нужно выбрать пустой трюм.`);
      }
    }
  }
  return { place, first: true };
}

function handleArrival(room, player) {
  const claims = claimFreeIslandsAt(room, player);
  for (const island of claims) {
    log(room, `${player.name} открывает свободный остров ${island.name} и становится его владельцем.`);
    applyFreeClaimReward(room, player, island);
  }
  handleLegendaryPlaceStop(room, player);
}

function attachPlayer(socket, room, player) {
  player.socketId = socket.id;
  player.connected = true;
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  socket.join(room.code);
}

function newPlayer(socket, data, color) {
  const shipClass = SHIPS[data?.shipClass] ? data.shipClass : 'brigantine';
  return {
    id: crypto.randomUUID(),
    token: token(),
    socketId: socket.id,
    connected: true,
    name: cleanName(data?.name),
    color,
    shipClass,
    ducats: 14,
    debt: 0,
    level: 1,
    row: 0,
    col: 0,
    specialCards: [],
    cargo: null,
    upgrades: [],
    disabledUpgradeIds: [],
    escorts: [],
    levelInactiveEscortIds: [],
    nextEscortId: 0,
    landCompany: null,
    bastionPriority: [],
    glory: 0,
    skipTurns: 0,
    personalTurnNo: 0,
    attackedThisTurn: [],
    attackHistory: {},
    brokenAlliesThisTurn: [],
    pendingLegendary: 0,
    pendingLandinEscort: false,
    legendaryCards: [],
    legendaryEffects: { seaCurses: [] },
    savedEventCards: [],
    nextTurnEffects: {},
    activeTurnEffects: {},
    visitedAnchors: [],
    lastAnchorEncounter: null,
    suzerainId: null,
    vassalGiftIslandId: null,
    enemyFactionIds: [],
    nextActionLimit: null,
    activeAssignment: null,
    replacedAssignmentConditions: [],
  };
}

io.on('connection', socket => {
  socket.on('createRoom', (data, ack) => {
    const code = makeCode();
    const player = newPlayer(socket, data, COLORS[0]);
    const room = {
      code,
      hostId: player.id,
      players: [player],
      islands: cloneIslands(),
      started: false,
      order: [],
      turnIndex: 0,
      completedTurns: 0,
      round: 1,
      circle: 1,
      phase: 'lobby',
      roll: null,
      movePoints: null,
      actionsLeft: 3,
      alliances: [],
      pendingAlliance: null,
      pendingBattle: null,
      pendingEvent: null,
      pendingFeud: null,
      pendingAssignmentChoice: null,
      pendingStatePrize: null,
      pendingIslandCorrection: null,
      pendingFleetAdjustment: null,
      fleetAdjustmentQueue: [],
      pendingLegendaryReaction: null,
      eventPhase: null,
      anchorDecks: createAnchorDecks(),
      eventDeck: createSailingEventDeck(),
      treasureDeck: createTreasureDeck(),
      legendaryDeck: createLegendaryDeck(),
      feudDecks: createFeudDecks(),
      assignmentDecks: createAssignmentDecks(),
      legendaryPlacesExplored: {},
      factionState: {},
      log: [],
    };
    refreshFactionExistence(room);
    rooms.set(code, room);
    attachPlayer(socket, room, player);
    log(room, `${player.name} создал комнату ${code}.`);
    ackSafe(ack, { ok: true, code, playerId: player.id, playerToken: player.token });
    emitRoom(room);
  });

  socket.on('joinRoom', (data, ack) => {
    const room = getRoom(data?.code);
    if (!room) return ackSafe(ack, { ok: false, error: 'Комната не найдена.' });

    const resumeToken = String(data?.playerToken || '');
    const existing = room.players.find(p => p.token === resumeToken);
    if (existing) {
      attachPlayer(socket, room, existing);
      log(room, `${existing.name} вернулся в игру.`);
      ackSafe(ack, { ok: true, code: room.code, playerId: existing.id, playerToken: existing.token, resumed: true });
      emitRoom(room);
      return;
    }

    if (room.started) return ackSafe(ack, { ok: false, error: 'Партия уже началась.' });
    if (room.players.length >= 5) return ackSafe(ack, { ok: false, error: 'В комнате уже 5 игроков.' });

    const player = newPlayer(socket, data, COLORS[room.players.length]);
    room.players.push(player);
    attachPlayer(socket, room, player);
    log(room, `${player.name} присоединился.`);
    ackSafe(ack, { ok: true, code: room.code, playerId: player.id, playerToken: player.token });
    emitRoom(room);
  });

  socket.on('resumeRoom', (data, ack) => {
    const room = getRoom(data?.code);
    if (!room) return ackSafe(ack, { ok: false, error: 'Комната больше не существует.' });
    const player = room.players.find(p => p.token === data?.playerToken);
    if (!player) return ackSafe(ack, { ok: false, error: 'Не удалось восстановить игрока.' });
    attachPlayer(socket, room, player);
    ackSafe(ack, { ok: true, code: room.code, playerId: player.id, playerToken: player.token, resumed: true });
    emitRoom(room);
  });

  socket.on('changeShip', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = room?.players.find(x => x.id === socket.data.playerId);
    if (!room || !p || room.started) return ackSafe(ack, { ok: false, error: 'Сейчас класс корабля менять нельзя.' });
    if (!SHIPS[data?.shipClass]) return ackSafe(ack, { ok: false, error: 'Неизвестный класс корабля.' });
    p.shipClass = data.shipClass;
    log(room, `${p.name} выбрал: ${SHIPS[p.shipClass].name}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('startGame', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return ackSafe(ack, { ok: false, error: 'Комната не найдена.' });
    if (room.hostId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Начать игру может только создатель комнаты.' });
    if (room.started) return ackSafe(ack, { ok: false, error: 'Игра уже началась.' });
    if (room.players.length < 4 || room.players.length > 5) return ackSafe(ack, { ok: false, error: 'Для старта нужно 4–5 игроков.' });

    room.started = true;
    room.islands = cloneIslands();
    room.order = determineOrder(room);
    room.turnIndex = 0;
    room.completedTurns = 0;
    room.round = 1;
    room.circle = 1;
    room.alliances = [];
    room.pendingAlliance = null;
    room.pendingBattle = null;
    room.pendingEvent = null;
    room.pendingFeud = null;
    room.pendingAssignmentChoice = null;
    room.pendingStatePrize = null;
    room.pendingIslandCorrection = null;
    room.pendingFleetAdjustment = null;
    room.fleetAdjustmentQueue = [];
    room.pendingLegendaryReaction = null;
    room.eventPhase = null;
    room.anchorDecks = createAnchorDecks();
    room.eventDeck = createSailingEventDeck();
    room.treasureDeck = createTreasureDeck();
    room.legendaryDeck = createLegendaryDeck();
    room.feudDecks = createFeudDecks();
    room.assignmentDecks = createAssignmentDecks();
    room.legendaryPlacesExplored = {};
    room.factionState = {};
    room.players.forEach(p => {
      p.row = 0; p.col = 0; p.ducats = 14; p.debt = 0; p.level = 1; p.specialCards = []; p.cargo = null; p.upgrades = []; p.disabledUpgradeIds = []; p.escorts = []; p.levelInactiveEscortIds = []; p.nextEscortId = 0;
      p.glory = 0; p.skipTurns = 0; p.personalTurnNo = 0; p.attackedThisTurn = []; p.attackHistory = {}; p.brokenAlliesThisTurn = []; p.pendingLegendary = 0; p.pendingLandinEscort = false; p.legendaryCards = []; p.legendaryEffects = { seaCurses: [] }; p.savedEventCards = []; p.nextTurnEffects = {}; p.activeTurnEffects = {}; p.visitedAnchors = []; p.lastAnchorEncounter = null; p.suzerainId = null; p.vassalGiftIslandId = null; p.enemyFactionIds = []; p.nextActionLimit = null; p.activeAssignment = null; p.replacedAssignmentConditions = []; p.landCompany = null; p.bastionPriority = [];
    });
    refreshFactionExistence(room);
    log(room, `Партия началась. Порядок: ${room.order.map(id => room.players.find(p => p.id === id)?.name).join(' → ')}.`);
    beginTurn(room);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('rollMove', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'navigation' || room.roll !== null) return ackSafe(ack, { ok: false, error: 'Кубик движения уже использован.' });
    const firstRoll = rollD6();
    const secondRoll = p.activeTurnEffects?.bestOfTwo ? rollD6() : null;
    room.roll = secondRoll == null ? firstRoll : Math.max(firstRoll, secondRoll);
    const ship = SHIPS[p.shipClass];
    const stats = shipStats(p);
    const bonus = Number(p.activeTurnEffects?.moveBonus) || 0;
    const eventPenalty = Number(p.activeTurnEffects?.movePenalty) || 0;
    const cursePenalty = legendaryMovementPenalty(p);
    const penalty = eventPenalty + cursePenalty;
    room.movePoints = Math.max(0, room.roll + stats.moveMod + bonus - penalty);
    const diceText = secondRoll == null ? `d6 = ${firstRoll}` : `d6 = ${firstRoll} и ${secondRoll}, выбран ${room.roll}`;
    const eventMod = bonus || eventPenalty ? `, событие ${bonus ? `+${bonus}` : ''}${eventPenalty ? `−${eventPenalty}` : ''}` : '';
    const curseMod = cursePenalty ? `, Морское проклятие −${cursePenalty}` : '';
    log(room, `${p.name}: ${diceText}; дальность ${room.movePoints} (${ship.name} ${p.level} ур., модификатор корабля ${stats.moveMod >= 0 ? '+' : ''}${stats.moveMod}${eventMod}${curseMod}).`);
    ackSafe(ack, { ok: true, roll: room.roll, rolls: secondRoll == null ? [firstRoll] : [firstRoll, secondRoll], movePoints: room.movePoints });
    emitRoom(room);
  });

  socket.on('skipNavigation', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'navigation') return ackSafe(ack, { ok: false, error: 'Навигация уже завершена.' });
    room.roll = null;
    room.movePoints = 0;
    room.phase = 'actions';
    handleArrival(room, p);
    handleAnchorStop(room, p);
    log(room, `${p.name} остался на месте.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('moveTo', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'navigation' || room.roll === null) return ackSafe(ack, { ok: false, error: 'Сначала бросьте кубик.' });

    const row = Number(data?.row);
    const col = Number(data?.col);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row > 27 || col < 0 || col > 27) {
      return ackSafe(ack, { ok: false, error: 'Недопустимая клетка.' });
    }

    const allowed = reachableCells(p, room.movePoints).some(c => c.row === row && c.col === col);
    if (!allowed) return ackSafe(ack, { ok: false, error: 'До этой клетки нельзя доплыть данным кораблём за текущую навигацию.' });

    p.row = row;
    p.col = col;
    room.phase = 'actions';
    log(room, `${p.name} переместился на клетку ${col + 1}:${row + 1}.`);
    handleArrival(room, p);
    handleAnchorStop(room, p);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('build', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });

    const result = build(room, p, String(data?.islandId || ''), String(data?.buildingType || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} строит ${result.building.displayName || result.building.name} на острове ${result.island.name} за ${result.building.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, assignmentBuildingEvent(result.island, result.building));
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('upgradeBuilding', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });

    const result = upgradeBuilding(room, p, String(data?.islandId || ''), Number(data?.buildingIndex));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} улучшает ${result.beforeName} → ${result.afterName} на острове ${result.island.name} за ${result.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, assignmentBuildingEvent(result.island, result.building));
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('buildBastion', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const result = buildBastion(room, p, String(data?.islandId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} строит бастион на острове ${result.island.name} за 10 дукатов. Поддержка каменотёсных дворов: ${result.support.supported.length}/${result.support.capacity}. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('prioritizeBastionSupport', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Переназначать поддержку бастионов можно в свой ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (!['navigation', 'actions'].includes(room.phase)) return ackSafe(ack, { ok: false, error: 'Сейчас нельзя менять поддержку бастионов.' });
    const result = prioritizeBastionSupport(room, p, String(data?.islandId || ''));
    if (!result.ok) return ackSafe(ack, result);
    const island = room.islands.find(i => i.id === String(data?.islandId || ''));
    log(room, `${p.name} переносит приоритет поддержки каменотёсных дворов на бастион острова ${island?.name || '—'}. Это не расходует действие.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('formLandCompany', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const result = formLandCompany(room, p, String(data?.islandId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} снаряжает роту ландскнехтов в арсенале ${ROMAN_SERVER[result.company.arsenalLevel] || result.company.arsenalLevel} на ${result.island.name}: +${result.company.army} войска при штурме. Основной трюм занят ротой. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('dismissLandCompany', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Распустить роту можно в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (!['navigation', 'actions'].includes(room.phase)) return ackSafe(ack, { ok: false, error: 'Сейчас роту распустить нельзя.' });
    const result = dismissLandCompany(p);
    if (!result.ok) return ackSafe(ack, result);
    log(room, `${p.name} бесплатно распускает роту ландскнехтов и освобождает основной трюм.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('buyCityGuard', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const result = buyCityGuard(room, p, String(data?.islandId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} покупает городскую стражу для ${result.island.name}: +5 войска к защите за 6 дукатов. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('buyPermanentGarrison', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const result = buyPermanentGarrison(room, p, String(data?.islandId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} заменяет городскую стражу на постоянный гарнизон ${result.island.name}: +10 войска к защите за 12 дукатов. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('buyShipLevel', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const result = buyShipLevel(p);
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} повышает основной корабль до уровня ${result.level} за ${result.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, { type: 'ship-level' });
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('buyShipUpgrade', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const result = buyShipUpgrade(p, String(data?.upgradeId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} устанавливает «${result.upgrade.name}» за ${result.upgrade.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, { type: 'ship-upgrade', branch: result.upgrade.branch });
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('removeShipUpgrade', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const result = removeShipUpgrade(p, String(data?.upgradeId || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} снимает и сбрасывает «${result.upgrade.name}» без возврата дукатов. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('buyEscort', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const result = buyEscort(room, p, String(data?.escortType || ''));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} покупает ${result.def.name.toLowerCase()} за ${result.price} дукатов. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('loadCargo', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });

    const result = loadCargo(room, p, String(data?.islandId || ''), String(data?.goodId || ''), String(data?.holdId || 'main'));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} загружает на ${result.island.name} в ${result.holdName.toLowerCase()}: ${result.good.name} × ${result.quantity}. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('sellCargo', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });

    const result = sellCargo(room, p, String(_data?.holdId || 'main'));
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    const isContract = deliveryAssignmentMatch(p, result);
    let contractBonus = 0;
    let contractCredit = null;
    if (isContract) {
      contractBonus = Math.floor(result.revenue / 2);
      contractCredit = creditDucats(p, contractBonus);
    }
    const debtText = result.credit?.debtPaid ? ` Из обычной выручки ${result.credit.debtPaid} уходит в погашение долга; в казну ${result.credit.net}.` : '';
    const contractText = isContract ? ` Контракт сюзерена: премия +${contractBonus} дукатов${contractCredit?.debtPaid ? ` (${contractCredit.debtPaid} в погашение долга)` : ''}.` : '';
    log(room, `${p.name} продаёт в Цитадели из ${result.holdName.toLowerCase()}: ${result.good.name} × ${result.quantity} за ${result.revenue} дукатов.${debtText}${contractText} Осталось действий: ${room.actionsLeft}.`);
    if (isContract) trackAssignment(room, p, { type: 'delivery', goodId: result.good.id, assignmentInstanceId: result.assignmentInstanceId });
    ackSafe(ack, { ok: true, revenue: result.revenue, contractBonus });
    emitRoom(room);
  });

  socket.on('respondEvent', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingEvent;
    if (!room || !pending || pending.id !== String(data?.eventId || '')) return ackSafe(ack, { ok: false, error: 'Эта карта события уже не ожидает решения.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Решение должен принять игрок, получивший карту.' });

    if (pending.kind === 'cargo') {
      const holdId = String(data?.holdId || '');
      if (!(pending.options || []).some(o => o.id === holdId)) return ackSafe(ack, { ok: false, error: 'Выберите доступный пустой трюм.' });
      pending.choice = { holdId };
    } else if (pending.kind === 'raid') {
      const islandId = String(data?.islandId || '');
      const buildingIndex = Number(data?.buildingIndex);
      if (!(pending.options || []).some(o => o.islandId === islandId && o.buildingIndex === buildingIndex)) return ackSafe(ack, { ok: false, error: 'Выберите доступную постройку.' });
      pending.choice = { islandId, buildingIndex };
    } else if (pending.kind === 'boarding') {
      const upgradeId = String(data?.upgradeId || '');
      if (!(pending.options || []).some(o => o.id === upgradeId)) return ackSafe(ack, { ok: false, error: 'Выберите установленное улучшение.' });
      pending.choice = { upgradeId };
    } else if (pending.kind === 'storm') {
      const row = Number(data?.row), col = Number(data?.col);
      if (!(pending.options || []).some(o => o.row === row && o.col === col)) return ackSafe(ack, { ok: false, error: 'Выберите одну из допустимых клеток берега.' });
      pending.choice = { row, col };
    } else return ackSafe(ack, { ok: false, error: 'Неизвестный тип решения события.' });

    const result = completePendingEvent(room, pending);
    ackSafe(ack, result);
    emitRoom(room);
  });

  socket.on('useSavedCargo', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сохранённую карту можно применить только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Для применения нужен один доступный пункт действия.' });
    const found = takeSavedCard(p, String(data?.savedCardId || ''));
    if (!found || !['found-cargo', 'treasure-cargo'].includes(found.card.kind)) return ackSafe(ack, { ok: false, error: 'Сохранённая грузовая карта не найдена.' });
    const result = fillCargoDirect(room, p, found.card.goodId, String(data?.holdId || 'main'));
    if (!result.ok) return ackSafe(ack, result);
    p.savedEventCards.splice(found.index, 1);
    discardSavedCardToDeck(room, found.card);
    room.actionsLeft -= 1;
    log(room, `${p.name} применяет сохранённую карту «${found.card.name}»: ${result.holdName} заполнен товаром «${result.good.name}» ×${result.quantity}. Осталось действий: ${room.actionsLeft}.`);
    if (found.card.kind === 'treasure-cargo') trackAssignment(room, p, { type: 'treasure-resolved' });
    ackSafe(ack, { ok: true, result });
    emitRoom(room);
  });

  socket.on('useShipMaster', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Карту можно применить только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Для установки нужен один доступный пункт действия.' });
    const found = takeSavedCard(p, String(data?.savedCardId || ''));
    if (!found || found.card.kind !== 'ship-master') return ackSafe(ack, { ok: false, error: 'Карта «Судовой мастер» не найдена.' });
    const result = installShipUpgradeFree(p, String(data?.upgradeId || ''));
    if (!result.ok) return ackSafe(ack, result);
    p.savedEventCards.splice(found.index, 1);
    discardSavedCardToDeck(room, found.card);
    room.actionsLeft -= 1;
    log(room, `${p.name} применяет «Судового мастера» и бесплатно устанавливает «${result.upgrade.name}». Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, { type: 'ship-upgrade', branch: result.upgrade.branch });
    ackSafe(ack, { ok: true, result });
    emitRoom(room);
  });

  socket.on('useBlueprint', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Чертёж можно применить только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Для строительства нужен один доступный пункт действия.' });
    const found = takeSavedCard(p, String(data?.savedCardId || ''));
    if (!found || !['market-blueprint', 'farm-blueprint'].includes(found.card.kind)) return ackSafe(ack, { ok: false, error: 'Подходящий чертёж не найден.' });
    const type = found.card.kind === 'market-blueprint' ? 'market' : 'farm';
    const result = buildFree(room, p, String(data?.islandId || ''), type);
    if (!result.ok) return ackSafe(ack, result);
    p.savedEventCards.splice(found.index, 1);
    discardSavedCardToDeck(room, found.card);
    room.actionsLeft -= 1;
    log(room, `${p.name} применяет «${found.card.name}» и бесплатно строит ${result.building.displayName} на ${result.island.name}. Осталось действий: ${room.actionsLeft}.`);
    trackAssignment(room, p, assignmentBuildingEvent(result.island, result.building));
    ackSafe(ack, { ok: true, result });
    emitRoom(room);
  });

  socket.on('playLegendary', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Легендарную карту можно применить только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Для легендарной карты нужен один доступный пункт действия.' });

    const ref = { source: String(data?.source || ''), index: Number(data?.index) };
    const found = peekLegendaryCard(p, ref);
    if (!found) return ackSafe(ack, { ok: false, error: 'Карта не найдена в вашей руке.' });

    if (found.kind === 'sea-veil') {
      const targetType = String(data?.targetType || 'ship');
      if (targetType === 'ship') {
        consumeLegendaryCard(room, p, ref);
        room.actionsLeft -= 1;
        applySeaVeilToShip(p, { sourcePlayerId: p.id, ignoreCurrentTurn: true });
        log(room, `${p.name} разыгрывает «Покров моря» на свою флотилию. Защита действует до конца трёх следующих личных ходов. Осталось действий: ${room.actionsLeft}.`);
        ackSafe(ack, { ok: true });
        emitRoom(room);
        return;
      }
      const island = room.islands.find(i => i.id === String(data?.islandId || '') && i.ownerId === p.id);
      if (!island) return ackSafe(ack, { ok: false, error: 'Для «Покрова моря» выберите свой остров.' });
      consumeLegendaryCard(room, p, ref);
      room.actionsLeft -= 1;
      applySeaVeilToIsland(island, p, { ignoreCurrentTurn: true });
      log(room, `${p.name} разыгрывает «Покров моря» на ${island.name}. Защита действует до конца трёх следующих личных ходов. Осталось действий: ${room.actionsLeft}.`);
      ackSafe(ack, { ok: true });
      emitRoom(room);
      return;
    }

    if (found.kind === 'mist-path') {
      const row = Number(data?.row), col = Number(data?.col);
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row > 27 || col < 0 || col > 27) return ackSafe(ack, { ok: false, error: 'Выберите допустимую клетку для «Пути сквозь туман».' });
      const allowed = mistPathReachableCells(p).some(c => c.row === row && c.col === col);
      if (!allowed) return ackSafe(ack, { ok: false, error: 'К этой клетке ваш корабль не может проложить путь без запрещённых препятствий.' });
      consumeLegendaryCard(room, p, ref);
      room.actionsLeft -= 1;
      p.row = row; p.col = col;
      handleArrival(room, p);
      log(room, `${p.name} применяет «Путь сквозь туман» и переносит флотилию на клетку ${col + 1}:${row + 1}. Осталось действий: ${room.actionsLeft}.`);
      ackSafe(ack, { ok: true, row, col });
      emitRoom(room);
      return;
    }

    if (found.kind === 'sea-curse') {
      const target = playerById(room, data?.targetPlayerId);
      if (!target || target.id === p.id) return ackSafe(ack, { ok: false, error: 'Выберите другой основной корабль на своей клетке.' });
      if (!sameCell(p, target)) return ackSafe(ack, { ok: false, error: '«Морское проклятие» применяется на одной клетке с кораблём цели.' });
      if (room.round === 1) return ackSafe(ack, { ok: false, error: 'В первом раунде нельзя разыгрывать враждебные легендарные карты против игроков.' });
      if (isCitadelPeaceCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'В зоне мира Цитадели «Морское проклятие» запрещено.' });
      if (areAllies(room, p, target)) return ackSafe(ack, { ok: false, error: 'Союзники не применяют враждебные карты друг против друга.' });
      markAttackHostilityAgainstPlayer(room, p, target, 'враждебное «Морское проклятие» против вассала');
      consumeLegendaryCard(room, p, ref);
      room.actionsLeft -= 1;
      if (isShipProtected(target)) {
        log(room, `${p.name} разыгрывает «Морское проклятие» против ${target.name}, но действующий «Покров моря» отменяет карту. Осталось действий: ${room.actionsLeft}.`);
      } else {
        applySeaCurse(target, p.id);
        log(room, `${p.name} накладывает «Морское проклятие» на ${target.name}: обычная дальность движения −3 в каждом из трёх следующих личных ходов цели. Осталось действий: ${room.actionsLeft}.`);
      }
      ackSafe(ack, { ok: true });
      emitRoom(room);
      return;
    }

    if (found.kind === 'hellfire') {
      const island = room.islands.find(i => i.id === String(data?.islandId || ''));
      if (!island || !playerOnIsland(p, island)) return ackSafe(ack, { ok: false, error: 'Для «Пламени Ада» выберите чужой остров на текущей клетке.' });
      if (island.ownerId === p.id) return ackSafe(ack, { ok: false, error: '«Пламя Ада» нельзя применять к своему острову.' });
      const owner = island.ownerId ? playerById(room, island.ownerId) : null;
      if (owner && room.round === 1) return ackSafe(ack, { ok: false, error: 'В первом раунде нельзя разыгрывать враждебные легендарные карты против игроков.' });
      if (owner && areAllies(room, p, owner)) return ackSafe(ack, { ok: false, error: 'Нельзя применять «Пламя Ада» к острову союзника.' });
      if (isCitadelPeaceCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'В зоне мира Цитадели «Пламя Ада» запрещено.' });
      if (isIslandProtected(island)) return ackSafe(ack, { ok: false, error: `${island.name} уже защищён «Покровом моря».` });

      autoRebelBeforeStateAttack(room, p, island);
      markAttackHostilityAgainstIsland(room, p, island, 'враждебное «Пламя Ада» против государства или его вассала');
      consumeLegendaryCard(room, p, ref);
      room.actionsLeft -= 1;
      if (owner?.connected && playerHasLegendaryKind(owner, 'sea-veil')) {
        room.pendingLegendaryReaction = {
          id: crypto.randomUUID(), kind: 'hellfire', sourcePlayerId: p.id, targetPlayerId: owner.id, islandId: island.id,
        };
        log(room, `${p.name} объявляет «Пламя Ада» против ${island.name} и тратит действие. ${owner.name} может ответить «Покровом моря».`);
        ackSafe(ack, { ok: true, pending: true });
        emitRoom(room);
        return;
      }
      const result = applyHellfire(room, p, island);
      if (!result.ok) return ackSafe(ack, result);
      const detail = result.changed ? result.changes.map(x => `${x.beforeName} → ${x.afterName}`).join(', ') : 'построек выше I уровня нет';
      log(room, `${p.name}: «Пламя Ада» поражает ${island.name}: ${detail}. Осталось действий: ${room.actionsLeft}.`);
      ackSafe(ack, { ok: true, result });
      emitRoom(room);
      return;
    }

    ackSafe(ack, { ok: false, error: 'Этот вид легендарной карты пока не распознан.' });
  });

  socket.on('respondLegendaryReaction', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingLegendaryReaction;
    if (!room || !pending || pending.id !== String(data?.reactionId || '')) return ackSafe(ack, { ok: false, error: 'Эта реакция больше не ожидается.' });
    if (pending.targetPlayerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Реакция адресована другому игроку.' });
    const useVeil = Boolean(data?.useVeil);
    const cardRef = useVeil ? { source: String(data?.source || ''), index: Number(data?.index) } : null;
    const result = resolvePendingLegendaryReaction(room, useVeil, cardRef);
    ackSafe(ack, result);
    emitRoom(room);
  });

  socket.on('requestAlliance', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Предложить союз можно только в свой личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Союз заключают в фазе действий.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const target = playerById(room, data?.targetPlayerId);
    if (!target || target.id === p.id) return ackSafe(ack, { ok: false, error: 'Игрок для союза не найден.' });
    if (!target.connected) return ackSafe(ack, { ok: false, error: 'Этот игрок сейчас не подключён.' });
    if (!sameCell(p, target)) return ackSafe(ack, { ok: false, error: 'Для заключения союза основные корабли должны стоять на одной клетке.' });
    if (areAllies(room, p, target)) return ackSafe(ack, { ok: false, error: 'Вы уже союзники.' });
    room.pendingAlliance = { id: crypto.randomUUID(), fromId: p.id, toId: target.id };
    log(room, `${p.name} предлагает союз игроку ${target.name}. Действие будет потрачено только при согласии.`);
    ackSafe(ack, { ok: true, pending: true });
    emitRoom(room);
  });

  socket.on('respondAlliance', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const request = room?.pendingAlliance;
    if (!room || !request || request.id !== String(data?.requestId || '')) return ackSafe(ack, { ok: false, error: 'Предложение союза больше не активно.' });
    if (request.toId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Это предложение адресовано другому игроку.' });
    const from = playerById(room, request.fromId);
    const to = playerById(room, request.toId);
    if (!from || !to) { room.pendingAlliance = null; return ackSafe(ack, { ok: false, error: 'Участник союза не найден.' }); }
    const accept = Boolean(data?.accept);
    if (accept) {
      const active = currentPlayer(room);
      if (!active || active.id !== from.id || room.phase !== 'actions' || room.actionsLeft <= 0 || !sameCell(from, to)) {
        room.pendingAlliance = null;
        ackSafe(ack, { ok: false, error: 'Условия заключения союза изменились.' });
        emitRoom(room);
        return;
      }
      addAlliance(room, from.id, to.id);
      room.actionsLeft -= 1;
      log(room, `${from.name} и ${to.name} заключают союз. ${from.name} тратит одно действие; осталось ${room.actionsLeft}.`);
    } else {
      log(room, `${to.name} отклоняет предложение союза от ${from.name}. Действие не потрачено.`);
    }
    room.pendingAlliance = null;
    ackSafe(ack, { ok: true, accepted: accept });
    emitRoom(room);
  });

  socket.on('cancelAllianceRequest', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const request = room?.pendingAlliance;
    if (!room || !request || request.id !== String(data?.requestId || '')) return ackSafe(ack, { ok: false, error: 'Предложение союза больше не активно.' });
    if (request.fromId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Отменить предложение может только инициатор.' });
    const from = playerById(room, request.fromId);
    const to = playerById(room, request.toId);
    room.pendingAlliance = null;
    log(room, `${from?.name || 'Игрок'} отменяет предложение союза${to ? ` игроку ${to.name}` : ''}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('breakAlliance', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Разорвать союз можно только в начале своего личного хода.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'navigation' || room.roll !== null) return ackSafe(ack, { ok: false, error: 'Союз можно бесплатно разорвать только до навигации в начале личного хода.' });
    const target = playerById(room, data?.targetPlayerId);
    if (!target || !areAllies(room, p, target)) return ackSafe(ack, { ok: false, error: 'Союз с этим игроком не найден.' });
    removeAlliance(room, p.id, target.id);
    p.brokenAlliesThisTurn ||= [];
    if (!p.brokenAlliesThisTurn.includes(target.id)) p.brokenAlliesThisTurn.push(target.id);
    log(room, `${p.name} разрывает союз с ${target.name}. В этот личный ход ${p.name} не может атаковать бывшего союзника.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });



  socket.on('resolveFleetAdjustment', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingFleetAdjustment;
    if (!room || !pending || pending.id !== String(data?.adjustmentId || '')) return ackSafe(ack, { ok: false, error: 'Эта настройка флотилии больше не ожидается.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Настройку должен выполнить владелец корабля.' });
    const player = playerById(room, pending.playerId);
    if (!player) return ackSafe(ack, { ok: false, error: 'Игрок не найден.' });
    const ids = Array.isArray(data?.ids) ? data.ids.map(String) : [];
    let result;
    if (pending.stage === 'upgrades') {
      result = setDisabledUpgrades(player, ids);
      if (!result.ok) return ackSafe(ack, result);
      const names = ids.map(id => SHIP_UPGRADES[id]?.name || id).join(', ');
      const cargoText = result.cargoDiscarded ? ` Излишек груза в основном трюме сброшен: ${result.cargoDiscarded}.` : '';
      log(room, `${player.name} временно отключает после потери уровня: ${names || 'ничего'}.${cargoText}`);
    } else if (pending.stage === 'escorts') {
      result = setLevelInactiveEscorts(player, ids);
      if (!result.ok) return ackSafe(ack, result);
      const statusById = new Map(escortStatuses(room, player).map(e => [e.id, e]));
      const names = ids.map(id => {
        const e = statusById.get(id) || (player.escorts || []).find(x => x.id === id);
        return ESCORTS[e?.type]?.name || e?.type || id;
      }).join(', ');
      log(room, `${player.name} временно выводит из активной флотилии после потери уровня: ${names || 'ничего'}. Груз на неактивных эскортах сохраняется.`);
    } else if (pending.stage === 'shipyard-remove') {
      result = removeEscortsForShipyard(room, player, ids);
      if (!result.ok) return ackSafe(ack, result);
      const names = result.removed.map(x => ESCORTS[x.escort.type]?.name || x.escort.type);
      const lostCargo = result.removed.filter(x => x.cargoDiscarded).map(x => `${ESCORTS[x.escort.type]?.name || x.escort.type}: ${GOODS[x.cargoDiscarded.goodId]?.name || x.cargoDiscarded.goodId} ×${x.cargoDiscarded.quantity}`);
      log(room, `${player.name} теряет из-за нехватки мест верфи: ${names.join(', ')}.${lostCargo.length ? ` Вместе с судами потерян груз: ${lostCargo.join('; ')}.` : ''}`);
    } else if (pending.stage === 'landin-replace') {
      if (ids.length !== 1) return ackSafe(ack, { ok: false, error: 'Выберите ровно одно судно сопровождения для замены.' });
      result = replaceEscortWithLandin(player, ids[0]);
      if (!result.ok) return ackSafe(ack, result);
      player.pendingLandinEscort = false;
      const oldName = ESCORTS[result.replaced?.type]?.name || result.replaced?.type || 'судно сопровождения';
      const cargoText = result.cargoDiscarded ? ` Груз заменённого судна потерян: ${GOODS[result.cargoDiscarded.goodId]?.name || result.cargoDiscarded.goodId} ×${result.cargoDiscarded.quantity}.` : '';
      log(room, `${player.name} заменяет ${oldName} на особое сопровождение Ландина (+6 артиллерии, трюм 5).${cargoText}`);
    } else {
      return ackSafe(ack, { ok: false, error: 'Неизвестный этап настройки флотилии.' });
    }
    advanceFleetAdjustment(room);
    ackSafe(ack, { ok: true, pending: Boolean(room.pendingFleetAdjustment) });
    emitRoom(room);
  });

  socket.on('resolveIslandCorrection', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingIslandCorrection;
    if (!room || !pending || pending.id !== String(data?.correctionId || '')) return ackSafe(ack, { ok: false, error: 'Это исправление острова больше не ожидается.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Лишние постройки должен выбрать владелец острова.' });
    const player = playerById(room, pending.playerId);
    if (!player) return ackSafe(ack, { ok: false, error: 'Владелец острова не найден.' });
    const result = removeIslandBuildingForCorrection(room, player, pending.islandId, data?.buildingIndex);
    if (!result.ok) return ackSafe(ack, result);
    pending.removed ||= [];
    pending.removed.push(result.name);
    log(room, `${player.name} удаляет ${result.name} с острова ${result.island.name} без компенсации для восстановления допустимых ограничений.`);
    if (result.garrisonChanged) {
      if (result.oldGarrison === 'permanent' && result.newGarrison === 'guard') log(room, `${result.island.name}: постоянный гарнизон становится городской стражей (+5).`);
      else if (result.oldGarrison && !result.newGarrison) log(room, `${result.island.name}: городской отряд распущен из-за потери статуса города.`);
    }
    const stillPending = refreshPendingIslandCorrection(room);
    if (!stillPending) continueAfterIslandCorrection(room);
    ackSafe(ack, { ok: true, legal: !room.pendingIslandCorrection });
    emitRoom(room);
  });

  socket.on('placeStatePrizeBuilding', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingStatePrize;
    if (!room || !pending || pending.id !== String(data?.prizeId || '')) return ackSafe(ack, { ok: false, error: 'Этот итоговый приз уже не ожидает размещения.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Этот приз принадлежит другому игроку.' });
    const player = playerById(room, pending.playerId);
    const spec = pending.remainingBuildings?.[0];
    if (!player || !spec) { room.pendingStatePrize = null; return ackSafe(ack, { ok: false, error: 'Наградная постройка не найдена.' }); }

    const result = placePrizeBuilding(room, player, String(data?.islandId || ''), spec, { factionId: pending.factionId });
    if (!result.ok) return ackSafe(ack, result);
    pending.remainingBuildings.shift();
    log(room, `${player.name} размещает ${result.name} из итогового приза на острове ${result.island.name}.`);
    advanceStatePrizePlacement(room);
    ackSafe(ack, { ok: true, islandId: result.island.id, buildingName: result.name });
    emitRoom(room);
  });

  socket.on('enterVassalage', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Вступление в подданство требует одного действия в фазе действий.' });
    const factionId = String(data?.factionId || '');
    const allowed = canEnterVassalage(room, p, factionId);
    if (!allowed.ok) return ackSafe(ack, allowed);
    const result = enterVassalage(room, p, factionId);
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} вступает в подданство государства ${result.faction.name}. ${result.gift.name} немедленно передан вассалу. Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true, factionId, giftIslandId: result.gift.id });
    emitRoom(room);
  });

  socket.on('rebelVassalage', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions' || room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Мятеж требует одного действия в фазе действий.' });
    const result = rebelFromSuzerain(room, p);
    if (!result.ok) return ackSafe(ack, result);
    room.actionsLeft -= 1;
    log(room, `${p.name} объявляет мятеж против ${result.faction.name} и становится его врагом.${result.returned ? ` ${result.gift.name} возвращён сюзерену со всеми постройками.` : ''} Осталось действий: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('respondFeud', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingFeud;
    if (!room || !pending || pending.id !== String(data?.feudId || '')) return ackSafe(ack, { ok: false, error: 'Эта карта вражды больше не ожидает решения.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Эту карту должен разрешить другой игрок.' });
    const result = completePendingFeud(room, pending, data || {});
    ackSafe(ack, result);
    emitRoom(room);
  });


  socket.on('respondAssignmentChoice', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingAssignmentChoice;
    if (!room || !pending || pending.id !== String(data?.choiceId || '')) return ackSafe(ack, { ok: false, error: 'Это решение по поручению больше не ожидается.' });
    if (pending.playerId !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Решение адресовано другому игроку.' });
    const player = playerById(room, pending.playerId);
    if (!player) return ackSafe(ack, { ok: false, error: 'Игрок не найден.' });
    const replace = Boolean(data?.replace);
    if (replace) {
      const result = replaceAssignment(room, player);
      if (!result.ok) return ackSafe(ack, result);
      if (result.next) {
        log(room, `${player.name} платит 2 дуката и заменяет поручение «${result.previous.card.text}» на «${result.next.card.text}».`);
        room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: result.next.card.text, factionId: player.suzerainId, factionName: FACTIONS[player.suzerainId]?.name, pending: false, source: 'assignment-replace' };
      } else {
        log(room, `${player.name} платит 2 дуката и сбрасывает поручение «${result.previous.card.text}», но подходящей замены сейчас нет.`);
        room.eventPhase.lastCard = { playerId: player.id, playerName: player.name, cardName: 'Подходящей замены нет', factionId: player.suzerainId, factionName: FACTIONS[player.suzerainId]?.name, pending: false, source: 'assignment-replace' };
      }
    } else {
      log(room, `${player.name} оставляет активное поручение «${player.activeAssignment?.card?.text || 'поручение'}».`);
      if (room.eventPhase?.lastCard) room.eventPhase.lastCard.pending = false;
    }
    room.pendingAssignmentChoice = null;
    room.eventPhase.replacementIndex += 1;
    processEventPhase(room);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('attackShip', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const target = playerById(room, data?.targetPlayerId);
    if (!target) return ackSafe(ack, { ok: false, error: 'Корабль-цель не найден.' });
    if (areAllies(room, p, target)) return ackSafe(ack, { ok: false, error: 'Союзники не могут нападать друг на друга.' });
    if ((p.brokenAlliesThisTurn || []).includes(target.id)) return ackSafe(ack, { ok: false, error: 'В этот личный ход нельзя атаковать бывшего союзника.' });
    if (room.round === 1) return ackSafe(ack, { ok: false, error: 'В первом раунде игроки не нападают друг на друга.' });
    if (!sameCell(p, target)) return ackSafe(ack, { ok: false, error: 'Для морского боя корабли должны находиться на одной клетке.' });
    if (isCitadelPeaceCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'В зоне мира Цитадели морские бои запрещены.' });
    if ((p.attackedThisTurn || []).includes(target.id)) return ackSafe(ack, { ok: false, error: 'Один и тот же корабль можно атаковать не более одного раза за личный ход.' });
    if (isShipProtected(target)) return ackSafe(ack, { ok: false, error: `Флотилия ${target.name} защищена «Покровом моря» и сейчас не может быть атакована.` });

    markAttackHostilityAgainstPlayer(room, p, target);
    room.actionsLeft -= 1;
    if (target.connected && playerHasLegendaryKind(target, 'sea-veil')) {
      room.pendingLegendaryReaction = {
        id: crypto.randomUUID(), kind: 'sea-attack', sourcePlayerId: p.id, targetPlayerId: target.id,
        inviteAllies: Boolean(data?.inviteAllies),
      };
      log(room, `${p.name} объявляет морскую атаку на ${target.name} и тратит действие. ${target.name} может ответить «Покровом моря».`);
      ackSafe(ack, { ok: true, pending: true });
      emitRoom(room);
      return;
    }

    const result = beginSeaBattleResolution(room, p, target, Boolean(data?.inviteAllies));
    if (!result.ok) { room.actionsLeft += 1; return ackSafe(ack, result); }
    ackSafe(ack, result);
    emitRoom(room);
  });

  socket.on('assaultIsland', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    if (room.phase !== 'actions') return ackSafe(ack, { ok: false, error: 'Сначала завершите навигацию.' });
    if (room.actionsLeft <= 0) return ackSafe(ack, { ok: false, error: 'Действий больше нет.' });
    const island = room.islands.find(i => i.id === String(data?.islandId || ''));
    if (!island) return ackSafe(ack, { ok: false, error: 'Остров не найден.' });
    const captureMode = String(data?.captureMode || 'preserve');
    const owner = island.ownerId ? playerById(room, island.ownerId) : null;
    if (!playerOnIsland(p, island)) return ackSafe(ack, { ok: false, error: 'Для штурма основной корабль должен находиться на клетке этого острова.' });
    if (island.ownerId === p.id) return ackSafe(ack, { ok: false, error: 'Нельзя штурмовать собственный остров.' });
    if (!island.ownerId && island.kind === 'free') return ackSafe(ack, { ok: false, error: 'Свободный остров получают без штурма.' });
    if (owner && areAllies(room, p, owner)) return ackSafe(ack, { ok: false, error: 'Нельзя штурмовать остров союзника.' });
    if (owner && (p.brokenAlliesThisTurn || []).includes(owner.id)) return ackSafe(ack, { ok: false, error: 'В этот личный ход нельзя атаковать остров бывшего союзника.' });
    if (owner && room.round === 1) return ackSafe(ack, { ok: false, error: 'В первом раунде нельзя нападать на острова других игроков.' });
    if (isCitadelPeaceCell(p.row, p.col)) return ackSafe(ack, { ok: false, error: 'В зоне мира Цитадели штурм запрещён.' });
    if (isIslandProtected(island)) return ackSafe(ack, { ok: false, error: `${island.name} защищён «Покровом моря» и сейчас не может быть атакован.` });

    autoRebelBeforeStateAttack(room, p, island);
    markAttackHostilityAgainstIsland(room, p, island);
    room.actionsLeft -= 1;
    if (owner) trackAssignment(room, p, { type: 'attack-player-island', islandId: island.id, ownerId: owner.id });
    if (owner?.connected && playerHasLegendaryKind(owner, 'sea-veil')) {
      room.pendingLegendaryReaction = {
        id: crypto.randomUUID(), kind: 'assault', sourcePlayerId: p.id, targetPlayerId: owner.id,
        islandId: island.id, captureMode, inviteAllies: Boolean(data?.inviteAllies),
      };
      log(room, `${p.name} объявляет штурм ${island.name} и тратит действие. ${owner.name} может ответить «Покровом моря».`);
      ackSafe(ack, { ok: true, pending: true });
      emitRoom(room);
      return;
    }

    const result = beginAssaultResolution(room, p, island, captureMode, Boolean(data?.inviteAllies));
    if (!result.ok) { room.actionsLeft += 1; return ackSafe(ack, result); }
    ackSafe(ack, result);
    emitRoom(room);
  });

  socket.on('respondBattle', (data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const pending = room?.pendingBattle;
    if (!room || !pending || pending.id !== String(data?.battleId || '')) return ackSafe(ack, { ok: false, error: 'Этот бой уже не ожидает решения.' });
    const invite = pending.invites.find(inv => inv.playerId === socket.data.playerId);
    if (!invite) return ackSafe(ack, { ok: false, error: 'Вы не приглашены в этот совместный бой.' });
    if (invite.response === true || invite.response === false) return ackSafe(ack, { ok: false, error: 'Ответ уже принят.' });
    invite.response = Boolean(data?.participate);
    const player = playerById(room, invite.playerId);
    if (invite.response && invite.side === 'attacker' && player) {
      if (pending.kind === 'sea') {
        const target = playerById(room, pending.targetPlayerId);
        markAttackHostilityAgainstPlayer(room, player, target, 'участие в нападении на вассала');
      } else {
        const island = room.islands.find(i => i.id === pending.islandId);
        autoRebelBeforeStateAttack(room, player, island);
        markAttackHostilityAgainstIsland(room, player, island, 'участие в нападении на государство или его вассала');
      }
    }
    log(room, `${player?.name || 'Игрок'} ${invite.response ? 'присоединяется' : 'не участвует'} ${invite.side === 'attacker' ? 'в атаке' : 'в защите'}.`);
    const resolved = allBattleInvitesAnswered(pending) ? resolvePendingBattle(room) : null;
    if (resolved?.ok) log(room, `Совместный бой завершён. Осталось действий у инициатора: ${room.actionsLeft}.`);
    ackSafe(ack, { ok: true, resolved: Boolean(resolved) });
    emitRoom(room);
  });

  socket.on('endTurn', (_data, ack) => {
    const room = getRoom(socket.data.roomCode);
    const p = currentPlayer(room);
    if (!room || room.phase === 'event' || !p || p.id !== socket.data.playerId) return ackSafe(ack, { ok: false, error: 'Сейчас не ваш личный ход.' });
    if (hasPendingDecision(room)) return ackSafe(ack, { ok: false, error: pendingDecisionError(room) });
    log(room, `${p.name} завершил личный ход.`);
    endTurnInternal(room);
    ackSafe(ack, { ok: true });
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return;
    const p = room.players.find(x => x.id === socket.data.playerId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    if (room.pendingAlliance && (room.pendingAlliance.fromId === p.id || room.pendingAlliance.toId === p.id)) {
      room.pendingAlliance = null;
      log(room, `Незавершённое предложение союза отменено из-за отключения ${p.name}.`);
    }
    if (room.pendingLegendaryReaction && room.pendingLegendaryReaction.targetPlayerId === p.id) {
      log(room, `${p.name} не использует «Покров моря» из-за отключения.`);
      resolvePendingLegendaryReaction(room, false, null);
    }
    if (room.pendingBattle) {
      const invite = room.pendingBattle.invites.find(inv => inv.playerId === p.id && inv.response == null);
      if (invite) {
        invite.response = false;
        log(room, `${p.name} автоматически не участвует в совместном бою из-за отключения.`);
        if (allBattleInvitesAnswered(room.pendingBattle)) resolvePendingBattle(room);
      }
    }
    if (room.pendingAssignmentChoice?.playerId === p.id) {
      log(room, `${p.name}: предложение платной замены поручения пропущено из-за отключения; текущее поручение сохранено.`);
      room.pendingAssignmentChoice = null;
      if (room.eventPhase?.active) {
        room.eventPhase.replacementIndex += 1;
        processEventPhase(room);
      }
    }
    log(room, `${p.name} отключился. Его место сохранено.`);
    emitRoom(room);
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, version: '0.17.0', rooms: rooms.size }));

server.listen(PORT, HOST, () => {
  console.log(`Первооткрыватели Online MVP 0.17: http://${HOST}:${PORT}`);
});
