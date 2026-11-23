// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect, it } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { settle } from '../../../data/test/harness';
import { decodeThreadReplies } from '../../../data/src/replies';
import { App } from '../screens/App';
import { DESIGNS } from '../../registry';
import type { Prefs } from '../../../ui-core/src';

it('protocol 5 unifies human/thread duties while preserving shells and organizational parents', async () => {
  const r = await fixtureModel({ configure(db) {
    Object.assign(db.details.lead!, { parent_id:'organization', shells_count:1, awaiting_replies:[
      { message_id:'human', recipient_kind:'human', recipient_thread_id:'lead', excerpt:'P5_HUMAN', delivery_status:'accepted' },
      { message_id:'peer', recipient_kind:'thread', recipient_thread_id:'child', excerpt:'P5_THREAD', delivery_status:'applied' },
    ], awaiting_human:[{message_id:'removed', excerpt:'DO_NOT_MERGE'}] });
  } });
  const host = document.createElement('div'); document.body.append(host);
  const prefs = signal<Prefs>({design:'console',theme:'console',lang:'en',weights:{cached:.1,output:5}});
  try {
    await act(async () => { render(<App context={{model:r.model,prefs,designs:DESIGNS,setPrefs(){},submitToken:async()=>true}} />,host); });
    expect(r.data.owner.value).toMatchObject({state:'connected',info:{protocol_version:5}});
    expect(host.textContent).toContain('P5_HUMAN'); expect(host.textContent).toContain('P5_THREAD');
    expect(host.textContent).not.toContain('DO_NOT_MERGE');
    expect(r.model.t.value('org.previewNote')).not.toContain('keeps its owner');
    r.model.lang.value='ja';
    expect(r.model.t.value('org.previewNote')).not.toContain('所有者');
    r.model.lang.value='en';
    await act(async()=>host.querySelector<HTMLButtonElement>('#panel-page-awaiting-reply [data-panel-row-id=peer] button')!.click());
    expect(host.querySelector('a[href="#/thread/child"]') ?? [...host.querySelectorAll('a')].find(a=>a.href.includes('child'))).toBeTruthy();
    expect(r.model.threadReplies.value.filter(x=>x.recipient.kind==='human')).toHaveLength(1);
    expect(r.model.handle.value!.detail.value.value!.shells_count).toBe(1);
    expect(r.model.handle.value!.detail.value.value!.parent_id).toBe('organization');
    await r.model.runPanelOperation('peer',{kind:'answer',text:'not a human answer'});
    expect(r.t.calls('message.reply')).toHaveLength(0);
    const answer = r.model.runPanelOperation('human',{kind:'answer',text:'confirmed'});
    await act(async () => { await settle(r.t,r.db); await answer; });
    expect(r.t.calls('message.reply').at(-1)!.args).toEqual({message_id:'human',text:'confirmed'});
    Object.assign(r.db.details.lead!,{awaiting_replies:[]});
    await act(async()=>{r.t.push({t:'changed', config_changed: false,thread_ids:['lead'],list:false});await settle(r.t,r.db);});
    expect(r.model.threadReplies.value).toEqual([]);
    expect(host.textContent).not.toContain('P5_HUMAN');
    expect(r.t.calls('thread.get').every(call=>!JSON.stringify(call.args).includes('owner_run'))).toBe(true);
  } finally { render(null,host);host.remove();r.model.dispose();r.data.stop(); }
});

it('does not infer recipient from sender, accept unknown recipients, or exceed the pinned reply bound',()=>{
  const item={message_id:'x',excerpt:'q',delivery_status:'pending',recipient_kind:'thread',recipient_thread_id:'other'};
  expect(decodeThreadReplies('t',[item])!.items[0]!.recipient).toEqual({kind:'thread',threadId:'other',title:'other'});
  expect(decodeThreadReplies('t',[{...item,recipient_kind:'unknown'}])).toEqual({items:[],complete:false});
  expect(decodeThreadReplies('t',Array.from({length:18},()=>item))).toBeUndefined();
});
