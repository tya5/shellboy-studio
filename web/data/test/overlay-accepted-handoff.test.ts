import { expect, it } from 'vitest';
import { createAssociationAuthority, overlayState, reconcileOverlay } from '../src/overlay-reconcile';

// TEST-only materialized S authority fixture, not the unfinished production AcceptedView.
function handoffFixture() {
  const cap=Object.freeze({});const op=Object.freeze({});
  const record=Object.freeze({key:'preview',attemptId:'attempt',text:'sole preview'});
  const other=Object.freeze({key:'other',attemptId:'other-attempt',text:'retained other'});
  const saved=Object.freeze({nodeId:'node',itemIdentity:'item',revision:'revision'});
  const authority=createAssociationAuthority<typeof cap>();
  let state=reconcileOverlay(overlayState(cap,[record,other]),{type:'begin',capRef:cap,operation:op});
  let accepted=Object.freeze({capRef:cap,items:Object.freeze([] as typeof saved[])});
  function stage() {
    const original=accepted;
    const evidence=authority.issue(state,cap,record,op,saved)!;
    const associated=authority.associate(state,evidence);
    const next=Object.freeze({capRef:cap,items:Object.freeze([saved])});
    return {original,evidence,associated,next};
  }
  function commit(staged:ReturnType<typeof stage>,notify:()=>void) {
    if(accepted!==staged.original||state.capRef!==cap||state.lookup!==op)return false;
    state=staged.associated;accepted=staged.next; // Callback-free authority swap before notification.
    notify();
    state=authority.release(state,staged.evidence,record,op,cap);
    return true;
  }
  return {cap,op,record,other,stage,commit,getState:()=>state,getAccepted:()=>accepted,
    changeScope(){state=reconcileOverlay(state,{type:'reconcile',capRef:Object.freeze({})});},
    settle(operation:object=op){state=reconcileOverlay(state,{type:'settled',operation});},
    begin(operation:object){state=reconcileOverlay(state,{type:'begin',capRef:state.capRef,operation});},
  };
}
it('TEST S exact visible normalized item commits then releases original record only',()=>{
 const r=handoffFixture();const staged=r.stage();expect(r.getState().records).toEqual([r.record,r.other]);
 expect(r.commit(staged,()=>{expect(r.getAccepted().items).toEqual(staged.next.items);expect(r.getState().records).toContain(r.record);})).toBe(true);
 expect(r.getState().records).toEqual([r.other]);expect(r.getState().lookup).toBe(r.op);r.settle();expect(r.getState().lookup).toBeUndefined();
});
it('TEST S notification reentry changes capability; old release is inert until and after settlement',()=>{
 const r=handoffFixture();const staged=r.stage();expect(r.commit(staged,()=>r.changeScope())).toBe(true);
 expect(r.getState().records).toEqual([r.record,r.other]);expect(r.getState().lookup).toBe(r.op);
 r.begin({});expect(r.getState().lookup).toBe(r.op);r.settle();expect(r.getState().lookup).toBeUndefined();
 expect(r.getState().records).toContain(r.record);expect(r.getState().starts).toBe(1);
 for(let n=2;n<=8;n++){const op={};r.begin(op);expect(r.getState().lookup).toBe(op);r.settle(op);}
 expect(r.getState().starts).toBe(8);r.begin({});expect(r.getState().lookup).toBeUndefined();
});
it('TEST S stale stage cannot commit or release after capability changes',()=>{
 const r=handoffFixture();const staged=r.stage();r.changeScope();expect(r.commit(staged,()=>{throw Error('unexpected notify');})).toBe(false);
 expect(r.getState().records).toContain(r.record);expect(r.getState().lookup).toBe(r.op);
});
