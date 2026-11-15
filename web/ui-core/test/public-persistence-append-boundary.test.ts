import {controlledWindow} from './controlled-window';
import {flush} from '../../data/test/harness';
import type {HistoryItem} from '../../data/src/protocol';
import {expect,it} from 'vitest';
import {readbackFixture} from '../../data/test/readback-fixture';
import {rig} from './window-owner';

import {ownedHistory} from '../../data/test/owned-history';
it('an actual public persistence observation cannot be copied into readable-original transfer authority',async()=>{
 const r=await readbackFixture();
 try{
  r.live();r.end();await r.pump();
  const original=r.h.handoff.peek()[0]!,receipt=r.receipt()!,before=r.window.acceptedView.peek();
  expect(receipt).toMatchObject({scope:r.h.handoffScope(),attemptId:'attempt',recordKey:original.key,
   presentationContainer:original.presentationContainer,nodeIds:['tool','answer'],
   refs:[{nodeId:'tool',ordinal:0,kind:'assistant_response'},{nodeId:'answer',ordinal:1,kind:'assistant_response'}]});
  let releases=0;expect(r.h.transferHandoff('attempt',()=>{releases++;return true;})).toBe(false);
  expect(releases).toBe(0);expect(r.h.handoff.peek()[0]).toBe(original);
  expect(r.window.acceptHandoff({...original,terminalPersisted:receipt},r.h.handoffScope(),()=>{releases++;})).toBe(false);
  expect(releases).toBe(0);expect(r.window.acceptedView.peek()).toBe(before);
  expect(r.window.acceptedView.peek().retiredAttempts??[]).toEqual([]);expect(r.h.handoff.peek()[0]).toBe(original);
  expect(original.text).toBe('whole live block');expect(before.rows[0]?.items).toMatchObject([{text:'Independent human'}]);
  expect(r.bodyReads()).toHaveLength(0);
 }finally{r.data.stop();}
});
it.each([2,100_000])('an append of %s never publishes a mixed-revision selected cut',async added=>{
 let sourceRevision=1;
 const r=await rig(300,{decorate:(ordinal,node)=>({...node,kind:'user',items:[{kind:'text',item_identity:'body',text:`R${sourceRevision}:${ordinal}`,text_complete:true}]})});
 await r.settle();const before=r.w.acceptedView.peek();
 const frames:{revision:number|undefined;ids:string[];bodies:string[]}[]=[];
 const stop=r.w.acceptedView.subscribe(ref=>frames.push({revision:ref.revision,ids:ref.rows.map(row=>row.node_id!),
  bodies:ref.rows.map(row=>row.items?.[0]?.kind==='text'?row.items[0].text:'unavailable')}));
 try{
  sourceRevision=2;r.owner.append(added);const mark=r.calls().length;r.w.changed();await r.settle();
  expect(r.since(mark).map(call=>call.args)).toEqual([
   {thread_id:'t',ordinal:299,before:0,after:199,expect_node_id:'n0-299',excerpt_chars:4096,items:true},
   {thread_id:'t',before:99,after:0,excerpt_chars:4096,items:true},
  ]);
  expect(before.rows.map(row=>row.items?.[0]?.kind==='text'?row.items[0].text:'unavailable')).toEqual(Array.from({length:100},(_,i)=>`R1:${200+i}`));
  for(const frame of frames)expect(frame.bodies).toEqual(frame.ids.map(id=>`R${frame.revision}:${Number(id.split('-').at(-1))}`));
  const current=r.w.acceptedView.peek(),first=300+added-100;
  expect(current.rows.map(row=>row.node_id)).toEqual(Array.from({length:100},(_,i)=>`n0-${first+i}`));
  expect(current.rows.map(row=>row.items?.[0]?.kind==='text'?row.items[0].text:'unavailable')).toEqual(Array.from({length:100},(_,i)=>`R2:${first+i}`));
 }finally{stop();r.w.dispose();r.data.stop();}
});

