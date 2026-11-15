import {expect,it} from 'vitest';
import {ConversationWindow} from '../src/window';
import {HistoryWindowInput} from '../../data/src/history-input';
import type {Outcome} from '../../data/src/errors';
import {ownedHistory} from '../../data/test/owned-history';
import type {HistoryItem,HistoryWindowResult} from '../../data/src/protocol';
import {flush} from '../../data/test/harness';
async function rig(){
 const rows:HistoryItem[]=[{node_id:'one',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'body',text:'Independent one',text_complete:true}],provenance:{created_at:'initial'}},
  {node_id:'two',kind:'user',selection:{ordinal:1},items:[{kind:'text',item_identity:'body',text:'Independent two',text_complete:true}],provenance:{created_at:'initial'}}];
 let result:Outcome<HistoryWindowInput>={ok:true,value:ownedHistory({thread_id:'t',revision:1,total:2,items:rows})},reads=0;
 const win=new ConversationWindow({read:async()=>{reads++;return result;}});
 await flush();return{rows,win,reads:()=>reads,raw:()=>({thread_id:'t',revision:2,total:2,items:rows}),
  publish:async(raw:unknown)=>{result=raw instanceof HistoryWindowInput?{ok:true,value:raw}:HistoryWindowInput.decode(raw);win.changed();await flush();}};
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
 }finally{r.win.dispose();}
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
 }finally{r.win.dispose();}
});
it('typed provenance never invokes non-enumerable toJSON and later caller mutation cannot alter the published input',async()=>{
 const r=await rig();let calls=0;const provenance={created_at:'safe'};
 Object.defineProperty(provenance,'toJSON',{value:()=>{calls++;return{created_at:'unsafe'};}});r.rows[0]!.provenance=provenance;
 try{const input=ownedHistory(r.raw());provenance.created_at='mutated';await r.publish(input);
  expect(calls).toBe(0);expect(r.win.acceptedView.peek().rows[0]!.provenance).toEqual({created_at:'safe'});
 }finally{r.win.dispose();}
});
it.each([false,true])('over-bound external read has explicit initial/error behavior and no partial publication: prior=%s',async prior=>{
 const valid:HistoryWindowResult={thread_id:'t',revision:1,total:1,items:[{node_id:'human',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'body',text:'Current human',text_complete:true}]}]};
 const invalid:HistoryWindowResult={thread_id:'t',revision:2,total:99,items:[{...valid.items[0]!,provenance:{large:Array.from({length:40000},()=>({value:'too much'}))}}]};
 let value=prior?valid:invalid,result=HistoryWindowInput.decode(value);const w=new ConversationWindow({read:async()=>result});
 try{await flush();const before=w.acceptedView.peek(),cap=w.acceptedView.currentCapability,height=w.totalHeight();
  if(prior){value=invalid;result=HistoryWindowInput.decode(value);w.changed();await flush();expect(w.acceptedView.peek()).toBe(before);expect(w.isLoaded(98)).toBe(false);expect(w.itemAt(0)).toEqual(before.rows[0]);expect(w.acceptedView.peek().total).toBe(1);}
  else{expect(w.status.peek()).toBe('error');expect(w.acceptedView.peek().rows).toEqual([]);expect(w.acceptedView.peek().total).toBe(0);}
  expect(w.totalHeight()).toBe(height);expect(w.error.peek()).toBe('input-bound');expect(w.acceptedView.currentCapability).toBe(cap);
  expect(w.diagnostic.peek()).toMatchObject({reason:'input-bound',generation:before.generation,revision:before.revision});
 }finally{w.dispose();}
});

it('capture failure reaches the UI diagnostic without exposing secret input',async()=>{
 const secret='capture-secret-must-not-leak';
 const raw={thread_id:'secret',revision:1,total:1,items:[{node_id:'secret-node',kind:'user',selection:{ordinal:0},provenance:{secret,values:Array.from({length:70000},()=>({value:'x'}))},items:[]}]};
 const w=new ConversationWindow({read:async()=>HistoryWindowInput.decode(raw)});
 try{await flush();expect(w.status.peek()).toBe('error');expect(w.error.peek()).not.toContain(secret);expect(JSON.stringify(w.diagnostic.peek())).not.toContain(secret);expect(w.diagnostic.peek()?.reason).toBe('input-bound');}
 finally{w.dispose();}
});
