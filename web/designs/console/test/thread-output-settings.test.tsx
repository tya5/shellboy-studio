// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { expect,it } from 'vitest';
import { fixtureModel, settle } from '../../../ui-core/test/fixture';
import { loadPrefs } from '../../../ui-core/src/prefs';
import type { DesignContext } from '../../../ui-core/src';
import { App } from '../screens/App';
it.each([true,false])('shows inherited output in Thread Settings with capability=%s',async capable=>{
 const r=await fixtureModel({capabilities:capable?['thread.settings']:[],configure(db){db.details.lead!.max_tokens=null;db.details.lead!.effective_max_tokens=8192;}});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:r.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);r.model.setPanelTab('settings');await settle(r.t,r.db);});
  const row=host.querySelector('[data-setting-id="thread.max_tokens"]')!;
  expect(row.textContent).toContain('8192Default');
  expect(row.querySelector('button')?.disabled).toBe(!capable);
  if(capable){
   act(()=>row.querySelector('button')!.click());
   const input=row.querySelector('input')!;
   expect(input.value).toBe('8192');
   act(()=>{input.value='4096';input.dispatchEvent(new Event('input',{bubbles:true}));});
   await act(async()=>{[...row.querySelectorAll('button')].find(b=>b.textContent==='Save')!.click();await settle(r.t,r.db);});
  }
  expect(r.t.calls('thread.set').map(call=>call.args)).toEqual(capable?[{thread_id:'lead',max_tokens:'4096'}]:[]);
 }finally{render(null,host);host.remove();r.model.dispose();r.data.stop();}
});
