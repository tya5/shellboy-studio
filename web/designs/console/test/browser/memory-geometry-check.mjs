import { fileURLToPath } from 'node:url';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const repo = fileURLToPath(new URL('../../../../../', import.meta.url));
let server, chrome, browserDir, ws;
let serverTerminal, chromeTerminal;
const terminal = child => new Promise(resolve => {
  let done = false;
  const finish = (code, signal, error) => { if (!done) { done = true; resolve({ code, signal, error }); } };
  child.once('exit', (code, signal) => finish(code, signal));
  child.once('error', error => finish(null, null, error));
  if (child.exitCode !== null || child.signalCode !== null) finish(child.exitCode, child.signalCode);
});
const stop = async (child, wait) => { if (!child) return; if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await wait; };
try {
  browserDir = await mkdtemp(join(tmpdir(), 'studio-memory-'));
  server = spawn(process.execPath, [join(repo, 'web/designs/console/test/browser/production-serve.mjs')], { env: { ...process.env, FIXTURE_PORT: '0' }, stdio: ['ignore','pipe','inherit'] });
  serverTerminal = terminal(server);
  const serverReady = new Promise((resolve, reject) => { let text=''; server.stdout.on('data', chunk => { text += chunk; const line=text.split('\n').find(line => line.startsWith('STUDIO_FIXTURE_READY ')); if(line) resolve(JSON.parse(line.slice('STUDIO_FIXTURE_READY '.length))); }); server.once('error', reject); server.once('exit', (code, signal) => reject(new Error(`fixture server exited ${code}/${signal}`))); });
  chrome = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless','--disable-gpu','--no-first-run','--use-mock-keychain','--password-store=basic','--user-data-dir='+browserDir,'--remote-debugging-port=0','--remote-allow-origins=*','about:blank'], { stdio: 'ignore' });
  chromeTerminal = terminal(chrome);
  const fixture=await serverReady;
  let debugPort; for(let i=0;i<100;i++){try{const port=Number((await readFile(join(browserDir,'DevToolsActivePort'),'utf8')).split('\n')[0]);debugPort=port;break}catch{if(chrome.exitCode !== null) throw Error(`Chrome exited ${chrome.exitCode}`); await new Promise(r=>setTimeout(r,100));}}
  if(!debugPort) throw Error('Chrome DevToolsActivePort did not appear');
  let info; for(let i=0;i<100;i++){try{info=await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();break}catch{if(chrome.exitCode !== null) throw Error(`Chrome exited ${chrome.exitCode}`); await new Promise(r=>setTimeout(r,100));}}
  if(!info) throw Error('Chrome did not start');
  const target=info.find(target=>target.type==='page'); if(!target) throw Error('Chrome page target missing');
  ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let id=0;const waiters=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=waiters.get(m.id);waiters.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;waiters.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async(expression)=>{const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await cmd('Runtime.enable'); await cmd('Page.enable');
  for(const width of [1280,390]) for(const lang of ['en','ja']) for(const state of ['success','memory-error','memory-busy']){
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    const navigation=await cmd('Page.navigate',{url:`http://${fixture.host}:${fixture.port}/?view=memory&lang=${lang}${state==='success'?'':`&state=${state}`}`}); if(navigation.errorText) throw Error(`navigation failed ${width}/${lang}: ${navigation.errorText}`);
    let ready=false;for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100));if(await evaluate(`document.documentElement.dataset.memoryFixture===${JSON.stringify(lang)} && !!document.querySelector('[data-memory-cache-cards] .meter')`)){ready=true;break;}}
    if(!ready)throw Error(`MemoryPane did not render ${width}/${lang}`);
    const result=await evaluate(`(()=>{const section=document.querySelector('[data-memory-cache-cards]').closest('section');if(!section)throw Error('memory section missing');const cards=[...section.querySelectorAll('.meter')],root=section.getBoundingClientRect(),rects=cards.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});return {cardCount:cards.length,text:section.textContent??'',overflow:document.documentElement.scrollWidth>innerWidth,root:{left:root.left,right:root.right},rects}})()`);
    const overlap=result.rects.some((a,i)=>result.rects.some((b,j)=>i!==j&&a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom));
    if(result.cardCount!==(state==='success'?4:1)||result.overflow||result.root.left<0||result.root.right>width||overlap)throw Error(`memory geometry failed ${width}/${lang}: ${JSON.stringify(result)}`);
    if(state==='success'&&(!result.text.includes(lang==='ja'?'報告なし':'Not reported')||!result.text.includes('56 KiB')||result.text.includes('UI cache owner is not available')))throw Error(`memory facts failed ${width}/${lang}: ${JSON.stringify(result.text)}`);
    if(state==='memory-error'&&!result.text.includes(lang==='ja'?'メモリキャッシュ情報の読み取りに対応していません':'does not support reading memory cache details'))throw Error(`localized error card failed ${width}/${lang}: ${JSON.stringify(result.text)}`);
    if(state==='memory-busy'&&!result.text.includes(lang==='ja'?'owner が処理中です。':'The owner is busy.'))throw Error(`localized busy card failed ${width}/${lang}: ${JSON.stringify(result.text)}`);
    console.log(JSON.stringify({width,lang,state,cardCount:result.cardCount,overflow:result.overflow,overlap}));
  }
  ws.close();
}
finally {
  if (ws) ws.close();
  await stop(chrome, chromeTerminal);
  await stop(server, serverTerminal);
  if (browserDir) await rm(browserDir, { recursive: true, force: true });
}
