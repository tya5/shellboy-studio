// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { HeadingAnchor } from '../screens/scrollIntent';
function heading() {
  const node=document.createElement('summary');let top=40;
  node.getBoundingClientRect=()=>({top,bottom:top+20,height:20}) as DOMRect;
  document.body.append(node);
  return {node,move(value:number){top=value;}};
}
it('peeks without consuming while a generation is being measured',()=>{
  const a=new HeadingAnchor(),h=heading();
  try {
    a.capture(h.node);h.move(70);
    const first=a.peek();expect(first?.delta).toBe(30);
    expect(a.peek()?.delta).toBe(30);
    expect(a.consume(first!)).toBe(true);
    expect(a.peek()).toBeUndefined();
  } finally {h.node.remove();}
});
it('cannot let an obsolete plan consume a newer clicked heading',()=>{
  const a=new HeadingAnchor(),h=heading(),next=heading();
  try {
    a.capture(h.node);h.move(70);const old=a.peek()!;
    a.capture(next.node);next.move(85);
    expect(a.consume(old)).toBe(false);
    const current=a.peek()!;expect(current.delta).toBe(45);
    expect(a.consume(current)).toBe(true);
    expect(a.consume(current)).toBe(false);
  } finally {h.node.remove();next.node.remove();}
});
it('does not consume a retained plan when its measured node has disappeared',()=>{
  const a=new HeadingAnchor(),h=heading();a.capture(h.node);h.move(70);
  const plan=a.peek()!;h.node.remove();
  expect(a.consume(plan)).toBe(false);
  expect(a.peek()).toBeUndefined();
});
