import { describe, expect, it } from 'vitest';
import { Cancel } from '../src/operations';
import { ShellboyData } from '../src/store';
import { FakeOwnerDb, FakeTransport, connected, settle } from './harness';
const toolNode=(node_id='tool')=>({node_id,kind:'assistant_response',excerpt:'RAW_SYNTHETIC_TOOL',execution_count:0});
async function rig(initial?: Record<string, unknown>[]){
  const t=new FakeTransport(),db=new FakeOwnerDb();const data=new ShellboyData({transport:t,newId:()=> 'synthetic-op'});
  data.start();t.open();t.push({t:'hello',bridge_version:'0',owner:connected});await settle(t,db);
  if(initial)db.history.a=initial;
  const h=data.openThread('a');await settle(t,db);
  const state={kind:'function_call',phase:null as string|null,truncated:false,other:false,cursor:false,error:false,available:true};
  const base=db.answer.bind(db);db.answer=c=>c.command==='status'?state.error?{ok:false,code:'not_found'}:{ok:true,result:{items:state.available?[{kind:'attempt',id:'attempt',attempt_id:'attempt',turn_id:'turn',thread_id:'a',state:'completed',response_nodes:[{ordinal:0,node_id:'tool',kind:state.kind,phase:state.phase}],response_nodes_truncated:state.truncated},...(state.other?[{kind:'attempt',id:'other',attempt_id:'other',turn_id:'turn',thread_id:'a',response_nodes:[{ordinal:0,node_id:'tool',kind:'message',phase:'final_answer'}],response_nodes_truncated:false}]:[])]:[],...(state.cursor?{next_cursor:'more'}:{})}}:base(c);
  const change=()=>t.push({t:'changed',thread_ids:['a'],list:false});
  const add=()=>{db.history.a=[...(db.history.a??[]),toolNode()];change();};
  return {t,db,data,h,state,change,add,pump:()=>settle(t,db)};
}
describe('tracked first-publication qualification',()=>{
  it('never publishes a tracked raw aggregate before the exact identity read settles',async()=>{
    const r=await rig();const seen:string[]=[];const stop=r.h.history.subscribe(h=>{for(const i of h.items)if(i.node_id==='tool')seen.push(i.assistant_publication?.state??'RAW');});
    r.add();await r.pump();expect(seen).not.toContain('RAW');expect(r.h.history.value.items.at(-1)?.assistant_publication).toMatchObject({state:'tool',kind:'function_call'});stop();r.data.stop();
  });
  it.each(['truncated','other','cursor','error','missing','commentary','nullphase'])('keeps %s unknown, never plain prose',async mode=>{
    const r=await rig();if(mode==='missing')r.state.available=false;else if(mode==='commentary'||mode==='nullphase'){r.state.kind='message';r.state.phase=mode==='commentary'?'commentary':null;}else r.state[mode as 'truncated'|'other'|'cursor'|'error']=true;
    r.add();await r.pump();expect(r.h.history.value.items.at(-1)?.assistant_publication?.state).toBe('unknown');r.data.stop();
  });
  it('permits the complete one-final-message node without JSON-shape guessing',async()=>{
    const r=await rig();r.state.kind='message';r.state.phase='final_answer';r.add();await r.pump();expect(r.h.history.value.items.at(-1)?.assistant_publication?.state).toBe('message');r.data.stop();
  });
  it('caps shared additional status starts at eight despite hints, explicit retry only refills',async()=>{
    const r=await rig();r.state.available=false;r.add();await r.pump();for(let n=0;n<20;n++){r.change();await r.pump();}
    expect(r.t.calls('status')).toHaveLength(8);const retry=r.h.retryPublication();await r.pump();await retry;expect(r.t.calls('status')).toHaveLength(9);r.data.stop();
  });
  it.each(['cancel','pause','close','ABA'])('rejects delayed identity results after %s',async action=>{
    const r=await rig();r.add();
    // Walk settles first, then status is deliberately held while ownership changes.
    for(let n=0;n<50;n++){
      for(const c of r.t.calls().filter(c=>!r.db.answered.has(c.id)&&c.command!=='status')){r.db.answered.add(c.id);const out=r.db.answer(c);if(out.ok)r.t.ok(c.id,out.result);else r.t.ownerError(c.id,out.code);}
      await Promise.resolve();
      if(r.t.calls('status').some(c=>!r.db.answered.has(c.id)))break;
    }
    expect(r.t.calls('status').some(c=>!r.db.answered.has(c.id))).toBe(true);
    if(action==='cancel')r.h.cancelReads();else if(action==='pause')r.h.pause();else if(action==='close')r.h.close();else {r.t.push({t:'owner',event:'restarted',owner:connected});r.t.push({t:'owner',event:'restarted',owner:connected});}
    if(action==='ABA'){
      const old=r.t.calls('status').find(c=>!r.db.answered.has(c.id))!;r.db.answered.add(old.id);const out=r.db.answer(old);if(out.ok)r.t.ok(old.id,out.result);
      for(let n=0;n<20;n++)await Promise.resolve();
    }else await r.pump();
    expect(r.h.history.value.items.filter(i=>i.node_id==='tool').some(i=>i.assistant_publication?.state==='tool')).toBe(false);r.data.stop();
  });
});

