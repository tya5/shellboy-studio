import { expect, it } from "vitest";
import { ShellboyData } from "../src/store";
import { connected, FakeTransport, FakeOwnerDb, settle, flush } from "./harness";
async function rig() {
  const t = new FakeTransport(); let n = 0;
  const data = new ShellboyData({ transport: t, newId: () => `qualification-${++n}` });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: connected }); await flush();
  return { t, data, a: data.openThread("a"), b: data.openThread("a") };
}
it("local close rejects its token before shared entry cancellation and leaves another handle valid", async () => {
  const r = await rig(), a = r.a.captureReadQualification()!, b = r.b.captureReadQualification()!, scope = r.a.handoffScope();
  r.a.close(); expect(r.a.handoffScope()).toBe(scope); expect(r.a.isReadQualificationCurrent(a)).toBe(false); expect(r.b.isReadQualificationCurrent(b)).toBe(true); r.data.stop();
});
for (const action of ["pause", "cancel", "owner-aba", "link-aba", "stop"] as const) it(`never revives after ${action}`, async () => {
  const r = await rig(), token = r.a.captureReadQualification()!;
  if (action === "pause") { r.a.pause(); r.a.resume(); }
  if (action === "cancel") { r.a.cancelReads(); await r.a.retryHandoff(); }
  if (action === "owner-aba") { r.t.push({ t: "owner", event: "unreachable", owner: { state: "unreachable" } }); r.t.push({ t: "owner", event: "connected", owner: connected }); }
  if (action === "link-aba") { r.t.drop(); r.t.open(); r.t.push({ t: "hello", bridge_version: "synthetic", owner: connected }); }
  if (action === "stop") r.data.stop();
  expect(r.a.isReadQualificationCurrent(token)).toBe(false); r.data.stop();
});
it("capture rejects paused/closed handles and replaced or foreign tokens", async () => {
  const r = await rig(), old = r.a.captureReadQualification()!, next = r.a.captureReadQualification()!;
  expect(r.a.isReadQualificationCurrent(old)).toBe(false); expect(r.a.isReadQualificationCurrent(next)).toBe(true);
  expect(r.b.isReadQualificationCurrent(next)).toBe(false); r.a.pause(); expect(r.a.captureReadQualification()).toBeUndefined(); r.a.close(); expect(r.a.captureReadQualification()).toBeUndefined(); r.data.stop();
});
it("cancellation callbacks observe prior invalidation", async () => {
  const r = await rig(), token = r.a.captureReadQualification()!; let seen: boolean | undefined;
  // The entry's first threadGet is already in flight; inspect its owned Cancel via
  // a new isolated handle, without reaching into private entry state.
  const original = r.data.operations.threadGet.bind(r.data.operations);
  r.data.operations.threadGet = (args, opts) => { opts?.cancel?.add(() => { seen = other.isReadQualificationCurrent(token2); }); return original(args, opts); };
  const other = r.data.openThread("callback"); const token2 = other.captureReadQualification()!;
  await flush(); other.cancelReads(); await flush();
  expect(seen).toBe(false); expect(r.a.isReadQualificationCurrent(token)).toBe(true); r.data.stop();
});


it('resolver-only retry cannot revoke the existing handle or hide its held preview',async()=>{
 const r=await rig();
 r.t.push({t:'live',thread_id:'a',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'Held original'}]});await flush();
 r.t.push({t:'live_end',thread_id:'a'});await flush();
 const token=r.a.captureReadQualification()!,scope=r.a.handoffScope();
 const retry=r.a.retryHandoff();
 expect(r.a.isReadQualificationCurrent(token)).toBe(true);expect(r.a.handoffScope()).toBe(scope);
 await settle(r.t,new FakeOwnerDb());await retry;
 expect(r.a.isReadQualificationCurrent(token)).toBe(true);
 expect(r.a.handoff.peek().find(record=>record.attemptId==='attempt')?.text).toBe('Held original');
 r.a.cancelReads();expect(r.a.isReadQualificationCurrent(token)).toBe(false);r.data.stop();
});