it.each(['valid','getter','successor-read','gap','older','revoked','detached','reentrant'] as const)('an owned fresh selection %s preserves the old cut until a current complete replacement',async mode=>{
 const r=controlledWindow(),w=r.win;
 const rows=(first:number,last:number,revision:number):HistoryItem[]=>Array.from({length:last-first+1},(_,i)=>{
  const ordinal=first+i;return{node_id:`node-${ordinal}`,kind:'user',selection:{ordinal},items:[{kind:'text',item_identity:'body',text:`R${revision}:${ordinal}`,text_complete:true}]};
 });
 try{
  r.requests[0]!.reply({ok:true,value:ownedHistory({thread_id:'t',revision:1,total:100,items:rows(0,99,1)})});await flush();
  const before=w.acceptedView.peek(),cap=w.acceptedView.currentCapability;let publications=0;
  const stop=w.acceptedView.subscribe(ref=>{publications++;if(mode==='successor-read'&&ref.revision===2)w.requestOlder();});
  w.changed();r.pending()[0]!.reply({ok:true,value:ownedHistory({thread_id:'t',revision:2,total:101,items:rows(99,100,2)})});await flush();
  expect(w.acceptedView.peek()).toBe(before);expect(w.acceptedView.currentCapability).toBe(cap);expect(publications).toBe(0);
  const fresh=r.pending()[0]!;expect(fresh.args).toMatchObject({before:99,after:0,items:true});
  let selected=rows(1,100,2),nested:ReturnType<typeof w.acceptedView.peek>|undefined;
  let selectionReads=0;
  if(mode==='getter')selected[0]={...selected[0]!,get selection(){selectionReads++;return {ordinal:selectionReads===1?1:99};}};
  if(mode==='gap')selected=selected.filter(row=>row.selection?.ordinal!==50);
  if(mode==='revoked')w.acceptedView.revoke();
  if(mode==='detached')w.view(0,600,false);
  if(mode==='reentrant')selected[0]!.provenance={get created_at(){
   w.setAttemptPresentations([{scope:'history',attemptId:'nested',turnId:'nested-turn',nodeIds:['unselected'],state:'pending'}]);nested=w.acceptedView.peek();return 'synthetic';
  }};
  fresh.reply({ok:true,value:ownedHistory({thread_id:'t',revision:mode==='older'?1:2,total:101,items:selected})});await flush();
  if(['valid','getter','successor-read'].includes(mode)){
   expect(publications).toBe(1);expect(w.acceptedView.peek().revision).toBe(2);
   expect(w.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(rows(1,100,2).map(row=>row.node_id));
  }else if(mode==='reentrant'){
   expect(nested).toBeDefined();expect(w.acceptedView.peek()).toBe(nested);expect(nested?.revision).toBe(1);
  }else{expect(w.acceptedView.peek()).toBe(before);expect(publications).toBe(0);}
  if(mode==='getter')expect(selectionReads).toBe(1);
  expect(before.rows).toEqual(rows(0,99,1));expect(w.acceptedView.isCurrent(before)).toBe(!['valid','getter','successor-read','revoked','reentrant'].includes(mode));
  expect(r.requests).toHaveLength(mode==='successor-read'?4:3);
  if(mode==='successor-read'){expect(r.pending()).toHaveLength(1);expect(r.pending()[0]!.args).toMatchObject({ordinal:0,before:0,after:99});expect(r.pending()[0]!.cancel.cancelled).toBe(false);}
  stop();
 }finally{w.dispose();expect(r.pending()).toHaveLength(0);}
});

it('a detached 1600-row selected cut refreshes in eight bounded pages, not the Thread total',async()=>{
 let sourceRevision=1;
 const r=await rig(10000,{decorate:(ordinal,node)=>({...node,kind:'user',items:[{kind:'text',item_identity:'body',text:`R${sourceRevision}:${ordinal}`,text_complete:true}]})});
 try{
  await r.settle();r.w.view(0,600,false);
  for(let i=0;i<15;i++){r.w.requestOlder();await r.settle();}
  const before=r.w.acceptedView.peek();expect(before.rows).toHaveLength(1600);const authorizedIds=before.rows.map(row=>row.node_id);
  let sawFullSuccessor=false;
  const stop=r.w.acceptedView.subscribe(ref=>{
   for(const row of ref.rows)expect(row.items?.[0]).toMatchObject({kind:'text',text:`R${ref.revision}:${row.selection?.ordinal}`});
   if(ref.rows.length===1600&&ref.rows[0]?.node_id===authorizedIds[0]){
    expect(ref.rows.map(row=>row.node_id)).toEqual(authorizedIds);sawFullSuccessor=true;
   }
  });
  sourceRevision=2;r.owner.append(1);const mark=r.calls().length;r.w.requestOlder();await r.settle();stop();
  expect(sawFullSuccessor).toBe(true);expect(before.revision).toBe(1);
  expect(before.rows[0]?.items?.[0]).toMatchObject({text:`R1:${before.range?.first}`});
  const fresh=r.since(mark).filter(call=>{const args=call.args as {before?:number;after?:number};return args.before===0&&args.after===199;});
  expect(fresh).toHaveLength(8);expect(fresh.map(call=>(call.args as {ordinal:number}).ordinal)).toEqual(Array.from({length:8},(_,i)=>8400+200*i));
  expect(r.w.following.peek()).toBe(false);expect(r.w.windowsHeld).toBeLessThanOrEqual(16);
 }finally{r.w.dispose();r.data.stop();}
});
