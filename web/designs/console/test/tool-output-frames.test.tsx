// @vitest-environment happy-dom
import "@preact/signals";
import { effect, signal } from "@preact/signals-core";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import * as outputRenderers from "../../../ui-core/src/output-renderers";
import { fixtureModel } from "../../../ui-core/test/fixture";
import { flush, settle } from "../../../data/test/harness";
import { loadPrefs, type DesignContext } from "../../../ui-core/src";
import { DESIGNS } from "../../registry";
import { App } from "../screens/App";
import { Conversation } from "../screens/Conversation";
for (const saved of ["", "Synthetic saved body"]) it(`keeps validated ${saved === "" ? "empty" : "body"} output across held refresh frames and unchanged results`, async () => {
  const { model, t, db } = await fixtureModel({ configure(db) { db.outputs["exec-1"] = saved; db.history.lead=[{node_id:"actual-tool",kind:"assistant_response",items:[{kind:"tool_call",item_identity:"call",execution_ids:["exec-1"]}],executions:[{execution_id:"exec-1",kind:"shell",state:"running",started_at:"2026-01-01T00:00:00Z"}]}]; db.shells.lead = [{ execution_id: "exec-1", state: "running", started_at: "2026-01-01T00:00:00Z" }]; } });
  model.openToolGroups.value = new Set(["step:exec-1"]);
  model.toolStepChoices.value = new Map([["exec-1", true]]);
  const host = document.createElement("div"); document.body.append(host);
  act(() => render(<Conversation model={model} />, host)); await act(async () => { await settle(t, db); });
  await act(async()=>{const work=host.querySelector<HTMLDetailsElement>("[data-work-group]")!;expect(work.open).toBe(false);work.open=true;work.dispatchEvent(new Event("toggle"));await settle(t,db);});
  expect(host.querySelector('[data-execution="exec-1"]')?.closest('[data-work-group]')).not.toBeNull();
  await act(async()=>{await settle(t,db);});
  const snapshot = model.outputs.peek().get("exec-1"); expect(snapshot?.loading).toBe(false);
  let changes = 0;
  const format = vi.spyOn(outputRenderers, "renderOutput");
  try {
    const renderedLog = host.querySelector(".log");
    format.mockClear();
    act(() => { model.outputs.value = new Map(model.outputs.peek()).set("unrelated-execution", { text: "other", loading: false, cutOff: false, error: undefined }); });
    expect(format).not.toHaveBeenCalled();
    expect(host.querySelector(".log")).toBe(renderedLog);
    const unwatch = effect(() => { model.outputs.value; changes++; }); const before = changes;
    for (let refresh = 0; refresh < 3; refresh++) {
      await act(async () => { t.push({ t: "changed", thread_ids: ["lead"], list: false, config_changed: false }); await flush(); });
      const pending = t.calls("shell.list").at(-1)!; db.answered.add(pending.id);
      await act(async () => { t.ok(pending.id, { items: db.shells.lead }); await flush(); });
      const held = t.calls("shell.read").at(-1)!; db.answered.add(held.id);
      for (let frame = 0; frame < 3; frame++) {
        act(() => { model.now.value += 1000; });
        await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
        if (saved) expect(host.textContent).toContain(saved);
        else expect(host.querySelector('[data-execution="exec-1"] .shell-step-output')).toBeNull();
        expect(host.textContent).not.toContain(model.t.peek()("details.outputLoading"));
        expect(model.outputs.peek().get("exec-1")).toBe(snapshot);
      }
      act(() => t.ok(held.id, { execution_id: "exec-1", text: saved })); await act(async () => { await flush(); });
      expect(model.outputs.peek().get("exec-1")).toBe(snapshot);
    }
    expect(changes).toBe(before);
  } finally { format.mockRestore(); render(null, host); host.remove(); model.dispose(); }
});

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });
async function toolFixture(state?: string, abbreviated = false, phone = false, command = 'echo first\necho second') {
  const r = await fixtureModel({ configure(db) {
    db.shells.lead = state ? [{ execution_id: 'exec-1', state, started_at: '2026-01-01T00:00:00Z', ...(state === 'exited' ? { ended_at: '2026-01-01T00:00:02Z', exit_code: 7 } : {}) }] : [];
    db.outputs['exec-1'] = 'Retained fixture log';
    const answer = db.answer.bind(db);
    db.answer = call => call.command === 'shell.get' ? { ok: true, result: { execution_id: 'exec-1', command: 'echo first\necho second' } } : answer(call);
    db.history.lead = [{ node_id: 'tool', kind: 'assistant_response', items: [{ kind: 'tool_call', item_identity: 'call', execution_ids: ['exec-1'] }], executions: [{ execution_id: 'exec-1', kind: 'shell', cwd: '/fixture', command_excerpt: abbreviated ? 'echo first' : command, command_truncated: abbreviated, ...(state ? { state } : {}) }] }];
  } });
  const host = document.createElement('div'); document.body.append(host);
  cleanup = () => { render(null, host); host.remove(); r.model.dispose(); r.data.stop(); };
  const prefs = signal(loadPrefs({ read: () => null, write: () => {} }, DESIGNS));
  const context: DesignContext = { model: r.model, prefs, setPrefs: update => { prefs.value = { ...prefs.value, ...update }; }, designs: DESIGNS, submitToken: async () => false };
  await act(async () => { render(phone ? <App context={context} /> : <Conversation model={r.model} />, host); await settle(r.t, r.db); });
  if (phone) host.querySelector<HTMLElement>('[data-panel-root]')!.style.display = 'none';
  const group = host.querySelector<HTMLDetailsElement>('[data-work-group]')!;
  const expand = async () => {
    await act(async () => { group.open = true; group.dispatchEvent(new Event('toggle')); await settle(r.t, r.db); });
    const row = group.querySelector<HTMLDetailsElement>('details.work-element-row')!;
    await act(async () => { r.model.toolStepChoices.value = new Map([['exec-1', true]]); r.model.openInPanel({ kind: 'step', id: 'exec-1' }); });
    await act(async () => { await settle(r.t, r.db); });
    return row;
  };
  return { ...r, host, group, expand };
}