it('known initial tool refs are gated at the first committed history publication',async()=>{
  const r=await rig();r.db.history.b=[toolNode()];
  const base=r.db.answer.bind(r.db);r.db.answer=c=>c.command==='status'&&(c.args as {thread_id:string}).thread_id==='b'?{ok:true,result:{items:[{kind:'attempt',id:'attempt-b',attempt_id:'attempt-b',turn_id:'turn-b',thread_id:'b',state:'completed',response_nodes:[{ordinal:0,node_id:'tool',kind:'function_call',phase:null}],response_nodes_truncated:false}]}}:base(c);
  const second=r.data.openThread('b');second.setWorkActive(true);
  for(let n=0;n<12;n++)await Promise.resolve();
  for(const c of r.t.calls('status').filter(c=>!r.db.answered.has(c.id))){r.db.answered.add(c.id);const out=r.db.answer(c);if(out.ok)r.t.ok(c.id,out.result);}
  for(let n=0;n<12;n++)await Promise.resolve();
  const seen:string[]=[];const stop=second.history.subscribe(h=>{for(const i of h.items)if(i.node_id==='tool')seen.push(i.assistant_publication?.state??'RAW');});
  await r.pump();expect(seen).not.toContain('RAW');expect(second.history.value.items[0]?.assistant_publication?.state).toBe('tool');stop();second.close();r.data.stop();
});

it('older paging preserves legacy rows rather than treating older assistant history as fresh output',async()=>{
  const r=await rig(Array.from({length:2100},(_,n)=>({node_id:`legacy${n}`,kind:'assistant_response',excerpt:`legacy body ${n}`})));
  const earlier=r.h.loadOlderHistory();await r.pump();await earlier;
  expect(r.h.history.value.items.find(i=>i.node_id==='legacy0')?.assistant_publication).toBeUndefined();r.data.stop();
});

it('positional new nodes are gated before the first window result and older page remains legacy',async()=>{
  const r=await rig();let total=1;
  const base=r.db.answer.bind(r.db);r.db.answer=c=>c.command==='history.window'?{ok:true,result:{thread_id:'a',revision:1,total,items:[{...toolNode(),selection:{ordinal:total-1}}]}}:base(c);
  const old=r.h.readWindow({before:0,after:0},new Cancel());await r.pump();await old;
  total=2;const fresh=r.h.readWindow({before:0,after:0},new Cancel());await r.pump();const result=await fresh;
  expect(result.ok&&result.value.items[0]?.assistant_publication?.state).toBe('tool');r.data.stop();
});

it('a synchronous history subscriber cancel cannot publish the superseded read',async()=>{
  const r=await rig();let cancelled=false;
  const stop=r.h.history.subscribe(value=>{if(value.loading&&!cancelled){cancelled=true;r.h.cancelReads();}});
  r.add();await r.pump();expect(r.h.history.value.items.some(i=>i.node_id==='tool')).toBe(false);stop();r.data.stop();
});

it('ignores wire-provided client-only qualifications on a tracked node',async()=>{
  const r=await rig();r.state.available=false;r.db.history.a=[{...toolNode(),assistant_publication:{state:'message'}}];r.change();await r.pump();
  expect(r.h.history.value.items.at(-1)?.assistant_publication?.state).toBe('unknown');r.data.stop();
});

it('owner replacement invalidates retained message proof rather than reusing it for a new owner',async()=>{
  const r=await rig();r.state.kind='message';r.state.phase='final_answer';r.add();await r.pump();
  expect(r.h.history.value.items.at(-1)?.assistant_publication?.state).toBe('message');
  r.state.available=false;r.t.push({t:'owner',event:'restarted',owner:connected});
  expect(r.h.history.value.items.at(-1)?.assistant_publication?.state).toBe('unknown');await r.pump();
  expect(r.h.history.value.items.at(-1)?.assistant_publication?.state).toBe('unknown');r.data.stop();
});

it.each(['truncated','missing','malformed','invalid-ref','unknown-thread','ongoing','null','other-turn-truncated','missing-turn'])('cannot prove message-only coverage with another %s attempt',async mode=>{
  const r=await rig();r.state.kind='message';r.state.phase='final_answer';
  const base=r.db.answer.bind(r.db);r.db.answer=c=>{
    const out=base(c);if(c.command!=='status'||!out.ok)return out;
    const extra:Record<string,unknown>={kind:'attempt',id:'other',attempt_id:'other',turn_id:'turn',thread_id:'a',state:'completed',response_nodes:[],response_nodes_truncated:false};
    if(mode==='truncated')extra.response_nodes_truncated=true;
    if(mode==='ongoing')extra.state='running';
    if(mode==='null')extra.response_nodes=null;
    if(mode==='other-turn-truncated'){extra.turn_id='other-turn';extra.response_nodes_truncated=true;}
    if(mode==='missing-turn')delete extra.turn_id;
    if(mode==='missing'){delete extra.response_nodes;delete extra.response_nodes_truncated;}
    if(mode==='malformed')extra.response_nodes={};
    if(mode==='invalid-ref')extra.response_nodes=[null];
    if(mode==='unknown-thread'){delete extra.thread_id;extra.response_nodes_truncated=true;}
    return {ok:true,result:{...out.result as object,items:[...(out.result as {items:unknown[]}).items,extra]}};
  };
  r.add();await r.pump();expect(r.h.history.value.items.at(-1)?.assistant_publication?.state).toBe('unknown');r.data.stop();
});

