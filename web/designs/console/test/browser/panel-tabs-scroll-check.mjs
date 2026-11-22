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
 const evaluate=async expression=>{
  const result=await call('Runtime.evaluate',{expression,returnByValue:true});
  if(result?.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
 };
 const base='http://127.0.0.1:19438/designs/console/test/browser/integration-fixture.html?view=panel-tabs';
 const list='[data-panel-root] [role=tablist]';
 const toggle='[data-panel-root] button[aria-expanded]';
 const measure=()=>evaluate(`(()=>{
  const list=document.querySelector(${JSON.stringify(list)}), r=list.getBoundingClientRect();
  const style=getComputedStyle(list);
  return {left:r.left,right:r.right,clientWidth:list.clientWidth,scrollWidth:list.scrollWidth,scrollLeft:list.scrollLeft,
   overflow:style.overflowX,gap:style.gap,tabs:[...list.querySelectorAll('[role=tab]')].map(tab=>{
    const r=tab.getBoundingClientRect(), label=tab.querySelector('.panel-tab-label');
    const text=document.createRange();text.selectNode(label.firstChild);
    const body=text.getBoundingClientRect(), icon=tab.querySelector('svg').getBoundingClientRect();
    return {left:r.left,right:r.right,textLeft:body.left,textRight:body.right,iconRight:icon.right,
     label:label.firstChild.textContent,selected:tab.getAttribute('aria-selected')==='true',
     padding:getComputedStyle(tab).paddingInlineStart};
   })};
 })()`);
 function selectedVisible(geometry){
  const selected=geometry.tabs.find(tab=>tab.selected);
  return selected.left>=geometry.left-1 && selected.right<=geometry.right+1;
 }
 await until(async()=>(await fetch(base)).ok);
 for(const lang of ['en','ja']) for(const appWidth of [1180,1280,1440]) for(const panelWidth of [190,250,340]){
  const key=`${lang}/${appWidth}/${panelWidth}`;
  const url=`${base}&lang=${lang}&width=${appWidth}&panel=${panelWidth}`;
  await call('Emulation.setDeviceMetricsOverride',{width:appWidth,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});
  await until(()=>evaluate(`location.href===${JSON.stringify(url)} && typeof window.publishPanelTabsCount==='function' && !!document.querySelector('#panel-tab-info')`));
  await evaluate(`document.querySelector('[data-panel-root]').style.setProperty('--size-details','${panelWidth+33}px')`);
  const initial=await measure();
  assert.equal(initial.clientWidth,panelWidth,key);
  assert.equal(initial.gap,'2px',key);
  assert.equal(initial.overflow,'auto',key);
  assert(initial.tabs.some(tab=>tab.label===(lang==='en'?'Information':'情報')),`locale not applied: ${key}`);
  for(const [i,tab] of initial.tabs.entries()){
   assert.equal(tab.padding,'10px',key);
   assert(tab.iconRight+5.5<=tab.textLeft && tab.textRight<=tab.right,`label does not fit its own tab: ${key}`);
   if(i)assert(initial.tabs[i-1].right<=tab.left,`overlap: ${key}`);
  }
  if(panelWidth===190)assert(initial.scrollWidth>initial.clientWidth,`narrow row did not overflow: ${key}`);
  assert.equal(await evaluate(`document.querySelector('#panel-tab-reply-needed .panel-tab-count')===null`),true,key);
  await evaluate(`document.querySelector(${JSON.stringify(list)}).scrollLeft=10000`);
  const before=await measure();
  if(before.scrollWidth>before.clientWidth)assert(!selectedVisible(before),`manual scroll did not move away from selection: ${key}`);
  await evaluate('window.publishPanelTabsCount()');
  await until(()=>evaluate(`document.querySelector('#panel-tab-reply-needed .panel-tab-count')?.textContent==='1'`));
  const counted=await measure();
  assert.equal(counted.scrollLeft,before.scrollLeft,`count update reset manual scroll: ${key}`);
  assert.deepEqual(counted.tabs,before.tabs,`count update moved the tabs: ${key}`);
  await evaluate(`document.querySelector(${JSON.stringify(list)}).scrollLeft=0; document.querySelector('#panel-tab-info').click()`);
  const selected=await measure();
  assert(selected.tabs.at(-1).selected && selectedVisible(selected),`selection was not revealed: ${key}`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(list)}).querySelector('[role=tooltip]')===null`),true,key);

  await evaluate(`document.querySelector(${JSON.stringify(toggle)}).click()`);
  const rail=await evaluate(`(()=>{
   const list=document.querySelector('[data-panel-rail] [role=tablist]');
   const tab=list.querySelector('#panel-tab-reply-needed'), badge=tab.querySelector('.panel-tab-count');
   return {orientation:list.getAttribute('aria-orientation'),overflow:getComputedStyle(list).overflowX,
    gap:getComputedStyle(list).gap,buttonGap:getComputedStyle(tab).gap,alignment:getComputedStyle(tab).alignItems,
    badgeRadius:getComputedStyle(badge).borderRadius,badgePosition:getComputedStyle(badge).position,
    badgeAlign:getComputedStyle(badge).textAlign};
  })()`);
  assert.deepEqual(rail,{orientation:'vertical',overflow:'visible',gap:'4px',buttonGap:'4px',alignment:'center',
   badgeRadius:'999px',badgePosition:'absolute',badgeAlign:'center'},key);
  const tooltipOutside=()=>evaluate(`(()=>{
   const tab=document.querySelector('#panel-tab-info'), tip=document.getElementById(tab.getAttribute('aria-describedby'));
   const r=tip.getBoundingClientRect(), t=tab.getBoundingClientRect();
   return r.width>0 && r.right<=t.left+1 && document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===tip;
  })()`);
  // Programmatic focus follows keyboard modality after a real Tab key press.
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await evaluate(`document.querySelector('#panel-tab-info').focus()`);
  assert(await tooltipOutside(),`focused rail tooltip is clipped: ${key}`);
  const point=await evaluate(`(()=>{const r=document.querySelector('#panel-tab-info').getBoundingClientRect();document.activeElement.blur();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await until(tooltipOutside);
  await evaluate(`document.querySelector(${JSON.stringify(toggle)}).click()`);
  assert(selectedVisible(await measure()),`re-expansion did not reveal the selection: ${key}`);
  console.log(JSON.stringify({lang,appWidth,panelWidth,scrollWidth:initial.scrollWidth,manualScroll:before.scrollLeft,railTooltip:'focus and hover'}));
 }
}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=once(p,'exit');p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
