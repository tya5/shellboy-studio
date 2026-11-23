import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appPort = 19571;
const debugPort = 19572;
const browser = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'studio120-phone-targets-'));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'designs/console/test/browser/vite.config.mjs', '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], { stdio: 'ignore' });
const chrome = spawn(browser, ['--headless', '--disable-gpu', '--disable-extensions', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(item => item.type === 'page');
      if (!page) await delay(100);
    } catch { await delay(100); }
  }
  assert(page, 'headless Chrome page is available');
  let viteReady = false;
  for (let i = 0; i < 100 && !viteReady; i++) { try { viteReady = (await fetch(`http://127.0.0.1:${appPort}/designs/console/test/browser/integration-fixture.html`)).ok; } catch {} if (!viteReady) await delay(100); }
  assert(viteReady, 'Vite fixture server is available');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await once(ws, 'open');
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise(resolve => {
    const id = ++sequence;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, label) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw Error(`Timed out waiting for ${label}: ${JSON.stringify(await evaluate(`({url:location.href,body:document.body.innerText.slice(0,800),error:document.querySelector('vite-error-overlay')?.shadowRoot?.innerText})`))}`);
  };
  const click = async selector => {
    const didClick = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`);
    assert(didClick, `Found ${selector}`);
  };
  const assertMinHeight = async (selector, label) => {
    const result = await evaluate(`(()=>[...document.querySelectorAll(${JSON.stringify(selector)})].map(e=>({name:e.getAttribute('aria-label')||e.innerText||e.tagName,height:e.getBoundingClientRect().height})))()`);
    assert(result.length, `${label} are rendered`);
    assert(result.every(item => item.height >= 44), `${label} reach 44px: ${JSON.stringify(result)}`);
  };

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://127.0.0.1:${appPort}/designs/console/test/browser/integration-fixture.html?view=footer-lifecycle` });
  await until("!!document.querySelector('.app .tabbar') && !!document.querySelector('.phone-panel-footer button')", 'mounted phone fixture');

  await click('.phone-panel-footer button');
  await until("!!document.querySelector('dialog[open] .panel-tabs:not(.panel-tabs-rail)')", 'right-panel sheet tabs');
  await assertMinHeight('dialog[open] .panel-tabs:not(.panel-tabs-rail) button[role=tab]', 'right-panel tabs');
  await click('dialog[open] .work-sheet-head button');
  await until("!document.querySelector('dialog[open]')", 'sheet close');

  await evaluate("location.hash='#/monitor'");
  await until("document.querySelector('.crumb b')?.textContent==='Monitor'", 'Monitor');
  await assertMinHeight('.monitor-tabs .btn-group>.btn', 'Monitor ButtonGroup choices');
  await evaluate("location.hash='#/threads'");
  await until("document.querySelector('.crumb b')?.textContent==='Threads'", 'Threads');
  await assertMinHeight('.org .btn-group>.btn', 'Threads ButtonGroup choices');

  await evaluate("location.hash='#/conversation/lead'");
  await until("!!document.querySelector('[data-settings-toggle]')", 'selected conversation');
  await click('button[aria-label="Open thread list"]');
  await until("document.querySelector('#thread-sidebar.side.open')", 'sidebar drawer');
  const links = await evaluate(`(()=>[...document.querySelectorAll('#thread-sidebar .thread-item-root')].map(row=>{const link=row.querySelector(':scope > .tree-link'),menu=row.querySelector(':scope > .list-row-action button');const a=link.getBoundingClientRect(),r=row.getBoundingClientRect();return {title:link.innerText,linkHeight:a.height,rowHeight:r.height,linkTop:a.top,rowTop:r.top,linkBottom:a.bottom,rowBottom:r.bottom,menuSeparate:!!menu&&menu.parentElement.parentElement.parentElement===row,menuHeight:menu?.getBoundingClientRect().height}}))()`);
  assert(links.length, 'sidebar Thread rows are rendered');
  assert(links.every(item => item.linkHeight >= 44 && item.linkTop === item.rowTop && item.linkBottom === item.rowBottom), `Thread links fill their 44px rows: ${JSON.stringify(links)}`);
  assert(links.every(item => item.menuSeparate && item.menuHeight >= 44), `Thread row menus remain separate 44px targets: ${JSON.stringify(links)}`);
  console.log(JSON.stringify({ viewport: 390, panelTabs: '>=44px', monitorChoices: '>=44px', threadsChoices: '>=44px', threadLinks: links.map(({ title, linkHeight, rowHeight, menuHeight }) => ({ title, linkHeight, rowHeight, menuHeight })) }));
} finally {
  ws?.close();
  for (const child of [chrome, vite]) if (child.exitCode === null) {
    const done = once(child, 'exit'); child.kill('SIGTERM'); await done.catch(() => {});
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
