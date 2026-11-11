// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect,it } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { projectSavedItems, projectLegacyHistoryItems } from '../../../ui-core/src/conversation-items';
import {ConversationWindow} from '../../../ui-core/src/window';
import { SavedConversationItems, SavedWindowContent } from '../screens/Conversation';
it('retains canonical record identity and explicit Work choice without an empty record disclosure',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const facts=projectLegacyHistoryItems({nodes:[{node_id:'record-node',kind:'event'}]}).projection;
  const show=()=>render(<SavedConversationItems model={f.model} projection={facts}/>,host);
  await act(async()=>{show();});const detail=host.querySelector('[data-internal-records]')! as HTMLDetailsElement;
  expect(detail.tagName).toBe('DIV');expect(detail.querySelector('details,summary')).toBeNull();
  const line=detail.querySelector('.work-element-row__line')!;expect(line.querySelector('svg')).not.toBeNull();
  const key=detail.closest('[data-item-key]')!.getAttribute('data-item-key');
  const kind=line.getAttribute('title');expect(kind).toBeTruthy();expect(line.getAttribute('aria-label')).toContain(kind!);
  const group=detail.closest('[data-work-group]') as HTMLDetailsElement;expect(group.open).toBe(false);
  await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
  await act(async()=>{render(<SavedConversationItems model={f.model} projection={projectLegacyHistoryItems({nodes:[{node_id:'record-node',kind:'event'},{node_id:'independent-user',kind:'user',items:[{kind:'text',item_identity:'user-id',text:'Independent saved message',text_complete:true}]}]}).projection}/>,host);});
  expect(host.querySelector('[data-internal-records]')).toBe(detail);
  expect(detail.querySelector('.work-element-row__line')).toBe(line);expect(line.getAttribute('title')).toBe(kind);
  expect(detail.querySelector('details,summary')).toBeNull();expect(group.open).toBe(true);
  await act(async()=>{render(<SavedConversationItems model={f.model} projection={projectLegacyHistoryItems({nodes:[{node_id:'record-node',kind:'event'},{node_id:'tool-node',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'tool-id',execution_ids:['explicit-exec']}]}]}).projection}/>,host);});
  const replaced=host.querySelector('[data-internal-records]')!;
  expect(replaced.closest('[data-item-key]')!.getAttribute('data-item-key')).toBe(key);
  expect(replaced.querySelector('details,summary')).toBeNull();
  expect((replaced.closest('[data-work-group]') as HTMLDetailsElement).open).toBe(false);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('retains retry chrome for a nontext failed live record and exposes overflow without a duplicate footer',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);let retries=0;
 const reader=new ConversationWindow({read:async()=>({ok:true,value:{thread_id:'thread',revision:1,total:0,items:[]}})});
 try{
  const handle={threadId:'thread',handoffScope:()=> 'scope',handoffRetryState:{value:{phase:'failed',reason:'lookup-failed',canRetry:true}},handoff:{value:[{key:'actual-record',attemptId:'attempt',status:'failed',text:'',incomplete:true}]},handoffOverflow:{value:true},work:{value:{}},retryHandoff:()=>{retries++;}};
  const model=new Proxy(f.model,{get(target,key){return key==='handle'?{value:handle}:key==='longReader'?{value:reader,peek:()=>reader}:Reflect.get(target,key);}});
  await act(async()=>{await Promise.resolve();await Promise.resolve();});
  const snapshot=reader.acceptedView.peek();expect(reader.acceptedView.isCurrent(snapshot)).toBe(true);
  await act(async()=>render(<SavedWindowContent model={model} snapshot={snapshot}/>,host));
  expect(host.querySelector('[data-live-record-chrome="actual-record"]')?.closest('[data-work-group]')).not.toBeNull();
  expect(host.querySelector('[data-live-overflow]')).not.toBeNull();expect(host.querySelector('[role="status"]')).toBeNull();
  await act(async()=>{host.querySelector('[data-live-record-chrome] button')!.dispatchEvent(new MouseEvent('click',{bubbles:true}));});expect(retries).toBe(1);reader.dispose();
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('does not synthesize a body-unavailable error for normal tool presence, but retains actual Core reasons',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const projection=projectLegacyHistoryItems({nodes:[{node_id:'tool',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'tool',execution_ids:['metadata-not-loaded']}]},{node_id:'core-unavailable',kind:'assistant_response',items:[{kind:'unavailable',item_identity:'u',reason:'response_budget'}]}]}).projection;
  await act(async()=>render(<SavedConversationItems model={f.model} projection={projection}/>,host));
  const heading=host.querySelector('[data-work-heading]')!;
  expect(heading.textContent).not.toContain(f.model.t.value('work.textUnavailable'));
  expect(heading.textContent).not.toContain('response_budget');
  const group=host.querySelector('[data-work-group]')! as HTMLDetailsElement;
  await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
  expect(host.querySelector('[data-node="tool"]')?.textContent).not.toContain(f.model.t.value('work.textUnavailable'));
  expect(host.querySelector('[data-items-unavailable-reason="response_budget"]')?.textContent).toContain('response_budget');
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
