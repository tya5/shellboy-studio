import { expect, it } from 'vitest';
import { ConversationWindow } from '../src/window';
import { ShellboyData } from '../../data/src/store';
import type { HistoryItem } from '../../data/src/protocol';
import { FakeTransport, FakeOwnerDb, flush, settle } from '../../data/test/harness';
import {captureConversationInput} from '../src/conversation-input';
import {declaredWorkGroup} from './declared-attempt-cuts';
import type {WindowAcceptedSnapshot} from '../src/window';
import type {HandoffRecord} from '../../data/src/handoff';
import {attemptWork} from '../../data/test/work-fixture';

import {ownedHistory} from '../../data/test/owned-history';
async function rig(partial=false) {
 const transport=new FakeTransport(),db=new FakeOwnerDb();let id=0;
 const data=new ShellboyData({transport,newId:()=>`display-${++id}`,schedule:fn=>fn()});
 data.start();transport.open();transport.push({t:'hello',bridge_version:'synthetic',owner:{state:'connected',info:{protocol_version:5,instance_id:'owner',capabilities:['history.window','live.text']}}});await settle(transport,db);
 const handle=data.openThread('t');await settle(transport,db);
 let changeAfterCapture=false;const bind=handle.bindDisplayOwner;
 handle.bindDisplayOwner=capture=>bind(()=>{
  const target=capture();
  if(changeAfterCapture){changeAfterCapture=false;window.setAttemptPresentations([{scope:handle.handoffScope(),attemptId:'other',turnId:'other-turn',nodeIds:['unselected'],state:'pending'}]);}
  return target;
 });
 const node:HistoryItem={node_id:'answer',kind:'assistant_response',selection:{ordinal:5},items:[{kind:'text',item_identity:'exact-body',text:'saved',text_complete:!partial},{kind:'tool_call',item_identity:'tool',execution_ids:['execution']}]};
 const window=new ConversationWindow({read:async()=>({ok:true,value:ownedHistory({thread_id:'t',revision:7,total:6,items:[node]})})});await flush();
 expect(window.bindTerminalHandle(handle)).toBe(true);
 expect(window.bindConversationInput(snapshot=>captureConversationInput(snapshot,{scope:handle.handoffScope(),threadId:'t',records:handle.handoff.peek(),work:[],current:true}))).toBe(true);
 const send=transport.send.bind(transport);
 transport.send=frame=>{const result=send(frame);if(frame.t==='call'&&frame.command==='status'&&(frame.args as {all?:boolean}).all===true)db.answered.add(frame.id);return result;};
 transport.push({t:'live',thread_id:'t',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'preview'}]});await flush();
 transport.push({t:'live_end',thread_id:'t'});await flush();
 const lookup=[...transport.calls('status')].reverse().find(call=>(call.args as {all?:boolean}).all===true)!;
 expect(lookup).toBeDefined();

 const answer=(turn='turn',claim=false)=>transport.ok(lookup.id,{items:[attemptWork({threadId:'t',attemptId:'attempt',turnId:turn,state:'completed',refs:[{node_id:'answer',ordinal:5,kind:'assistant_response'}]}),...(claim?[attemptWork({threadId:'t',attemptId:'other',turnId:'other-turn',state:'completed',refs:[{node_id:'answer',ordinal:5,kind:'assistant_response'}]})]:[])]});
 return {data,transport,db,handle,window,node,answer,invalidateCapturedFrame:()=>{changeAfterCapture=true;}};
}
it("installs the first successful tail read as bootstrap without declaring a rewrite", async () => {
 const node:HistoryItem={node_id:"bootstrap-node",kind:"user_message",selection:{ordinal:0},items:[{kind:"text",item_identity:"bootstrap-body",text:"first read",text_complete:true}]};
 const reads:{before?:number;after?:number}[]=[];
 const externalItems=[...node.items!]; const external={...node,items:externalItems};
 const window=new ConversationWindow({read:async args=>{reads.push({before:args.before,after:args.after});return {ok:true,value:ownedHistory({thread_id:"bootstrap-thread",revision:7,total:1,items:[external]})};}});
 try {
  await flush();
  expect(reads).toEqual([{before:99,after:0}]);
  expect(window.pathChanged.peek()).toBe(false);
  const accepted = window.itemAt(0);
  expect(accepted).toMatchObject(node);
  expect(accepted).not.toBe(node);
  externalItems[0] = { kind: 'text', item_identity: 'mutated', text: 'mutated', text_complete: true };
  expect(accepted!.items![0]).toMatchObject({ item_identity: 'bootstrap-body', text: 'first read' });
  expect(window.acceptedView.peek().revision).toBe(7);
 } finally { window.dispose(); }
});

