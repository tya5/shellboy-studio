import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
const server = spawn(process.execPath, [join(repo, 'web/designs/console/test/browser/production-serve.mjs')], { env: { ...process.env, FIXTURE_PORT: '19430' }, stdio: 'inherit' });
const browserDir = await mkdtemp(join(tmpdir(), 'studio-memory-'));
const debugPort = 19431;
const chrome = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless','--disable-gpu','--no-first-run','--user-data-dir='+browserDir,'--remote-debugging-port='+debugPort,'--remote-allow-origins=*','about:blank'], { stdio: 'ignore' });
const terminal = child => new Promise(resolve => {
  let done = false;
  const finish = (code, signal, error) => { if (!done) { done = true; resolve({ code, signal, error }); } };
  child.once('exit', (code, signal) => finish(code, signal));
  child.once('error', error => finish(null, null, error));
  if (child.exitCode !== null || child.signalCode !== null) finish(child.exitCode, child.signalCode);
});
const serverTerminal = terminal(server), chromeTerminal = terminal(chrome);
const stop = async (child, wait) => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await wait; };
try {
  let info; for(let i=0;i<100;i++){try{info=await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();break}catch{await new Promise(r=>setTimeout(r,100));}}
  if(!info) throw Error('Chrome did not start');
  const target=info.find(target=>target.type==='page'); if(!target) throw Error('Chrome page target missing');
  const ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let id=0;const waiters=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=waiters.get(m.id);waiters.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;waiters.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async(expression)=>{const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await cmd('Runtime.enable'); await cmd('Page.enable');
  for(const width of [1280,390]) for(const lang of ['en','ja']){
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    await cmd('Page.navigate',{url:`http://127.0.0.1:19430/?view=memory&lang=${lang}`});
    let ready=false;for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100));if(await evaluate("!!document.querySelector('section[aria-label] .meters')")){ready=true;break;}}
    if(!ready)throw Error(`MemoryPane did not render ${width}/${lang}`);
    const result=await evaluate(`(()=>{const section=[...document.querySelectorAll('section[aria-label]')].find(e=>e.querySelector('.meters'));if(!section)throw Error('memory section missing');const cards=[...section.querySelectorAll('.meter')],root=section.getBoundingClientRect(),rects=cards.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});return {cardCount:cards.length,text:section.textContent??'',overflow:document.documentElement.scrollWidth>innerWidth,root:{left:root.left,right:root.right},rects}})()`);
    const overlap=result.rects.some((a,i)=>result.rects.some((b,j)=>i!==j&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom));
    if(result.cardCount!==4||result.overflow||result.root.left<0||result.root.right>width||overlap)throw Error(`memory geometry failed ${width}/${lang}: ${JSON.stringify(result)}`);
    if(!result.text.includes(lang==='ja'?'報告なし':'Not reported')||!result.text.includes('56 KiB')||result.text.includes('UI cache owner is not available'))throw Error(`memory facts failed ${width}/${lang}`);
    console.log(JSON.stringify({width,lang,cardCount:result.cardCount,overflow:result.overflow,overlap}));
  }
  ws.close();
} finally { await stop(chrome, chromeTerminal); await stop(server, serverTerminal); await rm(browserDir,{recursive:true,force:true}); }
