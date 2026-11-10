// @vitest-environment happy-dom
import { expect,it } from 'vitest';
import { measureSummaryTransition } from '../screens/summaryAnchor';
function rig(){
 const box=document.createElement('div');box.innerHTML='<div class="conversation-items"><div class="conversation-row" data-node="summary" data-item-key="s"></div><div data-node="reader" data-item-key="r"></div></div>';
 const rect=(el:Element,top:number,height=20)=>{el.getBoundingClientRect=()=>({top,bottom:top+height,height}) as DOMRect;};
 rect(box,10,500);const summary=box.querySelector<HTMLElement>('[data-node="summary"]')!,reader=box.querySelector<HTMLElement>('[data-node="reader"]')!;rect(summary,110);rect(reader,310);
 const observation={kind:'inside' as 'inside'|'below',summaryNodeId:'summary',source:{nodeId:'old',offset:40}};
 return{box,summary,reader,rect,observation};
}
it('measures target summary against the saved viewport offset, not the old element or revision',()=>{
 const x=rig();expect(measureSummaryTransition(x.box,x.observation,()=>true)).toBe(60);
});
it('measures the surviving reader for a separately qualified below transition',()=>{
 const x=rig();x.observation.kind='below';x.observation.source.nodeId='reader';expect(measureSummaryTransition(x.box,x.observation,()=>true)).toBe(260);
});
it.each(['duplicate','hidden','missing','revoke','closed'] as const)('does not offer a correction for %s target geometry',kind=>{
 const x=rig();let current=true;
 if(kind==='duplicate')x.summary.after(x.summary.cloneNode());
 if(kind==='hidden')x.summary.hidden=true;
 if(kind==='missing')x.summary.remove();
 if(kind==='revoke')x.summary.getBoundingClientRect=()=>{current=false;return {top:110,bottom:130,height:20} as DOMRect;};
 if(kind==='closed'){const group=document.createElement('details');x.summary.replaceWith(group);group.append(x.summary);}
 expect(measureSummaryTransition(x.box,x.observation,()=>current)).toBeUndefined();
});
it('returns a fresh measured correction after remount without claiming DOM continuity',()=>{
 const x=rig(),old=x.summary,next=x.summary.cloneNode() as HTMLElement;old.replaceWith(next);x.rect(next,70);
 expect(measureSummaryTransition(x.box,x.observation,()=>true)).toBe(20);expect(next).not.toBe(old);
});
it.each([140,-40])('restores the saved summary viewport offset for signed target delta %s',top=>{
 const x=rig();let scroll=0;
 Object.defineProperty(x.box,'scrollTop',{get:()=>scroll,set:(value:number)=>{scroll=value;}});
 x.summary.getBoundingClientRect=()=>({top:top-scroll,bottom:top-scroll+20,height:20}) as DOMRect;
 const old=x.summary;const delta=measureSummaryTransition(x.box,x.observation,()=>true)!;
 x.box.scrollTop+=delta;
 expect(x.summary.getBoundingClientRect().top-x.box.getBoundingClientRect().top).toBe(40);
 expect(x.box.querySelector('[data-node="summary"]')).toBe(old);
});
