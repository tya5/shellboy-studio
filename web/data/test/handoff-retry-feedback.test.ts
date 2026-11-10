import { expect, it } from "vitest";
import { ShellboyData } from "../src/store";
import { FakeOwnerDb, FakeTransport, connected, settle, flush } from "./harness";
const baseNodes = [
  { node_id: "tool", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["exec"] }] },
  { node_id: "answer", kind: "assistant_response", selection: { ordinal: 1 }, items: [{ kind: "text", item_identity: "text", text: "saved", text_complete: true }] },
];
async function rig() {
  const t = new FakeTransport(), db = new FakeOwnerDb(), frames: (() => void)[] = []; let n = 0;
  const data = new ShellboyData({ transport: t, newId: () => `atomic-${++n}`, schedule: cb => frames.push(cb) });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: connected }); await settle(t, db);
  const h = data.openThread("a"); await settle(t, db);
  const state = { available: true, truncated: false, partial: false, deferred: false, unknown: false, missing: false, error: false, changing: false, nonterminal: false, wrongid: false, empty: false, hold: false };
  const original = db.answer.bind(db); let reads = 0;
  db.answer = call => {
    if (call.command === "status") return { ok: true, result: { items: state.available ? [{ kind: "attempt", id: state.wrongid ? "other" : "attempt", attempt_id: "attempt", turn_id: "turn", thread_id: "a", state: state.nonterminal ? "inflight" : "completed", response_nodes: state.empty ? [] : [{ node_id: "answer", ordinal: 0, kind: "message" }, { node_id: "tool", ordinal: 1, kind: "function_call" }, { node_id: "answer", ordinal: 2, kind: "message" }], response_nodes_truncated: state.truncated }] : [] } };
    if (call.command === "history.window") {
      if (state.error) return { ok: false, code: "not_found", message: "synthetic" };
      const items: unknown[] = structuredClone(baseNodes);
      if (state.partial) (items[1] as { items: unknown }).items = [{ kind: "text", item_identity: "text", text: "prefix", text_complete: false }];
      if (state.deferred) { (items[1] as { items: unknown }).items = null; (items[1] as object & { items_unavailable_reason: string }).items_unavailable_reason = "response_budget"; }
      if (state.unknown) (items[1] as { items: unknown }).items = [{ kind: "unavailable", item_identity: "missing", reason: "opaque" }];
      if (state.missing) items.pop();
      if (state.changing) { if (++reads === 1) items.splice(1); else items.splice(0, 1); }
      return { ok: true, result: { thread_id: "a", revision: state.changing && reads > 1 ? 8 : 7, total: 2, items } };
    }
    return original(call);
  };
  const live = () => { t.push({ t: "live", thread_id: "a", attempt_id: "attempt", gap: false, deltas: [{ offset: 0, reasoning: false, text: "whole live block" }] }); frames.splice(0).forEach(f => f()); };
  const end = () => t.push({ t: "live_end", thread_id: "a" });
  return { t, db, data, h, state, live, end, pump: () => settle(t, db) };
}
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
it("busy explicit retry promise waits for its one coalesced follow-up read", async () => {
  const r = await rig(); r.state.available = false; r.live(); r.end(); await flush();
  const first = r.t.calls("status").at(-1)!; expect(first).toBeDefined();
  let done = false; const retry = r.h.retryHandoff().then(() => { done = true; });
  const out = r.db.answer(first); r.db.answered.add(first.id); if (out.ok) r.t.ok(first.id, out.result); await flush();
  expect(r.t.calls("status").length).toBe(2); expect(done).toBe(false);
  await r.pump(); await retry; expect(done).toBe(true); r.data.stop();
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
  expect(r.t.calls("status")).toHaveLength(2); expect(r.h.handoffRetryState.value).toEqual({ phase: "idle", canRetry: false }); r.data.stop();
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
