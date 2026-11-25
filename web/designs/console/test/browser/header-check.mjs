import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
const port=19660, debugPort=19661, profile=await mkdtemp('/tmp/studio66-profile-');
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','designs/console/test/browser/vite.config.mjs','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:'ignore'});
const chrome=spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--disable-extensions','--no-first-run','--use-mock-keychain','--password-store=basic',`--user-data-dir=${profile}`,`--remote-debugging-port=${debugPort}`,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
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
 const base=`http://127.0.0.1:${port}/designs/console/test/browser/header-fixture.html`;
 const mock = new URL('file://' + process.env.HEADER_MOCK).href;
 await until(async()=>(await fetch(base)).ok);
 for (const width of [1280,390]) {
  const desktop=width===1280;
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:mock});
  const clip=await until(()=>evaluate(`(() => {
   const frame=${desktop} ? document.querySelectorAll('.frame')[1] : document.querySelector('.frame.phone');
   if (!frame) return;
   const r=frame.getBoundingClientRect(); return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};
  })()`));
  const mockShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
  await writeFile(`${process.env.SHOTS}/mock-${width}.png`,Buffer.from(mockShot.data,'base64'));
  await call('Page.navigate',{url:base});
  const app=await until(()=>evaluate(`(() => {
   const header=document.querySelector('[data-conversation-header]');
   const picker=document.querySelector('.dock .model-picker-anchor');
   const ring=document.querySelector('.dock [data-context-state]');
   if (!header || !picker || !ring || !window.setCompactionCoverage) return;
   return {width:innerWidth,title:header.textContent.includes('Core worker'),oldPicker:!!header.querySelector('.model-picker-anchor'),
    picker:picker.textContent,ring:ring.dataset.contextState,actions:getComputedStyle(header.querySelector('.conversation-header-actions')).display,
    overflow:document.documentElement.scrollWidth>innerWidth, dockOverflow:document.querySelector('.dock').scrollWidth>document.querySelector('.dock').clientWidth+1};
  })()`));
  console.log(JSON.stringify({width,app}));
  assert.equal(app.width,width); assert(app.title&&!app.oldPicker&&!app.overflow&&!app.dockOverflow);
  assert(app.picker.includes('gpt-6.2-sol')); assert.equal(app.ring,'normal'); assert.equal(app.actions==='none',!desktop);
  const shot=await call('Page.captureScreenshot',{format:'png'});
  await writeFile(`${process.env.SHOTS}/studio-${width}.png`,Buffer.from(shot.data,'base64'));
  await evaluate("document.querySelector('.context-ring').closest('button').click(); true");
  await until(()=>evaluate("document.querySelector('#panel-tab-info')?.getAttribute('aria-selected') === 'true'"));
  if (!desktop) {
   await until(()=>evaluate("!!document.querySelector('dialog[open] #panel-page-info')"));
   await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  }
  if (desktop) {
   const menu = async (selector, name) => {
    const id=await evaluate(`(() => { const trigger=document.querySelector(${JSON.stringify(selector)}); trigger.click(); return trigger.getAttribute('aria-controls'); })()`);
    const facts=await until(()=>evaluate(`(() => {
      const node=document.getElementById(${JSON.stringify(id)}); const r=node?.getBoundingClientRect();
      if (!r?.width || !r.height) return;
      return { clip:{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}, entries:[...node.querySelectorAll('[role=menuitem]')].map(el=>({label:el.textContent.trim(),disabled:el.getAttribute('aria-disabled')})) };
    })()`));
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:facts.clip});
    await writeFile(`${process.env.SHOTS}/${name}.png`,Buffer.from(shot.data,'base64'));
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await until(()=>evaluate(`!document.getElementById(${JSON.stringify(id)})`));
    return facts.entries;
   };
   const header=await menu('[data-conversation-header] [aria-haspopup=menu]', 'header-menu');
   const sidebar=await menu('[data-sidebar-row][data-row-selected] [aria-haspopup=menu]', 'sidebar-menu');
   assert(header.length >= 5, JSON.stringify({header, sidebar}));
   assert(!header.some(({label}) => /Branches|ブランチ/.test(label)), JSON.stringify(header));
   assert.deepEqual(header.slice(1), sidebar.filter(({label}) => !["既読にする", "未読にする"].includes(label)));
   console.log(JSON.stringify({menuParity:header.slice(1)}));
  }


 }

}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
