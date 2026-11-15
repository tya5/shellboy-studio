import {expect,it,onTestFinished} from 'vitest';
import {ShellboyData} from '../../data/src/store';
import type {DisplayObservation,DisplayTarget,TerminalPersistedProof} from '../../data/src/handoff';
import type {HistoryItem} from '../../data/src/protocol';
import {FakeOwnerDb,FakeTransport,connectedWithHistory,settle,flush} from '../../data/test/harness';
import {attemptWork} from '../../data/test/work-fixture';
import {ConversationWindow} from '../src/window';
import {captureConversationInput, captureWork, EMPTY_WORK_DESCRIPTOR} from '../src/conversation-input';

async function rig(readable=false,during:'none'|'revoke'|'newer'='none'){
 const t=new FakeTransport(),db=new FakeOwnerDb();let serial=0;
 const data=new ShellboyData({transport:t,newId:()=>`empty-observation-${++serial}`,schedule:fn=>fn()});
 data.start();t.open();t.push({t:'hello',bridge_version:'synthetic',owner:connectedWithHistory});await settle(t,db);
 const h=data.openThread('t');await settle(t,db);
 const rows:HistoryItem[]=[{node_id:'human',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'body',text:'Independent human',text_complete:true}],provenance:{sender:{kind:'human'}}},
  {node_id:'answer',kind:'assistant_response',selection:{ordinal:1},items:null,items_unavailable_reason:'response_budget'}];
 const base=db.answer.bind(db);
 db.answer=call=>call.command==='status'?{ok:true,result:{items:[attemptWork({threadId:'t',attemptId:'attempt',turnId:'turn',state:'completed',truncated:true,
  refs:[{node_id:'answer',ordinal:1,kind:'assistant_response'}]})]}}:call.command==='history.window'?{ok:true,result:{thread_id:'t',revision:7,total:2,items:rows}}:base(call);
 const holder:{capture?:()=>DisplayTarget|undefined;observations:DisplayObservation[]}={observations:[]};
 const bind=h.bindDisplayOwner;
 h.bindDisplayOwner=capture=>{holder.capture=capture;return bind(()=>{
  const target=capture();return target?{publish:observations=>{holder.observations.push(...observations);return target.publish(observations);}}:undefined;
 });};
 const w=new ConversationWindow({read:(args,cancel)=>h.readWindow(args,cancel)});await settle(t,db);
 expect(w.bindTerminalHandle(h)).toBe(true);
 let action=false;
 expect(w.bindConversationInput(snapshot=>{
  if(action){action=false;if(during==='revoke')w.acceptedView.revoke();else if(during==='newer')w.setAttemptPresentations([{scope:h.handoffScope(),attemptId:'nested',turnId:'nested-turn',nodeIds:['unselected'],state:'pending'}]);}
  return captureConversationInput(snapshot,{scope:h.handoffScope(),threadId:'t',records:h.handoff.peek(),work: EMPTY_WORK_DESCRIPTOR,current:w.isTerminalHandleCurrent(h)});
 })).toBe(true);
 const before=w.acceptedView.peek(),publications:typeof before[]=[];
 const stop=w.acceptedView.subscribe(ref=>{
  publications.push(ref);expect(w.acceptedView.isCurrent(ref)).toBe(true);expect(ref.rows).toEqual(rows);
  expect(ref.assistantOwnership??[]).toEqual([]);expect(ref.retiredAttempts??[]).toEqual([]);
  const plan=ref.displayPlan!;expect(plan.capability).toBe(w.acceptedView.currentCapability);expect(plan.acceptedGeneration).toBe(ref.generation);
  const visible=plan.entries.filter(entry=>entry.body.kind!=='unavailable').map(entry=>({key:entry.item.key,kind:entry.body.kind,text:entry.body.kind==='unavailable'?'':entry.body.text}));
  expect(visible).toEqual([{key:JSON.stringify(['human','body']),kind:'typed-canonical',text:'Independent human'},
   ...(readable?[{key:JSON.stringify(['live','handoff','t','handoff:attempt']),kind:'preview',text:'Readable original'}]:[])]);
  for(const proof of ref.terminalPersistedAttempts??[])expect(proof).toMatchObject({scope:h.handoffScope(),attemptId:'attempt',recordKey:'handoff:attempt',turnId:'turn',nodeIds:['answer'],
   refs:[{nodeId:'answer',ordinal:1,kind:'assistant_response'}],terminalState:'completed'});
  if(ref.terminalPresence?.length)expect(ref.terminalPresence).toMatchObject([{scope:h.handoffScope(),attemptId:'attempt',phase:'pending',reason:'canonical-pending',answerAvailability:'unknown'}]);
 });
 onTestFinished(()=>{stop();w.dispose();data.stop();});
 const publish=async()=>{
  t.push({t:'live',thread_id:'t',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:readable?'Readable original':''}]});await flush();
  action=during!=='none';t.push({t:'live_end',thread_id:'t'});await settle(t,db);
 };
 const source=():TerminalPersistedProof=>{
  const observation=holder.observations.find(item=>item.receipt!==undefined);if(!observation?.receipt)throw new Error('no source receipt observation');return observation.receipt;
 };
 return{t,db,data,h,w,rows,before,publications,holder,publish,source};
}
it('an empty original contributes its exact current Store receipt to every publication without body, read or transfer authority',async()=>{
 const r=await rig();await r.publish();const record=r.h.handoff.peek()[0]!,receipt=r.source(),ref=r.w.acceptedView.peek();
 expect(r.publications).toHaveLength(1);expect(ref.terminalPersistedAttempts).toHaveLength(1);expect(record.text).toBe('');
 expect(r.h.isReceiptObservationCurrent(record,receipt)).toBe(true);expect(r.h.isDisplayOwnershipCurrent(record,ref.generation)).toBe(false);
 expect(record.readyAttempt).toBeUndefined();expect(ref.assistantOwnership??[]).toEqual([]);expect(ref.retiredAttempts??[]).toEqual([]);
 let releases=0;expect(r.h.transferHandoff('attempt',(captured,end)=>r.w.acceptHandoff(captured,r.h.handoffScope(),reason=>{releases++;end(reason);}))).toBe(false);
 expect(releases).toBe(0);expect(r.w.acceptedView.peek()).toBe(ref);expect(r.h.handoff.peek()[0]).toBe(record);
 expect(r.t.calls('history.window').filter(call=>typeof call.args==='object'&&call.args!==null&&'node_id' in call.args)).toHaveLength(0);
});
it.each(['proof-copy','foreign-proof','record-copy','stale-ref','revoke','readable-original'] as const)('metadata observation rejects %s without a publication or body grant',async mode=>{
 const r=await rig(mode==='readable-original');await r.publish();const record=r.h.handoff.peek()[0]!,receipt=r.source(),target=r.holder.capture?.();expect(target).toBeDefined();
 const proof=mode==='proof-copy'?{...receipt}:mode==='foreign-proof'?{...receipt,scope:'foreign'}:receipt;
 const original=mode==='record-copy'?{...record}:record;
 if(mode==='stale-ref')r.w.setAttemptPresentations([{scope:r.h.handoffScope(),attemptId:'other',turnId:'other-turn',nodeIds:['unselected'],state:'pending'}]);
 if(mode==='revoke')r.w.acceptedView.revoke();
 const before=r.w.acceptedView.peek(),count=r.publications.length;
 expect(target!.publish([{kind:'receipt',record:original,receipt:proof}])).toBe(false);
 expect(r.w.acceptedView.peek()).toBe(before);expect(r.publications).toHaveLength(count);expect(r.h.handoff.peek()[0]).toBe(record);
 expect(before.retiredAttempts??[]).toEqual([]);expect(record.readyAttempt).toBeUndefined();
});
it.each(['revoke','newer'] as const)('receipt capture cannot overwrite %s during current composition',async mode=>{
 const r=await rig(false,mode);await r.publish();const record=r.h.handoff.peek()[0]!,ref=r.w.acceptedView.peek();
 expect(r.source().recordKey).toBe(record.key);expect(ref.terminalPersistedAttempts??[]).toEqual([]);expect(record.readyAttempt).toBeUndefined();
 if(mode==='revoke'){expect(ref).toBe(r.before);expect(r.w.acceptedView.isCurrent(ref)).toBe(false);expect(r.publications).toHaveLength(0);}
 else{expect(ref).not.toBe(r.before);expect(ref.attemptPresentations).toMatchObject([{attemptId:'nested'}]);expect(r.publications).toHaveLength(1);}
});
