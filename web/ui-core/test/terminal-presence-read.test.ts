import { ConversationWindow } from "../src/window";
import type { OwnedTerminalReadLease } from "../../data/src/terminal-read";
import { expect, it } from "vitest";
import { ShellboyData } from "../../data/src/store";
import { FakeOwnerDb, FakeTransport, connected, settle, flush } from "../../data/test/harness";
const baseNodes = [
  { node_id: "tool", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["exec"] }] },
  { node_id: "answer", kind: "assistant_response", selection: { ordinal: 1 }, items: [{ kind: "text", item_identity: "text", text: "saved", text_complete: true }] },
];
async function rig(windowCap = true) {
  const t = new FakeTransport(), db = new FakeOwnerDb(), frames: (() => void)[] = []; let n = 0;
  const data = new ShellboyData({ transport: t, newId: () => `atomic-${++n}`, schedule: cb => frames.push(cb) });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: { state: "connected", info: { protocol_version: 5, instance_id: "i1", capabilities: windowCap ? ["history.window"] : [] } } }); await settle(t, db);
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
async function target() {
 const r = await rig(); const token = r.h.captureReadQualification()!;
 const w = new ConversationWindow({ read: async () => ({ ok: true, value: { thread_id: "a", revision: 7, total: 1,
 items: [{ node_id: "tool", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["exec"] }] }] } }) }); await flush();
 r.live(); r.end(); await r.pump(); const record = r.h.handoff.peek()[0]!;
 expect(r.h.transferHandoff("attempt", (captured, end) => w.acceptHandoff(captured, r.h.handoffScope(), end))).toBe(true);
 return { ...r, w, token, receipt: record.terminalPersisted! };
}
it("actual status/Store/O/Window publishes honest same-ref missing-answer presence, one held canonical read then available rows", async () => {
 const r = await target(); const initial = r.w.acceptedView.peek();
 expect(r.h.handoff.peek()).toHaveLength(0); expect(initial.rows.map(row => row.node_id)).toEqual(["tool"]);
 expect(initial.terminalPresence?.[0]).toMatchObject({ phase: "pending", answerAvailability: "unknown" });
 const lease = r.w.prepareTerminalRead(r.h, r.token, r.receipt) as OwnedTerminalReadLease;
 expect("state" in lease).toBe(true); await flush();
 expect(r.w.prepareTerminalRead(r.h, r.token, r.receipt)).toBe(lease);
 expect(r.t.calls("history.window")).toHaveLength(1);
 expect(r.w.acceptedView.peek().terminalPresence?.[0]?.phase).toBe("reading");
 await r.pump();
 expect(r.w.acceptedView.peek().rows.map(row => row.node_id)).toEqual(["tool", "answer"]);
 expect(r.w.acceptedView.peek().terminalPresence ?? []).toEqual([]);
 expect(r.t.calls("history.window")).toHaveLength(1); expect(r.t.calls("history.get")).toHaveLength(0);
 r.w.dispose(); r.data.stop();
});
it.each(["partial", "deferred", "unknown", "missing", "error"] as const)("canonical %s preserves rows and an honest settled reason", async mode => {
 const r = await target(); r.state[mode] = true; r.w.prepareTerminalRead(r.h, r.token, r.receipt); await r.pump();
 const ref = r.w.acceptedView.peek(); expect(ref.rows.some(row => row.node_id === "tool")).toBe(true);
 expect(ref.terminalPresence?.[0]?.phase).toBe("settled"); expect(ref.terminalPresence?.[0]?.answerAvailability).toBe("unknown");
 expect(r.t.calls("history.window")).toHaveLength(1); r.w.dispose(); r.data.stop();
});
it("revoked target receives no result or stale reason publication", async () => {
 const r = await target(); r.w.prepareTerminalRead(r.h, r.token, r.receipt); await flush();
 const old = r.w.acceptedView.peek(); let notifications = 0; const stop = r.w.acceptedView.subscribe(() => notifications++);
 r.w.acceptedView.revoke(); await r.pump();
 expect(r.w.acceptedView.peek()).toBe(old); expect(notifications).toBe(0); stop(); r.w.dispose(); r.data.stop();
});
it("cancel then prepare cannot trigger a second automatic canonical request", async () => {
 const r = await target(); const lease = r.w.prepareTerminalRead(r.h, r.token, r.receipt) as OwnedTerminalReadLease;
 r.w.cancelTerminalRead(lease.ticket.id); await r.pump(); const count = r.t.calls("history.window").length;
 r.w.prepareTerminalRead(r.h, r.token, r.receipt); await r.pump(); expect(r.t.calls("history.window")).toHaveLength(count);
 r.w.dispose(); r.data.stop();
});
it("no-window public capability has presence-only unsupported and zero canonical RPC", async () => {
 const r = await rig(false); const { LegacyAcceptedPresentation } = await import("../src/legacy-presentation");
 r.live(); r.end(); await r.pump(); const p = new LegacyAcceptedPresentation(r.h);
 expect(p.sync()).toBe(true); expect(p.acceptedView.peek().terminalPresence?.[0]).toMatchObject({ phase: "settled", reason: "unsupported", answerAvailability: "unknown" });
 expect(r.t.calls("history.window")).toHaveLength(0); expect(r.h.handoff.peek()).toHaveLength(0); p.dispose(); r.data.stop();
});
it("wrong original qualification cannot admit or write terminal presence", async () => {
 const r = await target(); const before = r.w.acceptedView.peek(); r.h.cancelReads();
 const count = r.t.calls("history.window").length;
 expect(r.w.prepareTerminalRead(r.h, r.token, r.receipt)).toEqual({ phase: "unavailable", reason: "cancelled" });
 expect(r.w.acceptedView.peek()).toBe(before); expect(r.t.calls("history.window")).toHaveLength(count); r.w.dispose(); r.data.stop();
});
it("data stop invalidates held canonical lease before callback and publishes no old target result", async () => {
 const r = await target(); const lease = r.w.prepareTerminalRead(r.h, r.token, r.receipt) as OwnedTerminalReadLease; await flush();
 const before = r.w.acceptedView.peek(); r.data.stop(); await flush();
 expect(r.w.acceptedView.peek()).toBe(before); expect(lease.state.peek().phase).toBe("unavailable"); r.w.dispose();
});
it.each(["unavailable", "partial", "fewer"] as const)("same-revision %s replacement cannot downgrade an already available saved node", async mode => {
 const r = await target(); const before = r.w.acceptedView.peek(); const saved = before.rows[0]!;
 const original = r.db.answer.bind(r.db);
 r.db.answer = call => {
   const answer = original(call);
   if (call.command === "history.window" && answer.ok) {
     const page = answer.result as { items: { node_id: string; items: unknown[] }[] };
     page.items[0]!.items = mode === "unavailable" ? [{ kind: "unavailable", item_identity: "call", reason: "budget" }]
       : mode === "partial" ? [{ kind: "text", item_identity: "partial", text: "prefix", text_complete: false }] : [];
   }
   return answer;
 };
 r.w.prepareTerminalRead(r.h, r.token, r.receipt); await r.pump();
 expect(r.w.acceptedView.peek().rows.find(row => row.node_id === saved.node_id)).toEqual(saved);
 expect(r.w.acceptedView.peek().terminalPresence?.[0]).toMatchObject({ phase: "settled", answerAvailability: "unknown" });
 r.w.dispose(); r.data.stop();
});
it("synchronous request notification revoking the original token cannot publish even an unavailable reason", async () => {
 const r = await target(); const before = r.w.acceptedView.peek(); let writes = 0; const stop = r.w.acceptedView.subscribe(() => writes++);
 const handle = { ...r.h, requestTerminalRead: () => { r.h.cancelReads(); return { phase: "unavailable" as const, reason: "unsupported" as const }; } };
 expect(r.w.prepareTerminalRead(handle, r.token, r.receipt)).toEqual({ phase: "unavailable", reason: "cancelled" });
 expect(r.w.acceptedView.peek()).toBe(before); expect(writes).toBe(0); stop(); r.w.dispose(); r.data.stop();
});
it("Window binding captures once and shares original authority with same-handle summary registration", async () => {
 const r = await target(); let captures = 0; const original = r.h.captureReadQualification;
 const handle = { ...r.h, captureReadQualification: () => { captures++; return original(); } };
 expect(r.w.bindTerminalHandle(handle)).toBe(true); expect(r.w.bindTerminalHandle(handle)).toBe(true); expect(captures).toBe(1);
 const ref = r.w.acceptedView.peek();
 r.w.beginSummaryTransition(handle, ref, "tool", 0);
 expect(captures).toBe(1); expect(r.w.isTerminalHandleCurrent(handle)).toBe(true);
 const lease = r.w.prepareBoundTerminalRead(r.receipt); expect("state" in lease).toBe(true); await r.pump();
 expect(r.w.acceptedView.peek().rows.map(row => row.node_id)).toEqual(["tool", "answer"]); expect(captures).toBe(1);
 r.w.dispose(); expect(r.w.isTerminalHandleCurrent(handle)).toBe(false); expect(r.h.isReadQualificationCurrent(r.token)).toBe(false); r.data.stop();
});
it("invalidated binding cannot recapture on repeated bind or admit a lease", async () => {
 const r = await target(); let captures = 0; const original = r.h.captureReadQualification;
 const handle = { ...r.h, captureReadQualification: () => { captures++; return original(); } };
 expect(r.w.bindTerminalHandle(handle)).toBe(true); handle.cancelReads();
 expect(r.w.bindTerminalHandle(handle)).toBe(false); expect(r.w.prepareBoundTerminalRead(r.receipt)).toEqual({ phase: "unavailable", reason: "cancelled" });
 expect(captures).toBe(1); r.w.dispose(); r.data.stop();
});
it("a different handle cannot replace an owned Window binding", async () => {
 const r = await target(); expect(r.w.bindTerminalHandle(r.h)).toBe(true); const other = r.data.openThread("b");
 expect(r.w.bindTerminalHandle(other)).toBe(false); expect(r.w.isTerminalHandleCurrent(r.h)).toBe(true);
 other.close(); r.h.close(); expect(r.w.isTerminalHandleCurrent(r.h)).toBe(false); r.w.dispose(); r.data.stop();
});
it("bound terminal then summary shares one token and owner change denies both paths", async () => {
 const r = await target(); let captures = 0; const capture = r.h.captureReadQualification;
 const handle = { ...r.h, captureReadQualification: () => { captures++; return capture(); } };
 expect(r.w.bindTerminalHandle(handle)).toBe(true); r.w.prepareBoundTerminalRead(r.receipt); await r.pump();
 const ref = r.w.acceptedView.peek(), id = r.w.beginSummaryTransition(handle, ref, "tool", 0);
 expect(id).toBeDefined(); expect(captures).toBe(1);
 r.t.push({ t: "owner", event: "restarted", owner: { state: "connected", info: { protocol_version: 5, instance_id: "other", capabilities: ["history.window"] } } });
 expect(r.w.beginSummaryTransition(handle, ref, "tool", 0)).toBeUndefined();
 expect(r.w.prepareBoundTerminalRead(r.receipt)).toEqual({ phase: "unavailable", reason: "cancelled" });
 expect(captures).toBe(1); r.w.dispose(); r.data.stop();
});
it("existing unbound summary remains valid when first binding is denied", async () => {
 const r = await target(); const ref = r.w.acceptedView.peek();
 const id = r.w.beginSummaryTransition(r.h, ref, "tool", 0); expect(id).toBeDefined();
 expect(r.w.bindTerminalHandle(r.h)).toBe(false); expect(r.w.peekSummaryTransitionId()).toBe(id);
 expect(r.w.beginSummaryTransition(r.h, ref, "tool", 0)).toBe(id);
 r.w.dispose(); r.data.stop();
});
it("dispose cancels a bound held lease without closing its external handle", async () => {
 const r = await target(); expect(r.w.bindTerminalHandle(r.h)).toBe(true);
 const lease = r.w.prepareBoundTerminalRead(r.receipt) as OwnedTerminalReadLease; await flush();
 r.w.dispose(); expect(lease.state.peek()).toEqual({ phase: "unavailable", reason: "cancelled" });
 expect(r.w.prepareBoundTerminalRead(r.receipt)).toEqual({ phase: "unavailable", reason: "cancelled" });
 expect(r.h.captureReadQualification()).toBeDefined(); r.data.stop();
});
