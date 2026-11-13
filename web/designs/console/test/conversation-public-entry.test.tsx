// @vitest-environment happy-dom
import { render } from 'preact';
import {flush} from '../../../data/test/harness';
import '@preact/signals';
import {signal} from '@preact/signals';
import {useLayoutEffect,useState} from 'preact/hooks';
import {ConversationWindow,type WindowAcceptedSnapshot} from '../../../ui-core/src/window';
import {Handoff} from '../../../data/src/handoff';
import type {AppModel} from '../../../ui-core/src/model';
import {SavedWindowContent as ActualSavedWindowContent} from '../screens/Conversation';
import { act } from 'preact/test-utils';
import { afterAll, expect, it, vi } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { normalizeConversationFacts, normalizeLiveWorkFacts, projectSavedItems } from '../../../ui-core/src/conversation-items';

// Control the real lazy renderer boundary: cold text and warm Markdown are different DOM contracts.
const rendererGate=vi.hoisted(()=>{
 let release!:()=>void;
 const ready=new Promise<void>(resolve=>{release=resolve;});
 return {ready,release};
});
vi.mock('../system/components/Message/markdown',async importOriginal=>{
 await rendererGate.ready;
 return importOriginal();
});
afterAll(()=>rendererGate.release());

type IssuedProps=Parameters<typeof ActualSavedWindowContent>[0];
// The real reader owns and publishes this ref; a fixture object is never current.
function IssuedWindowContent(props:IssuedProps & {onIssued?:(reader:ConversationWindow,snapshot:WindowAcceptedSnapshot)=>void}){
 const [issued,setIssued]=useState<{reader:ConversationWindow;snapshot:WindowAcceptedSnapshot}>();
 useLayoutEffect(()=>{
  const rows=props.snapshot.rows.map((row,index)=>({...row,selection:{...row.selection,ordinal:row.selection?.ordinal??index}}));
  const total=rows.length?Math.max(...rows.map(row=>row.selection.ordinal))+1:0;
  const reader=new ConversationWindow({read:async()=>({ok:true,value:{thread_id:'issued-fixture',revision:1,total,items:rows}})});
  let preparing=false;
  const publish=()=>{
   if(preparing||reader.acceptedView.peek().revision===undefined)return;
   preparing=true;
   for(const retired of props.snapshot.retiredAttempts??[]){
    const ledger=new Handoff(fn=>fn());ledger.apply({attempt_id:retired.attemptId,gap:false,deltas:[{offset:0,reasoning:false,text:'Owned stream'}]});
    const original=ledger.records.value[0]!;
    const proof={scope:retired.scope,attemptId:retired.attemptId,turnId:retired.turnId,revision:1,total:rows.length,refs:retired.nodeIds.map(nodeId=>({nodeId})),nodes:rows.filter(row=>retired.nodeIds.includes(row.node_id!))};
    if(ledger.stageAttempt(original,proof))ledger.transferAttempt(original,proof,(record,release)=>reader.acceptHandoff(record,retired.scope,release));
    ledger.discard('ended');
   }
   preparing=false;const snapshot=reader.acceptedView.peek();props.onIssued?.(reader,snapshot);setIssued({reader,snapshot});
  };
  const stop=reader.acceptedView.subscribe(publish);
  publish();return()=>{stop();reader.dispose();};
 },[props.snapshot]);
 if(!issued)return null;
 const model=new Proxy(props.model,{get(target,key){if(key==='longReader')return {value:issued.reader,peek:()=>issued.reader};return Reflect.get(target,key);}});
 return <ActualSavedWindowContent {...props} model={model} snapshot={issued.snapshot}/>;
}

