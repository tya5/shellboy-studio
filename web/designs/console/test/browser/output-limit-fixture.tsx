import { signal } from '@preact/signals-core';
import { mount } from '../..';
import { DESIGNS } from '../../../registry';
import { fixtureModel, settle } from '../../../../ui-core/test/fixture';
import type { Prefs } from '../../../../ui-core/src';
const api=new URLSearchParams(location.search).get('api')??'responses';
let max:number|undefined;
const values=()=>({connections:{synthetic:{api,base_url:'https://example.invalid/v1',...(max===undefined?{}:{max_tokens:max}),extra_body:{unrelated_flag:true}}}});
const m=await fixtureModel({route:'settings',section:'connections',capabilities:['config.edit'],configure(db){const before=db.answer.bind(db);db.answer=c=>{
 if(c.command==='config.get')return {ok:true,result:{loaded:{values:values()},file:{present:true,valid:true,content_hash:'synthetic',values:values()},differs:false}};
 if(c.command==='config.set'){const changes=(c.args as {changes:{field:string;value?:number}[]}).changes;if(changes.length!==1||changes[0]!.field!=='connections.synthetic.max_tokens')throw Error('unexpected synthetic write');max=changes[0]!.value;return {ok:true,result:{written:true,restart_required:true,changes:[]}};}
 return before(c);
}}});
const prefs=signal<Prefs>({design:'console',theme:'console',lang:'en',monitorView:'cards',weights:{cached:0.1,output:5}});
mount(document.getElementById('app')!,{model:m.model,designs:DESIGNS,prefs,setPrefs:()=>{},submitToken:async()=>true});await settle(m.t,m.db);
const field=()=>document.querySelector<HTMLInputElement>('input[aria-label="Maximum output tokens"]')!;
(window as unknown as {runOutputSetting:()=>Promise<unknown>}).runOutputSetting=async()=>{
 const initial=field()?.value;
 field().value='4096';field().dispatchEvent(new Event('input',{bubbles:true}));
 const autoWrites=m.t.calls('config.set').length;
 m.model.config.review();const save=m.model.config.save();await settle(m.t,m.db);await save;
 m.model.navigate({view:'monitor'});m.model.navigate({view:'settings',section:'connections'});await settle(m.t,m.db);await new Promise(requestAnimationFrame);
 const reopened=field()?.value;
 field().value='';field().dispatchEvent(new Event('input',{bubbles:true}));m.model.config.review();const clear=m.model.config.save();await settle(m.t,m.db);await clear;await new Promise(requestAnimationFrame);
 return {api,initial,reopened,cleared:field()?.value,autoWrites,writes:m.t.calls('config.set').map(c=>c.args),calls:m.t.calls().map(c=>c.command),overflow:document.documentElement.scrollWidth>innerWidth,help:document.body.textContent?.includes('Anthropic Messages'),extra:values().connections.synthetic.extra_body};
};
