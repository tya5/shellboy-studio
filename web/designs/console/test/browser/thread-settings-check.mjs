import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
const port=19783, debugPort=19784, profile=await mkdtemp('/tmp/studio80-profile-');
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
 const mock = process.env.STUDIO80_MOCK;
 if (mock) {
  await call('Emulation.setDeviceMetricsOverride', {width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate', {url:new URL(`file://${mock}`).href});
  for (const [name,selector] of [['desktop','#desktop .frame:nth-child(2)'],['phone','#phone .frame']]) {
   const clip=await until(()=>evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();return r?.height ? {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1} : undefined;})()`));
   const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
   await writeFile(`${process.env.SHOTS}/mock-${name}.png`,Buffer.from(shot.data,'base64'));
  }
 }
 const base=`http://127.0.0.1:${port}/designs/console/test/browser/thread-settings-fixture.html`;
 await until(async()=>(await fetch(base)).ok);
 for (const width of [1280,390]) for (const theme of ["console","light"]) {
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${base}?theme=${theme}`});
  await until(()=>evaluate("!!document.querySelector('.dock .model-picker-anchor button')"));
  await evaluate("document.querySelector('.dock .model-picker-anchor button').click(); true");
  await until(()=>evaluate("!![...document.querySelectorAll('.model-picker button')].find(b=>b.textContent.includes('このスレッドの設定'))"));
  await evaluate("[...document.querySelectorAll('.model-picker button')].find(b=>b.textContent.includes('このスレッドの設定')).click(); true");
  const facts=await until(()=>evaluate(`(() => {
    const p=document.querySelector('#panel-page-settings:not([hidden])');
    const target=p?.querySelector('[data-highlighted]');
    if (!target?.getBoundingClientRect().width) return;
    const tabs=p.closest('[data-panel-root]').querySelector('[role=tablist]');
    return {width:innerWidth,sheet:!!p.closest('dialog[open]'),rows:p.querySelectorAll('[data-setting-id]').length,
      title:target.dataset.settingId, overflow:document.documentElement.scrollWidth>innerWidth || p.scrollWidth>p.clientWidth+1,
      tabs:tabs.querySelectorAll('[role=tab]').length,theme:p.closest('[data-ds]')?.getAttribute('data-ds'), read:p.querySelector('[data-setting-id="thread.max_tokens"]').textContent};
  })()`));
  assert.equal(facts.width,width); assert.equal(facts.sheet,width===390); assert.equal(facts.rows,11);
  assert.equal(facts.tabs,6); assert.equal(facts.theme,theme); assert.equal(facts.title,'thread.connection'); assert.equal(facts.overflow,false); assert(facts.read.includes('8192') && facts.read.includes('このスレッドで設定'));
  const shot=await call('Page.captureScreenshot',{format:'png'});
  await writeFile(`${process.env.SHOTS}/settings-${width}-${theme}.png`,Buffer.from(shot.data,'base64'));
  await evaluate("document.querySelector('#panel-page-settings [data-setting-id=\"thread.connection\"] button').click(); true");
  await until(()=>evaluate("document.activeElement?.getAttribute('aria-label')==='接続先'"));
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await until(()=>evaluate("document.activeElement?.textContent==='変更'"));
  await evaluate("document.querySelector('#panel-tab-info').click(); true");
  await until(()=>evaluate("document.querySelector('#panel-page-info:not([hidden])')?.textContent.includes('トークン')"));
  await until(()=>evaluate("document.querySelector('#panel-page-info table')?.rows.length>1"));
  const analysis=await evaluate("document.querySelector('#panel-page-info').textContent");
  assert(analysis.includes('圧縮')&&!analysis.includes('gpt-6.2-sol')&&!analysis.includes('保存'));
  const analytics=await call('Page.captureScreenshot',{format:'png'});
  await writeFile(`${process.env.SHOTS}/analytics-${width}-${theme}.png`,Buffer.from(analytics.data,'base64'));
  await evaluate("(() => { const tab=document.querySelector('#panel-tab-settings'); tab.focus(); tab.click(); return true; })()");
  await until(()=>evaluate("!!document.querySelector('#panel-page-settings:not([hidden]) [data-setting-id]')"));
  assert(await evaluate("!document.querySelector('#panel-page-settings [data-highlighted]') && document.activeElement === document.querySelector('#panel-tab-settings')"));
  console.log(JSON.stringify({width,theme,facts}));
 }

}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=new Promise(resolve=>p.once('exit',resolve));p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
