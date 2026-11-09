// @vitest-environment happy-dom
// Public synthetic recreation of the S7 first-arrival diagnostic; no private source ancestry.
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureModel, settle } from '../../../ui-core/test/fixture';
import type { Prefs } from '../../../ui-core/src';
import { DESIGNS } from '../../registry';
import { App } from '../screens/App';
let host:HTMLElement|undefined,cleanup:(()=>void)|undefined;
afterEach(()=>{if(host)render(null,host);host?.remove();host=undefined;cleanup?.();cleanup=undefined;});
const raw='{"synthetic_tool_arguments":"RAW_TOOL_BOUNDARY_SENTINEL"}';
type Scenario = 'ref-first'|'history-first'|'missing'|'error'|'message'|'mixed'|'owner-ABA';
async function rig(order:Scenario){
  let refsReady=['ref-first','message','mixed'].includes(order);
  const refKind=order==='message'?'message':'function_call';
  const r=await fixtureModel({configure(db){
    const base=db.answer.bind(db);
    db.answer=c=>c.command==='status'?order==='error'?{ok:false,code:'not_found',message:'synthetic lookup failure'}:{ok:true,result:{items:refsReady?[{kind:'attempt',id:'synthetic-attempt',attempt_id:'synthetic-attempt',thread_id:'lead',turn_id:'synthetic-turn',state:'completed',response_nodes:[{ordinal:0,node_id:'synthetic-tool-node',kind:refKind,phase:refKind==='message'?'final_answer':null},...(order==='mixed'?[{ordinal:1,node_id:'synthetic-tool-node',kind:'message',phase:'final_answer'}]:[])],response_nodes_truncated:false}]:[]}}:base(c);
  }});
  host=document.createElement('div');document.body.append(host);cleanup=()=>r.model.dispose();
  const prefs=signal<Prefs>({design:'console',theme:'console',lang:'en',weights:{cached:.1,output:5}});
  await act(async()=>{render(<App context={{model:r.model,prefs,designs:DESIGNS,setPrefs(){},submitToken:async()=>true}}/>,host!);await settle(r.t,r.db);});
  const observations:string[]=[];
  const snapshot=()=>observations.push([...host!.querySelectorAll('.msg')].map(e=>e.textContent??'').join('\n'));
  const pump=async(fn:()=>void)=>{await act(async()=>{fn();await settle(r.t,r.db);for(let n=0;n<8;n++)await Promise.resolve();});snapshot();};
  r.model.handle.value!.setWorkActive(true);await settle(r.t,r.db);snapshot();
  await pump(()=>{r.db.history.lead=[{node_id:'synthetic-tool-node',kind:'assistant_response',excerpt:raw,execution_count:0,execution_links_truncated:false}];r.t.push({t:'changed',thread_ids:['lead'],list:false});});
  if(order==='history-first')await pump(()=>{refsReady=true;r.t.push({t:'changed',thread_ids:['lead'],list:false});});
  if(order==='owner-ABA')await pump(()=>{
    const owner={state:'connected' as const,info:{protocol_version:5,instance_id:'synthetic-owner',capabilities:[]}};
    r.t.push({t:'owner',event:'restarted',owner});r.t.push({t:'owner',event:'restarted',owner});
  });
  return {observations,host:host!};
}
describe('Studio #8 first-arrival tool identity boundary',()=>{
  it.each(['ref-first','history-first','missing','error','mixed','owner-ABA'] as const)('does not publish raw tool arguments as assistant prose: %s',async order=>{
    const r=await rig(order);
    expect(r.observations.some(text=>text.includes('RAW_TOOL_BOUNDARY_SENTINEL'))).toBe(false);
  });
  it('does not remove ordinary message JSON just because its text looks like arguments',async()=>{
    const r=await rig('message');expect(r.observations.some(text=>text.includes('RAW_TOOL_BOUNDARY_SENTINEL'))).toBe(true);
  });
});
