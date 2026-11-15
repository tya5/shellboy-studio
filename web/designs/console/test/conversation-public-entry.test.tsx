import {publicConversationFixture,CurrentSavedView} from './conversation-fixture';
import {canonicalAttemptId} from '../../../data/test/work-fixture';
import { captureConversationInput, captureWork, EMPTY_WORK_DESCRIPTOR } from '../../../ui-core/src/conversation-input';
// @vitest-environment happy-dom
import { render } from 'preact';
import {flush,settle} from '../../../data/test/harness';
import {ownedHistory} from '../../../data/test/owned-history';
import '@preact/signals';
import {signal} from '@preact/signals';
import {ConversationWindow,type WindowAcceptedSnapshot} from '../../../ui-core/src/window';
import {Handoff} from '../../../data/src/handoff';
import type {AppModel} from '../../../ui-core/src/model';
import {Conversation, SavedWindowContent as ActualSavedWindowContent, OrderedHistory} from '../screens/Conversation';
import {WindowedScroll} from '../screens/WindowedScroll';
import { act } from 'preact/test-utils';
import { afterAll, expect, it, vi } from 'vitest';
import { fixtureModel } from '../../../ui-core/test/fixture';
import { normalizeConversationFacts, normalizeLiveWorkFacts, projectHistoryWindowItems, projectSavedItems, scopeIssuedWorkFacts, projectOwnedHandoffFacts, retainUnretiredLiveFacts } from '../../../ui-core/src/conversation-items';

// Control the real lazy renderer boundary: cold text and warm Markdown are different DOM contracts.
const rendererGate=vi.hoisted(()=>{
 let release!:()=>void;
 const ready=new Promise<void>(resolve=>{release=resolve;});
 return {ready,release};
});
vi.mock('../system/components/Message/markdown',async importOriginal=>{
 await rendererGate.ready;
 return importOriginal();
});
afterAll(()=>rendererGate.release());


it('renders only bounded window diagnostic metadata without body or payload fields', async () => {
  rendererGate.release();
  const fixture=await fixtureModel({route:'conversation',threadId:'lead'});
  const host=document.createElement('div');document.body.append(host);
  try {
    const reader=fixture.model.longReader.value!;
    reader.diagnostic.value={reason:'input-bound',generation:4,revision:2,ownerEpoch:3,at:Date.now()};
    await act(async()=>render(<Conversation model={fixture.model}/>,host));
    const diagnostic=host.querySelector('[data-window-diagnostic]');
    expect(diagnostic).not.toBeNull(); expect(diagnostic?.getAttribute('data-reason')).toBe('input-bound');
    expect(diagnostic?.getAttribute('data-generation')).toBe('4'); expect(diagnostic?.getAttribute('data-revision')).toBe('2');
    expect(diagnostic?.hasAttribute('hidden')).toBe(true); expect(diagnostic?.textContent).toBe('');
    expect([...diagnostic!.attributes].map(attribute=>attribute.name).sort()).toEqual(['data-generation','data-owner-epoch','data-reason','data-revision','data-window-diagnostic','hidden'].sort());
  } finally { render(null,host);host.remove();fixture.model.dispose();fixture.data.stop(); }
});

it('renders a real capture failure diagnostic without the captured secret', async () => {
  rendererGate.release();
  const secret='ui-capture-secret-must-not-render';
  const fixture=await fixtureModel({route:'conversation',threadId:'lead',configure:db=>{db.history.lead=[{node_id:'oversized',kind:'user',selection:{ordinal:0},provenance:{secret,values:Array.from({length:70000},()=>({value:'x'}))},items:[]}];}});
  const host=document.createElement('div');document.body.append(host);
  try {
    await flush(); await flush();
    await act(async()=>render(<Conversation model={fixture.model}/>,host));
    const diagnostic=host.querySelector('[data-window-diagnostic]');
    expect(diagnostic).not.toBeNull(); expect(diagnostic?.getAttribute('data-reason')).toBe('input-bound');
    expect(diagnostic?.hasAttribute('hidden')).toBe(true); expect(diagnostic?.textContent).toBe(''); expect(diagnostic?.outerHTML).not.toContain(secret); expect(diagnostic?.outerHTML).not.toContain('x'); expect([...diagnostic!.attributes].every(attribute=>!attribute.value.includes(secret))).toBe(true);
  } finally { render(null,host);host.remove();fixture.model.dispose();fixture.data.stop(); }
});

it("production model publishes the read plus exact handoff overlay before OrderedHistory renders", async () => {
  rendererGate.release();
  const user:import("../../../data/src/protocol").HistoryItem={node_id:"production-user",kind:"user",selection:{ordinal:0},items:[{kind:"text",item_identity:"production-user-text",text:"Independent user",text_complete:true}],provenance:{kind:"human",sender:{kind:"human"}}};
  const fixture=await fixtureModel({route:"conversation",threadId:"lead",configure:db=>{db.history.lead=[user];}});
  const host=document.createElement("div");document.body.append(host);
  try {
    const handle=fixture.model.handle.value!,reader=fixture.model.longReader.value!;
    const liveFrame:import("../../../data/src/protocol").ServerFrame={t:"live",thread_id:handle.threadId,attempt_id:"production-attempt",gap:false,deltas:[{offset:0,reasoning:false,text:"Owned stream body"}]};
    fixture.t.push(liveFrame);
    await flush();await flush();
    expect(handle.handoff.value.map(record=>({attemptId:record.attemptId,status:record.status,text:record.text,bodyAuthority:record.bodyAuthority}))).toContainEqual({attemptId:"production-attempt",status:"streaming",text:"Owned stream body",bodyAuthority:"preview"});
    const accepted=reader.acceptedView.peek();
    expect(reader.acceptedView.isCurrent(accepted)).toBe(true);
    expect(accepted.displayPlan?.coverage).toBe("complete");
    expect(accepted.displayPlan?.entries.flatMap(entry=>"text" in entry.item.source?[entry.item.source.text]:[])).toEqual(["Independent user","Owned stream body"]);
    const readsBeforeMount=fixture.t.calls("history.window").length,generationBeforeMount=reader.acceptedView.peek().generation;
    await act(async()=>render(<OrderedHistory model={fixture.model} handle={handle} win={reader} t={fixture.model.t.value}/>,host));
    expect(host.textContent).toContain("Independent user");
    expect(host.textContent).toContain("Owned stream body");
    expect(host.querySelector('[data-live-overlay]')).not.toBeNull();
    const mountedGeneration=reader.acceptedView.peek().generation,mountedReads=fixture.t.calls("history.window").length;
    await act(async()=>render(<OrderedHistory model={fixture.model} handle={handle} win={reader} t={fixture.model.t.value}/>,host));
    expect(reader.acceptedView.peek().generation).toBe(mountedGeneration);
    expect(fixture.t.calls("history.window").length).toBe(mountedReads);
    expect(mountedReads).toBe(readsBeforeMount);
    expect(mountedGeneration).toBe(generationBeforeMount);
  } finally { render(null,host);host.remove();fixture.model.dispose();fixture.data.stop(); }
});

