// @vitest-environment happy-dom
import {render} from 'preact';
import {expect,it,afterEach} from 'vitest';
import {projectSavedItems,type NormalizedSavedItem,type SavedItemProjection} from '../../../ui-core/src/conversation-items';
import {AcceptedView} from '../../../ui-core/src/accepted-view';
import {overlayState,reconcileOverlay,createAssociationAuthority} from '../../../data/src/overlay-reconcile';
import {ConversationItems} from '../screens/ConversationItems';
import {CurrentScrollSync} from '../screens/scrollTransaction';
const input:readonly NormalizedSavedItem[]=[
 {nodeId:'A',itemIdentity:'a0',revision:'r1',kind:'text',text:'SYNTHETIC_FIRST'},
 {nodeId:'A',itemIdentity:'a1',revision:'r1',kind:'tool',executionId:'e1'},
 {nodeId:'B',itemIdentity:'b0',revision:'r1',kind:'tool',executionId:'e2'},
 {nodeId:'B',itemIdentity:'b1',revision:'r1',kind:'text',text:'SYNTHETIC_SECOND'},
];
const host=document.createElement('div');document.body.append(host);
afterEach(()=>render(null,host));
const paint=(p:SavedItemProjection)=>render(<ConversationItems {...p} renderItem={i=><span>{i.source.kind==='text'?i.source.text:i.source.kind==='tool'?i.source.executionId:''}</span>}/>,host);
// Pre-materialized expectation is only for downstream seam tests, never a P substitute.
const downstream:SavedItemProjection=Object.freeze({items:input.map((source,i)=>({key:`test-item-${i}`,source})),toolSummaries:[{anchorKey:'test-heading',memberKeys:['test-item-1','test-item-2'],executionIds:['e1','e2']}],partitionUnknownKeys:[]});
it('actual P -> S -> D -> G can publish mixed item order',()=>{
 const p=projectSavedItems(input); // Current author scaffold throws: retain this real integration red.
 const accepted=new AcceptedView(p);paint(accepted.current);
 const writer=new CurrentScrollSync();let writes=0;
 expect(writer.run({acceptedView:{peek:()=>accepted.current,isCurrent:ref=>accepted.isCurrent(ref)},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){expect(host.querySelectorAll('[data-item-key]')).toHaveLength(4)},plan(){return{consume(){},write(){writes++},capture(){}}}})).toBe('committed');
 expect(writes).toBe(1);
 expect([...host.querySelectorAll('[data-item-key]')].map(n=>n.textContent)).toEqual(['SYNTHETIC_FIRST','e1','e2','SYNTHETIC_SECOND']);
});
it('S nested notify must not repaint obsolete D rows or recapture obsolete G revision',()=>{
 const v1={revision:'v1',projection:downstream};const v2={...v1,revision:'v2'},v3={...v1,revision:'v3'};
 const accepted=new AcceptedView(v1);const captured:string[]=[];
 accepted.subscribe(v=>{if(v.revision===v2.revision)accepted.commit(accepted.stage(v3))});
 accepted.subscribe(v=>{paint(v.projection);const sync=new CurrentScrollSync();sync.run({acceptedView:{peek:()=>accepted.current,isCurrent:r=>accepted.isCurrent(r)},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){},plan(){return{consume(){},write(){},capture(){captured.push(v.revision)}}}})});
 accepted.commit(accepted.stage(v2));
 expect(captured).toEqual(['v3']);
});
it('S/O stale notification must not release the only preview after a newer snapshot supersedes it',()=>{
 const cap=Object.freeze({scope:'synthetic'}),record=Object.freeze({key:'preview',attemptId:'a',text:'SYNTHETIC_PREVIEW'}),op={};
 let overlay=reconcileOverlay(overlayState(cap,[record]),{type:'begin',capRef:cap,operation:op});
 const authority=createAssociationAuthority<typeof cap>();
 // TEST trusted local authority only; this is NOT proof from a wire or S validation.
 const proof=authority.issue(overlay,cap,record,op,{nodeId:'A',itemIdentity:'a0',revision:'r1'})!;
 overlay=authority.associate(overlay,proof);
 const v1={id:'initial',visible:false},v2={id:'replacement',visible:true},v3={id:'newer-not-visible',visible:false};
 const accepted=new AcceptedView(v1);
 accepted.subscribe(v=>{if(('revision'in v?v.revision:v.id)===('revision'in v2?v2.revision:v2.id))accepted.commit(accepted.stage(v3))});
 accepted.subscribe(v=>{if(('revision'in v?v.revision:v.id)===('revision'in v2?v2.revision:v2.id))overlay=authority.release(overlay,proof,record,op,cap)});
 accepted.commit(accepted.stage(v2));
 expect(accepted.current).toEqual(v3);
 expect(overlay.records).toContain(record);
});
it('G cancels a measured D transaction when S changes snapshot before write',()=>{
 const accepted=new AcceptedView({revision:'old',projection:downstream});paint(accepted.current.projection);
 const sync=new CurrentScrollSync();let writes=0,captures=0;
 const result=sync.run({acceptedView:{peek:()=>accepted.current,isCurrent:r=>accepted.isCurrent(r)},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){accepted.commit(accepted.stage({...accepted.current,revision:'new'}))},plan(){return{consume(){},write(){writes++},capture(){captures++}}}});
 expect(result).toBe('obsolete');expect(writes).toBe(0);expect(captures).toBe(0);
});
it('downstream D stable items survive new S wrapper revision without reparenting',()=>{
 const accepted=new AcceptedView({revision:'v1',projection:downstream});paint(accepted.current.projection);
 const original=[...host.querySelectorAll('[data-item-key]')];accepted.subscribe(v=>paint(v.projection));
 accepted.commit(accepted.stage({...accepted.current,revision:'v2'}));
 expect([...host.querySelectorAll('[data-item-key]')]).toEqual(original);
 expect(original.every(n=>n.parentElement===host.querySelector('.conversation-items'))).toBe(true);
});
it('actual P accepted visible replacement owns text before O removes preview',()=>{
 const projection=projectSavedItems(input);const cap={},record=Object.freeze({key:'sole',attemptId:'a',text:'SYNTHETIC_FIRST'}),operation={};
 let overlay=reconcileOverlay(overlayState(cap,[record]),{type:'begin',capRef:cap,operation});const authority=createAssociationAuthority<typeof cap>();
 const proof=authority.issue(overlay,cap,record,operation,{nodeId:'A',itemIdentity:'a0',revision:'r1'})!;overlay=authority.associate(overlay,proof);
 const view=new AcceptedView({scope:'s1',revision:'initial',projection});
 view.subscribe(snapshot=>{paint(snapshot.projection);if(view.isCurrent(snapshot)&&host.textContent?.includes(record.text))overlay=authority.release(overlay,proof,record,operation,cap)});
 expect(view.commit(view.stage({scope:'s1',revision:'saved',projection}))).toBe(true);
 expect(host.textContent).toContain(record.text);expect(overlay.records).toHaveLength(0);
});
it('same-revision confirmed P text survives status-only snapshot annotations and revoked stages cannot replace it',()=>{
 const projection=projectSavedItems(input);const view=new AcceptedView({scope:'s1',revision:'r1',projection,status:'ready',links:0});paint(view.current.projection);
 view.subscribe(snapshot=>paint(snapshot.projection));
 for(const status of ['phase-absent','new-links','status-failed'])view.commit(view.stage({...view.current,status,links:status==='new-links'?1:0}));
 expect(host.textContent).toContain('SYNTHETIC_FIRST');
 const held=view.stage({...view.current,revision:'r2',projection:{...projection,items:[]}});view.revoke();
 expect(view.commit(held)).toBe(false);expect(host.textContent).toContain('SYNTHETIC_FIRST');
 // This demonstrates retention for an accepted normalized snapshot, not authorization of new body bytes.
});
it('actual AcceptedView same-ref capability revoke invalidates G before consuming or writing',()=>{
 const accepted=new AcceptedView({revision:'same'}),ref=accepted.current;let writes=0,captures=0,consumes=0;
 const result=new CurrentScrollSync().run({acceptedView:{peek:()=>accepted.current,isCurrent:r=>accepted.isCurrent(r)},peekScroll:()=>({id:Object.freeze({pending:true}),target:10}),consumeScroll:()=>{consumes++;return true}},{measure(){accepted.revoke()},plan(){return{consume(){consumes++},write(){writes++},capture(){captures++}}}});
 expect(accepted.current).toBe(ref);expect(accepted.isCurrent(ref)).toBe(false);
 expect(result).toBe('obsolete');expect(consumes).toBe(0);expect(writes).toBe(0);expect(captures).toBe(0);
});
it.each(['never_arrives','truncated','saved_evicted','outside_loaded'] as const)('O terminal %s retains original preview through S commit and cannot release/restart',reason=>{
 const cap={},record=Object.freeze({key:'terminal',attemptId:'a',text:'SYNTHETIC_RETAINED'}),operation={};const authority=createAssociationAuthority<typeof cap>();
 let state=reconcileOverlay(overlayState(cap,[record]),{type:'begin',capRef:cap,operation});
 const proof=authority.issue(state,cap,record,operation,{nodeId:'A',itemIdentity:'a0',revision:'r1'})!;state=authority.associate(state,proof);
 state=reconcileOverlay(state,{type:'terminal',capRef:cap,operation,reason});
 const accepted=new AcceptedView({revision:'terminal',projection:projectSavedItems(input)});accepted.subscribe(v=>{paint(v.projection);if(accepted.isCurrent(v))state=authority.release(state,proof,record,operation,cap)});
 accepted.commit(accepted.stage({...accepted.current,revision:'new'}));
 expect(state.records[0]).toBe(record);expect(state.terminal).toBe(reason);
 const settled=reconcileOverlay(state,{type:'settled',operation});
 expect(reconcileOverlay(settled,{type:'begin',capRef:cap,operation:{}})).toBe(settled);
});
it('S bounded staging rejects excessive input, superseded handles and getter reentry without changing current',()=>{
 const view=new AcceptedView({revision:'old',data:[] as unknown[]});const original=view.current;
 expect(()=>view.stage({revision:'large',data:Array(65537).fill(null)})).toThrow(/bound/);
 expect(view.current).toBe(original);
 const first=view.stage({revision:'one',data:[]}),second=view.stage({revision:'two',data:[]});
 expect(view.commit(first)).toBe(false);expect(view.commit(second)).toBe(true);
 const current=view.current;const reentrant={get revision(){view.revoke();return 'revoked'},data:[]};
 const staged=view.stage(reentrant);expect(view.commit(staged)).toBe(false);expect(view.current).toBe(current);
});
it('#13 real FakeTransport held shell.read keeps successful empty Output cache/DOM then accepts changed text',async()=>{
 const {fixtureModel,settle}=await import('../../../ui-core/test/fixture');const {flush}=await import('../../../data/test/harness');
 const {Output}=await import('../screens/Conversation');
 const r=await fixtureModel({configure(db){db.outputs['transport-empty']='';db.shells.lead=[{execution_id:'transport-empty',state:'running',command_excerpt:'synthetic'}];}});
 let stop:undefined|(()=>void);
 try{
  stop=r.model.watchOutput('transport-empty');await settle(r.t,r.db);
  const draw=()=>render(<Output model={r.model} id="transport-empty" command="synthetic" complete={false}/>,host);
  draw();const first=r.model.outputs.value.get('transport-empty');const original=host.querySelector('.log');
  expect(original?.textContent).toBe('No output.');
  r.t.push({t:'changed',thread_ids:['lead'],list:false});await flush();
  for(let n=0;n<8;n++){for(const call of r.t.calls().filter(c=>!r.db.answered.has(c.id)&&c.command!=='shell.read')){r.db.answered.add(call.id);const answer=r.db.answer(call);if(answer.ok)r.t.ok(call.id,answer.result);else r.t.ownerError(call.id,answer.code);}await flush();}
  const held=r.t.calls('shell.read').filter(c=>!r.db.answered.has(c.id));expect(held.length).toBeGreaterThan(0);
  draw();expect(r.model.outputs.value.get('transport-empty')).toBe(first);expect(host.querySelector('.log')).toBe(original);expect(host.textContent).not.toContain('Reading output');
  await settle(r.t,r.db);draw();expect(r.model.outputs.value.get('transport-empty')).toBe(first);expect(host.querySelector('.log')).toBe(original);
  r.db.outputs['transport-empty']='SYNTHETIC_CHANGED_OUTPUT';r.t.push({t:'changed',thread_ids:['lead'],list:false});await settle(r.t,r.db);draw();
  expect(host.textContent).toContain('SYNTHETIC_CHANGED_OUTPUT');
 }finally{stop?.();r.model.dispose();r.data.stop();}
});
