// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureModel, settle } from '../../../ui-core/test/fixture';
import type { Prefs } from '../../../ui-core/src';
import { DESIGNS } from '../../registry';
import { App } from '../screens/App';
let host:HTMLElement|undefined,cleanup:(()=>void)|undefined;
afterEach(()=>{if(host)render(null,host);host?.remove();host=undefined;cleanup?.();cleanup=undefined;});
async function rig(unavailable = false){
  const r=await fixtureModel({configure(db){
    const node=(id:string,sender:unknown)=>({node_id:id,kind:'user',excerpt:`body-${id}`,provenance:{sender:sender as {kind:string}}});
    db.history.lead=[node('one',{kind:'model',thread_id:'sender-one',label:'<img src=x onerror=alert(1)>'}),node('two',{kind:'model',thread_id:'sender-two'}),node('unknown',{kind:'model',thread_id:null,label:'Claimed'}),node('human',{kind:'human'}),node('cli',{kind:'external_cli'})];
    if (unavailable) db.history.lead = [{ ...node('deferred', { kind: 'model', thread_id: 'sender-one' }), items: null, items_unavailable_reason: 'response_budget', provenance: { sender: { kind: 'model', thread_id: 'sender-one' }, message: { expect_reply: false, reply_to: 'original-request' } } }];
    for(const id of ['sender-one','sender-two'])db.threads[id]={...db.threads.lead!,thread_id:id,title:'<Same current title>'};
  }});
  host=document.createElement('div');document.body.append(host);cleanup=()=>r.model.dispose();
  const prefs=signal<Prefs>({design:'console',theme:'console',lang:'en',weights:{cached:.1,output:5}});
  await act(async()=>{render(<App context={{model:r.model,prefs,designs:DESIGNS,setPrefs(){},submitToken:async()=>true}}/>,host!);await settle(r.t,r.db);});
  return {...r,host:host!};
}
describe('sender facts in the existing conversation',()=>{
  it('keeps full ID distinct under same-title senders and escapes self-asserted labels/title',async()=>{
    const r=await rig();const boxes=r.host.querySelectorAll('.sender-fact');expect(boxes).toHaveLength(2);
    const messages=[...r.host.querySelectorAll('.msg')];
    const one=messages.find(row=>row.textContent?.includes('body-one'))!;
    const two=messages.find(row=>row.textContent?.includes('body-two'))!;
    const first=one.querySelector('.message-sender a')!,second=two.querySelector('.message-sender a')!;
    expect(first.textContent).toBe('<Same current title>');expect(second.textContent).toBe('<Same current title>');
    expect(first.getAttribute('href')).toContain('sender-one');expect(second.getAttribute('href')).toContain('sender-two');
    expect(first.getAttribute('href')).not.toBe(second.getAttribute('href'));
    expect(first.getAttribute('title')).toBe('sender-one');expect(second.getAttribute('title')).toBe('sender-two');
    expect(first.getAttribute('aria-label')).toContain('sender-one');expect(second.getAttribute('aria-label')).toContain('sender-two');
    expect(boxes[0]!.textContent).toContain('Self-asserted label: <img src=x onerror=alert(1)>');
    expect(boxes[1]!.textContent).not.toContain('Self-asserted label:');
    expect(one.querySelector('.message-sender img, .sender-fact img')).toBeNull();
    expect(two.querySelector('.message-sender img, .sender-fact img')).toBeNull();
    expect(boxes[0]!.textContent).not.toContain('<Same current title>');
  });
  it('keeps the recorded sender when the message items are unavailable', async () => {
    const r = await rig(true);
    const message = r.host.querySelector('[data-items-unavailable-reason] .msg')!;
    expect(message).not.toBeNull();
    expect(message.querySelector('.message-sender a')?.getAttribute('href') ?? '').toContain('sender-one');
    expect(message.querySelector('.message-sender')?.textContent).not.toBe('You');
    expect(message.querySelector('[data-message-relation="reply"]')?.textContent).toContain('original-request');
  });
  it('shows the saved model sender of a named in-Turn human Ask (Core #434, Studio #163)', async () => {
    // The node shape the pinned Core returns from history.window for a named Ask (real-owner witness).
    const r = await fixtureModel({ configure(db) {
      db.history.lead = [{ node_id: 'ask', kind: 'assistant', excerpt: 'Should the release preview open on Overview or Timeline?', execution_count: 0, execution_count_exact: true, executions_truncated: false,
        items: [{ item_identity: '["ask","/content/0"]', kind: 'text', text: 'Should the release preview open on Overview or Timeline?', text_complete: true }],
        provenance: { kind: 'assistant', created_at: '2026-11-26T00:15:42Z', source_revision: 0,
          sender: { kind: 'model', label: 'Release assistant', thread_id: 'asker', instance_id: 'fixture', run_id: 'run', turn_id: 'turn', execution_id: 'shell' } } }];
      db.threads.asker = { ...db.threads.lead!, thread_id: 'asker', title: 'Release thread' };
    } });
    host = document.createElement('div'); document.body.append(host); cleanup = () => r.model.dispose();
    const prefs = signal<Prefs>({ design: 'console', theme: 'console', lang: 'en', weights: { cached: .1, output: 5 } });
    await act(async () => { render(<App context={{ model: r.model, prefs, designs: DESIGNS, setPrefs() {}, submitToken: async () => true }} />, host!); await settle(r.t, r.db); });
    const message = [...host.querySelectorAll('.msg')].find(row => row.textContent?.includes('Overview or Timeline'))!;
    expect(message).toBeDefined();
    expect(message.textContent).not.toContain('Unknown sender');
    expect(message.querySelector('.message-sender a')?.getAttribute('href') ?? '').toContain('asker');
    expect(message.querySelector('.sender-fact')?.textContent).toContain('Self-asserted label: Release assistant');
  });
  it('does not call malformed model identity You or invent a sender ID for CLI/human',async()=>{
    const r=await rig();const messages=[...r.host.querySelectorAll('.msg')];const unknown=messages.find(e=>e.textContent?.includes('body-unknown'))!;
    expect(unknown.textContent).toContain('Model sender (identity unavailable)');expect(unknown.querySelector('.message-sender')!.textContent).not.toBe('You');
    for(const id of ['human','cli'])expect(messages.find(e=>e.textContent?.includes(`body-${id}`))!.querySelector('.sender-fact')).toBeNull();
  });
});