it("rejects an older reply after the cursor is established and verifies the current tail", async () => {
 const node:HistoryItem={node_id:"stable-node",kind:"user_message",selection:{ordinal:0},items:[{kind:"text",item_identity:"stable-body",text:"stable",text_complete:true}]};
 const replies=[7,6,7];const reads:Record<string,unknown>[]=[];
 const window=new ConversationWindow({read:async args=>{reads.push(args);const revision=replies.shift()??7;return {ok:true,value:ownedHistory({thread_id:"established-thread",revision,total:1,items:[node]})};}});
 try {
  await flush();window.changed();await flush();
  expect(reads.slice(0,3).map(args=>args.expect_node_id??"initial")).toEqual(["initial","stable-node","stable-node"]);
  expect(window.acceptedView.peek().revision).toBe(7);
  expect(window.itemAt(0)?.node_id).toBe("stable-node");
  expect(window.pathChanged.peek()).toBe(false);
 } finally { window.dispose(); }
});


/** Independent authorized body/order/host/cut oracle; no composition or projection factory. */
function assertOwnedCut(ref:WindowAcceptedSnapshot,scope:string,original:HandoffRecord,partial:boolean){
 const plan=ref.displayPlan!,cut={generation:ref.generation,revision:7,scope,capability:plan.capability};
 const text=JSON.stringify(['answer','exact-body']),tool=JSON.stringify(['tool',[scope],'execution',['execution']]);
 const live=JSON.stringify(['live','handoff','t',original.key]),receipt=JSON.stringify(['receipt','work',scope,'attempt']);
 expect(plan.coverage).toBe('complete');expect(plan.acceptedGeneration).toBe(ref.generation);expect(plan.revision).toBe(7);expect(plan.scope).toBe(scope);
 expect(ref.rows.map(row=>row.node_id)).toEqual(['answer']);
 expect(plan.entries.map(entry=>({key:entry.item.key,case:entry.item.classification?.id,body:entry.body,container:entry.presentationContainer,lifetime:entry.lifetime.kind}))).toEqual(partial?[
  {key:tool,case:'toolCall',body:{kind:'unavailable',reason:'tool',cut},container:undefined,lifetime:'retained'},
  {key:live,case:'assistantText',body:{kind:'preview',text:'preview',cut},container:original.presentationContainer,lifetime:'valid-owner'},
  {key:receipt,case:'terminalPending',body:{kind:'unavailable',reason:'record',cut},container:undefined,lifetime:'retained'},
 ]:[
  {key:text,case:'assistantText',body:{kind:'typed-canonical',text:'saved',cut},container:original.presentationContainer,lifetime:'valid-owner'},
  {key:tool,case:'toolCall',body:{kind:'unavailable',reason:'tool',cut},container:undefined,lifetime:'retained'},
 ]);
 const tools=declaredWorkGroup({members:[tool],tools:[tool],executions:['execution'],counts:{Tools:1,Reasoning:0,Notifications:0,Problems:0},before:partial?'unknown':'closed',after:partial?'closed':'unknown'});
 const last=declaredWorkGroup({members:[receipt],tools:[],executions:[],counts:{Tools:0,Reasoning:0,Notifications:1,Problems:0},before:'closed',after:'unknown'});
 expect(plan.workGroups).toEqual(partial?[tools,last]:[tools]);
 expect(plan.sequence).toEqual(partial?[{kind:'work',groupKey:tools.key},{kind:'conversation',itemKey:live},{kind:'work',groupKey:last.key}]:[{kind:'conversation',itemKey:text},{kind:'work',groupKey:tools.key}]);
 expect(plan.partitionUnknownKeys).toEqual([]);
 for(const entry of plan.entries){expect(entry.body.cut).toEqual(cut);expect(entry.lifetime.cut).toBe(entry.body.cut);}
}
it.each([false,true])('one synchronous current successor keeps exact canonical or original-preview body authority, partial=%s',async partial=>{
 const r=await rig(partial),original=r.handle.handoff.peek()[0]!,scope=r.handle.handoffScope();
 const cuts:{mode:string;valid:boolean;held:boolean}[]=[];
 const stop=r.window.acceptedView.subscribe(ref=>{
  expect(ref.displayPlan?.capability).toBe(r.window.acceptedView.currentCapability);
  assertOwnedCut(ref,scope,original,partial);
  for(const decision of ref.assistantOwnership??[])cuts.push({mode:decision.mode,valid:r.handle.isDisplayOwnershipCurrent(original,ref.generation),held:r.handle.handoff.peek().includes(original)});
 });
 try{
  r.answer();await settle(r.transport,r.db);
  expect(cuts).toEqual([{mode:partial?'preview':'canonical',valid:true,held:true}]);
  const ref=r.window.acceptedView.peek();expect(ref.assistantOwnership![0]!.itemKeys).toEqual([JSON.stringify(['answer','exact-body'])]);
  expect(ref.terminalPersistedAttempts).toMatchObject([{scope,attemptId:'attempt',recordKey:original.key,turnId:'turn',nodeIds:['answer'],refs:[{nodeId:'answer',ordinal:5,kind:'assistant_response'}],presentationContainer:original.presentationContainer}]);
  expect(r.handle.handoff.peek()[0]).toMatchObject({key:original.key,presentationContainer:original.presentationContainer,text:'preview',bodyAuthority:'preview'});
  expect(r.handle.handoff.peek()[0]?.readyAttempt).toBeUndefined();expect(r.transport.calls('history.get')).toHaveLength(0);
  r.window.layoutChanged();expect(r.window.acceptedView.peek()).toBe(ref);expect(cuts).toHaveLength(1);
 }finally{stop();r.window.dispose();r.handle.close();r.data.stop();}
});
it.each(['generation','capability','close','owner','epoch','missing-turn','conflict'] as const)('does not apply stale or ambiguous exact-ID display authority: %s',async mode=>{
 const r=await rig(),original=r.handle.handoff.peek()[0]!;
 try{
  if(mode==='generation')r.invalidateCapturedFrame();
  if(mode==='capability')r.window.acceptedView.revoke();
  if(mode==='close')r.window.dispose();
  if(mode==='owner')r.transport.push({t:'owner',event:'restarted',owner:{state:'connected',info:{protocol_version:5,instance_id:'owner',capabilities:['history.window','live.text']}}});
  if(mode==='epoch')r.handle.cancelReads();
  r.answer(mode==='missing-turn'?'':'turn',mode==='conflict');await settle(r.transport,r.db);
  const ref=r.window.acceptedView.peek();expect(ref.assistantOwnership??[]).toHaveLength(0);
  for(const record of r.handle.handoff.peek())expect(r.handle.isDisplayOwnershipCurrent(record,ref.generation)).toBe(false);
  if(!['owner','close'].includes(mode))expect(r.handle.handoff.peek()[0]?.text).toBe('preview');
  expect(ref.retiredAttempts??[]).toEqual([]);expect(ref.rows.map(node=>node.node_id)).toEqual(['answer']);
  expect(r.transport.calls('history.window').filter(call=>typeof call.args==='object'&&call.args!==null&&'node_id' in call.args)).toHaveLength(['owner','epoch','missing-turn','conflict'].includes(mode)?0:1);
 }finally{r.window.dispose();r.handle.close();r.data.stop();}
});
it('ready reentry revocation preserves exact original and leaves the historical cut invalid without repainting it',async()=>{
 const r=await rig(),original=r.handle.handoff.peek()[0]!,scope=r.handle.handoffScope();let published:WindowAcceptedSnapshot|undefined;
 const order:string[]=[];
 const stop=r.window.acceptedView.subscribe(ref=>{
  if(!ref.assistantOwnership?.length)return;
  expect(published).toBeUndefined();assertOwnedCut(ref,scope,original,false);published=ref;order.push('ready');
  r.window.acceptedView.revoke();r.handle.cancelReads();r.window.layoutChanged();order.push('revoked');
 });
 try{
  r.answer();await settle(r.transport,r.db);expect(order).toEqual(['ready','revoked']);
  expect(r.window.acceptedView.peek()).toBe(published);expect(r.window.acceptedView.isCurrent(published!)).toBe(false);
  expect(published!.displayPlan?.capability).not.toBe(r.window.acceptedView.currentCapability);
  expect(r.handle.handoff.peek()[0]).toBe(original);expect(original.text).toBe('preview');
  expect(r.handle.isDisplayOwnershipCurrent(original,published!.generation)).toBe(false);
  expect(published!.retiredAttempts??[]).toEqual([]);expect(r.transport.calls('history.get')).toHaveLength(0);
 }finally{stop();r.window.dispose();r.handle.close();r.data.stop();}
});

