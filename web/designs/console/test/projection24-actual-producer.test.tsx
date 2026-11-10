// @vitest-environment happy-dom
import '@preact/signals';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {signal} from '@preact/signals-core';
import {Link} from '../../../data/src/link';
import {Operations} from '../../../data/src/operations';
import {FakeTransport,flush,summary,details,settle} from '../../../data/test/harness';
import {fixtureModel} from '../../../ui-core/test/fixture';
import {rig} from '../../../ui-core/test/window-owner';
import {projectHistoryWindowItems} from '../../../ui-core/src/conversation-items';
import {App} from '../screens/App';
import type {DesignContext} from '../../../ui-core/src';
const directory=resolve('../../..','.local/leader/artifacts/core296/actual-bdc852');
const manifestBytes=readFileSync(resolve(directory,'manifest.json'));
expect(createHash('sha256').update(manifestBytes).digest('hex')).toBe('4078c1d12d06b84ac462c2fab61957e7a7ff02c94ebcf123d8e7444d0efa11e4');
const manifest=JSON.parse(manifestBytes.toString());
function actual(name:string){const bytes=readFileSync(resolve(directory,name));expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.files[name].sha256);return JSON.parse(bytes.toString());}
const names=['actual-window.json','legacy-window.json','unavailable-window.json','response-budget-window.json','rewindow-window.json','public-route-window.json'];
for(const name of names)it(`actual producer bytes -> real strict decoder -> P: ${name}`,async()=>{
 const value=actual(name),t=new FakeTransport(),link=new Link(t);link.start();t.open();
 try{const ops=new Operations(link,()=> 'actual-fixture');const promise=ops.historyWindow({thread_id:'t',items:true});t.ok(t.calls('history.window')[0]!.id,value);const result=await promise;expect(result.ok).toBe(true);
 if(result.ok){expect(result.value).toEqual(value);const p=projectHistoryWindowItems({revision:result.value.revision,nodes:result.value.items});expect(p.nodes).toHaveLength(value.items.length);if(name==='response-budget-window.json'){expect(p.nodes.filter(n=>n.state==='deferred')).toHaveLength(4);expect(p.retryFrom).toEqual({ordinal:128,expect_node_id:'n128'});}if(name==='rewindow-window.json')expect(p.nodes.every(n=>n.state==='items')).toBe(true);}}
 finally{link.stop();}
});
it('actual encoded typed window -> strict decoder/store/model Window -> real App/Console without registry',async()=>{
 const encoded=actual('actual-window.json');
 const f=await fixtureModel({capabilities:['history.window'],configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];const fallback=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:encoded}:fallback(call);}});
 const host=document.createElement('div');document.body.append(host);
 try{
  const context={model:f.model,prefs:signal({}),setPrefs:()=>{}} as unknown as DesignContext;
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  expect(f.model.selectedId.value).toBe('t');const win=f.model.longReader.value;expect(win).toBeDefined();
  const snapshot=win!.acceptedView.peek();expect(snapshot.rows).toEqual(encoded.items);expect(snapshot.revision).toBe(4);expect(snapshot.total).toBe(4);
  expect(f.t.calls('history.window').every(c=>(c.args as {items?:boolean}).items===true)).toBe(true);
  const elements=[...host.querySelectorAll('[data-item-key]')];expect(elements.map(e=>e.getAttribute('data-node'))).toEqual(['n0','n1','n1','n2','n2','n3']);
  expect(host.textContent).toContain('synthetic input');expect(elements[1]!.textContent).toContain('A');
  expect(elements.every(e=>e.parentElement?.className==='conversation-items')).toBe(true);
  const original=elements[0];await act(async()=>win!.layoutChanged());expect(host.querySelector('[data-item-key]')).toBe(original);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('actual whole-node response budget retains ordinary nodes and retries exact ordinal/node to actual rewindow',async()=>{
 const budget=actual('response-budget-window.json'),rewindow=actual('rewindow-window.json');const r=await rig(132);let phase='budget';
 const fallback=r.owner.answer.bind(r.owner);r.owner.answer=call=>call.command==='history.window'?{ok:true,result:phase==='budget'?budget:rewindow}:fallback(call);
 try{
  await r.settle();const before=r.w.acceptedView.peek();expect(before.rows).toHaveLength(132);expect(before.rows.filter(n=>n.items===null)).toHaveLength(4);
  const first=projectHistoryWindowItems({revision:before.revision!,nodes:before.rows});expect(first.retryFrom).toEqual({ordinal:128,expect_node_id:'n128'});
  const savedText=first.projection.items.find(i=>i.source.kind==='text')!;const mark=r.calls().length;
  phase='rewindow';expect(r.w.retryDeferred(before)).toBe(true);expect(r.w.retryDeferred(before)).toBe(false);
  await r.settle();const calls=r.calls().slice(mark);expect(calls).toHaveLength(1);expect(calls[0]!.args).toMatchObject({ordinal:128,expect_node_id:'n128',items:true});
  const after=r.w.acceptedView.peek();expect(after.rows.filter(n=>n.items===null)).toHaveLength(0);expect(after.rows).toHaveLength(132);
  const mapped=projectHistoryWindowItems({revision:after.revision!,nodes:after.rows});expect(mapped.retryFrom).toBeUndefined();expect(mapped.projection.items.find(i=>i.key===savedText.key)).toEqual(savedText);
  expect(mapped.nodes.slice(-4).every(n=>n.state==='items')).toBe(true);expect(r.w.retryDeferred(before)).toBe(false);
 }finally{r.w.dispose();r.data.stop();}
});
it('actual stale held producer reply cannot publish after Window disposal',async()=>{
 const r=await rig(4);const encoded=actual('actual-window.json');
 try{await flush();const held=r.calls().find(c=>!r.owner.answered.has(c.id))!;expect(held).toBeDefined();r.w.dispose();const snapshot=r.w.acceptedView.peek();r.t.ok(held.id,encoded);await flush(48);expect(r.w.acceptedView.peek()).toBe(snapshot);expect(r.w.acceptedView.isCurrent(snapshot)).toBe(false);}
 finally{r.w.dispose();r.data.stop();}
});
