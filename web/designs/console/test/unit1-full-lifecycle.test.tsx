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

it('keeps one answer presentation through the complete real Conversation lifecycle',async()=>{
 let ended=false,revision=7;
 const answer:HistoryItem={node_id:'answer-1',kind:'assistant_response',selection:{ordinal:2},items:null,items_unavailable_reason:'response_budget'};
 const answer2:HistoryItem={node_id:'answer-2',kind:'assistant_response',selection:{ordinal:3},items:null,items_unavailable_reason:'response_budget'};
 const nodes:HistoryItem[]=[
  {node_id:'user-0',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'u0',text:'Question',text_complete:true}]},
  {node_id:'tool-1',kind:'tool',selection:{ordinal:1},items:[{kind:'text',item_identity:'tool1',text:'intervening work',text_complete:true}]},answer,answer2,
 ];
 const f=await fixtureModel({capabilities:['live.text','history.window'],configure(db){
  db.threads={thread:summary('thread')};db.details.thread=details('thread');db.history.thread=nodes;
  const base=db.answer.bind(db);db.answer=call=>{
   if(call.command==='status')return {ok:true,result:{items:ended?[{kind:'attempt',id:'attempt-1',attempt_id:'attempt-1',turn_id:'turn-1',thread_id:'thread',state:'completed',response_nodes_truncated:false,response_nodes:[{node_id:'answer-1',ordinal:2,kind:'message'},{node_id:'answer-2',ordinal:3,kind:'message'}]}]:[]}};
   if(call.command==='history.window')return {ok:true,result:{thread_id:'thread',revision,total:nodes.length,items:nodes}};
   return base(call);
  };
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  await act(async()=>{f.t.push({t:'live',thread_id:'thread',attempt_id:'attempt-1',gap:false,deltas:[{offset:0,reasoning:false,text:'Preview answer'}]});await flush(24);});
  const answerHost=host.querySelector('[data-answer-container]');
  expect(answerHost).not.toBeNull();
  expect(answerHost?.textContent).toContain('Preview answer');
  const identity=answerHost;
  const previewIds=[...host.querySelectorAll('[data-answer-container] [data-item-key]')].map(e=>[e.getAttribute('data-node'),e.getAttribute('data-key')]);
  expect(previewIds.length).toBeGreaterThan(0);

  ended=true;const {items_unavailable_reason:_,...answerMeta}=answer;const {items_unavailable_reason:__,...answerMeta2}=answer2;nodes[2]={...answerMeta,items:[{kind:'text',item_identity:'answer-1:/output/0/content/0',text:'Canonical answer',text_complete:true}]};nodes[3]={...answerMeta2,items:[{kind:'text',item_identity:'answer-2:/output/0/content/0',text:'Canonical continuation',text_complete:true}]};f.db.history.thread=nodes;revision++;
  await act(async()=>{f.t.push({t:'live_end',thread_id:'thread'});await settle(f.t,f.db);await flush(24);});
  await act(async()=>{f.t.push({t:'changed',thread_ids:['thread'],list:false});await settle(f.t,f.db);await flush(24);});
  expect(host.querySelector('[data-answer-container]')).toBe(identity);
  expect(host.textContent).toContain('Canonical answer');expect(host.textContent).toContain('Canonical continuation');
  expect([...host.querySelectorAll('[data-answer-container] [data-item-key]')].map(e=>[e.getAttribute('data-node'),e.getAttribute('data-key')])).toHaveLength(2);

  nodes.push({node_id:'local-1',kind:'user',selection:{ordinal:3},items:[{kind:'text',item_identity:'local1',text:'Next turn',text_complete:true}]});revision++;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['thread'],list:false});await settle(f.t,f.db);await flush(24);});
  expect(host.textContent).toContain('Next turn');expect(host.textContent).toContain('Canonical answer');
  expect([...host.querySelectorAll('[data-item-key]')].map(e=>e.getAttribute('data-node')).filter(Boolean)).toEqual(['user-0','tool-1','answer-1','answer-2','local-1']);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
