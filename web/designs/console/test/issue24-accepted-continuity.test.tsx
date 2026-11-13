// @vitest-environment happy-dom
// Regression probe for final bodies surviving an ordinary tail refresh.
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { expect, it } from 'vitest';
import { actual } from './projection24-actual-input.mjs';
import { App } from '../screens/App';
import { DESIGNS } from '../../registry';
import type { DesignContext } from '../../../ui-core/src';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { settle } from '../../../data/test/harness';

it('keeps initially visible final bodies through live handoff and a refreshed accepted snapshot', async () => {
  const seed = actual('actual-window.json') as {
    thread_id: string;
    revision: number;
    total: number;
    items: Array<Record<string, any>>;
  };
  const first = structuredClone(seed);
  const extra = (ordinal: number, nodeId: string, text: string) => ({
    ...structuredClone(first.items[1]),
    node_id: nodeId,
    selection: { ...first.items[1]!.selection, ordinal },
    items: [{ kind: 'text', item_identity: `${nodeId}-body`, text, text_complete: true }],
  });
  first.items = [...first.items, extra(4, 'n4', 'five-visible'), extra(5, 'n5', 'six-visible')];
  first.total = 6;

  let currentRevision = 4;
  const r = await fixtureModel({
    capabilities: ['history.window', 'live.text'],
    route: 'conversation',
    threadId: 'lead',
    configure(db) {
      db.history.lead = first.items as never[];
      const answer = db.answer.bind(db);
      db.answer = call => {
        const result = answer(call);
        if (call.command === 'history.window' && result.ok) {
          return { ...result, result: { ...result.result as object, revision: currentRevision } };
        }
        return result;
      };
    },
  });
  const host = document.createElement('div');
  document.body.append(host);
  const prefs = signal({ design: 'console', theme: 'console', lang: 'en', weights: { cached: 0.1, output: 5 } });
  const context = { model: r.model, prefs, designs: DESIGNS, setPrefs() {} } as unknown as DesignContext;

  try {
    await act(async () => {
      render(<App context={context} />, host);
      await settle(r.t, r.db);
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    await settle(r.t, r.db);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const reader = r.model.longReader.value!;
    const visible = () => [...host.querySelectorAll<HTMLElement>('[data-node]')].map(element => ({
      element,
      node: element.getAttribute('data-node'),
      body: element.querySelector('.md')?.textContent?.trim() ?? null,
    }));
    const before = visible();
    expect(before.map(row => row.node)).toContain('n4');
    expect(before.map(row => row.node)).toContain('n5');
    expect(host.textContent).toContain('five-visible');
    expect(host.textContent).toContain('six-visible');
    const beforeBodies = new Map(before.filter(row => row.node === 'n4' || row.node === 'n5').map(row => [row.node, row.body]));
    const beforeElements = new Map(before.filter(row => row.node === 'n4' || row.node === 'n5').map(row => [row.node, row.element]));

    // These are ordinary owner transport events, not a synthetic deletion or repaint.
    await act(async () => {
      r.t.push({ t: 'live', thread_id: 'lead', attempt_id: 'handoff-a', gap: false, deltas: [{ offset: 0, reasoning: false, text: 'handoff-preview' }] });
      r.t.push({ t: 'live_end', thread_id: 'lead' });
      await settle(r.t, r.db);
    });
    currentRevision = 5;
    r.db.history.lead = [...first.items, extra(6, 'n6', 'tail-update')] as never[];
    await act(async () => {
      reader.changed();
      await settle(r.t, r.db);
    });

    const after = visible();
    expect(after.map(row => row.node)).toEqual(expect.arrayContaining(['n4', 'n5', 'n6']));
    const order = after.map(row => row.node);
    expect(order.indexOf('n4')).toBeLessThan(order.indexOf('n5'));
    expect(order.indexOf('n5')).toBeLessThan(order.indexOf('n6'));
    expect(new Map(after.filter(row => row.node === 'n4' || row.node === 'n5').map(row => [row.node, row.body]))).toEqual(beforeBodies);
    for (const row of after.filter(row => row.node === 'n4' || row.node === 'n5')) expect(row.element).toBe(beforeElements.get(row.node));
    expect(reader.acceptedView.peek().revision).toBe(5);
    expect(reader.acceptedView.peek().total).toBe(7);
    expect(after.find(row => row.node === 'n4')!.body).toContain('five-visible');
    expect(after.find(row => row.node === 'n5')!.body).toContain('six-visible');
  } finally {
    render(null, host);
    host.remove();
    r.model.dispose();
    r.data.stop();
  }
});
