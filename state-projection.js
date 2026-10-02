'use strict';

const S = Symbol('scalar');
const a = item => ({ t: 'a', item });
const o = fields => ({ t: 'o', fields });
const m = value => ({ t: 'm', value });
const f = names => Object.fromEntries(names.split(/\s+/).filter(Boolean).map(key => [key, S]));

const IMPLEMENTED_POLICY_KEYS = Object.freeze([
  'island.publicState','island.garrison','ship.publicState','ship.cargo','player.ducats','player.character',
  'politics.suzerainRelation','player.activeAssignment','player.activeAssignmentExistenceAndSignals',
  'player.privateAbilities','player.savedBenefits','player.activeExpedition','discoveries.completedHistory',
  'player.debt','player.activeTemporaryEffects','player.landCompany','player.anchorHistory',
  'pending.privateContent','pending.publicEnvelope','catalogs.publicDefinitions',
]);
const SCOUT_RUNTIME_ENABLED = true;

const cargo = o(f('id goodId name quantity price value'));
const stats = o(f('artillery army cargo moveMod actionsPerTurn'));
const upgrade = o(f('id name branch active disabledByLevel missingRequirement'));
const escort = o({ ...f('id type special active inactiveReason'), cargo });
const discovery = o(f('id name placeId claimedBy exploredBy'));
const history = o(f('id cardId name placeId completedRound round result'));
const stop = o(f('index islandId mapObjectId label'));
const assignment = o({
  ...f('instanceId factionId id conditionKey text reward type issuedRound'),
  progress: o({ ...f('kind nextStopIndex completedStopCount totalStops departureRequired departureSatisfied'), completedStops: a(stop) }),
});
const legendaryCard = o(f('id name handIndex'));
const legendaryRef = o(f('source index id kind name'));
const savedEvent = o(f('id kind name goodId'));
const expedition = o(f('cardId name placeId acceptedRound requiresLeaveAndReturn'));
const turnEffects = o(f('noIncome noNavigation moveBonus movePenalty bestOfTwo'));
const characterEffect = o({
  ...f('type rerolls secondResultMandatory range distance revealCount duration count draw keep levels anchorPenaltyExcluded'),
  modes:a(S),
});
const character = o({ ...f('id name admiraltyLevel acquireActionCost useActionCost'), effect: characterEffect });
const characterOption = o({ ...f('id name admiraltyLevel'), effect: characterEffect });
const constraintReport = o({
  ...f('legal status usedArea effectiveArea overArea branchLimit'),
  branchViolations:a(o(f('branch name count limit'))),
});
const anchorEncounter = o(f('round row col color anchorName cardName cardArtillery rewardValue fleetPower outcome fleetPoints'));
const ownerAnchorEncounter = o({ ...anchorEncounter.fields, reward:o(f('gross debtPaid net debtRemaining')), penalty:o(f('required paid addedDebt debt')) });
const publicPlayer = o({
  ...f('id name color shipClass glory fleetPoints armyPoints level row col connected ready islandCount suzerainId vassalGiftIslandId namedPlaceCardCount expeditionHistoryCount bastionSupportCapacity bastionCount bastionSupportChoiceRequired cargoCapacity assaultArmy fleetArtillery totalCargoCapacity upgradeSlots shipyardSlots escortUseLimit nextEscortPrice atCitadel inPeaceZone skipTurns phase roll movePoints actionsLeft'),
  legendaryStatus:o({ ...f('shipVeilTurns seaCursePenalty'), seaCurseTurns:a(S) }),
  activeTurnEffects:turnEffects,
  landCompany:o(f('army arsenalLevel sourceIslandId formedAt')),
  visitedAnchors:a(S), lastAnchorEncounter:anchorEncounter,
  enemyFactionIds:a(S), namedPlaceCards:a(discovery), expeditionHistory:a(history), supportedBastionIslandIds:a(S),
  cargo, stats, upgrades:a(upgrade), escorts:a(escort),
  nextLevel:o(f('level price')), allyIds:a(S),
});
const ownerPlayer = o({
  ducats:S, debt:S, prestige:S, character, activeAssignment:assignment, hasActiveAssignment:S, assignmentPriority:o(f('kind text')),
  specialCards:a(S), specialCardCount:S, legendaryCards:a(legendaryCard), legendaryCardCount:S,
  playableLegendaryCards:a(legendaryRef), savedEventCards:a(savedEvent), savedEventCardCount:S,
  activeExpedition:expedition, hasActiveExpedition:S,
  ...f('nextActionLimit expeditionTakenThisRound canTakeExpedition canDismissLandCompanyHere characterReplacedThisRound admiraltyLevelHere palaceUsed pendingLandinEscort'),
  attackedPlayerIdsThisRound:a(S), nextTurnEffects:turnEffects, lastAnchorEncounter:ownerAnchorEncounter,
  characterAcquisitionOptions:a(characterOption), characterReplacementOptions:a(characterOption),
  cartographerAnchorOptions:a(o(f('id color name distance'))),
  inactiveBastionIslandIds:a(S), disabledUpgradeIds:a(S), levelInactiveEscortIds:a(S), brokenAlliesThisTurn:a(S),
});
const building = o({ ...f('index type level name supported'), nextUpgrade:o(f('type level price name')) });
const publicIsland = o({
  ...f('id name kind faction area army reward ownerId loadedRound rewardClaimed firstMilitaryConquered usedArea effectiveArea status'),
  resources:a(S), cells:a(a(S)), availableGoods:a(S), buildings:a(building),
  constraints:constraintReport, legendaryVeil:o(f('remaining sourcePlayerId')),
});
const privateGarrison = o({
  ...f('garrisonType garrisonName garrisonDefense defenseArmy'),
  defenseBreakdown:o(f('total garrison hiredGarrison fortifications bastions ownerShip ownerShipPresent')),
});
// Schemas describe the six existing presentation contracts, not raw resolution state.
const pendingSchemas = {
  pendingEvent:o({ ...f('kind cardName goodId islandId'), options:a(o(f('id name capacity islandId islandName buildingIndex row col'))) }),
  pendingFeud:o({ ...f('kind cardName factionId factionName remaining'), options:a(o(f('id name islandId islandName buildingIndex canDowngrade goodId quantity'))) }),
  pendingAssignmentChoice:o({ ...f('kind factionId factionName'), options:a(o(f('id text reward type'))) }),
  pendingIslandCorrection:o({
    ...f('kind islandId islandName reason initialBuildingCount keepCount remainingRemovals'),
    report:constraintReport, removed:a(S), options:a(o(f('buildingIndex name type level area branch branchName'))),
  }),
  pendingFleetAdjustment:o({
    ...f('stage reason required'), options:a(o(f('id name type missingRequirement special artillery cargoCapacity hasCargo cargoText'))),
  }),
  pendingLegendaryReaction:o({ ...f('kind sourcePlayerId targetPlayerId islandId'), veilOptions:a(legendaryRef) }),
};
const pendingFamilies = [
  ['pendingEvent','playerId'], ['pendingFeud','playerId'], ['pendingAssignmentChoice','playerId'],
  ['pendingIslandCorrection','playerId'], ['pendingFleetAdjustment','playerId'], ['pendingLegendaryReaction','targetPlayerId'],
];
const lastCard = o(f('playerId playerName cardName factionId factionName pending source'));
const eventPhase = o(f('active personalTurn currentPlayerId playerIndex totalPlayers stage observatoryReplacementsUsed feudIndex feudTotal assignmentIndex assignmentTotal replacementIndex replacementTotal'));
const pool = o({ ...f('mode selection'), typeIds:a(S) });
const legendaryPlace = o(f('id name kind mapPlaceId islandId reward rewardCount rewardStatus unresolved exploredBy'));
const namedPlace = o(f('id name placeId visibility iconKey claimedBy'));
const simpleCatalog = m(o(f('id name price area category resource produces branch order requires artillery army cargo movement passability')));
const characterCatalog = m(o(f('id name admiraltyLevel acquireActionCost useActionCost')));
const battle = o({ ...f('id kind attackerId targetPlayerId islandId viewerInvite'), invites:a(o(f('playerId side status'))) });
const alliance = o(f('id fromId toId viewerRole'));
const endGameConsensus = o({ ...f('status proposedById finishAfterRound'), confirmedPlayerIds:a(S) });
const finalPlayerMetrics = o({ playerId:S, metrics:o(f('islands wealth army fleet prestige legendaryPlaces')) });
const finalTitle = o({ ...f('id name metric maxValue'), winnerIds:a(S) });
const finalResult = o({ finishedRound:S, playerMetrics:a(finalPlayerMetrics), titles:a(finalTitle) });

