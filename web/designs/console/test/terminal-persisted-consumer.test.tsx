// @vitest-environment happy-dom
import '@preact/signals';
import {signal} from '@preact/signals-core';
import {render} from 'preact';
import {act} from 'preact/test-utils';
import {expect,it} from 'vitest';
import {fixtureModel} from '../../../ui-core/test/fixture';
import {summary,details,flush,settle} from '../../../data/test/harness';
import type {HistoryItem} from '../../../data/src/protocol';
import type {DesignContext} from '../../../ui-core/src';
import {loadPrefs} from '../../../ui-core/src/prefs';
import {App} from '../screens/App';

for(const windowed of [true,false])for(const mode of ['empty-complete','truncated','partial','budget','nonterminal','empty','wrong-attempt'] as const)it(`actual terminal persisted consumer: ${mode} window=${windowed}`,async()=>{
 let ended=false,revision=7;
 const nodes:HistoryItem[]=[
  {node_id:'user',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'u',text:'Independent user',text_complete:true}]},
  {node_id:'saved',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'s',text:'Available saved answer',text_complete:true}]},
  {node_id:'unready',kind:'assistant_response',selection:{ordinal:2},items:mode==='empty-complete'?[{kind:'text',item_identity:'empty-complete',text:'',text_complete:true}]:mode==='partial'?[{kind:'text',item_identity:'p',text:'Available partial prefix',text_complete:false}]:null,...(['partial','empty-complete'].includes(mode)?{}:{items_unavailable_reason:'response_budget' as const})},
 ];
 const f=await fixtureModel({capabilities:windowed?['live.text','history.window']:['live.text'],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=nodes;
  const base=db.answer.bind(db);db.answer=call=>{
   if(call.command==='status')return {ok:true,result:{items:ended?[{kind:'attempt',id:mode==='wrong-attempt'?'other-attempt':'attempt',attempt_id:mode==='wrong-attempt'?'other-attempt':'attempt',thread_id:'t',state:mode==='nonterminal'?'inflight':'completed',response_nodes_truncated:mode==='truncated',response_nodes:mode==='empty'?[]:[{node_id:'unready',ordinal:2,kind:'message'},{node_id:'saved',ordinal:1,kind:'message'}]}]:[]}};
   if(call.command==='history.window')return {ok:true,result:{thread_id:'t',revision,total:3,items:nodes}};
   return base(call);
  };
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  expect(f.model.data.capabilities.peek()).toContain('live.text');
  expect(f.model.data.capabilities.peek().includes('history.window')).toBe(windowed);
  const win=windowed?f.model.longReader.peek()!:f.model.legacyPresentation.peek()!;
  const before=win.acceptedView.peek();
  await act(async()=>{f.t.push({t:'live',thread_id:'t',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'Original live answer'}]});await flush(24);});
  expect(host.textContent).toContain('Original live answer');
  const publications:typeof before[]=[];const stop=win.acceptedView.subscribe(ref=>publications.push(ref));
  ended=true;await act(async()=>{f.t.push({t:'live_end',thread_id:'t'});await settle(f.t,f.db);await flush(24);});stop();
  expect(host.textContent).toContain('Independent user');expect(host.textContent).toContain('Available saved answer');
  if(mode==='partial')expect(host.textContent).toContain('Available partial prefix');
  else expect(host.textContent).not.toContain('Available partial prefix');
  if(['empty-complete','truncated','partial','budget'].includes(mode)){
   expect(host.textContent).not.toContain('Original live answer');
   const current=win.acceptedView.peek();expect(current.terminalPersistedAttempts).toHaveLength(1);
   expect(current.rows).toEqual(before.rows);if("retiredAttempts" in current)expect(current.retiredAttempts??[]).toHaveLength(0);
   expect(current.attemptPresentations?.some(fact=>fact.state==='pending'&&fact.attemptId==='attempt')).not.toBe(true);
   expect(publications.some(ref=>ref.terminalPersistedAttempts?.length===1)).toBe(true);
   const presence=host.querySelector('[data-terminal-presence]');expect(presence).not.toBeNull();
   if(mode==='empty-complete'){expect(presence?.getAttribute('data-client-reason')).toBe('body-unavailable');expect(host.querySelector('[data-node="unready"] .msg')).toBeNull();}
   expect(presence?.closest('[data-work-group]')).not.toBeNull();
   expect(presence?.textContent).toContain('CLIENT');
   expect(presence?.getAttribute('data-client-reason')).toBe(current.terminalPresence?.[0]?.reason);
   expect(f.t.calls('history.window').length).toBeLessThanOrEqual(windowed?3:1);
  }else{
   expect(host.textContent).toContain('Original live answer');
   expect(win.acceptedView.peek().terminalPersistedAttempts??[]).toHaveLength(0);
  }
  if(mode==='empty-complete'){
   nodes[2]={...nodes[2]!,items:[{kind:'text',item_identity:'empty-complete',text:'Now available completed answer',text_complete:true}]};revision++;
   await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);await flush(24);});
   expect(host.textContent).toContain('Now available completed answer');
   expect(host.textContent).toContain('Available saved answer');expect(host.textContent).not.toContain('Original live answer');
   expect(host.querySelector('[data-terminal-presence]')).toBeNull();
  }
  expect(f.t.calls('history.get')).toHaveLength(0);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

