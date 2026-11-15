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
import {CANONICAL_ATTEMPT_ID} from '../../../data/test/work-fixture';
import {typedHandoffRegistry,typedHandoffNode,typedSelectedCoverageWindow,validTypedHandoffRef,type TypedHistoryWindow} from '../../../ui-core/test/typed-handoff-fixture';

it('keeps one answer presentation through the complete real Conversation lifecycle',async()=>{
 let ended=false,revision: string|number=7; const trace: unknown[]=[];
 const registry=typedHandoffRegistry({threadId:'thread',attemptId:CANONICAL_ATTEMPT_ID,turnId:'turn-1',revision:7,total:4,provenanceAttemptId:CANONICAL_ATTEMPT_ID,refs:[{nodeId:'answer-1',ordinal:2,text:'Canonical answer'},{nodeId:'answer-2',ordinal:3,text:'Canonical continuation'}]});
 const first=registry.refs[0]!,second=registry.refs[1]!;
 const attempt=registry.attempt();
 const deferred=(fixture:typeof first):HistoryItem=>typedHandoffNode(fixture,false);
 const canonical=(fixture:typeof first):HistoryItem=>typedHandoffNode(fixture,true);
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
    if(point!==undefined||ordinal!==undefined){const fixture=[first,second].find(item=>(point===undefined||item.nodeId===point)&&(ordinal===undefined||item.ordinal===ordinal));
      const proofWindow: TypedHistoryWindow | undefined = registry.history({node_id:point,ordinal,before:Number(args.before) || 0,after:Number(args.after) || 0});
      const window: TypedHistoryWindow<HistoryItem> | undefined = registry.canonical ? typedSelectedCoverageWindow('thread',registry.revision,nodes.length,nodes,{node_id:point,ordinal,before:typeof args.before==='number'?args.before:undefined,after:typeof args.after==='number'?args.after:undefined}) : proofWindow;
      if(!fixture || !window || !proofWindow || !validTypedHandoffRef({...fixture,revision:registry.revision,total:registry.total},attempt,window)) throw new Error(`typed handoff rejection ${point}:${ordinal}`);
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
  const earlyReader=f.model.longReader.peek()!; const earlyAccept=earlyReader.acceptHandoff.bind(earlyReader); earlyReader.acceptHandoff=((...args: Parameters<typeof earlyReader.acceptHandoff>)=>{trace.push({stage:'accept_before',record:args[0].key,container:args[0].presentationContainer,ready:!!args[0].readyAttempt,terminal:!!args[0].terminalPersisted,readerSame:f.model.longReader.peek()===earlyReader}); const accepted=earlyAccept(...args); trace.push({stage:'accept_after',accepted,revision:earlyReader.acceptedView.peek().revision,generation:earlyReader.acceptedView.peek().generation,container:earlyReader.acceptedView.peek().assistantOwnership?.[0]?.containerKey,rows:earlyReader.acceptedView.peek().rows.map(row=>row.node_id),readerSame:f.model.longReader.peek()===earlyReader}); return accepted;}) as typeof earlyReader.acceptHandoff;
  const earlyHandle=f.model.handle.peek()!; const earlyTransfer=earlyHandle.transferHandoff.bind(earlyHandle); earlyHandle.transferHandoff=((...args: Parameters<typeof earlyHandle.transferHandoff>)=>{trace.push({stage:'transfer_before',attempt:args[0],records:earlyHandle.handoff.peek().map(record=>({key:record.key,ready:!!record.readyAttempt,terminal:!!record.terminalPersisted,transferred:!!record.transferred}))}); const result=earlyTransfer(...args); trace.push({stage:'transfer_after',attempt:args[0],result,records:earlyHandle.handoff.peek().map(record=>({key:record.key,ready:!!record.readyAttempt,terminal:!!record.terminalPersisted,transferred:!!record.transferred}))}); return result;}) as typeof earlyHandle.transferHandoff;
  await act(async()=>{f.t.push({t:'live',thread_id:'thread',attempt_id:CANONICAL_ATTEMPT_ID,gap:false,deltas:[{offset:0,reasoning:false,text:'Preview answer'}]});await flush(24);});
  const identity=host.querySelector('[data-answer-container]');expect(identity).not.toBeNull();expect(identity?.textContent).toContain('Preview answer'); trace.push({stage:'dom_preview',container:identity?.getAttribute('data-answer-container'),key:(identity as HTMLElement|null)?.getAttribute('key'),parent:identity?.parentElement?.className,html:identity?.outerHTML.slice(0,240)});
  ended=true;registry.canonical=true;registry.revision=8;nodes[2]=canonical(first);nodes[3]=canonical(second);f.db.history.thread=nodes;revision=8;
  await act(async()=>{f.t.push({t:'live_end',thread_id:'thread'});await settle(f.t,f.db);await flush(24);await settle(f.t,f.db);await flush(24);});
  const readerBefore=f.model.longReader.peek()!; const acceptBefore=readerBefore.acceptHandoff.bind(readerBefore); readerBefore.acceptHandoff=((...args: Parameters<typeof readerBefore.acceptHandoff>)=>{const accepted=acceptBefore(...args); trace.push({stage:'window_accept',accepted,revision:readerBefore.acceptedView.peek().revision,generation:readerBefore.acceptedView.peek().generation,rows:readerBefore.acceptedView.peek().rows.map(row=>row.node_id),capability:readerBefore.acceptedView.currentCapability}); return accepted;}) as typeof readerBefore.acceptHandoff;
  await act(async()=>{for(const call of f.t.calls('history.window').filter(c=>!f.db.answered.has(c.id))){const out=f.db.answer(call);f.db.answered.add(call.id);if(out.ok)f.t.ok(call.id,out.result);else f.t.ownerError(call.id,out.code,out.message);}await flush(24);});
  const liveHandle=f.model.handle.peek(); const window=f.model.longReader.peek(); trace.push({stage:'live_end_state',handoff:liveHandle?.handoff.peek().map(record=>({key:record.key,attemptId:record.attemptId,status:record.status,text:record.text,terminal:!!record.terminalPersisted,transferred:!!record.transferred,readyAttempt:record.readyAttempt,proof:record.proof})),retry:liveHandle?.handoffRetryState.peek(),window:window?{revision:window.acceptedView.peek().revision,total:window.acceptedView.peek().total,pending:window.acceptedView.peek().pending,generation:window.acceptedView.peek().generation,ownership:window.acceptedView.peek().assistantOwnership,terminalPresence:window.acceptedView.peek().terminalPresence,rows:window.acceptedView.peek().rows.map(row=>({node_id:row.node_id,ordinal:row.selection?.ordinal,body:row.items?.length??null,unavailable:row.items_unavailable_reason}))}:undefined,calls:f.t.calls().map(call=>({command:call.command,args:call.args}))}); console.log('UNIT1_HANDOFF_TRACE',JSON.stringify(trace));
  const afterHost=host.querySelector('[data-answer-container]'); console.log('DOM_AFTER_TRACE',JSON.stringify({container:afterHost?.getAttribute('data-answer-container'),parent:afterHost?.parentElement?.className,html:afterHost?.outerHTML.slice(0,240),text:host.textContent})); trace.push({stage:'dom_after',container:afterHost?.getAttribute('data-answer-container'),parent:afterHost?.parentElement?.className,html:afterHost?.outerHTML.slice(0,240)}); expect(afterHost).toBe(identity);expect(host.textContent).toContain('Canonical answer');expect(host.textContent).toContain('Canonical continuation');
  expect([...host.querySelectorAll('[data-answer-container] [data-item-key]')].map(node=>node.getAttribute('data-item-key'))).toEqual(['[\"answer-1\",\"answer-1:/output/0/content/0\"]','[\"answer-2\",\"answer-2:/output/0/content/0\"]']);
  expect([...host.querySelectorAll('[data-item-key]')].map(node=>node.getAttribute('data-item-key'))).toEqual(['[\"user-0\",\"u0\"]','[\"tool-1\",\"tool1\"]','[\"answer-1\",\"answer-1:/output/0/content/0\"]','[\"answer-2\",\"answer-2:/output/0/content/0\"]']);
  expect([...host.querySelectorAll('[data-answer-container] [data-item-key]')]).toHaveLength(2);
  const ownership=window?.acceptedView.peek().assistantOwnership?.filter(record=>record.mode === 'canonical' && record.itemKeys.length === 2) ?? []; expect(ownership).toHaveLength(1); expect(window?.acceptedView.peek().retiredAttempts?.some(record => record.attemptId === CANONICAL_ATTEMPT_ID)).toBe(true); expect(f.model.handle.peek()?.handoff.peek()).toHaveLength(0);
  registry.total=5;registry.revision=9;nodes.push({node_id:'local-1',kind:'user',selection:{ordinal:4},items:[{kind:'text',item_identity:'local1',text:'Next turn',text_complete:true}]});revision=9;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['thread'],list:false});await settle(f.t,f.db);await flush(24);});
  expect(host.textContent).toContain('Next turn');expect(host.textContent).toContain('Canonical answer');
  expect(host.querySelector('[data-answer-container]')).toBe(identity);
  expect([...host.querySelectorAll('[data-answer-container] [data-item-key]')].map(node=>node.getAttribute('data-item-key'))).toEqual(['[\"answer-1\",\"answer-1:/output/0/content/0\"]','[\"answer-2\",\"answer-2:/output/0/content/0\"]']);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
