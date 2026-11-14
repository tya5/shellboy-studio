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
import {typedHandoffRegistry,validTypedHandoffRef,type TypedHistoryWindow} from '../../../ui-core/test/typed-handoff-fixture';

it('keeps one answer presentation through the complete real Conversation lifecycle',async()=>{
 let ended=false,revision: string|number=7; const trace: unknown[]=[]; let pointReads=0;
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
   if(call.command==='status'){const result={items:ended?[attempt]:[]};trace.push({stage:'transport',command:call.command,args:call.args,result});return {ok:true,result};}
   if(call.command==='history.window'){
    const args=call.args as {node_id?:unknown; ordinal?:unknown; before?:unknown; after?:unknown};
    const point=typeof args.node_id==='string'?args.node_id:undefined;
    const ordinal=Number.isSafeInteger(args.ordinal)?args.ordinal as number:undefined;
    if(point!==undefined||ordinal!==undefined){const fixture=[first,second].find(item=>(point===undefined||item.nodeId===point)&&(ordinal===undefined||item.ordinal===ordinal));pointReads++;
      const proofWindow: TypedHistoryWindow | undefined = registry.history({node_id:point,ordinal,before:Number(args.before) || 0,after:Number(args.after) || 0});
      const window = pointReads > 1 ? {thread_id:'thread',revision:registry.revision,total:nodes.length,items:nodes,item_count:nodes.length} : proofWindow;
      if(!fixture || !window || !proofWindow || !validTypedHandoffRef({...fixture,revision:registry.revision,total:registry.total},attempt,proofWindow)) throw new Error(`typed handoff rejection ${point}:${ordinal}`);
      const result=window;
      trace.push({stage:'transport',command:call.command,args:call.args,result:{revision:result.revision,total:result.total,item_count:result.item_count,items:result.items.map(item=>({node_id:item.node_id,ordinal:item.selection?.ordinal,body:Array.isArray(item.items)?item.items.map(value=>value.kind):null,unavailable:item.items_unavailable_reason}))}});return {ok:true,result};}
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
  await act(async()=>{f.t.push({t:'live_end',thread_id:'thread'});await settle(f.t,f.db);await flush(24);await settle(f.t,f.db);await flush(24);});
  const liveHandle=f.model.handle.peek(); const window=f.model.longReader.peek(); trace.push({stage:'live_end_state',handoff:liveHandle?.handoff.peek().map(record=>({key:record.key,attemptId:record.attemptId,status:record.status,text:record.text,terminal:!!record.terminalPersisted,transferred:!!record.transferred,readyAttempt:record.readyAttempt,proof:record.proof})),retry:liveHandle?.handoffRetryState.peek(),window:window?{revision:window.acceptedView.peek().revision,total:window.acceptedView.peek().total,pending:window.acceptedView.peek().pending,generation:window.acceptedView.peek().generation,ownership:window.acceptedView.peek().assistantOwnership,terminalPresence:window.acceptedView.peek().terminalPresence,rows:window.acceptedView.peek().rows.map(row=>({node_id:row.node_id,ordinal:row.selection?.ordinal,body:row.items?.length??null,unavailable:row.items_unavailable_reason}))}:undefined,calls:f.t.calls().map(call=>({command:call.command,args:call.args}))}); console.log('UNIT1_HANDOFF_TRACE',JSON.stringify(trace));
  expect(host.querySelector('[data-answer-container]')).toBe(identity);expect(host.textContent).toContain('Canonical answer');expect(host.textContent).toContain('Canonical continuation');
  expect([...host.querySelectorAll('[data-answer-container] [data-item-key]')]).toHaveLength(2);
  registry.total=5;registry.revision=9;nodes.push({node_id:'local-1',kind:'user',selection:{ordinal:4},items:[{kind:'text',item_identity:'local1',text:'Next turn',text_complete:true}]});revision=9;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['thread'],list:false});await settle(f.t,f.db);await flush(24);});
  expect(host.textContent).toContain('Next turn');expect(host.textContent).toContain('Canonical answer');
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
