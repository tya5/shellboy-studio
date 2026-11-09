import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const port=Number(process.env.DEBUG_PORT ?? 19603);
const appPort=Number(process.env.FIXTURE_PORT ?? 19602);
const browser=process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome=spawn(browser,['--headless','--disable-gpu','--disable-extensions','--no-first-run','--user-data-dir='+join(tmpdir(),`studio-toolbar-${process.pid}`),'--remote-debugging-port='+port,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
try {
  let info; for(let n=0;n<100;n++){try {info=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
  if(!info) throw Error('Chrome did not start');
  const ws=new WebSocket(info.find((target)=>target.type==='page' && target.url==='about:blank').webSocketDebuggerUrl); await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let id=0;const waiting=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Log.entryAdded')console.log('LOG',JSON.stringify(m.params));if(m.method==='Runtime.exceptionThrown')console.log('EXCEPTION',JSON.stringify(m.params));if(m.id){const p=waiting.get(m.id);waiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;waiting.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async(expression)=>{let r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  await cmd('Runtime.enable'); await cmd('Page.enable');
  let leakedCases=0, controls=0;
  for(const width of [1280,390]) for(const theme of ['console','light']) for(const scenario of ['ref-first','history-first','missing','error','mixed','owner-ABA','message']) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/designs/console/test/browser/tool-json-fixture.html?theme=${theme}&scenario=${scenario}&windowed=${process.env.WINDOWED==='1'?1:0}`});
    let ready=false;for(let n=0;n<120;n++){await new Promise(r=>setTimeout(r,100));if(await evaluate("typeof window.runToolBoundary==='function'")){ready=true;break;}}
    if(!ready)throw Error('fixture did not load');
    const result=await evaluate('window.runToolBoundary()');
    const rawFrames=result.samples.filter(s=>s.rawMessages>0).length;
    const visibleRawFrames=result.samples.filter(s=>s.visibleRawMessages>0).length;
    console.log(JSON.stringify({width,theme,windowed:process.env.WINDOWED==='1',...result,rawFrames,visibleRawFrames}));
    if(scenario==='message'){if(!rawFrames)throw Error('ordinary JSON control was not rendered');controls++;}
    else if(rawFrames)leakedCases++;
  }
  console.log(JSON.stringify({summary:true,leakedCases,controls}));
  if(leakedCases)process.exitCode=2; // Record every condition before failing if any unproved aggregate reached Message prose.
  ws.close();
} finally {chrome.kill('SIGTERM')}