it("production model preserves one host across preview, saved canonical body, empty ledger, and the next live turn", async () => {
  rendererGate.release();
  const user:import("../../../data/src/protocol").HistoryItem={node_id:"lifecycle-user",kind:"user",selection:{ordinal:0},items:[{kind:"text",item_identity:"lifecycle-user-text",text:"Independent user",text_complete:true}],provenance:{kind:"human",sender:{kind:"human"}}};
  const fixture=await fixtureModel({route:"conversation",threadId:"lead",configure:db=>{db.history.lead=[user];const answer=db.answer.bind(db);db.answer=call=>call.command==='message.send'?{ok:true,result:{thread_id:'lead',message_id:'concurrent-local'}}:answer(call);}});
  const host=document.createElement("div");document.body.append(host);
  let stopPublication=()=>{};const turnOne=canonicalAttemptId(1);
  try {
    const handle=fixture.model.handle.value!,reader=fixture.model.longReader.value!;
    const sendLive=(attempt_id:string,text:string)=>fixture.t.push({t:"live",thread_id:handle.threadId,attempt_id,gap:false,deltas:[{offset:0,reasoning:false,text}]});
    sendLive(turnOne,"Preview answer");await flush();await flush();
    await act(async()=>render(<OrderedHistory model={fixture.model} handle={handle} win={reader} t={fixture.model.t.value}/>,host));
    const stableHost=host;
    expect(stableHost.textContent).toContain("Independent user");expect(stableHost.textContent).toContain("Preview answer");
    const saved:import("../../../data/src/protocol").HistoryItem={node_id:"lifecycle-answer",kind:"assistant_response",selection:{ordinal:1},items:[{kind:"text",item_identity:"lifecycle-answer-text",text:"Committed saved answer",text_complete:true}],provenance:{kind:"assistant",attempt_id:turnOne}};
    fixture.db.history.lead=[user,saved];fixture.db.bodies["lifecycle-answer"]="Committed saved answer";
    fixture.db.work.lead=[{kind:"attempt",id:turnOne,attempt_id:turnOne,turn_id:"turn-one-id",thread_id:handle.threadId,state:"completed",response_nodes:[{node_id:"lifecycle-answer",ordinal:1,kind:"assistant_response"}],response_nodes_truncated:false}];
    fixture.t.push({t:"live_end",thread_id:handle.threadId});
    sendLive('retained-owner','Retained concurrent preview');await flush();await flush();
    const localSend=fixture.model.send('Local concurrent cohort');await flush();
    const operation=fixture.model.pendingOwnMessage.peek()!.operationId,scope=handle.handoffScope();
    const retained=handle.handoff.peek().find(record=>record.attemptId==='retained-owner')!;
    let readyCuts=0;
    stopPublication=reader.acceptedView.subscribe(snapshot=>{
      expect(reader.acceptedView.isCurrent(snapshot)).toBe(true);
      const plan=snapshot.displayPlan!;expect(plan.acceptedGeneration).toBe(snapshot.generation);
      expect(plan.capability).toBe(reader.acceptedView.currentCapability);expect(plan.scope).toBe(scope);
      for(const entry of plan.entries){
        expect(entry.body.cut.generation).toBe(snapshot.generation);expect(entry.body.cut.revision).toBe(snapshot.revision);
        expect(entry.lifetime.cut.generation).toBe(snapshot.generation);expect(entry.lifetime.cut.revision).toBe(snapshot.revision);
        expect(entry.lifetime.cut.scope).toBe(scope);
        if(entry.body.kind==='typed-canonical')expect(entry.body.cut.capability).toBe(reader.acceptedView.currentCapability);
      }
      const texts=plan.entries.flatMap(entry=>entry.body.kind==='typed-canonical'||entry.body.kind==='preview'?[entry.body.text]:[]);
      expect(texts.every(text=>['Independent user','Preview answer','Committed saved answer','Retained concurrent preview'].includes(text))).toBe(true);
      const retainedEntry=plan.entries.find(entry=>entry.item.source.kind==='text'&&'domain' in entry.item.source&&entry.item.source.recordId===retained.key);
      expect(retainedEntry?.body.kind).toBe('preview');expect(retainedEntry?.presentationContainer).toBe(retained.presentationContainer);
      const cohort=[...plan.cohortVersion.accepted.map(row=>row.operationId),...(plan.cohortVersion.pending?[plan.cohortVersion.pending.operationId]:[])];
      expect(cohort).toEqual([operation]);
      const local=plan.localRegion;
      expect(local.cohort.map(row=>row.operationId)).toEqual([operation]);
      expect(local.localRows.map(row=>row.operationId)).toEqual([operation]);
      expect(local.localRows[0]?.text).toBe('Local concurrent cohort');
      expect(local.placement).toEqual({kind:'unqualified',reason:'tail-unproved'});
      expect(local.slots).toEqual([]);expect(local.conflictIds).toEqual([]);expect(local.retire).toEqual([]);
      if(snapshot.retiredAttempts?.some(record=>record.attemptId===turnOne)){
        readyCuts++;expect(texts).toEqual(['Independent user','Committed saved answer','Retained concurrent preview']);
        expect(snapshot.rows.map(row=>row.node_id)).toEqual(['lifecycle-user','lifecycle-answer']);
        const canonical=plan.entries.find(entry=>entry.item.source.nodeId==='lifecycle-answer')!;
        expect(canonical.body.kind).toBe('typed-canonical');expect(canonical.lifetime.kind).toBe('valid-owner');
      }
    });
    fixture.t.push({t:"changed",thread_ids:[handle.threadId],list:false});
    await flush();await flush();
    await settle(fixture.t,fixture.db);expect(await localSend).toBe(true);expect(readyCuts).toBeGreaterThan(0);stopPublication();stopPublication=()=>{};
    await act(async()=>render(<OrderedHistory model={fixture.model} handle={handle} win={reader} t={fixture.model.t.value}/>,stableHost));
    expect(stableHost).toBe(host);expect(stableHost.textContent).toContain("Independent user");expect(stableHost.textContent, JSON.stringify({ calls: fixture.t.calls("status").map(call=>call.args), records: handle.handoff.value, historyReads: fixture.t.calls("history.window").map(call=>call.args), handoffRetry: handle.handoffRetryState.value, accepted: reader.acceptedView.peek().displayPlan?.entries.map(entry=>[entry.item.source.kind,"text" in entry.item.source?entry.item.source.text:undefined]) })).toContain("Committed saved answer");
    expect(handle.handoff.value.some(record=>record.attemptId===turnOne)).toBe(false);
    expect(reader.acceptedView.peek().retiredAttempts?.some(record=>record.attemptId===turnOne)).toBe(true);
    const nextTurn:import("../../../data/src/protocol").ServerFrame={t:"live",thread_id:handle.threadId,attempt_id:"turn-two",gap:false,deltas:[{offset:0,reasoning:false,text:"Next turn preview"}]};
    fixture.t.push(nextTurn);await flush();await flush();
    await act(async()=>render(<OrderedHistory model={fixture.model} handle={handle} win={reader} t={fixture.model.t.value}/>,stableHost));
    expect(stableHost).toBe(host);expect(stableHost.textContent).toContain("Committed saved answer");expect(stableHost.textContent).toContain("Next turn preview");
    expect(handle.handoff.value.some(record=>record.attemptId==="turn-two"&&record.text==="Next turn preview"&&record.bodyAuthority==="preview")).toBe(true);
    reader.layoutChanged();await flush();
    reader.jumpToEnd();await settle(fixture.t,fixture.db);
    await act(async()=>render(<OrderedHistory model={fixture.model} handle={handle} win={reader} t={fixture.model.t.value}/>,stableHost));
    expect(stableHost).toBe(host);expect(stableHost.textContent).toContain('Independent user');
    expect(stableHost.textContent).toContain('Committed saved answer');expect(stableHost.textContent).toContain('Next turn preview');
    expect(handle.handoff.value.some(record=>record.attemptId===turnOne)).toBe(false);
    let echoCuts=0;
    stopPublication=reader.acceptedView.subscribe(snapshot=>{
      const plan=snapshot.displayPlan!;expect(reader.acceptedView.isCurrent(snapshot)).toBe(true);
      expect(plan.capability).toBe(reader.acceptedView.currentCapability);
      if(plan.localRegion.retire.length){
        echoCuts++;expect(plan.localRegion.retire.map(row=>row.operationId)).toEqual([operation]);
        expect(plan.localRegion.localRows).toEqual([]);expect(plan.localRegion.slots).toEqual([]);
        expect(plan.entries.some(entry=>entry.item.source.nodeId==='concurrent-local'&&entry.body.kind==='typed-canonical')).toBe(true);
        expect(fixture.model.acceptedOwnMessages.peek().map(row=>row.operationId)).toEqual([operation]);
      }
    });
    const echo:import('../../../data/src/protocol').HistoryItem={node_id:'concurrent-local',kind:'user',selection:{ordinal:2},
      items:[{kind:'text',item_identity:'echo',text:'Echo local cohort',text_complete:true}],provenance:{kind:'human',sender:{kind:'human'}}};
    fixture.db.history.lead=[user,saved,echo];fixture.t.push({t:'changed',thread_ids:[handle.threadId],list:false});
    await settle(fixture.t,fixture.db);expect(echoCuts).toBeGreaterThan(0);
    expect(fixture.model.acceptedOwnMessages.peek()).toHaveLength(0);
    await act(async()=>render(<OrderedHistory model={fixture.model} handle={handle} win={reader} t={fixture.model.t.value}/>,stableHost));
    expect(stableHost.textContent).toContain('Echo local cohort');expect(stableHost.querySelector('[data-pending-own-message]')).toBeNull();
    expect(stableHost.textContent).toContain('Next turn preview');

  } finally { stopPublication();render(null,host);host.remove();fixture.model.dispose();fixture.data.stop(); }
});

