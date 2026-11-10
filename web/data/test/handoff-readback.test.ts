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
  const state = { available: true, truncated: false, partial: false, deferred: false, unknown: false, missing: false, error: false, changing: false, empty: false, hold: false };
  const original = db.answer.bind(db); let reads = 0;
  db.answer = call => {
    if (call.command === "status") return { ok: true, result: { items: state.available ? [{ kind: "attempt", id: "attempt", attempt_id: "attempt", turn_id: "turn", thread_id: "a", state: "completed", response_nodes: state.empty ? [] : [{ node_id: "answer", ordinal: 0, kind: "message" }, { node_id: "tool", ordinal: 1, kind: "function_call" }, { node_id: "answer", ordinal: 2, kind: "message" }], response_nodes_truncated: state.truncated }] : [] } };
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
it("stages ALL original refs with duplicate identity preserved and nodes in saved order, without replacing stream text", async () => {
  const r = await rig(); r.live(); r.end(); await r.pump();
  const record = r.h.handoff.value[0]!;
  expect(record.text).toBe("whole live block"); expect(record.proof).toBeUndefined();
  expect(record.readyAttempt?.refs.map(ref => ref.nodeId)).toEqual(["answer", "tool", "answer"]);
  expect(record.readyAttempt?.nodes.map(node => node.node_id)).toEqual(["tool", "answer"]);
  expect(r.t.calls("history.get")).toHaveLength(0);
  expect(r.t.calls("history.window").every(call => (call.args as { items?: boolean }).items === true)).toBe(true); r.data.stop();
});
for (const mode of ["truncated", "partial", "deferred", "unknown", "missing", "error", "changing", "empty"] as const) it(`retains WHOLE original live block and does not stage partial attempt under ${mode}`, async () => {
  const r = await rig(); r.state[mode] = true; r.live(); r.end(); await r.pump();
  expect(r.h.handoff.value[0]?.text).toBe("whole live block"); expect(r.h.handoff.value[0]?.readyAttempt).toBeUndefined(); expect(r.t.calls("history.get")).toHaveLength(0); r.data.stop();
});
it("keeps the complete overlay during held typed-window lookup then stages once after all nodes arrive", async () => {
  const r = await rig(); r.live(); r.end();
  // Resolve work/detail operations but deliberately hold authoritative item readback.
  for (let n = 0; n < 10; n++) {
    for (const call of r.t.calls().filter(call => !r.db.answered.has(call.id) && call.command !== "history.window")) { const out = r.db.answer(call); r.db.answered.add(call.id); if (out.ok) r.t.ok(call.id, out.result); else r.t.ownerError(call.id, out.code, out.message); }
    await flush();
  }
  expect(r.t.calls("history.window").some(call => !r.db.answered.has(call.id))).toBe(true);
  expect(r.h.handoff.value[0]?.text).toBe("whole live block"); expect(r.h.handoff.value[0]?.readyAttempt).toBeUndefined();
  await r.pump(); expect(r.h.handoff.value[0]?.readyAttempt?.nodes).toHaveLength(2); r.data.stop();
});
for (const action of ["cancel", "close", "pause", "ownerABA"] as const) it(`rejects original lookup continuation after ${action}`, async () => {
  const r = await rig(); r.live(); r.end();
  if (action === "cancel") r.h.cancelReads(); else if (action === "close") r.h.close(); else if (action === "pause") r.h.pause(); else { r.t.push({ t: "owner", event: "restarted", owner: connected }); r.t.push({ t: "owner", event: "restarted", owner: connected }); }
  await r.pump(); expect(r.h.handoff.value.some(record => record.readyAttempt)).toBe(false); r.data.stop();
});
it("hints cannot refill eight starts and explicit retry preserves original attempt", async () => {
  const r = await rig(); r.state.available = false; r.live(); r.end(); await r.pump();
  for (let n = 0; n < 20; n++) { r.t.push({ t: "changed", thread_ids: ["a"], list: false }); await r.pump(); }
  expect(r.t.calls("status")).toHaveLength(8);
  r.state.available = true; const retry = r.h.retryHandoff(); await r.pump(); await retry;
  expect(r.h.handoff.value[0]?.readyAttempt?.attemptId).toBe("attempt"); r.data.stop();
});
