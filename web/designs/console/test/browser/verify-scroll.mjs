// Run from any cwd: node web/designs/console/test/browser/verify-scroll.mjs [new-output-dir]
// Uses only Vite and Chrome CDP. Every server/profile belongs to this process.
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const out = process.argv[2] ?? await mkdtemp(path.join(tmpdir(), "s7-scroll-evidence-"));
if (process.argv[2]) await mkdir(out); // refuse to overwrite an existing artifact directory
console.log(`Artifacts: ${out}`);
const profile = await mkdtemp(path.join(tmpdir(), "s7-scroll-chrome-"));
const pause = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
const server = await createServer({ configFile: false, root: fileURLToPath(new URL("../../../../", import.meta.url)),
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } }, optimizeDeps: { noDiscovery: true, include: ["preact", "preact/hooks", "preact/jsx-dev-runtime", "@preact/signals", "@preact/signals-core", "markdown-it", "qrcode-generator"] }, server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const port = server.httpServer.address().port;
const chrome = spawn(process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
let ws;
const results = [];
let diagnose = async () => undefined;
try {
  let cdp;
  for (let i = 0; i < 100; i++) {
    try { cdp = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; } catch { await pause(50); }
  }
  assert(cdp, "Chrome did not open its temporary CDP port");
  const pages = await (await fetch(`http://127.0.0.1:${cdp}/json`)).json();
  ws = new WebSocket(pages.find((page) => page.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (!pending.has(msg.id)) return;
    const { resolve, reject, timer } = pending.get(msg.id); pending.delete(msg.id); clearTimeout(timer);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const api = (expression) => evaluate(`window.scrollFixture.${expression}`);
  const snap = () => api("snapshot()");
  diagnose = snap;
  const shot = async (name) => { const image = await command("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(out, `${name}.png`), Buffer.from(image.data, "base64")); };
  const checkAnchor = async (before, after, label) => {
    const anchorAfter = await api(`snapshot(${before.ordinal})`);
    assert.equal(anchorAfter.ordinal, before.ordinal, `${label}: ordinal`);
    assert(Math.abs(anchorAfter.offset - before.offset) <= 1, `${label}: ${before.offset} -> ${anchorAfter.offset}`);
    results.push({ label, before, after, anchorAfter });
  };
  const load = async (total, device, extra = "") => {
    await command("Emulation.setDeviceMetricsOverride", { width: device === "desktop" ? 1440 : 390, height: device === "desktop" ? 1000 : 844, deviceScaleFactor: 1, mobile: device !== "desktop" });
    await command("Emulation.setTouchEmulationEnabled", { enabled: device !== "desktop" });
    await command("Page.navigate", { url: `http://127.0.0.1:${port}/designs/console/test/browser/scroll.html?total=${total}${extra}` });
    let ready = false;
    for (let i = 0; i < 150; i++) { await pause(50); if (await evaluate('document.body?.dataset.ready === "yes"')) { ready = true; break; } }
    assert(ready, "synthetic page not ready"); await pause(400);
  };
  await command("Page.enable"); await command("Runtime.enable");
  for (const device of ["desktop", "mobile"]) {
    await load(100_000, device);
    let state = await snap();
    assert(state.following); assert.equal(state.listCalls, 0); assert.equal(state.total, 100_000);
    assert(Math.abs(state.scrollHeight - state.scrollTop - state.clientHeight) <= 1);
    results.push({ label: `${device}: open`, state }); await shot(`${device}-tail`);
    const point = await evaluate('(() => { const r = document.querySelector(".scroll-frame > .scroll").getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
    if (device === "desktop") {
      await evaluate('document.querySelector(".scroll-frame > .scroll").focus({preventScroll:true})');
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 });
    } else {
      await command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y - 80 }] });
      for (let i = 1; i <= 5; i++) { await pause(30); await command("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x, y: point.y - 80 + i * 30 }] }); }
      await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await pause(350); state = await snap(); assert.equal(state.following, false); assert(state.scrollTop < state.scrollHeight - state.clientHeight);
    results.push({ label: `${device}: actual keyboard/touch movement detaches`, state });
    await api("jump()"); await pause(350);
    await api('live("Synthetic live text. ".repeat(100))'); await pause(250); state = await snap();
    assert(state.following && Math.abs(state.scrollHeight - state.scrollTop - state.clientHeight) <= 1);
    results.push({ label: `${device}: following live growth`, state });
    await command("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: -500 }); await pause(300);
    assert.equal((await snap()).following, false, "actual upward wheel detaches");
    await api("middle()"); await pause();
    let before = await snap();
    await api(`grow(${before.ordinal + 10}, 140)`); await pause();
    await checkAnchor(before, await snap(), `${device}: below-anchor measurement`);
    before = await snap();
    await api(`grow(${before.ordinal - 3}, 170)`); await pause();
    await checkAnchor(before, await snap(), `${device}: above-anchor measurement`);
    // Click an actual native details heading in the production Conversation screen.
    await evaluate('(() => { const b = document.querySelector(".scroll-frame > .scroll"); const s = [...b.querySelectorAll(".step summary")].find(s => s.getBoundingClientRect().top > b.getBoundingClientRect().top + 40); window.testHeading = s; b.scrollTop += s.getBoundingClientRect().top - b.getBoundingClientRect().top - 150; })()'); await pause();
    const clickHeading = async () => {
      const r = await evaluate('(() => { const r = window.testHeading.getBoundingClientRect(); return {x:r.x+40,y:r.y+r.height/2,top:r.top}; })()');
      await command("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
      await pause(300);
      const after = await evaluate('window.testHeading.getBoundingClientRect().top');
      assert(Math.abs(r.top - after) <= 1, `tool heading drift ${r.top} -> ${after}`);
      results.push({ label: `${device}: native details toggle`, beforeTop: r.top, afterTop: after });
    };
    await clickHeading();
    await evaluate('window.testOuterHeading = window.testHeading; window.testHeading = window.testHeading.parentElement.querySelector(".step summary")');
    await clickHeading(); await shot(`${device}-tool-open`); await clickHeading();
    await evaluate('window.testHeading = window.testOuterHeading'); await clickHeading();
    before = await snap(); await api('live("Detached live growth. ".repeat(100))'); await pause();
    await checkAnchor(before, await snap(), `${device}: detached live growth`);
    await api("endLive()"); await pause();
    before = await snap(); await api("append(3)"); await pause();
    await checkAnchor(before, await snap(), `${device}: detached append hint`);
    // An unavailable upper edge cannot be crossed, even while its reply is deliberately held.
    await api("hold(true)"); await api("top()"); await pause(250);
    const stopped = await snap(); assert.equal(stopped.scrollTop, 0); assert(stopped.reads > 0);
    await pause(200); assert.deepEqual((await snap()).range, stopped.range);
    await shot(`${device}-held-edge`);
    await api("hold(false)"); await pause(450);
    await checkAnchor(stopped, await snap(), `${device}: measured prepend`);
    // Keep traversing long enough to evict the old tail, then explicitly return to it.
    for (let k = 0; k < 18; k++) { await api("top()"); await pause(170); state = await snap(); assert(state.windows <= 16 && state.measurements <= 1600 && state.domRows <= 1600); }
    state = await snap(); assert(state.range.last < state.total - 1);
    results.push({ label: `${device}: sustained reading`, state }); await shot(`${device}-eviction`);
    await api("jump()"); await pause(500); state = await snap();
    assert(state.following); assert.equal(state.range.last, state.total - 1);
    assert(Math.abs(state.scrollHeight - state.scrollTop - state.clientHeight) <= 1);
    results.push({ label: `${device}: disjoint return to newest`, state });
    await api("append(10000)"); await pause(500); state = await snap();
    assert.equal(state.total, 110003); assert.equal(state.range.last, 110002); assert(state.following);
    // A rewrite is discovered by the next adjacent read while detached, not by polling hints.
    await api("middle()"); await pause(); results.push({label: `${device}: pre-rewind middle`, state: await snap()}); await api("rewrite(50000)"); await api("top()"); await pause(600);
    state = await snap(); assert.equal(state.total, 50000); assert.equal(state.following, false);
    results.push({ label: `${device}: rewind`, state }); await shot(`${device}-rewind`);
    await api("dispose()");
    await load(100_000, device, "&dense=1");
    const denseIdle = await snap(); await pause(300); assert.equal((await snap()).calls, denseIdle.calls); assert.equal(denseIdle.calls, 1);
    await evaluate('document.querySelector(".step-group > summary").click()'); await pause(250);
    await api("middle()"); await pause();
    await evaluate('(() => { const b = document.querySelector(".scroll-frame > .scroll"); const r = b.getBoundingClientRect(); const step = [...b.querySelectorAll(".step[data-scroll-key]")].find(el => el.getBoundingClientRect().top > r.top + 40); window.denseKey = step.dataset.scrollKey; step.querySelector("summary").click(); })()'); await pause(300);
    await api("hold(true)"); await api("top()"); await pause(250);
    const denseBefore = await evaluate('(() => { const b = document.querySelector(".scroll-frame > .scroll"); const s = b.querySelector(".step[data-scroll-key]"); window.denseAnchorKey = s.dataset.scrollKey; return s.getBoundingClientRect().top - b.getBoundingClientRect().top; })()');
    await api("hold(false)"); await pause(450);
    const denseAfter = await evaluate('(() => { const b = document.querySelector(".scroll-frame > .scroll"); const s = [...b.querySelectorAll(".step[data-scroll-key]")].find(el => el.dataset.scrollKey === window.denseAnchorKey); const opened = [...b.querySelectorAll(".step[data-scroll-key]")].find(el => el.dataset.scrollKey === window.denseKey); return { offset: s?.getBoundingClientRect().top - b.getBoundingClientRect().top, open: opened?.open, groupOpen: b.querySelector(".step-group")?.open }; })()');
    assert(Math.abs(denseAfter.offset - denseBefore) <= 1, `dense tool anchor ${denseBefore} -> ${denseAfter.offset}`);
    assert(denseAfter.open && denseAfter.groupOpen);
    results.push({ label: `${device}: regrouped tools preserve heading and open output`, denseBefore, denseAfter, state: await snap() }); await shot(`${device}-regrouped-tools`);
    await api("dispose()");
    await load(1, device); state = await snap();
    assert(state.scrollHeight <= state.clientHeight); assert(state.following);
    const p = await evaluate('(() => { const r = document.querySelector(".scroll-frame > .scroll").getBoundingClientRect(); return {x:r.x+20,y:r.y+30}; })()');
    await command("Input.dispatchMouseEvent", { type: "mouseWheel", ...p, deltaX: 0, deltaY: -500 }); await pause();
    assert.equal((await snap()).following, true);
    results.push({ label: `${device}: fitting content stays following`, state: await snap() }); await shot(`${device}-short`);
    await api("dispose()");
  }
  await writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ ok: true, assertions: results.length, out }));
} catch (error) {
  await writeFile(path.join(out, "failure.json"), JSON.stringify({ error: String(error), state: await diagnose().catch(() => undefined), results }, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  ws?.close(); chrome.kill(); await server.close();
  await new Promise((resolve) => chrome.once("exit", resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
}
