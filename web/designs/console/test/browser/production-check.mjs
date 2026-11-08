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
  const results = [];
  for (const width of [1280, 390]) for (const theme of ['console', 'light']) for (const state of ['history', 'empty', 'running']) {
    await cmd('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await cmd('Page.navigate', { url: `http://127.0.0.1:${appPort}/?theme=${theme}&state=${state}` });
    let ready = false;
    for (let n = 0; n < 100; n++) { await new Promise(r => setTimeout(r, 100)); if (await evaluate("!!document.querySelector('.convo .character-status')")) { ready = true; break; } }
    if (!ready) throw Error('Fixture not ready: ' + await evaluate('document.body.innerText'));
    await evaluate("document.querySelector('.convo .scroll').scrollTop = 100000");
    await new Promise(r => setTimeout(r, 200));
    const result = await evaluate(`(() => {
      const images = [...document.querySelectorAll('.convo img')].map(e => ({ src: e.getAttribute('src'), loaded: e.complete && e.naturalWidth > 0, width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }));
      const status = document.querySelector('.character-status').closest('[role=status]');
      const dock = document.querySelector('.dock');
      return { theme: document.documentElement.dataset.ds, images, statusInDock: dock.contains(status), pageOverflow: document.documentElement.scrollWidth > innerWidth, empty: !!document.querySelector('.empty-character'), avatars: document.querySelectorAll('.character-avatar').length, statusText: status.innerText };
    })()`);
    results.push({ width, theme, state, ...result });
    if (result.images.some(i => !i.loaded || !/^\/assets\/[^/]+\.svg$/.test(i.src)) || result.statusInDock || result.pageOverflow || (state === 'empty' && !result.empty)) throw Error('Layout/image failure: ' + JSON.stringify(result));
    if (state !== 'empty' && result.avatars < 1) throw Error('No bot avatar exercised');
    if (state === 'running' && !['Running tools', 'Verify query ranking', 'Running at least 2', '1m'].every(text => result.statusText.includes(text))) throw Error('Running information lost: ' + result.statusText);
    const shot = await cmd('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${base}/production-${width}-${theme}-${state}.png`, Buffer.from(shot.data, 'base64'));
  }
  await writeFile(`${base}/production-results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  ws.close();
} finally {chrome.kill('SIGTERM')}
