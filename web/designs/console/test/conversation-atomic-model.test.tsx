// @vitest-environment happy-dom
import '@preact/signals';
import {signal} from '@preact/signals-core';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import {fixtureModel} from '../../../ui-core/test/fixture';
import {summary,details,flush,settle} from '../../../data/test/harness';
import type {HistoryItem} from '../../../data/src/protocol';
import type {DesignContext} from '../../../ui-core/src';
import {App} from '../screens/App';
import {loadPrefs} from '../../../ui-core/src/prefs';

const independent:HistoryItem={node_id:'independent',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'u',text:'Independent saved user',text_complete:true}]};
const saved:HistoryItem[]=[independent,{node_id:'tool',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'tool_call',item_identity:'call',execution_ids:['exec']}]},{node_id:'answer',kind:'assistant_response',selection:{ordinal:2},items:[{kind:'text',item_identity:'answer-text',text:'Qualified saved answer',text_complete:true}]}];
for(const mode of ['ready','ready-with-change','reentry','wrong-lifetime','partial','deferred','truncated','empty-refs','nonterminal','wrong-thread'] as const)it(`real Store/O/model/Window -> App whole attempt under ${mode}`,async()=>{
 let ended=false;
 const f=await fixtureModel({capabilities:['history.window'],configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];const base=db.answer.bind(db);db.answer=call=>{
  if(call.command==='status')return {ok:true,result:{items:ended?[{kind:'attempt',id:'attempt',attempt_id:'attempt',turn_id:'turn',thread_id:mode==='wrong-thread'?'other-thread':'t',state:mode==='nonterminal'?'running':'completed',response_nodes_truncated:mode==='truncated',response_nodes:mode==='empty-refs'?[]:[{node_id:'answer',ordinal:0,kind:'message'},{node_id:'tool',ordinal:1,kind:'function_call'},{node_id:'answer',ordinal:2,kind:'message'}]}]:[]}};
  if(call.command==='history.window')return {ok:true,result:{thread_id:'t',revision:7,total:ended?3:1,items:!ended?[independent]:mode==='partial'?[independent,saved[1],{...saved[2],items:[{kind:'text',item_identity:'answer-text',text:'prefix',text_complete:false}]}]:mode==='deferred'?[independent,saved[1],{...saved[2],items:null,items_unavailable_reason:'response_budget'}]:saved}};
  return base(call);
 };}});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 const frames:{independent:boolean;live:boolean;saved:boolean;retired:number}[]=[];
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const win=f.model.longReader.peek()!;expect(win).toBeDefined();
  await act(async()=>{f.t.push({t:'live',thread_id:'t',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'Whole live answer'}]});await flush(24);});
  expect(host.textContent).toContain('Whole live answer');expect(host.textContent).toContain('Independent saved user');
  const sample=()=>frames.push({independent:host.textContent!.includes('Independent saved user'),live:host.textContent!.includes('Whole live answer'),saved:host.textContent!.includes('Qualified saved answer'),retired:win.acceptedView.peek().retiredAttempts?.length??0});
  sample();if(mode==='wrong-lifetime')f.model.handle.peek()!.pause();ended=true;
  await act(async()=>{f.t.push({t:'live_end',thread_id:'t'});await flush(24);});sample();
  // Hold every authoritative item read while resolving only non-history operations.
  for(let n=0;n<8;n++){await act(async()=>{for(const call of f.t.calls().filter(c=>!f.db.answered.has(c.id)&&c.command!=='history.window')){const out=f.db.answer(call);f.db.answered.add(call.id);if(out.ok)f.t.ok(call.id,out.result);else f.t.ownerError(call.id,out.code,out.message);}await flush();});sample();}
  const eligible=!['wrong-lifetime','empty-refs','nonterminal','wrong-thread'].includes(mode);
  const terminal=win.acceptedView.peek().terminalPersistedAttempts??[];
  if(eligible){expect(terminal).toHaveLength(1);expect(host.textContent).toContain('Whole live answer');}
  else {expect(terminal).toHaveLength(0);expect(host.textContent).toContain('Whole live answer');}
  expect(host.textContent).toContain('Independent saved user');
  let reentered=false;
  const stop=mode==='reentry'?win.acceptedView.subscribe(()=>{if(!reentered){reentered=true;win.layoutChanged();}}):()=>{};
  if(mode==='reentry')await act(async()=>{win.layoutChanged();await flush();});
  await act(async()=>{await settle(f.t,f.db);await flush(24);});sample();stop();
  expect(frames.every(frame=>frame.independent)).toBe(true);
  if(eligible){
   expect(win.acceptedView.peek().terminalPersistedAttempts).toHaveLength(1);
   // A later canonical cut does not inherit the earlier lookup's association.
   // Requalify only through existing explicit Retry admission, not an automatic refill.
   await act(async()=>{const retry=f.model.handle.peek()!.retryHandoff();await settle(f.t,f.db);await retry;await flush(24);});sample();
   if(['ready','ready-with-change'].includes(mode)){
    expect(host.textContent).not.toContain('Whole live answer');expect(host.textContent).toContain('Qualified saved answer');
    expect(f.model.handle.peek()!.handoff.peek()).toHaveLength(1);
   }else {
    expect(host.textContent).toContain('Whole live answer');
    if(mode==='reentry')expect(win.acceptedView.peek().assistantOwnership??[]).toHaveLength(0);
   }
  }
  expect(frames.every(frame=>frame.live||frame.saved)).toBe(true);
  if(mode==='reentry')expect(reentered).toBe(true);
  expect(f.t.calls('history.get')).toHaveLength(0);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

