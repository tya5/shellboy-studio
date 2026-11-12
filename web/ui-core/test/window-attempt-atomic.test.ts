import { ShellboyData } from "../../data/src/store";
import { expect, it } from "vitest";
import { ConversationWindow } from "../src/window";
import type { HandoffRecord, AttemptReadyProof } from "../../data/src/handoff";
import type { HistoryItem } from "../../data/src";
import { FakeOwnerDb, FakeTransport, connectedWithHistory, settle, flush } from "../../data/test/harness";
const nodes: HistoryItem[] = [
  { node_id: "tool", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "tc", execution_ids: ["exec"] }] },
  { node_id: "answer", kind: "assistant_response", selection: { ordinal: 1 }, items: [{ kind: "text", item_identity: "text", text: "saved", text_complete: true }] },
];
async function rig(items = nodes) {
  const w = new ConversationWindow({ read: async () => ({ ok: true, value: { thread_id: "thread", revision: 7, total: 2, items } }) }); await flush();
  const proof: AttemptReadyProof = { scope: '["owner","thread",1]', attemptId: "attempt", turnId: "turn", revision: 7, total: 2, refs: [{ nodeId: "answer" }, { nodeId: "tool" }, { nodeId: "answer" }], nodes };
  const record: HandoffRecord = { key: "live-record", attemptId: "attempt", status: "confirming", text: "whole live block", incomplete: false, readyAttempt: proof };
  return { w, record, proof };
}
it("all-ref retirement and saved-order sequence publish once in the SAME observed snapshot", async () => {
  const { w, record, proof } = await rig(); const trace: { saved: string[]; retired: string[] }[] = [];
  const stop = w.acceptedView.subscribe(ref => { expect(w.acceptedView.isCurrent(ref)).toBe(true); trace.push({ saved: ref.rows.map(row => row.node_id!), retired: ref.retiredAttempts?.map(item => item.attemptId) ?? [] }); });
  let releases = 0; expect(w.acceptHandoff(record, proof.scope, () => { releases++; expect(w.acceptedView.peek().retiredAttempts).toHaveLength(1); })).toBe(true);
  expect(trace).toEqual([{ saved: ["tool", "answer"], retired: ["attempt"] }]); expect(releases).toBe(1);
  expect(w.acceptedView.peek().retiredAttempts![0]!.nodeIds).toEqual(["answer", "tool", "answer"]);
  stop(); w.dispose();
});
for (const mode of ["missing", "partial", "deferred", "unavailable", "revision", "scope", "revoke"] as const) it(`keeps complete live block and independent saved rows under ${mode}`, async () => {
  const items = structuredClone(nodes);
  if (mode === "missing") items.pop();
  if (mode === "partial") items[1]!.items = [{ kind: "text", item_identity: "text", text: "prefix", text_complete: false }];
  if (mode === "deferred") { items[1]!.items = null; items[1]!.items_unavailable_reason = "response_budget"; }
  if (mode === "unavailable") items[1]!.items = [{ kind: "unavailable", item_identity: "unknown", reason: "opaque" }];
  const { w, record, proof } = await rig(items);
  if (["missing", "partial", "deferred", "unavailable"].includes(mode)) (proof as { nodes: readonly HistoryItem[] }).nodes = items;
  const before = w.acceptedView.peek();
  if (mode === "revision") (proof as { revision: number }).revision = 6;
  if (mode === "revoke") w.acceptedView.revoke();
  let released = false; expect(w.acceptHandoff(record, mode === "scope" ? "other" : proof.scope, () => { released = true; })).toBe(false);
  expect(w.acceptedView.peek()).toBe(before); expect(before.rows).toHaveLength(items.length); expect(released).toBe(false); expect(record.text).toBe("whole live block"); w.dispose();
});
it("notification reentry stops old release and never retires another attempt/turn", async () => {
  const { w, record, proof } = await rig(); let nested = false, releases = 0;
  w.acceptedView.subscribe(() => { if (!nested) { nested = true; w.layoutChanged(); } });
  expect(w.acceptHandoff(record, proof.scope, () => { releases++; })).toBe(false);
  expect(releases).toBe(0); expect(w.acceptedView.peek().retiredAttempts!.every(item => item.turnId === "turn" && item.attemptId === "attempt")).toBe(true); w.dispose();
});
it("actual terminal persistence -> original O capture -> same Window saved snapshot -> synchronous end is one observed transition", async () => {
  const t = new FakeTransport(), db = new FakeOwnerDb(), ticks: (() => void)[] = []; let id = 0;
  const data = new ShellboyData({ transport: t, newId: () => `joined-${++id}`, schedule: fn => ticks.push(fn) });
  const base = db.answer.bind(db);
  db.answer = call => call.command === "status" ? { ok: true, result: { items: [{ kind: "attempt", id: "attempt", attempt_id: "attempt", turn_id: "turn", thread_id: "thread", state: "completed", response_nodes_truncated: false, response_nodes: [{ node_id: "answer", ordinal: 0, kind: "message" }, { node_id: "tool", ordinal: 1, kind: "function_call" }] }] } }
    : call.command === "history.window" ? { ok: true, result: { thread_id: "thread", revision: 7, total: 2, items: nodes } } : base(call);
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: connectedWithHistory }); await settle(t, db);
  const h = data.openThread("thread"); await settle(t, db);
  const w = new ConversationWindow({ read: (args, cancel) => h.readWindow(args, cancel) }); await settle(t, db);
  t.push({ t: "live", thread_id: "thread", attempt_id: "attempt", gap: false, deltas: [{ offset: 0, reasoning: false, text: "whole live block" }] }); ticks.splice(0).forEach(fn => fn());
  t.push({ t: "live_end", thread_id: "thread" }); await settle(t, db);
  const staged = h.handoff.peek()[0]!; expect(staged.text).toBe("whole live block");
  expect(staged.readyAttempt).toBeUndefined();
  expect(staged.terminalPersisted).toMatchObject({ scope: h.handoffScope(), attemptId: "attempt", nodeIds: ["answer", "tool"] });
  const before = w.acceptedView.peek();
  const trace: { rows: string[]; retired: string[]; overlay: string }[] = [];
  w.acceptedView.subscribe(ref => {
    expect(w.acceptedView.isCurrent(ref)).toBe(true);
    expect(ref.rows).toEqual(before.rows);
    trace.push({ rows: ref.rows.map(row => row.node_id!), retired: (ref.terminalPersistedAttempts ?? []).map(r => r.attemptId), overlay: h.handoff.peek()[0]?.text ?? "" });
  });
  let ends = 0;
  const transfer = () => h.transferHandoff("attempt", (record, release) => w.acceptHandoff(record, h.handoffScope(), reason => {
    expect(reason).toBe("end"); ends++; release(reason);
  }));
  expect(transfer()).toBe(true);
  expect(trace).toEqual([{ rows: ["tool", "answer"], retired: ["attempt"], overlay: "whole live block" }]);
  expect(h.handoff.peek()).toHaveLength(0);
  expect(w.acceptedView.peek().terminalPersistedAttempts![0]!.scope).toBe(h.handoffScope());
  expect(w.acceptedView.peek().retiredAttempts ?? []).toEqual([]);
  expect(transfer()).toBe(false); expect(ends).toBe(1); expect(trace).toHaveLength(1);
  expect(t.calls("history.get")).toHaveLength(0); w.dispose(); h.close(); data.stop();
});
it("a revoked Window capability cannot re-publish old retirement metadata on a later ordinary generation", async () => {
  const { w, record, proof } = await rig(); expect(w.acceptHandoff(record, proof.scope, () => {})).toBe(true);
  w.acceptedView.revoke(); w.layoutChanged(); expect(w.acceptedView.peek().retiredAttempts).toEqual([]); w.dispose();
});
it("materializes already-qualified all-ref nodes and retirement together without requiring another changed hint/read", async () => {
  const initial: HistoryItem = { node_id: "user", kind: "user", items: [], selection: { ordinal: 0 } };
  let reads = 0;
  const w = new ConversationWindow({ read: async () => { reads++; return { ok: true, value: { thread_id: "thread", revision: 7, total: 1, items: [initial] } }; } }); await flush();
  const proof: AttemptReadyProof = { scope: "scope", attemptId: "attempt", turnId: "turn", revision: 7, total: 3,
    refs: [{ nodeId: "answer" }, { nodeId: "tool" }], nodes: nodes.map((node, i) => ({ ...node, selection: { ordinal: i + 1 } })) };
  const record: HandoffRecord = { key: "original", attemptId: "attempt", text: "whole live", incomplete: false, status: "confirming", readyAttempt: proof };
  const frames: { ids: string[]; total: number; retired: number }[] = [];
  w.acceptedView.subscribe(ref => frames.push({ ids: ref.rows.map(row => row.node_id!), total: ref.total, retired: ref.retiredAttempts?.length ?? 0 }));
  let releases = 0; expect(w.acceptHandoff(record, "scope", () => { releases++; })).toBe(true);
  expect(frames).toEqual([{ ids: ["user", "tool", "answer"], total: 3, retired: 1 }]);
  expect(w.rangeItems().map(row => row.node_id)).toEqual(["user", "tool", "answer"]); expect(w.total).toBe(3); expect(reads).toBe(1); expect(releases).toBe(1); w.dispose();
});
