import {readFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const actualDir=resolve('.local/leader/artifacts/core296/actual-bdc852');
const manifestBytes=readFileSync(join(actualDir,'manifest.json'));
assert.equal(createHash('sha256').update(manifestBytes).digest('hex'),'4078c1d12d06b84ac462c2fab61957e7a7ff02c94ebcf123d8e7444d0efa11e4');
const manifest=JSON.parse(manifestBytes);
const fixtures=new Map();for(const [name,meta] of Object.entries(manifest.files)){const bytes=readFileSync(join(actualDir,name));assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.sha256);fixtures.set(name,bytes);}
const port=Number(process.env.DEBUG_PORT ?? 19573);
const server=await createServer({configFile:false,plugins:[{name:'verified-producer-fixtures',configureServer(vite){vite.middlewares.use((req,res,next)=>{if(!req.url.startsWith('/actual-producer/'))return next();const bytes=fixtures.get(req.url.slice('/actual-producer/'.length));if(!bytes){res.statusCode=404;res.end();return;}res.setHeader('Content-Type','application/json');res.end(bytes);});}}],oxc:{jsx:{runtime:'automatic',importSource:'preact'}},optimizeDeps:{noDiscovery:true,include:['preact','preact/hooks','preact/jsx-dev-runtime','@preact/signals','@preact/signals-core','markdown-it','qrcode-generator']},root:fileURLToPath(new URL('../../../../',import.meta.url)),server:{host:'127.0.0.1',port:0}});

await server.listen();
const appPort=server.httpServer.address().port;
const out=await mkdtemp(join(process.env.P1_ARTIFACT_DIR,'browser-'));
console.log(JSON.stringify({out}));
const records=[];const errors=[];const diagnostics=[];
const suite=process.env.VISIBLE_SUITE??'handoff';
const browser=process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome=spawn(browser,['--headless','--disable-gpu','--disable-extensions','--no-first-run','--user-data-dir='+join(tmpdir(),`studio-toolbar-${process.pid}`),'--remote-debugging-port='+port,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
try {
  let info; for(let n=0;n<100;n++){try {info=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
  if(!info) throw Error('Chrome did not start');
  const ws=new WebSocket(info.find((target)=>target.type==='page' && target.url==='about:blank').webSocketDebuggerUrl); await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let id=0;const waiting=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Log.entryAdded'){diagnostics.push({channel:'Log.entryAdded',...m.params});console.log('LOG',JSON.stringify(m.params));}if(m.method==='Runtime.consoleAPICalled')diagnostics.push({channel:'console',...m.params});if(m.method==='Runtime.exceptionThrown')errors.push(m.params);if(m.id){const p=waiting.get(m.id);waiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;waiting.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async(expression)=>{let r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  await cmd('Runtime.enable'); await cmd('Page.enable'); await cmd('Log.enable');
  await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.phaseDiagnostics=[];
    const record=(channel,message,extra={})=>window.phaseDiagnostics.push({channel,message,phase:window.publicTrace?.phase??'bootstrap',time:performance.now(),...extra});
    addEventListener('error',e=>record('window.error',e.message,{filename:e.filename,line:e.lineno}),true);
    addEventListener('unhandledrejection',e=>record('unhandledrejection',String(e.reason)),true);
    for(const name of ['warn','error']){const original=console[name].bind(console);console[name]=(...args)=>{record('console.'+name,args.map(String).join(' '));return original(...args);};}
  `});
  for(const width of [1280,390]){
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/designs/console/test/browser/projection24-public-fixture.html`});
    let loaded=false;for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,50));if(await evaluate("typeof window.runPublic==='function'")){loaded=true;break;}}
    assert(loaded,'normalized DOM fixture ready');let result;try{result=await evaluate('window.runPublic()')}catch(error){const trace=await evaluate('window.publicTrace ?? null');await writeFile(join(out,`error-${width}.json`),JSON.stringify({error:String(error),trace,phaseDiagnostics:await evaluate('window.phaseDiagnostics ?? []'),diagnostics,errors},null,2));throw error;}
    result.phaseDiagnostics=await evaluate('window.phaseDiagnostics ?? []');
    result.warningFree=result.phaseDiagnostics.length===0;
    const record={width,warningFree:result.warningFree,samples:result.samples.length,failures:result.failures,effects:result.effects,scrollable:result.scrollable};records.push(record);console.log(JSON.stringify(record));
    await writeFile(join(out,`dom-${width}.json`),JSON.stringify(result,null,2));const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(join(out,`dom-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  await writeFile(join(out,'summary.json'),JSON.stringify({records,errors,diagnostics},null,2));
  assert.equal(errors.length,0,'browser runtime exceptions');
  assert.equal(records.filter(r=>!r.warningFree).length,0,'phase warnings/errors remain; see per-width JSON');
  assert.equal(records.filter(r=>r.failures.length).length,0,'visible acceptance failures; see summary');
  ws.close();
} finally {await writeFile(join(out,'final-state.json'),JSON.stringify({records,errors,diagnostics},null,2));chrome.kill('SIGTERM');await server.close();}
