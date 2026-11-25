// Branches screen (#138) in headless Chrome: fixed row heights per kind, 44 px phone rows, no horizontal page
// scroll, rows kept (same elements) across a refresh, and PNG captures of desktop (1440 px) and phone (390 px,
// laid out at a true 390 px viewport through the DevTools protocol) in both themes.
// Run from web/: node designs/console/test/browser/branches-check.mjs [outDir]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const appPort = 19581;
const debugPort = 19582;
const out = resolve(process.argv[2] ?? await mkdtemp(join(tmpdir(), 'studio138-branches-')));
await mkdir(out, { recursive: true });
const browser = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'studio138-branches-profile-'));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'designs/console/test/browser/vite.config.mjs', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], { stdio: 'ignore' });
const chrome = spawn(browser, ['--headless', '--disable-gpu', '--disable-extensions', '--no-first-run','--use-mock-keychain','--password-store=basic', '--hide-scrollbars', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(item => item.type === 'page'); if (!page) await delay(100); } catch { await delay(100); }
  }
  assert(page, 'headless Chrome page is available');
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) { try { ready = (await fetch(`http://127.0.0.1:${appPort}/designs/console/test/browser/branches-fixture.html`)).ok; } catch {} if (!ready) await delay(100); }
  assert(ready, 'Vite fixture server is available');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await once(ws, 'open');
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m.result); } };
  const call = (method, params = {}) => new Promise(r => { const id = ++sequence; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, label) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); }
    throw Error(`Timed out waiting for ${label}: ${JSON.stringify(await evaluate(`({body:document.body.innerText.slice(0,600),error:document.querySelector('vite-error-overlay')?.shadowRoot?.innerText})`))}`);
  };
  const click = async (selector, text) => {
    const ok = await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${JSON.stringify(text ?? '')}===''||e.textContent.includes(${JSON.stringify(text ?? '')}));if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true})()`);
    assert(ok, `Found ${selector} ${text ?? ''}`);
    await delay(150);
  };
  const metrics = (width, height, mobile) => call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  // Grow the viewport to the scrolled content so one PNG shows the whole screen.
  const capture = async (name, width, mobile) => {
    const tall = await evaluate(`(()=>{const m=document.querySelector('.branches-main');return Math.ceil(document.documentElement.clientHeight+(m?m.scrollHeight-m.clientHeight:0))})()`);
    await metrics(width, Math.min(tall, 6000), mobile);
    await until(`!document.querySelector('.branch-lanes .lanes-pending')`, `${name}: every row read once seen`);
    await delay(200);
    const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(out, `${name}.png`), Buffer.from(shot.data, 'base64'));
    return join(out, `${name}.png`);
  };
  const heights = () => evaluate(`(()=>{const by={};for(const li of document.querySelectorAll('.branch-lanes>li')){if(li.dataset.selected!==undefined)continue;const k=li.dataset.kind;const h=Math.round(li.getBoundingClientRect().height*10)/10;(by[k]??=new Set()).add(h)}return Object.fromEntries(Object.entries(by).map(([k,v])=>[k,[...v]]))})()`);
  const noSideScroll = async label => {
    const r = await evaluate(`(()=>{const m=document.querySelector('.branches-main');return {page:document.documentElement.scrollWidth,view:document.documentElement.clientWidth,main:m.scrollWidth,mainView:m.clientWidth}})()`);
    assert(r.page <= r.view && r.main <= r.mainView, `${label}: no horizontal scroll ${JSON.stringify(r)}`);
  };
  const shots = [];
  await call('Page.enable');
  await call('Runtime.enable');
  for (const theme of ['console', 'light']) {
    for (const [kind, width, height, mobile] of [['desktop', 1440, 1000, false], ['phone', 390, 844, true]]) {
      await metrics(width, height, mobile);
      await call('Page.navigate', { url: `http://127.0.0.1:${appPort}/designs/console/test/browser/branches-fixture.html?theme=${theme}` });
      await until(`document.querySelectorAll('.branch-lanes>li').length>10 && ![...document.querySelectorAll('.branch-lanes .lanes-pending')].some(e=>e.getBoundingClientRect().top<document.querySelector('.branches-main').getBoundingClientRect().bottom)`, `${kind} lanes with text on screen`);
      const h = await heights();
      for (const [k, v] of Object.entries(h)) assert.equal(v.length, 1, `${kind}: one height for ${k} rows ${JSON.stringify(h)}`);
      if (mobile) for (const k of ['start', 'message', 'split', 'run']) if (h[k]) assert(h[k][0] >= 44, `${kind}: ${k} rows reach 44px ${JSON.stringify(h)}`);
      await noSideScroll(`${kind} ${theme}`);
      // Every split's connector has width and starts at its row's diamond.
      const connectors = await evaluate(`[...document.querySelectorAll('.branch-lanes>li[data-kind=split]')].map(li=>{const d=li.querySelector('.lanes-node').getBoundingClientRect();return [...li.querySelectorAll('.lanes-curve')].map(c=>{const r=c.getBoundingClientRect();const start=c.dataset.dir==='left'?r.right:r.left;return {key:li.dataset.key,width:r.width,offset:Math.abs(start-(d.left+d.width/2)),top:Math.abs(r.top-(d.top+d.height/2))}})}).flat()`);
      assert(connectors.length >= 2, `${kind}: split connectors drawn ${JSON.stringify(connectors)}`);
      for (const c of connectors) assert(c.width > 0 && c.offset <= 2 && c.top <= 2, `${kind}: connector leaves the diamond ${JSON.stringify(c)}`);
      // The fixture sends a real owner `changed` hint. The refreshed family has a visible title
      // change for the same Core Thread, so this cannot pass without consuming the hint.
      await evaluate(`(()=>{const main=document.querySelector('.branches-main');const row=document.querySelector('.branch-lanes>li[data-key="rel|tip"]');row.querySelector('.lanes-point').click();row.scrollIntoView({block:'center'});main.scrollTop=Math.min(120,main.scrollHeight-main.clientHeight);return true})()`);
      await until(`document.querySelector('.branch-lanes>li[data-key="rel|tip"]')?.dataset.selected==='true'`, `${kind}: select the stable Core Thread row`);
      await evaluate(`(()=>{const main=document.querySelector('.branches-main');const row=document.querySelector('.branch-lanes>li[data-key="rel|tip"]');window.__hintRow=row;window.__hintSelection=row.dataset.selected;window.__hintScroll=main.scrollTop})()`);
      await evaluate(`window.branchesFixture.hint()`);
      await until(`document.querySelector('.branch-lanes>li[data-key="rel|tip"] .lanes-head')?.textContent.includes('Release notes refreshed')`, `${kind}: distinguishable owner-hint family update`);
      const continuity = await evaluate(`(()=>{const main=document.querySelector('.branches-main');const row=document.querySelector('.branch-lanes>li[data-key="rel|tip"]');return {same:row===window.__hintRow,selected:row.dataset.selected,beforeSelected:window.__hintSelection,scroll:main.scrollTop,beforeScroll:window.__hintScroll}})()`);
      assert(continuity.same && continuity.selected === continuity.beforeSelected && continuity.scroll === continuity.beforeScroll, `${kind}: original same-Core-ID row remains mounted with selection and scroll unchanged ${JSON.stringify(continuity)}`);
      await evaluate(`document.querySelector('.branch-lanes>li[data-key="rel|tip"] .lanes-point').click()`);
      await until(`!document.querySelector('.branch-lanes>li[data-key="rel|tip"]')?.dataset.selected`, `${kind}: clear the witness selection`);
      shots.push(await capture(`branches-${kind}-${theme}`, width, mobile));
      await metrics(width, height, mobile);
      await click('button.lanes-run', '#7');
      await until(`[...document.querySelectorAll('.lanes-point')].some(e=>e.textContent.includes('Kept it. 12 fixes'))`, 'opened run');
      await click('.lanes-point', 'Kept it. 12 fixes');
      await until(`!!document.querySelector('.lanes-actions')`, 'actions under the selected row');
      shots.push(await capture(`branches-${kind}-${theme}-selected`, width, mobile));
      await metrics(width, height, mobile);
      await click('.lanes-actions button', 'Rewind Release notes refreshed to here');
      await until(`!!document.querySelector('.lanes-row[data-leaving]')`, 'rows marked as leaving');
      await noSideScroll(`${kind} ${theme} rewind`);
      shots.push(await capture(`branches-${kind}-${theme}-rewind`, width, mobile));
      if (mobile) {
        await metrics(width, height, mobile);
        await click('.branches-bar button', 'Compare');
        await until(`getComputedStyle(document.querySelector('.branches-compare')).display!=='none' && document.querySelectorAll('.branch-side').length===2`, 'phone compare view');
        await noSideScroll(`${kind} ${theme} compare`);
        shots.push(await capture(`branches-${kind}-${theme}-compare`, width, mobile));
      }
    }
  }
  console.log(JSON.stringify({ ok: true, out, shots }, null, 1));
} finally {
  ws?.close();
  chrome.kill();
  vite.kill();
}
