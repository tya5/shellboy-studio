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
  expect(group.querySelector(':scope > summary')?.textContent).toContain(f.model.t.value('work.group'));
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
