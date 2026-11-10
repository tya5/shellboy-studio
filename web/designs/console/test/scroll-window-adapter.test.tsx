// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppModel } from '../../../ui-core/src';
import { rig as realWindow, type Rig } from '../../../ui-core/test/window-owner';
import { WindowedScroll } from '../screens/WindowedScroll';
import { HeadingAnchor, ReadingAnchor, ScrollIntent } from '../screens/scrollIntent';
let host:HTMLDivElement|undefined,r:Rig|undefined;
afterEach(()=>{if(host)render(null,host);host?.remove();r?.w.dispose();r?.data.stop();host=undefined;r=undefined;vi.restoreAllMocks();});
const model=()=>({t:signal((key:string)=>key),shells:signal([])}) as unknown as AppModel;
it.each(['generation','dispose','revoke'] as const)('real Window rejects obsolete DOM effects after synchronous measure %s',async boundary=>{
  r=await realWindow(3);await r.settle();const w=r.w;
  const initial=w.acceptedView.peek();
  let stale=false,once=false;const obsolete:string[]=[];
  const measure=w.measure.bind(w);
  vi.spyOn(w,'measure').mockImplementation(changes=>{
    stale=false;
    if(once)return measure(changes);
    once=true;
    if(boundary==='dispose')w.dispose();
    else if(boundary==='revoke'){w.acceptedView.revoke();expect(w.acceptedView.peek()).toBe(initial);}
    else measure(changes.map(([i])=>[i,41]));
    expect(w.acceptedView.isCurrent(initial)).toBe(false);stale=true;
  });
  const consume=w.consumeScroll.bind(w);
  vi.spyOn(w,'consumeScroll').mockImplementation((ref,id)=>{if(stale)obsolete.push('request');return consume(ref,id);});
  const heading=HeadingAnchor.prototype.consume;
  vi.spyOn(HeadingAnchor.prototype,'consume').mockImplementation(function(this:HeadingAnchor,p){if(stale)obsolete.push('heading');return heading.call(this,p);});
  const program=ScrollIntent.prototype.program;
  vi.spyOn(ScrollIntent.prototype,'program').mockImplementation(function(this:ScrollIntent,b,t){if(stale)obsolete.push('program');program.call(this,b,t);});
  const capture=ReadingAnchor.prototype.capture;
  vi.spyOn(ReadingAnchor.prototype,'capture').mockImplementation(function(this:ReadingAnchor,b){if(stale)obsolete.push('capture');capture.call(this,b);});
  const legacy=vi.spyOn(w,'takeScroll');
  host=document.createElement('div');document.body.append(host);
  await act(async()=>render(<WindowedScroll model={model()} win={w} renderRow={row=><div>{row.id}</div>} live={null}/>,host!));
  expect(once).toBe(true);expect(obsolete).toEqual([]);expect(legacy).not.toHaveBeenCalled();
});
it('real pending scroll request is non-consuming until a current commit and invalid after disposal',async()=>{
  r=await realWindow(3);await r.settle();const w=r.w;
  w.jumpToEnd();await r.settle();const ref=w.acceptedView.peek(),request=w.peekScroll(ref);
  expect(request).toBeDefined();expect(w.peekScroll(ref)).toBe(request);
  expect(w.consumeScroll(ref,{})).toBe(false);expect(w.peekScroll(ref)).toBe(request);
  expect(w.consumeScroll(ref,request!.id)).toBe(true);expect(w.acceptedView.peek()).toBe(ref);
  expect(w.peekScroll(ref)).toBeUndefined();expect(w.consumeScroll(ref,request!.id)).toBe(false);
  w.dispose();expect(w.acceptedView.isCurrent(ref)).toBe(false);expect(w.consumeScroll(ref,request!.id)).toBe(false);
});
