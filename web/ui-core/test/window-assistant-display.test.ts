import { expect, it } from 'vitest';
import { ConversationWindow } from '../src/window';
import { ShellboyData } from '../../data/src/store';
import type { HistoryItem } from '../../data/src/protocol';
import { FakeTransport, FakeOwnerDb, flush, settle } from '../../data/test/harness';
import { projectHistoryWindowItems } from '../src/conversation-items';

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
 return {data,transport,db,handle,window,node,answer};
}
it("installs the first successful tail read as bootstrap without declaring a rewrite", async () => {
 const node:HistoryItem={node_id:"bootstrap-node",kind:"user_message",selection:{ordinal:0},items:[{kind:"text",item_identity:"bootstrap-body",text:"first read",text_complete:true}]};
 const reads:{before?:number;after?:number}[]=[];
 const window=new ConversationWindow({read:async args=>{reads.push({before:args.before,after:args.after});return {ok:true,value:{thread_id:"bootstrap-thread",revision:7,total:1,items:[node]}};}});
 try {
  await flush();
  expect(reads).toEqual([{before:99,after:0}]);
  expect(window.pathChanged.peek()).toBe(false);
  expect(window.itemAt(0)).toBe(node);
  expect(window.acceptedView.peek().revision).toBe(7);
 } finally { window.dispose(); }
});

it("rejects an older reply after the cursor is established and verifies the current tail", async () => {
 const node:HistoryItem={node_id:"stable-node",kind:"user_message",selection:{ordinal:0},items:[{kind:"text",item_identity:"stable-body",text:"stable",text_complete:true}]};
 const replies=[7,6,7];const reads:Record<string,unknown>[]=[];
 const window=new ConversationWindow({read:async args=>{reads.push(args);const revision=replies.shift()??7;return {ok:true,value:{thread_id:"established-thread",revision,total:1,items:[node]}};}});
 try {
  await flush();window.changed();await flush();
  expect(reads.slice(0,3).map(args=>args.expect_node_id??"initial")).toEqual(["initial","stable-node","stable-node"]);
  expect(window.acceptedView.peek().revision).toBe(7);
  expect(window.itemAt(0)?.node_id).toBe("stable-node");
  expect(window.pathChanged.peek()).toBe(false);
 } finally { window.dispose(); }
});

