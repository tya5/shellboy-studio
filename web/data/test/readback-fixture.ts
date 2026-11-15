import {onTestFinished} from 'vitest';
import {ConversationWindow} from '../../ui-core/src/window';
import {ShellboyData} from '../src/store';
import type {HistoryItem} from '../src/protocol';
import {attemptWork,CANONICAL_ATTEMPT_ID,withCanonicalAttemptProvenance} from './work-fixture';
import {FakeOwnerDb,FakeTransport,connectedWithHistory,settle} from './harness';
import {ownedHistory} from './owned-history';

/** Status-only fixtures deliberately declare incomplete public output; body probes are explicit. */
export async function readbackFixture(options:{readonly threadIds?:readonly string[]; readonly initialAvailable?:boolean; readonly windowHistory?:{readonly revision:number;readonly total:number;readonly items:readonly HistoryItem[]}}={}){
 const t=new FakeTransport(),db=new FakeOwnerDb(),frames:(()=>void)[]=[];let serial=0;
 const data=new ShellboyData({transport:t,newId:()=>`readback-${++serial}`,schedule:fn=>frames.push(fn)});
 data.start();t.open();t.push({t:'hello',bridge_version:'synthetic',owner:connectedWithHistory});await settle(t,db);
 const threadIds=options.threadIds??['a'];const handles=Object.fromEntries(threadIds.map(id=>[id,data.openThread(id)])) as Record<string,ReturnType<ShellboyData['openThread']>>;await settle(t,db);
 const h=handles.a!;
 const windowHistory=options.windowHistory ?? {revision:6,total:1,items:[{node_id:'human',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'human-text',text:'Independent human',text_complete:true}]}]};
 const window=new ConversationWindow({read:async()=>({ok:true,value:ownedHistory({thread_id:'a',...windowHistory,items:withCanonicalAttemptProvenance(windowHistory.items,CANONICAL_ATTEMPT_ID)})})});
 await settle(t,db);window.bindTerminalHandle(h);onTestFinished(()=>{window.dispose();data.stop();});
 const state={terminalState:'completed' as 'completed'|'failed'|'incomplete'|'cancelled',attempt:CANONICAL_ATTEMPT_ID,available:options.initialAvailable ?? true,truncated:true,partial:false,deferred:false,unknown:false,missing:false,error:false,changing:false,nonterminal:false,wrongid:false,empty:false};
 const original=db.answer.bind(db);let reads=0;
 db.answer=call=>{
  if(call.command==='status'){const threadId=(call.args as {thread_id?:string}).thread_id??'a';const attemptId=threadId==='a'?state.attempt:`attempt-${threadId}`;return{ok:true,result:{items:state.available?[{...attemptWork({threadId,attemptId,turnId:'turn',state:state.nonterminal?'inflight':state.terminalState,truncated:state.truncated,
   refs:state.empty?[]:[{node_id:'tool',ordinal:0,kind:'assistant_response'},{node_id:'answer',ordinal:1,kind:'assistant_response'}]}),id:state.wrongid?'other':attemptId}]:[]}};}
  if(call.command==='history.window'){
   reads++;if(state.error)return{ok:false,code:'not_found',message:'synthetic'};
   const tool:HistoryItem={node_id:'tool',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'tool_call',item_identity:'call',execution_ids:['exec']}]};
   const answer:HistoryItem={node_id:'answer',kind:'assistant_response',selection:{ordinal:1},items:
    state.deferred?null:state.unknown?[{kind:'unavailable',item_identity:'missing',reason:'opaque'}]:
    [{kind:'text',item_identity:'text',text:state.partial?'prefix':'saved',text_complete:!state.partial}],
    ...(state.deferred?{items_unavailable_reason:'response_budget' as const}:{})};
   const items=withCanonicalAttemptProvenance(state.changing?reads===1?[tool]:[answer]:state.missing?[tool]:[tool,answer],state.attempt);
   return{ok:true,result:{thread_id:(call.args as {thread_id?:string}).thread_id??'a',revision:state.changing&&reads>1?8:7,total:2,items}};
  }
  return original(call);
 };
 const liveFor=(threadId:string,attemptId=threadId==='a'?state.attempt:`attempt-${threadId}`)=>{t.push({t:'live',thread_id:threadId,attempt_id:attemptId,gap:false,deltas:[{offset:0,reasoning:false,text:'whole live block'}]});frames.splice(0).forEach(fn=>fn());};
 const endFor=(threadId:string)=>t.push({t:'live_end',thread_id:threadId});
 const live=()=>liveFor('a');
 return{t,db,data,h,handles,state,window,liveFor,endFor,bodyReads:()=>t.calls('history.window').filter(call=>typeof call.args==='object'&&call.args!==null&&'node_id' in call.args),receipt:()=>window.acceptedView.peek().terminalPersistedAttempts?.find(receipt=>receipt.attemptId===state.attempt),live,end:()=>t.push({t:'live_end',thread_id:'a'}),pump:()=>settle(t,db)};
}
