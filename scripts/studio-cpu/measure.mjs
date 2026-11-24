import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

const repeats = Number(process.env.REPEATS ?? 5), captureMs = Number(process.env.CAPTURE_MS ?? 10000);
const port = 19951, debugPort = 19952, profile = await mkdtemp('/tmp/studio144-status-cpu-');
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'designs/console/test/browser/vite.config.mjs', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
const chrome = spawn(process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--no-service-autorun', '--disable-background-timer-throttling', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { let last; for (let i = 0; i < 150; i++) { try { const value = await fn(); if (value) return value; last = value; } catch (error) { last = String(error); } await sleep(100); } throw Error(`timeout: ${JSON.stringify(last)}`); }
function rpc(ws) {
  let id = 0; const pending = new Map();
  ws.onmessage = ({ data }) => { const msg = JSON.parse(data); if (!msg.id) return; const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(Error(msg.error.message)) : p.resolve(msg.result); };
  return (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); ws.send(JSON.stringify({ id: next, method, params })); });
}
let browserWs, pageWs;
try {
  const version = await until(async () => { const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`); return r.ok ? r.json() : null; });
  browserWs = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { browserWs.onopen = resolve; browserWs.onerror = reject; });
  const browser = rpc(browserWs);
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(x => x.type === 'page'));
  pageWs = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { pageWs.onopen = resolve; pageWs.onerror = reject; });
  const page = rpc(pageWs);
  const evaluate = async expression => { const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  await page('Runtime.enable'); await page('Page.enable'); await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false }); await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await fetch(`http://127.0.0.1:${port}/designs/console/test/browser/integration-fixture.html`).then(r => { if (!r.ok) throw Error('Vite fixture server not ready'); });
  const captures = [];
  const cases = [
    ...[1, 3, 8].map(n => ({ name: `baseline-n${n}`, n, treatment: false })),
    { name: 'baseline-n2', n: 2, treatment: false }, { name: 'wrapper-n2', n: 2, treatment: true },
    { name: 'mix-before', n: 4, active: true, treatment: false },
    { name: 'mix-after', n: 4, active: true, treatment: true },
    { name: 'context-ring', n: 4, active: true, context: true, treatment: false },
  ];
  // Alternate repeated states so thermal and startup drift do not align with one treatment.
  const schedule = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const n of [1, 3, 8]) schedule.push({ ...cases.find(x => x.n === n), repeat });
    schedule.push({ ...cases[3 + repeat % 2], repeat }, { ...cases[4 - repeat % 2], repeat });
    schedule.push({ ...cases[5 + repeat % 2], repeat }, { ...cases[6 - repeat % 2], repeat });
    schedule.push({ ...cases[7], repeat });
  }
  for (const sample of schedule) {
    const url = `http://127.0.0.1:${port}/designs/console/test/browser/integration-fixture.html?view=cpu-status&marks=${sample.n}${sample.active ? '&active=1' : ''}${sample.context ? '&context=1' : ''}#/conversation/lead`;
    await page('Page.navigate', { url });
    await until(() => evaluate(`location.href === ${JSON.stringify(url)} && document.querySelectorAll('[data-running-arc] svg').length === ${sample.n + (sample.active ? 1 : 0)}`));
    await sleep(1200);
    if (sample.treatment) await evaluate(`(() => {
      const style = document.createElement('style'); style.id = 'cpu-wrapper-treatment';
      style.textContent = '[data-running-arc] svg,.character-thinking[data-running]>svg.character-dot,svg.context-ring[data-context-state=summarizing]{animation:none!important}.cpu-status-spinner,.cpu-character-spinner,.cpu-context-spinner{display:inline-block;will-change:transform}.cpu-status-spinner{animation:status-arc-spin var(--motion-spin) linear infinite}.cpu-character-spinner{animation:character-hop 1.2s ease-in-out infinite}@keyframes character-hop{0%,50%,100%{transform:translateY(0)}25%{transform:translateY(-7.1794871795%)}}.cpu-context-spinner{transform-origin:center;animation:context-ring-spin var(--motion-spin) linear infinite}';
      document.head.append(style);
      const targets=[...document.querySelectorAll('[data-running-arc] svg'),...document.querySelectorAll('svg.character-dot'),...document.querySelectorAll('svg.context-ring[data-context-state=summarizing]')];
      let dotIndex=0;
      targets.forEach((svg,index) => { const wrapper=document.createElement('span'); wrapper.className=svg.matches('[data-running-arc] svg')?'cpu-status-spinner':svg.matches('.character-dot')?'cpu-character-spinner':'cpu-context-spinner'; const rect=svg.getBoundingClientRect(); wrapper.style.width=rect.width+'px'; wrapper.style.height=rect.height+'px'; if(svg.matches('.character-dot'))wrapper.style.animationDelay=(dotIndex++*0.15)+'s'; svg.before(wrapper); wrapper.append(svg); });
    })()`);
    const facts = await evaluate(`(() => ({
      n: document.querySelectorAll('[data-running-arc] svg').length, dots: document.querySelectorAll('svg.character-dot').length, ring: document.querySelectorAll('svg.context-ring[data-context-state=summarizing]').length,
      rect: (() => {const x=document.querySelector('[data-running-arc] svg');const r=x?.getBoundingClientRect();return r?{x:r.x,y:r.y,w:r.width,h:r.height}:null})(),
      media: matchMedia('(prefers-reduced-motion: no-preference)').matches, css: (() => {const x=document.querySelector('[data-running-arc] svg');const s=getComputedStyle(x);return {name:s.animationName,duration:s.animationDuration,state:s.animationPlayState,connected:x.isConnected,visibility:document.visibilityState,svgAnimations:x.getAnimations().length}})(), animated: [...document.getAnimations()].map(a => ({name:a.animationName,playState:a.playState,target:a.effect?.target?.tagName,className:a.effect?.target?.getAttribute?.('class')})),
      idleConversation: !document.querySelector('.convo [data-running-arc]'),
    }))()`);
    console.error('FIXTURE_FACTS', JSON.stringify(facts));
    assert.equal(facts.n, sample.n + (sample.active ? 1 : 0)); assert.equal(facts.dots, sample.active ? 3 : 0); assert.equal(facts.ring, sample.context ? 1 : 0);
    if (sample.name.startsWith('mix-')) assert.equal(facts.animated.length, 8); if (sample.context) assert.equal(facts.animated.length, 9); if (!sample.active) assert(facts.idleConversation);
    assert(facts.rect?.w > 0 && facts.rect?.h > 0, `status mark must be visible: ${JSON.stringify(facts)}`);
    const before = await browser('SystemInfo.getProcessInfo');
    const events = [];
    const traceDone = new Promise(resolve => {
      const listener = ({ data }) => { const msg = JSON.parse(data); if (msg.method === 'Tracing.dataCollected') events.push(...msg.params.value); if (msg.method === 'Tracing.tracingComplete') { pageWs.removeEventListener('message', listener); resolve(); } };
      pageWs.addEventListener('message', listener);
    });
    await page('Tracing.start', { categories: 'devtools.timeline,blink.animations,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' });
    await sleep(captureMs);
    await page('Tracing.end'); await traceDone;
    const after = await browser('SystemInfo.getProcessInfo');
    const old = new Map(before.processInfo.map(p => [p.id, p]));
    const cpu = {};
    for (const p of after.processInfo) { const delta = Math.max(0, p.cpuTime - (old.get(p.id)?.cpuTime ?? p.cpuTime)); cpu[p.type] = (cpu[p.type] ?? 0) + delta; }
    const total = Object.values(cpu).reduce((a, b) => a + b, 0);
    const metadata = new Map();
    for (const event of events) if (event.ph === 'M' && event.name === 'thread_name') metadata.set(`${event.pid}:${event.tid}`, event.args?.name ?? 'unknown');
    const threads = {};
    const compositeFailures = [];
    const mainCategories = { script: 0, style: 0, layout: 0, paint: 0 };
    for (const event of events) {
      if (event.dur && event.pid && event.tid) {
        const name = metadata.get(`${event.pid}:${event.tid}`) ?? 'unknown';
        if (/RunTask|TaskGraphRunner|Raster|Draw|Composite|Animation/i.test(event.name)) threads[name] = (threads[name] ?? 0) + event.dur / 1000;
        if (name === 'CrRendererMain') {
          const key = event.name === 'FunctionCall' || event.name === 'EvaluateScript' ? 'script' : event.name === 'RecalculateStyles' || event.name === 'UpdateLayoutTree' ? 'style' : event.name === 'Layout' ? 'layout' : event.name === 'Paint' ? 'paint' : null;
          if (key) mainCategories[key] += event.dur / 1000;
        }
      }
      if (event.name === 'Animation' || event.args?.data?.compositeFailed) compositeFailures.push({ name: event.name, category: event.cat, data: event.args?.data });
    }
    const result = { ...sample, facts, wallSeconds: captureMs / 1000, processCpuSeconds: cpu, totalCpuPercent: total / (captureMs / 1000) * 100, rendererCpuPercent: (cpu.renderer ?? 0) / (captureMs / 1000) * 100, gpuCpuPercent: (cpu.GPU ?? 0) / (captureMs / 1000) * 100, browserCpuPercent: (cpu.browser ?? 0) / (captureMs / 1000) * 100, rendererShare: (cpu.renderer ?? 0) / total * 100, mainCategoriesMs: Object.fromEntries(Object.entries(mainCategories).map(([k,v]) => [k, v * 1000])), traceThreadDurationsMs: Object.fromEntries(Object.entries(threads).map(([k,v])=>[k,v*1000])), compositeFailures: compositeFailures.slice(0, 40) };
    captures.push(result); console.log(JSON.stringify(result));
  }
  await writeFile('/tmp/studio144-status-cpu.json', JSON.stringify({ chrome: version.Browser, captures }, null, 2));
} finally {
  pageWs?.close(); browserWs?.close();
  for (const child of [chrome, vite]) if (child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done.catch(() => {}); }
  await rm(profile, { recursive: true, force: true });
}
