// @vitest-environment happy-dom
import '@preact/signals';
import {signal} from '@preact/signals-core';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import {fixtureModel} from '../../../ui-core/test/fixture';
import {summary,details,settle,flush, type FakeTransport, type FakeOwnerDb} from '../../../data/test/harness';
import type {HistoryItem} from '../../../data/src/protocol';
import type {DesignContext} from '../../../ui-core/src';
import {loadPrefs} from '../../../ui-core/src/prefs';
import {App} from '../screens/App';
import {OrderedHistory} from '../screens/Conversation';
import {Composer} from '../system/components/Composer';
import {canonicalAttemptId} from '../../../data/test/work-fixture';

type HistoryGetCall = { args?: unknown };
function requestedHistoryNode(call: HistoryGetCall): string {
 const args=call.args;
 if (args===null || typeof args!=="object" || !("node_id" in args) || typeof args.node_id!=="string") throw new Error("history.get missing string node_id");
 return args.node_id;
}

async function answerMountedAncillary(f: { t: FakeTransport; db: FakeOwnerDb }): Promise<void> {
 for (let pass = 0; pass < 4; pass++) {
  const pending = f.t.calls().filter(call => call.command !== "history.get" && !f.db.answered.has(call.id) && !f.t.cancels().includes(call.id));
  if (!pending.length) break;
  for (const call of pending) {
   f.db.answered.add(call.id); const result = f.db.answer(call);
   if (result.ok) f.t.ok(call.id, result.result); else f.t.ownerError(call.id, result.code, result.message ?? result.code, result.details);
  }
  await flush(2);
 }
}
function installMountedWindowResponder(f: { t: FakeTransport; db: FakeOwnerDb }): () => void {
 const previous = f.t.onCall; let alive = true; let replies = 0;
 f.t.onCall = call => { previous?.(call); if (!alive || replies >= 4 || call.command !== "history.window" || f.db.answered.has(call.id) || f.t.cancels().includes(call.id)) return;
  queueMicrotask(() => { if (!alive || replies >= 4 || f.db.answered.has(call.id) || f.t.cancels().includes(call.id)) return; replies++; f.db.answered.add(call.id); const result = f.db.answer(call); if (result.ok) f.t.ok(call.id, result.result); else f.t.ownerError(call.id, result.code, result.message ?? result.code, result.details); });
 };
 return () => { alive = false; f.t.onCall = previous; };
}

async function bodyReadControlCase(partial: boolean) {
 let rows: HistoryItem[] = [{ node_id: "savedassistant", kind: "assistant_response", selection: { ordinal: 0 },
  ...(partial ? { items: [{ kind: "text" as const, item_identity: "answer", text: "typed prefix", text_complete: false }] } : { items: null, items_unavailable_reason: "response_budget" as const }),
  excerpt: "typed prefix" }, partial ? { node_id: "newer-assistant", kind: "assistant_response", selection: { ordinal: 1 }, items: [{ kind: "text", item_identity: "newer", text: "newer complete", text_complete: true }] } : { node_id: "newer-deferred", kind: "assistant_response", selection: { ordinal: 1 }, items: null, items_unavailable_reason: "response_budget" as const, excerpt: "newer deferred" }];
 const f = await fixtureModel({capabilities: ["history.window"], route: "conversation", threadId: "t", configure(db) {
  db.threads = { t: summary("t") }; db.details.t = details("t"); db.history.t = rows;
  const base = db.answer.bind(db);
  db.answer = call => call.command === "history.get"
   ? { ok: true, result: { node_id: requestedHistoryNode(call), kind: "assistant_response", text: requestedHistoryNode(call)==="savedassistant" ? (partial ? "older full" : "older deferred full") : "newer automatic full", provenance: { sender: { kind: "assistant" } } } }
   : call.command === "history.window" ? { ok: true, result: { thread_id: "t", revision: 1, total: rows.length, items: rows } } : base(call);
 }});
 const host = document.createElement("div"); document.body.append(host);
 const context: DesignContext = { model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), setPrefs: () => {}, designs: [], submitToken: async () => false };
 try {
  await act(async () => { render(<App context={context} />, host); await settle(f.t, f.db); });
  const automatic = f.t.calls("history.get").map(call => requestedHistoryNode(call));
  expect(automatic).toEqual([]);
  const olderRow = host.querySelector('[data-node="savedassistant"]');
  expect(olderRow).toBeDefined();
  const button = [...olderRow!.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.includes(f.model.t.value("convo.fullMessage")));
  expect(button).toBeDefined();
  const beforeClick = f.t.calls("history.get").length;
  await act(async () => { button!.click(); await settle(f.t, f.db); });
  const fresh = f.t.calls("history.get").slice(beforeClick);
  expect(fresh).toHaveLength(1);
  expect(requestedHistoryNode(fresh[0]!)).toBe("savedassistant");
  expect(olderRow!.querySelector(".message-markdown")?.textContent).toContain(partial ? "older full" : "older deferred full");
 } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
}


