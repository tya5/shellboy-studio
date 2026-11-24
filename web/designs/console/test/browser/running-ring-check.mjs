import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
const port=19831, debugPort=19832, profile=await mkdtemp('/tmp/studio83-browser-');
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
 for (const width of [1280,390]) for (const theme of ['console','light']) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  const url=`${base}?view=sidebar&theme=${theme}&state=running`;
  await call('Page.navigate',{url});
  await until(()=>evaluate(`location.href===${JSON.stringify(url)} && !!document.querySelector('#thread-sidebar [data-status=running] svg')`));
  if(width===390) await evaluate("document.querySelector('[data-conversation-header] .menu button').click(); true");
  const rowAction = "#thread-sidebar [data-sidebar-row]:has([data-running-arc]) button[aria-haspopup=menu]";
  await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(rowAction)})`));
  await evaluate(`document.querySelector(${JSON.stringify(rowAction)}).focus(); true`);
  const facts=()=>evaluate(`(()=>{
   const side=document.querySelector('#thread-sidebar');
   const svg=side?.querySelector('[data-status=running] svg');
   const motion=svg?.closest('.status-shape[data-running-arc]');
   if(!svg || !motion || side.getBoundingClientRect().right<=0) return;
   const mark=svg.parentElement.getBoundingClientRect();
   const style=getComputedStyle(motion);
   const arc=svg.querySelector("circle"), arcStyle=getComputedStyle(arc);
   const action=svg.closest("[data-sidebar-row]").querySelector("button[aria-haspopup=menu]");
   return {theme:document.documentElement.dataset.ds,layoutMark:{width:svg.parentElement.offsetWidth,height:svg.parentElement.offsetHeight},animation:style.animationName,dash:arcStyle.strokeDasharray,stroke:arcStyle.strokeWidth,vector:arcStyle.vectorEffect,menu:getComputedStyle(action).visibility,opacity:getComputedStyle(action).opacity,transform:style.transform,mark:{x:mark.x,y:mark.y,width:mark.width,height:mark.height},
    allRunning:[...document.querySelectorAll('[data-running-arc]')].every(el=>getComputedStyle(el).animationName===style.animationName),
    svgStill:[...document.querySelectorAll('[data-running-arc] svg')].every(el=>getComputedStyle(el).animationName==='none'),
    character:[...document.querySelectorAll('.character-thinking[data-running] .character-dot-motion')].map(el=>({animation:getComputedStyle(el).animationName,delay:getComputedStyle(el).animationDelay,svgAnimation:getComputedStyle(el.querySelector('svg')).animationName,hasRunning:el.hasAttribute('data-running')})),
    others:[...side.querySelectorAll('[data-status]:not([data-status=running]) svg')].every(el=>getComputedStyle(el).animationName==='none')};
  })()`);
  const initial=await until(async()=>{const f=await facts();return f?.mark.x>=0 && f;});
  assert.equal(initial.theme,theme);assert.equal(initial.animation,'status-arc-spin');assert.equal(initial.dash,'78px, 22px');assert.equal(initial.stroke,'2.4px');assert.equal(initial.vector,'none');
  assert.equal(initial.menu,'visible');assert.equal(initial.opacity,'1');
  assert(initial.allRunning && initial.svgStill && initial.others);assert.equal(initial.layoutMark.width,initial.layoutMark.height);
  assert.equal(initial.character.length,3);assert(initial.character.every(dot=>dot.animation==='character-hop' && dot.svgAnimation==='none' && !dot.hasRunning));
  assert.deepEqual(initial.character.map(dot=>dot.delay),['0s','0.15s','0.3s']);
  const save=async suffix=>{
   const shot=await call('Page.captureScreenshot',{format:'png'});
   await writeFile(`${process.env.SHOTS}/sidebar-${width}-${theme}-${suffix}.png`,Buffer.from(shot.data,'base64'));
  };
  await save('running');
  if(width===1280 && theme==='console'){
   const clip={...initial.mark,scale:1};
   const first=await call('Page.captureScreenshot',{format:'png',clip});
   await delay(350);
   const second=await call('Page.captureScreenshot',{format:'png',clip});
   assert.notEqual(first.data,second.data);
   await writeFile(`${process.env.SHOTS}/rotation-a.png`,Buffer.from(first.data,'base64'));
   await writeFile(`${process.env.SHOTS}/rotation-b.png`,Buffer.from(second.data,'base64'));
  }
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reduced=await until(async()=>{const f=await facts();return f?.animation==='none' && f;});
  assert.equal(reduced.dash,initial.dash);assert.equal(reduced.vector,'none');assert.equal(reduced.transform,'none');
  assert.deepEqual(reduced.layoutMark,initial.layoutMark);
  assert(reduced.allRunning && reduced.others);assert(reduced.character.every(dot=>dot.animation==='none' && dot.svgAnimation==='none'));
  await save('reduced');
  console.log(JSON.stringify({width,theme,initial,reduced}));
 }

}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
