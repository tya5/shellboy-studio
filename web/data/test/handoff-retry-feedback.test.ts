import { expect, it } from "vitest";
import { ShellboyData } from "../src/store";
import { FakeOwnerDb, FakeTransport, connected, settle, flush } from "./harness";
import {readbackFixture as rig} from './readback-fixture';

it("explicit retry publishes real read progress and unresolved outcome without executing a model/tool/send", async () => {
  const r = await rig(); r.state.available = false; r.live(); r.end(); await r.pump();
  expect(r.h.handoffRetryState.value).toMatchObject({ phase: "unavailable", reason: "unresolved", canRetry: true });
  const before = r.t.calls("status").length; const phases: string[] = [];
  const { effect } = await import("@preact/signals-core"); const stop = effect(() => { phases.push(r.h.handoffRetryState.value.phase); });
  const retry = r.h.retryHandoff(); await flush(); expect(r.h.handoffRetryState.value.phase).toBe("reading");
  await r.pump(); await retry; expect(r.t.calls("status")).toHaveLength(before + 1);
  expect(phases).toContain("reading"); expect(r.h.handoffRetryState.value.phase).toBe("unavailable");
  expect(r.t.calls().some(call => ["message.send", "run.retry", "shell.run"].includes(call.command))).toBe(false); stop(); r.data.stop();
});
it("canonical demand survives same-entry reconcile and wakes once after commit", async () => {
  const r = await rig();
  try {
    r.live(); r.end(); await flush();
    const initial = r.t.calls("status").at(-1)!; expect(initial).toBeDefined();
    let out = r.db.answer(initial); r.db.answered.add(initial.id); if (out.ok) r.t.ok(initial.id, out.result);
    await flush();
    const beforeStatus = r.t.calls("status").length, beforeTick = r.h.historyTick.peek();
    r.t.push({ t: "changed", thread_ids: ["a"], list: false }); await flush();
    expect(r.t.calls("status").length).toBe(beforeStatus + 1);
    const retry = r.h.retryHandoff(); await flush();
    expect(r.t.calls("status").length).toBe(beforeStatus + 1);
    const first = r.t.calls("status").at(-1)!;
    out = r.db.answer(first); r.db.answered.add(first.id); if (out.ok) r.t.ok(first.id, out.result);
    await flush();
    expect(r.h.historyTick.peek()).toBe(beforeTick);
    expect(r.t.calls("status").length).toBe(beforeStatus + 2);
    const followup = r.t.calls("status").at(-1)!;
    out = r.db.answer(followup); r.db.answered.add(followup.id); if (out.ok) r.t.ok(followup.id, out.result);
    await flush(); await retry; await r.pump();
    expect(r.h.historyTick.peek()).toBe(beforeTick + 1);
    await flush(); await r.pump();
    expect(r.h.historyTick.peek()).toBe(beforeTick + 1);
    expect(r.t.calls("status").length).toBe(beforeStatus + 2);
  } finally { r.data.stop(); }
});
it("busy explicit retry promise waits for its one coalesced follow-up read", async () => {
  const r = await rig(); r.state.available = false; r.live(); r.end(); await flush();
  const first = r.t.calls("status").at(-1)!; expect(first).toBeDefined();
  let done = false; const retry = r.h.retryHandoff().then(() => { done = true; });
  const out = r.db.answer(first); r.db.answered.add(first.id); if (out.ok) r.t.ok(first.id, out.result); await flush();
  expect(r.t.calls("status").length).toBe(2); expect(done).toBe(false);
  await r.pump(); await retry; expect(done).toBe(true);
  expect(r.bodyReads()).toHaveLength(0);
  expect(r.t.calls().filter(call => !r.db.answered.has(call.id))).toHaveLength(0);
  r.data.stop();
});
it("paused retry reports an honest disabled reason and performs no read", async () => {
  const r = await rig(); r.live(); r.end(); await r.pump(); r.h.pause(); const before = r.t.calls().length;
  await r.h.retryHandoff(); expect(r.t.calls()).toHaveLength(before);
  expect(r.h.handoffRetryState.value).toMatchObject({ phase: "unavailable", reason: "paused", canRetry: false }); r.data.stop();
});
it("initial and no-pending are idle and cannot retry", async () => {
  const r = await rig(); expect(r.h.handoffRetryState.value).toEqual({ phase: "idle", canRetry: false });
  const before = r.t.calls("status").length; await r.h.retryHandoff();
  expect(r.h.handoffRetryState.value).toMatchObject({ phase: "idle", reason: "no-pending", canRetry: false });
  expect(r.t.calls("status")).toHaveLength(before); r.data.stop();
});
it("lookup failure is explicit and retry performs only one new readonly lookup", async () => {
  const r = await rig(); r.live(); r.end(); await flush();
  const held = r.t.calls("status").at(-1)!; r.db.answered.add(held.id); r.t.ownerError(held.id, "unavailable", "synthetic"); await flush();
  expect(r.h.handoffRetryState.value).toEqual({ phase: "failed", reason: "lookup-failed", canRetry: true });
  const retry = r.h.retryHandoff(); await r.pump(); await retry;
  expect(r.t.calls("status")).toHaveLength(2);
  expect(r.receipt()).toMatchObject({scope:r.h.handoffScope(),attemptId:'attempt',nodeIds:['tool','answer']});
  expect(r.h.handoff.peek()[0]?.text).toBe('whole live block');expect(r.h.handoff.peek()[0]?.readyAttempt).toBeUndefined();
  expect(r.h.handoffRetryState.value).toEqual({phase:'unavailable',reason:'unresolved',canRetry:true});
  expect(r.bodyReads()).toHaveLength(0);r.data.stop();
});
it("hints stop at eight starts; explicit retry resets only the existing budget", async () => {
  const r = await rig(); r.state.available = false; r.live(); r.end(); await r.pump();
  for (let n = 0; n < 20; n++) { r.t.push({ t: "changed", thread_ids: ["a"], list: false }); await r.pump(); }
  expect(r.t.calls("status")).toHaveLength(8); expect(r.h.handoffRetryState.value).toEqual({ phase: "unavailable", reason: "budget-exhausted", canRetry: true });
  const retry = r.h.retryHandoff(); await r.pump(); await retry;
  expect(r.t.calls("status")).toHaveLength(9); expect(r.h.handoffRetryState.value).toMatchObject({ phase: "unavailable", reason: "unresolved" }); r.data.stop();
});
it.each(["closed", "owner-unavailable"] as const)("%s denies retry without silent read action", async reason => {
  const r = await rig(); void r.h.handoffRetryState.value;
  if (reason === "closed") r.h.close(); else r.t.push({ t: "owner", event: "unreachable", owner: { state: "unreachable" } });
  const before = r.t.calls().length; await r.h.retryHandoff();
  expect(r.h.handoffRetryState.value).toEqual({ phase: "unavailable", reason, canRetry: false }); expect(r.t.calls()).toHaveLength(before); r.data.stop();
});
it("reading subscriber invalidation prevents sending the obsolete read", async () => {
  const r = await rig(); r.state.available = false; r.live(); r.end(); await r.pump();
  const before = r.t.calls("status").length; const { effect } = await import("@preact/signals-core");
  const stop = effect(() => { if (r.h.handoffRetryState.value.phase === "reading") r.h.pause(); });
  await r.h.retryHandoff(); expect(r.t.calls("status")).toHaveLength(before);
  expect(r.h.handoffRetryState.value).toMatchObject({ reason: "paused", canRetry: false }); stop(); r.data.stop();
});