it('production model keeps latest answers and order after an older revision completes on the same host',async()=>{
 rendererGate.release();
 const user:import('../../../data/src/protocol').HistoryItem={node_id:'rollback-user',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'user-text',text:'Synthetic reader question',text_complete:true}],provenance:{kind:'human',sender:{kind:'human'}}};
 const older:import('../../../data/src/protocol').HistoryItem={node_id:'rollback-older',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'older-text',text:'Synthetic older answer',text_complete:true}],provenance:{kind:'assistant'}};
 const latest:import('../../../data/src/protocol').HistoryItem={node_id:'rollback-latest',kind:'assistant_response',selection:{ordinal:2},items:[{kind:'text',item_identity:'latest-text',text:'Synthetic latest answer',text_complete:true}],provenance:{kind:'assistant'}};
 const fixture=await fixtureModel({route:'conversation',threadId:'lead',configure:db=>{db.history.lead=[user,older];db.historyRevisions.lead=1;}});
 const host=document.createElement('div');document.body.append(host);
 try{
  const handle=fixture.model.handle.value!,reader=fixture.model.longReader.value!;
  const draw=()=>render(<OrderedHistory model={fixture.model} handle={handle} win={reader} t={fixture.model.t.value}/>,host);
  await act(async()=>draw());expect(host.textContent).toContain('Synthetic older answer');
  fixture.db.history.lead=[user,older,latest];fixture.db.historyRevisions.lead=2;
  reader.changed();await settle(fixture.t,fixture.db);await act(async()=>draw());
  expect(host.textContent).toContain('Synthetic latest answer');
  const accepted=reader.acceptedView.peek();expect(accepted.revision).toBe(2);
  const publications:{revision:number|undefined;ids:(string|undefined)[]}[]=[];
  const stop=reader.acceptedView.subscribe(ref=>publications.push({revision:ref.revision,ids:ref.rows.map(row=>row.node_id)}));
  try{
   reader.changed();await flush();
   const held=fixture.t.calls('history.window').filter(call=>!fixture.db.answered.has(call.id));
   expect(held).toHaveLength(1);
   fixture.db.answered.add(held[0]!.id);
   fixture.t.ok(held[0]!.id,{thread_id:'lead',revision:1,total:2,items:[older]});
   await flush();await act(async()=>draw());
   expect(reader.acceptedView.peek().revision).toBe(2);expect(host.textContent).toContain('Synthetic latest answer');
   await settle(fixture.t,fixture.db);reader.layoutChanged();reader.jumpToEnd();await settle(fixture.t,fixture.db);await act(async()=>draw());
   expect(host.textContent).toContain('Synthetic latest answer');
   expect(reader.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(['rollback-user','rollback-older','rollback-latest']);
   expect(publications.every(ref=>ref.revision===2&&ref.ids.includes('rollback-latest'))).toBe(true);
  }finally{stop();}
  reader.changed();await flush();
  const retiredCall=fixture.t.calls('history.window').filter(call=>!fixture.db.answered.has(call.id));
  expect(retiredCall).toHaveLength(1);fixture.db.answered.add(retiredCall[0]!.id);
  fixture.model.openThread('synthetic-other');await settle(fixture.t,fixture.db);
  fixture.model.openThread('lead');await settle(fixture.t,fixture.db);
  const replacement=fixture.model.longReader.value!,replacementHandle=fixture.model.handle.value!;
  expect(replacement).not.toBe(reader);
  await act(async()=>render(<OrderedHistory model={fixture.model} handle={replacementHandle} win={replacement} t={fixture.model.t.value}/>,host));
  const replacementView=replacement.acceptedView.peek();
  fixture.t.ok(retiredCall[0]!.id,{thread_id:'lead',revision:1,total:2,items:[user,older]});await flush();
  await act(async()=>render(<OrderedHistory model={fixture.model} handle={replacementHandle} win={replacement} t={fixture.model.t.value}/>,host));
  expect(replacement.acceptedView.peek()).toBe(replacementView);
  expect(host.textContent).toContain('Synthetic latest answer');
  expect(replacement.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(['rollback-user','rollback-older','rollback-latest']);
 }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('production model publishes only semantic changes across one history edge and layout',async()=>{
 const rows:import('../../../data/src/protocol').HistoryItem[]=Array.from({length:400},(_,ordinal)=>({
  node_id:`finite-${ordinal}`,kind:'user',selection:{ordinal},
  items:[{kind:'text',item_identity:'body',text:`Finite human ${ordinal}`,text_complete:true}],
  provenance:{kind:'human',sender:{kind:'human'}},
 }));
 const f=await fixtureModel({route:'conversation',threadId:'lead',configure:db=>{db.history.lead=rows;}});
 try{
  const reader=f.model.longReader.value!;let notifications=0,compositions=0;
  const publish=reader.captureConversationInput.bind(reader);
  reader.captureConversationInput=(...args)=>{compositions++;return publish(...args);};
  const stop=reader.acceptedView.subscribe(()=>notifications++);
  const sample=()=>({generation:reader.acceptedView.peek().generation,reads:f.t.calls('history.window').length,
   notifications,compositions,selected:reader.acceptedView.peek().rows.length});
  try{
   const before=sample(),first=reader.acceptedView.peek().range!.first;
   reader.layoutChanged();reader.measure([[first,40]]);reader.measure([[first,40]]);await flush();
   const layout=sample();
   reader.requestOlder();await settle(f.t,f.db);const edge=sample();
   reader.layoutChanged();reader.measure([[first,40]]);await flush();const unchanged=sample();
   console.log('PUBLICATION_STEPS',JSON.stringify({before,layout,edge,unchanged}));
   expect(layout).toEqual(before);
   expect(edge.reads-layout.reads).toBe(1);expect(edge.selected).toBe(200);
   expect(edge.generation-layout.generation).toBe(1);expect(edge.notifications-layout.notifications).toBe(1);
   expect(edge.compositions-layout.compositions).toBe(2);
   expect(unchanged).toEqual(edge);
   expect(reader.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(rows.slice(200).map(row=>row.node_id));
  }finally{stop();}
 }finally{f.model.dispose();f.data.stop();}
});


it('provides a Console-owned saved-text renderer without a fixture render callback',async()=>{
  const fixture=await publicConversationFixture({nodes:[{node_id:'synthetic-saved-node',kind:'assistant_response',selection:{ordinal:0},
    items:[{kind:'text',item_identity:'text-0',text:'Synthetic saved text without registry callback',text_complete:true}]}]}),host=document.createElement('div');document.body.append(host);
  try{
    const {SavedConversationItems}=await import('../screens/Conversation');expect(SavedConversationItems).toBeTypeOf('function');
    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    expect(host.textContent).toContain('Synthetic saved text without registry callback');
    expect(host.querySelector('[data-item-key]')?.getAttribute('data-node')).toBe('synthetic-saved-node');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('shows a deferred whole-node placeholder without exposing its unproved aggregate excerpt',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const screen=await import('../screens/Conversation') as unknown as Record<string,any>;
    expect(screen.DeferredHistoryNode).toBeTypeOf('function');const Deferred=screen.DeferredHistoryNode;
    const row:import('../../../data/src/protocol').HistoryItem={node_id:'synthetic-deferred',kind:'assistant_response',excerpt:'Synthetic unproved aggregate must stay hidden',selection:{ordinal:3},items:null,items_unavailable_reason:'response_budget'};
    await act(async()=>render(<Deferred model={fixture.model} row={row}/>,host));
    expect(host.querySelector('[data-items-unavailable-reason="response_budget"]')?.getAttribute('data-node')).toBe(row.node_id);
    expect(host.textContent).toContain(fixture.model.t.value('work.textUnavailable'));
    expect(host.textContent).not.toContain(row.excerpt!);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('keeps all execution IDs under the single authoritative tool item wrapper',async()=>{
  const fixture=await publicConversationFixture({nodes:[{node_id:'multi-node',kind:'assistant_response',selection:{ordinal:0},
    items:[{kind:'tool_call',item_identity:'multi-tool',execution_ids:['execution-one','execution-two']}]}]}),host=document.createElement('div');document.body.append(host);
  try{
    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    expect(host.querySelectorAll('[data-item-key]')).toHaveLength(1);
    expect([...host.querySelectorAll('[data-execution-id]')].map(el=>el.getAttribute('data-execution-id'))).toEqual(['execution-one','execution-two']);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('maps actual typed window rows without a registry and preserves ordinary/deferred node ordering',async()=>{
  const rows:import('../../../data/src/protocol').HistoryItem[]=[
      {node_id:'saved',kind:'assistant_response',selection:{ordinal:0},items:[{item_identity:'t0',kind:'text',text:'Actual typed saved content',text_complete:true}]},
      {node_id:'ordinary',kind:'user',excerpt:'Forbidden ordinary aggregate',selection:{ordinal:1},items:[{kind:'text',item_identity:'body',text:'Ordinary node survives',text_complete:true}]},
      {node_id:'deferred',kind:'assistant_response',excerpt:'Unproved deferred body',selection:{ordinal:2},items:null,items_unavailable_reason:'response_budget'},
    ];
  const fixture=await publicConversationFixture({nodes:rows}),host=document.createElement('div');document.body.append(host);
  try{

    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    expect(host.textContent).toContain('Actual typed saved content');expect(host.textContent).toContain('Ordinary node survives');
    expect(host.textContent).not.toContain('Unproved deferred body');expect(host.querySelector('[data-node="deferred"]')).not.toBeNull();
    const content=host.querySelector('[data-item-key]')!;expect(content.parentElement?.className).toBe('conversation-items');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});


it.each(['empty', 'reasoning', 'deferred', 'undefined', 'empty-window'] as const)('places explicit live Work exactly once with %s boundary input',async mode=>{
  const rows:import('../../../data/src/protocol').HistoryItem[]=mode==='empty-window'?[]:[
      {node_id:'boundary-node',kind:'assistant_response',selection:{ordinal:1},...(mode==='deferred'?{items:null,items_unavailable_reason:'response_budget' as const}:{items:mode==='reasoning'?[{item_identity:'reasoning',kind:'reasoning_unavailable' as const}]:[]})},
      {node_id:'later-human',kind:'user',selection:{ordinal:2},items:[{kind:'text',item_identity:'body',text:'Later human',text_complete:true}]},
    ];
  const fixture=await publicConversationFixture({nodes:mode==='deferred'?[rows[1]!,rows[0]!]:rows,work:[{kind:'progress',id:'live-record',thread_id:'lead',state:'running'}]}),host=document.createElement('div');document.body.append(host);
  try{

    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    const records=[...host.querySelectorAll('[data-work-item-key]')].filter(item=>item.getAttribute('data-item-key')?.includes('live-record'));
    expect(records).toHaveLength(1);expect(records[0]!.closest('[data-work-group]')).not.toBeNull();
    if(mode!=='empty-window')expect(host.textContent).toContain('Later human');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});


it('restores authoritative user Message chrome without substituting aggregate text for typed content',async()=>{
  const rows:import('../../../data/src/protocol').HistoryItem[]=[{node_id:'user-chrome',kind:'user',excerpt:'Aggregate must not replace item',provenance:{created_at:'2099-01-01T00:00:00Z',sender:{kind:'human'}},selection:{ordinal:0},items:[{item_identity:'user-text',kind:'text',text:'Authoritative typed user content',text_complete:true}]}];
  const fixture=await publicConversationFixture({nodes:rows}),host=document.createElement('div');document.body.append(host);
  try{

    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    const item=host.querySelector('[data-item-key]')!;
    expect(item.querySelector('.msg .av')).not.toBeNull();expect(item.querySelector('.who')?.textContent).toContain(fixture.model.t.value('convo.you'));
    expect(item.querySelector('.who small')).not.toBeNull();expect(item.querySelector('.msg-acts')).not.toBeNull();
    expect(item.classList.contains('conversation-row')).toBe(true);
    expect(item.textContent).toContain('Authoritative typed user content');expect(item.textContent).not.toContain('Aggregate must not replace item');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('restores Work group toggle with real parent containment and retains same-membership item DOM',async()=>{
  const fixture=await publicConversationFixture({nodes:[{node_id:'group-node',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'tool_call',item_identity:'tool-1',execution_ids:['group-exec-1']},{kind:'tool_call',item_identity:'tool-2',execution_ids:['group-exec-2']}]}]}),host=document.createElement('div');document.body.append(host);
  try{
    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    const details=host.querySelector('details[data-work-group]')! as HTMLDetailsElement,heading=details.querySelector('summary')!;
    expect(details).not.toBeNull();expect(details.open).toBe(false);
    const items=[...host.querySelectorAll('[data-item-key]')];expect(items).toHaveLength(2);
    expect(details.open).toBe(false);expect(items.every(item=>item.closest('[data-work-group]')===details)).toBe(true);
    expect(heading.querySelector('[data-item-key]')).toBeNull();
    const parent=items[0]!.parentElement;
    await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
    expect([...host.querySelectorAll('[data-item-key]')]).toEqual(items);
    expect(details.open).toBe(true);expect(items.every(item=>item.parentElement===parent)).toBe(true);
    await act(async()=>{details.open=false;details.dispatchEvent(new Event('toggle'));});
    expect([...host.querySelectorAll('[data-item-key]')]).toEqual(items);expect(details.open).toBe(false);expect(items.every(item=>item.closest('[data-work-group]')===details)).toBe(true);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it.each([['cold',''],['cold','Partial authoritative item'],['warm',''],['warm','Partial authoritative item']])('never replaces authorized item text in %s renderer: %j with a cached aggregate body',async (phase,text)=>{
  if(phase==='warm'){rendererGate.release();await act(async()=>{await import('../system/components/Message/markdown');await vi.dynamicImportSettled();});}
  const rows:import('../../../data/src/protocol').HistoryItem[]=[{node_id:'item-authority',kind:'user',provenance:{sender:{kind:'human'}},excerpt:'Forbidden aggregate excerpt',selection:{ordinal:0},items:[{item_identity:'text',kind:'text',text,text_complete:false}]}];
  const fixture=await publicConversationFixture({nodes:rows}),host=document.createElement('div');document.body.append(host);
  try{
    fixture.model.bodies.value=new Map([['item-authority',{text:'Forbidden cached aggregate body',loading:false,error:undefined}]]);
    const snapshot=fixture.model.longReader.peek()!.acceptedView.peek();
    expect(snapshot.rows).toMatchObject(rows);
    expect(snapshot.displayPlan?.entries[0]?.item.source).toMatchObject({kind:'user',text,textComplete:false});
    expect(snapshot.displayPlan?.entries[0]?.body).toMatchObject({kind:'typed-partial',text});
    expect(snapshot.assistantOwnership??[]).toEqual([]);expect(snapshot.retiredAttempts??[]).toEqual([]);
    expect(snapshot.displayPlan?.localRegion.retire??[]).toEqual([]);
    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    expect(host.textContent).not.toContain('Forbidden');expect(host.querySelector('.more')).toBeNull();
    expect(host.querySelector('[data-item-partial]')).not.toBeNull();
    const body=host.querySelector('.msg .md')!;
    if(phase==='cold'){
      expect(body.classList.contains('plain')).toBe(true);
      expect(host.querySelector('.msg .md')?.textContent??'').toBe(text);
    }else{
      expect(body.classList.contains('plain')).toBe(false);
      // Markdown's paragraph separator is renderer structure, not an extra source character.
      expect(body.innerHTML).toBe(text?'<p>Partial authoritative item</p>\n':'');
      expect(body.querySelectorAll('p')).toHaveLength(text?1:0);
      expect(body.querySelector('p')?.textContent??'').toBe(text);
    }
    const link=host.querySelector('.msg-acts a')!;expect(link.getAttribute('href')).toContain('item-authority');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it.each(['empty-user','reasoning-only','unknown-item'] as const)('keeps honest ordinary node presence for %s without aggregate fallback',async mode=>{
  const row:import('../../../data/src/protocol').HistoryItem={node_id:'quiet-node',kind:mode==='empty-user'?'user':'assistant_response',excerpt:'Forbidden private aggregate fallback',selection:{ordinal:0},items:mode==='empty-user'?[]:mode==='reasoning-only'?[{item_identity:'r',kind:'reasoning_unavailable'}]:[{item_identity:'unknown',kind:'unavailable',reason:'opaque'}]};
  const fixture=await publicConversationFixture({nodes:[row]}),host=document.createElement('div');document.body.append(host);
  try{

    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    expect(host.querySelector('[data-node="quiet-node"]')).not.toBeNull();expect(host.textContent).toContain(mode==='unknown-item'?'opaque':fixture.model.t.value(mode==='reasoning-only'?'work.reasoning':'work.textUnavailable'));
    expect(host.textContent).not.toContain('Forbidden');expect(host.querySelector('.more')).toBeNull();
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});


it('retains a no-execution tool as a visible unavailable item without inventing execution identity',async()=>{
  const fixture=await publicConversationFixture({nodes:[{node_id:'no-exec',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'tool_call',item_identity:'tool',execution_ids:[]}]}]}),host=document.createElement('div');document.body.append(host);
  try{
    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    expect(host.querySelectorAll('[data-item-key]')).toHaveLength(1);expect(host.querySelector('[data-execution-id]')).toBeNull();
    const heading=host.querySelector('summary[data-work-heading]')!;expect(heading.textContent).toContain(fixture.model.t.value('tools.count',{n:1}));expect(heading.textContent).not.toContain(fixture.model.t.value('work.textUnavailable'));expect(heading.textContent).not.toContain(fixture.model.t.value('status.completed'));
    const details=host.querySelector('details')!;await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
    expect(host.querySelector('[data-execution-unavailable]')?.textContent).toBe('Execution content was not provided');expect(host.querySelector('[data-execution-unavailable]')?.closest('[data-work-group]')).toBe(details);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('bounds output watches to opened tool details and preserves item DOM when membership changes',async()=>{
  const node:import('../../../data/src/protocol').HistoryItem={node_id:'watch-node',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'watch-item',execution_ids:['watched-execution']}],executions:[{execution_id:'watched-execution',command_excerpt:'synthetic watch',state:'running'}]};
  const fixture=await publicConversationFixture({nodes:[node]}),host=document.createElement('div');document.body.append(host);
  const original=fixture.model.watchOutput.bind(fixture.model);let active=0,maximum=0;
  fixture.model.toolStepChoices.value=new Map([['watched-execution',true]]);
  fixture.model.watchOutput=()=>{active++;maximum=Math.max(maximum,active);return()=>{active--;};};
  try{
    const projection=fixture.model.longReader.peek()!.acceptedView.peek().displayPlan!;
    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));const item=host.querySelector('[data-item-key]')!,parent=item.parentElement;
    expect(active).toBe(0);
    for(let i=0;i<3;i++){
      const details=host.querySelector('details.step-group')! as HTMLDetailsElement;
      await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});expect(active).toBe(1);
      await act(async()=>{details.open=false;details.dispatchEvent(new Event('toggle'));});expect(active).toBe(0);
    }
    const details=host.querySelector('details.step-group')! as HTMLDetailsElement;
    await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});expect(active).toBe(1);
    await act(async()=>{await fixture.publish({nodes:[{node_id:'preceding',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'preceding',execution_ids:['other-execution']}]},node]});render(<CurrentSavedView fixture={fixture}/>,host);});
    expect(active).toBe(0);const replacement=[...host.querySelectorAll('[data-item-key]')].find(el=>el.getAttribute('data-item-key')===projection.entries[0]!.item.key)!;
    expect(replacement).not.toBe(item);expect((replacement.closest('details') as HTMLDetailsElement).open).toBe(false);expect(maximum).toBe(1);
  }finally{render(null,host);expect(active).toBe(0);fixture.model.watchOutput=original;host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('does not claim completion for a closed local summary mixing proved and no-ID members',async()=>{
  const fixture=await publicConversationFixture({nodes:[{node_id:'mixed-summary',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'known',execution_ids:['known-execution']},{kind:'tool_call',item_identity:'unknown',execution_ids:[]}],executions:[{execution_id:'known-execution',state:'exited',exit_code:0}]}]}),host=document.createElement('div');document.body.append(host);
  try{
    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    const details=host.querySelector('details[data-work-group]')! as HTMLDetailsElement,heading=details.querySelector('summary')!;
    expect(details.open).toBe(false);expect(heading.textContent).toContain(fixture.model.t.value('tools.count',{n:2}));
    expect(heading.textContent).not.toContain(fixture.model.t.value('work.textUnavailable'));expect(heading.querySelector('[data-status="completed"]')).toBeNull();
    expect([...host.querySelectorAll('[data-item-key]')].every(item=>item.closest('[data-work-group]')===details)).toBe(true);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('contains saved Work in actual group parents even for a singleton and never drops thinking records',async()=>{
  const rows:import('../../../data/src/protocol').HistoryItem[]=[
      {node_id:'work-a',kind:'assistant_response',selection:{ordinal:0},items:[{item_identity:'think',kind:'reasoning_unavailable'},{item_identity:'tool',kind:'tool_call',execution_ids:[]}]},
      {node_id:'conversation',kind:'assistant_response',selection:{ordinal:1},items:[{item_identity:'text',kind:'text',text:'Authoritative answer',text_complete:true}]},
      {node_id:'work-b',kind:'assistant_response',selection:{ordinal:2},items:[{item_identity:'unknown',kind:'unavailable',reason:'unsupported'}]},
    ];
  const fixture=await publicConversationFixture({nodes:rows}),host=document.createElement('div');document.body.append(host);
  try{

    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    const groups=[...host.querySelectorAll('[data-work-group]')];expect(groups).toHaveLength(2);
    expect(host.querySelectorAll('[data-work-item-key]')).toHaveLength(3);
    for(const item of host.querySelectorAll('[data-work-item-key]'))expect(item.closest('[data-work-group]')).not.toBeNull();
    expect(host.querySelector('[data-thinking-marker]')).not.toBeNull();
    expect(host.querySelector('[data-node="conversation"]')?.closest('[data-work-group]')).toBeNull();
    expect(groups.every(group=>(group as HTMLDetailsElement).open===false)).toBe(true);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it.each(['live-only','mixed'] as const)('contains all %s Work facts and keeps authoritative live text outside Work',async mode=>{
  const rows:import('../../../data/src/protocol').HistoryItem[]=mode==='mixed'?[{node_id:'saved-work',kind:'assistant_response',selection:{ordinal:0},items:[{item_identity:'thinking',kind:'reasoning_unavailable'}]}]:[];
  const fixture=await publicConversationFixture({nodes:rows,work:[{kind:'shell',id:'shell-record',state:'running',thread_id:'lead',execution_id:'actual-exec'},{kind:'pending_message',id:'pending',state:'pending',thread_id:'lead',message_id:'pending-message'},{kind:'progress',id:'progress-record',state:'running',thread_id:'lead'}]}),host=document.createElement('div');document.body.append(host);
  try{
    fixture.t.push({t:'live',thread_id:'lead',attempt_id:'actual-stream-record',gap:false,deltas:[{offset:0,reasoning:false,text:'Authoritative live nonreasoning text'}]});await flush();await flush();
    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    const members=[...host.querySelectorAll('[data-work-item-key]')];expect(members).toHaveLength(mode==='mixed'?3:2);
    for(const item of members)expect(item.closest('details[data-work-group]')).not.toBeNull();
    expect(host.querySelectorAll('[data-work-group]')).toHaveLength(mode==='mixed'?2:1);
    expect(host.textContent).toContain('Authoritative live nonreasoning text');
    expect(host.querySelector('[data-live-overlay]')?.closest('[data-work-group]')).toBeNull();
    expect([...host.querySelectorAll('[data-item-key]')].some(item=>item.getAttribute('data-item-key')?.includes('pending'))).toBe(false);
    expect((host.querySelector('details[data-work-group]') as HTMLDetailsElement).open).toBe(false);
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});


it('retains original preview through identity lookup but never revives ready body after status changes',async()=>{
  const { Handoff }=await import('../../../data/src/handoff');
  const scheduled:(()=>void)[]=[];const ledger=new Handoff(callback=>scheduled.push(callback));
  const begin=(id:string)=>{ledger.apply({attempt_id:id,gap:false,deltas:[{offset:0,reasoning:false,text:'Synthetic stream text'}]});while(scheduled.length)scheduled.shift()!();};
  const fact=(id:string)=>projectOwnedHandoffFacts('owned-scope',ledger.records.value).find(item=>'domain' in item&&item.recordId===`handoff:${id}`)!;
  begin('stream');expect(fact('stream').kind).toBe('text');expect(fact('stream')).toMatchObject({attemptId:'stream'});expect('turnId' in fact('stream')).toBe(false);
  ledger.ready('stream','saved-node','Forbidden ready replacement');expect(fact('stream').kind).toBe('unknown');
  ledger.fail('stream');expect(fact('stream').kind).toBe('unknown');
  ledger.confirming('stream');expect(fact('stream').kind).toBe('unknown');
  begin('identified');ledger.identify('identified','reserved-node');expect(fact('identified')).toMatchObject({kind:'text',text:'Synthetic stream text'});
  expect(ledger.records.peek().find(record=>record.attemptId==='identified')).toMatchObject({nodeId:'reserved-node',bodyAuthority:'preview'});
  expect(projectOwnedHandoffFacts('owned-scope',ledger.records.value).some(item=>'text' in item&&item.text.includes('Forbidden'))).toBe(false);
  ledger.discard('ended');
});

it('retains the actual response budget reason in closed and open saved Work without aggregate fallback',async()=>{
  const rows:import('../../../data/src/protocol').HistoryItem[]=[{node_id:'budget-reason',kind:'assistant_response',excerpt:'Forbidden deferred aggregate',selection:{ordinal:0},items:null,items_unavailable_reason:'response_budget'}];
  const fixture=await publicConversationFixture({nodes:rows}),host=document.createElement('div');document.body.append(host);
  try{

    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    const details=host.querySelector('details[data-work-group]')! as HTMLDetailsElement;
    expect(details.open).toBe(false);expect(details.querySelector('summary')?.textContent).not.toContain('response_budget');
    expect(host.textContent).not.toContain('Forbidden');
    await act(async()=>{details.open=true;details.dispatchEvent(new Event('toggle'));});
    expect(details.querySelector('[data-items-unavailable-reason="response_budget"]')).not.toBeNull();
    expect(details.textContent).toContain('response_budget');expect(details.textContent).not.toContain('Forbidden');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('renders actual incomplete and qualified retry state without granting ready text live authority',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const screen=await import('../screens/Conversation') as unknown as Record<string,any>;
    expect(screen.LiveRecordChrome).toBeTypeOf('function');
    const { Handoff }=await import('../../../data/src/handoff');const callbacks:(()=>void)[]=[];
    const ledger=new Handoff(callback=>callbacks.push(callback));
    ledger.apply({attempt_id:'chrome',gap:true,deltas:[{offset:0,reasoning:false,text:'Stream body'}]});while(callbacks.length)callbacks.shift()!();
    ledger.fail('chrome');const record=ledger.records.value[0]!;let retries=0;
    const qualifiedModel=new Proxy(fixture.model,{get(target,key){return key==='handle'?{value:{handoffRetryState:{value:{phase:'failed',reason:'lookup-failed',canRetry:true}},retryHandoff:async()=>{retries++;}}}:Reflect.get(target,key);}});
    await act(async()=>render(<screen.LiveRecordChrome model={qualifiedModel} record={record} retry={()=>{throw Error('unqualified retry callback');}}/>,host));
    expect(host.textContent).toContain(fixture.model.t.value('convo.liveIncomplete'));
    expect(host.textContent).toContain(fixture.model.t.value('convo.retry.lookup-failed'));
    expect(host.textContent).not.toContain(fixture.model.t.value('convo.handoffLimit'));
    const retry=host.querySelector('button')!;expect(retry.textContent).toContain(fixture.model.t.value('action.retry'));
    await act(async()=>{retry.dispatchEvent(new MouseEvent('click',{bubbles:true}));});expect(retries).toBe(1);
    expect(host.textContent).not.toContain('Stream body');expect(host.querySelector('[role="status"]')).toBeNull();
    ledger.discard('ended');
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('keeps one identical footer element through known states and unknown loading or disconnected frames',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  try{
    const screen=await import('../screens/Conversation') as unknown as Record<string,any>;
    expect(screen.ConversationStatus).toBeTypeOf('function');
    const base=fixture.model.selectedRow.value!;const selected=signal<typeof fixture.model.selectedRow.value>(base);
    const model=new Proxy(fixture.model,{get(target,key){return key==='selectedRow'?selected:key==='threadReplies'?{value:[]}:Reflect.get(target,key);}});
    let original:Element|undefined;
    for(const state of ['idle',undefined,'running',undefined,'completed',undefined,'idle'] as const){
      selected.value=state?{...base,status:state}:undefined;
      await act(async()=>render(<screen.ConversationStatus model={model}/>,host));
      const footer=host.querySelector('.conversation-status')!;expect(footer).not.toBeNull();
      if(original)expect(footer).toBe(original);else original=footer;
      expect(host.querySelectorAll('.conversation-status')).toHaveLength(1);
      if(!state){expect(footer.textContent?.trim()).toBe('');expect(footer.querySelector('img,button')).toBeNull();}
    }
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('publishes saved rows and whole-attempt retirement in the same DOM frame, retaining partial and invalid-scope overlays',async()=>{
 rendererGate.release();await import('../system/components/Message/markdown');await vi.dynamicImportSettled();
 const {attemptWork}=await import('../../../data/test/work-fixture');
 const independent:import('../../../data/src/protocol').HistoryItem={node_id:'independent',kind:'user',items:[{kind:'text',item_identity:'text',text:'Independent user',text_complete:true}]};
 const attemptId=canonicalAttemptId(1);
 const saved:import('../../../data/src/protocol').HistoryItem={node_id:'saved-answer',kind:'assistant_response',provenance:{attempt_id:attemptId},items:[{kind:'text',item_identity:'answer',text:'Committed saved answer',text_complete:true}]};
 for(let frame=0;frame<5;frame++){
  const nodes=frame===0?[independent]:[independent,frame===1?{...saved,items:null,items_unavailable_reason:'response_budget' as const}:saved];
  const f=await publicConversationFixture({nodes,work:[{kind:'progress',id:'live-work',thread_id:'lead',state:'running',attempt_id:attemptId,turn_id:'turn'}]});
  const host=document.createElement('div');document.body.append(host);
  const reader=f.model.longReader.peek()!,handle=f.model.handle.peek()!,scope=handle.handoffScope();
  const cuts=new Map<number,WindowAcceptedSnapshot>();let stop=()=>{};
  const fixed=(snapshot:WindowAcceptedSnapshot)=>{
   const canonical=snapshot.assistantOwnership?.some(owner=>owner.attemptId===attemptId&&owner.mode==='canonical');
   expect(snapshot.displayPlan!.entries.flatMap(entry=>entry.body.kind==='unavailable'||entry.body.text===''?[]:[entry.body.text])).toEqual([
    'Independent user',...(frame>=2?['Committed saved answer']:[]),...(!canonical?['Whole live answer']:[])]);
   for(const owner of snapshot.assistantOwnership??[]){
    expect(owner).toMatchObject({scope,attemptId:attemptId,turnId:'turn',refs:[{nodeId:'saved-answer',ordinal:1,kind:'assistant_response'}]});
    expect(snapshot.retiredAttempts?.some(retired=>retired.recordKey===owner.recordKey&&retired.containerKey===owner.containerKey)
      ||handle.handoff.peek().some(record=>record.key===owner.recordKey&&handle.isDisplayOwnershipCurrent(record,snapshot.generation))).toBe(true);
   }
  };
  const captureDom=()=>{
   const generation=host.querySelector('[data-fixture-accepted-generation]')?.getAttribute('data-fixture-accepted-generation');
   if(generation===undefined||generation===null)return;
   const cut=cuts.get(Number(generation));expect(cut).toBeDefined();
   expect(host.textContent).toContain('Independent user');
   if(frame>=2)expect(host.textContent).toContain('Committed saved answer');
   expect(host.textContent?.includes('Whole live answer')).toBe(!cut!.assistantOwnership?.some(owner=>owner.attemptId===attemptId&&owner.mode==='canonical'));
  };
  const observer=new MutationObserver(captureDom);
  try{
   f.t.push({t:'live',thread_id:'lead',attempt_id:attemptId,gap:false,deltas:[{offset:0,reasoning:false,text:'Whole live answer'}]});await flush();await flush();
   const initial=reader.acceptedView.peek(),initialRows=JSON.stringify(initial.rows),original=handle.handoff.peek()[0]!;cuts.set(initial.generation,initial);fixed(initial);
   stop=reader.acceptedView.subscribe(snapshot=>{expect(reader.acceptedView.isCurrent(snapshot)).toBe(true);fixed(snapshot);cuts.set(snapshot.generation,snapshot);});
   observer.observe(host,{subtree:true,childList:true,characterData:true,attributes:true});
   await act(async()=>render(<CurrentSavedView fixture={f}/>,host));captureDom();
   if(frame>=2){
    f.db.work.lead=[{...attemptWork({threadId:'lead',attemptId:attemptId,turnId:'turn',state:'completed',truncated:frame!==4,
      refs:[{node_id:'saved-answer',ordinal:1,kind:'assistant_response'}]})}];
    await act(async()=>{f.t.push({t:'live_end',thread_id:'lead'});await settle(f.t,f.db);});
   }
   const snapshot=reader.acceptedView.peek();captureDom();
   if(frame===2||frame===3){
    const receipt=snapshot.terminalPersistedAttempts![0]!;expect(receipt).toMatchObject({scope,attemptId:attemptId,turnId:'turn',recordKey:original.key});
    const bad=frame===2?{...receipt,scope:'other-lifetime'}:{...receipt,turnId:'other-turn'};
    const count=f.t.calls('history.window').length,ref=reader.acceptedView.peek();
    expect('state' in reader.prepareBoundTerminalRead(bad)).toBe(false);
    expect(reader.acceptHandoff({...original,terminalPersisted:bad},scope,()=>{throw new Error('invalid receipt released an original');})).toBe(false);
    expect(reader.acceptedView.peek()).toBe(ref);expect(f.t.calls('history.window')).toHaveLength(count);captureDom();
   }
   expect(host.textContent?.includes('Whole live answer'),`frame ${frame}`).toBe(frame!==4);
   expect(host.querySelectorAll('[data-work-item-key]')).toHaveLength(frame===4?0:frame===1?2:1);
   if(frame===4){
    expect(snapshot.retiredAttempts).toMatchObject([{scope,attemptId:attemptId,turnId:'turn',recordKey:original.key,containerKey:original.presentationContainer}]);
    expect(snapshot.displayPlan?.entries.find(entry=>entry.item.key===JSON.stringify(['saved-answer','answer']))?.presentationContainer).toBe(original.presentationContainer);
    const facts=normalizeLiveWorkFacts({scope:'lead',items:handle.work.peek().value?.items??[]});
    reader.dispose();expect(reader.acceptedView.isCurrent(snapshot)).toBe(false);
    expect(retainUnretiredLiveFacts(snapshot,scope,false,facts)).toEqual(facts);
    await act(async()=>render(<ActualSavedWindowContent model={f.model} snapshot={snapshot}/>,host));
    expect(host.textContent).not.toContain('Whole live answer');expect(host.textContent).not.toContain('Committed saved answer');
   }
   expect(JSON.stringify(initial.rows)).toBe(initialRows);
   if(frame>=2)expect(reader.acceptedView.isCurrent(initial)).toBe(false);
  }finally{observer.disconnect();stop();render(null,host);host.remove();f.model.dispose();f.data.stop();}
 }
});


it('retains the actual tool element and open group when thinking prepends under a scoped first-tool identity',async()=>{
  const tool:import('../../../data/src/protocol').HistoryItem={node_id:'actual-tool-node',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'actual-tool-item',execution_ids:['exec-structural']}]};
  const fixture=await publicConversationFixture({nodes:[tool]}),host=document.createElement('div');document.body.append(host);
  try{
    const before=fixture.model.longReader.peek()!.acceptedView.peek().displayPlan!;
    await act(async()=>render(<CurrentSavedView fixture={fixture}/>,host));
    const group=host.querySelector('details[data-work-group]')! as HTMLDetailsElement;
    await act(async()=>{group.open=true;group.dispatchEvent(new Event('toggle'));});
    const item=host.querySelector('[data-work-item-key]')!;
    await act(async()=>{await fixture.publish({nodes:[{node_id:'thinking-node',kind:'reasoning_unavailable'},tool]});render(<CurrentSavedView fixture={fixture}/>,host);});
    expect(host.querySelector('details[data-work-group]')).toBe(group);expect(group.open).toBe(true);
    expect([...host.querySelectorAll('[data-work-item-key]')].find(el=>el.getAttribute('data-item-key')===before.entries[0]!.item.key)).toBe(item);
    expect(item.getAttribute('data-node')).toBe('actual-tool-node');
    expect(host.querySelector('[data-thinking-marker]')).not.toBeNull();
  }finally{render(null,host);host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('defaults a running structural tool detail to closed without subscribing output',async()=>{
  const fixture=await fixtureModel(),host=document.createElement('div');document.body.append(host);
  let watches=0;const watch=fixture.model.watchOutput.bind(fixture.model);fixture.model.watchOutput=()=>{watches++;return()=>{watches--;};};
  try{
    const { StepView }=await import('../screens/Conversation');
    const base=fixture.model.conversation.value.flatMap(row=>row.type==='steps'?row.steps:[])[0]!;
    const {projectLegacyHistoryItems}=await import('../../../ui-core/src/conversation-items');
    const {workElementDisplay}=await import('../../../ui-core/src/work-element-display');
    const issued=projectLegacyHistoryItems({nodes:[{node_id:'controlled-tool',kind:'assistant_response',items:[{kind:'tool_call',item_identity:'call',execution_ids:[base.executionId]}],executions:[{execution_id:base.executionId,state:'running',command_excerpt:base.command}]}]}).projection.items[0]!;
    const display=workElementDisplay(issued)!;
    await act(async()=>render(<StepView model={fixture.model} step={{...base,status:'running'}} display={display}/>,host));
    expect((host.querySelector('details.work-element-row') as HTMLDetailsElement).open).toBe(false);expect(watches).toBe(0);
  }finally{render(null,host);fixture.model.watchOutput=watch;host.remove();fixture.model.dispose();fixture.data.stop();}
});

it('keeps typed assistant empty/presence membership distinct across live, terminal, saved, refresh and revoke',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 type Node=import('../../../data/src/protocol').HistoryItem;
 const old:Node={node_id:'prior-answer',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'text',item_identity:'prior',text:'Already readable answer',text_complete:true}]};
 let nodes:Node[]=[old],revision=1;
 const reader=new ConversationWindow({read:async()=>({ok:true,value:ownedHistory({thread_id:'t',revision,total:nodes.length,items:nodes})})});
 const model=new Proxy(f.model,{get(target,key){return key==='longReader'?{value:reader,peek:()=>reader}:Reflect.get(target,key);}});
 const ledger=new Handoff(fn=>fn());
 const frames:unknown[]=[];
 reader.bindConversationInput(snapshot=>captureConversationInput(snapshot,{scope:'fixture',threadId:'t',records:ledger.records.peek(),work: EMPTY_WORK_DESCRIPTOR,current:true}));
 const paint=()=>{const snapshot=reader.acceptedView.peek();render(<ActualSavedWindowContent model={model} snapshot={snapshot}/>,host);};
 let stop=()=>{};
 try{
  await act(async()=>{await Promise.resolve();await Promise.resolve();paint();});
  const oldElement=host.querySelector('[data-node="prior-answer"]');expect(oldElement).not.toBeNull();
  const record=(text:string)=>ledger.apply({attempt_id:'stable-live',gap:false,deltas:[{offset:0,reasoning:false,text}]});
  const frame=async(label:string)=>{
   await act(async()=>{reader.refreshConversationInput(reader.acceptedView.peek());paint();});
   frames.push({frame:frames.length,label,current:reader.acceptedView.isCurrent(reader.acceptedView.peek()),messages:host.querySelectorAll('.msg').length,presence:host.querySelectorAll('[data-assistant-presence]').length,keys:[...host.querySelectorAll('[data-item-key]')].map(row=>row.getAttribute('data-item-key'))});
   expect(host.querySelector('[data-node="prior-answer"]')).toBe(oldElement);
  };
  record('');await frame('empty-live');expect(host.querySelectorAll('.msg')).toHaveLength(1);expect(host.querySelector('[data-assistant-presence]')?.textContent).toContain(f.model.t.value('convo.live'));
  const liveRow=host.querySelector('[data-assistant-presence]')!.closest('[data-item-key]');
  record('New live answer');await frame('live-text');expect(host.querySelectorAll('.msg')).toHaveLength(2);expect(host.querySelector('[data-live-overlay]')?.closest('[data-item-key]')).toBe(liveRow);
  ledger.discard('ended');await frame('terminal-live-off');expect(host.textContent).not.toContain('New live answer');
  stop=reader.acceptedView.subscribe(()=>paint());
  nodes=[old,{node_id:'saved-answer',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'saved',text:'Saved readable answer',text_complete:true}]},{node_id:'empty-complete',kind:'assistant_response',selection:{ordinal:2},items:[{kind:'text',item_identity:'empty',text:'',text_complete:true}]},{node_id:'empty-partial',kind:'assistant_response',selection:{ordinal:3},items:[{kind:'text',item_identity:'partial',text:'',text_complete:false}]}];revision++;
  await act(async()=>{reader.changed();await new Promise(resolve=>setTimeout(resolve,0));});await frame('saved');
  expect(host.querySelector('[data-node="empty-complete"]')).toBeNull();expect(host.querySelector('[data-assistant-content-unavailable]')).not.toBeNull();expect(host.querySelectorAll('.msg')).toHaveLength(2);
  const saved=host.querySelector('[data-node="saved-answer"]');await act(async()=>{reader.changed();await new Promise(resolve=>setTimeout(resolve,0));});await frame('refresh');expect(host.querySelector('[data-node="saved-answer"]')).toBe(saved);
  await act(async()=>{reader.dispose();paint();});expect(host.textContent).not.toContain('Already readable answer');expect(host.textContent).not.toContain('Saved readable answer');
 }finally{console.log('ASSISTANT_MEMBERSHIP_FRAMES',JSON.stringify(frames));stop();render(null,host);ledger.discard('ended');reader.dispose();host.remove();f.model.dispose();f.data.stop();}
});

it('publishes a newly appended readable assistant after a hint held during path recovery without another input',async()=>{
 const {rig}=await import('../../../ui-core/test/window-owner');
 const r=await rig(1),f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 const frames:unknown[]=[];
 r.owner.decorate=(i,node)=>({...node,kind:'assistant_response',items:[{kind:'text',item_identity:`body-${i}`,text:i===0?'Recovered prior answer':'New completed answer',text_complete:true}]});
 const model=new Proxy(f.model,{get(target,key){return key==='longReader'?{value:r.w,peek:()=>r.w}:Reflect.get(target,key);}});
 const paint=()=>{
  const snapshot=r.w.acceptedView.peek();
  render(<ActualSavedWindowContent model={model} snapshot={snapshot}/>,host);
  frames.push({frame:frames.length,current:r.w.acceptedView.isCurrent(snapshot),raw:snapshot.rows.map(row=>row.node_id),mounted:[...host.querySelectorAll('[data-node]')].map(row=>row.getAttribute('data-node')),reads:r.calls().length});
 };
 const stop=r.w.acceptedView.subscribe(paint);
 try{
  await act(async()=>{await r.settle();paint();});expect(host.textContent).toContain('Recovered prior answer');
  const prior=r.w.acceptedView.peek();
  r.owner.rewrite(1);
  await act(async()=>{r.w.changed();await flush();});
  const stale=r.calls().at(-1)!,rejected=r.owner.answer(stale);expect(rejected.ok).toBe(false);
  r.owner.answered.add(stale.id);
  await act(async()=>{if(!rejected.ok)r.t.ownerError(stale.id,rejected.code,rejected.code,rejected.details);await flush();});
  expect(r.w.acceptedView.isCurrent(prior)).toBe(false);expect(host.textContent).not.toContain('Recovered prior answer');
  const recovery=r.calls().at(-1)!,oldReply=r.owner.answer(recovery);expect(oldReply.ok).toBe(true);
  r.owner.append(1);
  await act(async()=>{r.w.changed();await flush();});const before=r.calls().length;
  r.owner.answered.add(recovery.id);
  await act(async()=>{if(oldReply.ok)r.t.ok(recovery.id,oldReply.result);await flush();});
  expect(r.calls().length).toBeGreaterThan(before);
  await act(async()=>{await r.settle();paint();});
  expect(host.textContent).toContain('Recovered prior answer');expect(host.textContent).toContain('New completed answer');
  expect(r.w.acceptedView.isCurrent(r.w.acceptedView.peek())).toBe(true);
  expect(host.querySelector('[data-node="n1-1"] .md')?.textContent).toContain('New completed answer');
 }finally{console.log('RECOVERY_HINT_FRAMES',JSON.stringify(frames));stop();render(null,host);host.remove();r.w.dispose();r.data.stop();f.model.dispose();f.data.stop();}
});
