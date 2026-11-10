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
for(const mode of ['ready','ready-with-change','reentry','wrong-lifetime','partial','deferred'] as const)it(`real Store/O/model/Window -> App whole attempt under ${mode}`,async()=>{
 let ended=false;
 const f=await fixtureModel({capabilities:['history.window'],configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];const base=db.answer.bind(db);db.answer=call=>{
  if(call.command==='status')return {ok:true,result:{items:ended?[{kind:'attempt',id:'attempt',attempt_id:'attempt',turn_id:'turn',thread_id:'t',state:'completed',response_nodes_truncated:false,response_nodes:[{node_id:'answer',ordinal:0,kind:'message'},{node_id:'tool',ordinal:1,kind:'function_call'},{node_id:'answer',ordinal:2,kind:'message'}]}]:[]}};
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
  sample();ended=true;
  await act(async()=>{f.t.push({t:'live_end',thread_id:'t'});await flush(24);});sample();
  // Hold every authoritative item read while resolving only non-history operations.
  for(let n=0;n<8;n++){await act(async()=>{for(const call of f.t.calls().filter(c=>!f.db.answered.has(c.id)&&c.command!=='history.window')){const out=f.db.answer(call);f.db.answered.add(call.id);if(out.ok)f.t.ok(call.id,out.result);else f.t.ownerError(call.id,out.code,out.message);}await flush();});sample();}
  expect(frames.every(frame=>frame.independent&&frame.live&&!frame.retired)).toBe(true);
  if(mode==='ready-with-change')await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await flush();});
  const publications:{rows:string[];retired:number}[]=[];let reentered=false;
  const reentryStop=mode==='reentry'?win.acceptedView.subscribe(ref=>{if(!reentered&&ref.retiredAttempts?.length){reentered=true;win.layoutChanged();}}):()=>{};
  if(mode==='wrong-lifetime')f.model.handle.peek()!.pause();
  const stop=win.acceptedView.subscribe(ref=>publications.push({rows:ref.rows.map(row=>row.node_id!),retired:ref.retiredAttempts?.length??0}));
  await act(async()=>{await settle(f.t,f.db);await flush(24);});sample();stop();reentryStop();
  expect(frames.every(frame=>frame.independent)).toBe(true);
  if(mode==='ready'){expect(publications.length).toBeGreaterThan(0);expect(publications.every(frame=>!frame.rows.includes('answer')||frame.retired===1)).toBe(true);expect(frames.every(frame=>frame.live!==frame.saved)).toBe(true);}
  if(mode==='ready'||mode==='ready-with-change'){

   expect(host.textContent).toContain('Qualified saved answer');expect(host.textContent).not.toContain('Whole live answer');
   expect(win.acceptedView.peek().retiredAttempts).toHaveLength(1);
   expect(publications.filter(frame=>frame.retired).every(frame=>JSON.stringify(frame.rows)===JSON.stringify(['independent','tool','answer']))).toBe(true);
  }else if(mode==='reentry'){expect(reentered).toBe(true);expect(win.acceptedView.peek().retiredAttempts?.every(proof=>proof.attemptId==='attempt'&&proof.turnId==='turn')).toBe(true);expect(host.textContent).toContain('Independent saved user');}else{expect(host.textContent).toContain('Whole live answer');expect(win.acceptedView.peek().retiredAttempts??[]).toHaveLength(0);}
  expect(f.t.calls('history.get')).toHaveLength(0);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
