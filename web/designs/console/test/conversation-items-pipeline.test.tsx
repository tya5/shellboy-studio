// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';
import { projectSavedItems, type NormalizedSavedItem, type SavedItemProjection } from '../../../ui-core/src/conversation-items';
import { AcceptedView } from '../../../ui-core/src/accepted-view';
import { ConversationItems } from '../screens/ConversationItems';

type Snapshot = { projection: SavedItemProjection; revision: string; readiness: 'pending'|'ready' };
const tool=(nodeId:string,itemIdentity:string):NormalizedSavedItem=>({nodeId,itemIdentity,revision:'r1',kind:'tool',executionId:`exec-${nodeId}-${itemIdentity}`});
const text=(nodeId:string,itemIdentity:string):NormalizedSavedItem=>({nodeId,itemIdentity,revision:'r1',kind:'text',text:`Synthetic ${nodeId}-${itemIdentity}`});
const key=(item:NormalizedSavedItem)=>JSON.stringify([item.nodeId,item.itemIdentity]);

describe('actual normalized P -> materialized S -> D (not a Core wire adapter)',()=>{
  it('renders exact mixed/cross-node order and retains selection/content parent on accepted prepend and chrome merge/split',async()=>{
    const a=[text('A','0'),tool('A','1')],b=[tool('B','0'),text('B','1'),tool('B','2')];
    const controller=new AcceptedView<Snapshot>({projection:projectSavedItems([...a,...b]),revision:'r1',readiness:'ready'});
    const host=document.createElement('div');document.body.append(host);
    const paint=(snapshot:Snapshot)=>render(<ConversationItems {...snapshot.projection}
      renderHeading={summary=><span>{summary.executionIds.join(',')}</span>}
      renderItem={item=>item.source.kind==='text'?<span>{item.source.text}</span>:<code>{item.source.executionId}</code>}/>,host);
    const unsubscribe=controller.subscribe(paint);
    try{
      await act(async()=>paint(controller.current));
      const saved=host.querySelector(`[data-item-key='${key(b[1]!)}']`)!;
      const parent=saved.parentElement,node=saved.querySelector('span')!.firstChild!;
      const selection=window.getSelection()!,range=document.createRange();range.setStart(node,0);range.setEnd(node,9);selection.removeAllRanges();selection.addRange(range);const selected=selection.toString();
      for(const [index,items] of [[0,[tool('P','0'),...a,...b]],[1,[...a,...b]],[2,b]] as const){
        const pending=controller.stage({projection:projectSavedItems([...items]),revision:`r${index+2}`,readiness:'ready'});
        await act(async()=>{expect(controller.commit(pending)).toBe(true);});
        expect([...host.querySelectorAll('[data-item-key]')].map(el=>el.getAttribute('data-item-key'))).toEqual(items.map(key));
        expect(host.querySelector(`[data-item-key='${key(b[1]!)}']`)).toBe(saved);expect(saved.parentElement).toBe(parent);
        expect(selection.anchorNode).toBe(node);expect(selection.toString()).toBe(selected);
        expect([...host.querySelectorAll('[data-item-heading]')].every(heading=>!heading.querySelector('[data-item-key]'))).toBe(true);
        expect(controller.isCurrent(controller.current)).toBe(true);expect(Object.isFrozen(controller.current.projection.items)).toBe(true);
        expect(host.querySelector('[data-node-container]')).toBeNull();
      }
      selection.removeAllRanges();
    }finally{unsubscribe();controller.dispose();render(null,host);host.remove();}
  });
  it('does not publish staged readiness/revision and rejects a revoked late replacement',()=>{
    const controller=new AcceptedView<Snapshot>({projection:projectSavedItems([text('A','0')]),revision:'r1',readiness:'pending'});
    const old=controller.current,seen:Snapshot[]=[];controller.subscribe(value=>seen.push(value));
    const staged=controller.stage({projection:projectSavedItems([tool('B','0')]),revision:'r2',readiness:'ready'});
    expect(controller.current).toBe(old);expect(controller.current.readiness).toBe('pending');
    controller.revoke();expect(controller.commit(staged)).toBe(false);expect(controller.current).toBe(old);expect(seen).toEqual([]);
    const fresh=controller.stage({projection:projectSavedItems([tool('B','0')]),revision:'r3',readiness:'ready'});
    expect(controller.commit(fresh)).toBe(true);expect(controller.current.revision).toBe('r3');expect(controller.current.readiness).toBe('ready');expect(seen).toHaveLength(1);
    controller.dispose();
  });
});
