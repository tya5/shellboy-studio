// @vitest-environment happy-dom
import '@preact/signals';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import type {HistoryItem} from '../../../data/src/protocol';
import type {ThreadReadQualification} from '../../../data/src/store';
import type {OwnedTerminalReadLease} from '../../../data/src/terminal-read';
import {attemptWork} from '../../../data/test/work-fixture';
import {flush,settle} from '../../../data/test/harness';
import {publicConversationFixture,CurrentSavedView} from './conversation-fixture';

const cases:{total:number;mode:string;selected?:number}[]=[{total:3,mode:'valid'},{total:201,mode:'valid'},
 ...(['older-point','older','gap','wrong-tuple','revoke','cancel','reentry'] as const).map(mode=>({total:201,mode})),
 {total:301,selected:201,mode:'valid'},{total:301,selected:201,mode:'gap'},{total:301,selected:201,mode:'revoke'},{total:301,selected:201,mode:'reentry'},{total:301,selected:201,mode:'later-page-reentry'},
 {total:2000,selected:1600,mode:'valid'}];
for(const {total,mode,selected=Math.min(total,100)} of cases)it(`actual empty receipt selected-cut ${total}/${mode}`,async()=>{
 const first=Math.max(0,total-selected),answerOrdinal=total-1,humanOrdinal=total-2,initialRevision=mode==='older-point'?2:1,pointRevision=mode==='older-point'?1:2;
 const path=(revision:number):HistoryItem[]=>Array.from({length:total},(_,ordinal)=>({
  node_id:ordinal===answerOrdinal?'answer':`node-${ordinal}`,
  kind:ordinal===humanOrdinal?'user':'assistant_response',selection:{ordinal},
  ...(ordinal===humanOrdinal?{provenance:{sender:{kind:'human'}}}:{}),
  ...(revision===initialRevision&&ordinal===answerOrdinal?{items:null,items_unavailable_reason:'response_budget' as const}:
   {items:[{kind:'text',item_identity:'body',text:`R${revision}:${ordinal}`,text_complete:true}]}),
 }));
 const f=await publicConversationFixture({nodes:path(initialRevision),revision:initialRevision}),host=document.createElement('div');document.body.append(host);
 const reader=f.model.longReader.peek()!,handle=f.model.handle.peek()!,scope=handle.handoffScope();
 for(let page=0;page<16&&reader.acceptedView.peek().rows.length<selected;page++){reader.requestOlder();await settle(f.t,f.db);}
 const trace:Record<string,unknown>[]=[];let successor:OwnedTerminalReadLease|undefined,successorToken:ThreadReadQualification|undefined;
 const replace=handle.replaceTerminalRead;
 handle.replaceTerminalRead=(token,admission,request)=>{
  const next=replace(token,admission,request);if('state' in next){successor=next;successorToken=token;}return next;
 };
 const stop=reader.acceptedView.subscribe(ref=>{
  expect(reader.acceptedView.isCurrent(ref)).toBe(true);expect(ref.displayPlan?.capability).toBe(reader.acceptedView.currentCapability);
  expect(ref.rows.map(row=>row.node_id)).toEqual(path(ref.revision!).slice(first).map(row=>row.node_id));
  for(const row of ref.rows)for(const item of row.items??[])if(item.kind==='text')expect(item.text).toBe(`R${ref.revision}:${row.selection!.ordinal}`);
  const human=ref.displayPlan?.entries.find(entry=>entry.item.key===JSON.stringify([`node-${humanOrdinal}`,'body']));
  expect(human?.body).toMatchObject({kind:'typed-canonical',text:`R${ref.revision}:${humanOrdinal}`});
  for(const receipt of ref.terminalPersistedAttempts??[])expect(receipt).toMatchObject({scope,attemptId:'attempt',turnId:'turn',recordKey:'handoff:attempt',
   nodeIds:['answer'],refs:[{nodeId:'answer',ordinal:answerOrdinal,kind:'assistant_response'}]});
  trace.push({kind:'publication',generation:ref.generation,revision:ref.revision,total:ref.total,range:ref.range,
   rows:ref.rows.map(row=>row.node_id),owners:ref.assistantOwnership,presence:ref.terminalPresence});
 });
 try{
  await act(async()=>render(<CurrentSavedView fixture={f}/>,host));
  const initial=reader.acceptedView.peek(),oldRows=JSON.stringify(initial.rows);
  expect(initial.range).toEqual({first,last:answerOrdinal});expect(initial.rows).toHaveLength(selected);
  const send=f.t.send.bind(f.t);
  f.t.send=frame=>{
   const sent=send(frame);
   if(frame.t==='call'&&frame.command==='history.window'&&frame.args&&typeof frame.args==='object'
    &&'node_id' in frame.args&&frame.args.node_id==='answer')f.db.answered.add(frame.id);
   return sent;
  };
  f.db.work.lead=[{...attemptWork({threadId:'lead',attemptId:'attempt',turnId:'turn',state:'completed',truncated:true,
   refs:[{node_id:'answer',ordinal:answerOrdinal,kind:'assistant_response'}]})}];
  await act(async()=>{
   f.t.push({t:'live',thread_id:'lead',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:''}]});await flush();
   f.t.push({t:'live_end',thread_id:'lead'});await settle(f.t,f.db);
  });
  const record=handle.handoff.peek().find(item=>item.attemptId==='attempt');expect(record).toBeDefined();
  const receipt=record!.terminalPersisted;expect(receipt).toBeDefined();
  expect(handle.isReceiptObservationCurrent(record!,receipt!)).toBe(true);
  expect(handle.isDisplayOwnershipCurrent(record!,reader.acceptedView.peek().generation)).toBe(false);expect(record!.readyAttempt).toBeUndefined();
  const held=f.t.calls('history.window').filter(call=>call.args&&typeof call.args==='object'&&'node_id' in call.args&&call.args.node_id==='answer');
  expect(held).toHaveLength(1);expect(held[0]!.args).toMatchObject({node_id:'answer',before:99,after:100,items:true});
  const before=reader.acceptedView.peek();let releases=0;
  expect(reader.acceptHandoff(record!,scope,()=>{releases++;})).toBe(false);expect(releases).toBe(0);
  expect(reader.acceptedView.peek()).toBe(before);expect(handle.handoff.peek()).toContain(record);expect(before.retiredAttempts??[]).toEqual([]);
  expect(host.textContent).toContain(`R${initialRevision}:${humanOrdinal}`);expect(host.textContent).not.toContain(`R${mode==='older-point'?1:2}:${answerOrdinal}`);
  const beforeReplyPublications=trace.filter(entry=>entry.kind==='publication').length,beforeReplyReads=f.t.calls('history.window').length;
  const humanElement=host.querySelector(`[data-node="node-${humanOrdinal}"]`),bodyElement=host.querySelector(`[data-node="node-${first}"]`);
  f.db.history.lead=path(pointRevision);f.db.historyRevisions.lead=pointRevision;
  const out=f.db.answer(held[0]!);expect(out.ok).toBe(true);
  const answer=f.db.answer.bind(f.db);
  f.db.answer=call=>{
   const args=call.args;
   if(mode==='later-page-reentry'&&call.command==='history.window'&&args&&typeof args==='object'&&'ordinal' in args&&args.ordinal===first+200){
    if(!successor||!successorToken)throw new Error('Missing the actual paged lease/token');
    expect(handle.isTerminalReadCurrent(successorToken,successor)).toBe(true);expect(successor.state.peek().phase).toBe('reading');
    expect(successor.ticket.request.selection).toEqual({first,last:answerOrdinal,revision:2});
    const partial=reader.acceptedView.peek();expect(partial.revision).toBe(initialRevision);expect(partial.total).toBe(total);expect(JSON.stringify(partial.rows)).toBe(oldRows);
    expect(host.querySelector(`[data-node="node-${first}"]`)).toBe(bodyElement);expect(bodyElement?.textContent).toContain(`R${initialRevision}:${first}`);
    expect(host.querySelector(`[data-node="node-${humanOrdinal}"]`)).toBe(humanElement);expect(humanElement?.textContent).toContain(`R${initialRevision}:${humanOrdinal}`);
    expect(reader.itemAt(first)?.items?.[0]).toMatchObject({kind:'text',text:`R${initialRevision}:${first}`});
    expect(trace.some(entry=>entry.kind==='publication'&&entry.revision===2)).toBe(false);
    trace.push({kind:'partial-pages-window-check',acceptedRevision:partial.revision,range:partial.range,rows:partial.rows.length,
     lease:successor.ticket.id,completedFirstPage:first,secondPage:args.ordinal,sameBodyHost:true,sameHumanHost:true});
    reader.setAttemptPresentations([{scope,attemptId:'after-first-page',turnId:'after-first-page-turn',nodeIds:['unselected'],state:'pending'}]);
    return answer(call);
   }
   if(call.command!=='history.window'||!args||typeof args!=='object'||!('ordinal' in args)||args.ordinal!==first
    ||!('after' in args)||args.after!==Math.min(199,answerOrdinal-first))return answer(call);
   expect(successor?.ticket.request.selection).toEqual({first,last:answerOrdinal,revision:2});
   trace.push({kind:'fresh-plan',args,selection:successor?.ticket.request.selection,mode});
   if(mode==='revoke')reader.acceptedView.revoke();
   if(mode==='cancel'){if(!successor)throw new Error('Missing actual successor lease');reader.cancelTerminalRead(successor.ticket.id);}
   if(mode==='reentry')reader.setAttemptPresentations([{scope,attemptId:'newer-owner',turnId:'newer-turn',nodeIds:['unselected'],state:'pending'}]);
   const rows=path(mode==='older'?1:2).slice(first,first+Math.min(200,answerOrdinal-first+1));
   const items=mode==='gap'?rows.filter((_,index)=>index!==1):mode==='wrong-tuple'?rows.map(row=>row.node_id==='answer'?{...row,kind:'user'}:row):rows;
   return{ok:true,result:{thread_id:'lead',revision:mode==='older'?1:2,total,items}};
  };
  await act(async()=>{
   if(out.ok)f.t.ok(held[0]!.id,out.result);else f.t.ownerError(held[0]!.id,out.code,out.message??out.code);
   await settle(f.t,f.db);
  });
  const current=reader.acceptedView.peek();
  trace.push({kind:'final',revision:current.revision,total:current.total,range:current.range,held:handle.handoff.peek().map(item=>({attemptId:item.attemptId,text:item.text,ready:!!item.readyAttempt})),
   reads:f.t.calls('history.window').map(call=>({args:call.args,answered:f.db.answered.has(call.id)}))});
  if(mode!=='valid'){
   expect(current.revision,JSON.stringify(trace)).toBe(initialRevision);expect(current.range).toEqual({first,last:answerOrdinal});
   expect(current.assistantOwnership??[]).toEqual([]);expect(current.retiredAttempts??[]).toEqual([]);
   expect(JSON.stringify(current.rows)).toBe(oldRows);expect(host.textContent).not.toContain(`R${mode==='older-point'?1:2}:${answerOrdinal}`);
   if(mode==='revoke')expect(reader.acceptedView.isCurrent(before)).toBe(false);
   else{expect(reader.acceptedView.isCurrent(current)).toBe(true);expect(host.textContent).toContain(`R${initialRevision}:${humanOrdinal}`);}
   expect(handle.handoff.peek()).toContain(record);expect(record!.readyAttempt).toBeUndefined();expect(releases).toBe(0);
   if(mode==='budget'){
    expect(current.terminalPresence).toMatchObject([{phase:'settled',reason:'budget-exhausted'}]);
    const pages=f.t.calls('history.window').filter(call=>call.args&&typeof call.args==='object'&&'ordinal' in call.args&&typeof call.args.ordinal==='number'&&call.args.ordinal>=first&&call.args.ordinal<answerOrdinal&&'before' in call.args&&call.args.before===0&&'after' in call.args&&call.args.after===199);
    trace.push({kind:'budgeted-pages',count:pages.length,args:pages.map(call=>call.args)});expect(pages).toHaveLength(6);
   }
   if(mode==='older-point'){
    expect(successor).toBeUndefined();expect(f.t.calls('history.window')).toHaveLength(beforeReplyReads);
    expect(trace.filter(entry=>entry.kind==='publication')).toHaveLength(beforeReplyPublications);
    expect(host.querySelector(`[data-node="node-${humanOrdinal}"]`)).toBe(humanElement);expect(current).toBe(before);
   }
   return;
  }
  expect(trace.filter(entry=>entry.kind==='publication'&&entry.revision===2)).toHaveLength(1);
  expect(current.revision,JSON.stringify(trace)).toBe(2);
  expect(current.total).toBe(total);expect(current.range).toEqual({first,last:answerOrdinal});expect(current.rows).toHaveLength(selected);
  expect(current.assistantOwnership).toMatchObject([{scope,attemptId:'attempt',turnId:'turn',recordKey:record!.key,containerKey:record!.presentationContainer,mode:'canonical',
   refs:[{nodeId:'answer',ordinal:answerOrdinal,kind:'assistant_response'}]}]);
  expect(host.textContent).toContain(`R2:${answerOrdinal}`);expect(host.textContent).toContain(`R2:${humanOrdinal}`);
  expect(reader.acceptedView.isCurrent(before)).toBe(false);expect(JSON.stringify(initial.rows)).toBe(oldRows);
  expect(f.t.calls('history.get')).toHaveLength(0);
 }finally{
  console.log('TERMINAL_SELECTED_CUT_DISCRIMINATOR',JSON.stringify({total,first,selected,mode,trace}));
  stop();render(null,host);host.remove();f.model.dispose();f.data.stop();
 }
});
