import { expect, it } from 'vitest';
import { ConversationWindow } from '../src/window';
import { ShellboyData } from '../../data/src/store';
import type { HistoryItem } from '../../data/src/protocol';
import { FakeTransport, FakeOwnerDb, flush, settle } from '../../data/test/harness';

async function rig(partial=false) {
 const transport=new FakeTransport(),db=new FakeOwnerDb();let id=0;
 const data=new ShellboyData({transport,newId:()=>`display-${++id}`,schedule:fn=>fn()});
 data.start();transport.open();transport.push({t:'hello',bridge_version:'synthetic',owner:{state:'connected',info:{protocol_version:5,instance_id:'owner',capabilities:['history.window','live.text']}}});await settle(transport,db);
 const handle=data.openThread('t');await settle(transport,db);
 const node:HistoryItem={node_id:'answer',kind:'assistant_response',selection:{ordinal:5},items:[{kind:'text',item_identity:'exact-body',text:'saved',text_complete:!partial},{kind:'tool_call',item_identity:'tool',execution_ids:['execution']}]};
 const window=new ConversationWindow({read:async()=>({ok:true,value:{thread_id:'t',revision:7,total:6,items:[node]}})});await flush();
 expect(window.bindTerminalHandle(handle)).toBe(true);
 const send=transport.send.bind(transport);
 transport.send=frame=>{const result=send(frame);if(frame.t==='call'&&frame.command==='status'&&(frame.args as {all?:boolean}).all===true)db.answered.add(frame.id);return result;};
 transport.push({t:'live',thread_id:'t',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'preview'}]});await flush();
 transport.push({t:'live_end',thread_id:'t'});await flush();
 const lookup=[...transport.calls('status')].reverse().find(call=>(call.args as {all?:boolean}).all===true)!;
 expect(lookup).toBeDefined();
 const answer=(turn='turn',claim=false)=>transport.ok(lookup.id,{items:[{kind:'attempt',id:'attempt',attempt_id:'attempt',thread_id:'t',turn_id:turn,state:'completed',response_nodes_truncated:false,response_nodes:[{node_id:'answer',ordinal:0,kind:'message'}]},...(claim?[{kind:'attempt',id:'other',attempt_id:'other',thread_id:'t',turn_id:'other-turn',state:'completed',response_nodes_truncated:false,response_nodes:[{node_id:'answer',ordinal:0,kind:'message'}]}]:[])]});
 return {data,transport,db,handle,window,answer};
}
it.each([false,true])('one synchronous current successor publishes both ownership choices, partial=%s',async partial=>{
 const r=await rig(partial);const original=r.handle.handoff.peek()[0]!;
 const cuts:{mode:string;valid:boolean;held:boolean}[]=[];
 const stop=r.window.acceptedView.subscribe(ref=>{
  for(const decision of ref.assistantOwnership??[])cuts.push({mode:decision.mode,valid:r.handle.isDisplayOwnershipCurrent(original,ref.generation),held:r.handle.handoff.peek().includes(original)});
 });
 try{
  r.answer();await settle(r.transport,r.db);
  expect(cuts).toEqual([{mode:partial?'preview':'canonical',valid:true,held:true}]);
  const ref=r.window.acceptedView.peek();expect(ref.assistantOwnership![0]!.itemKeys).toHaveLength(1);
  expect(ref.terminalPersistedAttempts).toHaveLength(1);expect(r.handle.handoff.peek()[0]).toBe(original);
  expect(r.transport.calls('history.get')).toHaveLength(0);
 }finally{stop();r.window.dispose();r.handle.close();r.data.stop();}
});
it.each(['generation','capability','close','owner','epoch','reentrant','missing-turn','conflict'] as const)('does not apply stale or ambiguous exact-ID display authority: %s',async mode=>{
 const r=await rig();let reentered=false;
 const stop=r.window.acceptedView.subscribe(ref=>{if(mode==='reentrant'&&!reentered&&ref.assistantOwnership?.length){reentered=true;r.window.layoutChanged();}});
 try{
  if(mode==='generation')r.window.layoutChanged();
  if(mode==='capability')r.window.acceptedView.revoke();
  if(mode==='close')r.window.dispose();
  if(mode==='owner')r.transport.push({t:'owner',event:'restarted',owner:{state:'connected',info:{protocol_version:5,instance_id:'owner',capabilities:['history.window','live.text']}}});
  if(mode==='epoch')r.handle.cancelReads();
  r.answer(mode==='missing-turn'?'':'turn',mode==='conflict');await settle(r.transport,r.db);
  const ref=r.window.acceptedView.peek();
  expect(ref.assistantOwnership??[]).toHaveLength(0);
  for(const original of r.handle.handoff.peek())expect(r.handle.isDisplayOwnershipCurrent(original,ref.generation)).toBe(false);
  if(!['owner','close'].includes(mode))expect(r.handle.handoff.peek()[0]!.text).toBe('preview');
 }finally{stop();r.window.dispose();r.handle.close();r.data.stop();}
});