it("auto-loads one authoritative body for ordered prose leaves", async () => {
 const rows: HistoryItem[] = [{ node_id: "two-prose", kind: "assistant_response", selection: { ordinal: 0 }, items: [
  { kind: "text", item_identity: "first", text: "FIRST FULL", text_complete: true },
  { kind: "text", item_identity: "second", text: "second provisional", text_complete: false }
 ]}];
 const f=await fixtureModel({capabilities:["history.window"],route:"conversation",threadId:"t",configure(db){
  db.threads={t:summary("t")};db.details.t=details("t");db.history.t=rows;
  const base=db.answer.bind(db);db.answer=call=>call.command==='history.get'
   ? {ok:true,result:{node_id:requestedHistoryNode(call),kind:'assistant_response',text:'FIRST FULL\nSECOND FULL',provenance:{sender:{kind:'assistant'}}}}
   : call.command==='history.window'?{ok:true,result:{thread_id:'t',revision:1,total:1,items:rows}}:base(call);
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const reads=f.t.calls('history.get');expect(reads).toHaveLength(1);expect(requestedHistoryNode(reads[0]!)).toBe('two-prose');
  const bodies=[...host.querySelectorAll('[data-node="two-prose"] .message-markdown')].map(node=>node.textContent?.trim());
  expect(bodies).toEqual(['FIRST FULL\nSECOND FULL']);
  expect(bodies.filter(text=>text?.includes('FIRST FULL'))).toHaveLength(1);
  expect(bodies.filter(text=>text?.includes('SECOND FULL'))).toHaveLength(1);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it("shows mixed partial prose as unavailable without a dead body action", async () => {
 const rows: HistoryItem[] = [{ node_id: "mixed-render", kind: "assistant_response", selection: { ordinal: 0 }, items: [
  { kind: "text", item_identity: "prose", text: "provisional prose", text_complete: false },
  { kind: "reasoning_unavailable", item_identity: "reasoning" }
 ]}];
 const f=await fixtureModel({capabilities:["history.window"],route:"conversation",threadId:"t",configure(db){
  db.threads={t:summary("t")};db.details.t=details("t");db.history.t=rows;
  const base=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:{thread_id:'t',revision:1,total:1,items:rows}}:base(call);
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const row=host.querySelector('[data-node="mixed-render"]');expect(row).toBeDefined();expect(row!.textContent).toContain('provisional prose');expect(row!.querySelector('[data-body-unavailable]')).not.toBeNull();expect(row!.querySelector('button')).toBeNull();
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

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
  if(savedBeforeAck){expect(host.querySelector('[data-pending-own-message]')).toBeNull();expect(host.querySelectorAll('[data-node="canonical-own"] .message-markdown')).toHaveLength(1);return;}
  expect(host.querySelector('[data-pending-phase="accepted"]')).not.toBeNull();
  expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(1);
  const acceptedRow=host.querySelector('[data-pending-phase="accepted"]')!;
  expect(acceptedRow.querySelector('.message-sender > small.mono')?.textContent).toBe(f.model.t.value('composer.pending.accepted'));
  expect(acceptedRow.querySelector('.msg > small')).toBeNull();
  expect(acceptedRow.querySelector('.message-sender > small.mono')?.parentElement?.className).toBe('message-sender');
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
  expect([...host.querySelectorAll('[data-pending-own-message]')].map(row=>row.textContent)).toEqual([expect.stringContaining('Next unsent draft')]);
  expect(host.querySelectorAll('[data-node="canonical-own"] .message-markdown')).toHaveLength(1);
  rows=[...rows,{...equalText,node_id:'second-canonical',selection:{ordinal:1},items:[{kind:'text',item_identity:'second',text:'Next unsent draft',text_complete:true}]}];f.db.history.t=rows;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);});
  expect(host.querySelector('[data-pending-own-message]')).toBeNull();
  expect(host.querySelectorAll('[data-node="canonical-own"] .message-markdown')).toHaveLength(1);
  expect(host.querySelectorAll('[data-node="second-canonical"] .message-markdown')).toHaveLength(1);
  await act(async()=>{composer.value='Third ready draft';composer.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.querySelector<HTMLButtonElement>('.composer-root button:last-child')?.disabled).toBe(false);
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
  f.db.history.t=[node('a'),node('b','Saved B',true)];await act(paint);expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(1);expect(host.querySelectorAll('.msg')).toHaveLength(2);
  f.db.history.t=[node('a','Saved A',true),node('b','Saved B',true)];await act(paint);expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(0);expect(host.querySelectorAll('.msg')).toHaveLength(2);expect([...host.querySelectorAll('.message-markdown')].map(x=>x.textContent?.trim())).toEqual(['Saved A','Saved B']);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
it('actual committed local region rejects stale cohort retirement and retires once after the echo',async()=>{
 const f=await fixtureModel({route:'conversation',threadId:'lead',configure(db){db.history.lead=[];db.work.lead=[];}});
 try{
  const accept=async(text:string,id:string)=>{const sent=f.model.send(text);await flush();const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);f.t.ok(call.id,{message_id:id,thread_id:'lead'});expect(await sent).toBe(true);};
  await accept('A','a');
  const win=f.model.longReader.value!,old=win.acceptedView.peek();
  const node=(id:string,ordinal:number):HistoryItem=>({node_id:id,kind:'user',selection:{ordinal},items:[{kind:'text',item_identity:id,text:id,text_complete:true}],provenance:{sender:{kind:'human'}}});
  f.db.history.lead=[node('a',0)];let newer:Promise<boolean>|undefined,reentered=false;
  const stop=win.acceptedView.subscribe(ref=>{
   expect(win.acceptedView.isCurrent(ref)).toBe(true);
   if(!reentered&&ref.displayPlan!.localRegion.retire.length){
    reentered=true;newer=f.model.send('B');
  }});
  win.changed();await flush();
  const read=f.t.calls('history.window').find(call=>!f.db.answered.has(call.id))!;expect(read).toBeDefined();
  const reply=f.db.answer(read);f.db.answered.add(read.id);if(reply.ok)f.t.ok(read.id,reply.result);else f.t.ownerError(read.id,reply.code);
  await flush(16);stop();expect(reentered).toBe(true);
  expect(f.model.acceptedOwnMessages.peek()).toHaveLength(0);expect(f.model.pendingOwnMessage.peek()?.text).toBe('B');
  const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);f.t.ok(call.id,{message_id:'b',thread_id:'lead'});expect(await newer).toBe(true);
  expect(win.refreshConversationInput(old)).toBe(false);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(1);
  const before=win.acceptedView.peek(),cohort=f.model.acceptedOwnMessages.peek();
  win.acceptedView.revoke();expect(win.refreshConversationInput(before)).toBe(false);
  expect(win.acceptedView.peek()).toBe(before);expect(f.model.acceptedOwnMessages.peek()).toBe(cohort);
  f.db.history.lead=[node('a',0),node('b',1)];win.changed();await settle(f.t,f.db);
  expect(f.model.acceptedOwnMessages.peek()).toHaveLength(0);
  const final=win.acceptedView.peek();expect(final.displayPlan?.localRegion.localRows).toHaveLength(0);
  expect(win.refreshConversationInput(final)).toBe(true);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(0);
 }finally{f.model.dispose();f.data.stop();}
});

for(const withPrefix of [false,true])for(const ids of [['2'],['2','3','4','5']])it(`unrelated assistant stays canonical before own local suffix: prefix=${withPrefix} count=${ids.length}`,async()=>{
 let revision=1;
 const prefixRows=withPrefix?[{node_id:'prefix',kind:'user' as const,selection:{ordinal:0},items:[{kind:'text' as const,item_identity:'prefix-a',text:'Existing prefix A',text_complete:true},{kind:'text' as const,item_identity:'prefix-b',text:'Existing prefix B',text_complete:true}]}]:[];
 const f=await fixtureModel({capabilities:['history.window'],configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=prefixRows;const base=db.answer.bind(db);db.answer=call=>call.command==='history.window'?{ok:true,result:{thread_id:'t',revision,total:db.history.t?.length??0,items:db.history.t??[]}}:base(call);}});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const area=host.querySelector<HTMLTextAreaElement>('textarea')!;
  for(const id of ids){await act(async()=>{area.value=`Diagnostic own ${id}`;area.dispatchEvent(new Event('input',{bubbles:true}));area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await flush();});const call=f.t.calls('message.send').at(-1)!;f.db.answered.add(call.id);await act(async()=>{f.t.ok(call.id,{message_id:`own-${id}`,thread_id:'t'});await flush();});}
  const assistantRow={node_id:'assistant-arrival',kind:'assistant_response' as const,selection:{ordinal:prefixRows.length},items:[{kind:'text' as const,item_identity:'response',text:'Diagnostic assistant receipt response',text_complete:true}]};
  const prefixTexts=prefixRows.flatMap(row=>row.items?.flatMap(item=>item.kind==='text'?[item.text]:[])??[]);
  const ownTexts=ids.map(id=>`Diagnostic own ${id}`),expectedBefore=[...prefixTexts,'Diagnostic assistant receipt response',...ownTexts];
  f.db.history.t=[...prefixRows,assistantRow];revision++;await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);await flush(12);});
  expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(ids.length);expect([...host.querySelectorAll('.msg')].map(row=>row.querySelector('.message-markdown')?.textContent?.trim())).toEqual(expectedBefore);const assistant=host.querySelector('[data-node="assistant-arrival"]');
  const savedOwnRows=ids.map((id,index)=>({node_id:`own-${id}`,kind:'user' as const,selection:{ordinal:prefixRows.length+1+index},items:[{kind:'text' as const,item_identity:`body-${id}`,text:`Diagnostic own ${id}`,text_complete:true}]}));
  f.db.history.t=[...prefixRows,assistantRow,...savedOwnRows];revision+=5;await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);await flush(12);});
  expect([...host.querySelectorAll('.msg')].map(row=>row.querySelector('.message-markdown')?.textContent?.trim())).toEqual(expectedBefore);expect(host.querySelectorAll('[data-pending-own-message]')).toHaveLength(0);expect(f.model.acceptedOwnMessages.peek()).toHaveLength(0);expect(host.querySelector('[data-node="assistant-arrival"]')).toBe(assistant);
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

