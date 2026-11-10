import '@preact/signals';
import {render} from 'preact';
import {signal} from '@preact/signals-core';
import {fixtureModel} from '../../../../ui-core/test/fixture';
import {summary,details,settle,flush} from '../../../../data/test/harness';
import {App} from '../../screens/App';
import {CurrentScrollSync} from '../../screens/scrollTransaction';
import type {DesignContext} from '../../../../ui-core/src';
import '../../../../designs/console/system/tokens/console.css';
import '../../../../designs/console/system/tokens/light.css';
import '../../../../designs/console/system/components.css';
import '../../../../designs/console/system/layout.css';
const trace={phase:'loading',samples:[] as unknown[],failures:[] as string[]};
(window as unknown as {publicTrace:typeof trace}).publicTrace=trace;
const fetchActual=async(name:string)=>{const response=await fetch('/actual-producer/'+name);if(!response.ok)throw Error('fixture unavailable '+name);return response.json();};
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const host=document.getElementById('app')!;
const check=(value:boolean,message:string)=>{if(!value)trace.failures.push(message)};
(window as unknown as {runPublic:()=>Promise<unknown>}).runPublic=async()=>{
 const typed=await fetchActual('actual-window.json'),budget=await fetchActual('response-budget-window.json'),rewindow=await fetchActual('rewindow-window.json');
 let current=typed;const f=await fixtureModel({capabilities:['history.window'],configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];const fallback=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:current}:fallback(call);}});
 try{
  trace.phase='typed App';render(<App context={{model:f.model,prefs:signal({}),setPrefs:()=>{}} as unknown as DesignContext}/>,host);await settle(f.t,f.db);for(let i=0;i<4;i++)await frame();
  const win=f.model.longReader.value!;check(!!win,'actual model Window exists');
  const elements=[...host.querySelectorAll('[data-item-key]')];check(JSON.stringify(elements.map(e=>e.getAttribute('data-node')))===JSON.stringify(['n0','n1','n1','n2','n3']),'actual text/tool order');
  check(elements[0]?.textContent===typed.items[0].items[0].text,'ordinary actual user text');check(elements[1]?.textContent?.includes('A')??false,'actual assistant text');
  const text=elements[1]!.querySelector('p')!.firstChild!,range=document.createRange();range.setStart(text,0);range.setEnd(text,1);getSelection()?.removeAllRanges();getSelection()?.addRange(range);
  win.layoutChanged();await frame();check(host.querySelectorAll('[data-item-key]')[1]===elements[1]&&getSelection()?.anchorNode===text&&getSelection()?.toString()==='A','typed DOM/selection retained');
  trace.phase='budget App';current=budget;win.jumpToEnd();await settle(f.t,f.db);for(let i=0;i<4;i++)await frame();
  check(win.acceptedView.peek().rows.length===132,'budget ordinary rows retained');check(host.querySelectorAll('[data-items-unavailable-reason="response_budget"]').length===4,'whole-node deferred suffix');
  const first=host.querySelector<HTMLElement>('[data-item-key]')!,firstText=first.querySelector('p')!.firstChild!;
  const selection=document.createRange();selection.setStart(firstText,0);selection.setEnd(firstText,8);getSelection()?.removeAllRanges();getSelection()?.addRange(selection);const selected=getSelection()?.toString();
  trace.phase='rewindow';current=rewindow;const before=win.acceptedView.peek();check(win.retryDeferred(before),'retry actual deferred');check(!win.retryDeferred(before),'duplicate retry refused');
  check(host.querySelector('[data-item-key]')===first,'retained while retry pending');await settle(f.t,f.db);for(let i=0;i<4;i++)await frame();
  check(win.acceptedView.peek().rows.length===132&&!win.acceptedView.peek().rows.some(n=>n.items===null),'rewindow restores suffix without removing ordinary nodes');
  check(host.querySelector('[data-item-key]')===first&&getSelection()?.anchorNode===firstText&&getSelection()?.toString()===selected,'budget rewindow text DOM/selection retained');
  check(f.t.calls('history.window').some(c=>(c.args as {ordinal?:number;expect_node_id?:string}).ordinal===128&&(c.args as {expect_node_id?:string}).expect_node_id==='n128'),'existing ordinal/node retry');
  trace.phase='geometry';for(let i=0;i<8;i++){await frame();const box=host.querySelector<HTMLElement>('.scroll')!,ref=win.acceptedView.peek();const sample={generation:ref.generation,pending:ref.pending,rows:ref.rows.length,client:box.clientHeight,height:box.getBoundingClientRect().height,scroll:box.scrollHeight,top:box.scrollTop,selection:getSelection()?.toString()===selected,sameDOM:host.querySelector('[data-item-key]')===first,overflow:document.documentElement.scrollWidth>innerWidth+1};trace.samples.push(sample);check(sample.height>0&&sample.client>0&&sample.top>=0&&sample.top<=Math.max(0,sample.scroll-sample.client)+1&&!sample.overflow,'real geometry bounds');check(sample.selection&&sample.sameDOM,'per-frame retained text selection');}
  trace.phase='stale boundaries';const effects=[];
  for(const action of ['replace','revoke'] as const){const original=win.acceptedView.peek();let consume=0,write=0,capture=0;const result=new CurrentScrollSync().run({acceptedView:win.acceptedView,peekScroll:r=>win.peekScroll(r),consumeScroll:(r,id)=>{consume++;return win.consumeScroll(r,id)}},{measure(){if(action==='replace')win.layoutChanged();else win.acceptedView.revoke()},plan(){return{consume(){consume++},write(){write++},capture(){capture++}}}});effects.push({action,result,consume,write,capture,sameRef:win.acceptedView.peek()===original,current:win.acceptedView.isCurrent(original)});check(result==='obsolete'&&consume===0&&write===0&&capture===0,'obsolete effects zero '+action);if(action==='revoke')check(win.acceptedView.peek()===original&&!win.acceptedView.isCurrent(original),'same-ref actual revoke');}
  trace.phase='complete';return{...trace,effects,actualProducer:true,registry:false,scrollable:trace.samples.some(s=>(s as {scroll:number;client:number}).scroll>(s as {client:number}).client),limitations:['no live owner/root','geometry bounds do not prove tail compensation','no arbitrary remount anchor proof']};
 }finally{render(null,host);f.model.dispose();f.data.stop();}
};