it('provides a Console-owned saved-text renderer without a fixture render callback',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const screen=await import('../screens/Conversation') as unknown as Record<string,any>;
    expect(screen.SavedConversationItems).toBeTypeOf('function');
    const Saved=screen.SavedConversationItems;
    const projection=projectSavedItems([{nodeId:'synthetic-saved-node',itemIdentity:'text-0',revision:'synthetic-r1',kind:'text',text:'Synthetic saved text without registry callback'}]);
    await act(async()=>render(<Saved model={fixture.model} projection={projection}/>,host));
    expect(host.textContent).toContain('Synthetic saved text without registry callback');
    expect(host.querySelector('[data-item-key]')?.getAttribute('data-node')).toBe('synthetic-saved-node');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('shows a deferred whole-node placeholder without exposing its unproved aggregate excerpt',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const screen=await import('../screens/Conversation') as unknown as Record<string,any>;
    expect(screen.DeferredHistoryNode).toBeTypeOf('function');const Deferred=screen.DeferredHistoryNode;
    const row:import('../../../data/src/protocol').HistoryItem={node_id:'synthetic-deferred',kind:'assistant_response',excerpt:'Synthetic unproved aggregate must stay hidden',selection:{ordinal:3},items:null,items_unavailable_reason:'response_budget'};
    await act(async()=>render(<Deferred model={fixture.model} row={row}/>,host));
    expect(host.querySelector('[data-items-unavailable-reason="response_budget"]')?.getAttribute('data-node')).toBe(row.node_id);
    expect(host.textContent).toContain(fixture.model.t.value('work.textUnavailable'));
    expect(host.textContent).not.toContain(row.excerpt!);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('keeps all execution IDs under the single authoritative tool item wrapper',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedConversationItems }=await import('../screens/Conversation');
    const projection=projectSavedItems([{nodeId:'multi-node',itemIdentity:'multi-tool',windowRevision:1,kind:'tool',executionIds:['execution-one','execution-two']}]);
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={projection}/>,host));
    expect(host.querySelectorAll('[data-item-key]')).toHaveLength(1);
    expect([...host.querySelectorAll('[data-execution-id]')].map(el=>el.getAttribute('data-execution-id'))).toEqual(['execution-one','execution-two']);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('maps actual typed window rows without a registry and preserves ordinary/deferred node ordering',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const SavedWindowContent=IssuedWindowContent;
    const rows:import('../../../data/src/protocol').HistoryItem[]=[
      {node_id:'saved',kind:'assistant_response',selection:{ordinal:0},items:[{item_identity:'t0',kind:'text',text:'Actual typed saved content',text_complete:true}]},
      {node_id:'ordinary',kind:'user',excerpt:'Ordinary node survives',selection:{ordinal:1}},
      {node_id:'deferred',kind:'assistant_response',excerpt:'Unproved deferred body',selection:{ordinal:2},items:null,items_unavailable_reason:'response_budget'},
    ];
    const snapshot={rows,range:{first:0,last:2},total:3,revision:1,generation:1,epoch:1,disposed:false,pending:false};
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={snapshot}/>,host));
    expect(host.textContent).toContain('Actual typed saved content');expect(host.textContent).toContain('Ordinary node survives');
    expect(host.textContent).not.toContain('Unproved deferred body');expect(host.querySelector('[data-node="deferred"]')).not.toBeNull();
    const content=host.querySelector('[data-item-key]')!;expect(content.parentElement?.className).toBe('conversation-items');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});


it.each(['empty', 'reasoning', 'deferred', 'undefined', 'empty-window'] as const)('places explicit live Work exactly once with %s boundary input',async mode=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const SavedWindowContent=IssuedWindowContent;
    const rows:import('../../../data/src/protocol').HistoryItem[]=mode==='empty-window'?[]:[
      {node_id:'boundary-node',kind:'assistant_response',selection:{ordinal:1},...(mode==='deferred'?{items:null,items_unavailable_reason:'response_budget' as const}:{items:mode==='reasoning'?[{item_identity:'reasoning',kind:'reasoning_unavailable' as const}]:[]})},
      {node_id:'later-human',kind:'user',excerpt:'Later human',selection:{ordinal:2}},
    ];
    const snapshot={rows,range:{first:0,last:2},total:rows.length,revision:1,generation:1,epoch:1,disposed:false,pending:false};
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={snapshot} liveFacts={normalizeLiveWorkFacts({scope:'synthetic-thread',items:[{kind:'progress',id:'live-record',thread_id:'synthetic-thread',state:'running'}]})}/>,host));
    const records=[...host.querySelectorAll('[data-work-item-key]')].filter(item=>item.getAttribute('data-item-key')?.includes('live-record'));
    expect(records).toHaveLength(1);expect(records[0]!.closest('[data-work-group]')).not.toBeNull();
    if(mode!=='empty-window')expect(host.textContent).toContain('Later human');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});


