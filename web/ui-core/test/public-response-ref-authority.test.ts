import {expect,it} from 'vitest';
import {fixtureConversation} from './fixture';
import {attemptWork} from '../../data/test/work-fixture';
import {settle,flush} from '../../data/test/harness';
import {capturePublicResponseScope,responseRefsMatchSelected} from '../../data/src/public-response-refs';
import type {HistoryItem,ResponseNodeRef} from '../../data/src/protocol';
const user:HistoryItem={node_id:'human',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'human-text',text:'Independent human',text_complete:true}],provenance:{sender:{kind:'human'}}};
const tool:HistoryItem={node_id:'tool',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'tool_call',item_identity:'call',execution_ids:['execution']}]};
const answer:HistoryItem={node_id:'answer',kind:'assistant_response',selection:{ordinal:2},items:[{kind:'text',item_identity:'text',text:'Exact saved answer',text_complete:true}]};
const valid:ResponseNodeRef[]=[{node_id:'tool',ordinal:1,kind:'assistant_response'},{node_id:'answer',ordinal:2,kind:'assistant_response'}];
it.each(['same-id','wrong-ordinal','wrong-kind','conflicting-page','valid'] as const)('actual public response %s keeps source authority, body/order and read bounds',async mode=>{
 const f=await fixtureConversation({nodes:[user]});let ended=false;
 const refs:ResponseNodeRef[]=mode==='same-id'?[{node_id:'answer',ordinal:1,kind:'assistant_response'},{node_id:'answer',ordinal:2,kind:'assistant_response'}]:
  mode==='wrong-ordinal'?[valid[0]!,{node_id:'answer',ordinal:3,kind:'assistant_response'}]:
  mode==='wrong-kind'?[valid[0]!,{node_id:'answer',ordinal:2,kind:'user'}]:valid;
 const base=f.db.answer.bind(f.db);
 f.db.answer=call=>{
  if(call.command==='status')return{ok:true,result:{items:ended?[attemptWork({threadId:'lead',attemptId:'attempt',turnId:'turn',state:'completed',refs})]:[]}};
  const args=call.args;
  if(call.command==='history.window'&&typeof args==='object'&&args!==null&&'node_id' in args){
   const items='before' in args&&args.before===0?[tool,answer,...(mode==='conflicting-page'?[{...answer,selection:{ordinal:3}}]:[])]:[user,tool,answer];
   return{ok:true,result:{thread_id:'lead',revision:2,total:mode==='conflicting-page'?4:3,items}};
  }
  return base(call);
 };
 try{
  const h=f.model.handle.value!,w=f.model.longReader.value!;
  f.t.push({t:'live',thread_id:'lead',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'Owned preview'}]});await flush();
  const original=h.handoff.peek()[0]!;expect(original.text).toBe('Owned preview');
  ended=true;f.t.push({t:'live_end',thread_id:'lead'});await settle(f.t,f.db);
  const ref=w.acceptedView.peek();
  expect(ref.rows[0]?.node_id).toBe('human');expect(ref.rows[0]?.items).toEqual(user.items);
  const publicReads=f.t.calls('history.window').filter(call=>typeof call.args==='object'&&call.args!==null&&'node_id' in call.args);
  const points=publicReads.filter(call=>typeof call.args==='object'&&call.args!==null&&'before' in call.args&&call.args.before===0);
  if(mode==='valid'){
   expect(points).toHaveLength(1);expect(publicReads).toHaveLength(2);
   expect(ref.rows.map(node=>node.node_id)).toEqual(['human','tool','answer']);
   expect(h.handoff.peek()).toHaveLength(0);expect(ref.retiredAttempts).toMatchObject([{attemptId:'attempt',turnId:'turn',nodeIds:['tool','answer']}]);
   expect(ref.displayPlan?.entries.some(entry=>entry.body.kind==='typed-canonical'&&entry.body.text==='Exact saved answer')).toBe(true);
  }else{
   expect(points).toHaveLength(mode==='same-id'?0:1);expect(publicReads).toHaveLength(mode==='same-id'?0:1);
   expect(h.handoff.peek()[0]?.text).toBe('Owned preview');expect(h.handoff.peek()[0]?.readyAttempt).toBeUndefined();
   expect(ref.retiredAttempts??[]).toEqual([]);expect(ref.assistantOwnership??[]).toEqual([]);
   expect(ref.rows.map(node=>node.node_id)).toEqual(['human']);
   expect(ref.displayPlan?.entries.some(entry=>entry.body.kind==='preview'&&entry.body.text==='Owned preview')).toBe(true);
  }
 }finally{f.model.dispose();f.data.stop();}
});
it('one public reference capture rejects duplicate IDs even at distinct ordered ordinals',()=>{
 const row=attemptWork({threadId:'lead',attemptId:'attempt',turnId:'turn',state:'completed',refs:[{node_id:'answer',ordinal:1,kind:'assistant_response'},{node_id:'answer',ordinal:2,kind:'assistant_response'}]});
 const scope=capturePublicResponseScope([row],'lead');expect(scope.complete).toBe(false);expect(scope.references.has(row)).toBe(false);
 const good=attemptWork({threadId:'lead',attemptId:'attempt',turnId:'turn',state:'completed',refs:valid});
 const captured=capturePublicResponseScope([good],'lead');expect(captured.complete).toBe(true);
 expect(responseRefsMatchSelected(captured.references.get(good)!,[user,tool,answer])).toBe(true);
 expect(responseRefsMatchSelected(captured.references.get(good)!,[user,tool,{...answer,selection:{ordinal:3}}])).toBe(false);
 expect(responseRefsMatchSelected(captured.references.get(good)!,[user,tool,answer,{...answer,selection:{ordinal:3}}])).toBe(false);
 expect(responseRefsMatchSelected(captured.references.get(good)!,[user,tool,answer,{...user,node_id:'other-human',selection:{ordinal:2}}])).toBe(false);
});