for(const scenario of ['persisted','failed','separate-attempt','owner-lifetime','other-attempt-member'] as const)it(`actual scoped pending presentation: ${scenario}`,async()=>{
 let ended=false;
 const member:HistoryItem={node_id:'member',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'member-text',text:'Saved member fragment',text_complete:true}]};
 const otherMember:HistoryItem={node_id:'other-member',kind:'assistant_response',selection:{ordinal:2},items:[{kind:'text',item_identity:'other-text',text:'Other attempt saved text',text_complete:true}]};
 const f=await fixtureModel({capabilities:['history.window'],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];
  const base=db.answer.bind(db);db.answer=call=>{
   if(call.command==='status')return {ok:true,result:{items:ended?[{kind:'attempt',id:'attempt',attempt_id:scenario==='separate-attempt'?'retry-attempt':'attempt',turn_id:'turn',thread_id:'t',state:scenario==='failed'?'failed':'completed',response_nodes_truncated:false,response_nodes:[{node_id:'member',ordinal:1,kind:'message'}]},...(scenario==='other-attempt-member'?[{kind:'attempt',id:'previous-attempt',attempt_id:'previous-attempt',turn_id:'previous-turn',thread_id:'t',state:'completed',response_nodes_truncated:false,response_nodes:[{node_id:'other-member',ordinal:2,kind:'message'}]}]:[])]:[]}};
   if(call.command==='history.window')return {ok:true,result:{thread_id:'t',revision:8,total:scenario==='other-attempt-member'?3:2,items:scenario==='other-attempt-member'?[independent,member,otherMember]:[independent,member]}};
   return base(call);
  };
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  expect(host.textContent).toContain('Saved member fragment');
  await act(async()=>{f.t.push({t:'live',thread_id:'t',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'Whole live answer'}]});await flush(24);});
  if(scenario==='owner-lifetime')f.model.handle.peek()!.pause();
  ended=true;await act(async()=>{f.t.push({t:'live_end',thread_id:'t'});await flush(24);});
  // Deliver the genuine attempt fact but hold all subsequent item readback.
  await act(async()=>{for(let n=0;n<6;n++){for(const call of f.t.calls().filter(c=>!f.db.answered.has(c.id)&&c.command!=='history.window')){const out=f.db.answer(call);f.db.answered.add(call.id);if(out.ok)f.t.ok(call.id,out.result);else f.t.ownerError(call.id,out.code,out.message);}await flush();}});
  const snapshot=f.model.longReader.peek()!.acceptedView.peek();
  expect(snapshot.rows.some(row=>row.node_id==='member')).toBe(true);
  expect(snapshot.attemptPresentations??[]).toHaveLength(0);
  if(scenario==='failed'||scenario==='persisted'||scenario==='other-attempt-member'){expect(snapshot.terminalPersistedAttempts).toHaveLength(1);expect(host.textContent).not.toContain('Whole live answer');}
  expect(host.textContent).toContain('Independent saved user');
  expect(snapshot.retiredAttempts??[]).toHaveLength(0);
  if(scenario==='other-attempt-member'){expect(snapshot.rows.some(row=>row.node_id==='other-member')).toBe(true);expect(snapshot.attemptPresentations?.every(fact=>!fact.nodeIds.includes('other-member'))).toBe(true);expect(host.textContent).toContain('Other attempt saved text');}
  expect(host.textContent).toContain('Saved member fragment');
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