it.each([['stopped', 'Stopped'], [undefined, "Owner doesn't report this"]] as const)('reports a collapsed tool group with %s state without claiming completion', async (state, label) => {
  const { group } = await toolFixture(state);
  expect(group.open).toBe(false);
  const heading = group.querySelector('summary')!;
  expect(heading.querySelector('[data-status="completed"]')).toBeNull();
  expect(heading.getAttribute('aria-label')).toContain(label);
});

it('keeps updating inline tool output after leaving its panel detail', async () => {
  const r = await toolFixture('running');
  const row = await r.expand();
  expect(row.textContent).toContain('Retained fixture log');
  expect(r.host.querySelector('[data-panel-detail]')).not.toBeNull();
  await act(async () => { r.model.closePanelDetail(); });
  expect(row.open).toBe(true);
  r.db.outputs['exec-1'] = 'Final fixture log';
  r.db.shells.lead = [{ execution_id: 'exec-1', state: 'exited', exit_code: 0 }];
  await act(async () => { r.t.push({ t: 'changed', thread_ids: ['lead'], config_changed: false, list: false }); await settle(r.t, r.db); });
  expect(row.textContent).toContain('Final fixture log');
});

it('keeps the last readable log alongside a refresh failure', async () => {
  const r = await toolFixture('running');
  const row = await r.expand();
  expect(row.textContent).toContain('Retained fixture log');
  const answer = r.db.answer.bind(r.db);
  r.db.answer = call => call.command === 'shell.read' ? { ok: false, code: 'io_failed', message: 'Fixture read failed' } : answer(call);
  r.db.shells.lead = [{ execution_id: 'exec-1', state: 'exited', exit_code: 0 }];
  await act(async () => { r.t.push({ t: 'changed', thread_ids: ['lead'], config_changed: false, list: false }); await settle(r.t, r.db); });
  expect(row.textContent).toContain('Fixture read failed');
  expect(row.textContent).toContain('Retained fixture log');
});


