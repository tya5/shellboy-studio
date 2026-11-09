import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const port=Number(process.env.DEBUG_PORT ?? 19693);
const appPort=Number(process.env.FIXTURE_PORT ?? 19692);
const browser=process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome=spawn(browser,['--headless','--disable-gpu','--disable-extensions','--no-first-run','--user-data-dir='+join(tmpdir(),`studio-remote-copy-${process.pid}`),'--remote-debugging-port='+port,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
try {
  let info; for(let n=0;n<100;n++){try {info=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
  if(!info) throw Error('Chrome did not start');
  const ws=new WebSocket(info.find((target)=>target.type==='page' && target.url==='about:blank').webSocketDebuggerUrl); await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let id=0;const waiting=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Log.entryAdded')console.log('LOG',JSON.stringify(m.params));if(m.method==='Runtime.exceptionThrown')console.log('EXCEPTION',JSON.stringify(m.params));if(m.id){const p=waiting.get(m.id);waiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;waiting.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async(expression)=>{let r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  await cmd('Runtime.enable'); await cmd('Page.enable');
  for(const width of [1280,390]) for(const lang of ['en','ja']) for(const auth of ['on','off']) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/designs/console/test/browser/remote-copy-fixture.html?lang=${lang}&auth=${auth}`});
    let ready=false;for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,100));if(await evaluate("document.documentElement.dataset.remoteCopyReady==='true'&&document.body.textContent.includes('HOSTNAME')")){ready=true;break;}}
    if(!ready)throw Error('remote copy fixture did not load');
    const result=await evaluate(`(()=>{const warning=document.querySelector('.studio-no-auth');return {text:document.body.textContent,warning:warning?.textContent,title:warning?.title,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    if(!result.text.includes('HTTPS')||!result.text.includes('VPN')||!result.text.includes('HOSTNAME')||!result.text.includes('--no-auth')||/tailnet|tailscale serve/i.test(result.text))throw Error('generic locale copy missing');
    if(auth==='off' ? (!result.warning||!result.title.includes('Funnel')) : !!result.warning)throw Error('incorrect auth mode indicator');
    if(result.overflow)throw Error('page has horizontal overflow');
    console.log(JSON.stringify({width,lang,auth,overflow:result.overflow,warning:result.warning??null,copy:true}));
    if(process.env.SHOTS_DIR){const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(`${process.env.SHOTS_DIR}/remote-${lang}-${width}-${auth}.png`,Buffer.from(shot.data,'base64'));}
  }
  ws.close();
} finally {chrome.kill('SIGTERM')}
