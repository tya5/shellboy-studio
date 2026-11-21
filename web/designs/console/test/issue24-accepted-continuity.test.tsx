import type {HistoryItem} from '../../../data/src/protocol';
import {typedSelectedCoverageWindow} from '../../../ui-core/test/typed-handoff-fixture';
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
import { Cancel } from '../../../data/src';

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
      body: element.querySelector('.message-markdown')?.textContent?.trim() ?? null,
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

it.each([
  { name: 'same-revision target-first', targetFirst: true, changedRevision: false, trigger: false },
  { name: 'same-revision full-first', targetFirst: false, changedRevision: false, trigger: true },
  { name: 'different-revision target-first', targetFirst: true, changedRevision: true, trigger: true },
  { name: 'different-revision full-first', targetFirst: false, changedRevision: true, trigger: false },
])('keeps a qualified tail body across $name', async ({ targetFirst, changedRevision, trigger }) => {
  const seed = actual('actual-window.json') as { items: Array<Record<string, any>> };
  const rows:HistoryItem[] = Array.from({ length: 95 }, (_, ordinal) => ({
    ...structuredClone(seed.items[ordinal % seed.items.length]),
    node_id: `n${ordinal}`,
    selection: { ...seed.items[ordinal % seed.items.length]!.selection, ordinal },
    items: [{ kind: 'text' as const, item_identity: `["n${ordinal}","/output/0/content/0"]`, text: ordinal === 94 ? 'qualified-final-body' : `body-${ordinal}`, text_complete: true }],
  }));
  let revision = 4;const trace:Record<string,unknown>[]=[];let stop=()=>{};
  const r = await fixtureModel({
    capabilities: ['history.window', 'live.text'],
    route: 'conversation',
    threadId: 'lead',
    configure(db) {
      db.history.lead = rows;
      const answer = db.answer.bind(db);
      db.answer = call => {
        const result = answer(call);
        if (call.command === 'history.window' && result.ok) {
          const args=call.args;
          if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Fixture requires an object window request');
          const path=db.history.lead??[];
          const value=typedSelectedCoverageWindow('lead',revision,path.length,path,{
            node_id:'node_id' in args&&typeof args.node_id==='string'?args.node_id:undefined,
            ordinal:'ordinal' in args&&typeof args.ordinal==='number'?args.ordinal:undefined,
            before:'before' in args&&typeof args.before==='number'?args.before:undefined,
            after:'after' in args&&typeof args.after==='number'?args.after:undefined,
          });
          trace.push({kind:'owner-reply',args:call.args,revision,total:value.total,nodes:value.items.map(row=>row.node_id)});
          return {...result,result:value};
        }
        return result;
      };
    },
  });
  try {
    await settle(r.t, r.db);
    const reader = r.model.longReader.value!;
    const handle = r.model.handle.value!;
    const initial = reader.acceptedView.peek(),originalRows=JSON.stringify(reader.acceptedView.peek().rows),cap=reader.acceptedView.currentCapability;
    const initialCall = r.t.calls('history.window')[0]!;
    expect(initialCall.args).toMatchObject({ before: 99, after: 0, items: true });
    expect(initial.total).toBe(95);
    expect(initial.rows.some(row => row.node_id === 'n94')).toBe(true);
    const target = handle.readWindow({ ordinal: 94, before: 0, after: 0, expect_node_id: 'n94', items: true }, new Cancel());
    reader.changed();
    await Promise.resolve();
    const pending = () => r.t.calls('history.window').filter(call => !r.db.answered.has(call.id));
    const targetCall = pending().find(call => (call.args as { ordinal?: number; after?: number }).ordinal === 94 && (call.args as { after?: number }).after === 0)!;
    const fullCall = pending().find(call => (call.args as { ordinal?: number; after?: number }).ordinal === 94 && (call.args as { after?: number }).after === 199)!;
    expect(targetCall).toBeDefined();
    expect(fullCall).toBeDefined();
    const fullRevision = changedRevision ? 5 : revision;
    const fullRows = changedRevision ? [...rows, { ...rows[94], node_id: 'n95', selection: { ...rows[94]!.selection, ordinal: 95 } }] : rows;
    const targetValue = { thread_id: 'lead', revision, total: 95, items: [rows[94]] };
    expect(fullCall.args).toMatchObject({ordinal:94,before:0,after:199,expect_node_id:'n94',items:true});
    const fullValue=typedSelectedCoverageWindow('lead',fullRevision,fullRows.length,fullRows,{ordinal:94,before:0,after:199});
    const answerCall = (call: typeof targetCall, value: typeof fullValue|typeof targetValue) => {
      trace.push({kind:'declared-reply',args:call.args,revision:value.revision,total:value.total,nodes:value.items.map(row=>row?.node_id)});
      r.db.answered.add(call.id); r.t.ok(call.id, value);
    };
    stop=reader.acceptedView.subscribe(snapshot=>{
      expect(reader.acceptedView.isCurrent(snapshot)).toBe(true);expect(snapshot.displayPlan?.capability).toBe(cap);
      const declared=snapshot.revision===4?rows:fullRows;
      expect([4,fullRevision]).toContain(snapshot.revision);expect(snapshot.rows.map(row=>row.node_id)).toEqual(declared.map(row=>row.node_id));
      expect(snapshot.rows.map(row=>row.items?.map(item=>item.kind==='text'?item.text:undefined))).toEqual(declared.map(row=>row.items?.map(item=>item.kind==='text'?item.text:undefined)));
      expect(snapshot.total).toBe(declared.length);
      trace.push({kind:'publication',revision:snapshot.revision,total:snapshot.total,generation:snapshot.generation,nodes:snapshot.rows.map(row=>row.node_id)});
    });
    const sendTarget = () => answerCall(targetCall, targetValue);
    const sendFull = () => {revision=fullRevision;r.db.history.lead=fullRows;answerCall(fullCall, fullValue);};
    if (targetFirst) sendTarget();
    if (trigger) {
      r.t.push({ t: 'live', thread_id: 'lead', attempt_id: 'matrix-handoff', gap: false, deltas: [{ offset: 0, reasoning: false, text: 'preview' }] });
      r.t.push({ t: 'live_end', thread_id: 'lead' });
      await Promise.resolve();
      for (const call of r.t.calls().filter(call => !r.db.answered.has(call.id) && call.command !== 'history.window')) {
        r.db.answered.add(call.id);
        const result = r.db.answer(call);
        if (result.ok) r.t.ok(call.id, result.result);
        else r.t.ownerError(call.id, result.code, result.message ?? result.code, result.details);
      }
    }
    if (!targetFirst) sendFull();
    if (targetFirst) sendFull();
    if (!targetFirst) sendTarget();
    const targetResult = await target;
    expect(targetResult.ok).toBe(true);
    if (targetResult.ok) {
      expect(targetResult.value.items).toHaveLength(1);
      expect(targetResult.value.items[0]?.node_id).toBe('n94');
    }
    expect(r.t.calls('history.get')).toHaveLength(0);
    await settle(r.t,r.db);
    const accepted = reader.acceptedView.peek();
    expect(accepted.rows.some(row => row.node_id === 'n94')).toBe(true);
    expect(reader.itemAt(94)?.node_id).toBe('n94');
    const targetItem = accepted.rows.find(row => row.node_id === 'n94')?.items?.[0];
    expect(targetItem?.kind === 'text' ? targetItem.text : undefined).toBe('qualified-final-body');
    expect(accepted.total).toBe(fullRows.length);
    expect(JSON.stringify(initial.rows)).toBe(originalRows);
    if(changedRevision){expect(reader.acceptedView.isCurrent(initial)).toBe(false);expect(r.t.calls('history.window').some(call=>typeof call.args==='object'&&call.args!==null&&'before' in call.args&&call.args.before===99&&!('ordinal' in call.args)&&!('node_id' in call.args)&&call.id!==initialCall.id)).toBe(true);}
  } finally {
    console.log('CONTINUITY_CURRENT_CUT_TRACE',JSON.stringify({targetFirst,changedRevision,trace}));stop();
    r.model.dispose();
    r.data.stop();
  }
});
