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
 const before=process.env.BASELINE==='1';
 const capture=async name=>{const shot=await call('Page.captureScreenshot',{format:'png'});await writeFile(`${process.env.SHOTS}/${before?'before':'after'}-${name}.png`,Buffer.from(shot.data,'base64'));};
 for(const width of [1280,390]) for(const theme of ['console','light']){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${base}?width=${width}&theme=${theme}&longModel`});
  await until(()=>evaluate("!!window.setRun && !!document.querySelector('.context-ring')"));
  await evaluate('window.setRun(false)');
  const ringX=()=>evaluate("document.querySelector('.context-ring').getBoundingClientRect().x");
  const idle=await ringX();
  await capture(`${width}-${theme}-idle`);
  await evaluate('window.setRun(true)');
  await until(()=>evaluate("!!document.querySelector('.composer-row .btn-stop')"));
  const running=await ringX();
  if(!before) assert.equal(idle,running);
  const layout=await evaluate(`(() => {
   const row=document.querySelector('.composer-row');
   const chip=row.querySelector('.model-picker-anchor>.btn');
   const actions=[...row.querySelectorAll('.right button')];
   const buttons=[chip,...actions];
   const token=getComputedStyle(row);
   const box=el=>el.getBoundingClientRect();
   const center=el=>box(el).y+box(el).height/2;
   const style=getComputedStyle(chip);
   const label=chip.firstElementChild;
   const labelProbe=document.createElement('span');
   labelProbe.style.font='var(--type-label)';row.append(labelProbe);
   const role=getComputedStyle(labelProbe);
   const labelType=style.fontSize===role.fontSize && style.lineHeight===role.lineHeight && style.fontWeight===role.fontWeight;
   labelProbe.remove();
   return {theme:document.documentElement.dataset.ds,labelType,
    inset:parseFloat(style.paddingInlineStart),end:parseFloat(style.paddingInlineEnd),space:parseFloat(token.getPropertyValue('--space-8')),
    min:parseFloat(token.getPropertyValue(innerWidth<900?'--size-touch':'--size-control')),
    heights:buttons.map(el=>box(el).height),centers:buttons.map(center),
    gaps:actions.slice(1).map((el,i)=>box(el).left-box(actions[i]).right),
    usableLabel:!label || (label.clientWidth>0 && getComputedStyle(label).textOverflow==='ellipsis'),
    overflow:row.scrollWidth>row.clientWidth+1};
  })()`);
  assert.equal(layout.theme,theme);
  if(!before){
   assert(layout.labelType && layout.usableLabel && !layout.overflow,JSON.stringify(layout));
   assert.equal(layout.inset,layout.space); assert.equal(layout.end,layout.space);
   assert(layout.heights.every(h=>h>=layout.min));
   assert(layout.centers.every(y=>Math.abs(y-layout.centers[0])<0.5));
   assert(layout.gaps.every(g=>Math.abs(g-layout.space)<0.5));
  }
  await capture(`${width}-${theme}-running`);
  if(!before){
   assert.equal(await evaluate("document.querySelectorAll('[data-conversation-header] .shell-toggle-panel').length"),0);
   const visible=await evaluate("[...document.querySelectorAll('.shell-toggle-panel')].filter(b=>b.getClientRects().length).length");
   assert.equal(visible,1);
   if(width===390){
    const target=await evaluate("(() => {const b=document.querySelector('.phone-panel-footer button');const r=b.getBoundingClientRect();return [r.width,r.height,parseFloat(getComputedStyle(b).getPropertyValue('--size-touch'))];})()");
    assert(target[0]>=target[2] && target[1]>=target[2]);
    await evaluate("document.querySelector('.phone-panel-footer button').click();true");
    await until(()=>evaluate("!!document.querySelector('dialog[open] [data-phone-panel]')"));
    await evaluate("document.querySelector('dialog[open] .work-sheet-head button').click();true");
    await until(()=>evaluate("!document.querySelector('dialog[open]') && document.activeElement===document.querySelector('.phone-panel-footer button')"));
   }
  }
  await evaluate("document.querySelector('.model-picker-anchor>button').click();true");
  await until(()=>evaluate("(async()=>{await window.flushOwner();return !!document.querySelector('.model-picker-list button');})()"));
  assert.equal(await evaluate("[...document.querySelectorAll('.model-picker input')].some(input=>input.getAttribute('aria-label')?.includes('Thread override'))"),before);
  await capture(`${width}-${theme}-picker`);
  console.log(JSON.stringify({width,theme,idle,running,before,layout}));
 }

}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