it('restores authoritative user Message chrome without substituting aggregate text for typed content',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const SavedWindowContent=IssuedWindowContent;
    const rows:import('../../../data/src/protocol').HistoryItem[]=[{node_id:'user-chrome',kind:'user',excerpt:'Aggregate must not replace item',provenance:{created_at:'2099-01-01T00:00:00Z',sender:{kind:'human'}},selection:{ordinal:0},items:[{item_identity:'user-text',kind:'text',text:'Authoritative typed user content',text_complete:true}]}];
    const snapshot={rows,range:{first:0,last:0},total:1,revision:1,generation:1,epoch:1,disposed:false,pending:false};
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={snapshot}/>,host));
    const item=host.querySelector('[data-item-key]')!;
    expect(item.querySelector('.msg .av')).not.toBeNull();expect(item.querySelector('.who')?.textContent).toContain(fixture.model.t.value('convo.you'));
    expect(item.querySelector('.who small')).not.toBeNull();expect(item.querySelector('.msg-acts')).not.toBeNull();
    expect(item.classList.contains('conversation-row')).toBe(true);
    expect(item.textContent).toContain('Authoritative typed user content');expect(item.textContent).not.toContain('Aggregate must not replace item');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('restores Work group toggle with real parent containment and retains same-membership item DOM',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedConversationItems }=await import('../screens/Conversation');
    const projection=projectSavedItems([{nodeId:'group-node',itemIdentity:'tool-1',windowRevision:1,kind:'tool',executionIds:['group-exec-1']},{nodeId:'group-node',itemIdentity:'tool-2',windowRevision:1,kind:'tool',executionIds:['group-exec-2']}]);
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={projection}/>,host));
    const details=host.querySelector('details[data-work-group]')! as HTMLDetailsElement,heading=details.querySelector('summary')!;
    expect(details).not.toBeNull();expect(details.open).toBe(false);
    const items=[...host.querySelectorAll('[data-item-key]')];expect(items).toHaveLength(2);
    expect(details.open).toBe(false);expect(items.every(item=>item.closest('[data-work-group]')===details)).toBe(true);
    expect(heading.querySelector('[data-item-key]')).toBeNull();
    const parent=items[0]!.parentElement;
    await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
    expect([...host.querySelectorAll('[data-item-key]')]).toEqual(items);
    expect(details.open).toBe(true);expect(items.every(item=>item.parentElement===parent)).toBe(true);
    await act(async()=>{details.open=false;details.dispatchEvent(new Event('toggle'));});
    expect([...host.querySelectorAll('[data-item-key]')]).toEqual(items);expect(details.open).toBe(false);expect(items.every(item=>item.closest('[data-work-group]')===details)).toBe(true);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it.each([['cold',''],['cold','Partial authoritative item'],['warm',''],['warm','Partial authoritative item']])('never replaces authorized item text in %s renderer: %j with a cached aggregate body',async (phase,text)=>{
  if(phase==='warm'){rendererGate.release();await act(async()=>{await import('../system/components/Message/markdown');await vi.dynamicImportSettled();});}
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const SavedWindowContent=IssuedWindowContent;
    fixture.model.bodies.value=new Map([['item-authority',{text:'Forbidden cached aggregate body',loading:false,error:undefined}]]);
    const rows:import('../../../data/src/protocol').HistoryItem[]=[{node_id:'item-authority',kind:'user',provenance:{sender:{kind:'human'}},excerpt:'Forbidden aggregate excerpt',selection:{ordinal:0},items:[{item_identity:'text',kind:'text',text,text_complete:false}]}];
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={{rows,range:{first:0,last:0},total:1,revision:1,generation:1,epoch:1,disposed:false,pending:false}}/>,host));
    expect(host.textContent).not.toContain('Forbidden');expect(host.querySelector('.more')).toBeNull();
    expect(host.querySelector('[data-item-partial]')).not.toBeNull();
    const body=host.querySelector('.msg .md')!;
    if(phase==='cold'){
      expect(body.classList.contains('plain')).toBe(true);
      expect(host.querySelector('.msg .md')?.textContent??'').toBe(text);
    }else{
      expect(body.classList.contains('plain')).toBe(false);
      // Markdown's paragraph separator is renderer structure, not an extra source character.
      expect(body.innerHTML).toBe(text?'<p>Partial authoritative item</p>\n':'');
      expect(body.querySelectorAll('p')).toHaveLength(text?1:0);
      expect(body.querySelector('p')?.textContent??'').toBe(text);
    }
    const link=host.querySelector('.msg-acts a')!;expect(link.getAttribute('href')).toContain('item-authority');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it.each(['empty-user','reasoning-only','unknown-item'] as const)('keeps honest ordinary node presence for %s without aggregate fallback',async mode=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const SavedWindowContent=IssuedWindowContent;
    const row:import('../../../data/src/protocol').HistoryItem={node_id:'quiet-node',kind:mode==='empty-user'?'user':'assistant_response',excerpt:'Forbidden private aggregate fallback',selection:{ordinal:0},items:mode==='empty-user'?[]:mode==='reasoning-only'?[{item_identity:'r',kind:'reasoning_unavailable'}]:[{item_identity:'unknown',kind:'unavailable',reason:'opaque'}]};
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={{rows:[row],range:{first:0,last:0},total:1,revision:1,generation:1,epoch:1,disposed:false,pending:false}}/>,host));
    expect(host.querySelector('[data-node="quiet-node"]')).not.toBeNull();expect(host.textContent).toContain(mode==='unknown-item'?'opaque':fixture.model.t.value(mode==='reasoning-only'?'work.reasoning':'work.textUnavailable'));
    expect(host.textContent).not.toContain('Forbidden');expect(host.querySelector('.more')).toBeNull();
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});


