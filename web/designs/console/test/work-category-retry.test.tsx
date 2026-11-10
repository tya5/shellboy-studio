// @vitest-environment happy-dom
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import {fixtureModel} from '../../../ui-core/test/fixture';
import {projectSavedItems} from '../../../ui-core/src/conversation-items';
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
