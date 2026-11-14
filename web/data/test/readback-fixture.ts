import {onTestFinished} from 'vitest';
import {ConversationWindow} from '../../ui-core/src/window';
import {ShellboyData} from '../src/store';
import type {HistoryItem} from '../src/protocol';
import {attemptWork} from './work-fixture';
import {FakeOwnerDb,FakeTransport,connectedWithHistory,settle} from './harness';

/** Status-only fixtures deliberately declare incomplete public output; body probes are explicit. */
export async function readbackFixture(){
 const t=new FakeTransport(),db=new FakeOwnerDb(),frames:(()=>void)[]=[];let serial=0;
 const data=new ShellboyData({transport:t,newId:()=>`readback-${++serial}`,schedule:fn=>frames.push(fn)});
 data.start();t.open();t.push({t:'hello',bridge_version:'synthetic',owner:connectedWithHistory});await settle(t,db);
 const h=data.openThread('a');await settle(t,db);
 const window=new ConversationWindow({read:async()=>({ok:true,value:{thread_id:'a',revision:6,total:1,items:[{node_id:'human',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'human-text',text:'Independent human',text_complete:true}]}]}})});
 await settle(t,db);window.bindTerminalHandle(h);onTestFinished(()=>{window.dispose();data.stop();});
 const state={attempt:'attempt',available:true,truncated:true,partial:false,deferred:false,unknown:false,missing:false,error:false,changing:false,nonterminal:false,wrongid:false,empty:false};
 const original=db.answer.bind(db);let reads=0;
 db.answer=call=>{
  if(call.command==='status')return{ok:true,result:{items:state.available?[{...attemptWork({threadId:'a',attemptId:state.attempt,turnId:'turn',state:state.nonterminal?'inflight':'completed',truncated:state.truncated,
   refs:state.empty?[]:[{node_id:'tool',ordinal:0,kind:'assistant_response'},{node_id:'answer',ordinal:1,kind:'assistant_response'}]}),id:state.wrongid?'other':state.attempt}]:[]}};
  if(call.command==='history.window'){
   reads++;if(state.error)return{ok:false,code:'not_found',message:'synthetic'};
   const tool:HistoryItem={node_id:'tool',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'tool_call',item_identity:'call',execution_ids:['exec']}]};
   const answer:HistoryItem={node_id:'answer',kind:'assistant_response',selection:{ordinal:1},items:
    state.deferred?null:state.unknown?[{kind:'unavailable',item_identity:'missing',reason:'opaque'}]:
    [{kind:'text',item_identity:'text',text:state.partial?'prefix':'saved',text_complete:!state.partial}],
    ...(state.deferred?{items_unavailable_reason:'response_budget' as const}:{})};
   const items=state.changing?reads===1?[tool]:[answer]:state.missing?[tool]:[tool,answer];
   return{ok:true,result:{thread_id:'a',revision:state.changing&&reads>1?8:7,total:2,items}};
  }
  return original(call);
 };
 const live=()=>{t.push({t:'live',thread_id:'a',attempt_id:state.attempt,gap:false,deltas:[{offset:0,reasoning:false,text:'whole live block'}]});frames.splice(0).forEach(fn=>fn());};
 return{t,db,data,h,state,window,bodyReads:()=>t.calls('history.window').filter(call=>typeof call.args==='object'&&call.args!==null&&'node_id' in call.args),receipt:()=>window.acceptedView.peek().terminalPersistedAttempts?.find(receipt=>receipt.attemptId===state.attempt),live,end:()=>t.push({t:'live_end',thread_id:'a'}),pump:()=>settle(t,db)};
}
