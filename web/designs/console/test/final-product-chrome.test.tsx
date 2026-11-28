import '@preact/signals';
// @vitest-environment happy-dom
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import {flush,settle} from '../../../data/test/harness';
import {publicConversationFixture,CurrentSavedView} from './conversation-fixture';

it('retains canonical record identity and explicit Work choice without an empty record disclosure',async()=>{
 const f=await publicConversationFixture({nodes:[{node_id:'record-node',kind:'event'}]}),host=document.createElement('div');document.body.append(host);
 try{
  await act(async()=>render(<CurrentSavedView fixture={f}/>,host));const detail=host.querySelector('[data-internal-records]')!;
  expect(detail.tagName).toBe('DIV');expect(detail.querySelector('details,summary')).toBeNull();
  const line=detail.querySelector('.work-element-row__line')!;expect(line.querySelector('svg')).not.toBeNull();
  const key=detail.closest('[data-item-key]')!.getAttribute('data-item-key'),kind=line.getAttribute('title');expect(kind).toBeTruthy();expect(line.getAttribute('aria-label')).toContain(kind!);
  const group=detail.closest<HTMLDetailsElement>('[data-work-group]')!;expect(group.open).toBe(false);
  await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
  await act(async()=>{await f.publish({nodes:[{node_id:'record-node',kind:'event'},{node_id:'independent-user',kind:'user',items:[{kind:'text',item_identity:'user-id',text:'Independent saved message',text_complete:true}]}]});});
  expect(host.querySelector('[data-internal-records]')).toBe(detail);expect(detail.querySelector('.work-element-row__line')).toBe(line);expect(line.getAttribute('title')).toBe(kind);
  expect(detail.querySelector('details,summary')).toBeNull();expect(group.open).toBe(true);
  await act(async()=>{await f.publish({nodes:[{node_id:'record-node',kind:'event'},{node_id:'tool-node',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'tool-id',execution_ids:['explicit-exec']}]}]});});
  const replaced=host.querySelector('[data-internal-records]')!;expect(replaced.closest('[data-item-key]')!.getAttribute('data-item-key')).toBe(key);
  expect(replaced.querySelector('details,summary')).toBeNull();expect(replaced.closest<HTMLDetailsElement>('[data-work-group]')!.open).toBe(false);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('omits retired retry chrome while retaining failed live text and overflow',async()=>{
 const f=await publicConversationFixture({nodes:[]}),host=document.createElement('div');document.body.append(host);
 const base=f.db.answer.bind(f.db);f.db.answer=call=>call.command==='status'?{ok:false,code:'lookup-failed',message:'Synthetic lookup failure'}:base(call);
 try{
  await act(async()=>render(<CurrentSavedView fixture={f}/>,host));
  await act(async()=>{f.t.push({t:'live',thread_id:'lead',attempt_id:'actual-record',gap:false,deltas:[{offset:0,reasoning:false,text:''}]});await flush();
   const budget=f.data.retainedBudget;budget.setLimit(budget.usage.peek().pinned);
   f.t.push({t:'live',thread_id:'lead',attempt_id:'overflow',gap:false,deltas:[{offset:0,reasoning:false,text:'overflow'}]});
   budget.setLimit(64*1024*1024);
   f.t.push({t:'live_end',thread_id:'lead'});await settle(f.t,f.db);});
  expect(host.querySelector('[data-live-record-chrome="handoff:actual-record"]')?.closest('[data-work-group]')).not.toBeNull();
  expect(host.querySelector('[data-live-overflow]')).not.toBeNull();expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.querySelector('[data-live-record-chrome] button')).toBeNull();
  expect(host.textContent).toContain(f.model.t.value('convo.handoffLimit'));
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('does not synthesize a body-unavailable error for normal tool presence, but retains actual Core reasons',async()=>{
 const f=await publicConversationFixture({nodes:[{node_id:'tool',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'tool',execution_ids:['metadata-not-loaded']}]},
  {node_id:'core-unavailable',kind:'assistant_response',items:[{kind:'unavailable',item_identity:'u',reason:'response_budget'}]}]}),host=document.createElement('div');document.body.append(host);
 try{
  await act(async()=>render(<CurrentSavedView fixture={f}/>,host));const heading=host.querySelector('[data-work-heading]')!;
  expect(heading.textContent).not.toContain(f.model.t.value('work.textUnavailable'));expect(heading.textContent).not.toContain('response_budget');
  const group=host.querySelector<HTMLDetailsElement>('[data-work-group]')!;await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
  expect(host.querySelector('[data-node="tool"]')?.textContent).not.toContain(f.model.t.value('work.textUnavailable'));
  expect(host.querySelector('[data-items-unavailable-reason="response_budget"]')?.textContent).toContain('response_budget');
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
