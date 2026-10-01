'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {projectOpponentFacingRoomView,projectRoomForViewer,projectFinalResult}=require('../state-projection');
const metrics=['islands','wealth','army','fleet','prestige','legendaryPlaces'];
function view(finished=true){
 const titles=metrics.map((id,i)=>({id,name:'Title '+id,metric:'Metric '+id,maxValue:i,winnerIds:i===0?['p1','p2']:['p1'],secret:'TITLE_SECRET'}));
 return {version:'0.33.0',code:'FINISH',started:true,round:8,circle:6,turnIndex:0,activePlayerId:null,finished,phase:finished?'finished':'actions',
 endGameConsensus:{status:'accepted',proposedById:'p1',confirmedPlayerIds:['p1','p2'],finishAfterRound:8,secret:'CONSENSUS_SECRET'},
 finalResult:finished?{finishedRound:8,playerMetrics:[
 {playerId:'p1',metrics:{islands:3,wealth:40,army:9,fleet:8,prestige:7,legendaryPlaces:2,secret:'METRIC_SECRET'},secret:'ENTRY_SECRET'},
 {playerId:'p2',metrics:{islands:3,wealth:40,army:5,fleet:8,prestige:4,legendaryPlaces:2}}],titles,winnerId:'FORBIDDEN',internal:'FINAL_SECRET'}:undefined,
 players:[
 {id:'p1',name:'One',ducats:40,character:{id:'scout',name:'Scout'},specialCards:['PRIVATE_ABILITY'],savedEventCards:[{id:'saved',name:'PRIVATE_BENEFIT'}],cargo:{goodId:'tea',quantity:2,name:'PRIVATE_CARGO'},storedBenefits:[{secret:'RAW_BENEFIT'}]},
 {id:'p2',name:'Two',ducats:30,character:{id:'other',name:'Other'},specialCards:['OTHER_PRIVATE'],savedEventCards:[{id:'other',name:'OTHER_BENEFIT'}],cargo:{goodId:'wood',quantity:1,name:'OTHER_CARGO'}}],
 islands:[],pendingEvent:{id:'pending',playerId:'p1',kind:'choice',cardName:'PRIVATE_PENDING_CARD',options:[{id:'x',name:'PRIVATE_PENDING_OPTION'}],secret:'PENDING_SECRET'},
 randomSourceState:{sailingEvent:{available:['RANDOM_SECRET']}},digitalModelSchemaVersion:9,persistenceInternal:'PERSISTENCE_SECRET'};
}
test('7.6 finished public result is complete, shared and explicit',()=>{
 const source=view(), before=structuredClone(source);
 const a=projectOpponentFacingRoomView(source,{viewerId:'p1'}), b=projectOpponentFacingRoomView(source,{viewerId:'p2'});
 assert.equal(a.finished,true);assert.equal(a.phase,'finished');assert.deepEqual(a.finalResult,b.finalResult);
 assert.equal(a.finalResult.finishedRound,8);assert.equal(a.finalResult.playerMetrics.length,2);
 for(const e of a.finalResult.playerMetrics) assert.deepEqual(Object.keys(e.metrics).sort(),[...metrics].sort());
 assert.equal(a.finalResult.titles.length,6);assert.deepEqual(a.finalResult.titles.map(x=>x.id),metrics);
 assert.deepEqual(a.finalResult.titles[0].winnerIds,['p1','p2']);assert.equal(Object.hasOwn(a.finalResult,'winnerId'),false);
 assert.equal(JSON.stringify(a.finalResult).includes('SECRET'),false);assert.deepEqual(projectFinalResult(source.finalResult),a.finalResult);assert.deepEqual(source,before);
});
test('7.6 finished state keeps private player and pending visibility boundaries',()=>{
 const source=view(), owner=projectOpponentFacingRoomView(source,{viewerId:'p1'}), other=projectOpponentFacingRoomView(source,{viewerId:'p2'});
 const own=owner.players[0], opp=other.players[0];
 assert.equal(own.ducats,40);assert.equal(own.character.id,'scout');assert.deepEqual(own.specialCards,['PRIVATE_ABILITY']);assert.equal(own.savedEventCards[0].name,'PRIVATE_BENEFIT');
 for(const key of ['ducats','character','specialCards','savedEventCards','storedBenefits']) assert.equal(Object.hasOwn(opp,key),false,key);
 assert.equal(Object.hasOwn(other,'pendingEvent'),false);assert.deepEqual(other.pendingDecision,{waiting:true,actorPlayerId:'p1'});
 for(const key of ['randomSourceState','digitalModelSchemaVersion','persistenceInternal']) assert.equal(Object.hasOwn(other,key),false,key);
 assert.deepEqual(other.endGameConsensus,{status:'accepted',proposedById:'p1',confirmedPlayerIds:['p1','p2'],finishAfterRound:8});
});
test('7.6 explicit room schema denies internal roots for finished and unfinished states',()=>{
 for(const source of [view(true),view(false)]){
  const out=projectRoomForViewer(source,{viewerId:'p2'});
  for(const key of ['randomSourceState','digitalModelSchemaVersion','persistenceInternal']) assert.equal(Object.hasOwn(out,key),false,key);
  assert.equal(out.finished,source.finished);assert.equal(out.phase,source.phase);
  assert.deepEqual(out.endGameConsensus,{status:'accepted',proposedById:'p1',confirmedPlayerIds:['p1','p2'],finishAfterRound:8});
 }
});
