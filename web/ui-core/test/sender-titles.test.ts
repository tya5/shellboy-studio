import { describe, expect, it } from 'vitest';
import { SenderTitles } from '../src/sender-titles';
import type { Operations, Outcome, ThreadDetails, ThreadSummary } from '../../data/src';
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
function rig(){
  const calls:{id:string;resolve:(out:Outcome<ThreadDetails>)=>void;cancel?:{cancelled:boolean}}[]=[];
  const ops:Pick<Operations,'threadGet'>={threadGet:(id,options)=>new Promise(resolve=>calls.push({id,resolve,cancel:options?.cancel}))};
  const resolver=new SenderTitles(ops);
  const ok=(index:number,id=calls[index]!.id,title='Current title')=>calls[index]!.resolve({ok:true,value:{thread_id:id,title} as ThreadDetails});
  return {resolver,calls,ok};
}
describe('bounded current sender title resolution',()=>{
  it('deduplicates opaque IDs and never uses title as identity',async()=>{
    const r=rig();r.resolver.update('owner/view',['one','one','two']);await flush();expect(r.calls.map(c=>c.id)).toEqual(['one']);
    r.ok(0,'one','Same name');await flush();r.ok(1,'two','Same name');await flush();
    expect([...r.resolver.values.value.keys()]).toEqual(['one','two']);expect(r.resolver.attemptCount).toBe(2);
  });
  it('uses current owner list cache without RPC and adopts renamed titles without a refill',async()=>{
    const r=rig();const row=(title:string)=>({thread_id:'one',title} as ThreadSummary);
    r.resolver.update('owner/view',['one'],[row('Old')]);await flush();expect(r.calls).toHaveLength(0);
    r.resolver.update('owner/view',['one'],[row('<Renamed>')]);expect(r.resolver.values.value.get('one')).toEqual({state:'ready',title:'<Renamed>'});
    expect(r.resolver.attemptCount).toBe(0);
  });
  it('caps lifetime candidates/cache/attempts at sixteen despite hints and new IDs',async()=>{
    const r=rig();r.resolver.update('owner/view',Array.from({length:100},(_,i)=>`id${i}`));
    for(let n=0;n<16;n++){await flush();expect(r.resolver.inFlight).toBe(1);r.ok(n);}
    await flush();for(let n=0;n<30;n++)r.resolver.update('owner/view',[`new${n}`]);await flush();
    expect(r.calls).toHaveLength(16);expect(r.resolver.candidateCount).toBe(16);expect(r.resolver.attemptCount).toBe(16);expect(r.resolver.values.value.size).toBe(0);
  });
  it.each(['error','mismatch'])('retains ID fallback for %s and does not retry automatically',async mode=>{
    const r=rig();r.resolver.update('owner/view',['one']);await flush();
    if(mode==='error')r.calls[0]!.resolve({ok:false,error:{kind:'owner',code:'unsupported',message:'synthetic'}});else r.ok(0,'wrong','Not this sender');
    await flush();for(let n=0;n<20;n++)r.resolver.update('owner/view',['one']);await flush();
    expect(r.calls).toHaveLength(1);expect(r.resolver.values.value.get('one')).toEqual({state:'unresolved'});
  });
  it.each(['owner','page','leave','close'])('drops late results on %s, retaining the aggregate in-flight slot until settlement',async mode=>{
    const r=rig();r.resolver.update('owner/view/page1',['one']);await flush();
    if(mode==='close')r.resolver.close();else r.resolver.update(mode==='leave'?undefined:`${mode}/page2`,['two']);
    await flush();expect(r.calls).toHaveLength(1);expect(r.calls[0]!.cancel?.cancelled).toBe(true);r.ok(0);await flush();
    expect(r.resolver.values.value.get('one')).toBeUndefined();if(mode!=='close'&&mode!=='leave'){expect(r.calls).toHaveLength(2);r.ok(1);await flush();}
  });
  it('candidate removal rejects late data without refilling consumed attempts',async()=>{
    const r=rig();r.resolver.update('owner/view',['one']);await flush();r.resolver.update('owner/view',['two']);r.ok(0);await flush();
    expect(r.resolver.values.value.get('one')).toBeUndefined();expect(r.resolver.attemptCount).toBe(2);r.ok(1);await flush();
    r.resolver.update('owner/view',['one']);await flush();expect(r.calls).toHaveLength(2);
  });
  it('a fresh cached rename wins over an older in-flight response',async()=>{
    const r=rig();r.resolver.update('owner/view',['one']);await flush();r.resolver.update('owner/view',['one'],[{thread_id:'one',title:'Fresh'} as ThreadSummary]);
    r.ok(0,'one','Older');await flush();expect(r.resolver.values.value.get('one')).toEqual({state:'ready',title:'Fresh'});
  });
  it('reserves cancellation and attempt ownership before reentrant transport code',async()=>{
    let resolver:SenderTitles;let calls=0;
    resolver=new SenderTitles({threadGet:()=>{calls++;resolver.close();return Promise.resolve({ok:true,value:{thread_id:'one',title:'late'} as ThreadDetails});}});
    resolver.update('owner/view',['one']);await flush();expect(calls).toBe(1);expect(resolver.values.value.size).toBe(0);
  });
});

it('does not free candidate slots merely because background membership churned',async()=>{
  const r=rig();r.resolver.update('view',Array.from({length:16},(_,i)=>`cached${i}`),Array.from({length:16},(_,i)=>({thread_id:`cached${i}`,title:'same'} as ThreadSummary)));
  r.resolver.update('view',['seventeenth']);await flush();expect(r.calls).toHaveLength(0);expect(r.resolver.candidateCount).toBe(16);expect(r.resolver.values.value.get('seventeenth')).toBeUndefined();
  r.resolver.update('view-page2',['seventeenth']);await flush();expect(r.calls).toHaveLength(1);r.ok(0);await flush();
});
