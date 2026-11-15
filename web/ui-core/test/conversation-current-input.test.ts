import { expect, it } from 'vitest';
import { Handoff } from '../../data/src/handoff';
import { captureConversationInput, conversationIdentityEqual, createConversationIdentity, EMPTY_WORK_ITEMS } from '../src/conversation-input';
import { normalizeLiveWorkFacts, projectOwnedHandoffFacts, type NormalizedSavedItem } from '../src/conversation-items';
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
    expect(entry.body.cut.generation).toBe(snapshot.generation);expect(entry.body.cut.revision).toBe(authorized.revision);
    expect(entry.lifetime.cut.scope).toBe(r.handle.handoffScope());
    if(entry.body.kind==='typed-canonical')expect(entry.body.cut.capability).toBe(r.w.acceptedView.currentCapability);
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
 let work:readonly NormalizedSavedItem[]=[...valid,{domain:'live',scope:'foreign',recordId:'unissued',kind:'unknown'}]; let workSource=Object.freeze({});
 r.w.bindConversationInput(snapshot=>captureConversationInput(snapshot,{scope:r.handle.handoffScope(),threadId:'t',records:[],work,identityWork:{items:[],source:workSource},current:true}));
 try{
  await r.settle();const invalid=r.w.acceptedView.peek();expect(invalid.displayPlan?.coverage).toBe('unavailable');
  expect(invalid.displayPlan?.entries.map(entry=>entry.body)).toEqual([{kind:'typed-canonical',text:'independent-human',
   cut:{generation:invalid.generation,revision:invalid.revision,capability:r.w.acceptedView.currentCapability,scope:r.handle.handoffScope()}}]);
  expect(invalid.displayPlan?.entries[0]?.lifetime.kind).toBe('canonical-human');
  expect(r.w.refreshConversationInput(invalid)).toBe(true);expect(r.w.acceptedView.peek()).toBe(invalid);
  work=valid;workSource=Object.freeze({});r.w.refreshConversationInput(invalid);const qualified=r.w.acceptedView.peek();
  expect(qualified.displayPlan?.coverage).toBe('complete');expect(qualified.displayPlan?.workGroups).toHaveLength(1);
  r.w.acceptedView.revoke();expect(r.w.refreshConversationInput(qualified)).toBe(false);
 }finally{r.w.dispose();r.data.stop();}
});

it('empty streaming presence never creates a readable display lease or terminal body authority',()=>{
 const ledger=new Handoff(fn=>fn());
 ledger.apply({attempt_id:'empty',gap:false,deltas:[{offset:0,reasoning:false,text:''}]});
 const original=ledger.records.peek()[0]!;
 expect(projectOwnedHandoffFacts('thread',[original])).toMatchObject([{kind:'text',text:'',attemptId:'empty'}]);
 expect(ledger.captureDisplay(original)).toBeUndefined();expect(original.readyAttempt).toBeUndefined();expect(original.proof).toBeUndefined();
 ledger.finish();const confirming=ledger.records.peek()[0]!;
 expect(projectOwnedHandoffFacts('thread',[confirming])).toMatchObject([{kind:'unknown',attemptId:'empty'}]);
 expect(ledger.captureDisplay(confirming)).toBeUndefined();
 ledger.fail('empty');expect(projectOwnedHandoffFacts('thread',ledger.records.peek())).toMatchObject([{kind:'unknown',attemptId:'empty'}]);
 ledger.discard('ended');expect(ledger.records.peek()).toEqual([]);
});

it('canonical-only current input has one projection graph, while actual reservations and work still compose independently',async()=>{
 const r=await rig(2,{decorate:(ordinal,node)=>({...node,kind:'user',items:[{kind:'text',item_identity:'body',text:`Body ${ordinal}`,text_complete:true}]})});
 try{
  await r.settle();const snapshot=r.w.acceptedView.peek(),scope=r.handle.handoffScope();
  const input=captureConversationInput(snapshot,{scope,threadId:'t',records:[],work:[],current:true});
  expect(input.projection).toBe(input.canonicalProjection);expect(input.projection.items.map(item=>'text' in item.source?item.source.text:undefined)).toEqual(['Body 0','Body 1']);
  const work=normalizeLiveWorkFacts({scope:'t',items:[{id:'event',thread_id:'t',kind:'event',state:'running'}]});
  const mixed=captureConversationInput(snapshot,{scope,threadId:'t',records:[],work,current:true});
  expect(mixed.projection).not.toBe(mixed.canonicalProjection);expect(mixed.projection.items).toHaveLength(3);
  const denied=captureConversationInput(snapshot,{scope,threadId:'t',records:[],work:[],current:false});
  expect(denied.coverage).toBe('unavailable');expect(denied.projection.partitionUnknownKeys).toContain('unavailable-work-cut');
  expect(input.projection.items).toHaveLength(2);expect(r.w.acceptedView.isCurrent(snapshot)).toBe(true);
 }finally{r.w.dispose();r.data.stop();}
});

