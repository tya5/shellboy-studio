import { expect, it } from "vitest";
import { ShellboyData } from "../src/store";
import { FakeOwnerDb, FakeTransport, connected, settle, flush } from "./harness";
import {readbackFixture as rig} from './readback-fixture';

for (const mode of ["truncated", "partial", "deferred", "unknown", "missing", "error", "changing"] as const) it(`terminal persisted refs stage fallback with incomplete public output does not invoke ${mode} body probe`, async () => {
  const r = await rig(); r.state[mode] = true; r.live(); r.end(); await r.pump();
  const record = r.h.handoff.value[0]!;
  expect(r.receipt()).toMatchObject({ attemptId: "attempt", terminalState: "completed" });
  expect(r.receipt()!.nodeIds).toEqual(["tool", "answer"]);
  expect(record.text).toBe("whole live block"); expect(record.readyAttempt).toBeUndefined();
  expect(r.bodyReads()).toHaveLength(0); expect(r.t.calls("history.get")).toHaveLength(0); r.data.stop();
});
for (const mode of ["empty", "nonterminal", "wrongid"] as const) it(`does not claim persisted terminal fallback for ${mode}`, async () => {
  const r = await rig(); r.state[mode] = true; r.live(); r.end(); await r.pump();
  expect(r.receipt()).toBeUndefined(); r.data.stop();
});

it('ninth incomplete original reports scoped receipt capacity without spending a body read or changing prior proofs', async()=>{
 const r=await rig();r.state.truncated=false;
 try {
 for(let i=1;i<=8;i++){
 r.state.attempt=`attempt-${i}`;r.live();r.end();await r.pump();await Promise.all([r.h.retryHandoff(),r.pump()]);
 expect(r.receipt()).toBeDefined();
 expect(r.h.transferHandoff(r.state.attempt,(_record,release)=>{release('end');return true;})).toBe(true);
 }
 r.state.truncated=true;r.state.attempt='attempt-9';r.live();r.end();await r.pump();await Promise.all([r.h.retryHandoff(),r.pump()]);
 expect(r.h.handoffRetryState.peek()).toEqual({phase:'unavailable',reason:'receipt_capacity',canRetry:false});
 expect(r.h.handoff.peek()[0]?.text).toBe('whole live block');expect(r.receipt()).toBeUndefined();
 // Retrying this same blocked original cannot allocate a ninth receipt or spend a body read.
 const held=r.h.handoff.peek()[0]!,reads=r.bodyReads().length;
 await Promise.all([r.h.retryHandoff(),r.pump()]);
 expect(r.h.handoff.peek()[0]).toBe(held);expect(r.receipt()).toBeUndefined();expect(r.bodyReads()).toHaveLength(reads);
 expect(r.window.acceptedView.peek().terminalPersistedAttempts).toHaveLength(8);
 r.h.pause();await r.h.retryHandoff();expect(r.h.handoffRetryState.peek()).toMatchObject({reason:'paused',canRetry:false});
 }finally{r.data.stop();}
});

it('eight existing exact receipts can be reused by the same retained original without allocating a ninth proof',async()=>{
 const r=await rig();r.state.truncated=false;
 try{
  for(let i=1;i<=8;i++){
   r.state.attempt=`reuse-${i}`;r.live();r.end();await r.pump();await Promise.all([r.h.retryHandoff(),r.pump()]);
   const original=r.h.handoff.peek()[0]!,receipt=r.receipt()!;expect(receipt.recordKey).toBe(original.key);
   expect(r.h.transferHandoff(r.state.attempt,(_record,release)=>{release(i===8?'return':'end');return true;})).toBe(i!==8);
   if(i===8)expect(r.h.handoff.peek()[0]?.key).toBe(original.key);
  }
  const held=r.h.handoff.peek()[0]!,before=r.window.acceptedView.peek().terminalPersistedAttempts!;
  expect(before).toHaveLength(8);r.state.truncated=true;const reads=r.bodyReads().length;
  await Promise.all([r.h.retryHandoff(),r.pump()]);
  expect(r.h.handoff.peek()[0]?.key).toBe(held.key);expect(r.receipt()?.recordKey).toBe(held.key);
  expect(r.window.acceptedView.peek().terminalPersistedAttempts).toEqual(before);expect(r.bodyReads()).toHaveLength(reads);
 }finally{r.data.stop();}
});
