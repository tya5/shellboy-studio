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
import {typedHandoffRegistry,validTypedHandoffRef} from '../../../ui-core/test/typed-handoff-fixture';

it('keeps one answer presentation through the complete real Conversation lifecycle',async()=>{
 let ended=false,revision: string|number=7;
 const registry=typedHandoffRegistry({threadId:'thread',attemptId:'attempt-1',turnId:'turn-1',revision:7,total:4,refs:[{nodeId:'answer-1',ordinal:2,text:'Canonical answer'},{nodeId:'answer-2',ordinal:3,text:'Canonical continuation'}]});
 const first=registry.refs[0]!,second=registry.refs[1]!;
 const attempt=registry.attempt();
 const deferred=(fixture:typeof first):HistoryItem=>({node_id:fixture.nodeId,kind:'assistant_response',selection:{ordinal:fixture.ordinal},items:null,items_unavailable_reason:'response_budget'});
 const canonical=(fixture:typeof first):HistoryItem=>({node_id:fixture.nodeId,kind:'assistant_response',selection:{ordinal:fixture.ordinal},items:[{kind:'text',item_identity:`${fixture.nodeId}:/output/0/content/0`,text:fixture.text,text_complete:true}]});
 const nodes:HistoryItem[]=[
  {node_id:'user-0',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'u0',text:'Question',text_complete:true}]},
  {node_id:'tool-1',kind:'tool',selection:{ordinal:1},items:[{kind:'text',item_identity:'tool1',text:'intervening work',text_complete:true}]},deferred(first),deferred(second),
 ];
 const f=await fixtureModel({capabilities:['live.text','history.window'],configure(db){
  db.threads={thread:summary('thread')};db.details.thread=details('thread');db.history.thread=nodes;
  const base=db.answer.bind(db);db.answer=call=>{
   if(call.command==='status')return {ok:true,result:{items:ended?[attempt]:[]}};
   if(call.command==='history.window'){
    const point=typeof call.node_id==='string'?call.node_id:undefined;
    const ordinal=Number.isSafeInteger(call.ordinal)?call.ordinal:undefined;
    if(point!==undefined||ordinal!==undefined){const fixture=[first,second].find(item=>(point===undefined||item.nodeId===point)&&(ordinal===undefined||item.ordinal===ordinal));const window=registry.history({node_id:point,ordinal});if(!fixture||!window||!validTypedHandoffRef({...fixture,revision:registry.revision,total:registry.total},attempt,window))throw new Error(`typed handoff rejection ${point}:${ordinal}`);return {ok:true,result:window};}
    return {ok:true,result:{thread_id:'thread',revision:registry.revision,total:nodes.length,items:nodes}};
   }
   return base(call);
  };
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  await act(async()=>{f.t.push({t:'live',thread_id:'thread',attempt_id:'attempt-1',gap:false,deltas:[{offset:0,reasoning:false,text:'Preview answer'}]});await flush(24);});
  const identity=host.querySelector('[data-answer-container]');expect(identity).not.toBeNull();expect(identity?.textContent).toContain('Preview answer');
  ended=true;registry.canonical=true;registry.revision=8;nodes[2]=canonical(first);nodes[3]=canonical(second);f.db.history.thread=nodes;revision=8;
  await act(async()=>{f.t.push({t:'live_end',thread_id:'thread'});await settle(f.t,f.db);await flush(24);});
  expect(host.querySelector('[data-answer-container]')).toBe(identity);expect(host.textContent).toContain('Canonical answer');expect(host.textContent).toContain('Canonical continuation');
  expect([...host.querySelectorAll('[data-answer-container] [data-item-key]')]).toHaveLength(2);
  registry.total=5;registry.revision=9;nodes.push({node_id:'local-1',kind:'user',selection:{ordinal:4},items:[{kind:'text',item_identity:'local1',text:'Next turn',text_complete:true}]});revision=9;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['thread'],list:false});await settle(f.t,f.db);await flush(24);});
  expect(host.textContent).toContain('Next turn');expect(host.textContent).toContain('Canonical answer');
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
