import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
const port=19467, debugPort=19468, profile=await mkdtemp('/tmp/studio67-browser-');
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','designs/console/test/browser/vite.config.mjs','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
const chrome=spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--disable-extensions','--no-first-run',`--user-data-dir=${profile}`,`--remote-debugging-port=${debugPort}`,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){let last;for(let i=0;i<120;i++){try{const v=await fn();if(v)return v;last=v;}catch(error){last=String(error)}await delay(100)}throw Error('timed out waiting for browser fixture: '+JSON.stringify(last));}
let ws;
try{
 const target=await until(async()=>(await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(x=>x.type==='page'));
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let seq=0;const pending=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown'||m.method==='Log.entryAdded')console.error(JSON.stringify(m));if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await call('Runtime.enable');await call('Log.enable');await call('Page.enable');
 const fixtureUrl=`http://127.0.0.1:${port}/designs/console/test/browser/integration-fixture.html?view=splitters`;
 await until(async()=>{const response=await fetch(fixtureUrl);return response.ok});
 const selector=side=>`[role="separator"][data-edge="${side}"]`;
 const state=side=>evaluate(`(()=>{
  const sep=document.querySelector(${JSON.stringify(selector(side))});
  if(!sep || !sep.getClientRects().length)return null;
  const pane=document.getElementById(sep.getAttribute('aria-controls'));
  const r=sep.getBoundingClientRect(), p=pane.getBoundingClientRect();
  return {x:(r.left+r.right)/2,y:(r.top+r.bottom)/2,hit:r.width,width:p.width,
   min:Number(sep.getAttribute('aria-valuemin')),max:Number(sep.getAttribute('aria-valuemax')),
   now:Number(sep.getAttribute('aria-valuenow')),edge:${side==='left'?'p.right':'p.left'},orientation:sep.getAttribute('aria-orientation'),
   touchAction:getComputedStyle(sep).touchAction};
 })()`);
 const metrics=(width,mobile=false)=>call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile});
 const expectWidth=async(side,width)=>{
  const measured=await state(side);
  assert.equal(measured?.width,width,`${side} pane width`);
  assert.equal(measured.now,width,`${side} reported width`);
  assert.equal(measured.orientation,'vertical');
  assert(Math.abs(measured.x-measured.edge)<=1,`${side} splitter is not on the pane boundary`);
 };
 const mouse=(type,x,y,buttons)=>call('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:1});
 const drag=async(side,delta)=>{
  const {x,y}=await state(side);
  await evaluate(`window.__splitterEvents=[];for(const name of ['pointerdown','pointermove','lostpointercapture'])document.addEventListener(name,e=>window.__splitterEvents.push({name,target:e.target.outerHTML.slice(0,190),primary:e.isPrimary,button:e.button,buttons:e.buttons}),{capture:true,once:true})`);
  await mouse('mouseMoved',x,y,0);
  await mouse('mousePressed',x,y,1);
  await mouse('mouseMoved',x+delta,y,1);
  await mouse('mouseReleased',x+delta,y,0);
  console.log(side,await evaluate('window.__splitterEvents'),await state(side));
 };
 const codes={ArrowLeft:37,ArrowRight:39,Home:36,End:35};
 const key=async(side,key,shift=false)=>{
  await evaluate(`document.querySelector(${JSON.stringify(selector(side))}).focus()`);
  const args={key,code:key,windowsVirtualKeyCode:codes[key],modifiers:shift?8:0};
  await call('Input.dispatchKeyEvent',{type:'keyDown',...args});
  await call('Input.dispatchKeyEvent',{type:'keyUp',...args});
 };
 await metrics(1440);
 await call('Page.navigate',{url:fixtureUrl});
 await until(()=>state('right'));
 await expectWidth('left',260); await expectWidth('right',340);
 await drag('right',-54); await expectWidth('right',394); await expectWidth('left',260);
 await key('right','ArrowLeft'); await expectWidth('right',410);
 await key('right','ArrowRight',true); await expectWidth('right',378);
 await key('right','Home'); await expectWidth('right',280);
 await key('right','End'); await expectWidth('right',480);
 await key('right','ArrowRight'); await expectWidth('right',464);
 await drag('left',36); await expectWidth('left',296); await expectWidth('right',464);
 await key('left','ArrowLeft',true); await expectWidth('left',264);
 await key('left','Home'); await expectWidth('left',220);
 await key('left','End'); await expectWidth('left',420);
 await key('left','ArrowLeft'); await expectWidth('left',404);
 await evaluate('window.__splitterPage = true');
 await call('Page.reload');
 await until(async()=>await evaluate('!window.__splitterPage') && await state('right'));
 await expectWidth('left',404); await expectWidth('right',464);
 const toggle='[data-panel-root] button[aria-expanded]';
 await evaluate(`document.querySelector(${JSON.stringify(toggle)}).click()`);
 assert.equal(await state('right'),null,'collapsed panel still has a splitter');
 await evaluate(`document.querySelector(${JSON.stringify(toggle)}).click()`);
 await expectWidth('right',464);
 await evaluate(`document.querySelector('.nav-toggle button').click()`);
 assert.equal(await state('left'),null,'collapsed sidebar still has a splitter');
 await evaluate(`document.querySelector('.nav-toggle button').click()`);
 await expectWidth('left',404);
 await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 await until(()=>evaluate(`matchMedia('(any-pointer:coarse)').matches`));
 const touch=await state('right');
 assert(touch.hit>=44,`touch hit width: ${touch.hit}`);
 assert.equal(touch.touchAction,'none');
 await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touch.x,y:touch.y}]});
 await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+32,y:touch.y}]});
 await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expectWidth('right',432);
 await metrics(390,true);
 await until(async()=>await state('right')===null && await state('left')===null);
 assert.equal(await evaluate('document.querySelector("[data-panel-root]").getClientRects().length'),0);
 console.log(JSON.stringify({pointer:true,keyboard:true,reload:{left:404,right:464},collapsed:true,touch:{hit:touch.hit,width:432},phoneHidden:true}));
}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
