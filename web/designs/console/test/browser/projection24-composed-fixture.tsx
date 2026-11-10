import {render} from 'preact';
import {projectSavedItems,type NormalizedSavedItem,type SavedItemProjection} from '../../../../ui-core/src/conversation-items';
import {AcceptedView} from '../../../../ui-core/src/accepted-view';
import {overlayState,reconcileOverlay,createAssociationAuthority} from '../../../../data/src/overlay-reconcile';
import {ConversationItems} from '../../screens/ConversationItems';
import {SnapshotConversation} from '../../screens/Conversation';
import {CurrentScrollSync} from '../../screens/scrollTransaction';
const items:NormalizedSavedItem[]=[{nodeId:'A',itemIdentity:'a',revision:'r1',kind:'text',text:'SYNTHETIC_CONFIRMED'},{nodeId:'A',itemIdentity:'b',revision:'r1',kind:'tool',executionId:'e1'},{nodeId:'B',itemIdentity:'c',revision:'r1',kind:'tool',executionId:'e2'},{nodeId:'B',itemIdentity:'d',revision:'r1',kind:'text',text:'SYNTHETIC_SECOND'}];
const host=document.getElementById('app')!;
const paint=(p:SavedItemProjection)=>render(<ConversationItems {...p} renderItem={i=><p>{i.source.kind==='text'?i.source.text:i.source.kind==='tool'?i.source.executionId:''}</p>}/>,host);
const precomputed:SavedItemProjection={items:items.map((source,i)=>({key:`test:${i}`,source})),toolSummaries:[{anchorKey:'heading',memberKeys:['test:1','test:2'],executionIds:['e1','e2']}],partitionUnknownKeys:[]};
(window as unknown as {runComposed:()=>Promise<unknown>}).runComposed=async()=>{
 const failures:string[]=[];let p:SavedItemProjection;let actualProjection=false;
 try{p=projectSavedItems(items);actualProjection=true}catch(e){failures.push(`P:${String(e)}`);p=precomputed;}
 // Explicit downstream observation after a failed P is not end-to-end success.
 const initial={scope:'test',revision:'v1',readiness:'ready' as const,items:p.items,range:{start:0,end:p.items.length},total:p.items.length,projection:p};
 const accepted=new AcceptedView(initial);render(<SnapshotConversation reader={accepted} renderItem={i=><p>{i.source.kind==='text'?i.source.text:i.source.kind==='tool'?i.source.executionId:''}</p>}/>,host);
 await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
 if(JSON.stringify(p.toolSummaries.map(s=>s.executionIds))!==JSON.stringify([['e1','e2']]))failures.push('P: tool grouping');
 const original=[...host.querySelectorAll('[data-item-key]')];const text=host.querySelector('[data-item-key] p')!.firstChild!;
 const range=document.createRange();range.setStart(text,0);range.setEnd(text,9);getSelection()?.removeAllRanges();getSelection()?.addRange(range);
 const v2={...initial,revision:'v2'},v3={...initial,revision:'v3'};const captures:string[]=[];
 const cap={},record=Object.freeze({key:'preview',attemptId:'a',text:'SYNTHETIC_PREVIEW'}),op={};let overlay=reconcileOverlay(overlayState(cap,[record]),{type:'begin',capRef:cap,operation:op});
 const authority=createAssociationAuthority<typeof cap>();const evidence=authority.issue(overlay,cap,record,op,{nodeId:'A',itemIdentity:'a',revision:'r1'})!;overlay=authority.associate(overlay,evidence);
 accepted.subscribe(v=>{if(v.revision===v2.revision)accepted.commit(accepted.stage(v3))});
 accepted.subscribe(v=>{if(v.revision===v2.revision)overlay=authority.release(overlay,evidence,record,op,cap);const sync=new CurrentScrollSync();sync.run({acceptedView:{peek:()=>accepted.current,isCurrent:r=>accepted.isCurrent(r)},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){},plan(){return{consume(){},write(){},capture(){captures.push(v.revision)}}}})});
 accepted.commit(accepted.stage(v2));
 if(captures.join(',')!=='v3')failures.push('S/D/G: obsolete notify captured');if(!overlay.records.includes(record))failures.push('S/O: sole preview released by obsolete notify');
 let obsoleteWrites=0;const sync=new CurrentScrollSync();const obsolete=sync.run({acceptedView:{peek:()=>accepted.current,isCurrent:r=>accepted.isCurrent(r)},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){accepted.commit(accepted.stage({...accepted.current,revision:'v4'}))},plan(){return{consume(){},write(){obsoleteWrites++},capture(){}}}});
 if(obsolete!=='obsolete'||obsoleteWrites!==0)failures.push('G: obsolete transaction wrote or wrong result');
 const sameRef=accepted.current;let revokeWrites=0,revokeCaptures=0;
 const revoked=new CurrentScrollSync().run({acceptedView:{peek:()=>accepted.current,isCurrent:r=>accepted.isCurrent(r)},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){accepted.revoke()},plan(){return{consume(){},write(){revokeWrites++},capture(){revokeCaptures++}}}});
 if(accepted.current!==sameRef||accepted.isCurrent(sameRef)||revoked!=='obsolete'||revokeWrites!==0||revokeCaptures!==0)failures.push('G: same-ref capability revoke wrote/captured');
 const samples=[];for(let i=0;i<12;i++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const nodes=[...host.querySelectorAll<HTMLElement>('[data-item-key]')];samples.push({revision:accepted.current.revision,renderedRevision:host.querySelector('[data-accepted-revision]')?.getAttribute('data-accepted-revision'),order:nodes.map(n=>n.textContent),sameDOM:nodes.every((n,i)=>n===original[i]),selection:getSelection()?.toString(),height:host.getBoundingClientRect().height,scrollY,overflow:document.documentElement.scrollWidth>innerWidth+1});}
 if(samples.some(s=>s.renderedRevision!==s.revision))failures.push('D: rendered revision stale');
 if(samples.some(s=>JSON.stringify(s.order)!==JSON.stringify(['SYNTHETIC_CONFIRMED','e1','e2','SYNTHETIC_SECOND'])))failures.push('P/D: full text/tool item order');
 if(samples.some(s=>!s.sameDOM||s.selection!=='SYNTHETIC'||s.overflow))failures.push('D: DOM/selection/overflow');
 return {actualProjection,precomputedDownstreamOnly:!actualProjection,failures,captures,solePreviewRetained:overlay.records.includes(record),obsolete,obsoleteWrites,revoked,revokeWrites,revokeCaptures,samples};
};
