// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { measureAcceptedRows } from '../screens/acceptedRowMeasure';
it('sums distinct items and assigns group heading to its first authoritative member, never anchorKey',()=>{
  const root=document.createElement('div');
  root.innerHTML='<div class="conversation-items"><div data-heading-anchor-key="chrome" data-heading-member-keys=\'["b","a"]\'></div><div data-item-key="a" data-node="n1"></div><div data-item-key="b" data-node="n2"></div><div data-item-key="c" data-node="n1"></div><div data-node="n3" data-items-unavailable-reason="legacy"></div></div>';
  [...root.firstElementChild!.children].forEach((el,i)=>{el.getBoundingClientRect=()=>({height:[10,20,30,40,50][i]}) as DOMRect;});
  expect(measureAcceptedRows(root,[{node_id:'n1',selection:{ordinal:4}},{node_id:'n2',selection:{ordinal:5}},{node_id:'n3',selection:{ordinal:6}}])).toEqual([[4,60],[5,40],[6,50]]);
});
it('does not guess unresolved headings or duplicate authoritative item identities',()=>{
  const root=document.createElement('div');root.innerHTML='<div class="conversation-items"><div data-heading-anchor-key="n1" data-heading-member-keys=\'["missing"]\'></div><div data-item-key="x" data-node="n1"></div><div data-item-key="x" data-node="n1"></div></div>';
  expect(measureAcceptedRows(root,[{node_id:'n1',selection:{ordinal:0}}])).toEqual([]);
});

it.each([
  `<div data-heading-member-keys='["missing"]'></div><div data-item-key="x" data-node="n1"></div>`,
  '<div data-item-key="x" data-node="n1"></div><div data-item-key="x" data-node="n1"></div>',
])('independently rejects invalid measurement identities: %s', html=>{
  const root=document.createElement('div');root.innerHTML='<div class="conversation-items">'+html+'</div>';
  expect(measureAcceptedRows(root,[{node_id:'n1',selection:{ordinal:0}}])).toEqual([]);
});
it('excludes explicit live overlay height from saved ordinal measurement',()=>{
  const root=document.createElement('div');root.innerHTML='<div class="conversation-items"><div data-item-key="x" data-node="n1"></div><div class="live-tail" data-node="n1"></div></div>';
  [...root.firstElementChild!.children].forEach(el=>{el.getBoundingClientRect=()=>({height:20}) as DOMRect;});
  expect(measureAcceptedRows(root,[{node_id:'n1',selection:{ordinal:0}}])).toEqual([[0,20]]);
});