it('retains a no-execution tool as a visible unavailable item without inventing execution identity',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedConversationItems }=await import('../screens/Conversation');
    const projection=projectSavedItems(normalizeConversationFacts([{nodeId:'no-exec',itemIdentity:'tool',windowRevision:1,kind:'tool',executionIds:[]}]));
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={projection}/>,host));
    expect(host.querySelectorAll('[data-item-key]')).toHaveLength(1);expect(host.querySelector('[data-execution-id]')).toBeNull();
    const heading=host.querySelector('summary[data-work-heading]')!;expect(heading.textContent).toContain(fixture.model.t.value('tools.count',{n:1}));expect(heading.textContent).not.toContain(fixture.model.t.value('work.textUnavailable'));expect(heading.textContent).not.toContain(fixture.model.t.value('status.completed'));
    const details=host.querySelector('details')!;await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
    expect(host.querySelector('[data-execution-unavailable]')?.textContent).toContain(fixture.model.t.value('work.textUnavailable'));expect(host.querySelector('[data-execution-unavailable]')?.closest('[data-work-group]')).toBe(details);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('bounds output watches to opened tool details and preserves item DOM when membership changes',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  const original=fixture.model.watchOutput.bind(fixture.model);let active=0,maximum=0;
  fixture.model.watchOutput=()=>{active++;maximum=Math.max(maximum,active);return()=>{active--;};};
  try{
    const { SavedConversationItems }=await import('../screens/Conversation');
    const step=fixture.model.conversation.value.flatMap(row=>row.type==='steps'?row.steps:[])[0]!;
    expect(step).toBeDefined();fixture.model.toolStepChoices.value=new Map([[step.executionId,true]]);
    const source={nodeId:'watch-node',itemIdentity:'watch-item',windowRevision:1,kind:'tool' as const,executionIds:[step.executionId]};
    const projection=(await import('../../../ui-core/src/conversation-items')).projectLegacyHistoryItems({nodes:[{node_id:source.nodeId,kind:'assistant_response',items:[{item_identity:source.itemIdentity,kind:'tool_call',execution_ids:source.executionIds}],executions:[{execution_id:step.executionId,command_excerpt:step.command,state:step.state}]}]}).projection;
    const paint=async(p:typeof projection)=>act(async()=>render(<SavedConversationItems model={fixture.model} projection={p}/>,host));
    await paint(projection);const item=host.querySelector('[data-item-key]')!,parent=item.parentElement;
    expect(active).toBe(0);
    for(let i=0;i<3;i++){
      const details=host.querySelector('details.step-group')! as HTMLDetailsElement;
      await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});expect(active).toBe(1);
      await act(async()=>{details.open=false;details.dispatchEvent(new Event('toggle'));});expect(active).toBe(0);
    }
    const details=host.querySelector('details.step-group')! as HTMLDetailsElement;
    await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});expect(active).toBe(1);
    await paint(projectSavedItems(normalizeConversationFacts([{...source,nodeId:'preceding',itemIdentity:'preceding',executionIds:['other-execution']},source])));
    expect(active).toBe(0);const replacement=[...host.querySelectorAll('[data-item-key]')].find(el=>el.getAttribute('data-item-key')===projection.items[0]!.key)!;
    expect(replacement).not.toBe(item);expect((replacement.closest('details') as HTMLDetailsElement).open).toBe(false);expect(maximum).toBe(1);
  }finally{render(null,host);expect(active).toBe(0);fixture.model.watchOutput=original;host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('does not claim completion for a closed local summary mixing proved and no-ID members',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedConversationItems }=await import('../screens/Conversation');
    const step=fixture.model.conversation.value.flatMap(row=>row.type==='steps'?row.steps:[])[0]!;
    const projection=projectSavedItems([{nodeId:'mixed-summary',itemIdentity:'known',windowRevision:1,kind:'tool',executionIds:[step.executionId]},{nodeId:'mixed-summary',itemIdentity:'unknown',windowRevision:1,kind:'tool',executionIds:[]}]);
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={projection}/>,host));
    const details=host.querySelector('details[data-work-group]')! as HTMLDetailsElement,heading=details.querySelector('summary')!;
    expect(details.open).toBe(false);expect(heading.textContent).toContain(fixture.model.t.value('tools.count',{n:2}));
    expect(heading.textContent).not.toContain(fixture.model.t.value('work.textUnavailable'));expect(heading.querySelector('[data-status="completed"]')).toBeNull();
    expect([...host.querySelectorAll('[data-item-key]')].every(item=>item.closest('[data-work-group]')===details)).toBe(true);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('contains saved Work in actual group parents even for a singleton and never drops thinking records',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const SavedWindowContent=IssuedWindowContent;
    const rows:import('../../../data/src/protocol').HistoryItem[]=[
      {node_id:'work-a',kind:'assistant_response',selection:{ordinal:0},items:[{item_identity:'think',kind:'reasoning_unavailable'},{item_identity:'tool',kind:'tool_call',execution_ids:[]}]},
      {node_id:'conversation',kind:'assistant_response',selection:{ordinal:1},items:[{item_identity:'text',kind:'text',text:'Authoritative answer',text_complete:true}]},
      {node_id:'work-b',kind:'assistant_response',selection:{ordinal:2},items:[{item_identity:'unknown',kind:'unavailable',reason:'unsupported'}]},
    ];
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={{rows,range:{first:0,last:2},total:3,revision:1,generation:1,epoch:1,disposed:false,pending:false}}/>,host));
    const groups=[...host.querySelectorAll('[data-work-group]')];expect(groups).toHaveLength(2);
    expect(host.querySelectorAll('[data-work-item-key]')).toHaveLength(3);
    for(const item of host.querySelectorAll('[data-work-item-key]'))expect(item.closest('[data-work-group]')).not.toBeNull();
    expect(host.querySelector('[data-thinking-marker]')).not.toBeNull();
    expect(host.querySelector('[data-node="conversation"]')?.closest('[data-work-group]')).toBeNull();
    expect(groups.every(group=>(group as HTMLDetailsElement).open===false)).toBe(true);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it.each(['live-only','mixed'] as const)('contains all %s Work facts and keeps authoritative live text outside Work',async mode=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const SavedWindowContent=IssuedWindowContent;
    const { normalizeLiveWorkFacts }=await import('../../../ui-core/src/conversation-items');
    const rows:import('../../../data/src/protocol').HistoryItem[]=mode==='mixed'?[{node_id:'saved-work',kind:'assistant_response',selection:{ordinal:0},items:[{item_identity:'thinking',kind:'reasoning_unavailable'}]}]:[];
    const liveFacts=[...normalizeLiveWorkFacts({scope:'synthetic-scope',items:[{kind:'shell',id:'shell-record',state:'running',thread_id:'synthetic-scope',execution_id:'actual-exec'},{kind:'pending_message',id:'pending',state:'pending',thread_id:'synthetic-scope',message_id:'pending-message'},{kind:'progress',id:'progress-record',state:'running',thread_id:'synthetic-scope'}]}),{domain:'live' as const,namespace:'handoff' as const,scope:'synthetic-scope',recordId:'actual-stream-record',kind:'text' as const,text:'Authoritative live nonreasoning text'}];
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={{rows,range:{first:0,last:rows.length-1},total:rows.length,revision:1,generation:1,epoch:1,disposed:false,pending:false}} liveFacts={liveFacts}/>,host));
    const members=[...host.querySelectorAll('[data-work-item-key]')];expect(members).toHaveLength(mode==='mixed'?3:2);
    for(const item of members)expect(item.closest('details[data-work-group]')).not.toBeNull();
    expect(host.querySelectorAll('[data-work-group]')).toHaveLength(mode==='mixed'?2:1);
    expect(host.textContent).toContain('Authoritative live nonreasoning text');
    expect(host.querySelector('[data-live-overlay]')?.closest('[data-work-group]')).toBeNull();
    expect([...host.querySelectorAll('[data-item-key]')].some(item=>item.getAttribute('data-item-key')?.includes('pending'))).toBe(false);
    expect((host.querySelector('details[data-work-group]') as HTMLDetailsElement).open).toBe(false);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});