it('no-window App keeps structural receipts after representation GC and suppresses old work from the same qualified bundle',async()=>{
 let stage=0;
 const nodes:HistoryItem[]=[{node_id:'saved-terminal',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'text',item_identity:'saved',text:'Independent available saved',text_complete:true}]}];
 const f=await fixtureModel({capabilities:['live.text'],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=nodes;
  const base=db.answer.bind(db);db.answer=call=>{
   if(call.command==='history.window')return {ok:true,result:{thread_id:'t',revision:1,total:1,items:nodes}};
   if(call.command==='status')return {ok:true,result:{items:stage===1?[{id:'retired-attempt',attempt_id:'retired-attempt',thread_id:'t',kind:'attempt',state:'completed',response_nodes:[{node_id:'saved-terminal',ordinal:0,kind:'message'}]}]:stage===3?[{id:'old-work',thread_id:'t',kind:'shell',state:'running',attempt_id:'retired-attempt',execution_id:'old-execution'}]:[]}};
   return base(call);
  };
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const owner=f.model.legacyPresentation.peek()!;
  await act(async()=>{f.t.push({t:'live',thread_id:'t',attempt_id:'retired-attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'Retired original body'}]});await flush(24);});
  expect(host.textContent).toContain('Retired original body');
  stage=1;await act(async()=>{f.t.push({t:'live_end',thread_id:'t'});await settle(f.t,f.db);await flush(24);});
  expect(f.model.legacyPresentation.peek()).toBe(owner);
  expect(owner.acceptedView.peek().structuralTerminalReceipts).toHaveLength(1);
  stage=2;await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);await flush(24);});
  let ref=owner.acceptedView.peek();
  expect(owner.isCurrent(ref)).toBe(true);expect(ref.structuralTerminalReceipts).toHaveLength(1);
  expect(ref.terminalPersistedAttempts).toHaveLength(0);
  expect(host.textContent).not.toContain('Retired original body');expect(host.textContent).toContain('Independent available saved');
  stage=3;await act(async()=>{f.t.push({t:'changed',thread_ids:['t'],list:false});await settle(f.t,f.db);await flush(24);});
  ref=owner.acceptedView.peek();expect(owner.isCurrent(ref)).toBe(true);expect(ref.work.value?.items[0]?.id).toBe('old-work');
  expect(ref.structuralTerminalReceipts).toHaveLength(1);
  expect(host.querySelector('[data-execution-unavailable], [data-execution-id="old-execution"]')).toBeNull();
  expect(host.textContent).not.toContain('Retired original body');
  await act(async()=>{f.model.navigate({view:'threads'});await flush(4);});expect(owner.isCurrent(ref)).toBe(false);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
for(const resultMode of ['complete','partial','error','cancel'] as const)it(`actual Stage2 App bound read and receipt presence: ${resultMode}`,async()=>{
 let ended=false;
 const available:HistoryItem={node_id:'available',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'available-text',text:'Already available unchanged',text_complete:true}]};
 const f=await fixtureModel({capabilities:['live.text','history.window'],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=[available];
  const base=db.answer.bind(db);db.answer=call=>{
   if(call.command==='status')return {ok:true,result:{items:ended?[{kind:'attempt',id:'terminal',attempt_id:'terminal',thread_id:'t',state:'completed',response_nodes:[{node_id:'missing',ordinal:1,kind:'message'}]}]:[]}};
   if(call.command==='history.window'){
    return {ok:true,result:{thread_id:'t',revision:1,total:1,items:[available]}};
   }
   return base(call);
  };
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  await act(async()=>{f.t.push({t:'live',thread_id:'t',attempt_id:'terminal',gap:false,deltas:[{offset:0,reasoning:false,text:'Live before exact receipt'}]});await flush(24);});
  expect(host.textContent).toContain('Live before exact receipt');
  const send=f.t.send.bind(f.t);f.t.send=frame=>{const sent=send(frame);if(frame.t==='call'&&frame.command==='history.window'&&(frame.args as {node_id?:string}).node_id==='missing')f.db.answered.add(frame.id);return sent;};
  ended=true;await act(async()=>{f.t.push({t:'live_end',thread_id:'t'});await settle(f.t,f.db);await flush(24);});
  const read=f.t.calls('history.window').filter(call=>(call.args as {node_id?:string}).node_id==='missing');expect(read).toHaveLength(1);
  const held=read[0]!;f.db.answered.add(held.id);
  expect(host.textContent).not.toContain('Live before exact receipt');expect(host.textContent).toContain('Already available unchanged');
  expect(host.querySelector('[data-terminal-phase="reading"]')?.closest('[data-work-group]')).not.toBeNull();
  expect(host.querySelector('[data-terminal-phase="reading"] .work-element-row__line')?.getAttribute('title')).toBe('Saved-history confirmation');
  expect(host.querySelector('[data-terminal-phase="reading"] [data-state-source="client"]')?.getAttribute('data-state-value')).toBe('read-inflight');
  expect(host.querySelector('[data-terminal-phase="reading"]')?.textContent).toContain('CLIENT');
  const before=f.model.longReader.peek()!.acceptedView.peek();
  if(resultMode==='cancel')await act(async()=>{f.model.navigate({view:'threads'});await flush(12);});
  await act(async()=>{
   if(resultMode==='error')f.t.ownerError(held.id,'synthetic_read_failure','synthetic read failure');
   else f.t.ok(held.id,{thread_id:'t',revision:1,total:2,items:[available,{node_id:'missing',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'canonical',text:'Canonical candidate',text_complete:resultMode!=='partial'}]}]});
   await flush(48);
  });
  expect(read).toHaveLength(1);expect(f.t.calls('history.window').filter(call=>(call.args as {node_id?:string}).node_id==='missing')).toHaveLength(1);
  if(resultMode==='complete'){expect(host.textContent).toContain('Canonical candidate');expect(host.querySelector('[data-terminal-presence]')).toBeNull();}
  else if(resultMode==='partial'){expect(host.querySelector('[data-client-reason="partial-items"]')?.textContent).toContain('CLIENT');}
  else if(resultMode==='error'){expect(host.querySelector('[data-client-reason="read-error"]')?.textContent).toContain('CLIENT');}
  else expect(f.model.longReader.peek()).toBeUndefined();
  if(resultMode!=='cancel')expect(f.model.longReader.peek()!.acceptedView.peek().rows[0]).toEqual(before.rows[0]);
  if(resultMode==='partial'||resultMode==='error')expect(host.querySelector('[data-terminal-phase="settled"] .work-element-row__line')?.getAttribute('title')).toBe('Saved-history confirmation');
  expect(f.t.calls('history.get')).toHaveLength(0);
 }finally{render(null,host);host.remove();f.model.dispose();f.data.stop();}
});

