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
