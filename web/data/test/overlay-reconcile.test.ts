import { expect, it } from 'vitest';
import { overlayState, reconcileOverlay, createAssociationAuthority, type AssociationEvidence } from '../src/overlay-reconcile';
const record=Object.freeze({key:'preview-a',attemptId:'attempt-a',text:'retained preview'});
const saved={nodeId:'node-a',itemIdentity:'item-a',revision:'revision-a'};
function rig(){const cap=Object.freeze({});const op=Object.freeze({});const authority=createAssociationAuthority<typeof cap>();const state=reconcileOverlay(overlayState(cap,[record]),{type:'begin',capRef:cap,operation:op});return {cap,op,authority,state};}
it('holds exact capability object, not reconstructed string facts',()=>{
 const r=rig();const other={};expect(r.authority.issue(r.state,other,record,r.op,saved)).toBeUndefined();
 expect(reconcileOverlay(r.state,{type:'begin',capRef:other,operation:{}})).toBe(r.state);
});
it('authority-issued exact association retains sole preview until postcommit release',()=>{
 const r=rig();const proof=r.authority.issue(r.state,r.cap,record,r.op,saved)!;
 const next=r.authority.associate(r.state,proof);expect(next.records).toEqual([record]);expect(next.associations[0]?.saved).toEqual(saved);
 expect(r.authority.release(next,proof,record,r.op,r.cap).records).toEqual([]);
 expect(r.state.associations).toEqual([]);
});
it('outside-loaded, truncated, terminal-unresolved and evicted proof absence never removes text',()=>{
 const r=rig();const fake=Object.freeze({}) as AssociationEvidence<typeof r.cap>;
 expect(r.authority.associate(r.state,fake)).toBe(r.state);
 expect(r.authority.release(r.state,fake,record,r.op,r.cap)).toBe(r.state);expect(r.state.records[0]?.text).toBe(record.text);
});
it('same-shaped fake evidence, record, operation or capability cannot release',()=>{
 const r=rig();const proof=r.authority.issue(r.state,r.cap,record,r.op,saved)!;const state=r.authority.associate(r.state,proof);
 expect(r.authority.release(state,{} as typeof proof,record,r.op,r.cap)).toBe(state);
 expect(r.authority.release(state,proof,{...record},r.op,r.cap)).toBe(state);
 expect(r.authority.release(state,proof,record,{},r.cap)).toBe(state);
 expect(r.authority.release(state,proof,record,r.op,{})).toBe(state);
});
it('reentrant new scope retains old running lookup; old settlement cannot revive proof or release',()=>{
 const r=rig();const proof=r.authority.issue(r.state,r.cap,record,r.op,saved)!;const old=r.authority.associate(r.state,proof);
 const nextCap={};let next=reconcileOverlay(old,{type:'reconcile',capRef:nextCap});expect(next.lookup).toBe(r.op);expect(next.records).toEqual([record]);
 expect(r.authority.release(next,proof,record,r.op,r.cap)).toBe(next);expect(r.authority.associate(next,proof)).toBe(next);
 next=reconcileOverlay(next,{type:'settled',operation:r.op});expect(next.lookup).toBeUndefined();expect(next.starts).toBe(1);
 expect(r.authority.associate(next,proof)).toBe(next);expect(r.authority.release(next,proof,record,r.op,r.cap)).toBe(next);
});
it('same-key replacement cannot be cleaned up by original-record notification',()=>{
 const r=rig();const proof=r.authority.issue(r.state,r.cap,record,r.op,saved)!;
 const replacement=Object.freeze({...record,text:'new preview'});const next={...r.state,records:[replacement]};
 expect(r.authority.release(next,proof,record,r.op,r.cap)).toBe(next);expect(next.records).toEqual([replacement]);
});
it('registry keeps at most one evidence per record and invalidation revokes original handle',()=>{
 const r=rig();const first=r.authority.issue(r.state,r.cap,record,r.op,saved)!;const second=r.authority.issue(r.state,r.cap,record,r.op,{...saved,revision:'revision-b'})!;
 expect(r.authority.associate(r.state,first)).toBe(r.state);expect(r.authority.associate(r.state,second).associations[0]?.saved.revision).toBe('revision-b');
 r.authority.invalidate();expect(r.authority.associate(r.state,second)).toBe(r.state);r.authority.dispose();
});
it('owns one lookup until exact settlement and never refills starts on scope changes',()=>{
 const r=rig();let state=r.state;expect(reconcileOverlay(state,{type:'begin',capRef:r.cap,operation:{}})).toBe(state);
 expect(reconcileOverlay(state,{type:'settled',operation:{}})).toBe(state);
 state=reconcileOverlay(state,{type:'settled',operation:r.op});
 for(let n=2;n<=8;n++){const op={};state=reconcileOverlay(state,{type:'begin',capRef:r.cap,operation:op});state=reconcileOverlay(state,{type:'settled',operation:op});}
 expect(state.starts).toBe(8);expect(reconcileOverlay(state,{type:'begin',capRef:r.cap,operation:{}})).toBe(state);
});
it('checks adopted-record bounds only, without deciding new preview overflow policy',()=>{
 const cap={};expect(()=>overlayState(cap,Array.from({length:9},(_,n)=>({...record,key:String(n)})))).toThrow();
 expect(()=>overlayState(cap,[{...record,text:'a'.repeat(262145)}])).toThrow();
 expect(()=>overlayState(cap,Array.from({length:5},(_,n)=>({...record,key:String(n),text:'a'.repeat(262144)})))).toThrow();
 expect(overlayState(cap,Array.from({length:4},(_,n)=>({...record,key:String(n),text:'a'.repeat(262144)}))).records).toHaveLength(4);
});

it('settled operation cannot release after a newer lookup takes ownership',()=>{
 const r=rig();const proof=r.authority.issue(r.state,r.cap,record,r.op,saved)!;
 let state=r.authority.associate(r.state,proof);state=reconcileOverlay(state,{type:'settled',operation:r.op});
 expect(r.authority.release(state,proof,record,r.op,r.cap)).toBe(state);
 const nextOp={};state=reconcileOverlay(state,{type:'begin',capRef:r.cap,operation:nextOp});
 expect(r.authority.release(state,proof,record,r.op,r.cap)).toBe(state);expect(state.lookup).toBe(nextOp);
});
