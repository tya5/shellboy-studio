// @vitest-environment happy-dom
import '@preact/signals';
import {actual} from './projection24-actual-input.mjs';
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
  const elements=[...host.querySelectorAll('[data-item-key]')];expect(elements.map(e=>e.getAttribute('data-node'))).toEqual(['n0','n1','n1','n2','n3']);
  expect(encoded.items[2].items[0].kind).toBe('reasoning_unavailable');
  expect(elements[3]!.querySelector('[data-thinking-marker]')).not.toBeNull();
  expect(elements[3]!.textContent).toBe('Reasoning content is not publicly available');
  expect(elements[3]!.textContent).not.toContain(f.model.t.value('work.thinking'));
  expect(elements[3]!.querySelector('.work-element-row__line')?.getAttribute('title')).toBe('Reasoning');
  expect(elements[3]!.querySelector('.md, .msg')).toBeNull();
  const projected=projectHistoryWindowItems({revision:snapshot.revision!,nodes:snapshot.rows}).projection;
  const n2Items=projected.items.filter(item=>item.source.nodeId==='n2');
  expect(n2Items).toHaveLength(2);
  const empty=n2Items.find(item=>item.source.kind==='text')!;
  expect(empty.source).toMatchObject({kind:'text',text:'',textComplete:true});
  expect(n2Items.find(item=>item.source.kind==='reasoning_unavailable')!.key).not.toBe(empty.key);
  expect(elements.some(element=>element.getAttribute('data-item-key')===empty.key)).toBe(false);
  expect(win!.acceptedView.isCurrent(snapshot)).toBe(true);
  expect(host.textContent).toContain('synthetic input');expect(elements[1]!.textContent).toContain('A');
  expect(elements.filter(e=>e.closest('[data-work-group]')).map(e=>e.getAttribute('data-node'))).toEqual(['n1','n2','n3']);
  expect(elements.filter(e=>!e.closest('[data-work-group]')).map(e=>e.getAttribute('data-node'))).toEqual(['n0','n1']);
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
it('actual budget -> real App deferred chrome -> actual retry keeps visible text DOM while restoring suffix',async()=>{
 const budget=actual('response-budget-window.json'),rewindow=actual('rewindow-window.json');let retry=false;
 const f=await fixtureModel({capabilities:['history.window'],configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];const fallback=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:retry?rewindow:budget}:fallback(call);}});
 const host=document.createElement('div');document.body.append(host);
 try{
  const context={model:f.model,prefs:signal({}),setPrefs:()=>{}} as unknown as DesignContext;
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const win=f.model.longReader.value!;expect(win).toBeDefined();const before=win.acceptedView.peek();
  expect(before.rows).toHaveLength(132);expect(host.querySelectorAll('[data-items-unavailable-reason="response_budget"]')).toHaveLength(4);
  const first=host.querySelector('[data-item-key]')!,text=first.textContent;expect(text!.length).toBeGreaterThan(0);
  retry=true;await act(async()=>{expect(win.retryDeferred(before)).toBe(true);expect(host.querySelector('[data-item-key]')).toBe(first);expect(first.textContent).toBe(text);await settle(f.t,f.db);});
  expect(win.acceptedView.peek().rows).toHaveLength(132);expect(host.querySelectorAll('[data-items-unavailable-reason="response_budget"]')).toHaveLength(0);
  expect(host.querySelector('[data-item-key]')).toBe(first);expect(first.textContent).toBe(text);
  expect(host.querySelectorAll('[data-item-key][data-node="n128"]').length).toBeGreaterThan(0);
  expect(f.t.calls('history.window').some(c=>(c.args as {ordinal?:number}).ordinal===128)).toBe(true);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('actual held old rewindow cannot overwrite newer accepted budget snapshot or its existing text',async()=>{
 const budget=actual('response-budget-window.json'),rewindow=actual('rewindow-window.json'),r=await rig(132);
 const fallback=r.owner.answer.bind(r.owner);r.owner.answer=call=>call.command==='history.window'?{ok:true,result:budget}:fallback(call);
 try{
  await r.settle();const before=r.w.acceptedView.peek();expect(r.w.retryDeferred(before)).toBe(true);await flush();
  const held=r.calls().find(c=>!r.owner.answered.has(c.id))!;expect(held).toBeDefined();r.owner.answered.add(held.id);
  r.w.jumpToEnd();await r.settle();const latest=r.w.acceptedView.peek();expect(latest).not.toBe(before);expect(latest.rows.filter(n=>n.items===null)).toHaveLength(4);
  const saved=projectHistoryWindowItems({revision:latest.revision!,nodes:latest.rows}).projection.items[0];
  r.t.ok(held.id,rewindow);await flush(48);
  expect(r.w.acceptedView.peek()).toBe(latest);expect(projectHistoryWindowItems({revision:latest.revision!,nodes:latest.rows}).projection.items[0]).toEqual(saved);
 }finally{r.w.dispose();r.data.stop();}
});

it('renders source header links and independent request facts through strict history and actual App',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const old=f.db.history.lead![0] as import('../../../data/src/protocol').HistoryItem;
  f.db.history.lead=[{...old,node_id:'sender-message',kind:'user',items:[{kind:'text',item_identity:'sender-body',text:'Received body stays',text_complete:true}],provenance:{sender:{kind:'model',thread_id:'full-source-identity',label:'Claimed <label>'},message:{expect_reply:true,reply_state:'pending'}}}];
  f.t.push({t:'changed',thread_ids:['lead'],list:false});await settle(f.t,f.db);
  await act(async()=>{render(<App context={{model:f.model,prefs:signal({}),setPrefs:()=>{}} as unknown as DesignContext}/>,host);await flush(12);await settle(f.t,f.db);});
  const node=host.querySelector('[data-node="sender-message"]')!;expect(node).not.toBeNull();
  const header=node.querySelector('.who a')!;
  expect(header.getAttribute('href')).toContain('full-source-identity');expect(header.getAttribute('title')).toBe('full-source-identity');
  expect(header.getAttribute('aria-label')).toContain('full-source-identity');expect(node.textContent).toContain('Received body stays');
  expect(node.textContent).toContain('Claimed <label>');expect(node.querySelector('[data-message-relation="request"]')).not.toBeNull();
  expect(node.querySelector('label')).toBeNull();
  f.db.threads['full-source-identity']={...summary('full-source-identity'),title:'<Renamed source>'};
  await act(async()=>{f.t.push({t:'changed',thread_ids:[],list:true});await settle(f.t,f.db);await flush(12);});
  expect(host.querySelector('[data-node="sender-message"]')).toBe(node);
  expect(node.querySelector('.who a')?.textContent).toBe('<Renamed source>');
  expect(node.querySelector('.who a')?.getAttribute('href')).toBe(header.getAttribute('href'));
  expect(node.querySelector('renamed')).toBeNull();
  // A malformed relationship on a later read cannot erase independent sender/body.
  f.db.history.lead=[{...f.db.history.lead![0],provenance:{sender:{kind:'model',thread_id:'full-source-identity',label:'Claimed <label>'},message:{expect_reply:true,reply_state:'replied',reply_node_id:null}}}];
  await act(async()=>{f.t.push({t:'changed',thread_ids:['lead'],list:false});await settle(f.t,f.db);await flush(12);});
  expect(host.querySelector('[data-node="sender-message"]')).toBe(node);
  expect(node.querySelector('[data-message-relation]')).toBeNull();expect(node.textContent).toContain('Received body stays');expect(node.querySelector('.who a')).not.toBeNull();

 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it('revokes the source header label and href together with its accepted owner snapshot',async()=>{
 const r=await rig(1),f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 r.owner.decorate=(_i,node)=>({...node,kind:'user',provenance:{sender:{kind:'model',thread_id:'exact-source'}},items:[{kind:'text',item_identity:'body',text:'Independent readable sender body',text_complete:true}]});
 const model=new Proxy(f.model,{get(target,key){return key==='longReader'?{value:r.w,peek:()=>r.w}:Reflect.get(target,key);}});
 const {SavedWindowContent}=await import('../screens/Conversation');
 try{
  await r.settle();const snapshot=r.w.acceptedView.peek();
  await act(async()=>render(<SavedWindowContent model={model} snapshot={snapshot} liveFacts={[]}/>,host));
  expect(host.querySelector('.who a')?.getAttribute('href')).toContain('exact-source');expect(host.querySelector('.who a')?.textContent).toContain('exact-so');
  r.w.dispose();expect(r.w.acceptedView.isCurrent(snapshot)).toBe(false);
  await act(async()=>render(<SavedWindowContent model={model} snapshot={snapshot} liveFacts={[]}/>,host));
  expect(host.querySelector('.who a')).toBeNull();expect(host.textContent).not.toContain('Independent readable sender body');
 }finally{render(null,host);host.remove();r.w.dispose();r.data.stop();f.model.dispose();f.data.stop();}
});
