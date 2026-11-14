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
import {OrderedHistory} from '../screens/Conversation';
import {Composer} from '../system/components/Composer';

for(const savedBeforeAck of [false,true])it(`submitted message remains separate until exact acceptance and saved arrival: savedFirst=${savedBeforeAck}`,async()=>{
 let rows:HistoryItem[]=[];
 const f=await fixtureModel({capabilities:['history.window'],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];
  const base=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:{thread_id:'t',revision:1,total:rows.length,items:rows}}:base(call);
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
  expect(host.querySelector('[data-pending-own-message]')?.textContent).toContain('Own submitted message');
  expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(1);
  const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);
  if(savedBeforeAck){
   rows=[{node_id:'canonical-own',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'accepted',text:'Own submitted message',text_complete:true}],provenance:{sender:{kind:'human'}}}];f.db.history.t=rows;
   await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);});
  }
  await act(async()=>{f.t.ok(call.id,{message_id:'canonical-own',thread_id:'t'});await flush(8);});expect(f.model.sendState.peek().kind).toBe('idle');expect(composer.value).toBe('');
  expect(host.querySelector('[data-pending-phase="sending"]')).toBeNull();
  if(savedBeforeAck){expect(host.querySelector('[data-pending-own-message]')).toBeNull();expect(host.querySelectorAll('[data-node="canonical-own"] .md')).toHaveLength(1);return;}
  expect(host.querySelector('[data-pending-phase="accepted"]')).not.toBeNull();
  expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(1);
  const acceptedRow=host.querySelector('[data-pending-phase="accepted"]')!;
  expect(acceptedRow.querySelector('.who > small.mono')?.textContent).toBe(f.model.t.value('composer.pending.accepted'));
  expect(acceptedRow.querySelector('.msg > small')).toBeNull();
  expect(acceptedRow.querySelector('.who > small.mono')?.parentElement?.className).toBe('who');
  await act(async()=>{composer.value='Next unsent draft';composer.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(composer.value).toBe('Next unsent draft');
  await act(async()=>{composer.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await flush(4);});
  expect(f.t.calls('message.send')).toHaveLength(2);expect(composer.value).toBe('');
  expect(f.model.pendingOwnMessage.peek()).toMatchObject({text:'Next unsent draft',operationId:f.t.calls('message.send').at(-1)!.operation_id});
  await act(async()=>{composer.value='Third draft';composer.dispatchEvent(new Event('input',{bubbles:true}));});
  const next=f.t.calls('message.send').at(-1)!;f.db.answered.add(next.id);
  await act(async()=>{f.t.ok(next.id,{message_id:'second-canonical',thread_id:'t'});await flush(8);});
  expect(f.model.acceptedOwnMessages.peek()).toHaveLength(2);
  expect(composer.value).toBe('Third draft');
  const equalText:HistoryItem={node_id:'wrong-node',kind:'user',items:[{item_identity:'wrong',kind:'text',text:'Own submitted message',text_complete:true}],provenance:{sender:{kind:'human'}}};
  rows=[{...equalText,selection:{ordinal:0}}];f.db.history.t=rows;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);});
  expect(host.querySelector('[data-pending-own-message]')).not.toBeNull();
  rows=[{...equalText,node_id:'canonical-own',selection:{ordinal:0}}];f.db.history.t=rows;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);});
  expect([...host.querySelectorAll('[data-pending-own-message]')].map(row=>row.textContent)).toEqual([expect.stringContaining('Own submitted message'),expect.stringContaining('Next unsent draft')]);
  expect(host.querySelectorAll('[data-node="canonical-own"] .md')).toHaveLength(0);
  rows=[...rows,{...equalText,node_id:'second-canonical',selection:{ordinal:1},items:[{kind:'text',item_identity:'second',text:'Next unsent draft',text_complete:true}]}];f.db.history.t=rows;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);});
  expect(host.querySelector('[data-pending-own-message]')).toBeNull();
  expect(host.querySelectorAll('[data-node="canonical-own"] .md')).toHaveLength(1);
  expect(host.querySelectorAll('[data-node="second-canonical"] .md')).toHaveLength(1);
  await act(async()=>{composer.value='Third ready draft';composer.dispatchEvent(new Event('input',{bubbles:true}));});
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
it('reserves eight entries and UTF-8 bytes before dispatch without evicting acknowledged text',async()=>{
 const f=await fixtureModel();
 try{
  for(let i=0;i<8;i++){
   const sending=f.model.send(`Accepted ${i}`);await flush(4);const call=f.t.calls('message.send').at(-1)!;
   f.t.ok(call.id,{message_id:`saved-${i}`,thread_id:f.model.handle.peek()!.threadId});expect(await sending).toBe(true);
   expect(f.model.pendingOwnMessage.peek()).toBeUndefined();expect(f.model.acceptedOwnMessages.peek()).toHaveLength(i+1);
  }
  expect(await f.model.send('Ninth draft')).toBe(false);expect(f.t.calls('message.send')).toHaveLength(8);
  expect(f.model.ownSendCapacityReason.peek()).toBe(true);expect(f.model.acceptedOwnMessages.peek()[0]!.text).toBe('Accepted 0');
  f.model.navigate({view:'threads'});await flush(4);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(0);
 }finally{f.model.dispose();f.data.stop();}
 const g=await fixtureModel();
 try{
  expect(await g.model.send('界'.repeat(Math.floor(4*1024*1024/3)+1))).toBe(false);
  expect(g.t.calls('message.send')).toHaveLength(0);expect(g.model.ownSendCapacityReason.peek()).toBe(true);
 }finally{g.model.dispose();g.data.stop();}
});
it('rapid native input and Enter capture the current draft before a reactive render, then clear on same-generation ack',async()=>{
 const host=document.createElement('div');document.body.append(host);let finish!:(ok:boolean)=>void;const sent:string[]=[];
 const show=()=>render(<Composer label="Message" placeholder="" hint="" sendLabel="Send" canSend busy={false} onSend={text=>{sent.push(text);return new Promise(resolve=>{finish=resolve;});}}/>,host);
 try{
  await act(async()=>show());const input=host.querySelector('textarea')!;
  await act(async()=>{input.value='Rapid original';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  expect(sent).toEqual(['Rapid original']);
  await act(async()=>{show();finish(true);await flush(4);});expect(input.value).toBe('');
 }finally{render(null,host);host.remove();}
});
it('an unchanged native input notification does not become a new draft generation during acknowledgement',async()=>{
 const host=document.createElement('div');document.body.append(host);let finish!:(ok:boolean)=>void;
 try{
  await act(async()=>render(<Composer label="Message" placeholder="" hint="" sendLabel="Send" canSend busy={false} onSend={()=>new Promise(resolve=>{finish=resolve;})}/>,host));
  const input=host.querySelector('textarea')!;
  await act(async()=>{input.value='Original';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  await act(async()=>{input.dispatchEvent(new Event('input',{bubbles:true}));finish(true);await flush(4);});expect(input.value).toBe('');
 }finally{render(null,host);host.remove();}
});
it('real edits, even restored text, remain a different generation; composing Enter never submits',async()=>{
 const host=document.createElement('div');document.body.append(host);let finish!:(ok:boolean)=>void,calls=0;
 try{
  await act(async()=>render(<Composer label="Message" placeholder="" hint="" sendLabel="Send" canSend busy={false} onSend={()=>{calls++;return new Promise(resolve=>{finish=resolve;});}}/>,host));
  const input=host.querySelector('textarea')!;
  await act(async()=>{input.value='Original';input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));});expect(calls).toBe(0);
  await act(async()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  await act(async()=>{input.value='Different';input.dispatchEvent(new Event('input',{bubbles:true}));input.value='Original';input.dispatchEvent(new Event('input',{bubbles:true}));finish(true);await flush(4);});
  expect(input.value).toBe('Original');expect(calls).toBe(1);
 }finally{render(null,host);host.remove();}
});

for (const renderMode of ['app','ordered'] as const) it(`actual own cohort differential: ${renderMode}`,async()=>{
 const f=await fixtureModel({capabilities:['history.window'],configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];const base=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:{thread_id:'t',revision:2,total:db.history.t?.length??0,items:db.history.t??[]}}:base(call);}});
 const host=document.createElement('div');document.body.append(host);const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 const node=(id:string,text?:string,complete?:boolean):HistoryItem=>({node_id:id,kind:'user',selection:{ordinal:id==='a'?0:1},items:text===undefined?[]:[{kind:'text',item_identity:id,text,text_complete:complete??false}],provenance:{sender:{kind:'human'}}});
 const sendAndAck=async(text:string,id:string)=>{const area=host.querySelector<HTMLTextAreaElement>('textarea');if(renderMode==='app'){area!.value=text;area!.dispatchEvent(new Event('input',{bubbles:true}));area!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await flush();}else{const sent=f.model.send(text);await flush();expect(f.model.pendingOwnMessage.peek()?.text).toBe(text);void sent;}const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);await act(async()=>{f.t.ok(call.id,{message_id:id,thread_id:'t'});await flush(8);});};
 const paint=async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);await flush(12);};
 try{
  await act(async()=>{if(renderMode==='app')render(<App context={context}/>,host);else {await settle(f.t,f.db);const handle=f.model.handle.peek()!,win=f.model.longReader.peek()!;render(<OrderedHistory model={f.model} handle={handle} win={win} t={f.model.t.peek()}/>,host);}await settle(f.t,f.db);});
  await sendAndAck('Original A','a');await sendAndAck('Original B','b');
  expect(f.model.acceptedOwnMessages.peek().map(row=>row.messageId)).toEqual(['a','b']);expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(2);
  f.db.history.t=[node('a'),node('b','Saved B',true)];await act(paint);expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(2);expect(host.querySelectorAll('.msg')).toHaveLength(2);
  f.db.history.t=[node('a','Saved A',true),node('b','Saved B',true)];await act(paint);expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(0);expect(host.querySelectorAll('.msg')).toHaveLength(2);expect([...host.querySelectorAll('.md')].map(x=>x.textContent?.trim())).toEqual(['Saved A','Saved B']);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('actual committed local region rejects stale cohort retirement and retires once after the echo',async()=>{
 const f=await fixtureModel({route:'conversation',threadId:'lead',configure(db){db.history.lead=[];db.work.lead=[];}});
 try{
  const accept=async(text:string,id:string)=>{const sent=f.model.send(text);await flush();const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);f.t.ok(call.id,{message_id:id,thread_id:'lead'});expect(await sent).toBe(true);};
  await accept('A','a');
  const win=f.model.longReader.value!,old=win.acceptedView.peek();
  const initialLocal=old.displayPlan!.localRegion;
  expect(initialLocal.localRows.map(row=>row.messageId)).toEqual(['a']);
  expect(initialLocal.placement).toEqual({kind:'qualified',insertion:{kind:'beginning'}});
  expect(initialLocal.slots.map(slot=>({id:slot.row.messageId,position:slot.position}))).toEqual([{id:'a',position:{kind:'before-first'}}]);
  const node=(id:string,ordinal:number):HistoryItem=>({node_id:id,kind:'user',selection:{ordinal},items:[{kind:'text',item_identity:id,text:id,text_complete:true}],provenance:{sender:{kind:'human'}}});
  f.db.history.lead=[node('a',0)];let newer:Promise<boolean>|undefined,reentered=false;
  const stop=win.acceptedView.subscribe(ref=>{
   const local=ref.displayPlan!.localRegion;expect(win.acceptedView.isCurrent(ref)).toBe(true);
   expect(local.slots.every(slot=>local.localRows.some(row=>row.operationId===slot.row.operationId))).toBe(true);
   if(local.placement.kind==='qualified')expect(local.slots.map(slot=>slot.row.operationId)).toEqual(local.localRows.map(row=>row.operationId));
   if(!reentered&&local.retire.length){
    reentered=true;newer=f.model.send('B');
  }});
  win.changed();await flush();
  const read=f.t.calls('history.window').find(call=>!f.db.answered.has(call.id))!;expect(read).toBeDefined();
  const reply=f.db.answer(read);f.db.answered.add(read.id);if(reply.ok)f.t.ok(read.id,reply.result);else f.t.ownerError(read.id,reply.code);
  await flush(16);stop();expect(reentered).toBe(true);
  expect(f.model.acceptedOwnMessages.peek()).toHaveLength(1);expect(f.model.pendingOwnMessage.peek()?.text).toBe('B');
  const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);f.t.ok(call.id,{message_id:'b',thread_id:'lead'});expect(await newer).toBe(true);
  expect(win.refreshConversationInput(old)).toBe(false);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(2);
  const before=win.acceptedView.peek(),cohort=f.model.acceptedOwnMessages.peek();
  win.acceptedView.revoke();expect(win.refreshConversationInput(before)).toBe(false);
  expect(win.acceptedView.peek()).toBe(before);expect(f.model.acceptedOwnMessages.peek()).toBe(cohort);
  f.db.history.lead=[node('a',0),node('b',1)];win.changed();await settle(f.t,f.db);
  expect(f.model.acceptedOwnMessages.peek()).toHaveLength(0);
  const final=win.acceptedView.peek();expect(final.displayPlan?.localRegion.localRows).toHaveLength(0);
  expect(win.refreshConversationInput(final)).toBe(true);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(0);
 }finally{f.model.dispose();f.data.stop();}
});

