import { describe, expect, it } from 'vitest';
import { ShellboyData } from '../src/store';
import { FakeOwnerDb, FakeTransport, connected, settle } from './harness';
async function rig() {
  const t=new FakeTransport(), db=new FakeOwnerDb(), frames:(()=>void)[]=[];
  const data=new ShellboyData({transport:t,newId:()=> 'op',schedule:cb=>frames.push(cb)});
  data.start();t.open();t.push({t:'hello',bridge_version:'0',owner:connected});await settle(t,db);
  const h=data.openThread('a');await settle(t,db);
  const state={ available:true, error:false, text:'Canonical final text', truncated:false, phase:'final_answer' as string|null, competing:false, partial:false, wrong:false, changingRevision:false };
  const base=db.answer.bind(db);
  db.answer=c=>c.command==='status'?{ok:true,result:{items:state.available?[{kind:'attempt',id:'a1',attempt_id:'a1',turn_id:'turn-a',thread_id:'a',state:'completed',response_nodes:[{ordinal:0,node_id:'n1',kind:'message',phase:state.phase},{ordinal:1,node_id:'n1',kind:'function_call',phase:null},{ordinal:2,node_id:'n1',kind:'message',phase:'commentary'},...(state.competing?[{ordinal:3,node_id:'n1',kind:'message',phase:'final_answer'}]:[])],response_nodes_truncated:state.truncated}]:[]}}
    :c.command==='history.window'?{ok:true,result:{thread_id:'a',revision:state.changingRevision && t.calls('history.window').length>1?'r2':'r1',total:1,items:[{node_id:'n1',kind:'assistant_response',excerpt:'',selection:{ordinal:0}}]}}:c.command==='history.get'?state.error?{ok:false,code:'not_found',message:'synthetic unavailable'}:{ok:true,result:{node_id:state.wrong?'wrong':'n1',kind:'assistant_response',text:state.text,...(state.partial?{next_cursor:'partial'}:{})}}:base(c);
  const live=(id='a1',text='Live final text')=>{t.push({t:'live',thread_id:'a',attempt_id:id,gap:false,deltas:[{offset:0,reasoning:false,text}]});frames.splice(0).forEach(f=>f());};
  const end=()=>t.push({t:'live_end',thread_id:'a'});
  const change=()=>t.push({t:'changed',thread_ids:['a'],list:false});
  return {t,db,data,h,state,live,end,change,pump:()=>settle(t,db)};
}
describe('approved exact final-answer subset',()=>{
  it('uses exact attempt refs for final projection even when tool/commentary share the node',async()=>{
    const r=await rig();r.live();const key=r.h.handoff.value[0]!.key;r.end();await r.pump();
    expect(r.h.handoff.value[0]).toMatchObject({key,nodeId:'n1',status:'ready',text:'Canonical final text'});
    expect(r.t.calls('history.get').at(-1)?.args).toMatchObject({node_id:'n1',end_message_only:true,limit_bytes:262144});
  });
  it.each(['truncated','competing','partial','wrong','empty','nullphase','changingRevision'])('retains confirming body for %s rather than invent final proof',async mode=>{
    const r=await rig();if(mode==='empty')r.state.text='';else if(mode==='nullphase')r.state.phase=null;else r.state[mode as 'truncated'|'competing'|'partial'|'wrong'|'changingRevision']=true;
    r.live();r.end();await r.pump();expect(r.h.handoff.value[0]).toMatchObject({text:'Live final text',status:'confirming'});
    if (['partial','wrong','empty','changingRevision'].includes(mode)) {
      expect(r.h.handoff.value[0]!.nodeId).toBe('n1');
      expect(r.h.handoff.value[0]!.proof).toBeUndefined();
    } else expect(r.h.handoff.value[0]!.nodeId).toBeUndefined();
  });
  it('reports read failure, retains text, and explicitly retries exact identity',async()=>{
    const r=await rig();r.state.error=true;r.live();r.end();await r.pump();expect(r.h.handoff.value[0]).toMatchObject({text:'Live final text',status:'failed'});
    r.state.error=false;const retry=r.h.retryHandoff();await r.pump();await retry;expect(r.h.handoff.value[0]!.status).toBe("ready");
  });
  it('keeps known text and exact identity when the public body format is unsupported',async()=>{
    const r=await rig(),base=r.db.answer.bind(r.db);
    r.db.answer=c=>c.command==='history.get'?{ok:true,result:{node_id:'n1',kind:'assistant_response',body_ref:{kind:'unsupported'}}}:base(c);
    r.live();r.end();await r.pump();
    expect(r.h.handoff.value[0]).toMatchObject({nodeId:'n1',status:'failed',text:'Live final text'});
    expect(r.h.handoff.value[0]!.proof).toBeUndefined();r.data.stop();
  });
  it('hints never refill the generation budget',async()=>{
    const r=await rig();r.state.available=false;r.live();r.end();await r.pump();for(let n=0;n<20;n++){r.change();await r.pump();}
    expect(r.t.calls('status')).toHaveLength(8);expect(r.h.handoff.value[0]!.text).toBe('Live final text');
  });
  it('next attempt does not destroy an older pending or ready body',async()=>{
    const r=await rig();r.live();r.end();await r.pump();r.live('a2','next generation');
    expect(r.h.handoff.value.map(x=>x.text)).toEqual(['Canonical final text','next generation']);
  });
  it('late successful replies cannot cross a cancel, owner switch or final handle close',async()=>{
    for(const action of ['cancel','owner','close']){const r=await rig();r.live();r.end();
      if(action==='cancel')r.h.cancelReads();else if(action==='close')r.h.close();else r.t.push({t:'owner',event:'restarted',owner:connected});
      await r.pump();expect(r.h.handoff.value.some(x=>x.status==='ready')).toBe(false);
      expect(r.h.handoff.value.some(x=>x.nodeId !== undefined)).toBe(false);
    }
  });
});

