import {expect,it} from 'vitest';
import {ConversationWindow} from '../src/window';
import {HistoryWindowInput} from '../../data/src/history-input';
import type {Outcome} from '../../data/src/errors';
import {ownedHistory} from '../../data/test/owned-history';
import type {HistoryItem,HistoryWindowResult} from '../../data/src/protocol';
import {flush} from '../../data/test/harness';
import {rig as ownerRig,createBoundWindow} from './window-owner';
import {captureConversationInput,captureCurrentWork} from '../src/conversation-input';
async function boundWindow(read:(args:unknown)=>Promise<Outcome<HistoryWindowInput>>){
 const owner=await ownerRig(0);owner.w.dispose();let win!:ConversationWindow;
 win=createBoundWindow({read},owner.handle,{state:owner.producer,capture:snapshot=>{
  const capability=win.acceptedView.currentCapability;
  return captureConversationInput(snapshot,{scope:owner.handle.threadId,threadId:owner.handle.threadId,records:owner.handle.handoff.value,work:captureCurrentWork(owner.handle.threadId,owner.handle.work.value.value),current:()=>win.isCurrentThread(owner.handle)&&win.acceptedView.currentCapability===capability});
 }});
 await flush();
 return {win,dispose:()=>{win.dispose();owner.handle.close();owner.data.stop();}};
}

