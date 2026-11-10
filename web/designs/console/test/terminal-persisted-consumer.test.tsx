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
import {loadPrefs} from '../../../ui-core/src/prefs';
import {App} from '../screens/App';

for(const mode of ['truncated','partial','budget','nonterminal','empty','wrong-attempt'] as const)it(`actual terminal persisted consumer: ${mode}`,async()=>{
 let ended=false;
 const nodes:HistoryItem[]=[
  {node_id:'user',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'u',text:'Independent user',text_complete:true}]},
  {node_id:'saved',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'s',text:'Available saved answer',text_complete:true}]},
  {node_id:'unready',kind:'assistant_response',selection:{ordinal:2},items:mode==='partial'?[{kind:'text',item_identity:'p',text:'Available partial prefix',text_complete:false}]:null,...(mode==='partial'?{}:{items_unavailable_reason:'response_budget' as const})},
 ];
 const f=await fixtureModel({capabilities:['history.window'],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];
  const base=db.answer.bind(db);db.answer=call=>{
   if(call.command==='status')return {ok:true,result:{items:ended?[{kind:'attempt',id:mode==='wrong-attempt'?'other-attempt':'attempt',attempt_id:mode==='wrong-attempt'?'other-attempt':'attempt',thread_id:'t',state:mode==='nonterminal'?'inflight':'completed',response_nodes_truncated:mode==='truncated',response_nodes:mode==='empty'?[]:[{node_id:'unready',ordinal:2,kind:'message'},{node_id:'saved',ordinal:1,kind:'message'}]}]:[]}};
   if(call.command==='history.window')return {ok:true,result:{thread_id:'t',revision:7,total:3,items:nodes}};
   return base(call);
  };
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const win=f.model.longReader.peek()!,before=win.acceptedView.peek();
  await act(async()=>{f.t.push({t:'live',thread_id:'t',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'Original live answer'}]});await flush(24);});
  expect(host.textContent).toContain('Original live answer');
  const publications:typeof before[]=[];const stop=win.acceptedView.subscribe(ref=>publications.push(ref));
  ended=true;await act(async()=>{f.t.push({t:'live_end',thread_id:'t'});await settle(f.t,f.db);await flush(24);});stop();
  expect(host.textContent).toContain('Independent user');expect(host.textContent).toContain('Available saved answer');
  if(mode==='partial')expect(host.textContent).toContain('Available partial prefix');
  else expect(host.textContent).not.toContain('Available partial prefix');
  if(['truncated','partial','budget'].includes(mode)){
   expect(host.textContent).not.toContain('Original live answer');
   const current=win.acceptedView.peek();expect(current.terminalPersistedAttempts).toHaveLength(1);
   expect(current.rows).toEqual(before.rows);expect(current.retiredAttempts??[]).toHaveLength(0);
   expect(current.attemptPresentations?.some(fact=>fact.state==='pending'&&fact.attemptId==='attempt')).not.toBe(true);
   expect(publications.some(ref=>ref.terminalPersistedAttempts?.length===1)).toBe(true);
  }else{
   expect(host.textContent).toContain('Original live answer');
   expect(win.acceptedView.peek().terminalPersistedAttempts??[]).toHaveLength(0);
  }
  expect(f.t.calls('history.get')).toHaveLength(0);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
