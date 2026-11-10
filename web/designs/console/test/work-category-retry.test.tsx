// @vitest-environment happy-dom
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import {fixtureModel} from '../../../ui-core/test/fixture';
import {projectLegacyHistoryItems,projectSavedItems} from '../../../ui-core/src/conversation-items';
import {LiveRecordChrome,SavedConversationItems} from '../screens/Conversation';
import type {HandoffRetryState} from '../../../data/src/store';
it('headings consume canonical category counts, omit zero and keep reasons only inside Problems',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const projection=projectSavedItems([
   {nodeId:'t',itemIdentity:'t',windowRevision:1,kind:'tool',executionIds:['one']},
   {nodeId:'r',itemIdentity:'r',windowRevision:1,kind:'reasoning_unavailable'},
   {nodeId:'n',itemIdentity:'n',windowRevision:1,kind:'record',classificationCase:'notification'},
   {nodeId:'p',itemIdentity:'p',windowRevision:1,kind:'unavailable',reason:'response_budget'},
  ]);
  await act(async()=>render(<SavedConversationItems model={f.model} projection={projection}/>,host));
  const heading=host.querySelector('[data-work-heading]')!;
  for(const label of [f.model.t.value('tools.count',{n:1}),...(['Reasoning','Notifications','Problems'] as const).map(category=>f.model.t.value(`work.category.${category}`,{n:1}))])expect(heading.textContent).toContain(label);
  expect(heading.textContent).not.toContain('response_budget');expect(host.textContent).not.toMatch(/Record|records/);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it.each<HandoffRetryState>([{phase:'idle',canRetry:false},{phase:'reading',canRetry:false},{phase:'failed',reason:'lookup-failed',canRetry:true},{phase:'unavailable',reason:'unresolved',canRetry:true},{phase:'unavailable',reason:'paused',canRetry:false}])('retry UI follows actual handle state %j',async state=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);let reads=0;
 const handle={handoffRetryState:{value:state},retryHandoff:async()=>{reads++;}};
 const model=new Proxy(f.model,{get(target,key){return key==='handle'?{value:handle}:Reflect.get(target,key);}});
 try{
  await act(async()=>render(<LiveRecordChrome model={model} record={{key:'actual',attemptId:'attempt',status:'confirming',text:'',incomplete:false}} retry={()=>{throw Error('old callback must not be used');}}/>,host));
  const button=host.querySelector('button');
  if(state.phase==='reading'){expect(button?.disabled).toBe(true);expect(reads).toBe(0);}
  else if(state.canRetry){expect(button?.disabled).toBe(false);await act(async()=>button!.click());expect(reads).toBe(1);}
  else expect(button).toBeNull();
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it('public event without notification subtype stays generic Notifications, no continuation-cause label',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const projection=projectLegacyHistoryItems({nodes:[{node_id:'public-event',kind:'event',items:[{item_identity:'event-text',kind:'text',text:'Synthetic event content',text_complete:true}]}]}).projection;
  expect(projection.workGroups?.[0]?.categoryCounts).toEqual({Tools:0,Reasoning:0,Notifications:1,Problems:0});
  await act(async()=>render(<SavedConversationItems model={f.model} projection={projection}/>,host));
  expect(host.querySelector('[data-internal-records] summary')?.textContent).toBe(f.model.t.value('work.notification'));
  expect(host.textContent).not.toContain(f.model.t.value('work.continueNotification'));
  expect(host.textContent).not.toContain(f.model.t.value('work.problem'));
  expect(host.querySelector('[data-items-unavailable-reason], [data-item-unavailable]')).toBeNull();
  expect(host.textContent).not.toContain('Synthetic event content');
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('uses CASE closed defaults and preserves explicit Work and record choices through rerender',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const projection=projectLegacyHistoryItems({nodes:[{node_id:'event-choice',kind:'event'}]}).projection;
  const show=()=>render(<SavedConversationItems model={f.model} projection={projection}/>,host);
  await act(async()=>show());const group=host.querySelector<HTMLDetailsElement>('[data-work-group]')!;
  expect(group.open).toBe(false);
  await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
  const record=host.querySelector<HTMLDetailsElement>('[data-internal-records]')!;expect(record.open).toBe(false);
  await act(async()=>{record.open=true;record.dispatchEvent(new Event('toggle'));});
  await act(async()=>show());expect(group.open).toBe(true);expect(record.open).toBe(true);
  await act(async()=>{record.open=false;record.dispatchEvent(new Event('toggle'));});
  await act(async()=>show());expect(record.open).toBe(false);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
