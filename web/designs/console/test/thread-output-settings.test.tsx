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
it.each([true,false])('actual dialog shows own and owner-effective output limit, capability=%s',async capable=>{
 const r=await fixtureModel({capabilities:capable?['thread.settings']:[],configure(db){db.details.lead!.max_tokens=null;db.details.lead!.effective_max_tokens=8192;}});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:r.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);r.model.openModelPicker();await settle(r.t,r.db);});
  const dialog=host.querySelector('[role="dialog"]')!;expect(dialog).not.toBeNull();
  const input=dialog.querySelector<HTMLInputElement>('[aria-label="Maximum output tokens (Thread override)"]')!;
  expect(input).not.toBeNull();expect(input.value).toBe('');expect(input.placeholder).toContain('8192');expect(input.disabled).toBe(!capable);
  expect(dialog.textContent).not.toContain('Summary segment');expect(dialog.textContent).not.toContain('reduction rounds');
  expect(r.t.calls('thread.set')).toHaveLength(0);
  await act(async()=>{input.value='4096';input.dispatchEvent(new Event('input',{bubbles:true}));const save=r.model.saveThreadModel();await settle(r.t,r.db);await save;});
  if(!capable)expect(r.t.calls('thread.set')).toHaveLength(0);
  else expect(r.t.calls('thread.set')[0]!.args).toMatchObject({max_tokens:'4096'});
 }finally{render(null,host);host.remove();r.model.dispose();r.data.stop();}
});
