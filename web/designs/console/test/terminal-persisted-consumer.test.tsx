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

for(const mode of ['terminal-publication-trace','empty-complete','truncated','partial','budget','nonterminal','empty','wrong-attempt'] as const)it(`actual terminal persisted consumer: ${mode}`,async()=>{
 let ended=false,revision=7;
 const nodes:HistoryItem[]=[
  {node_id:'user',kind:'user',selection:{ordinal:0},items:[{kind:'text',item_identity:'u',text:'Independent user',text_complete:true}]},
  {node_id:'saved',kind:'assistant_response',selection:{ordinal:1},items:[{kind:'text',item_identity:'s',text:'Available saved answer',text_complete:true}]},
  {node_id:'unready',kind:'assistant_response',selection:{ordinal:2},items:mode==='empty-complete'?[{kind:'text',item_identity:'empty-complete',text:'',text_complete:true}]:mode==='partial'?[{kind:'text',item_identity:'p',text:'Available partial prefix',text_complete:false}]:null,...(['partial','empty-complete'].includes(mode)?{}:{items_unavailable_reason:'response_budget' as const})},
 ];
 const f=await fixtureModel({capabilities:['live.text','history.window'],configure(db){
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
  expect(f.model.data.capabilities.peek()).toContain('history.window');
  const win=f.model.longReader.peek()!;
  const before=win.acceptedView.peek();
  await act(async()=>{f.t.push({t:'live',thread_id:'t',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'Original live answer'}]});await flush(24);});
  expect(host.textContent).toContain('Original live answer');
  const trace:unknown[]=[];
  const handle=f.model.handle.peek()!,original=handle.handoff.peek()[0];
  const capture=(stage:string,accepted?:boolean)=>{
   const reader=f.model.longReader.peek(),snapshot=reader?.acceptedView.peek();
   trace.push({stage,accepted,staged:handle.handoff.peek().map(record=>({sameOriginal:record===original,attempt:record.attemptId,terminal:!!record.terminalPersisted,transferred:!!record.transferred,status:record.status})),current:reader&&snapshot?reader.acceptedView.isCurrent(snapshot):undefined,receipts:snapshot?.terminalPersistedAttempts?.length??0,liveMounted:!!host.querySelector('[data-live-overlay]'),canonicalMounted:host.textContent?.includes('Available saved answer')});
  };
  let stopTrace=()=>{};
  if(mode==='terminal-publication-trace'){
   stopTrace=handle.handoff.subscribe(()=>capture('handoff-signal'));
   const reader=f.model.longReader.peek();
   if(reader){const accept=reader.acceptHandoff.bind(reader);reader.acceptHandoff=(...args)=>{capture('reader-before');const accepted=accept(...args);capture('reader-after',accepted);return accepted;};}
  }

  const publications:typeof before[]=[];const stop=win.acceptedView.subscribe(ref=>publications.push(ref));
  ended=true;await act(async()=>{f.t.push({t:'live_end',thread_id:'t'});await settle(f.t,f.db);await flush(24);});stop();
  expect(host.textContent).toContain('Independent user');expect(host.textContent).toContain('Available saved answer');
  if(mode==='partial')expect(host.textContent).toContain('Available partial prefix');
  else expect(host.textContent).not.toContain('Available partial prefix');
  if(['terminal-publication-trace','empty-complete','truncated','partial','budget'].includes(mode)){
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
   expect(f.t.calls('history.window').length).toBeLessThanOrEqual(3);
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
  if(mode==='terminal-publication-trace'){capture('settled');stopTrace();console.log('TERMINAL_PUBLICATION_TRACE',JSON.stringify({trace}));}
  expect(f.t.calls('history.get')).toHaveLength(0);
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

it('observes ninth same-scope exact terminal receipt backpressure separately from read budget',async()=>{
 let active=0,ended=false;
 const nodes:HistoryItem[]=Array.from({length:9},(_,i)=>({node_id:`saved-${i+1}`,kind:'assistant_response',selection:{ordinal:i},items:[{kind:'text',item_identity:`body-${i+1}`,text:`Canonical answer ${i+1}`,text_complete:true}]}));
 const f=await fixtureModel({capabilities:['live.text','history.window'],configure(db){
  db.threads={t:summary('t')};db.details.t=details('t');db.history.t=nodes;
  const base=db.answer.bind(db);db.answer=call=>{
   if(call.command==='status')return {ok:true,result:{items:ended?[{kind:'attempt',id:`attempt-${active}`,attempt_id:`attempt-${active}`,thread_id:'t',state:'completed',response_nodes_truncated:false,response_nodes:[{node_id:`saved-${active}`,ordinal:active-1,kind:'message'}]}]:[]}};
   if(call.command==='history.window')return {ok:true,result:{thread_id:'t',revision:1,total:9,items:nodes}};
   return base(call);
  };
 }});
 const host=document.createElement('div');document.body.append(host);
 const context:DesignContext={model:f.model,prefs:signal(loadPrefs({read:()=>null,write:()=>{}},[{name:'console',themes:[{name:'light'}]}])),setPrefs:()=>{},designs:[],submitToken:async()=>false};
 const observed:unknown[]=[];
 try{
  await act(async()=>{render(<App context={context}/>,host);await settle(f.t,f.db);});
  const handle=f.model.handle.peek()!,scope=handle.handoffScope();
  for(active=1;active<=9;active++){
   ended=false;
   await act(async()=>{f.t.push({t:'live',thread_id:'t',attempt_id:`attempt-${active}`,gap:false,deltas:[{offset:0,reasoning:false,text:`Preview ${active}`} ]});await flush(12);});
   ended=true;
   await act(async()=>{f.t.push({t:'live_end',thread_id:'t'});await settle(f.t,f.db);await flush(12);});
   // Exercise only the existing explicit Retry budget; do not refill implicitly.
   await act(async()=>{const retry=handle.retryHandoff();await settle(f.t,f.db);await retry;await flush(12);});
   const reader=f.model.longReader.peek()!,snapshot=reader.acceptedView.peek();
   observed.push({attempt:active,scopeSame:handle.handoffScope()===scope,receipts:snapshot.terminalPersistedAttempts?.length??0,held:handle.handoff.peek().map(record=>({attempt:record.attemptId,terminal:!!record.terminalPersisted,status:record.status})),retry:handle.handoffRetryState.peek(),live:host.querySelectorAll('[data-live-overlay]').length,canonical:host.textContent?.includes(`Canonical answer ${active}`)});
   expect(handle.handoffScope()).toBe(scope);
   if(active<=8){expect(handle.handoff.peek()).toHaveLength(0);expect(snapshot.terminalPersistedAttempts).toHaveLength(active);}
   else {
    expect(snapshot.terminalPersistedAttempts).toHaveLength(8);expect(handle.handoff.peek()).toHaveLength(1);
    expect(handle.handoff.peek()[0]).toMatchObject({attemptId:'attempt-9',status:'confirming'});expect(handle.handoff.peek()[0]!.terminalPersisted).toBeUndefined();
    expect(host.querySelector('[data-live-overlay]')).not.toBeNull();expect(host.textContent).toContain('Canonical answer 9');
    expect(handle.handoffRetryState.peek()).not.toMatchObject({reason:'budget-exhausted'});
    expect(handle.handoffRetryState.peek()).toMatchObject({phase:'unavailable',reason:'receipt_capacity',canRetry:false});
    const preview=host.querySelector('[data-live-overlay]')!;
    expect(preview.querySelector('small.mono')?.textContent).toBe(f.model.t.value('convo.handoffConfirming'));
    expect(preview.textContent).toContain('Preview 9');
    expect(preview.querySelector('[data-handoff-retry-reason="receipt_capacity"]')?.textContent).toContain(f.model.t.value('convo.retry.receipt_capacity'));
    expect(preview.querySelector('[data-handoff-retry-reason="receipt_capacity"] button')).toBeNull();
   }
  }
 }finally{console.log('NINTH_RECEIPT_TRACE',JSON.stringify(observed));render(null,host);host.remove();f.model.dispose();f.data.stop();}
});
