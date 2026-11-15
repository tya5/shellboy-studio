import {expect,it} from 'vitest';
import {ShellboyData,type ThreadReadQualification} from '../../data/src/store';
import type {HistoryItem} from '../../data/src/protocol';
import type {OwnedTerminalReadLease} from '../../data/src/terminal-read';
import {FakeTransport,FakeOwnerDb,connectedWithHistory,settle,flush} from '../../data/test/harness';
import {attemptWork} from '../../data/test/work-fixture';
import {ConversationWindow} from '../src/window';
import {captureConversationInput, captureWork, EMPTY_WORK_DESCRIPTOR} from '../src/conversation-input';
import {ownSendPresentation,captureOwnSendLocalRegion} from '../src/own-send-presentation';

async function rig(){
 const t=new FakeTransport(),db=new FakeOwnerDb();let serial=0;
 const data=new ShellboyData({transport:t,newId:()=>`isolation-${++serial}`,schedule:fn=>fn()});
 data.start();t.open();t.push({t:'hello',bridge_version:'synthetic',owner:connectedWithHistory});await settle(t,db);
 const h=data.openThread('t');await settle(t,db);
 const source={revision:1,a:false,b:false,prunedB:false,attempts:[] as string[]};
 const rows=():HistoryItem[]=>[{node_id:'human',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'body',text:'Independent human',text_complete:true}],provenance:{sender:{kind:'human'}}},
  ...(['a','b'] as const).map((id,index):HistoryItem=>({node_id:id,kind:'assistant_response',selection:{ordinal:index+1},
   items:id==='b'&&source.prunedB?[{kind:'unavailable',item_identity:'body',reason:'pruned'}]:source[id]?[{kind:'text',item_identity:'body',text:`Canonical ${id.toUpperCase()}`,text_complete:true}]:null,
   ...(!source[id]?{items_unavailable_reason:'response_budget' as const}:{})}))];
 const base=db.answer.bind(db);
 db.answer=call=>call.command==='status'?{ok:true,result:{items:source.attempts.map(id=>attemptWork({threadId:'t',attemptId:id,turnId:`turn-${id}`,state:'completed',truncated:true,
  refs:[{node_id:id,ordinal:id==='a'?1:2,kind:'assistant_response'}]}))}}:call.command==='history.window'?{ok:true,result:{thread_id:'t',revision:source.revision,total:3,items:rows()}}:base(call);
 let token:ThreadReadQualification|undefined;const capture=h.captureReadQualification;
 h.captureReadQualification=()=>{token=capture();return token;};
 const leases=new Map<string,OwnedTerminalReadLease>(),replace=h.replaceTerminalRead;
 h.replaceTerminalRead=(qualification,admission,request)=>{const out=replace(qualification,admission,request);if('state' in out&&admission.kind==='persisted')leases.set(admission.receipt.attemptId,out);return out;};
 const w=new ConversationWindow({read:(args,cancel)=>h.readWindow(args,cancel)});await settle(t,db);expect(w.bindTerminalHandle(h)).toBe(true);
 const local=[{threadId:'t',scope:h.handoffScope(),operationId:'local-op',messageId:'local-message',text:'Independent local',phase:'accepted' as const,plainMessageSend:true as const}];
 w.bindConversationInput(snapshot=>{
  const input=captureConversationInput(snapshot,{scope:h.handoffScope(),threadId:'t',records:h.handoff.peek(),work: EMPTY_WORK_DESCRIPTOR,current:w.isTerminalHandleCurrent(h)});
  const decision=ownSendPresentation({ref:snapshot,current:w.isTerminalHandleCurrent(h),scope:h.handoffScope(),projection:input.projection,localRows:local,
   canonicalRows:snapshot.rows,hiddenItemKeys:new Set<string>(),path:{tail:true,empty:false,revision:snapshot.revision,lastNodeId:snapshot.rows.at(-1)?.node_id,lastOrdinal:snapshot.rows.at(-1)?.selection?.ordinal},
   nodeOrdinals:new Map(snapshot.rows.map(row=>[row.node_id!,row.selection!.ordinal!])),cohortVersion:{accepted:local,pending:undefined}});
  return{...input,projection:decision.projection,decision:{cohortVersion:{accepted:local,pending:undefined},localRegion:captureOwnSendLocalRegion(decision)}};
 });
 const admit=async(id:'a'|'b')=>{
  source.attempts.push(id);t.push({t:'live',thread_id:'t',attempt_id:id,gap:false,deltas:[{offset:0,reasoning:false,text:''}]});await flush();
  t.push({t:'live_end',thread_id:'t'});await settle(t,db);
  const receipt=h.handoff.peek().find(record=>record.attemptId===id)?.terminalPersisted;expect(receipt).toBeDefined();
  source.revision++;source[id]=true;expect('state' in w.prepareBoundTerminalRead(receipt!)).toBe(true);await settle(t,db);
  expect(w.acceptedView.peek().assistantOwnership?.some(owner=>owner.attemptId===id&&owner.mode==='canonical')).toBe(true);
 };
 await admit('a');await admit('b');if(!token)throw new Error('missing actual binding token');
 return{t,db,data,h,w,source,local,leases,token};
}
it.each(['cancel-b','delete-b-body','replace-b-proof','global-capability','global-epoch','global-owner'] as const)('actual independent A/B owners isolate %s at the new accepted cut',async action=>{
 const r=await rig();
 try{
  const before=r.w.acceptedView.peek(),cap=r.w.acceptedView.currentCapability;
  expect(before.assistantOwnership?.map(owner=>owner.attemptId)).toEqual(['a','b']);
  const a=before.assistantOwnership!.find(owner=>owner.attemptId==='a')!,b=before.assistantOwnership!.find(owner=>owner.attemptId==='b')!;
  const leaseA=r.leases.get('a')!,leaseB=r.leases.get('b')!;expect(r.h.isTerminalReadCurrent(r.token,leaseA)).toBe(true);expect(r.h.isTerminalReadCurrent(r.token,leaseB)).toBe(true);
  expect(r.h.isTerminalReadCurrent(r.token,{...leaseA})).toBe(false);
  if(action==='cancel-b')leaseB.cancel();
  if(action==='replace-b-proof'){
   const next=r.h.replaceTerminalRead(r.token,leaseB.ticket.admission,leaseB.ticket.request);expect('state' in next).toBe(true);
   if(!('state' in next))throw new Error('missing actual replacement');expect(next.ticket).not.toBe(leaseB.ticket);
   expect(r.h.isTerminalReadCurrent(r.token,leaseB)).toBe(false);expect(r.h.isTerminalReadCurrent(r.token,{...leaseB})).toBe(false);
  }
  if(action==='delete-b-body'){r.source.revision++;r.source.prunedB=true;r.w.changed();await settle(r.t,r.db);}
  if(action==='global-capability')r.w.acceptedView.revoke();
  if(action==='global-epoch')r.h.cancelReads();
  if(action==='global-owner')r.t.push({t:'owner',event:'restarted',owner:{state:'connected',info:{protocol_version:5,instance_id:'new-owner',capabilities:['history.window']}}});
  r.w.setAttemptPresentations([{scope:r.h.handoffScope(),attemptId:'unrelated',turnId:'unrelated-turn',nodeIds:['unselected'],state:'pending'}]);
  const after=r.w.acceptedView.peek();
  expect(before.assistantOwnership?.map(owner=>owner.attemptId)).toEqual(['a','b']);
  if(action==='global-owner'){
   expect(r.h.isTerminalReadCurrent(r.token,leaseA)).toBe(false);expect(r.h.isTerminalReadCurrent(r.token,leaseB)).toBe(false);
   expect(r.w.isTerminalHandleCurrent(r.h)).toBe(false);expect(r.w.refreshConversationInput(before)).toBe(false);
   expect(after).toBe(before);return; // a foreign lifetime cannot publish a successor through this binding
  }
  expect(after).not.toBe(before);expect(r.w.acceptedView.isCurrent(before)).toBe(false);
  if(action.startsWith('global-'))expect(after.assistantOwnership??[]).toEqual([]);
  else{
   expect(r.w.acceptedView.currentCapability).toBe(cap);expect(r.h.isTerminalReadCurrent(r.token,leaseA)).toBe(true);
   expect(after.assistantOwnership?.map(owner=>owner.attemptId)).toEqual(['a']);
   expect(after.assistantOwnership![0]).toMatchObject({recordKey:a.recordKey,containerKey:a.containerKey,turnId:'turn-a',receiptRevision:a.receiptRevision,mode:'canonical'});
   const entries=after.displayPlan!.entries;
   expect(entries.find(entry=>entry.item.key===JSON.stringify(['a','body']))).toMatchObject({presentationContainer:a.containerKey,body:{kind:'typed-canonical',text:'Canonical A'},lifetime:{kind:'valid-owner'}});
   expect(entries.find(entry=>entry.item.key===JSON.stringify(['b','body']))?.presentationContainer).toBeUndefined();
   expect(entries.find(entry=>entry.item.key===JSON.stringify(['human','body']))).toMatchObject({body:{kind:'typed-canonical',text:'Independent human'},lifetime:{kind:'canonical-human'}});
   expect(after.displayPlan!.localRegion.localRows).toEqual(r.local);
   expect(after.displayPlan!.entries.some(entry=>entry.presentationContainer===b.containerKey)).toBe(false);
  }
 }finally{r.w.dispose();r.data.stop();}
});
