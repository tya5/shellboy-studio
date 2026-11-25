import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
const port=19635, debugPort=19636, profile=await mkdtemp('/tmp/studio35-profile-');
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
 const base=`http://127.0.0.1:${port}/designs/console/test/browser/artifact-fixture.html`;
 const mock = new URL('file://' + process.env.ARTIFACTS_MOCK).href;
 await until(async()=>(await fetch(base)).ok);
 for (const width of [1280,390]) {
  const desktop=width===1280;
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:mock});
  const mockPanels=await until(()=>evaluate(`(() => {
   const list=${desktop} ? document.querySelector('.frames figure:first-child aside') : document.querySelector('.phone aside');
   const detail=document.querySelector('.frames .details.tall');
   if (!list || !detail) return;
   return [list,detail].map(el=>{const r=el.getBoundingClientRect(); return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};});
  })()`));
  for (const [i, name] of ['list','detail'].entries()) {
   const img=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:mockPanels[i]});
   await writeFile(`${process.env.SHOTS}/mock-${name}-${width}.png`,Buffer.from(img.data,'base64'));
  }
  await call('Page.navigate',{url:base});
  await until(()=>evaluate("typeof window.runArtifactFixture === 'function'"));
  const list=await evaluate("window.runArtifactFixture('list')");
  console.log(JSON.stringify({width,list}));
  assert.equal(list.panels,1); assert.equal(list.sheet,!desktop); assert.deepEqual(list.bands,['成果物','添付']);
  assert.deepEqual(list.rows,['report','diagram','price','notes','attachment-0','attachment-1']);
  assert(!list.overflow); if(!desktop) assert(list.heights.every(h=>h===44));
  const capturePanel=async(name)=>{
   const clip=await evaluate(`(() => {const r=document.querySelector('[data-panel-root]').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1}})()`);
   const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
   await writeFile(`${process.env.SHOTS}/studio-${name}-${width}.png`,Buffer.from(shot.data,'base64'));
  };
  await capturePanel('list');
  await until(()=>evaluate("!!document.querySelector('[data-panel-row-id=report] [data-artifact-reveal-status]')"));
  const reveal = await evaluate('window.measureArtifactReveal()');
  console.log(JSON.stringify({width,reveal}));
  assert(reveal.before.titleWidth > 0);
  assert.deepEqual(reveal.during,reveal.before,'Reveal toast must not move the button or resize the title');
  assert.deepEqual(reveal.after,reveal.before,'Status expiry must not move the button or resize the title');
  assert(reveal.successBelowTitle && reveal.errorBelowTitle, 'Both reveal messages must fit below the title');
  assert.deepEqual(reveal.failed,reveal.before,'Failure status must not move the button or resize the title');
  await evaluate("window.runArtifactFixture('detail')");
  const old=await evaluate("window.runArtifactFixture('old')");
  console.log(JSON.stringify({width,old}));
  assert(old.detail.includes('/fixture/reports/weekly-v2.md'));assert(old.preview.includes('次の手順'));assert(!old.overflow);
  assert.deepEqual(old.previewCalls.map(p=>p.version),[3,2]);
  assert(old.previewCalls.every(p=>Object.keys(p).sort().join(',')==='action,artifact_id,thread_id,version'));
  await capturePanel('detail');
  const image=await evaluate("window.runArtifactFixture('image')");
  assert.match(image.src,/^data:image\/svg\+xml;base64,/);
  assert.equal(image.width,8);
 }

}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
