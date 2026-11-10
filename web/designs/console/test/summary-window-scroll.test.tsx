// @vitest-environment happy-dom
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach,expect,it,vi } from 'vitest';
import { connected,FakeTransport,flush } from '../../../data/test/harness';
import { ShellboyData } from '../../../data/src';
import { ConversationWindow,type WindowAcceptedSnapshot } from '../../../ui-core/src/window';
import type { AppModel } from '../../../ui-core/src';
import { fixtureModel,settle } from '../../../ui-core/test/fixture';
import { HeadingAnchor,ReadingAnchor } from '../screens/scrollIntent';
import { WindowedScroll } from '../screens/WindowedScroll';
let stop:(()=>void)|undefined;
afterEach(()=>{stop?.();stop=undefined;vi.restoreAllMocks();});
async function rig(kind:'inside'|'below', invalid?:'duplicate'|'hidden'|'revoke'|'reject'){
 const t=new FakeTransport();let serial=0;const data=new ShellboyData({transport:t,newId:()=>`g-${++serial}`});data.start();t.open();t.push({t:'hello',bridge_version:'synthetic',owner:connected});await flush();const handle=data.openThread('t');
 let target=false;const w=new ConversationWindow({read:async()=>({ok:true,value:{thread_id:'t',revision:target?2:1,total:2,items:target?[{node_id:'summary',kind:'summary',selection:{ordinal:0},items:[]},{node_id:'b',kind:'user',selection:{ordinal:1},items:[]}]:[{node_id:'a',kind:'user',selection:{ordinal:0},items:[]},{node_id:'b',kind:'user',selection:{ordinal:1},items:[]}]}})});await flush();
 const root=document.createElement('div');document.body.append(root);stop=()=>{render(null,root);root.remove();w.dispose();handle.close();data.stop();};
 const model={t:signal((key:string)=>key),shells:signal(new Map()),handle:signal(handle)} as unknown as AppModel;
 const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const top=this.dataset.node?(target?130:40):0;return{top,bottom:top+20,height:20} as DOMRect;});
 const slot=(ref:WindowAcceptedSnapshot)=><div class="conversation-items">{ref.rows.map(row=><div hidden={target&&invalid==='hidden'&&row.node_id==='summary'} data-item-key={row.node_id} data-node={row.node_id} key={row.node_id}/>)}{target&&invalid==='duplicate'&&<div data-node="summary" data-item-key="dup"/>}</div>;
 const mount=()=>render(<WindowedScroll model={model} win={w} renderRow={()=><div/>} live={null} renderAcceptedView={slot}/>,root);
 // Capture via the actual G consumer, not a fabricated S begin call.
 if(kind==='below')rect.mockImplementation(function(this:HTMLElement){const top=this.dataset.node?(target?130:this.dataset.node==='a'?-40:40):0;return{top,bottom:top+20,height:20} as DOMRect;});
 await act(async()=>mount());const sourceBox=root.querySelector<HTMLElement>('.scroll')!;
 Object.defineProperty(sourceBox,'scrollHeight',{configurable:true,value:1000});Object.defineProperty(sourceBox,'clientHeight',{configurable:true,value:100});sourceBox.scrollTop=100;sourceBox.dispatchEvent(new Event('scroll',{bubbles:true}));
 const id=w.peekSummaryTransitionId();expect(id).toBeDefined();
 target=true;w.changed();await flush();
 // S isolated fixture supplies literal membership: NOT a claim about D body-read authority.
 expect(w.acceptSummaryCoverage(handle,w.acceptedView.peek(),id!,{node_id:'summary',kind:'summary',text:'',source_node_ids:['a']})).toBe(true);
 const capture=vi.spyOn(ReadingAnchor.prototype,'capture'),heading=vi.spyOn(HeadingAnchor.prototype,'consume');
 const ref=w.acceptedView.peek(),consume=vi.spyOn(w,'consumeSummaryCoverage'),scroll=vi.spyOn(w,'consumeScroll');
 if(invalid==='reject')consume.mockReturnValue(false);
 if(invalid==='revoke')rect.mockImplementation(function(this:HTMLElement){if(this.dataset.node==='summary')w.acceptedView.revoke();return{top:130,bottom:150,height:20} as DOMRect;});
 const box=root.querySelector<HTMLElement>('.scroll')!;let top=100,writes=0;Object.defineProperty(box,'scrollTop',{configurable:true,get:()=>top,set:(value:number)=>{writes++;top=value;}});
 await act(async()=>mount());return{w,ref,consume,scroll,capture,heading,top:()=>top,writes:()=>writes,root,mount};
}
it.each(['inside','below'] as const)('actual G source capture and fresh %s geometry consume coverage once at the saved offset',async kind=>{
 const x=await rig(kind);expect(x.consume).toHaveBeenCalledTimes(1);expect(x.consume.mock.results[0]!.value).toBe(true);expect(x.top()).toBe(190);expect(x.scroll).not.toHaveBeenCalled();
 expect(x.w.peekSummaryCoverage(x.ref)).toBeUndefined();
});
it.each(['duplicate','hidden','revoke','reject'] as const)('preserves coverage and scroll request when target %s prevents commit',async mode=>{
 const x=await rig('inside',mode);expect(x.top()).toBe(100);expect(x.writes()).toBe(0);expect(x.scroll).not.toHaveBeenCalled();expect(x.capture).not.toHaveBeenCalled();expect(x.heading).not.toHaveBeenCalled();
 if(mode==='reject')expect(x.consume).toHaveBeenCalledTimes(1);else expect(x.consume).not.toHaveBeenCalled();
});

