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

for(const windowed of [true,false])it(`actual own cohort has no metadata/partial/stale gap and swaps A/B together: window=${windowed}`,async()=>{
 const f=await fixtureModel({capabilities:windowed?['history.window']:[],configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];const base=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:{thread_id:'t',revision:2,total:db.history.t?.length??0,items:db.history.t??[]}}:base(call);}});
 const host=document.createElement('div');document.body.append(host);const frames:string[][]=[];
 const ids=()=>[...host.querySelectorAll('.msg:not(.assistant)')].map(row=>row.textContent??'');
 const frame=(expected:string[])=>{const actual=ids();frames.push(actual);expect(actual).toHaveLength(expected.length);expected.forEach((text,index)=>expect(actual[index]).toContain(text));};
 const node=(id:string,text?:string,complete?:boolean):HistoryItem=>({node_id:id,kind:'user',selection:{ordinal:id==='a'?0:1},items:text===undefined?[]:[{kind:'text',item_identity:id,text,text_complete:complete??false}]});
 try{
  await act(async()=>{render(<App context={{model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false}}/>,host);await settle(f.t,f.db);});
  const area=host.querySelector<HTMLTextAreaElement>('textarea')!;
  for(const [id,text] of [['a','Original A'],['b','Original B']]){
   await act(async()=>{area.value=text!;area.dispatchEvent(new Event('input',{bubbles:true}));area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await flush();});
   const send=f.t.calls('message.send').at(-1)!;f.db.answered.add(send.id);
   await act(async()=>{f.t.ok(send.id,{message_id:id,thread_id:'t'});await flush();});
  }
  frame(['Original A','Original B']);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(2);
  let installed=0;
  const commit=f.model.installOwnPresentation.bind(f.model);
  f.model.installOwnPresentation=(decision,current)=>{
   if(decision.retire.length){
    frame(['Saved A','Saved B']);const before=f.model.acceptedOwnMessages.peek();
    commit(decision,()=>false);expect(f.model.acceptedOwnMessages.peek()).toBe(before);
    commit(decision,current);frame(['Saved A','Saved B']);
    const after=f.model.acceptedOwnMessages.peek();commit(decision,current);expect(f.model.acceptedOwnMessages.peek()).toBe(after);installed++;
   }else commit(decision,current);
  };
  const publish=async(nodes:HistoryItem[])=>{f.db.history.t=nodes;await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);await flush(12);});};
  await publish([node('a'),node('b','Saved B',true)]);frame(['Original A','Original B']);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(2);
  await publish([node('a','Partial A',false),node('b','Saved B',true)]);frame(['Original A','Original B']);
  const original=f.db.answer.bind(f.db),sendFrame=f.t.send.bind(f.t);
  f.t.send=message=>{const ok=sendFrame(message);if(message.t==='call'&&(message.command==='history.window'||message.command==='history.list'))f.db.answered.add(message.id);return ok;};
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await flush(12);});frame(['Original A','Original B']);
  f.t.send=sendFrame;f.db.answer=original;
  // Complete the held public read using the same request, not a new private read.
  const held=f.t.calls(windowed?'history.window':'history.list').at(-1)!;
  await act(async()=>{f.t.ok(held.id,windowed?{thread_id:'t',revision:2,total:2,items:[node('a','Saved A',true),node('b','Saved B',true)]}:{items:[node('a','Saved A',true),node('b','Saved B',true)]});await flush(24);});
  frame(['Saved A','Saved B']);expect(installed).toBe(1);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(0);expect(host.querySelector('[data-pending-own-message]')).toBeNull();
  expect(frames.every(rows=>rows.length===2)).toBe(true);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('actual model installed receipt rejects cohort changes during qualification and retires once atomically',async()=>{
 const f=await fixtureModel({configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[];}});
 try{
  const accept=async(text:string,id:string)=>{const sent=f.model.send(text);await flush();const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);f.t.ok(call.id,{message_id:id,thread_id:'t'});expect(await sent).toBe(true);};
  await accept('A','a');
  const {ownSendPresentation}=await import('../../../ui-core/src/own-send-presentation');
  const {projectSavedItems}=await import('../../../ui-core/src/conversation-items');
  const make=()=>ownSendPresentation({canonicalRows:f.model.acceptedOwnMessages.peek().map(row=>({node_id:row.messageId!,kind:'user',items:[{kind:'text' as const,item_identity:row.messageId!,text:row.text,text_complete:true}]})),reservation:{token:{},observation:{installedToken:{},ref:{},scope:f.model.ownMutationScope(),boundary:{kind:"beginning"},isCurrent:()=>true}},ref:{},current:true,scope:f.model.ownMutationScope(),localRows:f.model.ownMutationRows(f.model.ownMutationScope()),cohortVersion:{accepted:f.model.acceptedOwnMessages.peek(),pending:f.model.pendingOwnMessage.peek()},projection:projectSavedItems(f.model.acceptedOwnMessages.peek().map(row=>({windowRevision:1,nodeId:row.messageId!,itemIdentity:row.messageId!,kind:'user',text:row.text,textComplete:true}))),hiddenItemKeys:new Set<string>()});
  const old=make();let newer:Promise<boolean>|undefined;
  f.model.installOwnPresentation(old,()=>{newer=f.model.send('B');return true;});
  expect(f.model.acceptedOwnMessages.peek()).toHaveLength(1);expect(f.model.pendingOwnMessage.peek()?.text).toBe('B');
  await flush();const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);f.t.ok(call.id,{message_id:'b',thread_id:'t'});expect(await newer).toBe(true);
  f.model.installOwnPresentation(old,()=>true);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(2);
  const ready=make(),before=f.model.acceptedOwnMessages.peek();
  f.model.installOwnPresentation(ready,()=>false);expect(f.model.acceptedOwnMessages.peek()).toBe(before);
  f.model.installOwnPresentation(ready,()=>true);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(0);
  const empty=f.model.acceptedOwnMessages.peek();f.model.installOwnPresentation(ready,()=>true);expect(f.model.acceptedOwnMessages.peek()).toBe(empty);
 }finally{f.model.dispose();f.data.stop();}
});
for(const windowed of [true,false])for(const withPrefix of [false,true])for(const ids of [['2'],['2','3','4','5']])it(`actual four rapid ACKs precede new assistant while own saved bodies are unavailable: window=${windowed} prefix=${withPrefix} count=${ids.length}`,async()=>{
 let revision=1;
 const f=await fixtureModel({capabilities:windowed?['history.window']:[],configure(db){
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
  // Public history.list is excerpt-only: it cannot prove submitted text replacement.
  if(!windowed)f.db.history.t=(f.db.history.t as HistoryItem[]).map(node=>({...node,items:undefined,text:node.items?.[0]?.kind==='text'?node.items[0].text:undefined}));
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);await flush(12);});
  if(windowed)expect([...host.querySelectorAll('.msg')].map(row=>row.querySelector('.md')?.textContent?.trim())).toEqual(actual);
  else expect([...host.querySelectorAll('[data-pending-own-message] .md')].map(row=>row.textContent?.trim())).toEqual([...ids.map(id=>`Diagnostic own ${id}`)]);
  expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(windowed?0:ids.length);
  expect(f.model.acceptedOwnMessages.peek()).toHaveLength(windowed?0:ids.length);
  if(windowed)expect(host.querySelector('[data-node="assistant-arrival"]')).toBe(assistant);

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
