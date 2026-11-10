// @vitest-environment happy-dom
import { expect,it } from 'vitest';
import { measureAcceptedRows } from '../screens/acceptedRowMeasure';
const rows=[{node_id:'n1',selection:{ordinal:1}},{node_id:'n2',selection:{ordinal:2}}];
function group(open=false){
 const root=document.createElement('div');root.innerHTML=`<div class="conversation-items"><details data-work-group="g" data-heading-member-keys='["a","b"]' ${open?'open':''}><summary data-work-heading>Work</summary><div class="step-group-list"><div data-item-key="a" data-work-item-key="a" data-node="n1"></div><div data-item-key="b" data-work-item-key="b" data-node="n2"></div></div></details></div>`;
 const g=root.querySelector('details')!,head=g.querySelector('summary')!,items=[...g.querySelectorAll('[data-item-key]')];
 const height=(el:Element,h:number)=>{el.getBoundingClientRect=()=>({height:h}) as DOMRect;};
 height(g,open?90:20);height(head,20);height(items[0]!,30);height(items[1]!,40);
 return{root,g,head,items,height};
}
it('attributes a closed whole group once to the first explicit member, clearing hidden member heights',()=>{
 const x=group();expect(measureAcceptedRows(x.root,rows)).toEqual([[1,20],[2,0]]);
});
it('attributes an open heading once and exact children to their actual nodes, without adding container height twice',()=>{
 const x=group(true);expect(measureAcceptedRows(x.root,rows)).toEqual([[1,50],[2,40]]);
});
it('rejects unresolved or ambiguous membership instead of guessing from a group key',()=>{
 const x=group();x.g.dataset.headingMemberKeys='["missing"]';expect(measureAcceptedRows(x.root,rows)).toEqual([]);
 x.g.dataset.headingMemberKeys='["a","b"]';x.items[1]!.setAttribute('data-item-key','a');expect(measureAcceptedRows(x.root,rows)).toEqual([]);
});
it('rejects open geometry with unattributed space and excludes an explicitly marked live child',()=>{
 const x=group(true);x.height(x.g,100);expect(measureAcceptedRows(x.root,rows)).toEqual([]);
 x.height(x.g,90);const live=document.createElement('div');live.dataset.liveOverlay='';x.g.querySelector('.step-group-list')!.append(live);x.height(live,0);
 expect(measureAcceptedRows(x.root,rows)).toEqual([[1,50],[2,40]]);
 x.height(live,12);x.height(x.g,102);expect(measureAcceptedRows(x.root,rows)).toEqual([]);
});

it('accepts the exact D conversation-row steps wrapper without double counting it',()=>{
 const x=group(true),wrapper=document.createElement('div');wrapper.className='conversation-row steps';
 x.g.replaceWith(wrapper);wrapper.append(x.g);x.height(wrapper,90);
 expect(measureAcceptedRows(x.root,rows)).toEqual([[1,50],[2,40]]);
 x.height(wrapper,100);expect(measureAcceptedRows(x.root,rows)).toEqual([]);
});