for(const withPrefix of [false,true])for(const ids of [['2'],['2','3','4','5']])it(`actual four rapid ACKs precede new assistant while own saved bodies are unavailable: prefix=${withPrefix} count=${ids.length}`,async()=>{
 let revision=1;
 const f=await fixtureModel({capabilities:['history.window'],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=withPrefix?[{node_id:'prefix',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'prefix-a',text:'Existing prefix A',text_complete:true},{kind:'text',item_identity:'prefix-b',text:'Existing prefix B',text_complete:true}]}]:[];
  const base=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:{thread_id:'t',revision,total:db.history.t?.length??0,items:db.history.t??[]}}:base(call);
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const area=host.querySelector<HTMLTextAreaElement>('textarea')!;
  for(const id of ids){
   await act(async()=>{area.value=`Diagnostic own ${id}`;area.dispatchEvent(new Event('input',{bubbles:true}));area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await flush();});
   const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);
   await act(async()=>{f.t.ok(call.id,{message_id:`own-${id}`,thread_id:'t'});await flush();});
  }
  expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(ids.length);
  expect(f.model.acceptedOwnMessages.peek().map(row=>row.messageId)).toEqual(ids.map(id=>`own-${id}`));
  const prefix=withPrefix?f.db.history.t!:[];
  revision++;
  f.db.history.t=[...prefix,{node_id:'assistant-arrival',kind:'assistant_response',selection:{ordinal:withPrefix?1:0},items:[{kind:'text',item_identity:'response',text:'Diagnostic assistant receipt response',text_complete:true}]}];
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);await flush(12);});
  expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(ids.length);
  expect(f.model.acceptedOwnMessages.peek()).toHaveLength(ids.length);
  const actual=[...host.querySelectorAll('.msg')].map(row=>row.querySelector('.md')?.textContent?.trim());
  expect(actual).toEqual([...(withPrefix?['Existing prefix A','Existing prefix B']:[]),...ids.map(id=>`Diagnostic own ${id}`),'Diagnostic assistant receipt response']);
  const assistant=host.querySelector('[data-node="assistant-arrival"]');
  revision+=5;
  f.db.history.t=[...prefix,...ids.map((id,index)=>({node_id:`own-${id}`,kind:'user',selection:{ordinal:index+(withPrefix?1:0)},items:[{kind:'text' as const,item_identity:`body-${id}`,text:`Diagnostic own ${id}`,text_complete:true}]})),{node_id:'assistant-arrival',kind:'assistant_response',selection:{ordinal:ids.length+(withPrefix?1:0)},items:[{kind:'text',item_identity:'response',text:'Diagnostic assistant receipt response',text_complete:true}]}];
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);await flush(12);});
  expect([...host.querySelectorAll('.msg')].map(row=>row.querySelector('.md')?.textContent?.trim())).toEqual(actual);
  expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(0);
  expect(f.model.acceptedOwnMessages.peek()).toHaveLength(0);
  expect(host.querySelector('[data-node="assistant-arrival"]')).toBe(assistant);

 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('Composer clears the reserved original immediately while ACK is held and preserves the next draft',async()=>{
 const host=document.createElement('div');document.body.append(host);let finish!:(ok:boolean)=>void,reserve:(()=>void)|undefined,calls=0;
 try{
 await act(async()=>render(<Composer label="Message" placeholder="" hint="" sendLabel="Send" canSend busy={false} onSend={(_text,onReserved)=>{calls++;reserve=onReserved;onReserved?.();return new Promise(resolve=>{finish=resolve;});}}/>,host));
 const area=host.querySelector('textarea')!;
 await act(async()=>{area.value='Original';area.dispatchEvent(new Event('input',{bubbles:true}));area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
 expect(reserve).toBeTypeOf('function');await act(async()=>{reserve!();});expect(area.value).toBe('');
 await act(async()=>{area.value='New draft';area.dispatchEvent(new Event('input',{bubbles:true}));reserve!();area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));finish(true);await flush();});
 expect(area.value).toBe('New draft');expect(calls).toBe(1);
 }finally{render(null,host);host.remove();}
});
for(const outcome of [false,true])it(`Composer old reservation and ACK cannot erase another scope or edited generation accepted=${outcome}`,async()=>{
 const host=document.createElement('div');document.body.append(host);let finish!:(ok:boolean)=>void,reserve:(()=>void)|undefined;
 const props={label:'Message',placeholder:'',hint:'',sendLabel:'Send',canSend:true,busy:false};
 const onSend=(_text:string,onReserved?:()=>void)=>{reserve=onReserved;return new Promise<boolean>(resolve=>{finish=resolve;});};
 try{
 await act(async()=>render(<Composer {...props} draftScope="owner/thread/A" onSend={onSend}/>,host));const area=host.querySelector('textarea')!;
 await act(async()=>{area.value='Original';area.dispatchEvent(new Event('input',{bubbles:true}));area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
 expect(area.value).toBe('Original');
 await act(async()=>{render(<Composer {...props} draftScope="owner/thread/B" onSend={onSend}/>,host);});
 await act(async()=>{reserve!();finish(outcome);await flush();});expect(area.value).toBe('Original');
 }finally{render(null,host);host.remove();}
});
it('Composer failed reserved send preserves the next draft without automatic restoration',async()=>{
 const host=document.createElement('div');document.body.append(host);let finish!:(ok:boolean)=>void;
 try{
 await act(async()=>render(<Composer label="Message" placeholder="" hint="" sendLabel="Send" canSend busy={false} onSend={(_text,reserve)=>{reserve?.();return new Promise(resolve=>{finish=resolve;});}}/>,host));const area=host.querySelector('textarea')!;
 await act(async()=>{area.value='Owned original';area.dispatchEvent(new Event('input',{bubbles:true}));area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});expect(area.value).toBe('');
 await act(async()=>{area.value='Next';area.dispatchEvent(new Event('input',{bubbles:true}));finish(false);await flush();});expect(area.value).toBe('Next');
 }finally{render(null,host);host.remove();}
});
it('Composer scope round-trip does not make an old ACK own the current draft again',async()=>{
 const host=document.createElement('div');document.body.append(host);let finish!:(ok:boolean)=>void;
 const props={label:'Message',placeholder:'',hint:'',sendLabel:'Send',canSend:true,busy:false,onSend:()=>new Promise<boolean>(resolve=>{finish=resolve;})};
 try{
 await act(async()=>render(<Composer {...props} draftScope="A"/>,host));const area=host.querySelector('textarea')!;
 await act(async()=>{area.value='Original';area.dispatchEvent(new Event('input',{bubbles:true}));area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
 await act(async()=>render(<Composer {...props} draftScope="B"/>,host));await act(async()=>render(<Composer {...props} draftScope="A"/>,host));
 await act(async()=>{finish(true);await flush();});expect(area.value).toBe('Original');
 }finally{render(null,host);host.remove();}
});
it('keeps the next draft across held ACK and same-stack submit guard, then accepts it after ACK continuation',async()=>{
 const host=document.createElement('div');document.body.append(host);
 let calls=0,reservations=0,finish!:(ok:boolean)=>void;
 const observed:{stage:string;draft:string;calls:number;reservations:number}[]=[];
 const send=()=>{calls++;return new Promise<boolean>(resolve=>{finish=resolve;});};
 const show=()=>render(<Composer label="Draft" placeholder="" hint="Ready" sendLabel="Send" canSend busy={false} onSend={(_text,notify)=>{reservations++;notify?.();return send();}}/>,host);
 try{
  await act(async()=>show());const input=host.querySelector('textarea')!;
  const enter=()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await act(async()=>{input.value='First';input.dispatchEvent(new Event('input',{bubbles:true}));enter();});
  expect(calls).toBe(1);expect(input.value).toBe('');
  await act(async()=>{input.value='Next draft';input.dispatchEvent(new Event('input',{bubbles:true}));enter();
   observed.push({stage:'held-ack',draft:input.value,calls,reservations});
   finish(true);enter();observed.push({stage:'same-stack-after-resolve',draft:input.value,calls,reservations});await flush(4);
  });
  expect(observed).toEqual([{stage:'held-ack',draft:'Next draft',calls:1,reservations:1},{stage:'same-stack-after-resolve',draft:'Next draft',calls:1,reservations:1}]);
  expect(input.value).toBe('Next draft');
  await act(async()=>{enter();await flush(2);});expect(calls).toBe(2);expect(reservations).toBe(2);expect(input.value).toBe('');
  await act(async()=>{finish(true);await flush(4);});
 }finally{render(null,host);host.remove();}
});
it('recomputes local byte hint from the edited draft without reservation or clearing text',async()=>{
 const f=await fixtureModel(),host=document.createElement('div');document.body.append(host);
 const scope=f.model.ownMutationScope();
 f.model.acceptedOwnMessages.value=[{threadId:'lead',scope,operationId:'retained',text:'x'.repeat(4194301),phase:'accepted',plainMessageSend:true}];
 const show=()=>render(<Composer label="Draft" placeholder="" hint="Ready" sendLabel="Send" canSend busy={false} draftScope={scope} draftStatus={text=>{const reason=f.model.localSendAdmission(text);return {blocked:reason!=='ready',hint:reason};}} onSend={(text,notify)=>f.model.send(text,notify)}/>,host);
 try{
  await act(async()=>show());const input=host.querySelector('textarea')!;
  for(const [text,reason,blocked] of [['あx','bytesfull',true],['あ','ready',false],['xx','ready',false]] as const){
   await act(async()=>{input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));});
   expect(host.querySelector('[role="status"]')?.textContent).toBe(reason);expect(host.querySelector('button')!.disabled).toBe(blocked);expect(input.value).toBe(text);
  }
  expect(f.t.calls('message.send')).toHaveLength(0);expect(f.model.pendingOwnMessage.peek()).toBeUndefined();
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('a locally denied draft fires no reservation notification and preserves original operation retry identity',async()=>{
 const f=await fixtureModel();
 try{
  let notified=0;expect(await f.model.send('あ'.repeat(1398102),()=>{notified++;})).toBe(false);
  expect(notified).toBe(0);expect(f.t.calls('message.send')).toHaveLength(0);expect(f.model.localSendAdmission('small edited draft')).toBe('ready');
  const sent=f.model.send('Original retry text');await flush(8);const first=f.t.calls('message.send').at(-1)!;
  f.t.ownerError(first.id,'temporary_failure');expect(await sent).toBe(false);expect(f.model.canResend()).toBe(true);
  const original=f.model.pendingOwnMessage.peek()!;const before=f.t.calls('message.send').length;
  for(let n=0;n<3;n++)expect(f.model.canResend()).toBe(true);expect(f.t.calls('message.send')).toHaveLength(before);expect(f.model.pendingOwnMessage.peek()).toBe(original);
  const retried=f.model.resend();await flush(8);const second=f.t.calls('message.send').at(-1)!;
  expect(second.operation_id).toBe(first.operation_id);expect(second.args).toEqual(first.args);expect(notified).toBe(0);
  f.t.ownerError(second.id,'temporary_failure');await retried;
  f.model.navigate({view:'threads'});await flush(8);expect(f.model.canResend()).toBe(false);
  expect(await f.model.resend()).toBe(false);expect(f.t.calls('message.send')).toHaveLength(before+1);
 }finally{f.model.dispose();f.data.stop();}
});
it('retry display eligibility rejects owner ABA and route ABA without dispatch side effects',async()=>{
 for(const mode of ['owner','route'] as const){
  const f=await fixtureModel();
  try{
   const sent=f.model.send('Protected original');await flush(8);const call=f.t.calls('message.send').at(-1)!;
   f.t.ownerError(call.id,'temporary_failure');await sent;const original=f.model.pendingOwnMessage.peek()!;
   expect(f.model.canResend(original)).toBe(true);
   const owner=f.data.owner.peek();
   if(mode==='owner'&&owner.state==='connected'){
    f.t.push({t:'owner',event:'connected',owner:{...owner,info:{...owner.info,instance_id:'different-owner'}}});await flush(8);
    f.t.push({t:'owner',event:'connected',owner});await flush(8);
   }else {f.model.navigate({view:'threads'});await flush(8);f.model.navigate({view:'conversation',threadId:'lead'});await flush(8);}
   const count=f.t.calls('message.send').length;
   expect(f.model.canResend(original)).toBe(false);expect(await f.model.resend(original)).toBe(false);expect(f.t.calls('message.send')).toHaveLength(count);
  }finally{f.model.dispose();f.data.stop();}
 }
});
