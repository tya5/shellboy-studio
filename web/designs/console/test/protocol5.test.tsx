// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect, it } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { settle } from '../../../data/test/harness';
import { App } from '../screens/App';
import { DESIGNS } from '../../registry';
import type { Prefs } from '../../../ui-core/src';

it('directional pages preserve human and Thread duties while preserving shells and organizational parents', async () => {
  const r = await fixtureModel({ configure(db) {
    Object.assign(db.details.lead!, { parent_thread_id:'organization', shells_count:1,
      pending_replies:{owed_by:{count:1,exact:true},asked_by:{count:1,exact:true}} });
    db.replies = [
      { message_id:'human', asked_by:'lead', sender:{kind:'model',thread_id:'lead'}, recipient:{kind:'name',name:'human'}, excerpt:'P5_HUMAN',created_at:'2026-01-01T00:00:00Z' },
      { message_id:'peer', asked_by:'child', sender:{kind:'model',thread_id:'child'}, recipient:{kind:'thread',thread_id:'lead'}, excerpt:'P5_THREAD',created_at:'2026-01-01T00:00:00Z' },
    ];
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
    expect(r.model.replyPages.owed_by.value.items[0]?.sender).toEqual({kind:'model', thread_id:'child'});
    expect(r.model.replyPages.asked_by.value.items).toHaveLength(1);
    expect(r.model.handle.value!.detail.value.value!.shells_count).toBe(1);
    expect(r.model.handle.value!.detail.value.value!.parent_thread_id).toBe('organization');
    await r.model.runPanelOperation('peer',{kind:'answer',text:'not a human answer'});
    expect(r.t.calls('message.reply')).toHaveLength(0);
    const answer = r.model.runPanelOperation('human',{kind:'answer',text:'confirmed'});
    await act(async () => { await settle(r.t,r.db); await answer; });
    expect(r.t.calls('message.reply').at(-1)!.args).toEqual({message_id:'human',text:'confirmed'});
    r.db.replies = [];
    await act(async()=>{r.t.push({t:'changed',config_changed:false,thread_ids:['lead'],list:false});await settle(r.t,r.db);});
    expect(r.model.replyPages.asked_by.value.items).toEqual([]);
    expect(host.textContent).not.toContain('P5_HUMAN');
    expect(r.t.calls('thread.get').every(call=>!JSON.stringify(call.args).includes('owner_run'))).toBe(true);
  } finally { render(null,host);host.remove();r.model.dispose();r.data.stop(); }
});
