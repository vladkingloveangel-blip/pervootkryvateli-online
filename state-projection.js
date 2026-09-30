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
  'pending.privateContent','pending.publicEnvelope','catalogs.publicDefinitions',
]);
const SCOUT_RUNTIME_ENABLED = false;

const cargo = o(f('id goodId name quantity price value'));
const stats = o(f('artillery army cargo moveMod'));
const upgrade = o(f('id name branch active disabledByLevel missingRequirement'));
const escort = o({ ...f('id type special active inactiveReason'), cargo });
const discovery = o(f('id name placeId claimedBy exploredBy'));
const history = o(f('id cardId name placeId completedRound round result'));
const stop = o(f('id islandId placeId label row col'));
const assignment = o({
  ...f('instanceId factionId id conditionKey text reward type issuedRound'),
  progress: o({ ...f('kind nextStopIndex completedStopCount totalStops departureRequired departureSatisfied'), completedStops: a(stop) }),
});
const legendaryCard = o(f('id name handIndex'));
const legendaryRef = o(f('source index id kind name'));
const savedEvent = o(f('id kind name goodId'));
const expedition = o(f('cardId id name placeId acceptedRound requiresLeaveAndReturn progress state'));
const character = o(f('id name admiraltyLevel acquireActionCost useActionCost'));
const publicPlayer = o({
  ...f('id name color shipClass glory fleetPoints armyPoints level row col connected ready islandCount suzerainId vassalGiftIslandId namedPlaceCardCount expeditionHistoryCount bastionSupportCapacity bastionCount bastionSupportChoiceRequired cargoCapacity assaultArmy fleetArtillery totalCargoCapacity upgradeSlots shipyardSlots escortUseLimit nextEscortPrice atCitadel inPeaceZone skipTurns phase roll movePoints actionsLeft'),
  enemyFactionIds:a(S), namedPlaceCards:a(discovery), expeditionHistory:a(history), supportedBastionIslandIds:a(S),
  cargo, stats, upgrades:a(upgrade), disabledUpgradeIds:a(S), escorts:a(escort), levelInactiveEscortIds:a(S),
  nextLevel:o(f('level price')), allyIds:a(S),
});
const ownerPlayer = o({
  ducats:S, character, activeAssignment:assignment, hasActiveAssignment:S, assignmentPriority:o(f('kind text')),
  specialCards:a(S), specialCardCount:S, legendaryCards:a(legendaryCard), legendaryCardCount:S,
  playableLegendaryCards:a(legendaryRef), savedEventCards:a(savedEvent), savedEventCardCount:S,
  activeExpedition:expedition, hasActiveExpedition:S,
});
const building = o({ ...f('index type level name supported'), nextUpgrade:o(f('type level price name')) });
const publicIsland = o({
  ...f('id name kind faction area army reward ownerId loadedRound rewardClaimed firstMilitaryConquered usedArea effectiveArea status'),
  resources:a(S), cells:a(a(S)), availableGoods:a(S), buildings:a(building),
});
const privateGarrison = o({
  ...f('garrisonType garrisonName garrisonDefense defenseArmy'),
  defenseBreakdown:o(f('total garrison hiredGarrison fortifications bastions ownerShip ownerShipPresent')),
});
const pendingOption = o(f('id text label name kind type reward value goodId islandId buildingType buildingIndex playerId escortId source index'));
const pendingPrivate = o({
  ...f('kind cardName factionId factionName remaining goodId islandId islandName reason stage required sourcePlayerId targetPlayerId initialBuildingCount keepCount remainingRemovals'),
  options:a(pendingOption), veilOptions:a(legendaryRef), removed:a(S),
});
const eventPhase = o(f('active personalTurn currentPlayerId playerIndex totalPlayers stage observatoryReplacementsUsed feudIndex feudTotal assignmentIndex assignmentTotal replacementIndex replacementTotal'));
const pool = o({ ...f('mode selection'), typeIds:a(S) });
const legendaryPlace = o(f('id name kind mapPlaceId islandId reward rewardCount rewardStatus unresolved exploredBy'));
const namedPlace = o(f('id name placeId visibility iconKey claimedBy'));
const simpleCatalog = m(o(f('id name price area category resource produces branch order requires artillery army cargo movement passability')));
const characterCatalog = m(o(f('id name admiraltyLevel acquireActionCost useActionCost')));
const battle = o({ ...f('id kind attackerId targetPlayerId islandId viewerInvite'), invites:a(o(f('playerId side status'))) });
const alliance = o(f('id fromId toId viewerRole'));

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
function ctx(viewerContext){ return { viewerId: viewerContext && typeof viewerContext==='object' && viewerContext.viewerId!=null ? String(viewerContext.viewerId) : null }; }