const own = (x,k) => Boolean(x) && Object.prototype.hasOwnProperty.call(x,k);
const scalar = v => v === null || ['string','number','boolean'].includes(typeof v);
function p(src, schema) {
  if (src === undefined) return undefined;
  if (src === null) return null;
  if (schema === S) return scalar(src) ? src : undefined;
  if (!schema || typeof schema !== 'object') return undefined;
  if (schema.t === 'a') {
    if (!Array.isArray(src)) return undefined;
    return src.map(v => p(v,schema.item)).filter(v => v !== undefined);
  }
  if (schema.t === 'm') {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return undefined;
    const out={}; for (const k of Object.keys(src).sort()) { const v=p(src[k],schema.value); if(v!==undefined) out[k]=v; } return out;
  }
  if (schema.t === 'o') {
    if (!src || typeof src !== 'object' || Array.isArray(src)) return undefined;
    const out={}; for (const [k,s] of Object.entries(schema.fields)) if(own(src,k)){ const v=p(src[k],s); if(v!==undefined) out[k]=v; } return out;
  }
  return undefined;
}
function merge(out,src,schema){ const v=p(src,schema); if(v && typeof v==='object' && !Array.isArray(v)) Object.assign(out,v); return out; }
function ctx(viewerContext){
  const viewerId=viewerContext && typeof viewerContext==='object' && viewerContext.viewerId!=null ? String(viewerContext.viewerId) : null;
  const scoutRevealGrants=[];
  if(SCOUT_RUNTIME_ENABLED && viewerId!==null && Array.isArray(viewerContext?.scoutRevealGrants)) {
    for(const raw of viewerContext.scoutRevealGrants) {
      if(!raw || String(raw.viewerPlayerId)!==viewerId) continue;
      if(raw.mode==='money' && raw.targetPlayerId!=null) scoutRevealGrants.push({viewerPlayerId:viewerId,mode:'money',targetPlayerId:String(raw.targetPlayerId)});
      else if(raw.mode==='garrison' && raw.islandId!=null) scoutRevealGrants.push({viewerPlayerId:viewerId,mode:'garrison',islandId:String(raw.islandId)});
    }
  }
  return { viewerId, scoutRevealGrants };
}
function hasScoutGrant(c, mode, targetKey, targetId){
  if(!SCOUT_RUNTIME_ENABLED || c.viewerId===null || targetId==null) return false;
  return c.scoutRevealGrants.some(grant => grant.mode===mode && grant.viewerPlayerId===c.viewerId && String(grant[targetKey])===String(targetId));
}

