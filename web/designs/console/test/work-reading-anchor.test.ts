// @vitest-environment happy-dom
import { expect,it } from 'vitest';
import { ReadingAnchor } from '../screens/scrollIntent';
function rig(){
 const box=document.createElement('div');box.innerHTML='<div class="conversation-items"><details open data-work-group="g" data-heading-member-keys=\'["a","b"]\'><summary data-work-heading></summary><div class="step-group-list"><div data-item-key="a" data-node="n1"></div><div data-item-key="b" data-node="n2"></div></div></details></div>';
 const rect=(el:Element,top:number,height=30)=>{el.getBoundingClientRect=()=>({top,bottom:top+height,height}) as DOMRect;};
 rect(box,0,600);const group=box.querySelector('details')!,head=group.querySelector('summary')!,a=group.querySelector<HTMLElement>('[data-item-key="a"]')!,b=group.querySelector<HTMLElement>('[data-item-key="b"]')!;
 rect(head,-60);rect(a,-30);rect(b,20);
 const context={revision:7,epoch:1,capability:{},nodes:['n1','n2'],isCurrent:()=>true};
 return{box,group,head,a,b,rect,context,anchor:new ReadingAnchor()};
}
it('recovers the exact item and actual node after remount/reparent, not DOM identity',()=>{
 const x=rig();x.anchor.capture(x.box,x.context);const replacement=x.b.cloneNode() as HTMLElement;x.b.remove();x.group.querySelector('.step-group-list')!.append(replacement);x.rect(replacement,120);
 expect(x.anchor.correction(x.box,x.context)).toBe(100);expect(replacement).not.toBe(x.b);
});
it('uses the structurally proven containing group heading when the captured item becomes hidden',()=>{
 const x=rig();x.anchor.capture(x.box,x.context);x.group.open=false;x.rect(x.head,40);
 expect(x.anchor.correction(x.box,x.context)).toBe(20);
 x.anchor.capture(x.box,x.context);x.group.open=true;x.rect(x.head,80);x.rect(x.a,100);
 expect(x.anchor.correction(x.box,x.context)).toBe(60);
});
it.each(['revision','epoch','capability','current','provenance','unloaded','duplicate','membership'] as const)('rejects invalid recovery authority: %s',kind=>{
 const x=rig();x.anchor.capture(x.box,x.context);x.rect(x.b,120);
 if(kind==='revision')x.context.revision++;
 if(kind==='epoch')x.context.epoch++;
 if(kind==='capability')x.context.capability={};
 if(kind==='current')x.context.isCurrent=()=>false;
 if(kind==='provenance')x.b.dataset.node='other';
 if(kind==='unloaded')x.context.nodes=['n1'];
 if(kind==='duplicate')x.box.querySelector('.conversation-items')!.append(x.b.cloneNode());
 if(kind==='membership'){x.group.open=false;x.group.dataset.headingMemberKeys='["a"]';}
 expect(x.anchor.correction(x.box,x.context)).toBeUndefined();
});
it('does not fall back to legacy rows after a canonical authority failure',()=>{
 const x=rig();x.b.dataset.node='';x.a.dataset.node='';x.anchor.capture(x.box,x.context);
 x.b.dataset.node='n2';x.rect(x.b,120);expect(x.anchor.correction(x.box,x.context)).toBeUndefined();
});

it('checks currentness again after a geometry getter revokes authority',()=>{
 const x=rig();x.anchor.capture(x.box,x.context);let valid=true;x.context.isCurrent=()=>valid;
 x.b.getBoundingClientRect=()=>{valid=false;return {top:120,bottom:150,height:30} as DOMRect;};
 expect(x.anchor.correction(x.box,x.context)).toBeUndefined();
});
it('rejects missing member provenance on closed fallback and does not infer from group key',()=>{
 const x=rig();x.anchor.capture(x.box,x.context);x.group.open=false;x.a.dataset.node='unknown';x.rect(x.head,40);
 expect(x.anchor.correction(x.box,x.context)).toBeUndefined();
});
it('recovers measured position after canonical item moves to a new structural parent',()=>{
 const x=rig();x.anchor.capture(x.box,x.context);
 const parent=x.box.querySelector('.conversation-items')!;parent.append(x.b);x.rect(x.b,75);
 expect(x.anchor.correction(x.box,x.context)).toBe(55);
});
