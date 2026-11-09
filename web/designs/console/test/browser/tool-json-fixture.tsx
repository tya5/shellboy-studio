import { signal } from '@preact/signals-core';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';
import type { Prefs } from '../../../../ui-core/src';
const params=new URLSearchParams(location.search),scenario=params.get('scenario')??'ref-first';
const sentinel='RAW_TOOL_FRAME_SENTINEL';
const raw=JSON.stringify({synthetic_tool_arguments:sentinel});
let refsReady=['ref-first','mixed','message'].includes(scenario);
const windowed=params.get('windowed')==='1';let historyPublished=false;
const r=await fixtureModel({...(windowed?{capabilities:['history.window']}:{}),configure(db){
  const base=db.answer.bind(db);
  db.answer=c=>c.command==='status'?(scenario==='error'?{ok:false,code:'not_found',message:'Synthetic status lookup failure'}:{ok:true,result:{items:refsReady?[{kind:'attempt',id:'synthetic-attempt',attempt_id:'synthetic-attempt',thread_id:'lead',turn_id:'synthetic-turn',state:'completed',response_nodes:[{ordinal:0,node_id:'synthetic-node',kind:scenario==='message'?'message':'function_call',phase:scenario==='message'?'final_answer':null},...(scenario==='mixed'?[{ordinal:1,node_id:'synthetic-node',kind:'message',phase:'final_answer'}]:[])],response_nodes_truncated:false}]:[]}}):c.command==='history.window'&&windowed?{ok:true,result:{thread_id:'lead',revision:1,total:historyPublished?2:1,items:historyPublished?[{node_id:'synthetic-node',kind:'assistant_response',excerpt:raw,execution_count:0,selection:{ordinal:1}}]:[{node_id:'baseline-user',kind:'user',excerpt:'Baseline synthetic human',selection:{ordinal:0}}]}}:base(c);
}});
const prefs=signal<Prefs>({design:'console',theme:params.get('theme')==='light'?'light':'console',lang:'en',weights:{cached:.1,output:5}});
mount(document.getElementById('app')!,{model:r.model,prefs,designs:DESIGNS,setPrefs:change=>{prefs.value={...prefs.value,...change};},submitToken:async()=>true});
r.model.handle.value!.setWorkActive(true);await settle(r.t,r.db);await document.fonts.ready;
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
for(let n=0;n<4;n++)await frame();
interface Sample {phase:string;rawMessages:number;visibleRawMessages:number;messageCount:number;owner:string}
const samples:Sample[]=[];let phase='before-history',running=false;
function sample(){
  const messages=[...document.querySelectorAll<HTMLElement>('.msg')];
  const rawMessages=messages.filter(e=>e.textContent?.includes(sentinel));
  const visible=rawMessages.filter(e=>{const b=e.getBoundingClientRect();return b.bottom>0&&b.top<innerHeight&&b.width>0&&b.height>0;});
  if(samples.length<128)samples.push({phase,rawMessages:rawMessages.length,visibleRawMessages:visible.length,messageCount:messages.length,owner:r.data.owner.value.state});
  if(running)requestAnimationFrame(sample);
}
const pump=async()=>{await settle(r.t,r.db);for(let n=0;n<6;n++)await frame();};
(window as unknown as {runToolBoundary:()=>Promise<unknown>}).runToolBoundary=async()=>{
  running=true;requestAnimationFrame(sample);await frame();
  phase='history-arrived';historyPublished=true;r.db.history.lead=[{node_id:'synthetic-node',kind:'assistant_response',excerpt:raw,execution_count:0,execution_links_truncated:false}];
  r.t.push({t:'changed',thread_ids:['lead'],list:false});await pump();
  if(scenario==='history-first'){phase='late-ref';refsReady=true;r.t.push({t:'changed',thread_ids:['lead'],list:false});await pump();}
  if(scenario==='owner-ABA'){phase='owner-restarted';const owner={state:'connected' as const,info:{protocol_version:5,instance_id:'synthetic-owner',capabilities:[]}};r.t.push({t:'owner',event:'restarted',owner});r.t.push({t:'owner',event:'restarted',owner});await pump();}
  if(scenario==='message' && !document.body.textContent?.includes(sentinel)) {
    phase='explicit-control-retry';const retry=r.model.handle.value!.retryPublication();await pump();await retry;
    r.t.push({t:'changed',thread_ids:['lead'],list:false});await pump();
  }
  phase='settled';await pump();running=false;await frame();
  return {scenario,samples,workCalls:r.t.calls('status').length,historyCalls:r.t.calls('history.list').length,detailsExpanded:false};
};