it('a semantic generation before source observation is captured current, never restamped from the earlier read-start frame',async()=>{
 const r=await rig(),before=r.window.acceptedView.peek(),original=r.handle.handoff.peek()[0]!;let observed=0;
 const stop=r.window.acceptedView.subscribe(ref=>{
  if(!ref.assistantOwnership?.length)return;
  expect(r.window.acceptedView.isCurrent(ref)).toBe(true);
  expect(r.handle.isDisplayOwnershipCurrent(r.handle.handoff.peek()[0]!,ref.generation)).toBe(true);observed++;
 });
 try{
  r.window.setAttemptPresentations([{scope:r.handle.handoffScope(),attemptId:'other',turnId:'other-turn',nodeIds:['unselected'],state:'pending'}]);
  const current=r.window.acceptedView.peek();expect(current).not.toBe(before);
  r.answer();await settle(r.transport,r.db);
  const accepted=r.window.acceptedView.peek();expect(accepted.assistantOwnership).toMatchObject([{scope:r.handle.handoffScope(),attemptId:'attempt',turnId:'turn',recordKey:original.key,containerKey:original.presentationContainer,mode:'canonical'}]);
  expect(accepted.displayPlan?.entries.find(entry=>entry.item.key===JSON.stringify(['answer','exact-body']))?.body).toMatchObject({kind:'typed-canonical',text:'saved'});
  expect(observed).toBe(1);
  expect(r.window.acceptedView.isCurrent(before)).toBe(false);expect(before.assistantOwnership??[]).toEqual([]);
  expect(r.window.acceptedView.isCurrent(current)).toBe(false);expect(accepted.retiredAttempts??[]).toEqual([]);
 }finally{stop();r.window.dispose();r.handle.close();r.data.stop();}
});
