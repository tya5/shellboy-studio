import { signal } from '@preact/signals-core';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';
import type { Prefs } from '../../../../ui-core/src';
const params=new URLSearchParams(location.search);
const ids=['synthetic-sender-thread-one-identity-not-title','synthetic-sender-thread-two-identity-not-title'];
const windowed=params.get('windowed')==='1';
const r=await fixtureModel({...(windowed?{capabilities:['history.window']}:{}),configure(db){
  db.history.lead=ids.map((id,n)=>({node_id:`sender-${n}`,kind:'user',excerpt:`Synthetic sender message ${n}`,provenance:{sender:{kind:'model',thread_id:id,...(n===0?{label:'<Self-asserted label>'}:{})}}}));
  db.history.lead.push({node_id:'missing',kind:'user',excerpt:'Synthetic malformed model identity',provenance:{sender:{kind:'model',thread_id:null}}});
  for(const id of ids)db.threads[id]={...db.threads.lead!,thread_id:id,title:'Same current title'};
  if(windowed){const base=db.answer.bind(db);db.answer=c=>c.command==='history.window'?{ok:true,result:{thread_id:'lead',revision:1,total:db.history.lead!.length,items:db.history.lead!.map((item,ordinal)=>({...item,selection:{ordinal}}))}}:base(c);}
}});
const prefs=signal<Prefs>({design:'console',theme:params.get('theme')==='light'?'light':'console',lang:'en',weights:{cached:.1,output:5}});
mount(document.getElementById('app')!,{model:r.model,prefs,designs:DESIGNS,setPrefs:change=>{prefs.value={...prefs.value,...change};},submitToken:async()=>true});
await settle(r.t,r.db);
(window as unknown as {senderProbe:()=>Promise<unknown>}).senderProbe=async()=>{
  r.db.threads[ids[0]!]!.title='Renamed current title';r.t.push({t:'changed',thread_ids:[],list:true});await settle(r.t,r.db);
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  return {facts:[...document.querySelectorAll('.sender-fact')].map(e=>({text:e.textContent,id:e.querySelector('code')?.textContent,link:e.querySelector('a')?.getAttribute('href')})),unknown:document.body.textContent?.includes('Model sender (identity unavailable)'),injected:!!document.querySelector('.sender-fact img'),overflow:document.documentElement.scrollWidth>innerWidth,attempts:r.model.senderTitles.attemptCount,candidates:r.model.senderTitles.candidateCount};
};