it('admits text only from never-ready owned ledger records, not ready or identified bodies after status changes',async()=>{
  const { Handoff }=await import('../../../data/src/handoff');
  const { projectOwnedHandoffFacts }=await import('../screens/Conversation');
  const scheduled:(()=>void)[]=[];const ledger=new Handoff(callback=>scheduled.push(callback));
  const begin=(id:string)=>{ledger.apply({attempt_id:id,gap:false,deltas:[{offset:0,reasoning:false,text:'Synthetic stream text'}]});while(scheduled.length)scheduled.shift()!();};
  const fact=(id:string)=>projectOwnedHandoffFacts('owned-scope',ledger.records.value).find(item=>'domain' in item&&item.recordId===`handoff:${id}`)!;
  begin('stream');expect(fact('stream').kind).toBe('text');expect(fact('stream')).toMatchObject({attemptId:'stream'});expect('turnId' in fact('stream')).toBe(false);
  ledger.ready('stream','saved-node','Forbidden ready replacement');expect(fact('stream').kind).toBe('unknown');
  ledger.fail('stream');expect(fact('stream').kind).toBe('unknown');
  ledger.confirming('stream');expect(fact('stream').kind).toBe('unknown');
  begin('identified');ledger.identify('identified','reserved-node');expect(fact('identified').kind).toBe('unknown');
  expect(projectOwnedHandoffFacts('owned-scope',ledger.records.value).some(item=>'text' in item&&item.text.includes('Forbidden'))).toBe(false);
  ledger.discard('ended');
});