async function rig(){
 let semanticCurrent=()=>true;
 const rows:HistoryItem[]=[{node_id:'one',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'body',text:'Independent one',text_complete:true}],provenance:{created_at:'initial'}},
  {node_id:'two',kind:'user',selection:{ordinal:1},items:[{kind:'text',item_identity:'body',text:'Independent two',text_complete:true}],provenance:{created_at:'initial'}}];
 let result:Outcome<HistoryWindowInput>={ok:true,value:ownedHistory({thread_id:'t',revision:1,total:2,items:rows})},reads=0;
 const owner=await ownerRig(0);owner.w.dispose();
 const win=createBoundWindow({read:async()=>{reads++;return result;}},owner.handle,{state:owner.producer,capture:snapshot=>{
  const capability=win.acceptedView.currentCapability,currentThread=win.isCurrentThread(owner.handle);
  return captureConversationInput(snapshot,{scope:'history',threadId:owner.handle.threadId,records:owner.handle.handoff.value,work:captureCurrentWork(owner.handle.threadId,owner.handle.work.value.value),current:()=>currentThread&&win.isCurrentThread(owner.handle)&&win.acceptedView.currentCapability===capability&&semanticCurrent()});
 }});
 await flush();
  return{rows,win,producer:owner.producer,rebind:()=>win.bindCurrentThread(owner.handle),live:()=>owner.handle.handoff.value,reads:()=>reads,raw:()=>({thread_id:'t',revision:2,total:rows.length,items:rows}),setSemanticCurrent:(current:()=>boolean)=>{semanticCurrent=current},
  publish:async(raw:unknown)=>{result=raw instanceof HistoryWindowInput?{ok:true,value:raw}:HistoryWindowInput.decode(raw);if(!win.bindCurrentThread(owner.handle)) throw new Error('window owner rebind failed');win.changed();await flush();},
  dispose:()=>{win.dispose();owner.handle.close();owner.data.stop();}};
}
it('public Window reads changing provenance getters once at typed admission and pools only the captured value',async()=>{
 const r=await rig(),before=r.win.acceptedView.peek();let reads=0;
 r.rows[0]!.provenance={get created_at(){reads++;return reads===1?'A':'B';}};r.rows[1]!.provenance={created_at:'A'};
 try{
  const input=ownedHistory(r.raw());expect(reads).toBe(1);await r.publish(input);
  const after=r.win.acceptedView.peek();expect(reads).toBe(1);expect(after.rows.map(row=>row.provenance?.created_at)).toEqual(['A','A']);
  expect(after.rows[0]!.provenance).toBe(after.rows[1]!.provenance);
  expect(before.rows.map(row=>row.provenance?.created_at)).toEqual(['initial','initial']);expect(after).not.toBe(before);
  expect(after.displayPlan?.entries.map(entry=>entry.body.kind==='typed-canonical'?entry.body.text:'unavailable')).toEqual(['Independent one','Independent two']);
  expect(r.reads()).toBe(3); // original read, revision discovery, exact fresh selected successor
 }finally{r.dispose();}
});
it.each(['toJSON','nonplain','depth','cycle'] as const)('typed input rejects provenance %s once; public Window retains the cut without a partial cursor commit',async mode=>{
 const r=await rig(),before=r.win.acceptedView.peek(),cap=r.win.acceptedView.currentCapability;let calls=0;
 let payload:Record<string,unknown>={};
 if(mode==='toJSON')payload={toJSON(){calls++;return{created_at:'forged'};}};
 if(mode==='nonplain')payload={nested:Object.freeze(new Map([['mutable','internals']]))};
 if(mode==='cycle')payload.self=payload;
 if(mode==='depth'){let tail=payload;for(let i=0;i<70;i++){const next:Record<string,unknown>={};tail.next=next;tail=next;}}
 r.rows[0]!.provenance=payload;
 try{
  const decoded=HistoryWindowInput.decode(r.raw());
  expect(decoded).toMatchObject({ok:false,error:{kind:'invalid_response',message:mode==='cycle'?'cyclic-input':mode==='depth'?'input-bound':'invalid-input'}});
  await r.publish(r.raw());expect(calls).toBe(0);expect(r.win.acceptedView.peek()).toBe(before);
  expect(r.win.acceptedView.currentCapability).toBe(cap);expect(r.win.acceptedView.isCurrent(before)).toBe(true);
  expect(before.rows[0]!.provenance).toEqual({created_at:'initial'});expect(r.reads()).toBe(2);
  expect(r.win.error.peek()).toBe(mode==='depth'?'input-bound':mode==='cycle'?'cyclic-input':'invalid-input');
  expect(r.win.itemAt(0)).toEqual(before.rows[0]);expect(r.win.acceptedView.peek().total).toBe(2);
 }finally{r.dispose();}
});
it('typed provenance never invokes non-enumerable toJSON and later caller mutation cannot alter the published input',async()=>{
 const r=await rig();let calls=0;const provenance={created_at:'safe'};
 Object.defineProperty(provenance,'toJSON',{value:()=>{calls++;return{created_at:'unsafe'};}});r.rows[0]!.provenance=provenance;
 try{const input=ownedHistory(r.raw());provenance.created_at='mutated';await r.publish(input);
  expect(calls).toBe(0);expect(r.win.acceptedView.peek().rows[0]!.provenance).toEqual({created_at:'safe'});
 }finally{r.dispose();}
});
it.each([false,true])('over-bound external read has explicit initial/error behavior and no partial publication: prior=%s',async prior=>{
 const valid:HistoryWindowResult={thread_id:'t',revision:1,total:1,items:[{node_id:'human',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'body',text:'Current human',text_complete:true}]}]};
 const invalid:HistoryWindowResult={thread_id:'t',revision:2,total:99,items:[{...valid.items[0]!,provenance:{large:Array.from({length:40000},()=>({value:'too much'}))}}]};
 let value=prior?valid:invalid,result=HistoryWindowInput.decode(value);const bound=await boundWindow(async()=>result),w=bound.win;
 try{await flush();const before=w.acceptedView.peek(),cap=w.acceptedView.currentCapability,height=w.totalHeight();
  if(prior){value=invalid;result=HistoryWindowInput.decode(value);w.changed();await flush();expect(w.acceptedView.peek()).toBe(before);expect(w.isLoaded(98)).toBe(false);expect(w.itemAt(0)).toEqual(before.rows[0]);expect(w.acceptedView.peek().total).toBe(1);}
  else{expect(w.status.peek()).toBe('error');expect(w.acceptedView.peek().rows).toEqual([]);expect(w.acceptedView.peek().total).toBe(0);}
  expect(w.totalHeight()).toBe(height);expect(w.error.peek()).toBe('input-bound');expect(w.acceptedView.currentCapability).toBe(cap);
  expect(w.diagnostic.peek()).toMatchObject({reason:'input-bound',generation:before.generation,revision:before.revision});
 }finally{bound.dispose();}
});

