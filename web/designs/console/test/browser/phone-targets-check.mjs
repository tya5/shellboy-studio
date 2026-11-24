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
    const result = await evaluate(`(()=>[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0).map(e=>({name:e.getAttribute('aria-label')||e.innerText||e.tagName,height:e.closest('.form-field-root')?.getBoundingClientRect().height||e.getBoundingClientRect().height})))()`);
    assert(result.length, `${label} are rendered`);
    assert(result.every(item => item.height >= 44), `${label} reach 44px: ${JSON.stringify(result)}`);
  };

  await call('Page.enable');
  await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: `http://127.0.0.1:${appPort}/designs/console/test/browser/integration-fixture.html?view=footer-lifecycle` });
  await until("!!document.querySelector('.app .tabbar') && !!document.querySelector('.phone-panel-footer button')", 'mounted phone fixture');

  await click('.phone-panel-footer button');
  await until("!!document.querySelector('dialog[open] .panel-tabs-phone-picker select')", 'right-panel sheet tabs');
  await assertMinHeight('dialog[open] .panel-tabs-phone-picker select', 'right-panel tabs');
  await click('dialog[open] .work-sheet-head button');
  await until("!document.querySelector('dialog[open]')", 'sheet close');

  await call('Page.navigate', { url: `http://127.0.0.1:${appPort}/designs/console/test/browser/integration-fixture.html?view=sidebar#/monitor` });
  await until("!!document.querySelector('.app .tabbar')", 'monitor fallback fixture mounted');
  await delay(500);
  await until("!['Monitor','Threads'].includes(document.querySelector('.crumb b')?.textContent||'')", 'removed Monitor route fallback');
  await call('Page.navigate', { url: `http://127.0.0.1:${appPort}/designs/console/test/browser/integration-fixture.html?view=sidebar#/threads` });
  await until("!!document.querySelector('.app .tabbar')", 'threads fallback fixture mounted');
  await delay(500);
  await until("!['Monitor','Threads'].includes(document.querySelector('.crumb b')?.textContent||'')", 'removed Threads route fallback');

  await call('Page.navigate', { url: `http://127.0.0.1:${appPort}/designs/console/test/browser/integration-fixture.html?view=sidebar#/conversation/lead` });
  await until("!!document.querySelector('[data-settings-toggle]')", 'selected conversation');
  const columns = await evaluate("getComputedStyle(document.querySelector('.app .tabbar')).gridTemplateColumns.split(' ').length");
  assert.equal(columns, 3, 'phone navigation has exactly three tabs');
  await click('button[aria-label="Open thread list"]');
  await until("document.querySelector('#thread-sidebar.side.open')", 'sidebar drawer');
  const textButton = async text => {
    const found = await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`);
    assert(found, `Found button ${text}`);
  };
  await textButton('Select Threads');
  const firstCheckbox = await evaluate("(()=>{const e=document.querySelector('#thread-sidebar input[aria-label^=\"Select \"]');if(!e)return false;e.click();return true})()");
  assert(firstCheckbox, 'active Thread row can be selected');
  const selectionButtons = await evaluate("[...document.querySelectorAll('.selbar button')].map(b=>({text:b.textContent.trim(),height:b.getBoundingClientRect().height}))");
  assert(selectionButtons.some(button => button.text === 'Archive'), `selection bar exposes Archive: ${JSON.stringify(selectionButtons)}`);
  assert(selectionButtons.every(button => button.height >= 44), `selection actions reach touch size: ${JSON.stringify(selectionButtons)}`);
  await textButton('Archive');
  assert(await evaluate("[...document.querySelectorAll('.selbar button')].some(b=>b.textContent.trim()==='Confirm archive')"), 'archive requires a second explicit press');
  const secondCheckbox = await evaluate("(()=>{const e=document.querySelectorAll('#thread-sidebar input[aria-label^=\"Select \"]')[1];if(!e)return false;e.click();return true})()");
  assert(secondCheckbox, 'selection change target exists');
  assert(await evaluate("[...document.querySelectorAll('.selbar button')].some(b=>b.textContent.trim()==='Archive')"), 'changing selection re-arms archive confirmation');

  const closeSelection = await evaluate("(()=>{const b=[...document.querySelectorAll('.selbar button')].find(e=>e.textContent.trim()==='Close');if(!b)return false;b.click();return true})()");
  assert(closeSelection, 'close selection mode');
  const rowMenu = '#thread-sidebar .thread-item-root .list-row-action button';
  await click(rowMenu);
  await textButton('Edit tags…');
  await until("document.querySelector('.alerts')?.innerText.includes('Tags for this Thread')", 'single-Thread tag editor');
  await assertMinHeight('.alerts button', 'tag editor actions');
  await textButton('Close');
  await click('button[aria-label="Open thread list"]');
  await until("document.querySelector('#thread-sidebar.side.open')", 'sidebar reopened after tag editor');
  await click(rowMenu);
  await textButton('Set parent');
  await until("document.querySelector('.alerts')?.innerText.includes('New parent')", 'single-Thread Move picker');
  await assertMinHeight('.thread-move-list button', 'Move picker choices');
  await evaluate("document.querySelector('.thread-move-list')?.scrollTo(0,document.querySelector('.thread-move-list').scrollHeight)");
  const moveBounds = await evaluate("(()=>{const e=document.querySelector('.thread-move-list');return {height:e?.clientHeight,scroll:e?.scrollHeight}})()");
  assert(moveBounds.height && moveBounds.scroll >= moveBounds.height, `Move list has a bounded scroll viewport: ${JSON.stringify(moveBounds)}`);
  await textButton('Close');

  console.log(JSON.stringify({ viewport: 390, panelTabs: '>=44px', selectionActions: '>=44px', tagActions: '>=44px', moveChoices: '>=44px', archiveConfirmation: 'verified' }));
} finally {
  ws?.close();
  for (const child of [chrome, vite]) if (child.exitCode === null) {
    const done = once(child, 'exit'); child.kill('SIGTERM'); await done.catch(() => {});
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
