// @vitest-environment happy-dom
import '@preact/signals';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import type {HistoryItem} from '../../../data/src/protocol';
import {attemptWork} from '../../../data/test/work-fixture';
import {flush,settle} from '../../../data/test/harness';
import {publicConversationFixture,CurrentSavedView} from './conversation-fixture';

it('ninth exact readable owner uses a genuinely retired eight-original bootstrap, never empty-receipt transfer',async()=>{
 const same='Equal answer text';
 const nodes:HistoryItem[]=[{node_id:'human',kind:'user',items:[{kind:'text',item_identity:'body',text:'Independent human',text_complete:true}],provenance:{sender:{kind:'human'}}},
  ...Array.from({length:10},(_,index):HistoryItem=>({node_id:`answer-${index+1}`,kind:'assistant_response',items:[{kind:'text',item_identity:'body',text:index>=8?same:`Canonical ${index+1}`,text_complete:true}]}))];
 const f=await publicConversationFixture({nodes}),host=document.createElement('div');document.body.append(host);
 const h=f.model.handle.peek()!,w=f.model.longReader.peek()!,scope=h.handoffScope(),trace:Record<string,unknown>[]=[],containers=new Map<string,string>();
 const stop=w.acceptedView.subscribe(ref=>{
  expect(w.acceptedView.isCurrent(ref)).toBe(true);expect(ref.displayPlan?.capability).toBe(w.acceptedView.currentCapability);
  expect(ref.rows.map(row=>row.node_id)).toEqual(nodes.map(row=>row.node_id));
  expect(ref.displayPlan?.entries.find(entry=>entry.item.key===JSON.stringify(['human','body']))?.body).toMatchObject({kind:'typed-canonical',text:'Independent human'});
  for(const retired of ref.retiredAttempts??[]){
   expect(retired.containerKey).toBe(containers.get(retired.attemptId));
   expect(ref.assistantOwnership?.find(owner=>owner.scope===scope&&owner.attemptId===retired.attemptId)).toMatchObject({recordKey:retired.recordKey,containerKey:retired.containerKey,mode:'canonical'});
   const nodeId=retired.refs[0]!.nodeId;
   expect(ref.displayPlan?.entries.find(entry=>entry.item.key===JSON.stringify([nodeId,'body']))?.presentationContainer).toBe(retired.containerKey);
  }
  trace.push({kind:'publication',generation:ref.generation,receipts:ref.terminalPersistedAttempts?.length??0,
   owners:ref.assistantOwnership?.map(owner=>({attempt:owner.attemptId,record:owner.recordKey,container:owner.containerKey,mode:owner.mode})),
   retired:ref.retiredAttempts?.map(record=>record.attemptId),held:h.handoff.peek().map(record=>({attempt:record.attemptId,ready:!!record.readyAttempt,status:record.status}))});
 });
 try{
  await act(async()=>render(<CurrentSavedView fixture={f}/>,host));
  for(let active=1;active<=9;active++){
   f.db.work.lead=[];
   await act(async()=>{f.t.push({t:'live',thread_id:'lead',attempt_id:`attempt-${active}`,gap:false,deltas:[{offset:0,reasoning:false,text:active===9?same:`Readable ${active}`}]});await flush();});
   const original=h.handoff.peek().find(record=>record.attemptId===`attempt-${active}`)!;
   containers.set(original.attemptId,original.presentationContainer);
   expect(original.text).toBe(active===9?same:`Readable ${active}`);expect(original.readyAttempt).toBeUndefined();
   f.db.work.lead=[{...attemptWork({threadId:'lead',attemptId:`attempt-${active}`,turnId:`turn-${active}`,state:'completed',refs:[{node_id:`answer-${active}`,ordinal:active,kind:'assistant_response'}]})}];
   await act(async()=>{f.t.push({t:'live_end',thread_id:'lead'});await settle(f.t,f.db);});
   const current=w.acceptedView.peek();expect(h.handoffScope()).toBe(scope);
   trace.push({kind:'cohort',active,receipts:current.terminalPersistedAttempts?.length,held:h.handoff.peek().map(record=>({attempt:record.attemptId,ready:!!record.readyAttempt,status:record.status})),retry:h.handoffRetryState.peek(),
    reads:f.t.calls('history.window').map(call=>call.args)});
   if(active<=8){
    expect(current.retiredAttempts?.find(record=>record.attemptId===`attempt-${active}`)).toMatchObject({scope,turnId:`turn-${active}`,recordKey:original.key,containerKey:original.presentationContainer});
    expect(h.handoff.peek()).toHaveLength(0);expect(current.terminalPersistedAttempts).toHaveLength(active);
    await act(async()=>{const retry=h.retryHandoff();await settle(f.t,f.db);await retry;});
   }else{
    expect(current.terminalPersistedAttempts).toHaveLength(8);
    expect(host.querySelectorAll('[data-node="answer-9"] .msg')).toHaveLength(1);expect(host.querySelectorAll('[data-node="answer-10"] .msg')).toHaveLength(1);
    expect(current.assistantOwnership?.find(owner=>owner.attemptId==='attempt-9')).toMatchObject({scope,turnId:'turn-9',recordKey:original.key,containerKey:original.presentationContainer,mode:'canonical'});
    expect(host.querySelectorAll('[data-live-overlay]')).toHaveLength(0);
    expect(h.handoff.peek()).toHaveLength(1);expect(h.handoff.peek()[0]?.text).toBe(same);
    expect(h.handoff.peek()[0]?.readyAttempt).toBeUndefined();expect(h.handoff.peek()[0]?.terminalPersisted).toBeUndefined();
    expect(h.isDisplayOwnershipCurrent(h.handoff.peek()[0]!,current.generation)).toBe(true);
    expect(h.handoffRetryState.peek()).toMatchObject({phase:'unavailable',reason:'receipt_capacity',canRetry:false});
    expect(f.t.calls('history.window').filter(call=>call.args&&typeof call.args==='object'&&'node_id' in call.args&&call.args.node_id==='answer-9')).toHaveLength(0);
   }
  }
  expect(f.t.calls('history.get')).toHaveLength(0);
 }finally{console.log('NINTH_ACTUAL_READABLE_COHORT',JSON.stringify(trace));stop();render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
