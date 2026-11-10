// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppModel } from '../../../ui-core/src';
import { rig, type Rig } from '../../../ui-core/test/window-owner';
import { WindowedScroll } from '../screens/WindowedScroll';
import { HeadingAnchor, ReadingAnchor, ScrollIntent } from '../screens/scrollIntent';
let host:HTMLDivElement|undefined,r:Rig|undefined;
const callbacks:ResizeObserverCallback[]=[];
const pending=new Map<number,FrameRequestCallback>();let next=0;
const disconnect=vi.fn(),observe=vi.fn(),unobserve=vi.fn();
afterEach(()=>{if(host)render(null,host);host?.remove();r?.w.dispose();r?.data.stop();host=undefined;r=undefined;callbacks.length=0;pending.clear();vi.restoreAllMocks();vi.unstubAllGlobals();disconnect.mockClear();observe.mockClear();unobserve.mockClear();});
async function setup(){
  vi.stubGlobal('ResizeObserver',class {constructor(cb:ResizeObserverCallback){callbacks.push(cb);}observe=observe;unobserve=unobserve;disconnect=disconnect;});
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{pending.set(++next,cb);return next;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>pending.delete(id));
  r=await rig(3);await r.settle();host=document.createElement('div');document.body.append(host);
  const model={t:signal((key:string)=>key),shells:signal([])} as unknown as AppModel;
  const mount=()=>render(<WindowedScroll model={model} win={r!.w} renderRow={row=><div>{row.id}</div>} live={null}/>,host!);
  await act(async()=>mount());
  const w=r.w;
  const rawMeasure=w.measure.bind(w);
  const effects={measure:vi.spyOn(w,'measure'),consume:vi.spyOn(w,'consumeScroll'),heading:vi.spyOn(HeadingAnchor.prototype,'consume'),program:vi.spyOn(ScrollIntent.prototype,'program'),capture:vi.spyOn(ReadingAnchor.prototype,'capture'),gesture:vi.spyOn(ScrollIntent.prototype,'scroll')};
  const deliver=()=>callbacks[0]!([],{} as ResizeObserver);
  const drain=()=>{const tasks=[...pending.values()];pending.clear();for(const cb of tasks)cb(0);};
  return {w,model,mount,effects,deliver,drain,rawMeasure};
}
it('RO delivery only invalidates, coalesces one RAF, and unchanged drains neither publish nor consume input intent',async()=>{
  const x=await setup(),ref=x.w.acceptedView.peek(),notify=vi.fn();x.w.acceptedView.subscribe(notify);
  const box=host!.querySelector<HTMLElement>('.scroll')!;
  let top=box.scrollTop,writes=0;
  Object.defineProperty(box,'scrollTop',{configurable:true,get:()=>top,set:(value:number)=>{top=value;writes++;}});
  x.deliver();x.deliver();x.deliver();
  for(const spy of Object.values(x.effects))expect(spy).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();expect(pending.size).toBe(1);
  await act(async()=>x.drain());
  expect(x.effects.measure).toHaveBeenCalledTimes(1);
  expect(x.effects.gesture).not.toHaveBeenCalled();
  expect(x.w.acceptedView.peek()).toBe(ref);expect(notify).not.toHaveBeenCalled();expect(pending.size).toBe(0);expect(writes).toBe(0);
  x.deliver();await act(async()=>x.drain());
  expect(notify).not.toHaveBeenCalled();expect(pending.size).toBe(0);
});
it.each(['revoke','replace','dispose','unmount'] as const)('pending RO work is canceled by %s before any measurement/consumption',async boundary=>{
  const x=await setup();x.deliver();expect(pending.size).toBe(1);
  if(boundary==='revoke')x.w.acceptedView.revoke();
  if(boundary==='replace')x.w.measure([[0,45]]);
  if(boundary==='dispose')x.w.dispose();
  if(boundary==='unmount')render(null,host!);
  for(const spy of Object.values(x.effects))spy.mockClear();
  // Drain the obsolete callback alone; a later render may legitimately sync the new view.
  x.drain();
  for(const spy of Object.values(x.effects))expect(spy).not.toHaveBeenCalled();
  expect(pending.size).toBe(0);
});
it('keeps one observer across rerenders and still classifies actual user scroll input',async()=>{
  const x=await setup();x.model.shells.value=new Map();await act(async()=>x.mount());
  expect(callbacks).toHaveLength(1);expect(disconnect).not.toHaveBeenCalled();
  const box=host!.querySelector<HTMLElement>('.scroll')!;
  box.dispatchEvent(new Event('scroll',{bubbles:true}));expect(x.effects.gesture).toHaveBeenCalled();
});

it('ignores a late delivery after unmount without recreating pending work',async()=>{
  const x=await setup();render(null,host!);x.deliver();
  expect(pending.size).toBe(0);expect(disconnect).toHaveBeenCalledTimes(1);
});
it('delivery reentry during measurement still leaves at most one pending frame',async()=>{
  const x=await setup(),measure=x.rawMeasure;
  x.effects.measure.mockImplementation(changes=>{x.deliver();x.deliver();measure(changes);});
  x.deliver();await act(async()=>x.drain());
  expect(pending.size).toBe(1);expect(x.effects.measure).toHaveBeenCalledTimes(1);
});
it('preserves an upward gesture across layout reconciliation until actual resized movement',async()=>{
  const x=await setup(),box=host!.querySelector<HTMLElement>('.scroll')!;
  let height=1000;
  Object.defineProperty(box,'scrollHeight',{configurable:true,get:()=>height});
  Object.defineProperty(box,'clientHeight',{configurable:true,get:()=>200});
  box.scrollTop=800;box.dispatchEvent(new Event('scroll',{bubbles:true}));
  box.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-10}));
  x.effects.gesture.mockClear();x.deliver();x.drain();
  expect(x.effects.gesture).not.toHaveBeenCalled();
  height=1200;box.scrollTop=700;box.dispatchEvent(new Event('scroll',{bubbles:true}));
  expect(x.effects.gesture).toHaveBeenCalledTimes(1);
  expect(x.w.following.peek()).toBe(false);
});
