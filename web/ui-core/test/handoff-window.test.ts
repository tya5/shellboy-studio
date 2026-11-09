import { describe, expect, it } from 'vitest';
import { Handoff, type HandoffRecord } from '../../data/src/handoff';
import { rig } from './window-owner';
async function setup() {
  const r=await rig(10);await r.settle();
  const h=new Handoff(cb=>cb());h.apply({attempt_id:'a',gap:false,deltas:[{offset:0,reasoning:false,text:'visible body'}]});h.finish();
  h.ready('a','n0-9','safe saved body',{scope:'owner/thread/session',turnId:'turn-a',ordinal:9,revision:1,kind:'assistant_response'});
  return {r,h};
}
describe('bounded canonical attachment receive',()=>{
  it('declines off-window, wrong revision and wrong owner without losing the ledger body',async()=>{
    const {r,h}=await setup();const record=h.records.value[0]!;
    for(const edited of [{...record,proof:{...record.proof!,ordinal:300}},{...record,proof:{...record.proof!,revision:2}}]){
      expect(r.w.acceptHandoff(edited,'owner/thread/session',()=>{})).toBe(false);
    }
    expect(r.w.acceptHandoff(record,'another-owner',()=>{})).toBe(false);
    expect(h.records.value[0]!.text).toBe('safe saved body');r.w.dispose();r.data.stop();
  });
  it('moves one immutable body lease, preserving quota across transfer and explicit retry',async()=>{
    const {r,h}=await setup();const before=h.retainedBytes;
    expect(h.transfer('a',(record,release)=>r.w.acceptHandoff(record,'owner/thread/session',release))).toBe(true);
    expect(h.records.value).toHaveLength(1);expect(h.retainedBytes).toBe(before);expect(h.records.value[0]!.transferred).toBe(true);
    h.reconcile();r.w.dispose();expect(h.records.value).toEqual([]);expect(h.retainedBytes).toBe(0);r.data.stop();
  });
  it('automatic revision reset returns the existing body rather than treating it as navigation',async()=>{
    const {r,h}=await setup();h.transfer('a',(record,release)=>r.w.acceptHandoff(record,'owner/thread/session',release));
    r.owner.rewrite(10);r.w.changed();await r.settle();
    expect(h.records.value[0]).toMatchObject({text:'safe saved body',transferred:false});r.w.dispose();r.data.stop();
  });
  it('an old release callback cannot delete a replacement attachment with the same node/key',async()=>{
    const {r,h}=await setup();let oldRelease:((reason:'return'|'end')=>void)|undefined;
    h.transfer('a',(_record,release)=>{oldRelease=release;return true;});oldRelease!('return');
    h.transfer('a',()=>true);oldRelease!('end');
    expect(h.records.value).toHaveLength(1);expect(h.records.value[0]!.transferred).toBe(true);r.w.dispose();r.data.stop();
  });
  it('reserves transfer before reentrant receiver code and refuses callbacks across owner teardown',async()=>{
    const {r,h}=await setup();let replacement:HandoffRecord|undefined;
    const result=h.transfer('a',(record)=>{replacement=record;expect(h.transfer('a',()=>true)).toBe(false);h.discard('owner_restarted');return true;});
    expect(result).toBe(false);expect(Object.isFrozen(replacement)).toBe(true);expect(h.records.value).toEqual([]);r.w.dispose();r.data.stop();
  });
});

it('a synchronous receiver close is settled after attachment reservation',async()=>{
  const {r,h}=await setup();h.transfer('a',(_record,release)=>{release('end');return true;});
  expect(h.records.value).toEqual([]);r.w.dispose();r.data.stop();
});
