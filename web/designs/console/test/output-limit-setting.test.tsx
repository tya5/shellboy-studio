// @vitest-environment happy-dom
import "@preact/signals";
import { afterEach, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { signal } from '@preact/signals-core';
import { fixtureModel, settle } from '../../../ui-core/test/fixture';
import { mount } from '..';
import { App } from '../screens/App';
import { loadPrefs } from '../../../ui-core/src/prefs';
import type { DesignContext } from '../../../ui-core/src';
import { DESIGNS } from '../../registry';
import type { Prefs } from '../../../ui-core/src';

let dispose: (() => void) | undefined;
afterEach(()=>{dispose?.();document.body.replaceChildren();});

it.each(['responses','chat_completions','anthropic_messages'])('shows unset and configured existing maximum output tokens for %s',async api=>{
 const values={connections:{blank:{api,base_url:'https://example.invalid/v1'},configured:{api,max_tokens:4096,base_url:'https://example.invalid/v1'}}};
 const m=await fixtureModel({route:'settings',section:'connections',capabilities:['config.edit'],configure(db){const before=db.answer.bind(db);db.answer=c=>c.command==='config.get'?{ok:true,result:{loaded:{values},file:{present:true,valid:true,content_hash:'synthetic',values},differs:false}}:before(c);}});
 const root=document.createElement('div');document.body.append(root);const prefs=signal<Prefs>({design:'console',theme:'console',lang:'en',monitorView:'cards',weights:{cached:0.1,output:5}});
 // Mount the same presentation as the application, with a controlled transport only.
 const unmount=mount(root,{model:m.model,designs:DESIGNS,prefs,setPrefs:()=>{},submitToken:async()=>true});dispose=()=>{unmount();m.model.dispose();};
 await act(async()=>settle(m.t,m.db));
 const inputs=[...root.querySelectorAll<HTMLInputElement>('input[aria-label="Maximum output tokens"]')];
 expect(inputs).toHaveLength(2);expect(inputs.map(x=>x.value)).toEqual(['','4096']);
 expect(root.textContent).toContain('Anthropic Messages');
 expect(m.t.calls('config.set')).toHaveLength(0);expect(m.t.calls('connection.test')).toHaveLength(0);
});

it('focuses a pending connection setting request after SettingsView mounts its target',async()=>{
 const values={connections:{proxy:{api:'responses',base_url:'https://example.invalid/v1',max_tokens:4096}}};
 const m=await fixtureModel({route:'settings',section:'general',capabilities:['config.edit'],configure(db){const before=db.answer.bind(db);db.answer=c=>c.command==='config.get'?{ok:true,result:{loaded:{values},file:{present:true,valid:true,content_hash:'synthetic',values}}}:before(c);}});
 const root=document.createElement('div');document.body.append(root);const prefs=signal<Prefs>({design:'console',theme:'console',lang:'en',monitorView:'cards',weights:{cached:0.1,output:5}});
 const unmount=mount(root,{model:m.model,designs:DESIGNS,prefs,setPrefs:()=>{},submitToken:async()=>true});dispose=()=>{unmount();m.model.dispose();};
 await act(async()=>settle(m.t,m.db));
 await act(async()=>m.model.navigateToSettingFocus({view:'settings',section:'connections'},'connections.proxy.max_tokens'));
 const target=root.querySelector<HTMLInputElement>('[aria-label="Maximum output tokens"]');
 expect(target).not.toBeNull();expect(document.activeElement).toBe(target);expect(m.model.pendingSettingFocus.value).toBeUndefined();
});

it.each(['responses','chat_completions','anthropic_messages'])('saves only max_tokens and reopens configured then unset for %s',async api=>{
 let value:number|undefined;
 const extra={provider_flag:true};
 const values=()=>({connections:{proxy:{api,base_url:'https://example.invalid/v1',extra_body:extra,...(value===undefined?{}:{max_tokens:value})}}});
 const m=await fixtureModel({route:'settings',section:'connections',capabilities:['config.edit'],configure(db){const before=db.answer.bind(db);db.answer=c=>{
  if(c.command==='config.get')return {ok:true,result:{loaded:{values:values()},file:{present:true,valid:true,content_hash:String(value),values:values()},differs:false}};
  if(c.command==='config.set'){const changes=(c.args as {changes:{field:string,value?:number}[]}).changes;expect(changes).toHaveLength(1);expect(changes[0]!.field).toBe('connections.proxy.max_tokens');value=changes[0]!.value;return {ok:true,result:{written:true,content_hash:String(value),restart_required:true,changes:[]}};}
  return before(c);
 }} });
 dispose=()=>m.model.dispose();await settle(m.t,m.db);
 const c=m.model.config;
 void c.saveField(['connections','proxy','max_tokens'],'4096','int');await settle(m.t,m.db);
 void c.configChanged();await settle(m.t,m.db);
 expect(m.t.calls('config.set')).toHaveLength(1);expect(c.read.value.value?.file.values).toEqual(values());
 m.model.navigate({view:'monitor'});m.model.navigate({view:'settings',section:'connections'});await settle(m.t,m.db);
 expect((c.read.value.value?.file.values?.connections as ReturnType<typeof values>['connections']).proxy.max_tokens).toBe(4096);
 void c.saveField(['connections','proxy','max_tokens'],'','int');await settle(m.t,m.db);
 void c.configChanged();await settle(m.t,m.db);
 expect(m.t.calls('config.set')).toHaveLength(2);expect(value).toBeUndefined();expect(values().connections.proxy.extra_body).toEqual(extra);
 expect(m.t.calls('connection.test')).toHaveLength(0);
});

it('retains owner validation and refuses malformed integers without automatic writes',async()=>{
 const m=await fixtureModel({route:'settings',section:'connections',capabilities:['config.edit'],configure(db){const before=db.answer.bind(db);db.answer=c=>{
  if(c.command==='config.get')return {ok:true,result:{loaded:{values:{connections:{proxy:{api:'responses',max_tokens:16}}}},file:{present:true,valid:true,content_hash:'synthetic',values:{connections:{proxy:{api:'responses',max_tokens:16}}}}}};
  if(c.command==='config.set')return {ok:false,code:'invalid_request',message:'Owner rejected maximum output tokens'};
  return before(c);
 }} });dispose=()=>m.model.dispose();await settle(m.t,m.db);
 const c=m.model.config;await c.saveField(['connections','proxy','max_tokens'],'1.5','int');expect(m.t.calls('config.set')).toHaveLength(0);
 void c.saveField(['connections','proxy','max_tokens'],'32','int');await settle(m.t,m.db);
 expect(c.fieldError.value?.reason).toBe('Owner rejected maximum output tokens');expect(m.t.calls('config.set')).toHaveLength(1);
 expect(m.t.calls('message.reply')).toHaveLength(0);expect(m.t.calls('thread.send')).toHaveLength(0);
});


it('opens the real Thread Settings max_tokens row from the saved output-limit notice',async()=>{
 const r=await fixtureModel({route:'conversation',threadId:'lead',capabilities:['history.window','thread.settings'],configure(db){
  db.details.lead!.max_tokens=4096;
  db.history.lead=[{node_id:'saved-output-limit',kind:'assistant_response',selection:{ordinal:0},provenance:{attempt_id:'00000000-0000-4000-8000-000000000741',kind:'assistant_response',created_at:'2026-11-23T00:00:00Z',source_revision:1,output_limit:{stop:true,sent_max_tokens:4096,source:'thread_override',connection:'mock'}},items:[]}];
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:r.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:DESIGNS,submitToken:async()=>true};
 const unmount=mount(host,{model:r.model,designs:DESIGNS,prefs:context.prefs,setPrefs:()=>{},submitToken:async()=>true});
 dispose=()=>{unmount();r.model.dispose();r.data.stop();};
 await act(async()=>settle(r.t,r.db));
 const action=[...host.querySelectorAll('button')].find(button=>button.textContent==='Open output limit setting');
 expect(action).toBeDefined();
 await act(async()=>{action!.click();await settle(r.t,r.db);});
 const row=host.querySelector<HTMLElement>('[data-setting-id="thread.max_tokens"]');
 expect(r.model.panelTab.value).toBe('settings');
 expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Settings');
 expect(row?.dataset.highlighted).toBe('true');
 expect(row?.contains(document.activeElement)).toBe(true);
 expect(r.t.calls('thread.set')).toHaveLength(0);
});
