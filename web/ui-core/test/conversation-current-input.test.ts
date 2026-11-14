import { expect, it } from 'vitest';
import { Handoff } from '../../data/src/handoff';
import { captureConversationInput } from '../src/conversation-input';
import { normalizeLiveWorkFacts, type NormalizedSavedItem } from '../src/conversation-items';
import { rig } from './window-owner';

it('captures B rather than relabeling A or two revoked handoffs on every rewrite publication',async()=>{
 let path='A';
 const r=await rig(1,{decorate:(ordinal,node)=>({...node,kind:'user',
  items:[{kind:'text',item_identity:'human',text:`canonical-${path}`,text_complete:true}],
  provenance:{kind:'human',sender:{kind:'human'}}})});
 const ledger=new Handoff(fn=>fn());
 r.w.bindConversationInput(snapshot=>captureConversationInput(snapshot,{scope:r.handle.handoffScope(),threadId:'t',
  records:ledger.records.value,work:[],current:true}));
 let authorized={revision:1,node:'n0-0',texts:['canonical-A'],kinds:['canonical-human']};
 const publications:{revision:number|undefined;texts:string[];kinds:string[]}[]=[];
 const stop=r.w.acceptedView.subscribe(snapshot=>{
  expect(r.w.acceptedView.isCurrent(snapshot)).toBe(true);
  expect(snapshot.displayPlan?.revision).toBe(snapshot.revision);
  expect(snapshot.displayPlan?.capability).toBe(r.w.acceptedView.currentCapability);
  const texts=(snapshot.displayPlan?.entries??[]).flatMap(entry=>entry.body.kind==='typed-canonical'||entry.body.kind==='preview'?[entry.body.text]:[]);
  const kinds=(snapshot.displayPlan?.entries??[]).map(entry=>entry.lifetime.kind);
  expect(snapshot.displayPlan?.acceptedGeneration).toBe(snapshot.generation);
  expect(snapshot.displayPlan?.scope).toBe(r.handle.handoffScope());
  if(snapshot.revision===undefined){expect(texts).toEqual([]);expect(snapshot.rows).toEqual([]);}
  else {
   expect(snapshot.revision).toBe(authorized.revision);expect(snapshot.rows.map(row=>row.node_id)).toEqual([authorized.node]);
   expect(texts).toEqual(authorized.texts);expect(kinds).toEqual(authorized.kinds);
   for(const entry of snapshot.displayPlan?.entries??[]){
    expect(entry.body.generation).toBe(snapshot.generation);expect(entry.body.revision).toBe(authorized.revision);
    expect(entry.lifetime.scope).toBe(r.handle.handoffScope());
    if(entry.body.kind==='typed-canonical')expect(entry.body.capability).toBe(r.w.acceptedView.currentCapability);
   }
  }
  publications.push({revision:snapshot.revision,texts,kinds});
 });
 try{
  await r.settle();
  for(const attempt of ['one','two'])ledger.apply({attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:`preview-${attempt}`}]});
  authorized={...authorized,texts:['canonical-A','preview-one','preview-two'],kinds:['canonical-human','valid-owner','valid-owner']};
  r.w.refreshConversationInput(r.w.acceptedView.peek());
  const owned=r.w.acceptedView.peek().displayPlan!;
  expect(owned.entries.flatMap(entry=>entry.body.kind==='preview'?[entry.body.text]:[])).toEqual(['preview-one','preview-two']);
  expect(owned.entries.find(entry=>entry.body.kind==='typed-canonical')?.lifetime.kind).toBe('canonical-human');
  authorized={revision:2,node:'n1-0',texts:['canonical-B'],kinds:['canonical-human']};
  ledger.discard('owner_restarted');path='B';r.owner.rewrite(1);r.w.changed();await r.settle();
  const current=r.w.acceptedView.peek();expect(current.revision).toBe(2);
  expect(current.rows.map(row=>row.node_id)).toEqual(['n1-0']);
  const rewritten=publications.filter(frame=>frame.revision===2);expect(rewritten.length).toBeGreaterThan(0);
  for(const frame of rewritten){expect(frame.texts).toEqual(['canonical-B']);expect(frame.kinds).toEqual(['canonical-human']);}
  const before=publications.length;r.w.layoutChanged();expect(r.w.acceptedView.peek()).toBe(current);expect(publications).toHaveLength(before);
 }finally{stop();ledger.discard('ended');r.w.dispose();r.data.stop();}
});

it('keeps an invalid current Work cut unavailable without withdrawing an independently typed human',async()=>{
 const r=await rig(1,{decorate:(ordinal,node)=>({...node,kind:'user',
  items:[{kind:'text',item_identity:'human',text:'independent-human',text_complete:true}],
  provenance:{kind:'human',sender:{kind:'human'}}})});
 const valid=normalizeLiveWorkFacts({scope:'t',items:[{kind:'progress',id:'valid',thread_id:'t',state:'running'}]});
 let work:readonly NormalizedSavedItem[]=[...valid,{domain:'live',scope:'foreign',recordId:'unissued',kind:'unknown'}];
 r.w.bindConversationInput(snapshot=>captureConversationInput(snapshot,{scope:r.handle.handoffScope(),threadId:'t',records:[],work,current:true}));
 try{
  await r.settle();const invalid=r.w.acceptedView.peek();expect(invalid.displayPlan?.coverage).toBe('unavailable');
  expect(invalid.displayPlan?.entries.map(entry=>entry.body)).toEqual([{kind:'typed-canonical',text:'independent-human',
   generation:invalid.generation,revision:invalid.revision,capability:r.w.acceptedView.currentCapability}]);
  expect(invalid.displayPlan?.entries[0]?.lifetime.kind).toBe('canonical-human');
  expect(r.w.refreshConversationInput(invalid)).toBe(true);expect(r.w.acceptedView.peek()).toBe(invalid);
  work=valid;r.w.refreshConversationInput(invalid);const qualified=r.w.acceptedView.peek();
  expect(qualified.displayPlan?.coverage).toBe('complete');expect(qualified.displayPlan?.workGroups).toHaveLength(1);
  r.w.acceptedView.revoke();expect(r.w.refreshConversationInput(qualified)).toBe(false);
 }finally{r.w.dispose();r.data.stop();}
});