it("deferred response_budget body button reads typed history and renders full visible", async () => {
 await bodyReadControlCase(false);
});

it("partial response_budget body button reads typed history and renders full visible", async () => {
 await bodyReadControlCase(true);
});

it('accepted live preview retires after saved >16KiB body loads through the ordinary button',async()=>{
 const excerpt='E'.repeat(16000),full=`${excerpt}${'X'.repeat(1024)}FULL_BODY`;
 expect(new TextEncoder().encode(full).byteLength).toBeGreaterThan(16 * 1024);
 let rows:HistoryItem[]=[];const attempt=canonicalAttemptId(1);
 const f=await fixtureModel({capabilities:['history.window'],route:'conversation',threadId:'t',configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=rows;const base=db.answer.bind(db);db.answer=call=>{if(call.command==='history.get')return {ok:true,result:{node_id:'saved-assistant',kind:'assistant_response',text:full,provenance:{sender:{kind:'assistant'},attempt_id:attempt}}};return call.command==='history.window'?{ok:true,result:{thread_id:'t',revision:1,total:rows.length,items:rows}}:base(call)}}});
 const host=document.createElement('div');document.body.append(host);const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const handle=f.model.handle.peek()!,accepted=f.model.longReader.peek()!.acceptedView;
  type Tuple={source:'accepted'|'live';generation:number;live:number;canonical:boolean};
  const tuples:Tuple[]=[];let collecting=false;
  const record=(tuple:Tuple)=>{if(collecting)tuples.push(tuple);};
  const stopAccepted=accepted.subscribe(ref=>record({source:'accepted',generation:ref.generation,live:handle.handoff.value.length,canonical:ref.rows.some(row=>row.node_id==='saved-assistant')}));
  const stopLive=handle.handoff.subscribe(records=>record({source:'live',generation:accepted.peek().generation,live:records.length,canonical:accepted.peek().rows.some(row=>row.node_id==='saved-assistant')}));
  f.t.push({t:'live',thread_id:'t',attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:'live preview'}]});await flush(8);
  expect(host.textContent).toContain('live preview');expect(handle.handoff.value.some(record=>record.attemptId===attempt)).toBe(true);
  tuples.length=0;collecting=true;
  rows=[{node_id:'saved-assistant',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'text',item_identity:'answer',text:excerpt,text_complete:false}],provenance:{sender:{kind:'assistant'},attempt_id:attempt}},{node_id:'newer-complete',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'newer',text:'newer complete',text_complete:true}],provenance:{sender:{kind:'assistant'}}}];f.db.history.t=rows;
  await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);});
  expect(handle.handoff.value.some(record=>record.attemptId===attempt)).toBe(false);expect(tuples.length).toBeGreaterThan(1);
  const committedRef=f.model.longReader.peek()!.acceptedView.peek(),planSources=committedRef.displayPlan!.entries.map(entry=>entry.item.source);
  expect(committedRef.rows.some(row=>row.node_id==='saved-assistant'&&row.kind==='assistant_response'&&row.provenance?.attempt_id===attempt)).toBe(true);
  expect(planSources.filter(source=>"domain" in source&&source.domain==='live'&&source.attemptId===attempt)).toHaveLength(0);
  expect(f.model.handle.peek()!.handoff.value).toHaveLength(0);
  const states=tuples.map(({source,canonical,live})=>({source,canonical,live}));
  const invalid=states.filter(tuple=>!(tuple.canonical===false&&tuple.live===1 || tuple.canonical===true&&tuple.live===0));
  if(invalid.length)throw new Error(`Invalid accepted/live transition tuples: ${JSON.stringify(states)}`);
  expect(states.some(tuple=>tuple.canonical===false&&tuple.live===1)).toBe(true);
  expect(states.some(tuple=>tuple.canonical===true&&tuple.live===0)).toBe(true);
  let acceptedSeen=false;for(const tuple of states){if(tuple.canonical)acceptedSeen=true;if(acceptedSeen)expect(tuple.canonical).toBe(true);}
  expect(states.at(-1)).toMatchObject({canonical:true,live:0});
  expect(new Set(states.map(tuple=>tuple.source))).toEqual(new Set(['accepted','live']));
  const automatic=f.t.calls('history.get').map(call=>requestedHistoryNode(call));
  expect(automatic).not.toContain('saved-assistant');
  const olderRow=host.querySelector('[data-node="saved-assistant"]');
  expect(olderRow).toBeDefined();
  const button=[...olderRow!.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.includes(f.model.t.value('convo.fullMessage')));expect(button).toBeDefined();
  const beforeClick=f.t.calls('history.get').length;
  await act(async()=>{(button as HTMLButtonElement).click();await settle(f.t,f.db)});
  const fresh=f.t.calls('history.get').slice(beforeClick);
  expect(fresh).toHaveLength(1);expect(requestedHistoryNode(fresh[0]!)).toBe('saved-assistant');
  expect(olderRow!.querySelector('.message-markdown')?.textContent).toContain('FULL_BODY');
  expect(tuples.length).toBeGreaterThan(1);stopAccepted();stopLive();
 }finally{render(null,host);host.remove();f.data.stop()}
});