it('closing one of two handles cannot invalidate a live owner held by the other',async()=>{
  const r=await rig();const second=r.data.openThread('a');r.live();r.end();r.h.close();await r.pump();
  expect(second.handoff.value[0]).toMatchObject({status:'ready',nodeId:'n1'});second.close();expect(second.handoff.value).toEqual([]);
});

it('a held canonical read cannot survive owner ABA',async()=>{
  const r=await rig();r.live();r.end();
  r.t.push({t:'owner',event:'restarted',owner:connected});
  r.t.push({t:'owner',event:'restarted',owner:connected});
  await r.pump();expect(r.h.handoff.value).toEqual([]);
});

it('a failed history gate leaves other status/detail and hint consumers live',async()=>{
  const r=await rig();r.state.error=true;r.live();r.end();await r.pump();
  let hints=0;const watch=r.data.watchHints('a',()=>hints++);r.h.setWorkActive(true);await r.pump();
  const detailBefore=r.t.calls('thread.get').length,workBefore=r.t.calls('status').length;
  r.change();await r.pump();expect(hints).toBe(1);expect(r.t.calls('thread.get').length).toBeGreaterThan(detailBefore);
  expect(r.t.calls('status').length).toBeGreaterThan(workBefore);expect(r.h.history.value.stale).toBe(true);
  watch.close();r.h.close();
});

it.each(['truncated','missing','ongoing'])('C1 final projection cannot bypass another %s attempt coverage',async mode=>{
  const r=await rig(),base=r.db.answer.bind(r.db);
  r.db.answer=c=>{const out=base(c);if(c.command!=='status'||!out.ok)return out;
    const other:Record<string,unknown>={kind:'attempt',id:'other',attempt_id:'other',turn_id:'turn-a',thread_id:'a',state:'completed',response_nodes:[],response_nodes_truncated:false};
    if(mode==='truncated')other.response_nodes_truncated=true;if(mode==='missing')delete other.response_nodes;if(mode==='ongoing')other.state='running';
    return {ok:true,result:{...out.result as object,items:[...(out.result as {items:unknown[]}).items,other]}};
  };
  r.live();r.end();await r.pump();expect(r.h.handoff.value[0]).toMatchObject({status:'confirming',text:'Live final text'});expect(r.t.calls('history.get')).toHaveLength(0);r.data.stop();
});
