import { expect, it } from 'vitest';
import { createAssociationAuthority, overlayState, reconcileOverlay } from '../src/overlay-reconcile';

// Explicit integration input: a read-only materialization of the reviewed S exact.
const runtime = globalThis as typeof globalThis & { process?: { env: Record<string,string|undefined> } };
const source = runtime.process?.env.OVERLAY_S_AUTHORITY_SOURCE ?? new URL('../../ui-core/src/accepted-view.ts', import.meta.url).pathname;
it('actual S authority gates O release after visible commit and same-capability reentry', async()=>{
 const { AcceptedView } = await import(/* @vite-ignore */ source!);
 for (const reenter of [false,true]) {
  const view = new AcceptedView({revision:'v1',items:[]});
  const cap=view.currentCapability;const op=Object.freeze({});
  const record=Object.freeze({key:'preview',attemptId:'attempt',text:'sole preview'});
  const other=Object.freeze({key:'other',attemptId:'other',text:'other preview'});
  const authority=createAssociationAuthority<typeof cap>();
  let state=reconcileOverlay(overlayState(cap,[record,other]),{type:'begin',capRef:cap,operation:op});
  const proof=authority.issue(state,cap,record,op,Object.freeze({nodeId:'node',itemIdentity:'item',revision:'body1'}))!;
  state=authority.associate(state,proof);
  let obsolete=0;let releases=0;let reentries=0;
  view.subscribe((v: {revision:string})=>{
   if(reenter&&v.revision==='v2'){reentries++;view.commit(view.stage({revision:'v3',items:[]}));}
  });
  view.subscribe((v: {revision:string})=>{
   if(v.revision!=='v2')return;
   if(!view.isCurrent(v)){obsolete++;return;}
   state=authority.release(state,proof,record,op,cap);releases++;
  });
  expect(view.commit(view.stage({revision:'v2',items:[{nodeId:'node',itemIdentity:'item',revision:'body1',text:'saved'}]}))).toBe(true);
  expect(state.lookup).toBe(op);expect(state.starts).toBe(1);
  if(reenter){expect(reentries).toBe(1);expect(view.current.revision).toBe('v3');expect(state.records).toContain(record);expect(releases).toBe(0);}
  else {expect(view.current.revision).toBe('v2');expect(state.records).toEqual([other]);expect(releases).toBe(1);}
  expect(obsolete).toBe(0);
  state=reconcileOverlay(state,{type:'settled',operation:op});expect(state.lookup).toBeUndefined();
  for(let n=2;n<=8;n++){const next={};state=reconcileOverlay(state,{type:'begin',capRef:cap,operation:next});state=reconcileOverlay(state,{type:'settled',operation:next});}
  expect(state.starts).toBe(8);expect(reconcileOverlay(state,{type:'begin',capRef:cap,operation:{}})).toBe(state);
  view.dispose();authority.dispose();
 }
});