it('capture failure reaches the UI diagnostic without exposing secret input',async()=>{
 const secret='capture-secret-must-not-leak';
 const raw={thread_id:'secret',revision:1,total:1,items:[{node_id:'secret-node',kind:'user',selection:{ordinal:0},provenance:{secret,values:Array.from({length:70000},()=>({value:'x'}))},items:[]}]};
 const bound=await boundWindow(async()=>HistoryWindowInput.decode(raw)),w=bound.win;
 try{await flush();expect(w.status.peek()).toBe('error');expect(w.error.peek()).not.toContain(secret);expect(JSON.stringify(w.diagnostic.peek())).not.toContain(secret);expect(w.diagnostic.peek()?.reason).toBe('input-bound');}
 finally{bound.dispose();}
});
it("selected R1 to R2 semantic rejection preserves storage and live identity",async()=>{const r=await rig();try{await r.publish(r.raw());r.producer.advance('seed-live');await flush();if(!r.rebind()) throw new Error('window owner rebind failed');const before=r.win.acceptedView.peek(),beforeRows=before.rows,beforeItem=r.win.itemAt(0),beforeHeight=r.win.totalHeight(),beforeScroll=r.win.scrollTop,beforeLive=r.live();expect(beforeRows).toHaveLength(2);expect(before.total).toBe(2);expect(beforeLive.length).toBeGreaterThan(0);const row={node_id:'three',kind:'user' as const,selection:{ordinal:2},items:[{kind:'text' as const,item_identity:'body',text:'three',text_complete:true}],provenance:{created_at:'r2'}};r.rows.push(row);let leaseChecks=0;r.setSemanticCurrent(()=>{leaseChecks++;return leaseChecks===1});await r.publish({thread_id:'t',revision:3,total:3,items:r.rows});expect(leaseChecks).toBeGreaterThanOrEqual(2);expect(r.win.acceptedView.peek()).toBe(before);expect(r.win.acceptedView.peek().rows).toBe(beforeRows);expect(r.win.itemAt(0)).toBe(beforeItem);expect(r.win.acceptedView.peek().total).toBe(2);expect(r.win.totalHeight()).toBe(beforeHeight);expect(r.win.scrollTop).toBe(beforeScroll);expect(r.live()[0]).toBe(beforeLive[0]);}finally{r.dispose();}});

it("selected R1 to R2 accepted subscriber observes coherent rows and geometry",async()=>{const r=await rig();try{await r.publish(r.raw());const seen:unknown[]=[];r.win.acceptedView.subscribe(ref=>seen.push({ref,total:r.win.acceptedView.peek().total,item:r.win.itemAt(2),height:r.win.totalHeight(),scroll:r.win.scrollTop}));r.rows.push({node_id:'three',kind:'user',selection:{ordinal:2},items:[{kind:'text',item_identity:'body',text:'three',text_complete:true}],provenance:{created_at:'r2'}});await r.publish({thread_id:'t',revision:3,total:3,items:r.rows});const after=r.win.acceptedView.peek();expect(seen.length).toBeGreaterThan(0);expect(after.total).toBe(3);expect(after.rows).toHaveLength(3);expect(r.win.itemAt(2)?.node_id).toBe('three');expect(r.win.totalHeight()).toBe((seen.at(-1) as {height:number}).height);expect((seen.at(-1) as {scroll:number}).scroll).toBe(r.win.scrollTop);expect(seen.at(-1)).toMatchObject({ref:after,total:3,item:{node_id:'three'}});}finally{r.dispose();}});