it('retains the actual response budget reason in closed and open saved Work without aggregate fallback',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const SavedWindowContent=IssuedWindowContent;
    const rows:import('../../../data/src/protocol').HistoryItem[]=[{node_id:'budget-reason',kind:'assistant_response',excerpt:'Forbidden deferred aggregate',selection:{ordinal:0},items:null,items_unavailable_reason:'response_budget'}];
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={{rows,range:{first:0,last:0},total:1,revision:1,generation:1,epoch:1,disposed:false,pending:false}}/>,host));
    const details=host.querySelector('details[data-work-group]')! as HTMLDetailsElement;
    expect(details.open).toBe(false);expect(details.querySelector('summary')?.textContent).not.toContain('response_budget');
    expect(host.textContent).not.toContain('Forbidden');
    await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
    expect(details.querySelector('[data-items-unavailable-reason="response_budget"]')).not.toBeNull();
    expect(details.textContent).toContain('response_budget');expect(details.textContent).not.toContain('Forbidden');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('renders actual incomplete and qualified retry state without granting ready text live authority',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const screen=await import('../screens/Conversation') as unknown as Record<string,any>;
    expect(screen.LiveRecordChrome).toBeTypeOf('function');
    const { Handoff }=await import('../../../data/src/handoff');const callbacks:(()=>void)[]=[];
    const ledger=new Handoff(callback=>callbacks.push(callback));
    ledger.apply({attempt_id:'chrome',gap:true,deltas:[{offset:0,reasoning:false,text:'Stream body'}]});while(callbacks.length)callbacks.shift()!();
    ledger.fail('chrome');const record=ledger.records.value[0]!;let retries=0;
    const qualifiedModel=new Proxy(fixture.model,{get(target,key){return key==='handle'?{value:{handoffRetryState:{value:{phase:'failed',reason:'lookup-failed',canRetry:true}},retryHandoff:async()=>{retries++;}}}:Reflect.get(target,key);}});
    await act(async()=>render(<screen.LiveRecordChrome model={qualifiedModel} record={record} retry={()=>{throw Error('unqualified retry callback');}}/>,host));
    expect(host.textContent).toContain(fixture.model.t.value('convo.liveIncomplete'));
    expect(host.textContent).toContain(fixture.model.t.value('convo.retry.lookup-failed'));
    expect(host.textContent).not.toContain(fixture.model.t.value('convo.handoffLimit'));
    const retry=host.querySelector('button')!;expect(retry.textContent).toContain(fixture.model.t.value('action.retry'));
    await act(async()=>{retry.dispatchEvent(new MouseEvent('click',{bubbles:true}));});expect(retries).toBe(1);
    expect(host.textContent).not.toContain('Stream body');expect(host.querySelector('[role="status"]')).toBeNull();
    ledger.discard('ended');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('keeps one identical footer element through known states and unknown loading or disconnected frames',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const screen=await import('../screens/Conversation') as unknown as Record<string,any>;
    expect(screen.ConversationStatus).toBeTypeOf('function');
    const base=fixture.model.selectedRow.value!;const selected=signal<typeof fixture.model.selectedRow.value>(base);
    const model=new Proxy(fixture.model,{get(target,key){return key==='selectedRow'?selected:key==='threadReplies'?{value:[]}:Reflect.get(target,key);}});
    let original:Element|undefined;
    for(const state of ['idle',undefined,'running',undefined,'completed',undefined,'idle'] as const){
      selected.value=state?{...base,status:state}:undefined;
      await act(async()=>render(<screen.ConversationStatus model={model}/>,host));
      const footer=host.querySelector('.conversation-status')!;expect(footer).not.toBeNull();
      if(original)expect(footer).toBe(original);else original=footer;
      expect(host.querySelectorAll('.conversation-status')).toHaveLength(1);
      if(!state){expect(footer.textContent?.trim()).toBe('');expect(footer.querySelector('img,button')).toBeNull();}
    }
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('publishes saved rows and whole-attempt retirement in the same DOM frame, retaining partial and invalid-scope overlays',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const SavedWindowContent=IssuedWindowContent;
    const scope='owner-thread-lifetime';let current:object;let publication:{reader:ConversationWindow;snapshot:WindowAcceptedSnapshot}|undefined;
    const model=new Proxy(fixture.model,{get(target,key){
      if(key==='handle')return {value:{threadId:'thread',handoffScope:()=>scope,handoff:{value:[]},handoffOverflow:{value:false},work:{value:{}}}};
      if(key==='longReader')return {value:{acceptedView:{isCurrent:(ref:object)=>ref===current}}};
      return Reflect.get(target,key);
    }});
    const liveFacts=[{domain:'live' as const,scope:'thread',recordId:'live-text',kind:'text' as const,text:'Whole live answer',attemptId:'attempt',turnId:'turn'},...normalizeLiveWorkFacts({scope:'thread',items:[{kind:'progress',id:'live-work',thread_id:'thread',state:'running',attempt_id:'attempt',turn_id:'turn'}]})];
    const independent:import('../../../data/src/protocol').HistoryItem={node_id:'independent',kind:'user',selection:{ordinal:0},items:[{item_identity:'text',kind:'text',text:'Independent user',text_complete:true}]};
    const saved:import('../../../data/src/protocol').HistoryItem={node_id:'saved-answer',kind:'assistant_response',selection:{ordinal:1},items:[{item_identity:'answer',kind:'text',text:'Committed saved answer',text_complete:true}]};
    const base={range:{first:0,last:1},revision:7,generation:1,epoch:1,disposed:false,pending:false};
    const frames=[
      {...base,rows:[independent],total:1},
      {...base,rows:[independent,{...saved,items:null,items_unavailable_reason:'response_budget' as const}],total:2},
      {...base,rows:[independent,saved],total:2,retiredAttempts:[{scope:'other-lifetime',attemptId:'attempt',turnId:'turn',nodeIds:['saved-answer'],revision:7}]},
      {...base,rows:[independent,saved],total:2,retiredAttempts:[{scope,attemptId:'attempt',turnId:'other-turn',nodeIds:['saved-answer'],revision:7}]},
      {...base,rows:[independent,saved],total:2,retiredAttempts:[{scope,attemptId:'attempt',turnId:'turn',nodeIds:['saved-answer'],revision:7}]},
    ];
    for(let i=0;i<frames.length;i++){
      current=frames[i]!;await act(async()=>render(<SavedWindowContent model={model} snapshot={frames[i]!} onIssued={(reader,snapshot)=>{publication={reader,snapshot};}} liveFacts={liveFacts}/>,host));
      expect(host.textContent).toContain('Independent user');
      expect(host.textContent?.includes('Whole live answer')).toBe(i!==4);
      expect(host.querySelectorAll('[data-work-item-key]').length).toBe(i===4?0:i===1?2:1);
      if(i>=2)expect(host.textContent).toContain('Committed saved answer');
    }
    const revoked=publication!;
    revoked.reader.dispose();
    expect(revoked.reader.acceptedView.isCurrent(revoked.snapshot)).toBe(false);
    const {retainUnretiredLiveFacts}=await import('../screens/Conversation');
    // Revocation cannot consume the overlay; it also cannot authorize stale public DOM.
    expect(retainUnretiredLiveFacts(revoked.snapshot,scope,false,liveFacts)).toEqual(liveFacts);
    const revokedModel=new Proxy(model,{get(target,key){return key==='longReader'?{value:revoked.reader,peek:()=>revoked.reader}:Reflect.get(target,key);}});
    await act(async()=>render(<ActualSavedWindowContent model={revokedModel} snapshot={revoked.snapshot} liveFacts={liveFacts}/>,host));
    expect(host.textContent).not.toContain('Whole live answer');expect(host.textContent).not.toContain('Committed saved answer');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('retains the actual tool element and open group when thinking prepends under a scoped first-tool identity',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedConversationItems }=await import('../screens/Conversation');
    const tool={nodeId:'actual-tool-node',itemIdentity:'actual-tool-item',windowRevision:1,kind:'tool' as const,executionIds:['exec-structural'],keyScope:['actual-owner','actual-thread']};
    const before=projectSavedItems([tool]);
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={before}/>,host));
    const group=host.querySelector('details[data-work-group]')! as HTMLDetailsElement;
    await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
    const item=host.querySelector('[data-work-item-key]')!;
    const after=projectSavedItems([{nodeId:'thinking-node',itemIdentity:'thinking',windowRevision:1,kind:'reasoning_unavailable',keyScope:tool.keyScope},tool]);
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={after}/>,host));
    expect(host.querySelector('details[data-work-group]')).toBe(group);expect(group.open).toBe(true);
    expect([...host.querySelectorAll('[data-work-item-key]')].find(el=>el.getAttribute('data-item-key')===before.items[0]!.key)).toBe(item);
    expect(item.getAttribute('data-node')).toBe('actual-tool-node');
    expect(host.querySelector('[data-thinking-marker]')).not.toBeNull();
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('defaults a running structural tool detail to closed without subscribing output',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  let watches=0;const watch=fixture.model.watchOutput.bind(fixture.model);fixture.model.watchOutput=()=>{watches++;return()=>{watches--;};};
  try{
    const { StepView }=await import('../screens/Conversation');
    const base=fixture.model.conversation.value.flatMap(row=>row.type==='steps'?row.steps:[])[0]!;
    const {projectLegacyHistoryItems}=await import('../../../ui-core/src/conversation-items');
    const {workElementDisplay}=await import('../../../ui-core/src/work-element-display');
    const issued=projectLegacyHistoryItems({nodes:[{node_id:'controlled-tool',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'call',execution_ids:[base.executionId]}],executions:[{execution_id:base.executionId,state:'running',command_excerpt:base.command}]}]}).projection.items[0]!;
    const display=workElementDisplay(issued)!;
    await act(async()=>render(<StepView model={fixture.model} step={{...base,status:'running'}} display={display}/>,host));
    expect((host.querySelector('details.work-element-row') as HTMLDetailsElement).open).toBe(false);expect(watches).toBe(0);
  }finally{render(null,host);fixture.model.watchOutput=watch;host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('keeps typed assistant empty/presence membership distinct across live, terminal, saved, refresh and revoke',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 type Node=import('../../../data/src/protocol').HistoryItem;
 const old:Node={node_id:'prior-answer',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'text',item_identity:'prior',text:'Already readable answer',text_complete:true}]};
 let nodes:Node[]=[old],revision=1;
 const reader=new ConversationWindow({read:async()=>({ok:true,value:{thread_id:'t',revision,total:nodes.length,items:nodes}})});
 const model=new Proxy(f.model,{get(target,key){return key==='longReader'?{value:reader,peek:()=>reader}:Reflect.get(target,key);}});
 let live:import('../../../ui-core/src/conversation-items').NormalizedSavedItem[]=[];
 const frames:unknown[]=[];
 const paint=()=>{const snapshot=reader.acceptedView.peek();render(<ActualSavedWindowContent model={model} snapshot={snapshot} liveFacts={[...live]}/>,host);};
 let stop=()=>{};
 try{
  await act(async()=>{await Promise.resolve();await Promise.resolve();paint();});
  const oldElement=host.querySelector('[data-node="prior-answer"]');expect(oldElement).not.toBeNull();
  const record=(text:string)=>({domain:'live' as const,namespace:'handoff' as const,scope:'t',recordId:'stable-live',kind:'text' as const,text});
  const frame=async(label:string)=>{
   await act(async()=>paint());
   frames.push({frame:frames.length,label,current:reader.acceptedView.isCurrent(reader.acceptedView.peek()),messages:host.querySelectorAll('.msg').length,presence:host.querySelectorAll('[data-assistant-presence]').length,keys:[...host.querySelectorAll('[data-item-key]')].map(row=>row.getAttribute('data-item-key'))});
   expect(host.querySelector('[data-node="prior-answer"]')).toBe(oldElement);
  };
  live=[record('')];await frame('empty-live');expect(host.querySelectorAll('.msg')).toHaveLength(1);expect(host.querySelector('[data-assistant-presence]')?.textContent).toContain(f.model.t.value('convo.live'));
  const liveRow=host.querySelector('[data-assistant-presence]')!.closest('[data-item-key]');
  live=[record('New live answer')];await frame('live-text');expect(host.querySelectorAll('.msg')).toHaveLength(2);expect(host.querySelector('[data-live-overlay]')?.closest('[data-item-key]')).toBe(liveRow);
  live=[];await frame('terminal-live-off');expect(host.textContent).not.toContain('New live answer');
  stop=reader.acceptedView.subscribe(()=>paint());
  nodes=[old,{node_id:'saved-answer',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'saved',text:'Saved readable answer',text_complete:true}]},{node_id:'empty-complete',kind:'assistant_response',selection:{ordinal:2},items:[{kind:'text',item_identity:'empty',text:'',text_complete:true}]},{node_id:'empty-partial',kind:'assistant_response',selection:{ordinal:3},items:[{kind:'text',item_identity:'partial',text:'',text_complete:false}]}];revision++;
  await act(async()=>{reader.changed();await new Promise(resolve=>setTimeout(resolve,0));});await frame('saved');
  expect(host.querySelector('[data-node="empty-complete"]')).toBeNull();expect(host.querySelector('[data-assistant-content-unavailable]')).not.toBeNull();expect(host.querySelectorAll('.msg')).toHaveLength(2);
  const saved=host.querySelector('[data-node="saved-answer"]');await act(async()=>{reader.changed();await new Promise(resolve=>setTimeout(resolve,0));});await frame('refresh');expect(host.querySelector('[data-node="saved-answer"]')).toBe(saved);
  await act(async()=>{reader.dispose();paint();});expect(host.textContent).not.toContain('Already readable answer');expect(host.textContent).not.toContain('Saved readable answer');
 }finally{console.log('ASSISTANT_MEMBERSHIP_FRAMES',JSON.stringify(frames));stop();render(null,host);reader.dispose();host.remove();f.model.dispose();f.data.stop();}
});

