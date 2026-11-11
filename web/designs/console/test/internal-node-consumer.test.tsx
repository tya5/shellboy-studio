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
it.each([true,false])('actual shared classifier consumer window=%s: classifies internal node kinds before text while preserving human and received users',async(windowed)=>{
 const f=await fixtureModel({capabilities:windowed?['history.window']:[],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=nodes;
  const base=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:JSON.parse(JSON.stringify({thread_id:'t',revision:9,total:nodes.length,items:nodes}))}:base(call);
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  if(windowed)expect(f.model.longReader.peek()!.acceptedView.peek().rows).toEqual(nodes);
  else expect(f.model.longReader.peek()).toBeUndefined();
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
  const sourceLink=received.querySelector('.who a')!;
  expect(sourceLink.textContent).toContain('syntheti');
  expect(sourceLink.getAttribute('href')).toContain('synthetic-sender');
  expect(sourceLink.getAttribute('title')).toBe('synthetic-sender');
  expect(sourceLink.getAttribute('aria-label')).toContain('synthetic-sender');
  expect(received.querySelector('.sender-fact')?.textContent).toContain('Synthetic sender');
  expect(received.textContent).not.toContain(f.model.t.value('convo.unknownSender'));
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it.each([true,false])('Core302 notification descriptors reach actual App through the issued Work bundle without extra reads: window=%s',async(windowed)=>{
 const descriptors=[
  {kind:'turn_started'},
  {kind:'recovery_resumed'},
  {kind:'instructions_observed',observation:'first_seen'},
  {kind:'instructions_observed',observation:'updated'},
  {kind:'instructions_observed',observation:'removed'},
  {kind:'thread_settings_changed',changed_fields:['cwd','model']},
  {kind:'shell_ended',execution_id:'exact-notification-exec',state:'exited',exit_code:7},
 ];
 const labels=['Turn started','Recovery resumed','Instructions observed','Instructions updated','Instructions removed','Thread settings changed','Shell execution ended'];
 // Raw text is deliberately unrelated: no notification classification may parse it.
 const input=[
  ...descriptors.map((notification,index)=>({node_id:`notification-${index}`,kind:'notification',selection:{ordinal:index},provenance:{notification},items:typedText(`PRIVATE-NOTIFICATION-BODY-${index}`)})),
  {node_id:'notification-absent',kind:'notification',selection:{ordinal:7},items:typedText('PRIVATE-ABSENT-BODY')},
  {node_id:'notification-unknown',kind:'notification',selection:{ordinal:8},provenance:{notification:{kind:'future-notice'}},items:typedText('PRIVATE-UNKNOWN-BODY')},
  {node_id:'notification-invalid',kind:'notification',selection:{ordinal:9},provenance:{notification:{kind:'shell_ended',execution_id:'invalid-exec',state:'running'}},items:typedText('PRIVATE-INVALID-BODY')},
  {node_id:'human-invalid-notification',kind:'user',selection:{ordinal:10},provenance:{sender:{kind:'human'},notification:{kind:'future-notice'}},items:typedText('Human body survives invalid optional notification')},
  {node_id:'received-invalid-notification',kind:'user',selection:{ordinal:11},provenance:{sender:{kind:'model',thread_id:'full-notification-source',label:'Claimed <source>'},notification:{kind:'shell_ended',state:'exited',execution_id:null}},items:typedText('Received body survives invalid optional notification')},
 ];
 const f=await fixtureModel({capabilities:windowed?['history.window']:[],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');
  // This is an encoded producer-shaped fixture, not a trusted typed DTO cast.
  db.history.t=JSON.parse(JSON.stringify(input));
  const base=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:JSON.parse(JSON.stringify({thread_id:'t',revision:12,total:input.length,items:input}))}:base(call);
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  for(const [index,label] of labels.entries()){
   const node=host.querySelector(`[data-node="notification-${index}"]`)!;
   expect(node).not.toBeNull();expect(node.closest('[data-work-group]')).not.toBeNull();
   const row=node.querySelector('.work-element-row')!;
   expect(row.querySelector('.work-element-row__content')?.textContent).toBe(label);
   expect(row.querySelector('.work-element-row__line')?.getAttribute('aria-label')).toContain(label);
   expect(row.querySelector('.msg, .md, textarea, button, details')).toBeNull();
   if(index!==6)expect(row.getAttribute('data-state-value')).toBeNull();
  }
  const shell=host.querySelector('[data-node="notification-6"] .work-element-row')!;
  expect(shell.getAttribute('data-state-source')).toBe('wire');expect(shell.getAttribute('data-state-value')).toBe('exited');expect(shell.getAttribute('data-exit-code')).toBe('7');
  expect(shell.querySelector('.work-element-row__state')?.textContent).toBe('exited');
  // No execution output authority or fake execution-detail fetch is added.
  expect(host.querySelector('[data-execution-id="exact-notification-exec"]')).toBeNull();
  for(const suffix of ['absent','unknown','invalid']){
   const row=host.querySelector(`[data-node="notification-${suffix}"] .work-element-row`)!;
   expect(row.textContent).toContain('A content summary was not provided');expect(row.getAttribute('data-state-value')).toBeNull();
  }
  expect(host.textContent).not.toContain('PRIVATE-');expect(host.textContent).not.toContain('invalid-exec');
  const human=host.querySelector('[data-node="human-invalid-notification"]')!;
  expect(human.querySelector('.md')?.textContent).toContain('Human body survives invalid optional notification');expect(human.querySelector('.who')?.textContent).toContain(f.model.t.value('convo.you'));
  const received=host.querySelector('[data-node="received-invalid-notification"]')!;
  expect(received.querySelector('.md')?.textContent).toContain('Received body survives invalid optional notification');
  expect(received.querySelector('.who a')?.getAttribute('href')).toContain('full-notification-source');expect(received.textContent).toContain('Claimed <source>');expect(received.querySelector('source')).toBeNull();
  const before=f.t.calls().length;
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  expect(f.t.calls()).toHaveLength(before);
  expect(host.querySelector('[data-node="notification-6"] .work-element-row')).toBe(shell);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