for(const mode of ['terminal-held','subscriber-source','cancel'] as const)it(`visibility atomic producer ${mode}`,async()=>{
 let ended=false; const nodes:HistoryItem[]=[{node_id:'old-answer',kind:'assistant_response',selection:{ordinal:0},items:[{kind:'text',item_identity:'old',text:'Synthetic prior complete answer',text_complete:true}]},{node_id:'tool',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'tool_call',item_identity:'call',execution_ids:[]}]}];
 const f=await fixtureModel({capabilities:['live.text'],configure(db){db.threads={t:summary('t')};db.details.t=details('t');db.history.t=nodes;const base=db.answer.bind(db);db.answer=call=>call.command==='status'?{ok:true,result:{items:ended?[{kind:'attempt',id:'attempt',attempt_id:'attempt',thread_id:'t',state:'completed',response_nodes:[{node_id:'new-answer',kind:'message',ordinal:2}]}]:[]}}:base(call);}});
 const host=document.createElement('div');document.body.append(host);const frames:unknown[]=[];
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 let stop=()=>{};
 try{
 await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
 const owner=f.model.legacyPresentation.peek()!,handle=f.model.handle.peek()!;let armed=mode==='subscriber-source';
 stop=owner.acceptedView.subscribe(ref=>{
  frames.push({frame:frames.length,trigger:'accepted-notify',generation:ref.projectionGeneration,current:owner.isCurrent(ref),rows:ref.rows.map(n=>n.node_id)});
  if(armed){armed=false;const work=handle.work as import('@preact/signals-core').Signal<typeof handle.work.value>;work.value={...work.peek(),stale:!work.peek().stale};frames.push({frame:frames.length,trigger:'subscriber-source-write',oldCurrent:owner.isCurrent(ref),replacement:owner.acceptedView.peek()!==ref});}
 });
 expect(host.textContent).toContain('Synthetic prior complete answer');
 await act(async()=>{f.t.push({t:'live',thread_id:'t',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'Synthetic live'}]});await flush(24);});
 if(mode==='cancel')await act(async()=>{handle.cancelReads();render(<App context={context}/>,host);await flush(24);});
 else{ended=true;await act(async()=>{f.t.push({t:'live_end',thread_id:'t'});await settle(f.t,f.db);await flush(24);});}
 const ref=owner.acceptedView.peek();frames.push({frame:frames.length,trigger:'post-render',current:owner.isCurrent(ref),rows:ref.rows.map(n=>n.node_id),completeAssistant:ref.rows.filter(n=>n.items?.some(i=>i.kind==='text'&&i.text_complete)).map(n=>n.node_id),oldMounted:host.textContent!.includes('Synthetic prior complete answer'),presence:ref.terminalPresence?.map(p=>[p.attemptId,p.phase,p.reason])});
 if(mode==='cancel')expect(owner.isCurrent(ref)).toBe(false);else{expect(owner.isCurrent(ref)).toBe(true);expect(host.textContent).toContain('Synthetic prior complete answer');}
 }finally{console.log('VISIBILITY_FRAMES',JSON.stringify(frames));stop();render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