function projectPlayerForViewer(player, viewerContext=null){
  if(!player || typeof player!=='object' || Array.isArray(player)) return null;
  const c=ctx(viewerContext), out=merge({},player,publicPlayer), owner=c.viewerId!==null && String(player.id)===c.viewerId;
  if(owner) merge(out,player,ownerPlayer);
  if(own(player,'id')) out.isYou=owner;
  return out;
}
function projectIslandForViewer(island, viewerContext=null){
  if(!island || typeof island!=='object' || Array.isArray(island)) return null;
  const c=ctx(viewerContext), out=merge({},island,publicIsland), owner=c.viewerId!==null && island.ownerId!=null && String(island.ownerId)===c.viewerId;
  if(owner) merge(out,island,privateGarrison);
  return out;
}
function actorId(pending, actorField){
  if(!pending || typeof pending!=='object') return null;
  for(const key of [actorField,'playerId','actorId','targetPlayerId']) if(key && pending[key]!=null) return String(pending[key]);
  return null;
}
function projectPendingForViewer(pending, viewerContext=null, options={}){
  if(!pending || typeof pending!=='object' || Array.isArray(pending)) return null;
  const c=ctx(viewerContext), id=actorId(pending,options.actorField), actor=c.viewerId!==null && id!==null && c.viewerId===id, out={};
  if(own(pending,'id')) { const v=p(pending.id,S); if(v!==undefined) out.id=v; }
  const key=options.actorField || (own(pending,'playerId')?'playerId':own(pending,'targetPlayerId')?'targetPlayerId':own(pending,'actorId')?'actorId':null);
  if(key && own(pending,key)){ const v=p(pending[key],S); if(v!==undefined) out[key]=v; }
  out.viewerCanRespond=actor;
  if(actor) merge(out,pending,pendingPrivate);
  return out;
}
function put(out,src,key,schema){ if(own(src,key)){ const v=p(src[key],schema); if(v!==undefined) out[key]=v; } }
function projectRoomForViewer(roomView, viewerContext=null){
  if(!roomView || typeof roomView!=='object' || Array.isArray(roomView)) return {};
  const c=ctx(viewerContext), out={};
  for(const key of 'version code started hostId leaderId round circle turnIndex activePlayerId'.split(' ')) put(out,roomView,key,S);
  for(const key of ['seatingOrder','order']) put(out,roomView,key,a(S));
  for(const [key,schema] of [['eventPhase',eventPhase],['treasurePool',pool],['legendaryPool',pool],['legendaryPlaces',a(legendaryPlace)],['namedPlaceCards',a(namedPlace)],['alliances',a(a(S))],['pendingBattle',battle],['pendingAlliance',alliance],['characterCatalog',characterCatalog],['buildingCatalog',simpleCatalog],['goodsCatalog',simpleCatalog],['shipUpgradeCatalog',simpleCatalog]]) put(out,roomView,key,schema);
  for(const [key,actorField] of [['pendingEvent','playerId'],['pendingFeud','playerId'],['pendingAssignmentChoice','playerId'],['pendingIslandCorrection','playerId'],['pendingFleetAdjustment','playerId'],['pendingLegendaryReaction','targetPlayerId']]) if(own(roomView,key)) out[key]=projectPendingForViewer(roomView[key],c,{actorField});
  if(Array.isArray(roomView.players)) out.players=roomView.players.map(v=>projectPlayerForViewer(v,c));
  if(Array.isArray(roomView.islands)) out.islands=roomView.islands.map(v=>projectIslandForViewer(v,c));
  return out;
}

module.exports={IMPLEMENTED_POLICY_KEYS,SCOUT_RUNTIME_ENABLED,projectRoomForViewer,projectPlayerForViewer,projectIslandForViewer,projectPendingForViewer};
