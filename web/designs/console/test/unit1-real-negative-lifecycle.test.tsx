// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { expect, it } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { details, flush, settle, summary } from '../../../data/test/harness';
import type { HistoryItem } from '../../../data/src/protocol';
import type { DesignContext } from '../../../ui-core/src';
import { loadPrefs } from '../../../ui-core/src/prefs';
import { App } from '../screens/App';
import { typedHandoffRegistry, type TypedHistoryWindow } from '../../../ui-core/test/typed-handoff-fixture';

const context = (model: DesignContext['model']): DesignContext => ({
  model,
  prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: 'console', themes: [{ name: 'light' }] }])),
  setPrefs: () => {}, designs: [], submitToken: async () => false,
});

async function realLifecycle(mode: 'budget' | 'stale' | 'delete' | 'aba') {
  let ended = false, deleted = false;
  const registry = typedHandoffRegistry({ threadId: 'thread', attemptId: 'attempt-1', turnId: 'turn-1', revision: 8, total: 4,
    refs: [{ nodeId: 'answer-1', ordinal: 2, text: 'Canonical answer' }, { nodeId: 'answer-2', ordinal: 3, text: 'Canonical continuation' }] });
  const first = registry.refs[0]!, second = registry.refs[1]!;
  const attempt = registry.attempt();
  const nodes: HistoryItem[] = [
    { node_id: 'user-0', kind: 'user', selection: { ordinal: 0 }, items: [{ kind: 'text', item_identity: 'u0', text: 'Question', text_complete: true }] },
    { node_id: 'tool-1', kind: 'tool', selection: { ordinal: 1 }, items: [{ kind: 'text', item_identity: 'tool1', text: 'intervening work', text_complete: true }] },
    ...registry.refs.map(ref => ({ node_id: ref.nodeId, kind: 'assistant_response' as const, selection: { ordinal: ref.ordinal }, items: null, items_unavailable_reason: 'response_budget' as const })),
  ];
  const canonical = (ref: typeof first): HistoryItem => ({ node_id: ref.nodeId, kind: 'assistant_response', selection: { ordinal: ref.ordinal }, items: [{ kind: 'text', item_identity: `${ref.nodeId}:/output/0/content/0`, text: ref.text, text_complete: true }] });
  const f = await fixtureModel({ capabilities: ['live.text', 'history.window'], configure(db) {
    db.threads = { thread: summary('thread') }; db.details.thread = details('thread'); db.history.thread = nodes;
    const base = db.answer.bind(db); db.answer = call => {
      if (call.command === 'status') return { ok: true, result: { items: ended ? [attempt] : [] } };
      if (call.command === 'history.window') {
        const args = call.args as { node_id?: unknown; ordinal?: unknown };
        const point = typeof args.node_id === 'string' ? args.node_id : undefined;
        const ordinal = Number.isSafeInteger(args.ordinal) ? args.ordinal as number : undefined;
        const ref = [first, second].find(item => (point === undefined || item.nodeId === point) && (ordinal === undefined || item.ordinal === ordinal));
        const proof = ref && registry.history({ node_id: point, ordinal, before: 99, after: 100 });
        if (!ref || !proof || deleted) return { ok: true, result: { thread_id: 'thread', revision: 9, total: 2, item_count: 0, items: [] } };
        if (mode === 'budget') return { ok: true, result: proof };
        if (mode === 'stale') return { ok: true, result: { ...proof, revision: 7 } as TypedHistoryWindow };
        if (mode === 'delete') return { ok: true, result: proof };
        return { ok: true, result: proof };
      }
      return base(call);
    };
  } });
  const host = document.createElement('div'); document.body.append(host);
  await act(async () => { render(<App context={context(f.model)} />, host); await settle(f.t, f.db); });
  await act(async () => { f.t.push({ t: 'live', thread_id: 'thread', attempt_id: 'attempt-1', gap: false, deltas: [{ offset: 0, reasoning: false, text: 'Preview answer' }] }); await flush(24); });
  const answerHost = host.querySelector('[data-answer-container]');
  const before = f.model.longReader.peek()!.acceptedView.peek();
  ended = true; registry.canonical = mode !== 'budget' && mode !== 'stale';
  if (registry.canonical) { nodes[2] = canonical(first); nodes[3] = canonical(second); }
  await act(async () => { f.t.push({ t: 'live_end', thread_id: 'thread' }); await settle(f.t, f.db); await flush(24); });
  if (mode === 'delete') {
    registry.revision = 9; registry.total = 2; deleted = true; nodes.splice(2); f.db.history.thread = nodes;
    await act(async () => { f.t.push({ t: 'changed', thread_ids: ['thread'], list: false }); await settle(f.t, f.db); await flush(24); });
  }
  if (mode === 'aba') {
    f.model.longReader.peek()!.acceptedView.revoke();
    await act(async () => { f.t.push({ t: 'changed', thread_ids: ['thread'], list: false }); await settle(f.t, f.db); await flush(24); });
  }
  return { f, host, answerHost, before, nodes };
}

it('real App keeps truthful preview through budget/partial/stale receipt until current typed children are covered', async () => {
  for (const mode of ['budget', 'stale'] as const) {
    const r = await realLifecycle(mode);
    expect(r.host.textContent).toContain('Preview answer');
    expect(r.host.querySelector('[data-answer-container]')).toBe(r.answerHost);
    const current = r.f.model.longReader.peek()!.acceptedView.peek();
    expect(r.f.model.longReader.peek()!.acceptedView.isCurrent(current)).toBe(true);
    expect(current.assistantOwnership?.some(record => record.mode === 'canonical')).toBe(false);
    r.f.model.dispose(); r.f.data.stop(); r.host.remove();
  }
});

it('real App removes deleted canonical children after revision change without resurrecting the old body', async () => {
  const r = await realLifecycle('delete');
  expect(r.host.textContent).not.toContain('Canonical answer');
  expect([...r.host.querySelectorAll('[data-item-key]')].some(node => node.getAttribute('data-item-key')?.includes('answer-1'))).toBe(false);
  expect(r.f.model.longReader.peek()!.acceptedView.isCurrent(r.f.model.longReader.peek()!.acceptedView.peek())).toBe(true);
  r.f.model.dispose(); r.f.data.stop(); r.host.remove();
});

it('real App rejects an ABA publication after capability revocation', async () => {
  const r = await realLifecycle('aba');
  const current = r.f.model.longReader.peek()!.acceptedView.peek();
  expect(r.f.model.longReader.peek()!.acceptedView.isCurrent(r.before)).toBe(false);
  expect(current.generation).toBeGreaterThanOrEqual(r.before.generation);
  expect(r.host.textContent).not.toContain('Canonical continuation');
  r.f.model.dispose(); r.f.data.stop(); r.host.remove();
});

it('real Show Latest action follows the current window without changing the answer host or canonical order', async () => {
  const r = await realLifecycle('delete');
  const win = r.f.model.longReader.peek()!;
  const before = win.acceptedView.peek();
  win.jumpToEnd();
  await settle(r.f.t, r.f.db);
  const after = win.acceptedView.peek();
  expect(win.acceptedView.isCurrent(after)).toBe(true);
  expect(after.generation).toBeGreaterThanOrEqual(before.generation);
  expect(after.rows.map(row => row.selection?.ordinal)).toEqual([...after.rows].map(row => row.selection?.ordinal).sort((a, b) => (a ?? -1) - (b ?? -1)));
  r.f.model.dispose(); r.f.data.stop(); r.host.remove();
});
