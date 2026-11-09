import { signal } from '@preact/signals-core';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';
import { WindowOwner } from '../../../../ui-core/test/window-owner';
import type { Prefs } from '../../../../ui-core/src';
const params=new URLSearchParams(location.search);
const text='Synthetic retained answer.\n\nThis paragraph stays visible across a delayed saved response and the following generation.\n\nThird paragraph for frame-height observation.';
const state={ready:false,error:false};
const windowed=params.get('windowed')==='1';
const windowOwner=new WindowOwner(300);
const {model,t,db}=await fixtureModel({capabilities:['live.text',...(windowed?['history.window']:[])],configure(db){
  const base=db.answer.bind(db);
  db.answer=c=>c.command==='status'?{ok:true,result:{items:state.ready?[{kind:'attempt',id:'a1',attempt_id:'a1',turn_id:'turn1',thread_id:'lead',state:'completed',response_nodes:[{ordinal:0,item_id:null,kind:'message',phase:'final_answer',node_id:'canonical-node'}],response_nodes_truncated:false}]:[]}}
    :c.command==='history.window'?(windowed && !(c.args as {node_id?:string}).node_id ? (()=>{const out=windowOwner.answer(c);return out.ok?{ok:true,result:{...out.result as object,thread_id:'lead'}}:out;})():{ok:true,result:{thread_id:'lead',revision:windowed?windowOwner.revision:'r',total:301,items:[{node_id:'canonical-node',kind:'assistant_response',selection:{ordinal:300},excerpt:''}]}})
    :c.command==='history.get'?state.error?{ok:false,code:'not_found',message:'Synthetic readback error'}:{ok:true,result:{node_id:'canonical-node',kind:'assistant_response',text}}
    :base(c);
}});
const prefs=signal<Prefs>({design:'console',theme:params.get('theme')==='light'?'light':'console',lang:'en',weights:{cached:.1,output:5}});
mount(document.getElementById('app')!,{model,designs:DESIGNS,prefs,setPrefs:change=>{prefs.value={...prefs.value,...change};},submitToken:async()=>true});
const live=(attempt_id:string,value:string)=>t.push({t:'live',thread_id:'lead',attempt_id,gap:false,deltas:[{offset:0,reasoning:false,text:value}]});
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
live('a1',text);await frame();await frame();
const samples:{count:number;height:number;bodyHeight:number;connected:boolean;key:string|null}[]=[];
await document.fonts.ready;
for(let n=0;n<8;n++)await frame();
const first=[...document.querySelectorAll('.msg')].find(e=>e.textContent?.includes('Synthetic retained answer.'));
let running=true;
const sample=()=>{const nodes=[...document.querySelectorAll('.msg')].filter(e=>e.textContent?.includes('Synthetic retained answer.'));const e=nodes[0];if(samples.length<256)samples.push({count:nodes.length,height:e?.getBoundingClientRect().height??0,bodyHeight:e?.querySelector('.md')?.getBoundingClientRect().height??0,connected:e===first,key:e?.closest('[data-handoff-key]')?.getAttribute('data-handoff-key')??null});if(running)requestAnimationFrame(sample);};
requestAnimationFrame(sample);
async function pump(){await settle(t,db);await frame();await frame();}
(window as unknown as {runHandoff:()=>Promise<unknown>}).runHandoff=async()=>{
  t.push({t:'live_end',thread_id:'lead'});await pump();
  t.push({t:'changed',thread_ids:['lead'],list:false});await pump();
  live('a2','Synthetic next generation.');await pump();
  state.ready=true;state.error=true;
  if(windowed){windowOwner.append(1);windowOwner.decorate=(i,item)=>i===300?{...item,node_id:'canonical-node',kind:'assistant_response',excerpt:text}:item;}t.push({t:'changed',thread_ids:['lead'],list:false});await pump();
  const failed=document.body.textContent?.includes('Could not retrieve saved response');
  state.error=false;const handle=model.handle.value!;const retry=typeof handle.retryHandoff==='function'?handle.retryHandoff():Promise.resolve();await pump();await retry;
  db.history.lead=[...(db.history.lead??[]),{node_id:'canonical-node',kind:'assistant_response',excerpt:text}];
  t.push({t:'changed',thread_ids:['lead'],list:false});await pump();
  running=false;await frame();
  return {samples,failed,ready:model.handle.value!.handoff?.value[0]?.status,bodyText:document.body.innerText};
};