it('publishes a newly appended readable assistant after a hint held during path recovery without another input',async()=>{
 const {rig}=await import('../../../ui-core/test/window-owner');
 const r=await rig(1),f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 const frames:unknown[]=[];
 r.owner.decorate=(i,node)=>({...node,kind:'assistant_response',items:[{kind:'text',item_identity:`body-${i}`,text:i===0?'Recovered prior answer':'New completed answer',text_complete:true}]});
 const model=new Proxy(f.model,{get(target,key){return key==='longReader'?{value:r.w,peek:()=>r.w}:Reflect.get(target,key);}});
 const paint=()=>{
  const snapshot=r.w.acceptedView.peek();
  render(<ActualSavedWindowContent model={model} snapshot={snapshot} liveFacts={[]}/>,host);
  frames.push({frame:frames.length,current:r.w.acceptedView.isCurrent(snapshot),raw:snapshot.rows.map(row=>row.node_id),mounted:[...host.querySelectorAll('[data-node]')].map(row=>row.getAttribute('data-node')),reads:r.calls().length});
 };
 const stop=r.w.acceptedView.subscribe(paint);
 try{
  await act(async()=>{await r.settle();paint();});expect(host.textContent).toContain('Recovered prior answer');
  const prior=r.w.acceptedView.peek();
  r.owner.rewrite(1);
  await act(async()=>{r.w.changed();await flush();});
  const stale=r.calls().at(-1)!,rejected=r.owner.answer(stale);expect(rejected.ok).toBe(false);
  r.owner.answered.add(stale.id);
  await act(async()=>{if(!rejected.ok)r.t.ownerError(stale.id,rejected.code,rejected.code,rejected.details);await flush();});
  expect(r.w.acceptedView.isCurrent(prior)).toBe(false);expect(host.textContent).not.toContain('Recovered prior answer');
  const recovery=r.calls().at(-1)!,oldReply=r.owner.answer(recovery);expect(oldReply.ok).toBe(true);
  r.owner.append(1);
  await act(async()=>{r.w.changed();await flush();});const before=r.calls().length;
  r.owner.answered.add(recovery.id);
  await act(async()=>{if(oldReply.ok)r.t.ok(recovery.id,oldReply.result);await flush();});
  expect(r.calls().length).toBeGreaterThan(before);
  await act(async()=>{await r.settle();paint();});
  expect(host.textContent).toContain('Recovered prior answer');expect(host.textContent).toContain('New completed answer');
  expect(r.w.acceptedView.isCurrent(r.w.acceptedView.peek())).toBe(true);
  expect(host.querySelector('[data-node="n1-1"] .md')?.textContent).toContain('New completed answer');
 }finally{console.log('RECOVERY_HINT_FRAMES',JSON.stringify(frames));stop();render(null,host);host.remove();r.w.dispose();r.data.stop();f.model.dispose();f.data.stop();}
});
