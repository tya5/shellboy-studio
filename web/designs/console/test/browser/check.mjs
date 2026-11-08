import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const port=Number(process.env.DEBUG_PORT ?? 19331);
const appPort=Number(process.env.FIXTURE_PORT ?? 19330);
const browser=process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome=spawn(browser,['--headless','--disable-gpu','--disable-extensions','--no-first-run','--user-data-dir='+join(tmpdir(),`studio-toolbar-${process.pid}`),'--remote-debugging-port='+port,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
try {
  let info; for(let n=0;n<100;n++){try {info=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
  if(!info) throw Error('Chrome did not start');
  const ws=new WebSocket(info.find((target)=>target.type==='page' && target.url==='about:blank').webSocketDebuggerUrl); await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let id=0;const waiting=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Log.entryAdded')console.log('LOG',JSON.stringify(m.params));if(m.method==='Runtime.exceptionThrown')console.log('EXCEPTION',JSON.stringify(m.params));if(m.id){const p=waiting.get(m.id);waiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;waiting.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async(expression)=>{let r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  const base=process.env.SHOTS_DIR;
  await cmd("Runtime.enable"); await cmd("Page.enable"); await cmd("Log.enable");
  for(const width of [1280,390]) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/designs/console/test/browser/monitor-fixture.html`});
    let ready=false;
    for(let attempt=0;attempt<100;attempt++) { await new Promise(r=>setTimeout(r,100)); if(await evaluate("!!document.querySelector('.monitor-controls')")){ready=true;break;} }
    if(!ready) throw Error('Monitor fixture did not render: '+JSON.stringify(await evaluate('({href:location.href,html:document.documentElement.outerHTML.slice(0,1000)})')));
    const check=async(state)=>{const r=await evaluate(`(()=>{const root=document.querySelector('.monitor-controls');if(!root)throw Error('missing monitor');let nodes=[root,...root.querySelectorAll('*')].filter(e=>{let s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&e.getBoundingClientRect().width>0});return {viewport:innerWidth, overflow:nodes.filter(e=>e.scrollWidth>e.clientWidth+1 && ['auto','scroll'].includes(getComputedStyle(e).overflowX)).map(e=>e.className),outside:nodes.filter(e=>e.getBoundingClientRect().right>innerWidth+1||e.getBoundingClientRect().left< -1).map(e=>e.className)}})()`);console.log(width,state,JSON.stringify(r));if(r.overflow.length||r.outside.length)throw Error('horizontal overflow');};
    await check('default');
    await evaluate(`document.querySelector('.monitor-tools .monitor-popover button').click()`); await new Promise(r=>setTimeout(r,100)); await check('filters');
    if(base){const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(`${base}/toolbar-${width}-filters.png`,Buffer.from(shot.data,'base64'));}
    await evaluate(`document.querySelector('.monitor-popover-panel .chip').click()`); await new Promise(r=>setTimeout(r,100)); await check('active');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await new Promise(r=>setTimeout(r,100));
    if(base){const shot2=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(`${base}/toolbar-${width}.png`,Buffer.from(shot2.data,'base64'));}
  }
  ws.close();
} finally {chrome.kill('SIGTERM')}
