const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const { io } = require('socket.io-client');
const rules = require('../rules');

test('join order and six complete personal circles', { timeout: 30000 }, async t => {
  const listener=net.createServer(); listener.listen(0,'127.0.0.1'); await once(listener,'listening');
  const port=listener.address().port; await new Promise(resolve=>listener.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['--require','./test/fixtures/clock-deck.cjs','server.js'],{
    cwd:path.join(__dirname,'..'),windowsHide:true,
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATABASE_URL:'',AUTH_SECRET:'clock-test'},stdio:['ignore','pipe','pipe'],
  });
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const sockets=[];
  t.after(async()=>{sockets.forEach(s=>s.disconnect());if(child.exitCode===null){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}});
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error(output);
    try{if((await fetch(base+'/health')).ok)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  async function connect(){const socket=io(base,{transports:['websocket'],reconnection:false});sockets.push(socket);await once(socket,'connect');return socket;}
  const emit=(socket,event,data={})=>new Promise((resolve,reject)=>socket.timeout(5000).emit(event,data,(error,value)=>error?reject(error):resolve(value)));
  async function change(socket,event,data={},viewSocket=socket){
    const next=once(viewSocket,'roomState');
    const result=await emit(socket,event,data);
    assert.equal(result.ok,true,`${event}: ${result.error||''}`);
    return (await next)[0];
  }
  // Staging/playtest author override: a complete game may start with one player.
  const minimumPlayer=await connect();
  const minimumCreated=await emit(minimumPlayer,'createRoom',{name:'Minimum One'});
  assert.equal(minimumCreated.ok,true);
  await change(minimumPlayer,'setReady',{ready:true});
  assert.equal((await emit(minimumPlayer,'startGame')).ok,true);
  minimumPlayer.disconnect();

  const players=await Promise.all(Array.from({length:4},()=>connect()));
  const created=await emit(players[0],'createRoom',{name:'One'});
  const ids=[created.playerId];
  assert.equal(created.ok,true);
  for(let i=1;i<4;i++)ids.push((await emit(players[i],'joinRoom',{code:created.code,name:`Player ${i+1}`})).playerId);
  assert.equal((await emit(players[0],'startGame')).ok,false);
  await change(players[0],'changeShip',{shipClass:'frigate'});
  await change(players[1],'changeShip',{shipClass:'frigate'});
  for(const socket of players)await change(socket,'setReady',{ready:true});
  let room=await change(players[0],'startGame');
  const order=[...ids];
  assert.deepEqual(room.order,order);
  assert.equal(room.players.find(p=>p.id===ids[0]).shipClass,'frigate');
  assert.equal(room.players.find(p=>p.id===ids[1]).shipClass,'frigate');
  assert.equal(room.players.every(p=>p.row===0 && p.col===0 && p.level===1),true);
  assert.equal(room.players.find(p=>p.isYou).ducats,rules.session.startingDucats);
  assert.equal(room.players.filter(p=>!p.isYou).every(p=>!Object.hasOwn(p,'ducats')),true);
  assert.deepEqual([room.round,room.circle,room.players.find(p=>p.id===order[0]).actionsLeft],[1,1,rules.session.actionsPerTurn]);
  const socketFor=id=>players[ids.indexOf(id)];
  for(let turn=0;turn<20;turn++){
    assert.equal(room.activePlayerId,order[turn%4],`turn ${turn} circle ${room.circle}`);
    const nextId=order[(turn+1)%4];
    room=await change(socketFor(room.activePlayerId),'endTurn',{},socketFor(nextId));
    if((turn+1)%4===0 && turn<19)assert.equal(room.circle,2+Math.floor(turn/4));
  }
  assert.deepEqual([room.round,room.circle],[1,6]);
  assert.equal(room.players.every(p=>p.phase==='waiting'),true);
  assert.equal(room.activePlayerId,null);
  assert.equal(room.eventPhase.currentPlayerId,order[0]);
  assert.equal(room.pendingEvent.kind,'storm');
  assert.equal((await emit(socketFor(order[0]),'endTurn')).ok,false);
  const firstChoice=room.pendingEvent.options[0];
  room=await change(socketFor(order[0]),'respondEvent',{eventId:room.pendingEvent.id,row:firstChoice.row,col:firstChoice.col});
  assert.equal(room.players.find(p=>p.id===order[0]).phase,'navigation');
  assert.equal(room.activePlayerId,order[0]);
  assert.equal(room.players.find(p=>p.id===order[0]).row,firstChoice.row);
  for(let index=0;index<4;index++){
    assert.equal(room.activePlayerId,order[index]);
    assert.deepEqual([room.round,room.circle],[1,6]);
    assert.equal(room.players.find(p=>p.id===order[index]).phase,'navigation');
    assert.equal(room.players.find(p=>p.id===order[index]).actionsLeft,rules.session.actionsPerTurn);
    if(index>0){
      const current=room.players.find(p=>p.id===order[index]);
      if(index===1)assert.equal(current.activeTurnEffects.noIncome,true);
      else assert.equal(current.activeTurnEffects.moveBonus,2);
      assert.deepEqual(current.nextTurnEffects,{});
    }
    room=await change(socketFor(order[index]),'endTurn',{},socketFor(order[(index+1)%4]));
  }
  assert.deepEqual([room.round,room.circle,room.activePlayerId],[2,1,order[0]]);
  assert.equal(room.players.find(p=>p.id===order[0]).activeTurnEffects.moveBonus,undefined);
  assert.equal(room.eventPhase?.active||false,false);

  const six=await Promise.all(Array.from({length:7},()=>connect()));
  const full=await emit(six[0],'createRoom',{name:'Leader'});
  assert.equal(full.ok,true);
  for(let i=1;i<6;i++)assert.equal((await emit(six[i],'joinRoom',{code:full.code,name:`Seat ${i+1}`})).ok,true);
  assert.equal((await emit(six[6],'joinRoom',{code:full.code,name:'Seventh'})).ok,false);
  for(let i=0;i<6;i++)await change(six[i],'changeShip',{shipClass:'brigantine'});
  for(let i=0;i<6;i++)await change(six[i],'setReady',{ready:true});
  const fullRoom=await change(six[0],'startGame');
  assert.equal(fullRoom.players.length,6);
  assert.equal(new Set(fullRoom.players.map(p=>p.color)).size,6);
  assert.equal(fullRoom.order[0],full.playerId);
  assert.equal(fullRoom.players.find(p=>p.isYou).ducats,rules.session.startingDucats);
  assert.equal(fullRoom.players.filter(p=>!p.isYou).every(p=>!Object.hasOwn(p,'ducats')),true);
});