it('reuses canonical projection only for identity-stable selection cuts', async () => {
 const r = await rig(2, { decorate: (_ordinal, node) => ({ ...node, kind: 'user', items: [{ kind: 'text', item_identity: 'body', text: 'stable', text_complete: true }] }) });
 try {
  await r.settle();
  const options = { scope: r.handle.handoffScope(), threadId: 't', records: [], work: [], current: true } as const;
  expect(r.w.bindConversationInput(snapshot => captureConversationInput(snapshot, options))).toBe(true);
  expect(r.w.refreshConversationInput(r.w.acceptedView.peek())).toBe(true);
  const firstSnapshot = r.w.acceptedView.peek();
  expect(firstSnapshot.canonicalInput?.scope).toBe(options.scope);
  expect(firstSnapshot.canonicalInput).toBeDefined();
  const first = captureConversationInput(firstSnapshot, options);
  expect(first.canonicalInput).toBe(firstSnapshot.canonicalInput);
  r.w.setAttemptPresentations([{ scope: options.scope, attemptId: 'owner-only', turnId: 'turn', nodeIds: ['unselected'], state: 'pending' }]);
  const second = captureConversationInput(r.w.acceptedView.peek(), options);
  expect(second.canonicalInput.projection).toBe(first.canonicalInput.projection);
  const replaced = { ...r.w.acceptedView.peek(), rows: r.w.acceptedView.peek().rows.map(row => ({ ...row, items: [{ kind: 'text' as const, item_identity: 'body', text: 'replaced', text_complete: true }] })) };
  const third = captureConversationInput(replaced, options);
  expect(third.canonicalInput.projection).not.toBe(first.canonicalInput.projection);
  expect(third.canonicalProjection.items[0]?.source).toMatchObject({ text: 'replaced' });
  const reordered = { ...r.w.acceptedView.peek(), rows: [...r.w.acceptedView.peek().rows].reverse() };
  const reorderedInput = captureConversationInput(reordered, options);
  expect(reorderedInput.canonicalInput.projection).not.toBe(second.canonicalInput.projection);
  const revised = { ...r.w.acceptedView.peek(), revision: (r.w.acceptedView.peek().revision ?? 0) + 1 };
  const revisedInput = captureConversationInput(revised, options);
  expect(revisedInput.canonicalInput.projection).not.toBe(second.canonicalInput.projection);
  const otherScope = captureConversationInput(r.w.acceptedView.peek(), { ...options, scope: 'other-scope' });
  expect(otherScope.canonicalInput.projection).not.toBe(second.canonicalInput.projection);
 } finally { r.w.dispose(); r.data.stop(); }
});

it('compares stable work source items rather than wrapper identity',()=>{
 const base={rows:[],revision:1,assistantOwnership:[],terminalPresence:[],retiredAttempts:[],records:[],scope:'s',current:true} as const;
 const items=[{id:'work'}] as never[]; const source=Object.freeze({});
 const a=createConversationIdentity({...base,work:{items,source}}),b=createConversationIdentity({...base,work:{items,source}}),c=createConversationIdentity({...base,work:{items:[{id:'work'}] as never[],source:Object.freeze({})}});
 expect(conversationIdentityEqual(a,b)).toBe(true);expect(conversationIdentityEqual(a,c)).toBe(false);
 const emptySource=Object.freeze({});expect(conversationIdentityEqual(createConversationIdentity({...base,work:{items:EMPTY_WORK_ITEMS,source:emptySource}}),createConversationIdentity({...base,work:{items:EMPTY_WORK_ITEMS,source:emptySource}}))).toBe(true);
});
