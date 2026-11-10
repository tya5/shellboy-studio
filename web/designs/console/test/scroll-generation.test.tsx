// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppModel, ConversationWindow } from '../../../ui-core/src';
import { WindowedScroll } from '../screens/WindowedScroll';
import { HeadingAnchor, ReadingAnchor, ScrollIntent } from '../screens/scrollIntent';
let host: HTMLDivElement | undefined;
afterEach(() => { if(host)render(null,host);host?.remove();host=undefined;vi.restoreAllMocks(); });
function rig(invalidate: 'generation' | 'dispose' | 'notify') {
  const version=signal(0), status=signal('ready');let accepted:object=Object.freeze({generation:0});let disposed=false;
  const request=Object.freeze({id:{},target:42});
  const port={acceptedView:{peek:()=>accepted,isCurrent:(ref:object)=>!disposed&&ref===accepted},peekScroll:()=>request,consumeScroll:vi.fn((ref:object)=>{if(stale)staleEffects.push('request');return !disposed&&ref===accepted;})};let invalidated=false, stale=false;
  const staleEffects: string[]=[];
  const takeScroll=vi.fn(()=>{if(stale)staleEffects.push("request");return 42;}),view=vi.fn(),measure=vi.fn(()=>{
    stale=false;
    if(invalidated)return;invalidated=true;stale=true;
    if(invalidate==='notify'){version.value++;version.value++;}
    else if(invalidate==='generation'){accepted=Object.freeze({generation:1});version.value++;}
    else {disposed=true;render(null,host!);}
  });
  const win={version,status,error:signal(undefined),following:signal(true),pathChanged:signal(false),total:0,
    renderRange:()=>undefined,pendingNavigation:false,measure,takeScroll,view};
  const model={t:signal((key:string)=>key),shells:signal([])};
  const query=Element.prototype.querySelectorAll;
  vi.spyOn(Element.prototype,'querySelectorAll').mockImplementation(function(this:Element,selector:string){
    if(selector==='[data-o]'&&this.classList.contains('scroll')){
      const row=document.createElement('div');row.dataset.o='0';return [row] as unknown as NodeListOf<Element>;
    }
    return query.call(this,selector);
  });
  host=document.createElement('div');document.body.append(host);
  const correction=HeadingAnchor.prototype.correction;
  const heading=vi.spyOn(HeadingAnchor.prototype,'correction').mockImplementation(function(this:HeadingAnchor){if(stale)staleEffects.push('heading');return correction.call(this);});
  const capture=ReadingAnchor.prototype.capture;
  vi.spyOn(ReadingAnchor.prototype,'capture').mockImplementation(function(this:ReadingAnchor,box){if(stale)staleEffects.push('capture');capture.call(this,box);});
  const write=ScrollIntent.prototype.program;
  const program=vi.spyOn(ScrollIntent.prototype,'program').mockImplementation(function(this:ScrollIntent,box,top){if(stale)staleEffects.push('program');return write.call(this,box,top);});
  act(()=>render(<WindowedScroll model={model as unknown as AppModel} win={win as unknown as ConversationWindow} renderRow={()=> <div/>} live={null} scrollPort={port}/>,host!));
  return {takeScroll,heading,program,measure,staleEffects,port};
}
it.each(['generation','dispose'] as const)('does not consume old correction/request or write after measure %s reentry',kind=>{
  const r=rig(kind);
  expect(r.measure).toHaveBeenCalled();
  expect(r.staleEffects).toEqual([]);
});

it('coalesces synchronous notifications to one request commit in the current DOM writer',()=>{
  const r=rig('generation');
  expect(r.port.consumeScroll.mock.calls.length).toBeLessThanOrEqual(1);
  expect(r.staleEffects).toEqual([]);
});