it("auto-loads only the newest typed prose body once", async () => {
  let rows: HistoryItem[] = [{ node_id: "new", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "text", item_identity: "first", text: "Newest first", text_complete: true }, { kind: "text", item_identity: "second", text: "Newest partial", text_complete: false }] }];
  const f = await fixtureModel({ capabilities: ["history.window"], route: "conversation", threadId: "t", configure(db) { db.threads = { t: summary("t") }; db.details.t = details("t"); db.history.t = rows; const base = db.answer.bind(db); db.answer = call => call.command === "history.get" ? { ok: true, result: { node_id: "new", kind: "assistant_response", text: "Newest first\nNewest full", provenance: { sender: { kind: "assistant" } } } } : call.command === "history.window" ? { ok: true, result: { thread_id: "t", revision: 1, total: rows.length, items: rows } } : base(call); } });
  const host = document.createElement("div"); document.body.append(host);
  try { await act(async () => { render(<App context={{ model: f.model, prefs: signal(loadPrefs({ read: () => null, write: () => {} }, [{ name: "console", themes: [{ name: "light" }] }])), designs: [], setPrefs() {}, submitToken: async () => false }} />, host); await settle(f.t, f.db); await flush(8); }); expect(f.t.calls("history.get").map(call => requestedHistoryNode(call))).toEqual(["new"]); const autoId=f.t.calls("history.get")[0]!.id; expect(host.textContent).toContain("Newest full"); f.t.push({t:"changed",thread_ids:["t"],list:false}); await settle(f.t,f.db); expect(f.t.calls("history.get")).toHaveLength(1); expect(f.t.calls("history.get")[0]!.id).toBe(autoId); } finally { render(null, host); host.remove(); f.model.dispose(); f.data.stop(); }
});

