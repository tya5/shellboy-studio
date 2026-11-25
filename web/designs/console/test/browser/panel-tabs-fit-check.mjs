import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
const chromePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile=await mkdtemp('/tmp/studio164-tabs-chrome-');
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','designs/console/test/browser/vite.config.mjs','--host','127.0.0.1','--port','19438','--strictPort'],{stdio:'inherit'});
const chrome=spawn(chromePath,['--headless','--disable-gpu','--no-first-run','--use-mock-keychain','--password-store=basic','--disable-extensions',`--user-data-dir=${profile}`,'--remote-debugging-port=19439','about:blank'],{stdio:'ignore'});
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
 const toggle='[data-panel-root] .shell-footer-right .shell-toggle-panel';
 const measure=()=>evaluate(`(()=>{
  const list=document.querySelector(${JSON.stringify(list)}), r=list.getBoundingClientRect();
  const style=getComputedStyle(list);
  return {left:r.left,right:r.right,mode:list.dataset.labels,width:list.clientWidth,scrollWidth:list.scrollWidth,
   overflow:style.overflowX,tabs:[...list.querySelectorAll('[role=tab]')].map(tab=>{
    const r=tab.getBoundingClientRect(), label=tab.querySelector('.panel-tab-label');
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,label:label.textContent,
     shown:label.getClientRects().length>0,name:tab.getAttribute('aria-label'), selected:tab.getAttribute('aria-selected')==='true',
     badge:tab.querySelector('.panel-tab-count')?.textContent};
   })};
 })()`);
 function checkGeometry(g, mode, key){
  assert.equal(g.mode,mode,key);
  assert.equal(g.overflow,'visible',key);
  assert.equal(g.scrollWidth,g.width,key);
  for (const tab of g.tabs) {
   assert(tab.left>=g.left-1 && tab.right<=g.right+1,key);
   assert.equal(tab.shown,mode==='all'||(mode==='active'&&tab.selected),key);
   assert.equal(tab.name,tab.label+(tab.badge?' '+tab.badge:''),key);
  }
  assert.equal(new Set(g.tabs.map(tab=>tab.top)).size,1,`one row: ${key}`);
  for(const [i,tab] of g.tabs.entries()) for(const peer of g.tabs.slice(i+1)) {
   assert(tab.right<=peer.left || peer.right<=tab.left || tab.bottom<=peer.top || peer.bottom<=tab.top,`overlap: ${key}`);
  }
 }
 await until(async()=>(await fetch(base)).ok);
 for(const lang of ['en','ja']) for(const appWidth of [1600,1440]) for(const panelWidth of [null,247,340]){
  const key=`${lang}/${appWidth}/${panelWidth??'default'}`;
  const url=`${base}&lang=${lang}&width=${appWidth}${panelWidth===null?'':`&panel=${panelWidth}`}`;
  await call('Emulation.setDeviceMetricsOverride',{width:appWidth,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url});
  await until(()=>evaluate(`location.href===${JSON.stringify(url)} && typeof window.publishPanelTabsCount==='function' && !!document.querySelector('#panel-tab-info')`));
  if(panelWidth!==null) await evaluate(`document.querySelector('[data-panel-root]').style.setProperty('--size-right-panel','${panelWidth+33}px')`);
  const initial=await until(async()=>{const g=await measure();return g.width===(panelWidth??307)&&g.mode==='active'&&g});
  checkGeometry(initial,'active',key);
  assert(initial.tabs.some(tab=>tab.label===(lang==='en'?'Analytics':'分析')),key);
  await evaluate('window.publishPanelTabsCount()');
  await until(()=>evaluate(`document.querySelector('#panel-tab-reply-needed .panel-tab-count')?.textContent==='1'`));
  checkGeometry(await measure(),'active',key);
  for (const [id, label] of (lang==='en' ? [['reply-needed','Reply needed'],['awaiting-reply','Awaiting reply']] : [['reply-needed','要返信'],['awaiting-reply','返信待ち']])) {
   await evaluate(`document.querySelector('#panel-tab-${id}').click()`);
   const g = await until(async()=> {const g=await measure();return g.tabs.some(tab=>tab.selected && tab.label===label)&&g});
   checkGeometry(g,'active',key);
   assert(g.tabs.at(-1).right<=g.right+1,key);
  }
  await evaluate(`document.querySelector('#panel-tab-settings').focus()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
  await until(()=>evaluate(`document.activeElement.id==='panel-tab-info' && document.activeElement.getAttribute('aria-selected')==='true'`));
  checkGeometry(await measure(),'active',key);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(list)}).querySelector('[role=tooltip]')===null`),true,key);

  // Give the same strip more space; selection/focus must survive both transitions.
  if(panelWidth!==null){
  await call('Emulation.setDeviceMetricsOverride',{width:2400,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.querySelector('[data-panel-root]').style.setProperty('--size-right-panel','190px')`);
  await until(async()=> (await measure()).mode==='icons');
  checkGeometry(await measure(),'icons',key);
  assert(await evaluate(`document.querySelector('.panel-tabs-heading')?.innerText.includes(${JSON.stringify(lang==='en'?'Analytics':'分析')})`),key);
  await evaluate(`document.querySelector('[data-panel-root]').style.setProperty('--size-right-panel','1000px')`);
  await until(async()=> (await measure()).mode==='all');
  checkGeometry(await measure(),'all',key);
  if(panelWidth!==null) await evaluate(`document.querySelector('[data-panel-root]').style.setProperty('--size-right-panel','${panelWidth+33}px')`);
  await until(async()=> (await measure()).mode==='active');
  assert(await evaluate(`document.activeElement.id==='panel-tab-info'`),key);
  }

  await evaluate(`document.querySelector(${JSON.stringify(toggle)}).click()`);
  const collapsedPanel=await evaluate(`(()=>{
   const panels=[...document.querySelectorAll('.panel-pages [role=tabpanel]')];
   const active=document.querySelector('#panel-page-info');
   const focusable=panels.flatMap(panel=>[...panel.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]);
   const rail=document.querySelector('[data-panel-root][data-panel-rail]'), footer=rail.querySelector(':scope > .shell-footer-right');
   return {activeHidden:active.hidden,allPanelsHidden:panels.every(panel=>panel.hidden),
    descendantsFocusable:focusable.some(node=>node.getClientRects().length>0 && getComputedStyle(node).visibility!=='hidden'),
    footerVisible:footer.getClientRects().length>0,railVisible:rail.getClientRects().length>0};
  })()`);
  assert.deepEqual(collapsedPanel,{activeHidden:true,allPanelsHidden:true,descendantsFocusable:false,footerVisible:true,railVisible:true},key);
  const rail=await evaluate(`(()=>{
   const list=document.querySelector('[data-panel-rail] [role=tablist]');
   const tab=list.querySelector('#panel-tab-reply-needed'), badge=tab.querySelector('.panel-tab-count');
   return {orientation:list.getAttribute('aria-orientation'),overflow:getComputedStyle(list).overflowX,
    gap:getComputedStyle(list).gap,buttonGap:getComputedStyle(tab).gap,alignment:getComputedStyle(tab).alignItems,
    badgeRounded:parseFloat(getComputedStyle(badge).borderRadius)===badge.getBoundingClientRect().height/2,badgePosition:getComputedStyle(badge).position,
    badgeAlign:getComputedStyle(badge).textAlign};
  })()`);
  assert.deepEqual(rail,{orientation:'vertical',overflow:'visible',gap:'4px',buttonGap:'4px',alignment:'center',
   badgeRounded:true,badgePosition:'absolute',badgeAlign:'center'},key);
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
  checkGeometry(await measure(),'active',key);
  const expandedPanel=await evaluate(`(()=>({activeHidden:document.querySelector('#panel-page-info').hidden,
   activeVisible:document.querySelector('#panel-page-info').getClientRects().length>0}))()`);
  assert.deepEqual(expandedPanel,{activeHidden:false,activeVisible:true},key);
  console.log(JSON.stringify({lang,appWidth,panelWidth,scrollWidth:initial.scrollWidth,variants:'active/all/active',railTooltip:'focus and hover'}));
 }
}finally{
 ws?.close();for(const p of [chrome,vite])if(p.exitCode===null){const done=once(p,'exit');p.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true});
}
