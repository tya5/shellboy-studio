// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppModel, ConversationWindow } from '../../../ui-core/src';
import { WindowedScroll } from '../screens/WindowedScroll';
import { HeadingAnchor, ScrollIntent } from '../screens/scrollIntent';
let host: HTMLDivElement | undefined;
afterEach(() => { if(host)render(null,host);host?.remove();host=undefined;vi.restoreAllMocks(); });
function rig(invalidate: 'generation' | 'dispose') {
  const version=signal(0), status=signal('ready');let invalidated=false, stale=false;
  const staleEffects: string[]=[];
  const takeScroll=vi.fn(()=>{if(stale)staleEffects.push("request");return 42;}),view=vi.fn(),measure=vi.fn(()=>{
    stale=false;
    if(invalidated)return;invalidated=true;stale=true;
    if(invalidate==='generation')version.value++;
    else render(null,host!);
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
  const write=ScrollIntent.prototype.program;
  const program=vi.spyOn(ScrollIntent.prototype,'program').mockImplementation(function(this:ScrollIntent,box,top){if(stale)staleEffects.push('program');return write.call(this,box,top);});
  act(()=>render(<WindowedScroll model={model as unknown as AppModel} win={win as unknown as ConversationWindow} renderRow={()=> <div/>} live={null}/>,host!));
  return {takeScroll,heading,program,measure,staleEffects};
}
it.each(['generation','dispose'] as const)('does not consume old correction/request or write after measure %s reentry',kind=>{
  const r=rig(kind);
  expect(r.measure).toHaveBeenCalled();
  expect(r.staleEffects).toEqual([]);
});
