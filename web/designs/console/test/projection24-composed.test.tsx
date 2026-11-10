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
 expect(writer.run({acceptedView:{peek:()=>accepted.current,isCurrent:ref=>accepted.current===ref},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){expect(host.querySelectorAll('[data-item-key]')).toHaveLength(4)},plan(){return{consume(){},write(){writes++},capture(){}}}})).toBe('committed');
 expect(writes).toBe(1);
 expect([...host.querySelectorAll('[data-item-key]')].map(n=>n.textContent)).toEqual(['SYNTHETIC_FIRST','e1','e2','SYNTHETIC_SECOND']);
});
it('S nested notify must not repaint obsolete D rows or recapture obsolete G revision',()=>{
 const v1={revision:'v1',projection:downstream};const v2={...v1,revision:'v2'},v3={...v1,revision:'v3'};
 const accepted=new AcceptedView(v1);const captured:string[]=[];
 accepted.subscribe(v=>{if(v===v2)accepted.commit(accepted.stage(v3),()=>true)});
 accepted.subscribe(v=>{paint(v.projection);const sync=new CurrentScrollSync();sync.run({acceptedView:{peek:()=>accepted.current,isCurrent:r=>r===accepted.current},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){},plan(){return{consume(){},write(){},capture(){captured.push(v.revision)}}}})});
 accepted.commit(accepted.stage(v2),()=>true);
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
 accepted.subscribe(v=>{if(v===v2)accepted.commit(accepted.stage(v3),()=>true)});
 accepted.subscribe(v=>{if(v===v2)overlay=authority.release(overlay,proof,record,op,cap)});
 accepted.commit(accepted.stage(v2),()=>true);
 expect(accepted.current).toBe(v3);
 expect(overlay.records).toContain(record);
});
it('G cancels a measured D transaction when S changes snapshot before write',()=>{
 const accepted=new AcceptedView({revision:'old',projection:downstream});paint(accepted.current.projection);
 const sync=new CurrentScrollSync();let writes=0,captures=0;
 const result=sync.run({acceptedView:{peek:()=>accepted.current,isCurrent:r=>r===accepted.current},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){accepted.commit(accepted.stage({...accepted.current,revision:'new'}),()=>true)},plan(){return{consume(){},write(){writes++},capture(){captures++}}}});
 expect(result).toBe('obsolete');expect(writes).toBe(0);expect(captures).toBe(0);
});
it('downstream D stable items survive new S wrapper revision without reparenting',()=>{
 const accepted=new AcceptedView({revision:'v1',projection:downstream});paint(accepted.current.projection);
 const original=[...host.querySelectorAll('[data-item-key]')];accepted.subscribe(v=>paint(v.projection));
 accepted.commit(accepted.stage({...accepted.current,revision:'v2'}),()=>true);
 expect([...host.querySelectorAll('[data-item-key]')]).toEqual(original);
 expect(original.every(n=>n.parentElement===host.querySelector('.conversation-items'))).toBe(true);
});
