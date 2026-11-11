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
  const state = { attempt: "attempt", available: true, truncated: false, partial: false, deferred: false, unknown: false, missing: false, error: false, changing: false, nonterminal: false, wrongid: false, empty: false, hold: false };
  const original = db.answer.bind(db); let reads = 0;
  db.answer = call => {
    if (call.command === "status") return { ok: true, result: { items: state.available ? [{ kind: "attempt", id: state.wrongid ? "other" : state.attempt, attempt_id: state.attempt, turn_id: "turn", thread_id: "a", state: state.nonterminal ? "inflight" : "completed", response_nodes: state.empty ? [] : [{ node_id: "answer", ordinal: 0, kind: "message" }, { node_id: "tool", ordinal: 1, kind: "function_call" }, { node_id: "answer", ordinal: 2, kind: "message" }], response_nodes_truncated: state.truncated }] : [] } };
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
  const live = () => { t.push({ t: "live", thread_id: "a", attempt_id: state.attempt, gap: false, deltas: [{ offset: 0, reasoning: false, text: "whole live block" }] }); frames.splice(0).forEach(f => f()); };
  const end = () => t.push({ t: "live_end", thread_id: "a" });
  return { t, db, data, h, state, live, end, pump: () => settle(t, db) };
}
for (const mode of ["truncated", "partial", "deferred", "unknown", "missing", "error", "changing"] as const) it(`terminal persisted refs stage fallback before ${mode} readback and spend no typed read budget`, async () => {
  const r = await rig(); r.state[mode] = true; r.live(); r.end(); await r.pump();
  const record = r.h.handoff.value[0]!;
  expect(record.terminalPersisted).toMatchObject({ attemptId: "attempt", terminalState: "completed" });
  expect(record.terminalPersisted!.nodeIds).toEqual(["answer", "tool", "answer"]);
  expect(record.text).toBe("whole live block"); expect(record.readyAttempt).toBeUndefined();
  expect(r.t.calls("history.window")).toHaveLength(0); expect(r.t.calls("history.get")).toHaveLength(0); r.data.stop();
});
for (const mode of ["empty", "nonterminal", "wrongid"] as const) it(`does not claim persisted terminal fallback for ${mode}`, async () => {
  const r = await rig(); r.state[mode] = true; r.live(); r.end(); await r.pump();
  expect(r.h.handoff.value[0]?.terminalPersisted).toBeUndefined(); r.data.stop();
});

it('ninth new receipt reports scoped capacity but an existing receipt can still be reused', async()=>{
 const r=await rig();
 try {
 for(let i=1;i<=8;i++){
 r.state.attempt=`attempt-${i}`;r.live();r.end();await r.pump();await Promise.all([r.h.retryHandoff(),r.pump()]);
 expect(r.h.handoff.peek()[0]?.terminalPersisted).toBeDefined();
 expect(r.h.transferHandoff(r.state.attempt,(_record,release)=>{release('end');return true;})).toBe(true);
 }
 r.state.attempt='attempt-9';r.live();r.end();await r.pump();await Promise.all([r.h.retryHandoff(),r.pump()]);
 expect(r.h.handoffRetryState.peek()).toEqual({phase:'unavailable',reason:'receipt_capacity',canRetry:false});
 expect(r.h.handoff.peek()[0]?.text).toBe('whole live block');expect(r.h.handoff.peek()[0]?.terminalPersisted).toBeUndefined();
 // Existing exact receipt is reusable without allocating a ninth proof.
 r.state.attempt='attempt-1';r.live();r.end();await r.pump();await Promise.all([r.h.retryHandoff(),r.pump()]);
 expect(r.h.handoff.peek().find(x=>x.attemptId==='attempt-1')?.terminalPersisted).toBeDefined();
 r.h.pause();await r.h.retryHandoff();expect(r.h.handoffRetryState.peek()).toMatchObject({reason:'paused',canRetry:false});
 }finally{r.data.stop();}
});
