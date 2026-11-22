import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const appPort=19565, debugPort=19566;
const browser=process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile=await mkdtemp(join(tmpdir(),'studio63-mounted-'));
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','designs/console/test/browser/vite.config.mjs','--host','127.0.0.1','--port',String(appPort),'--strictPort'],{stdio:'ignore'});
const chrome=spawn(browser,['--headless','--disable-gpu','--disable-extensions','--no-first-run',`--user-data-dir=${profile}`,'--remote-debugging-port='+debugPort,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let ws, evaluate;
async function until(fn){for(let i=0;i<100;i++){try{const value=await fn();if(value)return value}catch{}await delay(100)}throw Error('timed out: '+String(await evaluate('JSON.stringify({html:document.documentElement.outerHTML.slice(0,1200),error:document.querySelector(\"vite-error-overlay\")?.shadowRoot?.innerText})')))}
try{
 const page=await until(async()=>(await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(item=>item.type==='page'));
 ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');let sequence=0;const pending=new Map();
 ws.onmessage=({data})=>{const message=JSON.parse(data);if(pending.has(message.id)){pending.get(message.id)(message.result);pending.delete(message.id)}};
 const call=(method,params={})=>new Promise(resolve=>{pending.set(++sequence,resolve);ws.send(JSON.stringify({id:sequence,method,params}))});
 evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
 const mouseClick=async(x,y)=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
 await call('Page.enable');await call('Runtime.enable');await call('Log.enable');ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')console.error('BROWSER_EXCEPTION',JSON.stringify(m.params.exceptionDetails));if(m.method==='Log.entryAdded')console.error('BROWSER_LOG',JSON.stringify(m.params.entry));});
 for(const width of [1280,390]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
  await call('Page.navigate',{url:`http://127.0.0.1:${appPort}/designs/console/test/browser/integration-fixture.html?view=section-geometry`});
  await until(()=>evaluate("!!document.querySelector('.side-list .tgroup-toggle') && !!document.querySelector('.org-rows .tgroup-toggle') && !!document.querySelector('.org-rows .select-row-root')"));
  if(width===390)await evaluate("document.querySelector('.top .menu button')?.click()");
  const result=await evaluate(`(()=>{
   const measure=(scope)=>{const group=document.querySelector(scope),header=group.querySelector(':scope > header'),button=header.querySelector('.tgroup-toggle'),label=header.querySelector('.tcheck'),row=group.querySelector('.thread-item-root,.select-row-root'),chevron=button.querySelector('.tgroup-chevron'),action=row.querySelector('.list-row-action'),trigger=action.querySelector('button'),rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {header:rect(header),button:rect(button),checkboxLabel:label?rect(label):null,checkbox:label?rect(label.querySelector('input')):null,row:rect(row),chevron:rect(chevron),action:rect(action),trigger:rect(trigger),expanded:button.getAttribute('aria-expanded'),controlCount:header.children.length,labelNextIsButton:label?.nextElementSibling===button}};
   const splitter=document.querySelector('.layout-separator'),r=splitter?.getBoundingClientRect(),selection=document.querySelector('.selbar'),sr=selection?.getBoundingClientRect();return {sidebar:measure('.side-list .tgroup'),management:measure('.org-rows .tgroup'),splitter:r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom}:null};
  })()`);
  const selector=name=>name==='sidebar'?'.side-list .tgroup':'.org-rows .tgroup';
  const hit=async(name,x,y)=>evaluate(`(()=>{const group=document.querySelector(${JSON.stringify(selector(name))});const target=document.elementFromPoint(${x},${y});const checkbox=target?.closest('.tcheck'),disclosure=target?.closest('.tgroup-toggle');return {control:checkbox?'checkbox':disclosure?'disclosure':'none',tag:target?.tagName,cls:target?.className,parent:target?.parentElement?.className,ancestors:[...function*(e){while(e){yield e.className||e.tagName;e=e.parentElement}}(target)].slice(0,5)}})()`);
  const clickPoint=async(x,y)=>{await mouseClick(x,y);await new Promise(resolve=>setTimeout(resolve,70));};
  for(const name of ['sidebar','management']){
   const g=result[name];assert.equal(g.header.left,g.row.left,`${width}/${name} highlight left=edge`);assert.equal(g.header.right,g.row.right,`${width}/${name} highlight right=edge`);
   assert.equal(g.chevron.width,24,`${width}/${name} chevron column=24`);assert.equal(g.action.width,24,`${width}/${name} menu column=24`);assert.equal(g.chevron.left,g.action.left,`${width}/${name} shared column start`);assert.equal(g.chevron.right,g.action.right,`${width}/${name} shared column end`);
   const h=g.header,splitter=name==='sidebar'?result.splitter:null,usableRight=splitter&&splitter.left>h.left&&splitter.left<h.right?splitter.left-1:h.right-1,points=[
    [h.left+2,h.top+2],[usableRight,h.top+2],[h.left+2,h.bottom-2],[usableRight,h.bottom-2],
    [(h.left+usableRight)/2,h.top+2],[(h.left+usableRight)/2,h.bottom-2],[h.left+2,(h.top+h.bottom)/2],[usableRight,(h.top+h.bottom)/2],
   ];
   for(const [x,y] of points){const found=await hit(name,x,y);assert(['checkbox','disclosure'].includes(found.control),`${width}/${name} band edge/corner at ${x},${y} hit no control: ${JSON.stringify({found,g,splitter:result.splitter})}`)}
   const before=g.expanded,edgePoint=[name==='sidebar'?usableRight:g.button.right-2,(g.button.top+g.button.bottom)/2];
   assert.equal((await hit(name,...edgePoint)).control,'disclosure',`${width}/${name} disclosure edge hit-test`);
   await clickPoint(...edgePoint);
   const after=await evaluate(`document.querySelector(${JSON.stringify(selector(name))}+' .tgroup-toggle').getAttribute('aria-expanded')`);
   assert.notEqual(after,before,`${width}/${name} actual mouse click at disclosure edge toggles`);
   await clickPoint(...edgePoint);
   if(name==='sidebar'&&width===390){
    const trigger=await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector(name))}+' .list-row-action button'),r=b.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:(trigger.left+trigger.right)/2,y:(trigger.top+trigger.bottom)/2});await new Promise(resolve=>setTimeout(resolve,80));
    const targetBounds=await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector(name))}+' .list-row-action button'),r=b.getBoundingClientRect(),cx=(r.left+r.right)/2,cy=(r.top+r.bottom)/2,hit=[];for(let y=Math.floor((cy-32)*2)/2;y<=Math.ceil((cy+32)*2)/2;y+=0.5)for(let x=Math.floor((cx-32)*2)/2;x<=Math.ceil((cx+32)*2)/2;x+=0.5)if(document.elementFromPoint(x,y)?.closest('.row-menu-trigger button')===b)hit.push([x,y]);return {left:Math.min(...hit.map(p=>p[0])),right:Math.max(...hit.map(p=>p[0])),top:Math.min(...hit.map(p=>p[1])),bottom:Math.max(...hit.map(p=>p[1]))}})()`);
    assert(targetBounds.right-targetBounds.left+1>=44&&targetBounds.bottom-targetBounds.top+1>=44,`390/sidebar open-drawer row-menu target <44px: ${JSON.stringify(targetBounds)}`);
    const menuPoints=[[targetBounds.left,targetBounds.top],[targetBounds.right,targetBounds.top],[targetBounds.left,targetBounds.bottom],[targetBounds.right,targetBounds.bottom],[(targetBounds.left+targetBounds.right)/2,targetBounds.top],[(targetBounds.left+targetBounds.right)/2,targetBounds.bottom],[targetBounds.left,(targetBounds.top+targetBounds.bottom)/2],[targetBounds.right,(targetBounds.top+targetBounds.bottom)/2]];
    for(const [x,y] of menuPoints){const hitTarget=await evaluate(`(()=>{const e=document.elementFromPoint(${x},${y}),b=document.querySelector(${JSON.stringify(selector(name))}+' .list-row-action button');return {hit:e?.closest('.row-menu-trigger')===b.parentElement,target:e?.className,ancestors:[...function*(n){while(n){yield n.className||n.tagName;n=n.parentElement}}(e)].slice(0,6)}})()`);assert(hitTarget.hit,`390/sidebar open-drawer row-menu edge/corner misses at ${x},${y}: ${JSON.stringify(hitTarget)}`)}
    await clickPoint((trigger.left+trigger.right)/2,(trigger.top+trigger.bottom)/2);
    assert(await evaluate("!!document.querySelector('[role=menu]')"),'390/sidebar open-drawer row menu opens from target corner');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await evaluate("document.querySelector('.scrim.open')?.click()");
   }
  }
  const clearSelection=async()=>{await evaluate(`document.querySelector('.selbar button:last-child')?.click()`);await new Promise(resolve=>setTimeout(resolve,80))};
  if(await evaluate(`!!document.querySelector('.selbar')`))await clearSelection();
  const bulk=result.management;
  assert(bulk.checkboxLabel && bulk.checkboxLabel.height>=bulk.header.height-2,`${width} bulk checkbox label stretches full band height`);
  assert.equal(bulk.controlCount,2,`${width} bulk band contains exactly two controls`);
  assert.equal(bulk.labelNextIsButton,true,`${width} bulk band controls are adjacent with no intervening gap/control`);
  assert.equal(bulk.checkboxLabel.right,bulk.button.left,`${width} bulk checkbox and disclosure have no gap`);
  assert.equal(bulk.checkboxLabel.left,bulk.header.left,`${width} bulk checkbox fills leading control column`);
  for(const y of [bulk.checkbox.top-0.5,bulk.checkbox.bottom+0.5]){
   const x=(bulk.checkboxLabel.left+bulk.checkboxLabel.right)/2;
   assert.equal((await hit('management',x,y)).control,'checkbox',`${width} checkbox label strip hit-test at ${x},${y}; ${JSON.stringify({bulk,selection:result.selection,found:await hit('management',x,y)})}`);
   const checkedBefore=await evaluate("document.querySelector('.org-rows .tgroup input[type=checkbox]').checked");
   await clickPoint(x,y);
   const checkedAfter=await evaluate("document.querySelector('.org-rows .tgroup input[type=checkbox]').checked");
   assert.notEqual(checkedAfter,checkedBefore,`${width} checkbox strip toggles selection`);
   if(await evaluate(`!!document.querySelector('.selbar')`))await clearSelection();
  }
  const checkboxPoint=await evaluate(`(()=>{const group=document.querySelector('.org-rows .tgroup'),button=group.querySelector('.tgroup-toggle'),check=group.querySelector('input[type=checkbox]'),r=check.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,before:button.getAttribute('aria-expanded')}})()`);
  await clickPoint(checkboxPoint.x,checkboxPoint.y);
  const checkboxResult=await evaluate(`(()=>({after:document.querySelector('.org-rows .tgroup .tgroup-toggle').getAttribute('aria-expanded'),checked:document.querySelector('.org-rows .tgroup input[type=checkbox]').checked}))()`);
  assert.equal(checkboxResult.after,checkboxPoint.before,'management checkbox does not toggle disclosure');
  for(const name of ['sidebar','management']){
   if(width===390&&name==='sidebar')continue;
   const trigger=await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector(name))}+' .list-row-action button'),r=b.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
   await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:(trigger.left+trigger.right)/2,y:(trigger.top+trigger.bottom)/2});await new Promise(resolve=>setTimeout(resolve,80));
   const targetBounds=await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector(name))}+' .list-row-action button'),r=b.getBoundingClientRect(),cx=(r.left+r.right)/2,cy=(r.top+r.bottom)/2,hit=[];for(let y=Math.floor((cy-32)*2)/2;y<=Math.ceil((cy+32)*2)/2;y+=0.5)for(let x=Math.floor((cx-32)*2)/2;x<=Math.ceil((cx+32)*2)/2;x+=0.5)if(document.elementFromPoint(x,y)?.closest('.row-menu-trigger button')===b)hit.push([x,y]);const e=document.elementFromPoint(cx,cy);return {left:Math.min(...hit.map(p=>p[0])),right:Math.max(...hit.map(p=>p[0])),top:Math.min(...hit.map(p=>p[1])),bottom:Math.max(...hit.map(p=>p[1])),rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},center:e?.className,visibility:getComputedStyle(b).visibility,expanded:document.querySelector(${JSON.stringify(selector(name))}+' .tgroup-toggle').getAttribute('aria-expanded'),group:getComputedStyle(b.closest('.tgroup')).display}})()`);
   if(width===390)assert(targetBounds.right-targetBounds.left+1>=44&&targetBounds.bottom-targetBounds.top+1>=44,`${name} phone row-menu target measured by elementFromPoint is under 44px: ${JSON.stringify(targetBounds)}`);
   const points=[[targetBounds.left,targetBounds.top],[targetBounds.right,targetBounds.top],[targetBounds.left,targetBounds.bottom],[targetBounds.right,targetBounds.bottom],[(targetBounds.left+targetBounds.right)/2,targetBounds.top],[(targetBounds.left+targetBounds.right)/2,targetBounds.bottom],[targetBounds.left,(targetBounds.top+targetBounds.bottom)/2],[targetBounds.right,(targetBounds.top+targetBounds.bottom)/2]];
   for(const [x,y] of points){const isTarget=await evaluate(`(()=>document.elementFromPoint(${x},${y})?.closest('.row-menu-trigger button')===document.querySelector(${JSON.stringify(selector(name))}+' .list-row-action button'))()`);assert(isTarget,`${width}/${name} row-menu hit region edge/corner at ${x},${y}`)}
   const [x,y]=points[0];await clickPoint(x,y);
   assert(await evaluate("!!document.querySelector('[role=menu]')"),`${width}/${name} row menu opens at target corner`);
   await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  }
  console.log(JSON.stringify({width,sidebar:'hit-tested',management:'hit-tested',checkbox:checkboxResult.checked?'isolated':'tested'}));
 }
}finally{ws?.close();for(const child of [chrome,vite])if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done.catch(()=>{})}await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
