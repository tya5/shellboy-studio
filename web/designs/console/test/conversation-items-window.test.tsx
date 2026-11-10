// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { expect, it } from 'vitest';
import { AcceptedWindowConversation } from '../screens/Conversation';
import { projectSavedItems, type NormalizedSavedItem } from '../../../ui-core/src/conversation-items';
import { rig } from '../../../ui-core/test/window-owner';

it('consumes actual immutable Window publications without deriving item bodies from wire aggregates',async()=>{
  const r=await rig(3);await r.settle();const host=document.createElement('div');document.body.append(host);
  // Explicit internal fixture normalization keyed by authoritative row ID, not a wire item decoder.
  const known=new Map<string,NormalizedSavedItem[]>();
  for(const row of r.w.acceptedView.peek().rows){if(!row.node_id)throw new Error("Fixture row identity missing");known.set(row.node_id,[
    {nodeId:row.node_id,itemIdentity:'tool',revision:'local-r1',kind:'tool',executionId:`exec-${row.node_id}`},
    {nodeId:row.node_id,itemIdentity:'text',revision:'local-r1',kind:'text',text:`Synthetic ${row.node_id}`},
  ]);}
  const seen:unknown[]=[];
  try{
    await act(async()=>render(<AcceptedWindowConversation reader={r.w.acceptedView} project={snapshot=>{
      seen.push(snapshot);return projectSavedItems(snapshot.rows.flatMap(row=>row.node_id ? known.get(row.node_id)??[] : []));
    }} renderItem={item=>item.source.kind==='text'?item.source.text:item.source.executionId}/>,host));
    const ref=r.w.acceptedView.peek(),first=host.querySelector('[data-item-key]');
    expect(seen.at(-1)).toBe(ref);expect(Object.isFrozen(ref.rows)).toBe(true);
    expect([...host.querySelectorAll('[data-item-key]')].map(el=>el.getAttribute('data-node'))).toEqual(ref.rows.flatMap(row=>[row.node_id,row.node_id]));
    await act(async()=>r.w.layoutChanged());const next=r.w.acceptedView.peek();
    expect(next).not.toBe(ref);expect(seen.at(-1)).toBe(next);expect(host.querySelector('[data-item-key]')).toBe(first);
    expect(host.querySelector('[data-accepted-generation]')?.getAttribute('data-accepted-generation')).toBe(String(next.generation));
    expect(host.querySelector('[data-accepted-revision]')?.getAttribute('data-accepted-revision')).toBe(String(next.revision));
    expect(host.querySelector('[data-readiness]')?.getAttribute('data-readiness')).toBe(next.pending?'pending':'ready');
  }finally{render(null,host);host.remove();r.w.dispose();r.data.stop();}
});

it.each([true,false])('actual tail continuation cannot republish after synchronous same-ref revoke=%s',async revoke=>{
  const r=await rig(3);await r.settle();const host=document.createElement('div');document.body.append(host);
  let revoked:ReturnType<typeof r.w.acceptedView.peek>|undefined;
  const stop=r.w.acceptedView.subscribe(ref=>{if(revoke&&!revoked){revoked=ref;r.w.acceptedView.revoke();}});
  try{
    await act(async()=>render(<AcceptedWindowConversation reader={r.w.acceptedView}
      project={snapshot=>projectSavedItems(snapshot.rows.filter(row=>!!row.node_id).map(row=>({nodeId:row.node_id!,itemIdentity:'local-text',revision:'fixture',kind:'text',text:`Synthetic ${row.node_id}`})))}
      renderItem={item=>item.source.text}/>,host));
    const before=r.w.acceptedView.peek(),generation=host.querySelector('[data-accepted-generation]')!.getAttribute('data-accepted-generation');
    await act(async()=>{r.owner.append(1);r.w.changed();await r.settle();});
    if(revoke){
      expect(revoked).toBeDefined();expect(r.w.acceptedView.peek()).toBe(revoked);
      expect(r.w.acceptedView.isCurrent(revoked!)).toBe(false);
      expect(host.querySelector('[data-accepted-generation]')!.getAttribute('data-accepted-generation')).toBe(generation);
    }else{
      expect(r.w.acceptedView.peek()).not.toBe(before);expect(r.w.acceptedView.peek().total).toBe(4);
      expect(host.querySelector('[data-accepted-generation]')!.getAttribute('data-accepted-generation')).toBe(String(r.w.acceptedView.peek().generation));
    }
  }finally{stop();render(null,host);host.remove();r.w.dispose();r.data.stop();}
});
