import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const port=Number(process.env.DEBUG_PORT ?? 19533);
const appPort=Number(process.env.FIXTURE_PORT ?? 19532);
const browser=process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome=spawn(browser,['--headless','--disable-gpu','--disable-extensions','--no-first-run','--user-data-dir='+join(tmpdir(),`studio-toolbar-${process.pid}`),'--remote-debugging-port='+port,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
try {
  let info; for(let n=0;n<100;n++){try {info=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
  if(!info) throw Error('Chrome did not start');
  const ws=new WebSocket(info.find((target)=>target.type==='page' && target.url==='about:blank').webSocketDebuggerUrl); await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let id=0;const waiting=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Log.entryAdded')console.log('LOG',JSON.stringify(m.params));if(m.method==='Runtime.exceptionThrown')console.log('EXCEPTION',JSON.stringify(m.params));if(m.id){const p=waiting.get(m.id);waiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;waiting.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async(expression)=>{let r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  await cmd('Runtime.enable'); await cmd('Page.enable'); await cmd('Log.enable');
  for(const width of [1280,390]) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/`});
    for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,100));if(await evaluate("!!document.querySelector('.studio-no-auth')&&!!document.querySelector('.app')"))break;}
    const result=await evaluate(`(()=>{const e=document.querySelector('.studio-no-auth');if(!e)return {missing:true};const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {text:e.textContent,top:r.top,left:r.left,right:r.right,height:r.height,position:s.position,visible:s.visibility,overflow:document.documentElement.scrollWidth>innerWidth,rootTop:document.getElementById('root').getBoundingClientRect().top}})()`);
    console.log(width,JSON.stringify(result));
    if(result.missing||!['Authentication off','認証なし'].includes(result.text)||result.position!=='fixed'||result.top!==0||result.height<20||result.right>width||result.overflow||result.rootTop<result.height)throw Error('warning is not persistently visible');
    await evaluate('window.scrollTo(0,9999)');
    if(await evaluate("document.querySelector('.studio-no-auth').getBoundingClientRect().top")!==0)throw Error('warning scrolls away');
    if(process.env.SHOTS_DIR){const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(`${process.env.SHOTS_DIR}/no-auth-${width}.png`,Buffer.from(shot.data,'base64'));}
  }
  ws.close();
} finally {chrome.kill('SIGTERM')}
