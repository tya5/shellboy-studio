// @vitest-environment happy-dom
import '@preact/signals';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import {fixtureModel} from '../../../ui-core/test/fixture';
import {projectLegacyHistoryItems,normalizeTerminalPresenceFacts,projectSavedItems} from '../../../ui-core/src/conversation-items';
import {projectHistoryWindowItems} from '../../../ui-core/src/conversation-items';
import {SavedConversationItems} from '../screens/Conversation';
import type {HistoryItem} from '../../../data/src/protocol';

for(const windowed of [false,true])it(`actual four Work categories consume identical chrome and factual content: window=${windowed}`,async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 const nodes:HistoryItem[]=[
  {node_id:'r',kind:'reasoning_unavailable'},
  {node_id:'n',kind:'event',provenance:{created_at:'2026-01-01T00:00:00Z'}},
  {node_id:'p',kind:'assistant_response',items:[{item_identity:'p',kind:'unavailable',reason:'response_budget'}]},
  {node_id:'t',kind:'assistant_response',items:[{item_identity:'call',kind:'tool_call',execution_ids:['one','two']}],executions:[{execution_id:'one',command_excerpt:'printf one',state:'exited',exit_code:0},{execution_id:'two',command_excerpt:'printf two',state:'running'}]},
 ];
 try{
  f.model.shells.value=new Map([['one',{execution_id:'one',state:'exited'}],['two',{execution_id:'two',state:'running'}]]);
  const projection=windowed?projectHistoryWindowItems({revision:1,nodes,keyScope:['scope']}):projectLegacyHistoryItems({nodes,keyScope:['scope']});
  await act(async()=>render(<SavedConversationItems model={f.model} nodes={nodes} projection={projection.projection}/>,host));
  const group=host.querySelector<HTMLDetailsElement>('[data-work-group]')!;
  const heading=group.querySelector(':scope > summary')!;
  expect(heading.textContent).not.toContain(f.model.t.value('work.group'));
  expect(heading.getAttribute('aria-label')).toContain(f.model.t.value('work.group'));
  expect(heading.textContent?.trim()).not.toBe('');
  expect(group.querySelector(':scope > .step-group-list')).not.toBeNull();
  await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
  const members=[...host.querySelectorAll('[data-work-item-key]')];expect(members).toHaveLength(4);
  const rows=[...host.querySelectorAll('.work-element-row')];expect(rows).toHaveLength(5);
  for(const row of rows){
   const line=row.querySelector(':scope > .work-element-row__line')!;
   expect(line.querySelector('.work-element-row__icon svg')?.getAttribute('aria-hidden')).toBe('true');
   expect(line.querySelector('.work-element-row__content')?.textContent?.trim()).not.toBe('');
   const type=line.getAttribute('title');expect(type).toBeTruthy();expect(line.getAttribute('aria-label')).toContain(type!);
   expect(line.textContent?.startsWith(`${type}:`)).toBe(false);
  }
  expect(host.textContent).not.toContain('event:');expect(host.textContent).not.toContain('future_kind:');
  expect(host.textContent).toContain('2026-01-01T00:00:00Z');
  const first=host.querySelector('[data-execution-id="one"] .work-element-row')!;
  const second=host.querySelector('[data-execution-id="two"] .work-element-row')!;
  expect(first.textContent).toContain('printf one');expect(first.textContent).not.toContain('printf two');
  expect(second.textContent).toContain('printf two');expect(second.getAttribute('data-state-value')).toBe('running');
  expect(first.querySelector('details')).toBeNull();expect(first.tagName).toBe('DETAILS');
  expect(first.querySelector(':scope > summary > .work-element-row__icon svg rect')).not.toBeNull();
  expect(first.getAttribute('data-exit-code')).toBe('0');
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('actual CLIENT receipt uses common chrome without implying a Core wire error',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 try{
  const presence={scope:'scope',attemptId:'a',receipt:{scope:'scope',attemptId:'a',nodeIds:['n'],terminalState:'completed' as const},phase:'settled' as const,reason:'read-error' as const,answerAvailability:'unknown' as const};
  const projection=projectSavedItems(normalizeTerminalPresenceFacts([presence]));
  await act(async()=>render(<SavedConversationItems model={f.model} projection={projection}/>,host));
  const group=host.querySelector<HTMLDetailsElement>('[data-work-group]')!;await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
  const opened=host.querySelector('.work-element-row')!;const row=opened;
  expect(opened.getAttribute('data-state-source')).toBe('client');expect(row.getAttribute('data-state-value')).toBe('read-error');
  expect(row.textContent).toContain('CLIENT');expect(row.querySelector('.work-element-row__line')?.getAttribute('aria-label')).toContain('CLIENT');
  expect(row.querySelector('summary,details')).toBeNull();
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('renders an explicit unavailable Work cut when a mixed issued/foreign scope batch is rejected',async()=>{
 const {ConversationWindow}=await import('../../../ui-core/src/window');
 const {normalizeLiveWorkFacts}=await import('../../../ui-core/src/conversation-items');
 const {SavedWindowContent}=await import('../screens/Conversation');
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 const node:HistoryItem={node_id:'independent',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'body',text:'Independent saved text',text_complete:true}]};
 const reader=new ConversationWindow({read:async()=>({ok:true,value:{thread_id:'t',revision:1,total:1,items:[node]}})});
 try{
  await act(async()=>{await Promise.resolve();await Promise.resolve();});
  const snapshot=reader.acceptedView.peek();expect(reader.acceptedView.isCurrent(snapshot)).toBe(true);
  const model=new Proxy(f.model,{get(target,key){return key==='longReader'?{value:reader,peek:()=>reader}:Reflect.get(target,key);}});
  const valid=normalizeLiveWorkFacts({scope:'t',items:[{kind:'progress',id:'valid',thread_id:'t',state:'running'}]});
  const foreign={domain:'live' as const,scope:'foreign',recordId:'unissued',kind:'unknown' as const};
  await act(async()=>render(<SavedWindowContent model={model} snapshot={snapshot} liveFacts={[...valid,foreign]}/>,host));
  expect(host.textContent).toContain('Independent saved text');
  const rejected=host.querySelector('[data-work-scope-rejected]')!;
  expect(rejected.getAttribute('role')).toBe('status');expect(rejected.textContent).toContain('CLIENT');expect(rejected.textContent).toContain('scope-qualification-rejected');
  expect(reader.acceptedView.isCurrent(snapshot)).toBe(true);
  await act(async()=>render(<SavedWindowContent model={model} snapshot={snapshot} liveFacts={[...valid,foreign]}/>,host));
  expect(host.querySelector('[data-work-scope-rejected]')).toBe(rejected);
  expect(host.textContent).not.toContain('foreign');expect(host.textContent).not.toContain('unissued');
  await act(async()=>render(<SavedWindowContent model={model} snapshot={snapshot} liveFacts={valid}/>,host));
  expect(host.querySelector('[data-work-scope-rejected]')).toBeNull();expect(host.querySelector('.work-element-row')).not.toBeNull();
  reader.dispose();expect(reader.acceptedView.isCurrent(snapshot)).toBe(false);
  await act(async()=>render(<SavedWindowContent model={model} snapshot={snapshot} liveFacts={[...valid,foreign]}/>,host));
  expect(host.querySelector('[data-work-scope-rejected]')).toBeNull();expect(host.textContent).not.toContain('Independent saved text');

 }finally{render(null,host);reader.dispose();host.remove();f.model.dispose();f.data.stop();}
});
