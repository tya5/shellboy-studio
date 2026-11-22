import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
const chromePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile=await mkdtemp('/tmp/studio38-tabs-chrome-');
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','designs/console/test/browser/vite.config.mjs','--host','127.0.0.1','--port','19438','--strictPort'],{stdio:'inherit'});
const chrome=spawn(chromePath,['--headless','--disable-gpu','--no-first-run','--disable-extensions',`--user-data-dir=${profile}`,'--remote-debugging-port=19439','about:blank'],{stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws;
async function until(fn){for(let i=0;i<100;i++){try{const v=await fn();if(v)return v;}catch{}await delay(100)}throw Error('timed out');}
try{
 const info=await until(async()=>(await(await fetch('http://127.0.0.1:19439/json')).json()).find(x=>x.type==='page'));
 ws=new WebSocket(info.webSocketDebuggerUrl);await once(ws,'open');let seq=0;const pending=new Map();
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id)}};
 const call=(method,params={})=>new Promise(resolve=>{pending.set(++seq,resolve);ws.send(JSON.stringify({id:seq,method,params}))});
 const evaluate=async expression=>(await call('Runtime.evaluate',{expression,returnByValue:true})).result?.value;
 const base='http://127.0.0.1:19438/designs/console/test/browser/integration-fixture.html';
 await until(async()=>(await fetch(base)).ok);
 for(const lang of ['en','ja']) for(const appWidth of [1180,1280,1440]) for(const panelWidth of [190,250,340]){
  await call('Emulation.setDeviceMetricsOverride',{width:appWidth,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${base}?lang=${lang}`});
  await until(()=>evaluate(`(()=>{const e=document.querySelector('.details [role=tablist]');return e&&e.querySelectorAll('[role=tab]').length>=4})()`));
  const result=await evaluate(`(()=>{const list=document.querySelector('.details [role=tablist]');list.style.width='${panelWidth}px';list.style.flex='none';const tabs=[...list.querySelectorAll('[role=tab]')];return {scrollWidth:list.scrollWidth,clientWidth:list.clientWidth,left:list.getBoundingClientRect().left,right:list.getBoundingClientRect().right,overflow:getComputedStyle(list).overflowX,tabs:tabs.map(b=>{const r=b.getBoundingClientRect(),lr=b.querySelector('.panel-tab-label').getBoundingClientRect(),ir=b.querySelector('svg').getBoundingClientRect();return {left:r.left,right:r.right,labelLeft:lr.left,labelRight:lr.right,iconRight:ir.right,width:b.scrollWidth,client:b.clientWidth}})}})()`);
  assert.equal(result.tabs.length,4);
  assert(result.clientWidth>0,`tablist is not visible at ${lang}/${appWidth}/${panelWidth}`);
  for(const tab of result.tabs){assert(tab.width<=tab.client,`label clipped at ${lang}/${appWidth}/${panelWidth}`);assert(tab.left>=result.left-0.5 && tab.right<=result.left+result.scrollWidth+0.5,`tab outside scroll content at ${lang}/${appWidth}/${panelWidth}`)}
  for(let i=1;i<result.tabs.length;i++)assert(result.tabs[i-1].right<=result.tabs[i].left,`overlap at ${lang}/${appWidth}/${panelWidth}`);
  for(const tab of result.tabs)assert(tab.iconRight+5.5<=tab.labelLeft,`icon/label gap at ${lang}/${appWidth}/${panelWidth}`);
  const beforeBadges=await evaluate(`(()=>{const tabs=[...document.querySelectorAll('.details [role=tab]')];for(const b of tabs)b.querySelector('.panel-tab-count')?.remove();return tabs.map(b=>{const r=b.getBoundingClientRect();return [r.left,r.right]})})()`);
  await evaluate(`document.querySelectorAll('.details .panel-tab-label').forEach(label=>{const badge=document.createElement('span');badge.className='panel-tab-count';badge.textContent='9';label.append(badge)})`);
  assert.deepEqual(await evaluate(`(()=>[...document.querySelectorAll('.details [role=tab]')].map(b=>{const r=b.getBoundingClientRect();return [r.left,r.right]}))()`),beforeBadges,`badge changed tab positions ${lang}/${appWidth}/${panelWidth}`);
  const selectedStyle=await evaluate(`(()=>{const b=document.querySelector('.details [aria-selected=true]');return {weight:getComputedStyle(b).fontWeight,underline:getComputedStyle(b).borderBottomColor}})()`);
  assert(Number(selectedStyle.weight)>=700,`selected tab is not bold: ${lang}/${appWidth}/${panelWidth}`);
  assert.equal(result.overflow,'auto');
  const railOverflow=await evaluate(`(()=>{const rail=document.createElement('div');rail.className='panel-tabs panel-tabs-rail';rail.style.cssText='position:fixed;left:4px;top:4px;width:44px;height:180px';rail.innerHTML='<button><svg></svg><span class="panel-tab-label">Rail label</span><span class="panel-tab-tip">Rail tooltip</span></button>';document.body.append(rail);const overflow=getComputedStyle(rail).overflowX;rail.remove();return overflow})()`);
  assert.equal(railOverflow,'visible',`vertical rail must not inherit horizontal scrolling at ${lang}/${appWidth}/${panelWidth}`);
  if(panelWidth<340)assert(result.scrollWidth>result.clientWidth,`expected horizontal overflow at ${lang}/${appWidth}/${panelWidth}`);
  await evaluate(`document.querySelectorAll('.details [role=tab]')[3].click()`);
  const selected=await evaluate(`(()=>{const list=document.querySelector('.details [role=tablist]'),b=list.querySelector('[aria-selected=true]'),r=b.getBoundingClientRect(),p=list.getBoundingClientRect();return {left:r.left,right:r.right,viewportLeft:p.left,viewportRight:p.right,scrollLeft:list.scrollLeft}})()`);
  assert(selected.left>=selected.viewportLeft-0.5 && selected.right<=selected.viewportRight+0.5,`selected tab not revealed ${lang}/${appWidth}/${panelWidth}`);
  console.log(JSON.stringify({lang,appWidth,panelWidth,scrollWidth:result.scrollWidth,clientWidth:result.clientWidth,scrollLeft:selected.scrollLeft,selectedVisible:true}));
 }
}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=once(p,'exit');p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
