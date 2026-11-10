// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect,it } from 'vitest';
import { Link } from '../../../data/src/link';
import { Operations } from '../../../data/src/operations';
import { FakeTransport } from '../../../data/test/harness';
import type { HistoryItem } from '../../../data/src/protocol';
import { projectHistoryWindowItems } from '../../../ui-core/src/conversation-items';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { SavedConversationItems } from '../screens/Conversation';

async function decode(rows:readonly HistoryItem[]){
  const transport=new FakeTransport(),link=new Link(transport);link.start();transport.open();
  const pending=new Operations(link,()=> 'proposal').historyWindow({thread_id:'synthetic-thread'});
  transport.ok(transport.calls()[0]!.id,JSON.parse(JSON.stringify({thread_id:'synthetic-thread',revision:7,total:rows.length,items:rows})));
  const result=await pending;link.stop();if(!result.ok)throw new Error(result.error.message);return result.value.items;
}
it.each(['execution','call'] as const)('retains scoped %s identity and open DOM across decoded replacement',async kind=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const step=fixture.model.conversation.value.flatMap(row=>row.type==='steps'?row.steps:[])[0]!;
    const ids=kind==='execution'?[step.executionId]:[];
    const before=await decode([{node_id:'original-node',kind:'assistant_response',selection:{ordinal:0},items:[{item_identity:'tool-item',kind:'tool_call',execution_ids:ids}]}]);
    const after=await decode([{node_id:'spill-node',kind:'spill',selection:{ordinal:0},items:[],spill_tools:{status:'known',truncated:false,items:[{call_id:'synthetic-call',execution_id:ids[0]??null,original_node_id:'original-node'}]}}]);
    const keyScope=['synthetic-owner','synthetic-thread'];
    // Current saved DTO has execution associations but no public call ID.
    const original=kind==='execution'?projectHistoryWindowItems({revision:7,nodes:before,keyScope}).projection:projectHistoryWindowItems({revision:7,nodes:await decode([{...after[0]!,node_id:'prior-spill-node'}]),keyScope}).projection;
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={original}/>,host));
    const group=host.querySelector('details[data-work-group]')! as HTMLDetailsElement;
    await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
    const row=host.querySelector('[data-work-item-key]')!;
    const nested=row.querySelector('details.step') as HTMLDetailsElement|null;
    if(kind==='execution'){expect(nested).not.toBeNull();expect(nested!.open).toBe(false);await act(async()=>{nested!.open=true;nested!.dispatchEvent(new Event('toggle'));});}
    const replaced=projectHistoryWindowItems({revision:7,nodes:after,keyScope}).projection;
    await act(async()=>render(<SavedConversationItems model={fixture.model} projection={replaced}/>,host));
    expect(host.querySelector('details[data-work-group]')).toBe(group);expect(group.open).toBe(true);
    expect(host.querySelector('[data-work-item-key]')).toBe(row);
    if(nested){expect(row.querySelector('details.step')).toBe(nested);expect(nested.open).toBe(true);}
    expect(row.getAttribute('data-node')).toBe('spill-node');
    expect(row.querySelector('[data-tool-call-id="synthetic-call"]')).not.toBeNull();
    expect(row.querySelector('[data-tool-compressed]')?.textContent).toBe('Compressed');
    expect(row.querySelector('[data-tool-detail-unavailable="true"]')).not.toBeNull();
    if(kind==='call'){expect(row.textContent).toContain(fixture.model.t.value('work.unknownTools'));expect(row.textContent).not.toContain(fixture.model.t.value('work.textUnavailable'));}
    expect(row.textContent).not.toContain('original-node');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});
