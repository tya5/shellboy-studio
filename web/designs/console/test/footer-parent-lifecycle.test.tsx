import { readFileSync } from 'node:fs';
// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { loadPrefs } from '../../../ui-core/src/prefs';
import type { DesignContext } from '../../../ui-core/src';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect,it } from 'vitest';
import { App } from '../screens/App';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { settle, summary, details, flush } from '../../../data/test/harness';
it('retains the production footer across disconnect, loading, and reconnect parent changes',async()=>{
 const f=await fixtureModel({capabilities:['history.window']}),host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const footer=host.querySelector('.conversation-status')!;expect(footer).not.toBeNull();
  for(const state of ['not_started','running','completed','not_started'] as const){
   await act(async()=>{
    f.db.threads.lead=summary('lead',{state,activity:state==='running'?'tools':state});
    f.db.details.lead=details('lead',{state,activity:state==='running'?'tools':state});
    f.t.push({t:'changed',thread_ids:['lead'],list:true});await settle(f.t,f.db);
   });
   expect(f.model.selectedRow.peek()?.summary.state).toBe(state);
   expect(host.querySelector('.conversation-status')).toBe(footer);
  }
  const removed:Node[]=[];const observer=new MutationObserver(records=>{for(const record of records)removed.push(...record.removedNodes);});observer.observe(host,{childList:true,subtree:true});
  await act(async()=>{f.t.drop();await settle(f.t,f.db);});
  expect(host.querySelector('.conversation-status')).toBe(footer);expect(footer.isConnected).toBe(true);
  await act(async()=>{f.t.open();await flush(2);expect(host.querySelector('.conversation-status')).toBe(footer);await settle(f.t,f.db);});
  expect(host.querySelector('.conversation-status')).toBe(footer);expect(host.querySelectorAll('.conversation-status')).toHaveLength(1);
  observer.disconnect();expect(removed.some(node=>node===footer||node.contains(footer))).toBe(false);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it('uses the existing conversation gutter tokens without changing footer height',()=>{
 const css=readFileSync(new URL('../system/layout.css',import.meta.url),'utf8');
 expect(css).toContain('.convo > .conversation-status{padding-inline:var(--space-24)}');
 expect(css).toContain('@media(max-width:768px){.convo > .conversation-status{padding-inline:var(--space-12)}}');
 expect(css).toContain('height:calc(var(--space-32) + var(--space-8))');
});
