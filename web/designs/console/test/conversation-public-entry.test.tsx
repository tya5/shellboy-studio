// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect, it } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { projectSavedItems } from '../../../ui-core/src/conversation-items';

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
    const { SavedWindowContent }=await import('../screens/Conversation');
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


it.each(['empty', 'reasoning', 'deferred', 'undefined', 'empty-window'] as const)('places live chrome exactly once with %s boundary input',async mode=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedWindowContent }=await import('../screens/Conversation');
    const rows:import('../../../data/src/protocol').HistoryItem[]=mode==='empty-window'?[]:[
      {node_id:'boundary-node',kind:'assistant_response',selection:{ordinal:1},...(mode==='deferred'?{items:null,items_unavailable_reason:'response_budget' as const}:{items:mode==='reasoning'?[{item_identity:'reasoning',kind:'reasoning_unavailable' as const}]:[]})},
      {node_id:'later-human',kind:'user',excerpt:'Later human',selection:{ordinal:2}},
    ];
    const snapshot={rows,range:{first:0,last:2},total:rows.length,revision:1,generation:1,epoch:1,disposed:false,pending:false};
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={snapshot} liveBoundary={mode==='undefined'?undefined:1} live={<span>Synthetic live boundary answer</span>}/>,host));
    expect(host.querySelectorAll('[data-live-overlay]')).toHaveLength(1);
    if(mode!=='empty-window'){
      const content=host.textContent!;
      if(mode==='undefined')expect(content.indexOf('Later human')).toBeLessThan(content.indexOf('Synthetic live boundary answer'));
      else expect(content.indexOf('Synthetic live boundary answer')).toBeLessThan(content.indexOf('Later human'));
    }
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});


it('restores authoritative user Message chrome without substituting aggregate text for typed content',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedWindowContent }=await import('../screens/Conversation');
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

it('restores group summary toggle without making keyed tool items heading children or remounting them',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedConversationItems }=await import('../screens/Conversation');
    const projection=projectSavedItems([{nodeId:'group-node',itemIdentity:'tool-1',windowRevision:1,kind:'tool',executionIds:['group-exec-1']},{nodeId:'group-node',itemIdentity:'tool-2',windowRevision:1,kind:'tool',executionIds:['group-exec-2']}]);
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={projection}/>,host));
    const heading=host.querySelector('[data-item-heading]')!,details=heading.querySelector('details.step-group')! as HTMLDetailsElement;
    expect(details).not.toBeNull();expect(details.open).toBe(false);
    const items=[...host.querySelectorAll('[data-item-key]')];expect(items).toHaveLength(2);
    expect(items.every(item=>(item as HTMLElement).hidden)).toBe(true);
    expect(heading.querySelector('[data-item-key]')).toBeNull();
    const parent=items[0]!.parentElement;
    await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
    expect([...host.querySelectorAll('[data-item-key]')]).toEqual(items);
    expect(items.every(item=>item.parentElement===parent&&!(item as HTMLElement).hidden)).toBe(true);
    await act(async()=>{details.open=false;details.dispatchEvent(new Event('toggle'));});
    expect([...host.querySelectorAll('[data-item-key]')]).toEqual(items);expect(items.every(item=>(item as HTMLElement).hidden)).toBe(true);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it.each(['', 'Partial authoritative item'])('never replaces authorized item text %j with a cached aggregate body',async text=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedWindowContent }=await import('../screens/Conversation');
    fixture.model.bodies.value=new Map([['item-authority',{text:'Forbidden cached aggregate body',loading:false,error:undefined}]]);
    const rows:import('../../../data/src/protocol').HistoryItem[]=[{node_id:'item-authority',kind:'user',provenance:{sender:{kind:'human'}},excerpt:'Forbidden aggregate excerpt',selection:{ordinal:0},items:[{item_identity:'text',kind:'text',text,text_complete:false}]}];
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={{rows,range:{first:0,last:0},total:1,revision:1,generation:1,epoch:1,disposed:false,pending:false}}/>,host));
    expect(host.textContent).not.toContain('Forbidden');expect(host.querySelector('.more')).toBeNull();
    expect(host.querySelector('[data-item-partial]')).not.toBeNull();
    expect(host.querySelector('.msg .md')?.textContent??'').toBe(text);
    const link=host.querySelector('.msg-acts a')!;expect(link.getAttribute('href')).toContain('item-authority');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it.each(['empty-user','reasoning-only','unknown-item'] as const)('keeps honest ordinary node presence for %s without aggregate fallback',async mode=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedWindowContent }=await import('../screens/Conversation');
    const row:import('../../../data/src/protocol').HistoryItem={node_id:'quiet-node',kind:mode==='empty-user'?'user':'assistant_response',excerpt:'Forbidden private aggregate fallback',selection:{ordinal:0},items:mode==='empty-user'?[]:mode==='reasoning-only'?[{item_identity:'r',kind:'reasoning_unavailable'}]:[{item_identity:'unknown',kind:'unavailable',reason:'opaque'}]};
    await act(async()=>render(<SavedWindowContent model={fixture.model} snapshot={{rows:[row],range:{first:0,last:0},total:1,revision:1,generation:1,epoch:1,disposed:false,pending:false}}/>,host));
    expect(host.querySelector('[data-node="quiet-node"]')).not.toBeNull();expect(host.textContent).toContain(fixture.model.t.value('work.textUnavailable'));
    expect(host.textContent).not.toContain('Forbidden');expect(host.querySelector('.more')).toBeNull();
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});


