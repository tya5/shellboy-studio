// @vitest-environment happy-dom
import '@preact/signals';
import {signal} from '@preact/signals-core';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import {fixtureModel} from '../../../ui-core/test/fixture';
import {summary,details,settle} from '../../../data/test/harness';
import type {HistoryItem} from '../../../data/src/protocol';
import type {DesignContext} from '../../../ui-core/src';
import {loadPrefs} from '../../../ui-core/src/prefs';
import {App} from '../screens/App';

const typedText=(text:string)=>[{kind:'text' as const,item_identity:'text',text,text_complete:true}];
const nodes:HistoryItem[]=[
 {node_id:'internal-event',kind:'event',selection:{ordinal:0},items:typedText('from thread 11f469e1-794b-4f27-9170-7ff2240e04f7')},
 {node_id:'internal-context',kind:'context',selection:{ordinal:1},items:typedText('Synthetic developer context; not conversation prose')},
 {node_id:'human-mentions-event',kind:'user',selection:{ordinal:2},provenance:{sender:{kind:'human'}},items:typedText('Please explain Shellboy event/context. Keep this human text.')},
 {node_id:'received-user',kind:'user',selection:{ordinal:3},provenance:{sender:{kind:'model',thread_id:'synthetic-sender',label:'Synthetic sender'}},items:typedText('Legitimate received user message')},
];
it('actual strict Window -> Console classifies internal node kinds before text while preserving human and received users',async()=>{
 const f=await fixtureModel({capabilities:['history.window'],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];
  const base=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:JSON.parse(JSON.stringify({thread_id:'t',revision:9,total:nodes.length,items:nodes}))}:base(call);
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  expect(f.model.longReader.peek()!.acceptedView.peek().rows).toEqual(nodes);
  expect(f.t.calls('history.window').every(call=>(call.args as {items?:boolean}).items===true)).toBe(true);
  for(const node of nodes.slice(0,2)){
   const items=[...host.querySelectorAll(`[data-node="${node.node_id}"]`)];expect(items).toHaveLength(1);
   expect(items[0]!.closest('[data-work-group]')).not.toBeNull();
   expect(items[0]!.querySelector('[data-internal-records]')).not.toBeNull();
   expect(items[0]!.querySelector('.msg, .md, .who')).toBeNull();
   expect(host.textContent).not.toContain(node.items![0]!.kind==='text'?node.items![0]!.text:'');
  }
  const human=host.querySelector('[data-node="human-mentions-event"]')!;
  expect(human.closest('[data-work-group]')).toBeNull();expect(human.querySelector('.who')?.textContent).toContain(f.model.t.value('convo.you'));
  expect(human.querySelector('.md')?.textContent).toContain('Please explain Shellboy event/context. Keep this human text.');
  const received=host.querySelector('[data-node="received-user"]')!;
  expect(received.closest('[data-work-group]')).toBeNull();expect(received.querySelector('.md')?.textContent).toContain('Legitimate received user message');
  expect(received.textContent).toContain('synthetic-sender');expect(received.querySelector('.sender-fact')).not.toBeNull();
  expect(received.textContent).not.toContain(f.model.t.value('convo.unknownSender'));
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
