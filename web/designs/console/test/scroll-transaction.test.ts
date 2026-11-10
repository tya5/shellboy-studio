import { expect, it, vi } from 'vitest';
import { CurrentScrollSync, type ScrollSyncEffects, type ScrollViewPort } from '../screens/scrollTransaction';
function rig() {
  let ref: object=Object.freeze({generation:1});
  const request=Object.freeze({id:Object.freeze({}),target:42});
  let pending=true;
  const port: ScrollViewPort<object>={acceptedView:{peek:()=>ref,isCurrent:token=>token===ref},
    peekScroll:()=>pending?request:undefined,consumeScroll:vi.fn((token,id)=>{
      if(token!==ref||id!==request.id)return false;pending=false;return true;
    })};
  const consume=vi.fn(),write=vi.fn(),capture=vi.fn();
  const effects: ScrollSyncEffects<object>={measure:vi.fn(),plan:vi.fn(()=>({consume,write,capture}))};
  const owner=new CurrentScrollSync();
  return {owner,port,effects,consume,write,capture,request,replace(){ref=Object.freeze({generation:2});},pending:()=>pending};
}
it.each(['replace','cancel','dispose'] as const)('retains all plans when measure synchronously causes %s',reason=>{
  const r=rig();r.effects.measure=()=>{if(reason==='replace')r.replace();else r.owner[reason]();};
  expect(r.owner.run(r.port,r.effects)).not.toBe('committed');
  expect(r.pending()).toBe(true);expect(r.consume).not.toHaveBeenCalled();
  expect(r.write).not.toHaveBeenCalled();expect(r.capture).not.toHaveBeenCalled();
  expect(r.port.consumeScroll).not.toHaveBeenCalled();
});
it('does not consume request or heading when non-consuming plan measurement becomes obsolete',()=>{
  const r=rig();r.effects.plan=()=>{r.replace();return {consume:r.consume,write:r.write,capture:r.capture};};
  expect(r.owner.run(r.port,r.effects)).not.toBe('committed');
  expect(r.port.consumeScroll).not.toHaveBeenCalled();expect(r.consume).not.toHaveBeenCalled();
});
it('keeps only one current writer and coalesces a reentrant attempt',()=>{
  const r=rig();let entered=false;let nested:unknown;
  r.effects.measure=()=>{if(!entered){entered=true;nested=r.owner.run(r.port,r.effects);}};
  r.owner.run(r.port,r.effects);
  expect(nested).toBe('busy');expect(r.write).not.toHaveBeenCalled();
  expect(r.owner.takeResync()).toBe(true);expect(r.owner.takeResync()).toBe(false);
});
it('commits once with stable ref and leaves no resync work',()=>{
  const r=rig(),ref=r.port.acceptedView.peek();
  expect(r.owner.run(r.port,r.effects)).toBe('committed');
  expect(r.pending()).toBe(false);expect(r.consume).toHaveBeenCalledTimes(1);
  expect(r.write).toHaveBeenCalledTimes(1);expect(r.capture).toHaveBeenCalledTimes(1);
  expect(r.port.acceptedView.peek()).toBe(ref);expect(r.owner.takeResync()).toBe(false);
});
it('false request commit preserves G-owned resources',()=>{
  const r=rig();r.port.consumeScroll=()=>false;
  expect(r.owner.run(r.port,r.effects)).toBe('rejected');
  expect(r.pending()).toBe(true);expect(r.consume).not.toHaveBeenCalled();
  expect(r.write).not.toHaveBeenCalled();expect(r.capture).not.toHaveBeenCalled();
});
it('dispose cancels a pending resync and prevents any later measurement',()=>{
  const r=rig();r.owner.dispose();
  expect(r.owner.run(r.port,r.effects)).toBe('disposed');
  expect(r.effects.measure).not.toHaveBeenCalled();expect(r.owner.takeResync()).toBe(false);
});
it('skips stale capture when the single program write synchronously replaces the view',()=>{
  const r=rig();r.write.mockImplementation(()=>r.replace());
  expect(r.owner.run(r.port,r.effects)).toBe('obsolete');
  expect(r.write).toHaveBeenCalledTimes(1);expect(r.capture).not.toHaveBeenCalled();
  expect(r.owner.takeResync()).toBe(true);
});
it('cancel invalidates only the old transaction and a later explicit sync can commit',()=>{
  const r=rig();let cancel=true;
  r.effects.measure=()=>{if(cancel){cancel=false;r.owner.cancel();}};
  expect(r.owner.run(r.port,r.effects)).toBe('obsolete');
  expect(r.pending()).toBe(true);expect(r.owner.takeResync()).toBe(false);
  expect(r.owner.run(r.port,r.effects)).toBe('committed');
  expect(r.write).toHaveBeenCalledTimes(1);
});
it('does not retain a writer lock when measurement throws',()=>{
  const r=rig();r.effects.measure=()=>{throw new Error('synthetic measure failure');};
  expect(()=>r.owner.run(r.port,r.effects)).toThrow('synthetic measure failure');
  expect(r.pending()).toBe(true);r.effects.measure=()=>{};
  expect(r.owner.run(r.port,r.effects)).toBe('committed');
});