it('retains a no-execution tool as a visible unavailable item without inventing execution identity',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedConversationItems }=await import('../screens/Conversation');
    const projection=projectSavedItems([{nodeId:'no-exec',itemIdentity:'tool',windowRevision:1,kind:'tool',executionIds:[]}]);
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={projection}/>,host));
    expect(host.querySelectorAll('[data-item-key]')).toHaveLength(1);expect(host.querySelector('[data-execution-id]')).toBeNull();
    const heading=host.querySelector('[data-item-heading]')!;expect(heading.textContent).toContain(fixture.model.t.value('tools.count',{n:1}));expect(heading.textContent).toContain(fixture.model.t.value('work.textUnavailable'));expect(heading.textContent).not.toContain(fixture.model.t.value('status.completed'));
    const details=host.querySelector('details')!;await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
    expect(host.querySelector('[data-execution-unavailable]')?.textContent).toBe(fixture.model.t.value('work.textUnavailable'));
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
    const projection=projectSavedItems([source]);
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
    await paint(projectSavedItems([{...source,nodeId:'preceding',itemIdentity:'preceding',executionIds:['other-execution']},source]));
    expect(active).toBe(0);expect([...host.querySelectorAll('[data-item-key]')].find(el=>el.getAttribute('data-item-key')===projection.items[0]!.key)).toBe(item);
    expect(item.parentElement).toBe(parent);expect((item as HTMLElement).hidden).toBe(true);expect(maximum).toBe(1);
  }finally{render(null,host);expect(active).toBe(0);fixture.model.watchOutput=original;host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('does not claim completion for a closed local summary mixing proved and no-ID members',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedConversationItems }=await import('../screens/Conversation');
    const step=fixture.model.conversation.value.flatMap(row=>row.type==='steps'?row.steps:[])[0]!;
    const projection=projectSavedItems([{nodeId:'mixed-summary',itemIdentity:'known',windowRevision:1,kind:'tool',executionIds:[step.executionId]},{nodeId:'mixed-summary',itemIdentity:'unknown',windowRevision:1,kind:'tool',executionIds:[]}]);
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={projection}/>,host));
    const heading=host.querySelector('[data-item-heading]')!,details=heading.querySelector('details')!;
    expect(details.open).toBe(false);expect(heading.textContent).toContain(fixture.model.t.value('tools.count',{n:2}));
    expect(heading.textContent).toContain(fixture.model.t.value('work.textUnavailable'));expect(heading.querySelector('[data-status="completed"]')).toBeNull();
    expect([...host.querySelectorAll('[data-item-key]')].every(item=>(item as HTMLElement).hidden)).toBe(true);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('contains saved Work in actual group parents even for a singleton and never drops thinking records',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const { SavedWindowContent }=await import('../screens/Conversation');
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
    expect(groups.every(group=>(group.querySelector('details') as HTMLDetailsElement)?.open===false)).toBe(true);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});
