import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const port=Number(process.env.DEBUG_PORT ?? 19573);
const server=await createServer({configFile:false,oxc:{jsx:{runtime:'automatic',importSource:'preact'}},optimizeDeps:{noDiscovery:true,include:['preact','preact/hooks','preact/jsx-dev-runtime','@preact/signals','@preact/signals-core','markdown-it','qrcode-generator']},root:fileURLToPath(new URL('../../../../',import.meta.url)),server:{host:'127.0.0.1',port:0}});
await server.listen();
const appPort=server.httpServer.address().port;
const out=await mkdtemp(join(tmpdir(),'studio-s7-visible-'));
console.log(JSON.stringify({out}));
const records=[];const errors=[];
const browser=process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome=spawn(browser,['--headless','--disable-gpu','--disable-extensions','--no-first-run','--user-data-dir='+join(tmpdir(),`studio-toolbar-${process.pid}`),'--remote-debugging-port='+port,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
try {
  let info; for(let n=0;n<100;n++){try {info=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
  if(!info) throw Error('Chrome did not start');
  const ws=new WebSocket(info.find((target)=>target.type==='page' && target.url==='about:blank').webSocketDebuggerUrl); await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let id=0;const waiting=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Log.entryAdded')console.log('LOG',JSON.stringify(m.params));if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.id){const p=waiting.get(m.id);waiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;waiting.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async(expression)=>{let r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  await cmd('Runtime.enable'); await cmd('Page.enable');
  for(const width of [1280,390]) for(const theme of ['console']) for(const windowed of [false,true]) for(const scenario of ['normal','partial','wrong-node']) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/designs/console/test/browser/visible-handoff-fixture.html?theme=${theme}&windowed=${windowed?1:0}&scenario=${scenario}`});
    let ready=false;for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,100));if(await evaluate("typeof window.runHandoff==='function'")){ready=true;break;}}
    if(!ready)throw Error('fixture did not load');
    const result=await evaluate('window.runHandoff()');
    const samples=result.samples;const heights=samples.map(s=>s.height);
    const summary={width,theme,windowed,scenario,samples:samples.length,missing:samples.filter(s=>s.count===0).length,duplicates:samples.filter(s=>s.count>1).length,keyChanged:samples.filter(s=>!s.connected).length,minHeight:Math.min(...heights),maxHeight:Math.max(...heights),firstHeight:heights[0],lastHeight:heights.at(-1),failed:result.failed,ready:result.ready,unverified:result.unverified};
    const failures=[];
    if(samples.length<4) failures.push('insufficient actual RAF samples');
    if(summary.missing||summary.duplicates||summary.keyChanged) failures.push('continuity');
    if(!result.failed||result.ready!=='ready') failures.push('error or ready state');
    if(scenario!=='normal'&&(result.unverified.status==='ready'||!result.unverified.textRetained))failures.push('unverified body replaced live');
    records.push({...summary,failures});console.log(JSON.stringify({...summary,failures}));
    const label=`handoff-${width}-${windowed?'window':'legacy'}-${scenario}`;
    await writeFile(join(out,label+'.json'),JSON.stringify(result,null,2));
    const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(join(out,label+'.png'),Buffer.from(shot.data,'base64'));

  }
  await writeFile(join(out,'summary.json'),JSON.stringify({records,errors},null,2));
  assert.equal(errors.length,0,'browser runtime errors');
  assert.equal(records.filter(r=>r.failures.length).length,0,'visible handoff acceptance failures; see summary');
  ws.close();
} finally {chrome.kill('SIGTERM');await server.close();}