it.each(([
 [{node_id:'',ordinal:0,kind:'assistant_response'}],
 [{node_id:'a',ordinal:0,kind:'assistant_response'},{node_id:'b',ordinal:0,kind:'assistant_response'}],
 [{node_id:'b',ordinal:1,kind:'assistant_response'},{node_id:'a',ordinal:0,kind:'assistant_response'}],
 [{node_id:'a',ordinal:0,kind:''}],
] satisfies ResponseNodeRef[][]).map(refs=>({refs})))('one public capture rejects invalid identity/order/kind %#',({refs})=>{
 const row=attemptWork({threadId:'lead',attemptId:'attempt',turnId:'turn',state:'completed',refs});
 const scope=capturePublicResponseScope([row],'lead');expect(scope.complete).toBe(false);expect(scope.references.has(row)).toBe(false);
});
it('empty public output cannot mint a readable response proof',()=>{
 const row=attemptWork({threadId:'lead',attemptId:'attempt',turnId:'turn',state:'completed',refs:[]});
 expect(capturePublicResponseScope([row],'lead').references.has(row)).toBe(false);
});

it('a fresh selected read cannot restamp a prior public answer ordinal into a new ready proof',async()=>{
 const tail:HistoryItem={node_id:'tail-human',kind:'user',selection:{ordinal:3},items:[{kind:'text',item_identity:'tail',text:'Independent tail',text_complete:true}],provenance:{sender:{kind:'human'}}};
 const partial:HistoryItem={...answer,items:[{kind:'text',item_identity:'text',text:'partial prefix',text_complete:false}]};
 const initial=[user,tool,partial,tail];
 const f=await fixtureConversation({nodes:initial});let ended=false;
 const base=f.db.answer.bind(f.db);
 f.db.answer=call=>{
  if(call.command==='status')return{ok:true,result:{items:ended?[attemptWork({threadId:'lead',attemptId:'attempt',turnId:'turn',state:'completed',refs:valid})]:[]}};
  const args=call.args;
  if(call.command==='history.window'&&typeof args==='object'&&args!==null&&'node_id' in args){
   if('before' in args&&args.before===0)return{ok:true,result:{thread_id:'lead',revision:2,total:4,items:[tool,answer,tail]}};
   return{ok:true,result:{thread_id:'lead',revision:3,total:4,items:[user,tool,{...tail,selection:{ordinal:2}},{...answer,selection:{ordinal:3}}]}};
  }
  return base(call);
 };
 try{
  const h=f.model.handle.value!,w=f.model.longReader.value!;
  f.t.push({t:'live',thread_id:'lead',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'Owned preview'}]});await flush();
  ended=true;f.t.push({t:'live_end',thread_id:'lead'});await settle(f.t,f.db);
  const held=h.handoff.peek()[0]!;
  expect(held.text).toBe('Owned preview');expect(held.readyAttempt?.revision).toBe(2);
  expect(held.readyAttempt?.refs).toEqual([{nodeId:'tool',ordinal:1,kind:'assistant_response'},{nodeId:'answer',ordinal:2,kind:'assistant_response'}]);
  const ref=w.acceptedView.peek();expect(ref.rows).toEqual(initial);expect(ref.retiredAttempts??[]).toEqual([]);
  expect(ref.displayPlan?.entries.some(entry=>entry.body.kind==='preview'&&entry.body.text==='Owned preview')).toBe(true);
  expect(ref.rows.filter(row=>row.kind==='user').map(row=>row.items)).toEqual([user.items,tail.items]);
  const reads=f.t.calls('history.window').filter(call=>typeof call.args==='object'&&call.args!==null&&'node_id' in call.args);
  expect(reads).toHaveLength(2);expect(reads.map(call=>call.args)).toMatchObject([{node_id:'tool',before:0,after:199},{node_id:'tool',before:1,after:2}]);
 }finally{f.model.dispose();f.data.stop();}
});
