import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
const port=19429, debugPort=19430, profile=await mkdtemp('/tmp/studio29-browser-');
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--disable-extensions','--no-first-run',`--user-data-dir=${profile}`,`--remote-debugging-port=${debugPort}`,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<120;i++){try{const v=await fn();if(v)return v;}catch{}await delay(100)}throw Error('timed out waiting for browser fixture');}
let ws;
try{
 const target=await until(async()=>(await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(x=>x.type==='page'));
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let seq=0;const pending=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await call('Runtime.enable');await call('Page.enable');
 const fixtureUrl=`http://127.0.0.1:${port}/designs/console/test/browser/integration-fixture.html?view=own-send`;
 await until(async()=>{const response=await fetch(fixtureUrl);return response.ok});
 for(const deferred of [false,true]){
  await call('Page.navigate',{url:fixtureUrl});
  await until(async()=>{const ready=await evaluate("!!document.querySelector('#composer') && !!document.querySelector('.convo')");if(ready)return true;const state=await evaluate("({url:location.href,body:document.body.innerText.slice(0,500)})");if(state.url!==fixtureUrl)throw Error('Fixture navigation failed: '+JSON.stringify(state));return false;});
  await evaluate(`(()=>{const e=document.querySelector('#composer');e.value='Browser own-send witness';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))})()`);
  await until(()=>evaluate("!!document.querySelector('[data-pending-own-message]')"));
  const before=await evaluate("({pending:document.querySelectorAll('[data-pending-own-message]').length,phase:document.querySelector('[data-pending-phase]')?.getAttribute('data-pending-phase')})");
  assert.equal(before.pending,1,'send should remain visibly pending while ACK is withheld');
  await evaluate(`window.publishSavedOwnMessage(${deferred})`);
  await until(()=>evaluate("!document.querySelector('[data-pending-own-message]') && !!document.querySelector('[data-node=browser-saved-own]')"));
  const after=await evaluate("({pending:document.querySelectorAll('[data-pending-own-message]').length,saved:document.querySelectorAll('[data-node=browser-saved-own]').length,text:document.querySelector('[data-node=browser-saved-own]')?.textContent})");
  assert.equal(after.pending,0);assert.equal(after.saved,1);
  if(deferred)assert(!after.text.includes('Browser own-send witness'),'deferred body remains unavailable, not fabricated');
  else assert(after.text.includes('Browser own-send witness'));
  console.log(JSON.stringify({deferred,before,after,ack:'withheld/discarded',retiredBy:'matching client_operation_id'}));
 }
}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
