import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
const port=19779, debugPort=19780, profile=await mkdtemp('/tmp/studio79-profile-');
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
 const base=`http://127.0.0.1:${port}/designs/console/test/browser/summary-ring-fixture.html`;
 await until(async()=>(await fetch(base)).ok);
 for (const width of [1280,390]) for (const theme of ['console','light']) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await call('Page.navigate',{url:`${base}?theme=${theme}`});
  await until(()=>evaluate("!!window.setSummaryActivity && !!document.querySelector('.context-ring[data-context-state=normal]')"));
  await evaluate('window.setSummaryActivity(true)');
  await until(()=>evaluate("!!document.querySelector('.context-ring[data-context-state=summarizing]')"));
  const inspect = () => evaluate(`(() => {
   const ring=document.querySelector('.context-ring');
   const arc=ring.lastElementChild;
   const ringStyle=getComputedStyle(ring);
   const arcStyle=getComputedStyle(arc);
   const bounds=ring.closest('button').getBoundingClientRect();
   const amber=ringStyle.getPropertyValue('--wait').trim();
   const probe=document.createElement('span'); probe.style.color=amber; document.body.append(probe);
   const amberMatches=getComputedStyle(probe).color===ringStyle.color; probe.remove();
   return { state:ring.dataset.contextState,width:innerWidth, theme:document.documentElement.dataset.ds,
    label:ring.closest('button').getAttribute('aria-label'),amberMatches, rootAnimation:ringStyle.animationName, arcAnimation:arcStyle.animationName, dash:arcStyle.strokeDasharray,
    fits:bounds.left>=0 && bounds.right<=innerWidth && document.documentElement.scrollWidth<=innerWidth };
  })()`);
  const active=await inspect();
  assert.equal(active.width,width); assert.equal(active.theme,theme); assert.equal(active.state,'summarizing');
  assert(active.amberMatches && active.label.includes('要約中') && active.fits); assert.equal(active.rootAnimation,'context-ring-spin');
  assert.equal(active.arcAnimation,'none');
  const shot = async suffix => {
   const png=await call('Page.captureScreenshot',{format:'png'});
   await writeFile(`${process.env.SHOTS}/summary-${width}-${theme}-${suffix}.png`,Buffer.from(png.data,'base64'));
  };
  await shot('active');
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const still=await until(async()=>{const facts=await inspect(); return facts.rootAnimation==='none' && facts;});
  assert.equal(still.arcAnimation,'none');
  assert.notEqual(still.dash,active.dash); assert(still.amberMatches);
  await shot('reduced');
  await evaluate("document.querySelector('.context-ring').closest('button').click(); true");
  await until(()=>evaluate("document.querySelector('#panel-tab-info')?.getAttribute('aria-selected')==='true'"));
  assert.equal(await evaluate("!!document.querySelector('dialog[open] #panel-page-info')"), width===390);
  await evaluate('window.setSummaryActivity(false)');
  await until(()=>evaluate("document.querySelector('.context-ring')?.dataset.contextState==='normal' && !document.querySelector('.context-ring').closest('button').getAttribute('aria-label').includes('要約中')"));
  console.log(JSON.stringify({width,theme,active,reduced:still}));
 }

}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
