import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const port=Number(process.env.DEBUG_PORT ?? 19583);
const appPort=Number(process.env.FIXTURE_PORT ?? 19582);
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
  for(const width of [1280,390]) for(const theme of ['console','light']) for(const windowed of [false,true]) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/designs/console/test/browser/sender-fixture.html?theme=${theme}&windowed=${windowed?1:0}`});
    let ready=false;for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,100));if(await evaluate("typeof window.senderProbe==='function'")){ready=true;break;}}
    if(!ready)throw Error('fixture did not load');
    const result=await evaluate('window.senderProbe()');console.log(JSON.stringify({width,theme,windowed,...result}));
    if(result.facts.length!==2||!result.facts[0].text.includes('Renamed current title')||!result.facts[1].text.includes('Same current title')||!result.unknown||result.injected||result.overflow||result.candidates!==2)throw Error('sender identity rendering failed');
    if(result.facts[1].text.includes('Self-asserted label:'))throw Error('label was auto-populated');
    for(const f of result.facts)if(!f.link.includes(encodeURIComponent(f.id)))throw Error('ID link identity changed');
    if(process.env.SHOTS_DIR){const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(`${process.env.SHOTS_DIR}/sender-${theme}-${width}-${windowed?"window":"legacy"}.png`,Buffer.from(shot.data,'base64'));}
  }
  ws.close();
} finally {chrome.kill('SIGTERM')}
