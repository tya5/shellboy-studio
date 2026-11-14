import {expect,it} from 'vitest';
import {ConversationWindow} from '../src/window';
import type {HistoryItem} from '../../data/src/protocol';
import {flush} from '../../data/test/harness';
async function rig(){
 const rows:HistoryItem[]=[{node_id:'one',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'body',text:'Independent one',text_complete:true}],provenance:{created_at:'initial'}},
  {node_id:'two',kind:'user',selection:{ordinal:1},items:[{kind:'text',item_identity:'body',text:'Independent two',text_complete:true}],provenance:{created_at:'initial'}}];
 let reads=0;const win=new ConversationWindow({read:async()=>{reads++;return{ok:true,value:{thread_id:'t',revision:1,total:2,items:rows}};}});
 await flush();return{rows,win,reads:()=>reads,publish:()=>win.setAttemptPresentations([{scope:'scope',attemptId:'attempt',turnId:'turn',nodeIds:['one'],state:'pending'}])};
}
it('public Window reads changing provenance getters once and pools only the captured value',async()=>{
 const r=await rig(),before=r.win.acceptedView.peek();let reads=0;
 r.rows[0]!.provenance={get created_at(){reads++;return reads===1?'A':'B';}};
 r.rows[1]!.provenance={created_at:'A'};
 try{
  r.publish();const after=r.win.acceptedView.peek();expect(reads).toBe(1);
  expect(after.rows.map(row=>row.provenance?.created_at)).toEqual(['A','A']);
  expect(after.rows[0]!.provenance).toBe(after.rows[1]!.provenance);
  expect(before.rows.map(row=>row.provenance?.created_at)).toEqual(['initial','initial']);expect(after).not.toBe(before);
  expect(after.displayPlan?.entries.map(entry=>entry.body.kind==='typed-canonical'?entry.body.text:'unavailable')).toEqual(['Independent one','Independent two']);
  expect(r.reads()).toBe(1);
 }finally{r.win.dispose();}
});
it.each(['toJSON','nonplain','depth','cycle'] as const)('public Window rejects provenance %s inside the original single capture budget without replacing the cut',async mode=>{
 const r=await rig(),before=r.win.acceptedView.peek(),cap=r.win.acceptedView.currentCapability;let calls=0;
 let payload:Record<string,unknown>={};
 if(mode==='toJSON')payload={toJSON(){calls++;return{created_at:'forged'};}};
 if(mode==='nonplain')payload={nested:Object.freeze(new Map([['mutable','internals']]))};
 if(mode==='cycle'){payload.self=payload;}
 if(mode==='depth'){let tail=payload;for(let i=0;i<70;i++){const next:Record<string,unknown>={};tail.next=next;tail=next;}}
 r.rows[0]!.provenance=payload;
 try{
  expect(r.publish).toThrow(mode==='cycle'?'acyclic':mode==='depth'?'bound exceeded':'plain data');
  expect(calls).toBe(0);expect(r.win.acceptedView.peek()).toBe(before);
  expect(r.win.acceptedView.currentCapability).toBe(cap);expect(r.win.acceptedView.isCurrent(before)).toBe(true);
  expect(before.rows[0]!.provenance).toEqual({created_at:'initial'});expect(r.reads()).toBe(1);
 }finally{r.win.dispose();}
});
it('public Window never invokes non-enumerable toJSON hooks while capturing and pooling provenance',async()=>{
 const r=await rig();let calls=0;const provenance={created_at:'safe'};
 Object.defineProperty(provenance,'toJSON',{value:()=>{calls++;return{created_at:'unsafe'};}});r.rows[0]!.provenance=provenance;
 try{r.publish();expect(calls).toBe(0);expect(r.win.acceptedView.peek().rows[0]!.provenance).toEqual({created_at:'safe'});}
 finally{r.win.dispose();}
});
