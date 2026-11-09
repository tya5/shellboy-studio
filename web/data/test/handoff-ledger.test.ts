import { describe, expect, it } from 'vitest';
import { Handoff, MAX_HANDOFF_BYTES, MAX_HANDOFF_RECORDS } from '../src/handoff';
const frame = (attempt_id: string, text: string) => ({ attempt_id, gap: false, deltas: [{ offset: 0, reasoning: false, text }] });
function rig() { const ticks: (() => void)[] = []; const h = new Handoff(f => ticks.push(f)); return { h, tick: () => ticks.splice(0).forEach(f => f()) }; }
describe('ADR-C1 bounded display ownership', () => {
  it('keeps prior unresolved bodies across tool ends and next attempts with stable keys', () => {
    const {h,tick}=rig(); h.apply(frame('a1','first')); tick(); const key=h.records.value[0]!.key;
    h.finish(); h.apply(frame('a2','second')); tick();
    expect(h.records.value.map(r=>r.text)).toEqual(['first','second']); expect(h.records.value[0]!.key).toBe(key);
    h.fail('a1'); expect(h.records.value[0]).toMatchObject({text:'first',status:'failed'});
    h.confirming('a1'); h.ready('a1','n1','saved first');
    expect(h.records.value[0]).toMatchObject({key,text:'saved first',nodeId:'n1',status:'ready'});
    h.apply(frame('a3','third'));tick();expect(h.records.value[0]!.text).toBe('saved first');
  });
  it('retains eight unresolved records and refuses new text rather than evicting one',()=>{
    const {h,tick}=rig();for(let n=0;n<8;n++){h.apply(frame(`a${n}`,`body${n}`));tick();}
    h.apply(frame('overflow','not held'));tick();expect(h.records.value).toHaveLength(MAX_HANDOFF_RECORDS);
    expect(h.records.value[0]!.text).toBe('body0');expect(h.overflow.value).toBe(true);
    h.release('a0');expect(h.records.value).toHaveLength(8);
    h.ready('a0','n0','canonical');h.release('a0');expect(h.records.value).toHaveLength(7);
  });
  it('accounts UTF8 rather than UTF16 and never destroys earlier text at the aggregate ceiling',()=>{
    const {h,tick}=rig(); const text='\u754c'.repeat(120000);
    for(let n=0;n<3;n++){h.apply(frame(`a${n}`,text));tick();}
    expect(h.retainedBytes).toBeLessThanOrEqual(MAX_HANDOFF_BYTES); expect(h.records.value[0]!.text).toBe(text);
    expect(h.overflow.value).toBe(true);expect(h.records.value[2]!.text).toBe('');expect(h.records.value[2]!.incomplete).toBe(true);
  });
  it('has eight starts per explicit generation; hints cannot refill and reset invalidates epochs',()=>{
    const {h}=rig();for(let n=0;n<8;n++)expect(h.takeRead()).toBe(true);expect(h.takeRead()).toBe(false);
    const old=h.epoch;h.reconcile();expect(h.epoch).not.toBe(old);expect(h.takeRead()).toBe(true);
    h.discard('owner_restarted');expect(h.records.value).toEqual([]);
  });
  it('never applies a queued old publication after owner/reset teardown',()=>{
    const {h,tick}=rig();h.apply(frame('a','old owner'));h.discard('owner_restarted');tick();expect(h.records.value).toEqual([]);
  });
});

it('reserves unpublished frame text against the same aggregate byte budget',()=>{
  const {h,tick}=rig();
  for(let n=0;n<4;n++)h.apply(frame(`pending-${n}`,'\u754c'.repeat(120000)));
  tick();expect(h.retainedBytes).toBeLessThanOrEqual(MAX_HANDOFF_BYTES);expect(h.overflow.value).toBe(true);
});

it('accepts exactly one MiB across four bounded records but refuses the next byte',()=>{
  const {h,tick}=rig();for(let n=0;n<4;n++){h.apply(frame(`edge${n}`,'x'.repeat(262144)));tick();}
  expect(h.retainedBytes).toBe(MAX_HANDOFF_BYTES);h.apply(frame('extra','x'));tick();
  expect(h.retainedBytes).toBe(MAX_HANDOFF_BYTES);expect(h.records.value[0]!.text.length).toBe(262144);expect(h.overflow.value).toBe(true);
});

it('a late old-attempt frame cannot steal the active successor or revive a saved record',()=>{
  const {h,tick}=rig();h.apply(frame('old','first'));tick();h.finish();h.apply(frame('next','second'));tick();
  h.apply(frame('old','late old replay'));tick();expect(h.preview.value).toMatchObject({attemptId:'next',text:'second'});
  h.ready('old','saved','canonical');h.apply(frame('old','late saved replay'));tick();expect(h.preview.value).toMatchObject({attemptId:'next',text:'second'});
});
