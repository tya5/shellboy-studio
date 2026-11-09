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
  for(const width of [390,1280]) for(const theme of ['console','light']) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/?theme=${theme}&state=running`});
    let ready=false;for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,100));if(await evaluate("!!document.querySelector('.conversation-status-detail')")){ready=true;break;}}
    if(!ready)throw Error('tool status fixture not loaded');
    const result=await evaluate(`(async()=>{
      await document.fonts.ready;for(let n=0;n<8;n++)await new Promise(r=>requestAnimationFrame(r));
      const row=document.querySelector('.conversation-status'),tool=row.querySelector('.conversation-status-tool'),elapsed=row.querySelector('.conversation-status-elapsed'),head=row.querySelector('.conversation-status-heading');
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom};};
      const samples=[];for(let n=0;n<36;n++){await new Promise(r=>requestAnimationFrame(r));samples.push({row:rect(row),tool:rect(tool),elapsed:rect(elapsed),head:rect(head),same:document.querySelector('.conversation-status')===row,overflow:document.documentElement.scrollWidth>innerWidth});}
      return {samples,text:row.textContent,strip:document.querySelector('.work-strip')?.textContent,animation:getComputedStyle(row.querySelector('img')).animationName};
    })()`);
    const stable=result.samples.every(s=>s.same&&!s.overflow&&s.row.h===result.samples[0].row.h&&s.tool.y>=s.head.b-1&&s.elapsed.x>=0&&s.elapsed.x+s.elapsed.w<=width);
    console.log(JSON.stringify({width,theme,stable,...result}));
    if(!stable||result.animation!=='none'||!result.text.includes('Running at least 2')||result.strip.includes('Running at least'))throw Error('status layout or dedup mismatch');
    const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(`${base}/mobile-status-${theme}-${width}.png`,Buffer.from(shot.data,'base64'));
  }
  ws.close();
} finally {chrome.kill('SIGTERM')}