function projectFinalResult(result){ return p(result,finalResult); }

function projectPlayerForViewer(player, viewerContext=null){
  if(!player || typeof player!=='object' || Array.isArray(player)) return null;
  const c=ctx(viewerContext), out=merge({},player,publicPlayer), owner=c.viewerId!==null && String(player.id)===c.viewerId;
  if(owner) merge(out,player,ownerPlayer);
  else if(hasScoutGrant(c,'money','targetPlayerId',player.id)) put(out,player,'ducats',S);
  if(own(player,'id')) out.isYou=owner;
  return out;
}
function projectIslandForViewer(island, viewerContext=null){
  if(!island || typeof island!=='object' || Array.isArray(island)) return null;
  const c=ctx(viewerContext), out=merge({},island,publicIsland), owner=c.viewerId!==null && island.ownerId!=null && String(island.ownerId)===c.viewerId;
  if(owner || hasScoutGrant(c,'garrison','islandId',island.id)) merge(out,island,privateGarrison);
  return out;
}
function actorId(pending, actorField){
  if(!pending || typeof pending!=='object') return null;
  for(const key of actorField ? [actorField] : ['playerId','actorId','targetPlayerId']) if(key && pending[key]!=null) return String(pending[key]);
  return null;
}
function projectPendingForViewer(pending, viewerContext=null, options={}){
  if(!pending || typeof pending!=='object' || Array.isArray(pending)) return null;
  const c=ctx(viewerContext), id=actorId(pending,options.actorField), actor=c.viewerId!==null && id!==null && c.viewerId===id;
  if(!actor) return null;
  const out={ viewerCanRespond:true };
  if(own(pending,'id')) { const v=p(pending.id,S); if(v!==undefined) out.id=v; }
  const key=options.actorField || (own(pending,'playerId')?'playerId':own(pending,'targetPlayerId')?'targetPlayerId':own(pending,'actorId')?'actorId':null);
  if(key && own(pending,key)){ const v=p(pending[key],S); if(v!==undefined) out[key]=v; }
  merge(out,pending,pendingSchemas[options.family || 'pendingEvent']);
  return out;
}
function projectPersonalPendingFamilies(out, src, viewerContext){
  const c=ctx(viewerContext);
  delete out.pendingDecision;
  for(const [key,actorField] of pendingFamilies) {
    const pending=own(src,key) ? src[key] : null;
    if(!pending || typeof pending!=='object' || Array.isArray(pending)) { delete out[key]; continue; }
    const id=actorId(pending,actorField);
    const actor=c.viewerId!==null && id!==null && c.viewerId===id;
    if(actor) out[key]=projectPendingForViewer(pending,c,{actorField,family:key});
    else {
      delete out[key];
      if(id!==null && !out.pendingDecision) out.pendingDecision={waiting:true,actorPlayerId:id};
    }
  }
  return out;
}
function put(out,src,key,schema){ if(own(src,key)){ const v=p(src[key],schema); if(v!==undefined) out[key]=v; } }
function projectEventPhaseForViewer(phase, viewerContext=null){
  if(phase===undefined) return undefined;
  if(phase===null) return null;
  const c=ctx(viewerContext), card=phase?.lastCard;
  const phaseActorId=phase?.currentPlayerId!=null ? String(phase.currentPlayerId) : card?.playerId!=null ? String(card.playerId) : null;
  const actor=c.viewerId!==null && phaseActorId!==null && c.viewerId===phaseActorId;
  if(phase?.active && !actor) return p(phase,o(f('active personalTurn currentPlayerId')));
  const out=p(phase,eventPhase);
  if(card && c.viewerId!==null && String(card.playerId)===c.viewerId) put(out,phase,'lastCard',lastCard);
  return out;
}
function projectRoomForViewer(roomView, viewerContext=null){
  if(!roomView || typeof roomView!=='object' || Array.isArray(roomView)) return {};
  const c=ctx(viewerContext), out={};
  for(const key of 'version code started hostId round circle turnIndex activePlayerId finished phase'.split(' ')) put(out,roomView,key,S);
  for(const key of ['seatingOrder','order']) put(out,roomView,key,a(S));
  for(const [key,schema] of [['eventPhase',eventPhase],['treasurePool',pool],['legendaryPool',pool],['legendaryPlaces',a(legendaryPlace)],['namedPlaceCards',a(namedPlace)],['alliances',a(a(S))],['pendingBattle',battle],['pendingAlliance',alliance],['endGameConsensus',endGameConsensus],['finalResult',finalResult],['characterCatalog',characterCatalog],['buildingCatalog',simpleCatalog],['goodsCatalog',simpleCatalog],['shipUpgradeCatalog',simpleCatalog]]) put(out,roomView,key,schema);
  projectPersonalPendingFamilies(out,roomView,c);
  if(own(roomView,'eventPhase')) out.eventPhase=projectEventPhaseForViewer(roomView.eventPhase,c);
  if(Array.isArray(roomView.players)) out.players=roomView.players.map(v=>projectPlayerForViewer(v,c));
  if(Array.isArray(roomView.islands)) out.islands=roomView.islands.map(v=>projectIslandForViewer(v,c));
  return out;
}