it.each(['empty','different-thread'])('complete non-competing %s scope retains the ordinary message control',async mode=>{
  const r=await rig();r.state.kind='message';r.state.phase='final_answer';const base=r.db.answer.bind(r.db);
  r.db.answer=c=>{const out=base(c);if(c.command!=='status'||!out.ok)return out;
    const other={kind:'attempt',id:'other',attempt_id:'other',turn_id:'other-turn',thread_id:mode==='different-thread'?'b':'a',state:'completed',response_nodes:[],response_nodes_truncated:mode==='different-thread'};
    return {ok:true,result:{...out.result as object,items:[...(out.result as {items:unknown[]}).items,other]}};
  };
  r.add();await r.pump();expect(r.h.history.value.items.at(-1)?.assistant_publication?.state).toBe('message');r.data.stop();
});

it('late exact tool reference requalifies an already published legacy node without replaying raw text',async()=>{
  const r=await rig([toolNode()]);
  // No authoritative reference existed at the legacy first read; ordinary text remains readable.
  expect(r.h.history.value.items[0]?.assistant_publication).toBeUndefined();
  r.h.setWorkActive(true);await r.pump();
  expect(r.h.history.value.items.find(i=>i.node_id==='tool')?.assistant_publication?.state).toBe('tool');
  r.data.stop();
});

it('mixed exact refs on a legacy aggregate remain qualified rather than falling back to raw prose',async()=>{
  const r=await rig([toolNode()]);
  const base=r.db.answer.bind(r.db);r.db.answer=c=>{
    const out=base(c);if(c.command!=='status'||!out.ok)return out;
    const value=out.result as {items:Record<string,unknown>[]};
    return {ok:true,result:{...value,items:value.items.map(a=>({...a,response_nodes:[{ordinal:0,node_id:'tool',kind:'message',phase:'commentary'},{ordinal:1,node_id:'tool',kind:'function_call',phase:null}]}))}};
  };
  r.h.setWorkActive(true);await r.pump();
  expect(r.h.history.value.items.find(i=>i.node_id==='tool')?.assistant_publication?.state).toBe('unknown');r.data.stop();
});

it('late exact tool identity never changes unrelated legacy or ordinary user JSON',async()=>{
  const r=await rig([toolNode(),{node_id:'plain',kind:'assistant_response',excerpt:'{"ordinary":true}'},{node_id:'human',kind:'user',excerpt:'{"user":true}'}]);
  r.h.setWorkActive(true);await r.pump();
  expect(r.h.history.value.items.find(i=>i.node_id==='plain')).toMatchObject({excerpt:'{"ordinary":true}'});
  expect(r.h.history.value.items.find(i=>i.node_id==='plain')?.assistant_publication).toBeUndefined();
  expect(r.h.history.value.items.find(i=>i.node_id==='human')?.assistant_publication).toBeUndefined();r.data.stop();
});

it.each(['cancel','pause','owner','ABA'])('late work lookup cannot gate another publication scope after %s',async mode=>{
  const r=await rig([toolNode()]);r.h.setWorkActive(true);
  for(let n=0;n<20;n++)await Promise.resolve();
  const held=r.t.calls('status').find(c=>!r.db.answered.has(c.id))!;expect(held).toBeTruthy();
  if(mode==='cancel')r.h.cancelReads();else if(mode==='pause')r.h.pause();else{
    r.t.push({t:'owner',event:'restarted',owner:{state:'connected',info:{protocol_version:5,capabilities:connected.state==='connected'?connected.info.capabilities:[],instance_id:'different-owner'}}});
    if(mode==='ABA')r.t.push({t:'owner',event:'restarted',owner:connected});
  }
  r.db.answered.add(held.id);const out=r.db.answer(held);if(out.ok)r.t.ok(held.id,out.result);
  for(let n=0;n<20;n++)await Promise.resolve();
  expect(r.h.history.value.items.find(i=>i.node_id==='tool')?.assistant_publication).toBeUndefined();r.data.stop();
});

it('synchronous work loading cancellation sends no status lookup',async()=>{
  const r=await rig([toolNode()]);const count=r.t.calls('status').length;
  const stop=r.h.work.subscribe(value=>{if(value.loading)r.h.cancelReads();});
  r.h.setWorkActive(true);await r.pump();expect(r.t.calls('status')).toHaveLength(count);stop();r.data.stop();
});