it("mounted stale auto body refuses an old cursor after rev2/rev3 windows", async () => {
 const f=await fixtureModel({capabilities:["history.window"],route:"threads",threadId:"t",configure(db){db.threads={t:summary("t")};db.details.t=details("t");db.history.t=[];db.historyRevisions.t=1;}});
 const readWindowCalls:unknown[]=[];let restoreReadWindow:(()=>void)|undefined;let restoreResponder:(()=>void)|undefined;let capturedHandle:ReturnType<typeof f.model.handle.peek>=undefined,capturedReader:ReturnType<typeof f.model.longReader.peek>=undefined,capturedKey:string|undefined;
 const host=document.createElement('div');document.body.append(host);const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 const old:HistoryItem={node_id:'old-tail',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'text',item_identity:'answer',text:'old prefix',text_complete:false}]};
 const newer:HistoryItem={node_id:'new-tail',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'answer',text:'new complete',text_complete:true}]};
 const windowTrace:{phase:string;emitted:number[];pending:number[];answered:number[];canceled:number[];revision:number|undefined;readWindow:number;handleSame:boolean;readerSame:boolean;keySame:boolean}[]=[];const traceWindows=(phase:string)=>{const emitted=f.t.calls('history.window').map(call=>call.id),canceled=f.t.cancels();return windowTrace.push({phase,emitted,pending:f.t.calls('history.window').filter(call=>!f.db.answered.has(call.id)&&!canceled.includes(call.id)).map(call=>call.id),answered:f.t.calls('history.window').filter(call=>f.db.answered.has(call.id)).map(call=>call.id),canceled:emitted.filter(id=>canceled.includes(id)),revision:f.model.longReader.peek()?.acceptedView.peek().revision,readWindow:readWindowCalls.length,handleSame:capturedHandle!==undefined&&f.model.handle.peek()===capturedHandle,readerSame:capturedReader!==undefined&&f.model.longReader.peek()===capturedReader,keySame:capturedKey!==undefined&&f.model.bodyCacheKey('old-tail')===capturedKey});};const answerPending=()=>answerMountedAncillary(f);
 try{await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  f.db.history.t=[old];f.db.historyRevisions.t=2;f.model.openThread('t');await flush(4);await answerPending();await flush(6);traceWindows('after-rev2-answer');
  expect(f.model.longReader.peek()!.acceptedView.peek().revision,JSON.stringify(windowTrace)).toBe(2);
  const rev2Handle=f.model.handle.peek(),rev2Reader=f.model.longReader.peek(),oldKey=f.model.bodyCacheKey('old-tail');capturedHandle=rev2Handle;capturedReader=rev2Reader;capturedKey=oldKey;expect(rev2Handle).not.toBeNull();expect(rev2Reader).not.toBeNull();const rev2Body=f.model.bodies.peek().get(oldKey);expect(rev2Body).toMatchObject({loading:true}); const tracedHandle=rev2Handle!;const originalReadWindow=tracedHandle.readWindow;const originalDescriptor=Object.getOwnPropertyDescriptor(tracedHandle,'readWindow');if(!originalDescriptor)throw new Error('missing readWindow descriptor');Object.defineProperty(tracedHandle,'readWindow',{...originalDescriptor,value:(...args:Parameters<typeof originalReadWindow>)=>{readWindowCalls.push(args[0]);return originalReadWindow.apply(tracedHandle,args);}});restoreReadWindow=()=>Object.defineProperty(tracedHandle,'readWindow',originalDescriptor);restoreResponder=installMountedWindowResponder(f);
  const oldCall=f.t.calls('history.get').at(-1);expect(oldCall).not.toBeNull();expect(f.t.calls('history.get').map(call=>requestedHistoryNode(call))).toEqual(['old-tail']);expect(host.querySelector('[data-node="old-tail"]')).not.toBeNull();expect(host.querySelector('[data-node="old-tail"]')!.textContent).toContain('old prefix');
  f.db.history.t=[old,newer];f.db.historyRevisions.t=3;traceWindows('before-rev3-jump');f.model.longReader.peek()!.jumpToEnd();await flush(4);traceWindows('after-rev3-jump');await answerPending();await flush(6);traceWindows('after-rev3-answer');
  expect(f.model.longReader.peek()!.acceptedView.peek().revision,JSON.stringify(windowTrace)).toBe(3);
  expect(f.model.handle.peek()).toBe(rev2Handle);expect(f.model.longReader.peek()).toBe(rev2Reader);expect(f.model.bodyCacheKey('old-tail')).toBe(oldKey);expect(f.model.bodies.peek().get(oldKey)).toBe(rev2Body);expect(f.model.bodies.peek().get(oldKey)).toMatchObject({loading:true});expect(f.model.longReader.peek()!.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(['old-tail','new-tail']);expect(host.querySelector('[data-node="new-tail"]')?.textContent).toContain('new complete');
  f.t.ok(oldCall!.id,{node_id:'old-tail',kind:'assistant_response',text:'OLD_FULL_SHOULD_NOT_RENDER',next_cursor:'stale-next'});await flush(8);
  expect(f.t.calls('history.get')).toHaveLength(1);expect(f.model.bodies.peek().get(oldKey)).toBeUndefined();const oldMarkdown=[...host.querySelectorAll('[data-node="old-tail"] .message-markdown')].map(node=>node.textContent??'').join('\n');expect(oldMarkdown).not.toContain('OLD_FULL_SHOULD_NOT_RENDER');expect(oldMarkdown).toContain('old prefix');
 }finally{restoreResponder?.();restoreReadWindow?.();render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it("mounted click joins the held old cursor read", async () => {
 const f=await fixtureModel({capabilities:["history.window"],route:"threads",threadId:"t",configure(db){db.threads={t:summary("t")};db.details.t=details("t");db.history.t=[];db.historyRevisions.t=1;}});
 const host=document.createElement('div');document.body.append(host);const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 const old:HistoryItem={node_id:'old-tail',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'text',item_identity:'answer',text:'old prefix',text_complete:false}]};
 const newer:HistoryItem={node_id:'new-tail',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'answer',text:'new complete',text_complete:true}]};
 const answerPending=()=>answerMountedAncillary(f);let restoreResponder:(()=>void)|undefined;
 try{await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  f.db.history.t=[old];f.db.historyRevisions.t=2;f.model.openThread('t');await flush(4);await answerPending();await flush(6);
  expect(f.model.longReader.peek()!.acceptedView.peek().revision).toBe(2);
  const rev2Handle=f.model.handle.peek(),rev2Reader=f.model.longReader.peek(),oldKey=f.model.bodyCacheKey('old-tail');expect(rev2Handle).not.toBeNull();expect(rev2Reader).not.toBeNull();const rev2Body=f.model.bodies.peek().get(oldKey);expect(rev2Body).toMatchObject({loading:true});
  const oldCall=f.t.calls('history.get').at(-1);expect(oldCall).not.toBeNull();expect(f.t.calls('history.get').map(call=>requestedHistoryNode(call))).toEqual(['old-tail']);expect(host.querySelector('[data-node="old-tail"]')).not.toBeNull();expect(host.querySelector('[data-node="old-tail"]')!.textContent).toContain('old prefix');
  const oldRow=host.querySelector('[data-node="old-tail"]');expect(oldRow).not.toBeNull();const oldButton=[...oldRow!.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.includes(f.model.t.value('convo.loadingBody')));expect(oldButton).not.toBeNull();expect(oldButton!.disabled).toBe(false);expect(f.t.calls('history.get').map(call=>call.args)).toEqual([{node_id:'old-tail'}]);await act(async()=>{oldButton!.click();await flush(2);});expect(f.t.calls('history.get').map(call=>call.args)).toEqual([{node_id:'old-tail'}]);
  f.db.history.t=[old,newer];f.db.historyRevisions.t=3;restoreResponder=installMountedWindowResponder(f);f.model.longReader.peek()!.jumpToEnd();await flush(4);await answerPending();await flush(6);
  expect(f.model.longReader.peek()!.acceptedView.peek().revision).toBe(3);
  expect(f.model.handle.peek()).toBe(rev2Handle);expect(f.model.longReader.peek()).toBe(rev2Reader);expect(f.model.bodyCacheKey('old-tail')).toBe(oldKey);expect(f.model.bodies.peek().get(oldKey)).toBe(rev2Body);expect(f.model.bodies.peek().get(oldKey)).toMatchObject({loading:true});expect(f.model.longReader.peek()!.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(['old-tail','new-tail']);expect(host.querySelector('[data-node="new-tail"]')?.textContent).toContain('new complete');
  f.t.ok(oldCall!.id,{node_id:'old-tail',kind:'assistant_response',text:'OLD_PREFIX\nOLD_FULL',next_cursor:'stale-next'});await flush(6);
  expect(f.t.calls('history.get').map(call=>call.args)).toEqual([{node_id:'old-tail'},{node_id:'old-tail',cursor:'stale-next'}]);const cursorCall=f.t.calls('history.get')[1]!;f.t.ok(cursorCall.id,{node_id:'old-tail',kind:'assistant_response',text:'\nOLD_REST'});await flush(8);
  expect(f.t.calls('history.get').map(call=>call.args)).toEqual([{node_id:'old-tail'},{node_id:'old-tail',cursor:'stale-next'}]);expect(f.model.bodies.peek().get(oldKey)?.text).toBe('OLD_PREFIX\nOLD_FULL\nOLD_REST');const oldMarkdown=[...host.querySelectorAll('[data-node="old-tail"] .message-markdown')].map(node=>(node.textContent??'').replace(/\s+$/,'')).join('\n');expect(oldMarkdown).toBe('OLD_PREFIX\nOLD_FULL\nOLD_REST');
 }finally{restoreResponder?.();render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it('live answer: own send stays last while waiting and becomes the saved row in place',async()=>{
 const f=await fixtureModel({capabilities:['live.text','history.window'],route:'conversation',threadId:'lead',configure(db){db.history.lead=[];db.work.lead=[];}});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  f.t.push({t:'live',thread_id:'lead',attempt_id:'live-answer',gap:false,deltas:[{offset:0,reasoning:false,text:'Live answer still in progress'}]});await act(async()=>{await flush(8);});
  expect(host.textContent).toContain('Live answer still in progress');
  const sending=f.model.send('My follow-up');await act(async()=>{await flush(8);});
  const pending=host.querySelector('[data-pending-own-message]') as HTMLElement;
  expect(pending).not.toBeNull();
  const rows=()=>[...host.querySelectorAll('.conversation-items > [data-item-key], .conversation-items [data-pending-own-message]')];
  const waitingOrder=rows();expect(waitingOrder.at(-1)).toBe(pending);
  expect(host.textContent).toContain('Live answer still in progress');
  const sendCall=f.t.calls('message.send').at(-1)!;f.db.answered.add(sendCall.id);f.t.ok(sendCall.id,{message_id:'my-follow-up',thread_id:'lead'});expect(await sending).toBe(true);
  await act(async()=>{f.t.push({t:'live_end',thread_id:'lead'});await flush(8);});
  f.db.historyRevisions.lead=2;f.db.history.lead=[{node_id:'answer',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'text',item_identity:'answer',text:'Live answer still in progress',text_complete:true}],provenance:{attempt_id:'live-answer',sender:{kind:'assistant'}}}];
  f.model.openThread('lead');
  await act(async()=>{await settle(f.t,f.db);await flush(10);});
  expect(host.querySelector('[data-pending-own-message]')).not.toBeNull();
  f.db.historyRevisions.lead=3;f.db.history.lead.push({node_id:'my-follow-up',kind:'user',selection:{ordinal:1},items:[{kind:'text',item_identity:'body',text:'My follow-up',text_complete:true}],provenance:{sender:{kind:'human'}}});
  f.model.openThread('lead');
  await act(async()=>{await settle(f.t,f.db);await flush(10);});
  const saved=host.querySelector('[data-node="my-follow-up"]') as HTMLElement;
  expect(saved,JSON.stringify({rows:f.model.longReader.peek()?.acceptedView.peek().rows.map(row=>row.node_id),revision:f.model.longReader.peek()?.acceptedView.peek().revision,pending:f.model.acceptedOwnMessages.peek(),calls:f.t.calls('history.window').map(call=>call.args)})).not.toBeNull();expect(host.querySelector('[data-pending-own-message]')).toBeNull();
  expect(rows().at(-1)).toBe(saved);expect(saved.textContent).toContain('My follow-up');
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it('two own sends remain in sending order at the conversation tail',async()=>{
 const f=await fixtureModel({capabilities:['live.text','history.window'],route:'conversation',threadId:'lead',configure(db){db.history.lead=[];db.work.lead=[];}});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  f.t.push({t:'live',thread_id:'lead',attempt_id:'live-answer-two',gap:false,deltas:[{offset:0,reasoning:false,text:'Live answer'}]});await act(async()=>{await flush(8);});
  const first=f.model.send('First send');await act(async()=>{await flush(8);});
  const firstCall=f.t.calls('message.send').at(-1)!;f.db.answered.add(firstCall.id);f.t.ok(firstCall.id,{message_id:'first',thread_id:'lead'});expect(await first).toBe(true);
  const second=f.model.send('Second send');await act(async()=>{await flush(8);});
  const pending=[...host.querySelectorAll<HTMLElement>('[data-pending-own-message]')];
  expect(pending.map(row=>row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('First send'),expect.stringContaining('Second send')]));
  const rowTexts=[...host.querySelectorAll('.msg .md')].map(row=>row.textContent?.trim());
  expect(rowTexts.slice(-2)).toEqual(['First send','Second send']);
  const secondCall=f.t.calls('message.send').at(-1)!;f.db.answered.add(secondCall.id);f.t.ok(secondCall.id,{message_id:'second',thread_id:'lead'});expect(await second).toBe(true);
  await act(async()=>{f.t.push({t:'live_end',thread_id:'lead'});await flush(8);});
  f.db.historyRevisions.lead=2;f.db.history.lead=[{node_id:'answer',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'text',item_identity:'answer',text:'Live answer',text_complete:true}],provenance:{attempt_id:'live-answer',sender:{kind:'assistant'}}},...['first','second'].map((id,index)=>({node_id:id,kind:'user',selection:{ordinal:index+1},items:[{kind:'text',item_identity:id,text:id==='first'?'First send':'Second send',text_complete:true}],provenance:{sender:{kind:'human'}}}))];
  await act(async()=>{f.t.push({t:'changed',thread_ids:['lead'],list:false});await settle(f.t,f.db);await flush(10);});
  expect([...host.querySelectorAll('.msg .md')].map(row=>row.textContent?.trim()).slice(-2)).toEqual(['First send','Second send']);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
