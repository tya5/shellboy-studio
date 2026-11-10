import {render} from 'preact';
import {projectSavedItems,type NormalizedSavedItem,type SavedItemProjection} from '../../../../ui-core/src/conversation-items';
import {AcceptedView} from '../../../../ui-core/src/accepted-view';
import {overlayState,reconcileOverlay,createAssociationAuthority} from '../../../../data/src/overlay-reconcile';
import {ConversationItems} from '../../screens/ConversationItems';
import {CurrentScrollSync} from '../../screens/scrollTransaction';
const items:NormalizedSavedItem[]=[{nodeId:'A',itemIdentity:'a',revision:'r1',kind:'text',text:'SYNTHETIC_CONFIRMED'},{nodeId:'A',itemIdentity:'b',revision:'r1',kind:'tool',executionId:'e1'},{nodeId:'B',itemIdentity:'c',revision:'r1',kind:'tool',executionId:'e2'}];
const host=document.getElementById('app')!;
const paint=(p:SavedItemProjection)=>render(<ConversationItems {...p} renderItem={i=><p>{i.source.kind==='text'?i.source.text:i.source.kind==='tool'?i.source.executionId:''}</p>}/>,host);
const precomputed:SavedItemProjection={items:items.map((source,i)=>({key:`test:${i}`,source})),toolSummaries:[{anchorKey:'heading',memberKeys:['test:1','test:2'],executionIds:['e1','e2']}],partitionUnknownKeys:[]};
(window as unknown as {runComposed:()=>Promise<unknown>}).runComposed=async()=>{
 const failures:string[]=[];let p:SavedItemProjection;let actualProjection=false;
 try{p=projectSavedItems(items);actualProjection=true}catch(e){failures.push(`P:${String(e)}`);p=precomputed;}
 // Explicit downstream observation after a failed P is not end-to-end success.
 const initial={scope:'test',revision:'v1',items:p.items,range:{start:0,end:p.items.length},total:p.items.length,projection:p};
 const accepted=new AcceptedView(initial);paint(p);
 const original=[...host.querySelectorAll('[data-item-key]')];const text=host.querySelector('[data-item-key] p')!.firstChild!;
 const range=document.createRange();range.setStart(text,0);range.setEnd(text,9);getSelection()?.removeAllRanges();getSelection()?.addRange(range);
 const v2={...initial,revision:'v2'},v3={...initial,revision:'v3'};const captures:string[]=[];
 const cap={},record=Object.freeze({key:'preview',attemptId:'a',text:'SYNTHETIC_PREVIEW'}),op={};let overlay=reconcileOverlay(overlayState(cap,[record]),{type:'begin',capRef:cap,operation:op});
 const authority=createAssociationAuthority<typeof cap>();const evidence=authority.issue(overlay,cap,record,op,{nodeId:'A',itemIdentity:'a',revision:'r1'})!;overlay=authority.associate(overlay,evidence);
 accepted.subscribe(v=>{if(v===v2)accepted.commit(accepted.stage(v3),()=>true)});
 accepted.subscribe(v=>{paint(v.projection);if(v===v2)overlay=authority.release(overlay,evidence,record,op,cap);const sync=new CurrentScrollSync();sync.run({acceptedView:{peek:()=>accepted.current,isCurrent:r=>r===accepted.current},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){},plan(){return{consume(){},write(){},capture(){captures.push(v.revision)}}}})});
 accepted.commit(accepted.stage(v2),()=>true);
 if(captures.join(',')!=='v3')failures.push('S/D/G: obsolete notify captured');if(!overlay.records.includes(record))failures.push('S/O: sole preview released by obsolete notify');
 let obsoleteWrites=0;const sync=new CurrentScrollSync();const obsolete=sync.run({acceptedView:{peek:()=>accepted.current,isCurrent:r=>r===accepted.current},peekScroll:()=>undefined,consumeScroll:()=>false},{measure(){accepted.commit(accepted.stage({...accepted.current,revision:'v4'}),()=>true)},plan(){return{consume(){},write(){obsoleteWrites++},capture(){}}}});
 const samples=[];for(let i=0;i<12;i++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const nodes=[...host.querySelectorAll<HTMLElement>('[data-item-key]')];samples.push({revision:accepted.current.revision,order:nodes.map(n=>n.textContent),sameDOM:nodes.every((n,i)=>n===original[i]),selection:getSelection()?.toString(),height:host.getBoundingClientRect().height,scrollY,overflow:document.documentElement.scrollWidth>innerWidth+1});}
 if(samples.some(s=>!s.sameDOM||s.selection!=='SYNTHETIC'||s.overflow))failures.push('D: DOM/selection/overflow');
 return {actualProjection,precomputedDownstreamOnly:!actualProjection,failures,captures,solePreviewRetained:overlay.records.includes(record),obsolete,obsoleteWrites,samples};
};
