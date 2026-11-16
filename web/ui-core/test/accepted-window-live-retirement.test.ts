import { describe, expect, it } from "vitest";
import { flush } from "../../data/test/harness";
import { rig } from "./window-owner";
import { canonicalAttemptId } from "../../data/test/work-fixture";

describe("production accepted window live retirement", () => {
  it("releases the matching live attempt only after accepted saved rows commit", async () => {
    const f = await rig(20);
    f.owner.decorate = (i, item) => i === 19 ? { ...item, kind: "assistant_response", provenance: { attempt_id: canonicalAttemptId(1) } } : item;
    f.w.bindCurrentThread(f.handle);
    f.t.push({ t: "live", thread_id: "t", attempt_id: canonicalAttemptId(1), gap: false, deltas: [{ offset: 0, reasoning: false, text: "live answer" }] });
    await flush();
    expect(f.handle.handoff.value.some(record => record.attemptId === canonicalAttemptId(1))).toBe(true);
    f.w.changed();
    await f.settle();
    expect(f.handle.handoff.value.some(record => record.attemptId === canonicalAttemptId(1))).toBe(false);
    f.w.dispose();
    f.data.stop();
  });
});


it('preserves missing, mismatched, foreign-scope, and revoked live records while retiring only the matching attempt',async()=>{
 const f=await rig(2);const match=canonicalAttemptId(1),other=canonicalAttemptId(2);f.w.bindCurrentThread(f.handle);
 f.t.push({t:'live',thread_id:'t',attempt_id:match,gap:false,deltas:[{offset:0,reasoning:false,text:'matching'}]});
 f.t.push({t:'live',thread_id:'t',attempt_id:other,gap:false,deltas:[{offset:0,reasoning:false,text:'other'}]});await flush();
 expect(f.handle.handoff.value.map(record=>record.attemptId)).toEqual(expect.arrayContaining([match,other]));
 f.owner.decorate=(i,item)=>i===1?{...item,kind:'assistant_response',provenance:{attempt_id:match}}:item;f.w.changed();await f.settle();
 expect(f.handle.handoff.value.some(record=>record.attemptId===match)).toBe(false);expect(f.handle.handoff.value.some(record=>record.attemptId===other)).toBe(true);
 const before=f.handle.handoff.value.length;f.w.acceptedView.revoke();f.owner.append(1);f.w.changed();await f.settle();
 expect(f.handle.handoff.value.length).toBeGreaterThanOrEqual(before);f.w.dispose();f.data.stop();
});


async function liveCase(attempt:string){const f=await rig(2);f.w.bindCurrentThread(f.handle);f.t.push({t:'live',thread_id:'t',attempt_id:attempt,gap:false,deltas:[{offset:0,reasoning:false,text:attempt}]});await flush();return f}

it('missing attempt provenance preserves live identity through production commit',async()=>{const attempt=canonicalAttemptId(1),f=await liveCase(attempt);try{const before=f.handle.handoff.value[0]!;f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'}}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop()}});
it('different attempt preserves live identity through production commit',async()=>{const attempt=canonicalAttemptId(1),other=canonicalAttemptId(2),f=await liveCase(attempt);try{const before=f.handle.handoff.value[0]!;f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'},attempt_id:other}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop()}});
it('foreign current handle does not retire the old live identity',async()=>{const attempt=canonicalAttemptId(1),f=await liveCase(attempt),foreign=await rig(2);try{const before=f.handle.handoff.value[0]!;expect(f.w.bindCurrentThread(foreign.handle)).toBe(false);f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'},attempt_id:attempt}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop();foreign.w.dispose();foreign.data.stop()}});
it('revoke preserves live identity before a publication reply arrives',async()=>{const attempt=canonicalAttemptId(1),f=await liveCase(attempt);try{const before=f.handle.handoff.value[0]!;f.w.acceptedView.revoke();f.owner.decorate=(_i,item)=>({...item,kind:'assistant_response',provenance:{sender:{kind:'assistant'},attempt_id:attempt}});f.w.changed();await f.settle();expect(f.handle.handoff.value.some(record=>record===before)).toBe(true);expect(f.w.acceptedView.isCurrent(f.w.acceptedView.peek())).toBe(false)}finally{f.w.dispose();f.data.stop()}});


it('rejected publication reply preserves accepted ref and live identity',async()=>{
 const attempt=canonicalAttemptId(1),f=await liveCase(attempt);try{const beforeRef=f.w.acceptedView.peek(),before=f.handle.handoff.value[0]!;f.owner.append(1);f.w.changed();await flush();const call=f.calls().filter(item=>item.command==='history.window'&&!f.owner.answered.has(item.id)).at(-1);expect(call).toBeDefined();f.w.acceptedView.revoke();f.owner.answered.add(call!.id);const answer=f.owner.answer(call!);expect(answer.ok).toBe(true);if(answer.ok)f.t.ok(call!.id,answer.result);await flush(8);expect(f.w.acceptedView.peek()).toBe(beforeRef);expect(f.handle.handoff.value.some(record=>record===before)).toBe(true)}finally{f.w.dispose();f.data.stop()}});
