// @vitest-environment happy-dom
import '@preact/signals';
import {signal} from '@preact/signals-core';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import {fixtureModel} from '../../../ui-core/test/fixture';
import {summary,details,settle,flush} from '../../../data/test/harness';
import type {HistoryItem} from '../../../data/src/protocol';
import type {DesignContext} from '../../../ui-core/src';
import {loadPrefs} from '../../../ui-core/src/prefs';
import {App} from '../screens/App';
import {Composer} from '../system/components/Composer';

for(const windowed of [true,false])for(const savedBeforeAck of [false,true])it(`submitted message remains separate until exact acceptance and saved arrival: window=${windowed} savedFirst=${savedBeforeAck}`,async()=>{
 let rows:HistoryItem[]=[];
 const f=await fixtureModel({capabilities:windowed?['history.window']:[],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];
  const base=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:{thread_id:'t',revision:rows.length+1,total:rows.length,items:rows}}:base(call);
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const composer=host.querySelector<HTMLTextAreaElement>('#composer')!;
  await act(async()=>{composer.value='Own submitted message';composer.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{composer.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await flush(8);});
  expect(f.model.pendingOwnMessage.peek()).toBeDefined();
  expect(f.model.pendingOwnIsCurrent()).toBe(true);
  if(!windowed)expect(f.model.legacyPresentation.peek()?.isCurrent(f.model.legacyPresentation.peek()!.acceptedView.peek())).toBe(true);
  expect(host.querySelector('[data-pending-own-message]')?.textContent).toContain('Own submitted message');
  const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);
  if(savedBeforeAck){
   rows=[{node_id:'canonical-own',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'accepted',text:'Own submitted message',text_complete:true}],provenance:{sender:{kind:'human'}}}];f.db.history.t=rows;
   await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);});
  }
  await act(async()=>{f.t.ok(call.id,{message_id:'canonical-own',thread_id:'t'});await flush(8);});expect(f.model.sendState.peek().kind).toBe('idle');expect(composer.value).toBe('');
  if(savedBeforeAck){expect(host.querySelector('[data-pending-own-message]')).toBeNull();expect(host.querySelectorAll('[data-node="canonical-own"] .md')).toHaveLength(1);return;}
  expect(host.querySelector('[data-pending-phase="accepted"]')).not.toBeNull();
  await act(async()=>{composer.value='Next unsent draft';composer.dispatchEvent(new Event('input',{bubbles:true}));composer.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await flush(4);});
  expect(f.t.calls('message.send')).toHaveLength(1);expect(composer.value).toBe('Next unsent draft');
  expect(host.querySelector('.composer [role="status"]')?.textContent).toContain(f.model.t.value('composer.pending.accepted'));
  const equalText:HistoryItem={node_id:'wrong-node',kind:'user',items:[{item_identity:'wrong',kind:'text',text:'Own submitted message',text_complete:true}],provenance:{sender:{kind:'human'}}};
  rows=[{...equalText,selection:{ordinal:0}}];f.db.history.t=rows;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);});
  expect(host.querySelector('[data-pending-own-message]')).not.toBeNull();
  rows=[{...equalText,node_id:'canonical-own',selection:{ordinal:0}}];f.db.history.t=rows;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);});
  expect(host.querySelector('[data-pending-own-message]')).toBeNull();
  expect(host.querySelectorAll('[data-node="canonical-own"] .md')).toHaveLength(1);
  expect(host.querySelector<HTMLButtonElement>('.composer button:last-child')?.disabled).toBe(false);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('an old acknowledgement never clears a newer draft generation',async()=>{
 const host=document.createElement('div');document.body.append(host);let finish!:(ok:boolean)=>void;
 try{
  await act(async()=>render(<Composer label="Message" placeholder="" hint="" sendLabel="Send" canSend busy={false} onSend={()=>new Promise(resolve=>{finish=resolve;})}/>,host));
  const input=host.querySelector('textarea')!;
  await act(async()=>{input.value='Submitted original';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{host.querySelector('button')!.click();});
  await act(async()=>{input.value='New draft';input.dispatchEvent(new Event('input',{bubbles:true}));finish(true);await flush(4);});
  expect(input.value).toBe('New draft');
 }finally{render(null,host);host.remove();}
});
it('failed acceptance retries the original operation, while navigation invalidates a late ack',async()=>{
 const f=await fixtureModel();
 try{
  let sent=f.model.send('Original failed message');await flush(8);
  const first=f.t.calls('message.send').at(-1)!;
  f.t.ownerError(first.id,'temporary_failure');expect(await sent).toBe(false);
  const operation=f.model.pendingOwnMessage.peek()!.operationId;
  expect(f.model.pendingOwnMessage.peek()!.phase).toBe('failed');
  sent=f.model.resend();await flush(8);
  const second=f.t.calls('message.send').at(-1)!;
  expect(f.model.pendingOwnMessage.peek()!.operationId).toBe(operation);expect(second.args).toEqual(first.args);
  f.model.navigate({view:'threads'});await flush(8);
  f.t.ok(second.id,{message_id:'canonical-late',thread_id:f.model.pendingOwnMessage.peek()?.threadId??'lead'});
  expect(await sent).toBe(false);expect(f.model.pendingOwnMessage.peek()).toBeUndefined();
 }finally{f.model.dispose();f.data.stop();}
});
it('actual Composer Enter preserves an unconfirmed draft and does not double-submit a held request',async()=>{
 const host=document.createElement('div');document.body.append(host);let calls=0,finish!:(ok:boolean)=>void;
 const show=(canSend:boolean)=>render(<Composer label="Message" placeholder="" hint={canSend?'Ready':'Acceptance unconfirmed'} sendLabel="Send" canSend={canSend} busy={false} onSend={()=>{calls++;return new Promise(resolve=>{finish=resolve;});}}/>,host);
 try{
  await act(async()=>show(true));const input=host.querySelector('textarea')!;
  await act(async()=>{input.value='Original uncertain message';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  expect(calls).toBe(1);expect(input.value).toBe('Original uncertain message');
  await act(async()=>{show(false);finish(false);await flush(4);});
  await act(async()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  expect(calls).toBe(1);expect(input.value).toBe('Original uncertain message');expect(host.querySelector('[role="status"]')?.textContent).toBe('Acceptance unconfirmed');
 }finally{render(null,host);host.remove();}
});
