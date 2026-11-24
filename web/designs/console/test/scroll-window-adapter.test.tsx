import {publishControlledAttempt} from '../../../ui-core/test/controlled-window';
import {scrollModel} from './scroll-model';
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
const model=()=>{if(!r)throw new Error("Scroll fixture has no current owner");return scrollModel(r.handle);};
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
    else {measure(changes.map(([i])=>[i,41]));publishControlledAttempt(w,'measure-successor');}
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
it('renders one accepted-view slot without legacy node wrappers or a duplicate live tail',async()=>{
  r=await realWindow(3);await r.settle();const w=r.w;
  const legacy=vi.fn(()=> <div data-legacy-row/>),slot=vi.fn((snapshot:ReturnType<typeof w.acceptedView.peek>)=><div class="conversation-items">{snapshot.rows.map(row=><div key={row.node_id} data-item-key={row.node_id} data-node={row.node_id}>item</div>)}<div class="live-tail">owned live</div></div>);
  host=document.createElement('div');document.body.append(host);
  await act(async()=>render(<WindowedScroll model={model()} win={w} renderRow={legacy} live={<div data-duplicate-live/>} renderAcceptedView={slot}/>,host!));
  expect(slot).toHaveBeenCalled();expect(legacy).not.toHaveBeenCalled();
  expect(host.querySelectorAll('.conversation-items')).toHaveLength(1);
  expect(host.querySelectorAll('.vrow')).toHaveLength(0);
  expect(host.querySelectorAll('.live-tail')).toHaveLength(1);
  expect(host.querySelector('[data-duplicate-live]')).toBeNull();
});

it.each([390, 1280])('exposes Load earlier only at an unloaded history boundary at %ipx and reuses requestOlder', async width => {
  r=await realWindow(3);await r.settle();const w=r.w;
  vi.spyOn(w,'renderRange').mockReturnValue({first:3,last:4});
  vi.spyOn(w,'isLoaded').mockReturnValue(false);
  vi.spyOn(w,'itemAt').mockReturnValue(undefined);
  const older=vi.spyOn(w,'requestOlder');
  host=document.createElement('div');host.style.width=`${width}px`;document.body.append(host);
  await act(async()=>{ render(<WindowedScroll model={model()} win={w} renderRow={row=><div>{row.id}</div>} live={null}/>,host!); w.version.value++; });
  const button=host.querySelector<HTMLButtonElement>('.history-older button');
  expect(button).toBeTruthy();
  await act(async()=>button!.click());
  expect(older).toHaveBeenCalledOnce();
  vi.mocked(w.isLoaded).mockReturnValue(true);
  await act(async()=>{ render(<WindowedScroll model={model()} win={w} renderRow={row=><div>{row.id}</div>} live={null}/>,host!); w.version.value++; });
  expect(!!host.querySelector('.history-older button')).toBe(false);
});