it.each(['inside','below','pause','navigation','missing'] as const)('uses actual AppModel qualified historyGet for %s without an added read',async mode=>{
 let target=false;
 const x=await fixtureModel({capabilities:['history.window'],configure:db=>{
  const answer=db.answer.bind(db);db.answer=call=>{
   if(call.command==='history.window')return{ok:true,result:{thread_id:'lead',revision:target?2:1,total:2,items:target?[{node_id:'summary',kind:'summary',selection:{ordinal:0},items:[]},{node_id:'b',kind:'user',selection:{ordinal:1},items:[]}]:[{node_id:'a',kind:'user',selection:{ordinal:0},items:[]},{node_id:'b',kind:'user',selection:{ordinal:1},items:[]}]}};
   if(call.command==='history.get'&&(call.args as {node_id?:string}).node_id==='summary')return{ok:true,result:{node_id:'summary',kind:'summary',text:'Summary',...(mode==='missing'?{}:{source_node_ids:['a']})}};
   return answer(call);
  };
 }});
 const model=x.model,w=model.longReader.peek()!;
 const root=document.createElement('div');document.body.append(root);stop=()=>{render(null,root);root.remove();model.dispose();};
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const top=this.dataset.node?(target?130:mode==='below'&&this.dataset.node==='a'?-40:40):0;return{top,bottom:top+20,height:20} as DOMRect;});
 const slot=(ref:WindowAcceptedSnapshot)=><div class="conversation-items">{ref.rows.map(row=><div data-item-key={row.node_id} data-node={row.node_id} key={row.node_id}/>)}</div>;
 await act(async()=>render(<WindowedScroll model={model} win={w} renderRow={()=><div/>} live={null} renderAcceptedView={slot}/>,root));
 const box=root.querySelector<HTMLElement>('.scroll')!;Object.defineProperty(box,'scrollHeight',{configurable:true,value:1000});Object.defineProperty(box,'clientHeight',{configurable:true,value:100});box.scrollTop=100;box.dispatchEvent(new Event('scroll',{bubbles:true}));
 expect(w.peekSummaryTransitionId()).toBeDefined();target=true;w.changed();await settle(x.t,x.db);
 let top=100;Object.defineProperty(box,'scrollTop',{configurable:true,get:()=>top,set:(n:number)=>{top=n;}});
 const accept=vi.spyOn(w,'acceptSummaryCoverage'),consume=vi.spyOn(w,'consumeSummaryCoverage');
 const reads=x.t.calls('history.get').length;
 const body=model.loadBody('summary');
 if(mode==='pause')model.handle.peek()!.pause();
 if(mode==='navigation')model.showView('monitor');
 await act(async()=>{await settle(x.t,x.db);await body;});
 expect(x.t.calls('history.get').length-reads).toBe(1);
 if(mode==='pause'||mode==='navigation'||mode==='missing'){
  expect(consume).not.toHaveBeenCalled();expect(accept.mock.results.some(result=>result.value===true)).toBe(false);return;
 }
 expect(accept).toHaveBeenCalledTimes(1);expect(accept.mock.results[0]!.value).toBe(true);
 expect(consume).toHaveBeenCalledTimes(1);expect(consume.mock.results[0]!.value).toBe(true);
 expect(top).toBe(190);
});
