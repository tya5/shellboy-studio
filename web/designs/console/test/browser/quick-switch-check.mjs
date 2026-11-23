import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
const port=19639, debugPort=19640, profile=await mkdtemp('/tmp/studio39-profile-');
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
 const base=`http://127.0.0.1:${port}/designs/console/test/browser/quick-switch.html`;
 await until(async()=>(await fetch(base)).ok);
 for (const width of [1280,390]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:base});
  const click=label=>evaluate(`(() => {const b=[...document.querySelectorAll('.model-picker button')].find(b=>b.textContent===${JSON.stringify(label)}); if(!b || b.disabled) return false; b.click(); return true;})()`);
  await until(()=>evaluate("(() => {const b=document.querySelector('.model-picker-anchor>button'); if(!window.flushOwner || !b) return false; b.click(); return true;})()"));
  await until(()=>evaluate("(async()=>{await window.flushOwner();return [...document.querySelectorAll('.model-picker-list button')].some(b=>b.textContent==='studio / model-b');})()"));
  const before=await evaluate("document.querySelector('.model-picker-anchor>button').textContent");
  const bounds=await evaluate("(() => {const r=document.querySelector('.model-picker').getBoundingClientRect(); return [r.left,r.right,r.top,r.bottom];})()");
  assert(bounds[0]>=0 && bounds[1]<=width+1 && bounds[2]>=0 && bounds[3]<=900,JSON.stringify(bounds));
  const img = await call('Page.captureScreenshot',{format:'png'});
  await writeFile(`${process.env.SHOTS}/studio-${width}.png`,Buffer.from(img.data,'base64'));
  assert(await click('studio / model-b'));
  await evaluate('window.flushOwner()');
  assert.deepEqual(await evaluate('window.writes()'),[{thread_id:'lead',connection:'studio',model:'model-b'}]);
  assert.equal(await evaluate("document.querySelector('.model-picker-anchor>button').textContent"),before);
  await evaluate('window.hint()');
  await until(()=>evaluate("document.querySelector('.model-picker-anchor>button').textContent.includes('studio / model-b')"));
  assert(await click('high')); await evaluate('window.flushOwner()');
  assert.deepEqual(await evaluate('window.writes().at(-1)'),{thread_id:'lead',effort:'high'});
  await evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); true");
  await until(()=>evaluate("!document.querySelector('.model-picker')"));
  await evaluate("document.querySelector('.model-picker-anchor>button').click(); true");
  await until(()=>evaluate("!!document.querySelector('.model-picker')"));
  await evaluate("document.querySelector('.model-picker input').focus(); true");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await until(()=>evaluate("!document.querySelector('.model-picker') && document.activeElement===document.querySelector('.model-picker-anchor>button')"));
  console.log(JSON.stringify({width,bounds,writes:await evaluate('window.writes()')}));
 }

}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
