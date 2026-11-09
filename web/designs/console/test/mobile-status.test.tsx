// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';
import { fixtureModel, settle } from '../../../ui-core/test/fixture';
import { translator } from '../../../ui-core/src/i18n';
import type { Prefs } from '../../../ui-core/src';
import { DESIGNS } from '../../registry';
import { App } from '../screens/App';

describe('mobile activity presentation without losing work information',()=>{
  it.each([0,1,2])('uses correct English tool number %s',n=>{
    expect(translator('en')('tools.count',{n})).toBe(`${n} ${n===1?'tool':'tools'}`);
    expect(translator('ja')('tools.count',{n})).toBe(`ツール ${n}件`);
  });
  it('keeps activity, tool and time distinct and has only one running-count summary',async()=>{
    const r=await fixtureModel({configure(db){
      db.threads.lead={...db.threads.lead!,state:'running',activity:'tools'};
      db.work.lead=[{kind:'attempt',id:'synthetic-running',attempt_id:'synthetic-running',thread_id:'lead',turn_id:'turn',state:'running',started_at:'2025-01-02T12:00:00Z',label:'Synthetic long tool command'}];
    }});
    const host=document.createElement('div');document.body.append(host);
    try{
      const prefs=signal<Prefs>({design:'console',theme:'console',lang:'en',weights:{cached:.1,output:5}});
      await act(async()=>{render(<App context={{model:r.model,prefs,designs:DESIGNS,setPrefs(){},submitToken:async()=>true}}/>,host);await settle(r.t,r.db);});
      expect(host.querySelector('.conversation-status-activity')?.textContent).toBe('Running tools');
      expect(host.querySelector('.conversation-status-tool')?.textContent).toContain('Synthetic long tool command');
      expect(host.querySelector('.conversation-status-elapsed')).not.toBeNull();
      const count='Running at least 1';
      expect(host.querySelector('.conversation-status')?.textContent).toContain(count);
      expect(host.querySelector('.work-strip')?.textContent).not.toContain(count);
      const button=host.querySelector<HTMLButtonElement>('.work-strip button');expect(button).not.toBeNull();button!.click();
      await act(async()=>{await Promise.resolve();});
      expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Synthetic long tool command');
    }finally{render(null,host);host.remove();r.model.dispose();}
  });
});
