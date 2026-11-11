// @vitest-environment happy-dom
// @ts-expect-error Node-only test reader; the UI typecheck intentionally excludes Node types.
import {readFileSync} from "node:fs";
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import {fixtureModel} from '../../../ui-core/test/fixture';
import {normalizeConversationFacts,projectHistoryWindowItems,projectLegacyHistoryItems,projectSavedItems} from '../../../ui-core/src/conversation-items';
import {LiveRecordChrome,SavedConversationItems} from '../screens/Conversation';
import type {HandoffRetryState} from '../../../data/src/store';
it('headings consume canonical category counts, omit zero and keep reasons only inside Problems',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const projection=projectSavedItems(normalizeConversationFacts([
   {nodeId:'t',itemIdentity:'t',windowRevision:1,kind:'tool',executionIds:['one']},
   {nodeId:'r',itemIdentity:'r',windowRevision:1,kind:'reasoning_unavailable'},
   {nodeId:'n',itemIdentity:'n',windowRevision:1,kind:'record',classificationCase:'notification'},
   {nodeId:'p',itemIdentity:'p',windowRevision:1,kind:'unavailable',reason:'response_budget'},
  ]));
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
  expect(host.querySelector('[data-internal-records] .work-element-row__line')?.getAttribute('title')).toBe('Notification');
  expect(host.textContent).not.toContain(f.model.t.value('work.continueNotification'));
  expect(host.textContent).not.toContain(f.model.t.value('work.problem'));
  expect(host.querySelector('[data-items-unavailable-reason], [data-item-unavailable]')).toBeNull();
  expect(host.textContent).not.toContain('Synthetic event content');
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('uses CASE closed Work defaults and visible kind when a notification has no expandable public detail',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const projection=projectLegacyHistoryItems({nodes:[{node_id:'event-choice',kind:'event'}]}).projection;
  const show=()=>render(<SavedConversationItems model={f.model} projection={projection}/>,host);
  await act(async()=>show());const group=host.querySelector<HTMLDetailsElement>('[data-work-group]')!;
  expect(group.open).toBe(false);
  await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
  const record=host.querySelector('[data-internal-records]')!;
  expect(record.tagName).toBe('DIV');expect(record.querySelector('details,summary')).toBeNull();
  const line=record.querySelector('.work-element-row__line')!;
  expect(line.getAttribute('title')).toBe('Notification');
  expect(line.getAttribute('aria-label')).toContain('A content summary was not provided');
  expect(line.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(line.querySelector('svg path')?.getAttribute('d')).toBe('M3 13l3-8h12l3 8v6H3zM3 13h5l1.5 3h5L16 13h5');
  expect(line.querySelector('.work-element-row__content')?.textContent).toBe('A content summary was not provided');
  expect(line.classList.contains('work-element-row__line')).toBe(true);
  await act(async()=>show());expect(group.open).toBe(true);
  await act(async()=>{group.open=false;group.dispatchEvent(new Event('toggle'));});
  await act(async()=>show());expect(group.open).toBe(false);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
for(const windowed of [false,true])it(`renders actual accepted-node execution metadata inside its same Work disclosure even when legacy history has no step: window=${windowed}`,async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const nodes=[{node_id:'accepted-tool-node',kind:'assistant_response',items:[{item_identity:'call',kind:'tool_call' as const,execution_ids:['accepted-execution']}],executions:[{execution_id:'accepted-execution',command_excerpt:'printf synthetic-tool',description:'Synthetic safe description',state:'exited'}]}];
  expect(f.model.conversation.peek().flatMap(row=>row.type==='steps'?row.steps:[]).some(step=>step.executionId==='accepted-execution')).toBe(false);
  const projection=(windowed?projectHistoryWindowItems({nodes,revision:1}):projectLegacyHistoryItems({nodes})).projection;
  await act(async()=>render(<SavedConversationItems model={f.model} nodes={nodes} projection={projection}/>,host));
  const group=host.querySelector<HTMLDetailsElement>('[data-work-group]')!;
  await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
  const tool=host.querySelector('[data-execution-id="accepted-execution"] .work-element-row')!;
  expect(tool).not.toBeNull();expect(tool.textContent).toContain('Synthetic safe description');
  expect(tool.querySelector('summary > .work-element-row__icon svg path')?.getAttribute('d')).toBe('M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9');
  await act(async()=>{f.model.shells.value=new Map([['accepted-execution',{execution_id:'accepted-execution',state:'exited'}]]);render(<SavedConversationItems model={f.model} nodes={nodes} projection={projection}/>,host);});
  expect(host.querySelector('[data-execution-id="accepted-execution"] .work-element-row summary > .work-element-row__icon svg rect')).not.toBeNull();
  const commandNodes=nodes.map(node=>({...node,executions:node.executions.map(execution=>({...execution,description:undefined}))}));
  const commandProjection=(windowed?projectHistoryWindowItems({nodes:commandNodes,revision:1}):projectLegacyHistoryItems({nodes:commandNodes})).projection;
  await act(async()=>render(<SavedConversationItems model={f.model} nodes={commandNodes} projection={commandProjection}/>,host));
  const commandTool=host.querySelector('[data-execution-id="accepted-execution"] .work-element-row')!;
  expect(commandTool.textContent).toContain('printf synthetic-tool');
  expect(commandTool.closest('[data-work-group]')).toBe(group);
  expect(host.querySelector('[data-execution-unresolved]')).toBeNull();
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it('non-tool Work rows keep visible authorized content and the existing DS summary gutter',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const projection=projectLegacyHistoryItems({nodes:[
   {node_id:'r',kind:'reasoning_unavailable'},
   {node_id:'n',kind:'event'},
   {node_id:'p',kind:'assistant_response',items:[{kind:'unavailable',item_identity:'p',reason:'response_budget'}]},
   {node_id:'u',kind:'future_kind'},
   {node_id:'a',kind:'assistant_response',items:[{kind:'unavailable',item_identity:'a',reason:'response_budget'}]},
  ]}).projection;
  await act(async()=>render(<SavedConversationItems model={f.model} projection={projection}/>,host));
  const group=host.querySelector<HTMLDetailsElement>('[data-work-group]')!;await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
  const contents=[...host.querySelectorAll('.work-element-row__content')];
  expect(contents).toHaveLength(5);for(const content of contents)expect(content.textContent?.trim()).not.toBe('');
  expect(contents.map(content=>content.textContent)).toEqual(['Reasoning content is not publicly available','A content summary was not provided',"Display data exceeded this response's read budget",'Item details are not supported',"Display data exceeded this response's read budget"]);
  expect(host.textContent).toContain('response_budget');
  expect(host.textContent).not.toContain(f.model.t.value('work.thinking'));
  expect(host.querySelector('[data-internal-records] details')).toBeNull();

 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

for(const windowed of [false,true])it(`all actual Work member boundaries own one separator across nested tool and non-tool DOM window=${windowed}`,async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 const css=readFileSync('designs/console/system/components.css','utf8') as string;
 const boundary='[data-work-group]>.step-group-list>[data-work-item-key]';
 const toolReset=boundary+'>div>[data-execution-id]>.step:not(.step-group)';
 const rule=(selector:string)=>css.split(selector+'{')[1]?.split('}')[0];
 try{
  const nodes=[{node_id:'mixed',kind:'assistant_response',items:[
   {item_identity:'tool',kind:'tool_call' as const,execution_ids:['one','two']},
   {item_identity:'reason',kind:'reasoning_unavailable' as const},
   {item_identity:'problem',kind:'unavailable' as const,reason:'response_budget' as const},
  ],executions:[{execution_id:'one',command_excerpt:'printf one',state:'exited'},{execution_id:'two',command_excerpt:'printf two',state:'exited'}]},
  {node_id:'notification',kind:'event'}];
  const projection=(windowed?projectHistoryWindowItems({nodes,revision:1}):projectLegacyHistoryItems({nodes})).projection;
  const paint=()=>render(<SavedConversationItems model={f.model} nodes={nodes} projection={projection}/>,host);
  await act(async()=>paint());
  const group=host.querySelector<HTMLDetailsElement>('[data-work-group]')!;
  const members=[...host.querySelectorAll('[data-work-item-key]')];expect(members).toHaveLength(4);
  expect(host.querySelectorAll('[data-execution-id]>.work-element-row')).toHaveLength(0);
  expect(host.querySelectorAll('[data-item-key]')).toHaveLength(4);
  for(const open of [true,false,true]){
   await act(async()=>{group.open=open;group.dispatchEvent(new Event('toggle'));paint();});
   const tools=[...host.querySelectorAll<HTMLDetailsElement>('[data-execution-id]>.work-element-row')];expect(tools).toHaveLength(open?2:0);
   for(const tool of tools){tool.open=open;tool.dispatchEvent(new Event('toggle'));}
   expect(host.querySelectorAll(boundary)).toHaveLength(4);
   for(const member of members)expect(member.matches(boundary)).toBe(true);
   for(const tool of tools){expect(tool.matches(toolReset)).toBe(false);expect(tool.classList.contains('work-element-row')).toBe(true);expect(tool.matches(boundary)).toBe(false);}
   expect(rule(boundary)).toBe('border-top:1px solid var(--line)');
   expect(rule(toolReset)).toBe('border:0;border-radius:0;background:transparent');
   expect(rule(toolReset+'[open]')).toBe('border:0');
   expect(group.open).toBe(open);expect([...host.querySelectorAll('[data-work-item-key]')]).toEqual(members);
  }
  expect(members[0]!.querySelectorAll('[data-execution-id]>.work-element-row')).toHaveLength(2);
  expect(host.querySelector('[data-work-item-key] [data-work-item-key]')).toBeNull();
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
