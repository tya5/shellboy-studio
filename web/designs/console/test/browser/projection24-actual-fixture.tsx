import '@preact/signals';
import {signal} from '@preact/signals-core';
import {render} from 'preact';
import {rig} from '../../../../ui-core/test/window-owner';
import {projectSavedItems,type NormalizedSavedItem} from '../../../../ui-core/src/conversation-items';
import type {AppModel} from '../../../../ui-core/src';
import {AcceptedWindowConversation} from '../../screens/Conversation';
import {WindowedScroll} from '../../screens/WindowedScroll';
import {CurrentScrollSync} from '../../screens/scrollTransaction';
import {overlayState,reconcileOverlay,createAssociationAuthority} from '../../../../data/src/overlay-reconcile';
const r=await rig(2);r.owner.decorate=(_i,item)=>({...item,kind:'user'});await r.settle();
const consumeObservations:{id:object;current:boolean;result:boolean}[]=[];
const originalConsume=r.w.consumeScroll.bind(r.w);
r.w.consumeScroll=(ref,id)=>{const current=r.w.acceptedView.isCurrent(ref);const result=originalConsume(ref,id);consumeObservations.push({id,current,result});return result;};
const initialRequest=r.w.peekScroll(r.w.acceptedView.peek());
const trace:{phase:string;samples:unknown[];error?:string}={phase:'mounted',samples:[]};
(window as unknown as {actualTrace:typeof trace}).actualTrace=trace;
const registry:NormalizedSavedItem[]=[{nodeId:'n0-0',itemIdentity:'a',revision:'body1',kind:'text',text:'SYNTHETIC_CONFIRMED'},{nodeId:'n0-0',itemIdentity:'b',revision:'body1',kind:'tool',executionId:'e1'},{nodeId:'n0-1',itemIdentity:'c',revision:'body1',kind:'tool',executionId:'e2'},{nodeId:'n0-1',itemIdentity:'d',revision:'body1',kind:'text',text:'SYNTHETIC_SECOND'}];
const projection=()=>projectSavedItems(registry.filter(item=>r.w.acceptedView.peek().rows.some(row=>row.node_id===item.nodeId)));
const model={t:signal((k:string)=>k),shells:signal([])} as unknown as AppModel;
render(<WindowedScroll model={model} win={r.w} renderRow={row=><div>{row.id}</div>} live={<AcceptedWindowConversation reader={r.w.acceptedView} project={snapshot=>projectSavedItems(registry.filter(item=>snapshot.rows.some(row=>row.node_id===item.nodeId)))} renderItem={item=><p>{item.source.kind==='text'?item.source.text:item.source.kind==='tool'?item.source.executionId:''}</p>}/>}/>,document.getElementById('app')!);
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));for(let i=0;i<5;i++)await frame();
(window as unknown as {runActual:()=>Promise<unknown>}).runActual=async()=>{
 trace.phase='ordering';const failures:string[]=[];const check=(ok:boolean,message:string)=>{if(!ok)failures.push(message)};
 const nodes=[...document.querySelectorAll<HTMLElement>('[data-item-key]')],original=nodes.slice();
 check(JSON.stringify(nodes.map(n=>n.textContent))===JSON.stringify(['SYNTHETIC_CONFIRMED','e1','e2','SYNTHETIC_SECOND']),'item order');
 check(JSON.stringify(projection().toolSummaries.map(s=>s.executionIds))===JSON.stringify([['e1','e2']]),'tool grouping');
 const text=nodes[0]!.querySelector('p')!.firstChild!,range=document.createRange();range.setStart(text,0);range.setEnd(text,9);getSelection()?.removeAllRanges();getSelection()?.addRange(range);
 const cap=r.w.acceptedView.currentCapability,record=Object.freeze({key:'sole',attemptId:'a',text:'SYNTHETIC_CONFIRMED'}),operation={};let overlay=reconcileOverlay(overlayState(cap,[record]),{type:'begin',capRef:cap,operation});const authority=createAssociationAuthority<typeof cap>();const proof=authority.issue(overlay,cap,record,operation,{nodeId:'n0-0',itemIdentity:'a',revision:'body1'})!;overlay=authority.associate(overlay,proof);
 const ownership=[];r.w.layoutChanged();await frame();const accepted=r.w.acceptedView.peek();
 ownership.push({visible:document.body.textContent!.includes(record.text),current:r.w.acceptedView.isCurrent(accepted),preview:overlay.records.includes(record)});
 if(ownership[0]!.visible&&ownership[0]!.current)overlay=authority.release(overlay,proof,record,operation,cap);
 check(ownership[0]!.preview&&ownership[0]!.visible&&overlay.records.length===0,'visible replacement before release');
 trace.phase='geometry';const samples=trace.samples as Record<string,unknown>[];for(let i=0;i<8;i++){await frame();const box=document.querySelector<HTMLElement>('.scroll')!,section=document.querySelector<HTMLElement>('[data-accepted-generation]')!;const current=r.w.acceptedView.peek();const now=[...document.querySelectorAll<HTMLElement>('[data-item-key]')];const sample={generation:current.generation,renderedGeneration:Number(section.dataset.acceptedGeneration),readiness:section.dataset.readiness,pending:current.pending,sameDOM:now.every((n,j)=>n===original[j]),selection:getSelection()?.toString(),selectionSame:getSelection()?.anchorNode===text,height:box.getBoundingClientRect().height,clientHeight:box.clientHeight,scrollHeight:box.scrollHeight,scrollTop:box.scrollTop,overflow:document.documentElement.scrollWidth>innerWidth+1};samples.push(sample);check(sample.sameDOM&&sample.selectionSame&&sample.selection==='SYNTHETIC','DOM/selection');check(sample.generation===sample.renderedGeneration&&sample.readiness===(sample.pending?'pending':'ready'),'readiness/generation');check(sample.height>0&&sample.clientHeight>0&&sample.scrollTop>=0&&sample.scrollTop<=Math.max(0,sample.scrollHeight-sample.clientHeight)+1&&!sample.overflow,'actual geometry');}
 // Actual pending command, actual Window default port; no ref-equality replacement.
 trace.phase='consume';
 const initialCalls=consumeObservations.filter(call=>call.id===initialRequest?.id);
 const observed=!!initialRequest&&initialCalls.some(call=>call.current&&call.result);
 check(observed,'initial real pending consumption unobserved');
 const successful=initialCalls.filter(call=>call.result).length;
 check(successful===1,'initial request valid consumption exactly once');
 let ref=r.w.acceptedView.peek();const pending=r.w.peekScroll(ref);
 let bad:boolean|undefined,once:boolean|undefined,twice:boolean|undefined;
 if(pending){bad=r.w.consumeScroll(ref,{});once=r.w.consumeScroll(ref,pending.id);twice=r.w.consumeScroll(ref,pending.id);check(!bad&&once&&!twice,'pending request wrong/current/duplicate');}
 else if(initialRequest){bad=r.w.consumeScroll(ref,{});twice=r.w.consumeScroll(ref,initialRequest.id);check(!bad&&!twice,'consumed request wrong/duplicate rejected');}
 const consume={observed,successful,bad,once,twice,pendingAfterMount:!!pending,unobserved:observed?[]:['initial pending command']};
 const boundaries=[];
 for(const action of ['replace','revoke'] as const){
  if(action==='revoke')r.w.layoutChanged();ref=r.w.acceptedView.peek();let consume=0,write=0,capture=0;
  const port={acceptedView:r.w.acceptedView,peekScroll:(value:typeof ref)=>r.w.peekScroll(value),consumeScroll:(value:typeof ref,id:object)=>{consume++;return r.w.consumeScroll(value,id)}};
  const result=new CurrentScrollSync().run(port,{measure(){if(action==='replace')r.w.layoutChanged();else r.w.acceptedView.revoke()},plan(){return{consume(){consume++},write(){write++},capture(){capture++}}}});
  const sameRef=r.w.acceptedView.peek()===ref,current=r.w.acceptedView.isCurrent(ref);boundaries.push({action,result,consume,write,capture,sameRef,current});check(result==='obsolete'&&consume===0&&write===0&&capture===0,'obsolete effects '+action);if(action==='revoke')check(sameRef&&!current,'same ref revoke');
 }
 trace.phase='complete';authority.dispose();r.w.dispose();r.data.stop();return{failures,actualWindow:true,defaultGMounted:true,syntheticRegistry:true,samples,ownership,consume,boundaries,unsupported:['tail-follow pixel compensation','arbitrary remount anchor','public typed producer','real owner']};
};
