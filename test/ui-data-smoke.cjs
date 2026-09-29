// Optional browser smoke check. Supply an existing Playwright module with
// PLAYWRIGHT_MODULE_PATH and a browser executable with BROWSER_EXECUTABLE.
// The browser renders a test snapshot; all game logic is covered separately.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const net = require('node:net');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.join(__dirname, '..');

(async () => {
  const listener=net.createServer(); listener.listen(0,'127.0.0.1'); await once(listener,'listening');
  const port=listener.address().port; await new Promise(resolve=>listener.close(resolve));
  const child=spawn(process.execPath,['server.js'],{cwd:root,windowsHide:true,
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATABASE_URL:'',AUTH_SECRET:'local-ui-smoke'},stdio:'pipe'});
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  let browser;
  const dir=process.env.UI_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(),'pervo-ui-'));
  fs.mkdirSync(dir,{recursive:true});
  try {
    const base=`http://127.0.0.1:${port}`;
    for(let i=0;i<100;i++) {
      if(child.exitCode!==null)throw Error(output);
      try {if((await fetch(base+'/health')).ok)break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE,headless:true});
    for(const width of [360,390,412,1280]) {
      const context=await browser.newContext({viewport:{width,height:800},serviceWorkers:'block'});
      const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/app.js',route=>{
        const source=fs.readFileSync(path.join(root,'public/app.js'),'utf8')
          .replace('const socket = io();','const socket = window.__testSocket = io();')
          .replace('const state = {','const state = window.__testState = {');
        return route.fulfill({contentType:'application/javascript',body:source});
      });
      await page.goto(base);await page.fill('#nameInput','Проверка');await page.click('#createBtn');
      await page.waitForFunction(()=>document.querySelector('#shipSelect option[value="brigantine"]')?.textContent.includes('арт. 4'));
      await page.waitForFunction(()=>window.__testState?.room?.balanceCatalog);
      await page.evaluate(()=>{
        const state=window.__testState, room=structuredClone(state.room);
        window.__lobbyOriginal=structuredClone(room);
        const first=room.players[0];
        room.players=[first,...[1,2,3].map(i=>({...first,id:`seat-${i}`,name:`Игрок ${i+1}`,isYou:false,color:['#1e88e5','#43a047','#8e24aa'][i-1]}))];
        room.seatingOrder=[first.id,'seat-2','seat-1','seat-3'];
        room.leaderId='seat-1';
        window.__testSocket.listeners('roomState')[0](room);
      });
      if(width<900)await page.click('[data-mobile-nav="players"]');
      assert.equal(await page.locator('#players .player-card').count(),4);
      assert.match(await page.locator('#players').textContent(),/ведущий/);
      for(const button of await page.locator('#players .seat-btn').all()){
        const box=await button.boundingBox();assert.ok(box.height>=44 && box.width>=44);
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.evaluate(()=>window.__testSocket.listeners('roomState')[0](window.__lobbyOriginal));
      await page.evaluate(()=>{
        const state=window.__testState,room=structuredClone(state.room),mine=room.players.find(p=>p.id===state.myId);
        Object.assign(room,{started:true,phase:'actions',activePlayerId:mine.id,actionsLeft:3});
        Object.assign(mine,{phase:'actions',actionsLeft:3,atCitadel:true,row:13,col:13,ducats:999,upgradeSlots:6,nextLevel:{level:2,price:room.shipLevelCatalog[2].price},shipyardSlots:3,escortUseLimit:3});
        const city=room.islands.find(i=>i.id==='kisalinia');Object.assign(city,{ownerId:mine.id,status:'Город',garrisonType:null});
        window.__testSocket.listeners('roomState')[0](room);
      });
      if(width<900)await page.click('[data-mobile-nav="ship"]');
      const guard=page.getByRole('button',{name:/Городская стража →/});
      await guard.scrollIntoViewIfNeeded();
      const label=await guard.textContent();assert.match(label,/6 дук\. · \+5 защиты/); // explicit current runtime exception
      const dimensions=await guard.boundingBox();assert.ok(dimensions.height>=44 && dimensions.width>=44);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(width<900) {
        const rect=await page.locator('#gameSidePanel').boundingBox();assert.ok(rect.y>=0 && rect.y+rect.height<=800);
        assert.equal(await page.locator('#gameSidePanel').evaluate(e=>getComputedStyle(e).overflowY),'auto');
      }
      await page.screenshot({path:path.join(dir,`ship-${width}.png`)});
      // Two synchronous taps before any ack must send exactly one action.
      await page.evaluate(()=>{
        window.__sent=[];
        window.__testSocket.timeout=()=>({emit:(event,payload,ack)=>{window.__sent.push({event,payload});window.__pendingAck=ack;}});
        const button=[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Городская стража →'));
        button.click();button.click();
      });
      assert.equal(await page.evaluate(()=>window.__sent.length),1);
      assert.equal(await guard.getAttribute('aria-busy'),'true');
      assert.equal(await guard.isDisabled(),true);
      assert.deepEqual(errors,[]);
      console.log(`UI ${width}px: no overflow, contained panel, 44px target, catalog label, single submit OK`);
      await context.close();
    }
    console.log(`Screenshots: ${dir}`);
  } finally {
    if(browser)await browser.close();
    if(child.exitCode===null){const ended=once(child,'exit');child.kill('SIGKILL');await ended;}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
