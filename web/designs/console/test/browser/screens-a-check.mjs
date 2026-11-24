import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
const port=19897, debugPort=19898, profile=await mkdtemp('/tmp/studio17-browser-');
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
 const base=`http://127.0.0.1:${port}/designs/console/test/browser/screens-a-fixture.html`;
 await until(async()=>(await fetch(base)).ok);
 for (const width of [1440,500]) for (const screen of ['monitor','inbox','overview','tokens','threads','compaction','index','storage','memory']) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  const url=`${base}?screen=${screen}`;
  await call('Page.navigate',{url});
  await until(()=>evaluate(`location.href===${JSON.stringify(url)} && document.documentElement.dataset.fixtureReady==='true'`));
  const facts=await evaluate(`(() => {
    const page=document.querySelector('.mon,.inbox,.subview');
    const table=page.querySelector('table');
    const header=table?.tHead?.rows[0];const row=table?.tBodies[0]?.rows[0];
    const align=header&&row ? [...header.cells].every((cell,i)=>Math.abs(cell.getBoundingClientRect().left-row.cells[i].getBoundingClientRect().left)<1) : null;
    const link=page.querySelector('table a');
    return {fit:document.documentElement.scrollWidth<=innerWidth,align,linkHeight:link?.getBoundingClientRect().height,monitorField:!!page.querySelector('.monitor-tools .form-field-root svg'), title:!!page.querySelector('.pagehead h1')};
  })()`);
  if(process.env.PHASE==='after'){
   assert(facts.fit,`${screen}: viewport overflow`);
   if(width===1440 && facts.align!==null)assert(facts.align,`${screen}: table misalignment`);
   if(width===500 && screen==='threads' && facts.linkHeight!==undefined)assert(facts.linkHeight>=44);
   if(screen==='monitor')assert(facts.monitorField);
   if(screen==='inbox')assert(facts.title);
  }
  const shot=await call('Page.captureScreenshot',{format:'png'});
  await writeFile(`${process.env.SHOTS}/${process.env.PHASE}-${screen}-${width}.png`,Buffer.from(shot.data,'base64'));
  console.log(JSON.stringify({width,screen,...facts}));
 }

}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