it.each([false, true])('shows summary, full command once, output actions and execution facts (truncated command: %s)', async abbreviated => {
  const r = await toolFixture('exited', abbreviated);
  const row = await r.expand();
  expect(row.querySelector('summary')?.textContent).toContain('Shell execution');
  expect(row.querySelector('summary')?.textContent).not.toContain('echo first');
  expect(row.querySelector('.shell-step-command code')?.textContent).toBe('echo first\necho second');
  expect(r.t.calls('shell.get').length).toBe(abbreviated ? 1 : 0);
  expect(row.querySelector('.shell-step-facts [data-status="failed"]')).not.toBeNull();
  expect([...row.querySelectorAll('.shell-step-facts > .mono')].map(fact => fact.textContent)).toEqual(['Exit code 7', '2.0s', '/fixture']);
  expect(row.querySelector('.output-heading')?.textContent).toBe('Output · 1 line');
  await act(async () => { r.model.closePanelDetail(); });
  const button = row.querySelector<HTMLButtonElement>('button[aria-label="Open execution details"]')!;
  await act(async () => { button.click(); });
  expect(r.model.panelDetail.peek()?.id).toBe('exec-1');
});

it('tags Core stderr ranges across pages and keeps Raw as one exact text node', async () => {
  const r = await toolFixture('exited');
  const first = 'stdout stderr-looking text \u65e5\npre';
  const tail = '\u{1f4a5}suffix\nlast';
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const answer = r.db.answer.bind(r.db);
  r.db.answer = call => {
    if (call.command !== 'shell.read') return answer(call);
    if ((call.args as { cursor?: string }).cursor === 'next') return { ok: true, result: {
      execution_id: 'exec-1', text: tail, output_complete: true, segments: [
        { stream: 'stderr', start_byte: 0, end_byte: bytes('\u{1f4a5}') },
        { stream: 'stdout', start_byte: bytes('\u{1f4a5}'), end_byte: bytes(tail) },
      ],
    } };
    return { ok: true, result: { execution_id: 'exec-1', text: first, cursor: 'next',
      segments: [{ stream: 'stdout', start_byte: 0, end_byte: bytes(first) }] } };
  };
  const row = await r.expand();
  expect(r.t.calls('shell.read').map(call => call.args)).toEqual([
    { execution_id: 'exec-1', segments: true }, { execution_id: 'exec-1', segments: true, cursor: 'next' },
  ]);
  expect(row.querySelector('.output-heading')?.textContent).toBe('Output · 3 lines · stderr: 1');
  const panel = r.host.querySelector('[data-panel-detail]')!;
  expect(panel.querySelector('.output-log pre')?.textContent).toBe(first + tail);
  expect(panel.querySelector('[data-stream]')).toBeNull();
  expect([...panel.querySelectorAll('.output-actions button')].map(button => button.textContent)).toEqual(['Copy', 'Wrap lines']);
  const marked = row.querySelectorAll('[data-stream="stderr"]');
  expect(marked).toHaveLength(1);
  expect(marked[0]?.textContent).toBe('stderrpre\u{1f4a5}suffix\n');
  const formatted = row.querySelector<HTMLButtonElement>('button[aria-label="Formatted"]')!;
  await act(async () => formatted.click());
  const raw = row.querySelector('.output-log pre')!;
  expect(raw.childNodes).toHaveLength(1);
  expect(raw.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  expect(raw.textContent).toBe(first + tail);
});

it('preserves the formatted JSON tree when stderr only supplied whitespace', async () => {
  const r = await toolFixture('exited', false, false, 'shellboy thread get');
  const text = '{"outer":{"answer":42}}\n ';
  const answer = r.db.answer.bind(r.db);
  r.db.answer = call => call.command === 'shell.read' ? { ok: true, result: {
    execution_id: 'exec-1', text, segments: [{ stream: 'stderr', start_byte: text.length - 1, end_byte: text.length }],
  } } : answer(call);
  const row = await r.expand();
  expect(row.querySelector('.output-key')?.textContent).toContain('"outer":');
  expect(row.querySelector('.output-value')?.textContent).toContain('"answer": 42');
  expect(row.querySelector('[data-stream]')).toBeNull();
  expect(row.querySelector('.output-heading')?.textContent).toBe('Output · 2 lines · stderr: 1');
  await act(async () => row.querySelector<HTMLButtonElement>('button[aria-label="Formatted"]')!.click());
  expect(row.querySelector('.output-log pre')?.textContent).toBe(text);
});

it('counts stderr source lines beyond the mounted Output window', async () => {
  const r = await toolFixture('exited');
  const prefix = 'out\n'.repeat(200);
  const text = prefix + 'one\ntwo\n';
  const answer = r.db.answer.bind(r.db);
  r.db.answer = call => call.command === 'shell.read' ? { ok: true, result: {
    execution_id: 'exec-1', text, segments: [{ stream: 'stderr', start_byte: prefix.length, end_byte: text.length }],
  } } : answer(call);
  const row = await r.expand();
  expect(row.querySelector('.output-heading')?.textContent).toBe('Output · 202 lines · stderr: 2');
  expect(row.querySelector('[data-stream]')).toBeNull();
  expect(row.querySelectorAll('.output-window > span').length).toBeLessThan(200);
});

it('does not guess stderr when the owner omits segments', async () => {
  const r = await toolFixture('exited');
  r.db.outputs['exec-1'] = 'stderr: this is only text';
  const row = await r.expand();
  expect(row.querySelector('.output-log')?.textContent).toBe('stderr: this is only text');
  expect(row.querySelector('[data-stream]')).toBeNull();
});

it('keeps execution facts and details when Core reports reclaimed output', async () => {
  const r = await toolFixture('running');
  const initial = r.db.answer.bind(r.db);
  r.db.answer = call => call.command === 'shell.read' ? { ok: true, result: {
    execution_id: 'exec-1', text: 'Retained fixture log', segments: [{ stream: 'stderr', start_byte: 0, end_byte: 20 }],
  } } : initial(call);
  const row = await r.expand();
  expect(row.querySelector('[data-stream="stderr"]')).not.toBeNull();
  r.db.answer = call => call.command === 'shell.read' ? { ok: false, code: 'output_expired' } : initial(call);
  await act(async () => { r.t.push({ t: 'changed', thread_ids: ['lead'], config_changed: false, list: false }); await settle(r.t, r.db); });
  expect(row.querySelector('[role="note"]')?.textContent).toContain('no longer retained');
  expect(row.textContent).not.toContain('Retained fixture log');
  expect(row.querySelector('[data-stream]')).toBeNull();
  expect(r.model.outputs.peek().get('exec-1')?.stderr).toBeUndefined();
  expect(row.querySelector('.shell-step-facts [data-status="running"]')).not.toBeNull();
  const duration = row.querySelector('.shell-step-facts [aria-label^="Duration:"]');
  expect(duration?.textContent).toMatch(/ so far$/);
  expect(duration?.getAttribute("aria-label")).toBe(`Duration: ${duration?.textContent}`);
  expect(row.querySelector<HTMLButtonElement>('button[aria-label="Copy output"]')?.disabled).toBe(true);
  expect(row.querySelector<HTMLButtonElement>('button[aria-label="Open execution details"]')?.disabled).toBe(false);
});

it('counts the retained lines and labels cut-off output without tagging unknown streams', async () => {
  const r = await toolFixture('running');
  const row = await r.expand();
  await act(async () => { r.model.outputs.value = new Map(r.model.outputs.peek()).set('exec-1', { text: 'one\n\ntwo\n', loading: false, cutOff: true, error: undefined }); });
  expect(row.querySelector('.output-heading')?.textContent).toBe('Output · 3 lines');
  expect(row.querySelector('[role="note"]')?.textContent).toContain('cut off');
  expect(row.querySelector('.output-log')?.textContent).toBe('one\n\ntwo\n');
  expect(row.querySelector('[data-stream]')).toBeNull();
});


it('opens the visible phone sheet from the inline action without changing panel output controls', async () => {
  const r = await toolFixture('exited', false, true);
  const row = await r.expand();
  await act(async () => { r.model.closePanelDetail(); });
  expect(getComputedStyle(r.host.querySelector('[data-panel-root]')!).display).toBe('none');
  expect(r.host.querySelector('dialog[open]')).toBeNull();
  await act(async () => {
    row.querySelector<HTMLButtonElement>('button[aria-label="Open execution details"]')!.click();
    await settle(r.t, r.db);
  });
  const detail = r.host.querySelector('dialog[open] [data-phone-panel] [data-panel-detail]')!;
  expect(detail).not.toBeNull();
  expect(detail.textContent).toContain('Retained fixture log');
  expect(detail.querySelector('.output-header, .output-format')).toBeNull();
  expect([...detail.querySelectorAll('.output-actions button')].map(button => button.textContent)).toEqual(['Copy', 'Wrap lines']);
});

it('toggles completed inline shell output between formatted and raw text', async () => {
  const r = await toolFixture('exited');
  const raw = '--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-before\n+after\n';
  r.db.outputs['exec-1'] = raw;
  const row = await r.expand();
  const button = () => row.querySelector<HTMLButtonElement>('.output-header button[aria-label="Formatted"]')!;
  const log = () => row.querySelector('.output-log pre')!;
  expect(button().getAttribute('aria-pressed')).toBe('true');
  expect(log().querySelector('.output-add')?.textContent).toContain('+after');
  expect(log().textContent).not.toBe(raw);

  await act(async () => { button().click(); });
  expect(button().getAttribute('aria-pressed')).toBe('false');
  expect(log().querySelector('.output-add')).toBeNull();
  expect(log().textContent).toBe(raw);

  await act(async () => { button().click(); });
  expect(button().getAttribute('aria-pressed')).toBe('true');
  expect(log().querySelector('.output-add')?.textContent).toContain('+after');
  expect(log().textContent).not.toBe(raw);
});

it('does not reread saved shell facts for live-only frames in a long mounted conversation', async () => {
  const publishes: (() => void)[] = [];
  const { model, t, db } = await fixtureModel({
    capabilities: ['history.window', 'live.text'],
    schedule: publish => publishes.push(publish),
    configure(db) {
      db.history.lead = Array.from({ length: 1200 }, (_, i) => ({
        node_id: `saved-${i}`, kind: 'user', items: [{ kind: 'text', item_identity: `message-${i}`, text: `Saved ${i}`, text_complete: true }],
      }));
      db.history.lead.push({ node_id: 'tool', kind: 'assistant_response', items: [{ kind: 'tool_call', item_identity: 'call', execution_ids: ['exec-1'] }], executions: [{ execution_id: 'exec-1', kind: 'shell', state: 'running' }] });
      db.shells.lead = [{ execution_id: 'exec-1', state: 'running' }];
    },
  });
  const host = document.createElement('div');
  document.body.append(host);
  try {
    await act(async () => { render(<Conversation model={model} />, host); await settle(t, db); });
    const reader = model.longReader.peek()!;
    expect(reader.total).toBe(1201);
    const reads = t.calls('shell.list').length;
    expect(reads).toBeGreaterThan(0);
    for (let offset = 0; offset < 20; offset++) {
      await act(async () => {
        t.push({ t: 'live', thread_id: 'lead', attempt_id: 'fixture-stream', gap: false, deltas: [{ offset, reasoning: false, text: 'x' }] });
        publishes.splice(0).forEach(publish => publish());
        await settle(t, db);
      });
    }
    expect(model.handle.peek()!.handoff.peek()[0]?.text).toBe('x'.repeat(20));
    expect(t.calls('shell.list')).toHaveLength(reads);
    await act(async () => { t.push({ t: 'changed', thread_ids: ['lead'], list: false, config_changed: false }); await settle(t, db); });
    expect(t.calls('shell.list').length).toBeGreaterThan(reads);
    const retainedReader = model.longReader.peek()!;
    expect((model as unknown as { shellScan?: unknown }).shellScan).toBeDefined();
    model.dispose();
    expect(model.longReader.peek()).toBeUndefined();
    expect((model as unknown as { shellScan?: unknown }).shellScan).toBeUndefined();
    expect((retainedReader as unknown as { disposed: boolean }).disposed).toBe(true);
  } finally {
    render(null, host);
    host.remove();
    model.dispose();
  }
});