// Transitional root contract; every entity, including owner and actor, uses explicit schemas.
// Input is the presentation view from publicRoom, never authoritative storage.
function projectOpponentFacingRoomView(legacyRoomView, viewerContext=null){
  if(!legacyRoomView || typeof legacyRoomView!=='object' || Array.isArray(legacyRoomView)) return {};
  const c=ctx(viewerContext), out=structuredClone(legacyRoomView);
  // Shared journal and private-derived source counters never cross the ordinary player boundary.
  delete out.log;
  delete out.eventDecks;
  delete out.feudDecks;
  delete out.assignmentDecks;
  delete out.scoutRevealGrants;
  delete out.randomSourceState;
  delete out.digitalModelSchemaVersion;
  delete out.persistenceInternal;
  if(Array.isArray(out.players)) out.players=out.players.map(v=>projectPlayerForViewer(v,c));
  if(Array.isArray(out.islands)) out.islands=out.islands.map(v=>projectIslandForViewer(v,c));
  projectPersonalPendingFamilies(out,legacyRoomView,c);
  for(const [key,schema] of [['pendingBattle',battle],['pendingAlliance',alliance],['endGameConsensus',endGameConsensus],['finalResult',finalResult]]) {
    if(own(out,key)) out[key]=p(out[key],schema);
  }
  if(own(out,'eventPhase')) out.eventPhase=projectEventPhaseForViewer(legacyRoomView.eventPhase,c);
  return out;
}

module.exports={projectOpponentFacingRoomView,IMPLEMENTED_POLICY_KEYS,SCOUT_RUNTIME_ENABLED,projectRoomForViewer,projectPlayerForViewer,projectIslandForViewer,projectPendingForViewer,projectFinalResult};
