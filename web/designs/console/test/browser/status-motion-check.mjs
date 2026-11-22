import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
const port=19417, debugPort=19418, profile=await mkdtemp('/tmp/studio17-browser-');
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
 const base=`http://127.0.0.1:${port}/designs/console/test/browser/integration-fixture.html`;
 await until(async()=>(await fetch(base)).ok);
 for (const width of [390,768,1280]) for (const theme of ['console','light']) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:2,mobile:false});
  for (const [state,reduced] of [['running',false],['waiting',false],['completed',false],['running',true]]) {
   await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});
   const url=`${base}?theme=${theme}&state=${state}&reduce=${reduced}`;
   await call('Page.navigate',{url});
   const frame=await until(()=>evaluate(`(()=>{
    if(location.href!==${JSON.stringify(url)})return;
    const image=document.querySelector('.conversation-status img');
    if(!image?.complete||!image.naturalWidth||matchMedia("(prefers-reduced-motion: reduce)").matches!==${reduced})return;
    const footer=image.closest('.conversation-status'), rect=image.getBoundingClientRect(), bar=footer.getBoundingClientRect();
    return {src:image.currentSrc,x:rect.x,y:rect.y,width:rect.width,height:rect.height,bar:bar.height,
     text:footer.textContent,strip:document.querySelector('.work-strip')?.textContent,
     fixedFields:[...footer.querySelectorAll('span:not([data-status-description])')].every(node=>node.getBoundingClientRect().right<=bar.right && node.scrollWidth<=node.clientWidth+1)};
   })()`));
   assert.equal(frame.src.endsWith('#running'),state==='running'&&!reduced);
   if(state==='waiting')assert(frame.src.includes('thinking-24'));
   assert.equal(frame.width,24);assert.equal(frame.height,24);assert.equal(frame.bar,40);
   assert(frame.fixedFields,`${width}/${theme}/${state}: clipped fact`);
   if(state==='running'){
    assert(frame.text.includes('Running at least 2') && frame.text.includes('Verify query ranking') && frame.text.includes('1m'));
    assert(!frame.strip?.includes('Running at least'));
   }
   if(width!==390)continue;
   const frames=new Set();
   for(let i=0;i<8;i++){
    const shot=await call('Page.captureScreenshot',{format:'png',clip:{x:frame.x,y:frame.y,width:24,height:24,scale:1}});
    frames.add(shot.data);
    await delay(110);
   }
   assert.equal(frames.size>1,state==='running'&&!reduced,`${theme}/${state}/${reduced}: ${frames.size} distinct artwork frames`);
   console.log(JSON.stringify({width,theme,state,reduced,distinctFrames:frames.size,footerHeight:frame.bar}));
  }
 }
}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
