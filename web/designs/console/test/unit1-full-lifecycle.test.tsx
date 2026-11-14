// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect, it } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { summary, details, flush, settle } from '../../../data/test/harness';
import type { HistoryItem } from '../../../data/src/protocol';
import type { DesignContext } from '../../../ui-core/src';
import { loadPrefs } from '../../../ui-core/src/prefs';
import { App } from '../screens/App';

it('keeps one answer presentation through preview, canonical save, retirement, and next turn', async () => {
  let ended = false;
  let revision = 7;
  const nodes: HistoryItem[] = [
    { node_id: 'user-0', kind: 'user', selection: { ordinal: 0 }, items: [{ kind: 'text', item_identity: 'u0', text: 'Question', text_complete: true }] },
    { node_id: 'tool-1', kind: 'tool', selection: { ordinal: 1 }, items: [{ kind: 'text', item_identity: 'tool1', text: 'work', text_complete: true }] },
    { node_id: 'answer-1', kind: 'assistant_response', selection: { ordinal: 2 }, items: [
      { kind: 'text', item_identity: 'answer-1:/output/0/content/0', text: 'Canonical answer', text_complete: true },
      { kind: 'text', item_identity: 'answer-1:/output/0/content/1', text: 'Canonical continuation', text_complete: true },
    ] },
  ];
  const fixture = await fixtureModel({ capabilities: ['live.text', 'history.window'], configure(db) {
    db.threads = { thread: summary('thread') };
    db.details.thread = details('thread');
    db.history.thread = nodes;
    const base = db.answer.bind(db);
    db.answer = call => {
      if (call.command === 'status') return { ok: true, result: { items: ended ? [{ kind: 'attempt', id: 'attempt-1', attempt_id: 'attempt-1', turn_id: 'turn-1', thread_id: 'thread', state: 'completed', response_nodes_truncated: false, response_nodes: [{ node_id: 'answer-1', ordinal: 2, kind: 'message' }] }] : [] } };
      if (call.command === 'history.window') return { ok: true, result: { thread_id: 'thread', revision, total: nodes.length, items: nodes } };
      return base(call);
    };
  } });
  const host = document.createElement('div');
  document.body.append(host);
  const context: DesignContext = { model: fixture.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: 'console', themes: [{ name: 'light' }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
  try {
    await act(async () => { render(<App context={context} />, host); await settle(fixture.t, fixture.db); });
    await act(async () => { fixture.t.push({ t: 'live', thread_id: 'thread', attempt_id: 'attempt-1', gap: false, deltas: [{ offset: 0, reasoning: false, text: 'Preview answer' }] }); await flush(24); });
    const previewContainer = host.querySelector('[data-answer-container]');
    expect(previewContainer).not.toBeNull();
    expect(previewContainer?.textContent).toContain('Preview answer');
    const previewChildren = [...host.querySelectorAll('[data-answer-container] [data-item-key]')].map(el => ({ node: el.getAttribute('data-node'), key: el.getAttribute('data-key') }));
    expect(previewChildren).toHaveLength(1);

    ended = true;
    await act(async () => { fixture.t.push({ t: 'live_end', thread_id: 'thread' }); await settle(fixture.t, fixture.db); await flush(24); });
    const canonicalContainer = host.querySelector('[data-answer-container]');
    expect(canonicalContainer).toBe(previewContainer);
    expect(canonicalContainer?.textContent).toContain('Canonical answer');
    expect(canonicalContainer?.textContent).toContain('Canonical continuation');
    expect([...host.querySelectorAll('[data-answer-container] [data-item-key]')].map(el => [el.getAttribute('data-node'), el.getAttribute('data-key')])).toHaveLength(2);

    fixture.db.history.thread = [...nodes, { node_id: 'user-1', kind: 'user', selection: { ordinal: 3 }, items: [{ kind: 'text', item_identity: 'u1', text: 'Next question', text_complete: true }] }];
    revision++;
    await act(async () => { fixture.t.push({ t: 'changed', thread_ids: ['thread'], list: false }); await settle(fixture.t, fixture.db); await flush(24); });
    expect(host.textContent).toContain('Next question');
    expect(host.textContent).toContain('Canonical answer');
  } finally { render(null, host); host.remove(); fixture.model.dispose(); fixture.data.stop(); }
});