it.each([false,true])('one synchronous current successor publishes both ownership choices, partial=%s',async partial=>{
 const r=await rig(partial);const original=r.handle.handoff.peek()[0]!;
 const expectedProjection = projectHistoryWindowItems({ revision: 7, nodes: [r.node], keyScope: [r.handle.handoffScope()] }).projection;
 const planCuts: number[] = [];
 const stopPlan = r.window.acceptedView.subscribe(ref => {
  const plan = ref.displayPlan!;
  expect(plan.coverage).toBe(planCuts.length === 0 ? "complete" : "unavailable");
  expect(plan.acceptedGeneration).toBe(ref.generation);
  expect(plan.revision).toBe(ref.revision);
  expect(plan.capability).toBe(r.window.acceptedView.currentCapability);
  expect(plan.entries.map(entry => entry.item)).toEqual(expectedProjection.items);
  expect(plan.sequence).toEqual(expectedProjection.sequence ?? []);
  expect(plan.workGroups).toEqual(expectedProjection.workGroups ?? []);
  expect(plan.entries.map(entry => entry.body)).toEqual(expectedProjection.items.map(item => item.source.kind === "text"
   ? partial ? { kind: "preview", text: "saved", cut: {generation: ref.generation, revision: 7, capability: r.window.acceptedView.currentCapability, scope:r.handle.handoffScope()} }
     : { kind: "typed-canonical", text: "saved", cut: {generation: ref.generation, revision: 7, capability: r.window.acceptedView.currentCapability, scope:r.handle.handoffScope()} }
   : { kind: "unavailable", reason: "tool", cut: {generation: ref.generation, revision: 7, capability: r.window.acceptedView.currentCapability, scope:r.handle.handoffScope()} }));
  expect(plan.entries.map(entry => entry.presentationContainer)).toEqual([original.presentationContainer, undefined]);
  expect(plan.entries.map(entry => entry.lifetime.kind)).toEqual(["valid-owner", "retained"]);
  planCuts.push(ref.generation);
 });
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
  const ready = r.window.acceptedView.peek();
  r.window.layoutChanged();
  expect(r.window.acceptedView.peek().generation).toBeGreaterThan(ready.generation);
  expect(r.window.acceptedView.peek().assistantOwnership).toEqual(ready.assistantOwnership);
  expect(r.window.acceptedView.peek().displayPlan?.acceptedGeneration).toBe(r.window.acceptedView.peek().generation);
  expect(planCuts.length).toBeGreaterThan(0); stopPlan();
 }finally{stop();r.window.dispose();r.handle.close();r.data.stop();}
});
it.each(['generation','capability','close','owner','epoch','missing-turn','conflict'] as const)('does not apply stale or ambiguous exact-ID display authority: %s',async mode=>{
 const r=await rig();
 const expectedProjection = projectHistoryWindowItems({ revision: 7, nodes: [r.node], keyScope: [r.handle.handoffScope()] }).projection;
 const order: string[] = [];
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


it("ready reentry revocation preserves exact original record, revokes body authority, and blocks old proof", async () => {
 const r=await rig();
 const original=r.handle.handoff.peek()[0]!;
 const expectedProjection=projectHistoryWindowItems({revision:7,nodes:[r.node],keyScope:[r.handle.handoffScope()]}).projection;
 const order:string[]=[]; let revoked=false;
 const stop=r.window.acceptedView.subscribe(ref=>{
  if(!ref.assistantOwnership?.length) return;
  order.push(`ready:${ref.generation}`);
  if(revoked){
   expect(ref.displayPlan?.acceptedGeneration).toBe(ref.generation);
   expect(ref.displayPlan?.capability).toBe(r.window.acceptedView.currentCapability);
   expect(ref.assistantOwnership??[]).toHaveLength(0);
   return;
  }
  const plan=ref.displayPlan!;
  expect(plan.entries.map(entry=>entry.item)).toEqual(expectedProjection.items);
  expect(plan.entries.map(entry=>entry.body)).toEqual([
   {kind:"typed-canonical",text:"saved",cut:{generation:ref.generation,revision:7,capability:r.window.acceptedView.currentCapability,scope:r.handle.handoffScope()}},
   {kind:"unavailable",reason:"tool",cut:{generation:ref.generation,revision:7,capability:r.window.acceptedView.currentCapability,scope:r.handle.handoffScope()}},
  ]);
  expect(plan.entries.map(entry=>entry.presentationContainer)).toEqual([original.presentationContainer,undefined]);
  expect(plan.entries.map(entry=>entry.lifetime.kind)).toEqual(["valid-owner","retained"]);
  if(!revoked){revoked=true;r.window.acceptedView.revoke();r.handle.cancelReads();r.window.layoutChanged();order.push(`revoked:${r.window.acceptedView.peek().generation}`);}
 });
 try {
  r.answer();await settle(r.transport,r.db);
  const current=r.window.acceptedView.peek();
  expect(order).toEqual([`ready:${current.generation-1}`,`revoked:${current.generation}`]);
  expect(current.assistantOwnership??[]).toHaveLength(0);
  expect(current.displayPlan?.acceptedGeneration).toBe(current.generation);
  expect(current.displayPlan?.capability).toBe(r.window.acceptedView.currentCapability);
  expect(current.displayPlan?.entries.map(entry=>entry.body)).toEqual([
   {kind:"typed-canonical",text:"saved",cut:{generation:current.generation,revision:7,capability:r.window.acceptedView.currentCapability,scope:r.handle.handoffScope()}},
   {kind:"unavailable",reason:"tool",cut:{generation:current.generation,revision:7,capability:r.window.acceptedView.currentCapability,scope:r.handle.handoffScope()}},
  ]);
  expect(current.displayPlan?.entries.map(entry=>entry.lifetime.kind)).toEqual(["retained","retained"]);
  expect(r.handle.handoff.peek()).toHaveLength(1);
  expect(r.handle.handoff.peek()[0]).toBe(original);
  expect(r.handle.handoff.peek()[0]?.text).toBe("preview");
  expect(r.handle.isDisplayOwnershipCurrent(original,current.generation)).toBe(false);
 }finally{stop();r.window.dispose();r.handle.close();r.data.stop();}
});
