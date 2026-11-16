import {selectedReadyRefs,syntheticPresentation,CANONICAL_ATTEMPT_ID,withCanonicalAttemptProvenance,declaredAttemptIdentity} from '../../data/test/work-fixture';
import { ConversationWindow } from "../src/window";
import type { OwnedTerminalReadLease } from "../../data/src/terminal-read";
import type { HistoryItem } from "../../data/src/protocol";
import { assistantOwnership } from "../src/assistant-ownership";
import { expect, it } from "vitest";
import type {ThreadHandle,ThreadReadQualification} from "../../data/src/store";
import type {TerminalPersistedProof} from "../../data/src/handoff";
import { ShellboyData } from "../../data/src/store";
import { FakeOwnerDb, FakeTransport, connected, settle, flush } from "../../data/test/harness";
import { observeDeclaredCuts, type DeclaredPlanCut } from "./publication-contract";
import { declaredToolAnswerCut } from "./declared-attempt-cuts";
import type { TerminalPresence } from "../src/terminal-presence";
import {ownedHistory} from '../../data/test/owned-history';
const baseNodes: HistoryItem[] = withCanonicalAttemptProvenance([
  { node_id: "tool", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["exec"] }] },
  { node_id: "answer", kind: "assistant_response", selection: { ordinal: 1 }, items: [{ kind: "text", item_identity: "text", text: "saved", text_complete: true }] },
]);
async function rig(windowCap = true) {
  const t = new FakeTransport(), db = new FakeOwnerDb(), frames: (() => void)[] = []; let n = 0;
  const data = new ShellboyData({ transport: t, newId: () => `atomic-${++n}`, schedule: cb => frames.push(cb) });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "synthetic", owner: { state: "connected", info: { protocol_version: 5, instance_id: "i1", capabilities: windowCap ? ["history.window"] : [] } } }); await settle(t, db);
  const h = data.openThread("a"); await settle(t, db);
  const state = { selectedRevision: 7, selectedOwnerAvailable: true, available: true, truncated: false, partial: false, deferred: false, unknown: false, missing: false, error: false, changing: false, nonterminal: false, wrongid: false, empty: false, hold: false };
  const original = db.answer.bind(db); let reads = 0;
  db.answer = call => {
    if (call.command === "status") return { ok: true, result: { items: state.available ? [{ kind: "attempt", id: state.wrongid ? "other" : CANONICAL_ATTEMPT_ID, attempt_id: CANONICAL_ATTEMPT_ID, turn_id: "turn", thread_id: "a", state: state.nonterminal ? "inflight" : "completed", response_nodes: state.empty ? [] : baseNodes.filter(node => node.items?.some(item => item.kind === "text")).map(node => ({ node_id: node.node_id, ordinal: node.selection!.ordinal!, kind: node.kind, phase: "final_answer", item_id: null })), response_nodes_truncated: state.truncated }] : [] } };
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
  const live = (text = "") => { t.push({ t: "live", thread_id: "a", attempt_id: CANONICAL_ATTEMPT_ID, gap: false, deltas: [{ offset: 0, reasoning: false, text }] }); frames.splice(0).forEach(f => f()); };
  const end = () => t.push({ t: "live_end", thread_id: "a" });
  return { t, db, data, h, state, live, end, pump: () => settle(t, db) };
}
async function target(wrap:(handle:ThreadHandle)=>ThreadHandle=handle=>handle) {
 const base=await rig();let token:ThreadReadQualification|undefined;
 const capture=base.h.captureReadQualification;
 base.h.captureReadQualification=()=>{token=capture();return token;};
 const r={...base,h:wrap(base.h)};
 const w = new ConversationWindow({ read: async () => ({ ok: true, value: ownedHistory({ thread_id: "a", revision: 7, total: 1,
 items: withCanonicalAttemptProvenance([{ node_id: "tool", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "call", execution_ids: ["exec"] }] }], CANONICAL_ATTEMPT_ID) }) }) }); await flush();
 expect(w.bindTerminalHandle(r.h)).toBe(true);
 const currentReceipt=():TerminalPersistedProof=>{
  const receipt=r.h.handoff.peek().find(record=>record.attemptId===CANONICAL_ATTEMPT_ID)?.terminalPersisted;
  if(!receipt)throw new Error('fixture requires the actual Store-staged receipt');return receipt;
 };
 const cut=(input:Omit<Parameters<typeof declaredToolAnswerCut>[0],'identity'|'emptyOriginal'>)=>declaredToolAnswerCut({...input,identity:declaredAttemptIdentity(CANONICAL_ATTEMPT_ID),emptyOriginal:input.container?undefined:{scope:'a',identity:declaredAttemptIdentity(CANONICAL_ATTEMPT_ID)}});
 const publications=observeDeclaredCuts(w,()=>{
  const receipt=currentReceipt();
  const pending:TerminalPresence={scope:receipt.scope,attemptId:CANONICAL_ATTEMPT_ID,receipt,phase:'pending',reason:'canonical-pending',answerAvailability:'unknown'};
  const inputs=[pending,{...pending,reason:'read-inflight' as const},{...pending,phase:'reading' as const,reason:'read-inflight' as const}];
  const reasons:TerminalPresence['reason'][]=['missing-candidate','body-unavailable','partial-items','read-error','selection-gap','unsupported','capacity','budget-exhausted'];
  const cuts:DeclaredPlanCut[]=inputs.map(presence=>cut({scope:receipt.scope,revision:7,toolIdentity:'call',presence}));
  for(const reason of reasons){const presence:TerminalPresence={...pending,phase:'settled',reason};
   cuts.push(cut({scope:receipt.scope,revision:7,toolIdentity:'call',presence}));
   const answer=r.state.partial?'partial':r.state.deferred?'deferred':r.state.unknown?'opaque':undefined;
   if(answer)cuts.push(cut({scope:receipt.scope,revision:7,toolIdentity:'call',answer,presence}));
  }
  cuts.push(cut({scope:receipt.scope,revision:7,toolIdentity:'call',answer:'saved'}));
  if(r.state.selectedRevision===8)cuts.push(cut({scope:receipt.scope,revision:8,toolIdentity:'call',answer:'saved',container:r.state.selectedOwnerAvailable?receipt.presentationContainer:undefined}));
  return cuts;
 });
 r.live();r.end();await r.pump();
 if(!token)throw new Error('fixture Window binding did not capture qualification');
 const receipt=currentReceipt();
 expect(w.acceptedView.peek().terminalPersistedAttempts).toMatchObject([{scope:r.h.handoffScope(),attemptId:CANONICAL_ATTEMPT_ID,recordKey:`handoff:${CANONICAL_ATTEMPT_ID}`}]);
 expect(r.h.isReceiptObservationCurrent(r.h.handoff.peek()[0]!,receipt)).toBe(true);
 return { ...r, w, token, receipt, publications };
}
it("actual status/Store/O/Window publishes honest same-ref missing-answer presence, one held canonical read then available rows", async () => {
 const r = await target(); const initial = r.w.acceptedView.peek();
 expect(r.h.handoff.peek()).toHaveLength(1);expect(r.h.handoff.peek()[0]?.text).toBe(""); expect(r.receipt.presentationContainer).toBeDefined();
 expect(r.receipt.refs?.map(ref => ref.nodeId)).toEqual(r.receipt.nodeIds);
 expect(initial.rows.map(row => row.node_id)).toEqual(["tool"]);
 expect(initial.terminalPresence?.[0]).toMatchObject({ phase: "pending", answerAvailability: "unknown" });
 const lease = r.w.prepareTerminalRead(r.h, r.token, r.receipt) as OwnedTerminalReadLease;
 expect("state" in lease).toBe(true); await flush();
 expect(r.w.prepareTerminalRead(r.h, r.token, r.receipt)).toBe(lease);
 expect(r.t.calls("history.window")).toHaveLength(1);
 expect(r.w.acceptedView.peek().terminalPresence?.[0]?.phase).toBe("reading");
 await r.pump();
 expect(r.w.acceptedView.peek().rows.map(row => row.node_id)).toEqual(["tool", "answer"]);
 expect(r.h.handoff.peek()).toHaveLength(1);expect(r.h.handoff.peek()[0]?.readyAttempt).toBeUndefined();
 expect(r.w.acceptedView.peek().terminalPresence ?? []).toEqual([]);
 expect(r.t.calls("history.window")).toHaveLength(1); expect(r.t.calls("history.get")).toHaveLength(0);
 expect(r.publications.generations.length).toBeGreaterThan(0); r.publications.stop(); r.w.dispose(); r.data.stop();
});
it("receipt-admitted missing-answer needs bounded readback", async () => {
 const r = await target();
 const before = r.w.acceptedView.peek();
 expect(before.terminalPersistedAttempts?.map(item => item.attemptId)).toEqual([CANONICAL_ATTEMPT_ID]);
 expect(before.assistantOwnership ?? []).toEqual([]);
 expect(before.rows).toHaveLength(1);
 expect(before.rows[0]).toMatchObject({node_id:"tool",kind:"assistant_response",selection:{ordinal:0},items:[{kind:"tool_call",item_identity:"call",execution_ids:["exec"]}]});
 expect(before.rows.some(row => row.node_id === "answer")).toBe(false);
 expect(r.receipt.scope).toBe(r.h.handoffScope());
 expect(r.receipt.refs).toEqual([{nodeId:"answer",ordinal:1,kind:"assistant_response"}]);
 expect(r.h.isReadQualificationCurrent(r.token)).toBe(true);
 const readBefore = r.t.calls("history.window").length, generationBefore = before.generation;
 const lease = r.w.prepareTerminalRead(r.h, r.token, r.receipt); expect("state" in lease).toBe(true); await r.pump();
 const after = r.w.acceptedView.peek();
 expect(r.t.calls("history.window").length - readBefore).toBe(1);
 expect(after.rows.map(row => row.node_id)).toEqual(["tool", "answer"]);
 expect(after.rows[0]).toMatchObject({node_id:"tool",items:[{kind:"tool_call",item_identity:"call",execution_ids:["exec"]}]});
 expect(after.rows[1]).toMatchObject({node_id:"answer",items:[{kind:"text",item_identity:"text",text:"saved",text_complete:true}]});
 expect(after.terminalPresence ?? []).toEqual([]);
 expect(after.generation).toBeGreaterThan(generationBefore);
 expect(r.h.isReadQualificationCurrent(r.token)).toBe(true);
 r.publications.stop(); r.w.dispose(); r.data.stop();
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
 let captures=0;const r=await target(handle=>({...handle,captureReadQualification:()=>{captures++;return handle.captureReadQualification();}}));
 const handle=r.h;
 expect(r.w.bindTerminalHandle(handle)).toBe(true); expect(r.w.bindTerminalHandle(handle)).toBe(true); expect(captures).toBe(1);
 const ref = r.w.acceptedView.peek();
 r.w.beginSummaryTransition(handle, ref, "tool", 0);
 expect(captures).toBe(1); expect(r.w.isTerminalHandleCurrent(handle)).toBe(true);
 const lease = r.w.prepareBoundTerminalRead(r.receipt); expect("state" in lease).toBe(true); await r.pump();
 expect(r.w.acceptedView.peek().rows.map(row => row.node_id)).toEqual(["tool", "answer"]); expect(captures).toBe(1);
 const old=r.w.acceptedView.peek();r.w.dispose();expect(r.w.isTerminalHandleCurrent(handle)).toBe(false);
 expect(r.w.acceptedView.isCurrent(old)).toBe(false);expect(r.h.isReadQualificationCurrent(r.token)).toBe(true);r.data.stop();
});
it("invalidated binding cannot recapture on repeated bind or admit a lease", async () => {
 let captures=0;const r=await target(handle=>({...handle,captureReadQualification:()=>{captures++;return handle.captureReadQualification();}}));
 const handle=r.h;
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
 let captures=0;const r=await target(handle=>({...handle,captureReadQualification:()=>{captures++;return handle.captureReadQualification();}}));
 const handle=r.h;
 expect(r.w.bindTerminalHandle(handle)).toBe(true); r.w.prepareBoundTerminalRead(r.receipt); await r.pump();
 const ref = r.w.acceptedView.peek(), id = r.w.beginSummaryTransition(handle, ref, "tool", 0);
 expect(id).toBeDefined(); expect(captures).toBe(1);
 r.t.push({ t: "owner", event: "restarted", owner: { state: "connected", info: { protocol_version: 5, instance_id: "other", capabilities: ["history.window"] } } });
 expect(r.w.beginSummaryTransition(handle, ref, "tool", 0)).toBeUndefined();
 expect(r.w.prepareBoundTerminalRead(r.receipt)).toEqual({ phase: "unavailable", reason: "cancelled" });
 expect(captures).toBe(1); r.w.dispose(); r.data.stop();
});
it("existing unbound summary remains valid when first binding is denied", async () => {
 const source=await rig();const w=new ConversationWindow({read:async()=>({ok:true,value:ownedHistory({thread_id:'a',revision:7,total:1,items:[baseNodes[0]!]})})});await flush();
 const r={...source,w};const ref = r.w.acceptedView.peek();
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

it("terminal slot successor dispatches one explicit whole-window request after a point revision", async () => {
  const { TerminalReadSlots } = await import("../../data/src/terminal-read");
  const slots = new TerminalReadSlots();
  const parent = { add: (_fn: () => void) => () => {} } as never;
  const receipt = { scope: "scope", attemptId: CANONICAL_ATTEMPT_ID, turnId: "turn", nodeIds: ["answer"] as string[], terminalState: "completed" as const };
  const calls: unknown[] = [];
  const valid = () => true;
  const point = { id: "point" as never, args: { thread_id: "thread", node_id: "answer", before: 0, after: 199, items: true } };
  const first = slots.request({ kind: "persisted", receipt }, point, valid, parent);
  expect("state" in first).toBe(true);
  await slots.dispatch(() => true, async args => { calls.push(args); return { ok: true, value: ownedHistory({ thread_id: "thread", revision: 7, total: 2, items: [baseNodes[1]!] }) }; }, false);
  const whole = { id: "whole" as never, args: { thread_id: "thread", before: 199, after: 0, items: true } };
  const replacement = slots.replace({ kind: "persisted", receipt }, whole, valid, parent);
  expect("state" in replacement).toBe(true);
  await slots.dispatch(() => true, async args => { calls.push(args); return { ok: true, value: ownedHistory({ thread_id: "thread", revision: 8, total: 2, items: baseNodes }) }; }, false);
  expect(calls).toEqual([point.args, whole.args]);
});

it("Window rebinds a revision-changing point read through one bounded whole-window successor", async () => {
  const r = await target(); r.state.selectedRevision=8;
  let successorLease:OwnedTerminalReadLease|undefined;const replace=r.h.replaceTerminalRead;
  r.h.replaceTerminalRead=(token,admission,request)=>{const out=replace(token,admission,request);if('state' in out)successorLease=out;return out;};
  const original = r.db.answer.bind(r.db);
  const requests: unknown[] = [];
  r.db.answer = call => {
    if (call.command === "history.window") {
      const args = call.args as Record<string, unknown>;
      requests.push(args);
      if (args.node_id !== undefined) return { ok: true, result: { thread_id: "a", revision: 8, total: 2, items: [baseNodes[1]!] } };
      if (args.ordinal === 0 && args.before === 0 && args.after === 1 && args.items === true) return { ok: true, result: { thread_id: "a", revision: 8, total: 2, items: baseNodes } };
      throw new Error(`unexpected history.window args: ${JSON.stringify(call.args)}`);
    }
    return original(call);
  };
  const callsBefore = r.t.calls("history.window").length;
  const lease = r.w.prepareTerminalRead(r.h, r.token, r.receipt);
  expect("state" in lease).toBe(true);
  await r.pump();
  const calls = r.t.calls("history.window");
  expect(calls.length - callsBefore).toBe(2);
  expect(requests).toHaveLength(2);
  const wholeItems = baseNodes.map(node => node.selection?.ordinal);
  expect(wholeItems).toEqual([0, 1]);
  expect(requests[0]).toMatchObject({ node_id: "answer", items: true });
  expect(requests[1]).toEqual({ thread_id: "a", ordinal: 0, before: 0, after: 1, items: true });
  const after = r.w.acceptedView.peek();
  expect(after.terminalPresence ?? []).toEqual([]);
  expect(r.receipt.nodeIds).toEqual(baseNodes.filter(node => node.items?.some(item => item.kind === "text")).map(node => node.node_id));
  expect(r.receipt.nodeIds).toHaveLength(new Set(r.receipt.nodeIds).size);
  expect(after.rows.map(row => row.selection?.ordinal)).toEqual([0, 1]);
  expect(after.displayPlan?.entries.some(entry => entry.presentationContainer === r.receipt.presentationContainer)).toBe(true);
  expect(after.revision).toBe(8);
  r.w.setAttemptPresentations([{scope:r.h.handoffScope(),attemptId:'other',turnId:'other-turn',nodeIds:['unselected'],state:'pending'}]);
  const successor=r.w.acceptedView.peek();
  expect(successor.revision).toBe(8);
  const visibleAnswer=successor.displayPlan?.entries.filter(entry=>entry.item.key===JSON.stringify(['answer','text']));
  expect(visibleAnswer).toHaveLength(1);
  expect(visibleAnswer?.[0]).toMatchObject({presentationContainer:r.receipt.presentationContainer,body:{kind:'typed-canonical',text:'saved'}});
  expect(successor.rows.map(row=>row.selection?.ordinal)).toEqual([0,1]);
  expect(successor.assistantOwnership).toMatchObject([{attemptId:CANONICAL_ATTEMPT_ID,mode:'canonical',proofRevision:8}]);
  r.w.setAttemptPresentations([{scope:r.h.handoffScope(),attemptId:'another',turnId:'another-turn',nodeIds:['also-unselected'],state:'pending'}]);
  expect(r.w.refreshConversationInput(r.w.acceptedView.peek())).toBe(true);
  const stable=r.w.acceptedView.peek();expect(stable.revision).toBe(8);
  const stableAnswers=stable.displayPlan?.entries.filter(entry=>entry.item.key===JSON.stringify(['answer','text']));
  expect(stableAnswers).toHaveLength(1);
  expect(stableAnswers?.[0]).toMatchObject({presentationContainer:r.receipt.presentationContainer,body:{kind:'typed-canonical',text:'saved'}});
  if(!('state' in lease))throw new Error('fixture requires the actual owned lease');
  expect(r.h.isTerminalReadCurrent(r.token,lease)).toBe(false); // the point lease was replaced
  if(!successorLease)throw new Error('fixture requires the actual public successor lease');
  expect(r.h.isTerminalReadCurrent(r.token,successorLease)).toBe(true);
  expect(r.h.isTerminalReadCurrent(r.token,{...successorLease})).toBe(false);
  successorLease.cancel();r.state.selectedOwnerAvailable=false;
  expect(r.h.isTerminalReadCurrent(r.token,successorLease)).toBe(false);
  r.w.setAttemptPresentations([{scope:r.h.handoffScope(),attemptId:'after-revoke',turnId:'after-revoke-turn',nodeIds:['unselected'],state:'pending'}]);
  const denied=r.w.acceptedView.peek();expect(denied.revision).toBe(8);expect(denied.assistantOwnership??[]).toEqual([]);
  expect(denied.displayPlan?.entries.find(entry=>entry.item.key===JSON.stringify(['answer','text']))?.presentationContainer).toBeUndefined();
  expect(stable.displayPlan?.entries.find(entry=>entry.item.key===JSON.stringify(['answer','text']))?.presentationContainer).toBe(r.receipt.presentationContainer);
  r.w.dispose(); r.data.stop();
});

it("rejects an incomplete revision successor page before publication", async () => {
  const r = await target();
  const original = r.db.answer.bind(r.db);
  r.db.answer = call => {
    if (call.command === "history.window") {
      const args = call.args as Record<string, unknown>;
      if (args.node_id !== undefined) return { ok: true, result: { thread_id: "a", revision: 8, total: 2, items: [baseNodes[1]!] } };
      if (args.ordinal === 0 && args.before === 0 && args.after === 1 && args.items === true) return { ok: true, result: { thread_id: "a", revision: 8, total: 2, items: [baseNodes[1]!] } };
    }
    return original(call);
  };
  r.w.prepareTerminalRead(r.h, r.token, r.receipt);
  await r.pump();
  expect(r.w.acceptedView.peek().revision).toBe(7);
  expect(r.w.acceptedView.peek().rows.every(row => row.node_id !== "answer")).toBe(true);
  r.w.dispose(); r.data.stop();
});


it("scoped ownership does not attach an unrelated saved assistant to one preview", () => {
  const rows: HistoryItem[] = [
    { node_id: "owned", kind: "assistant_response", provenance: { attempt_id: CANONICAL_ATTEMPT_ID }, selection: { ordinal: 0 }, items: [{ kind: "text", item_identity: "owned:text", text: "owned", text_complete: true }] },
    { node_id: "unrelated", kind: "assistant_response", selection: { ordinal: 1 }, items: [{ kind: "text", item_identity: "other:text", text: "other", text_complete: true }] },
  ];
  const association = { scope: "scope", attemptId: CANONICAL_ATTEMPT_ID, turnId: "turn", presentationContainer: syntheticPresentation(CANONICAL_ATTEMPT_ID), refs: selectedReadyRefs(["owned"],rows) };
  const fact = assistantOwnership(association, "record", rows, 8);
  expect(fact?.mode).toBe("canonical");
  expect(fact?.itemKeys).toEqual([JSON.stringify(["owned", "owned:text"])]);
  expect(fact?.itemKeys).not.toContain(JSON.stringify(["unrelated", "other:text"]));
});


async function readyTarget(total = 2) {
 const r=await rig();
 const w=new ConversationWindow({read:async()=>({ok:true,value:ownedHistory({thread_id:'a',revision:6,total:1,items:[baseNodes[0]!]})})});
 await flush(); w.bindTerminalHandle(r.h);
 if(total!==2){const answer=r.db.answer.bind(r.db);r.db.answer=call=>call.command==='history.window'
   ?{ok:true,result:{thread_id:'a',revision:7,total,items:structuredClone(baseNodes)}}:answer(call);}
 r.live('whole live preview'); r.end(); await r.pump();
 const record=r.h.handoff.peek()[0]!; expect(record.readyAttempt).toBeDefined();
 return {...r,w,record};
}
it('actual ready admission reads accepted range plus exact refs and atomically retires preview',async()=>{
 const r=await readyTarget(), before=r.w.acceptedView.peek();
 const lease=r.w.prepareBoundReadyRead(r.record); expect('state' in lease).toBe(true);
 expect(r.w.acceptedView.peek()).toBe(before); expect(r.h.handoff.peek()[0]?.text).toBe('whole live preview');
 await r.pump();
 expect(r.w.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(['tool','answer']);
 expect(r.w.acceptedView.peek().revision).toBe(7); expect(r.h.handoff.peek()).toHaveLength(0);
 expect(r.w.acceptedView.peek().retiredAttempts?.[0]?.attemptId).toBe(CANONICAL_ATTEMPT_ID);
 const retired=r.w.acceptedView.peek();
 r.w.changed();await r.pump();
 const refreshed=r.w.acceptedView.peek(),answers=refreshed.displayPlan?.entries.filter(entry=>entry.item.key===JSON.stringify(['answer','text']));
 expect(refreshed.rows.map(row=>row.selection?.ordinal)).toEqual([0,1]);
 expect(answers).toHaveLength(1);
 expect(answers?.[0]).toMatchObject({body:{kind:'typed-canonical',text:'saved'},presentationContainer:retired.displayPlan?.entries.find(entry=>entry.item.key===JSON.stringify(['answer','text']))?.presentationContainer});
 expect(refreshed.retiredAttempts?.some(item=>item.attemptId===CANONICAL_ATTEMPT_ID)).toBe(true);
 expect(refreshed.assistantOwnership?.some(item=>item.attemptId===CANONICAL_ATTEMPT_ID&&item.mode==='canonical')).toBe(true);
 expect(refreshed.displayPlan?.entries.some(entry=>entry.body.kind==='preview')).toBe(false);
 r.w.dispose();r.data.stop();
});
it('complete canonical ownership avoids a redundant ready readback',async()=>{
 const r=await readyTarget();
 const first=r.w.prepareBoundReadyRead(r.record);expect('state' in first).toBe(true);await r.pump();
 const token=r.h.captureReadQualification()!;
 const owner=r.w.acceptedView.peek().assistantOwnership?.find(item=>item.attemptId===CANONICAL_ATTEMPT_ID);
 expect(owner).toMatchObject({attemptId:CANONICAL_ATTEMPT_ID,mode:'canonical',refs:r.record.readyAttempt?.refs});
 expect(r.h.isReadQualificationCurrent(token)).toBe(true);
 expect(r.w.acceptedView.peek().retiredAttempts?.some(item=>item.attemptId===CANONICAL_ATTEMPT_ID)).toBe(true);
 expect(r.h.handoff.peek()).toHaveLength(0);expect((first as OwnedTerminalReadLease).state.peek().phase).toBe('settled');
 const firstState={retired:r.w.acceptedView.peek().retiredAttempts,handedOff:r.h.handoff.peek(),owners:r.w.acceptedView.peek().assistantOwnership};
 const beforeReads=r.t.calls('history.window').length;
 const second=r.w.prepareBoundReadyRead(r.record);expect(second).toEqual({phase:'unavailable',reason:'cancelled'});await r.pump();
 expect(r.t.calls('history.window').length-beforeReads).toBe(0);
 expect(r.h.isReadQualificationCurrent(token)).toBe(true);
 expect(r.w.acceptedView.peek().retiredAttempts).toEqual(firstState.retired);
 expect(r.h.handoff.peek()).toEqual(firstState.handedOff);
 expect(r.w.acceptedView.peek().assistantOwnership).toEqual(firstState.owners);
 r.w.dispose();r.data.stop();
});
it('canonical publication subscriber observes atomic state before release',async()=>{
 const r=await readyTarget(); const generation=r.w.acceptedView.peek().generation;
 const trace:{rows:readonly string[];owner:boolean;retired:boolean;rawHeld:number;presentations:number;generation:number}[]=[];
 const stop=r.w.acceptedView.subscribe(snapshot=>{
  const owner=snapshot.assistantOwnership?.some(item=>item.attemptId===CANONICAL_ATTEMPT_ID&&item.mode==='canonical') ?? false;
  if(owner){trace.push({rows:snapshot.rows.map(row=>row.node_id!),owner,retired:snapshot.retiredAttempts?.some(item=>item.attemptId===CANONICAL_ATTEMPT_ID)??false,rawHeld:r.h.handoff.peek().length,presentations:snapshot.displayPlan?.entries.filter(entry=>entry.presentationContainer===r.record.presentationContainer).length??0,generation:snapshot.generation});r.w.layoutChanged();}
 });
 const lease=r.w.prepareBoundReadyRead(r.record);expect('state' in lease).toBe(true);await r.pump();stop();
 const settled=r.w.acceptedView.peek();
 expect(trace.map(({rows,owner,retired,presentations})=>({rows,owner,retired,presentations}))).toEqual([{rows:['tool','answer'],owner:true,retired:true,presentations:1}]);
 expect(trace.every(item=>item.generation>generation&&item.presentations===1)).toBe(true);
 expect(settled.assistantOwnership?.some(item=>item.attemptId===CANONICAL_ATTEMPT_ID&&item.mode==='canonical')).toBe(true);
 expect(settled.retiredAttempts?.some(item=>item.attemptId===CANONICAL_ATTEMPT_ID)).toBe(true);expect(r.h.handoff.peek()).toHaveLength(0);
 expect((lease as OwnedTerminalReadLease).state.peek().phase).toBe('settled');
 r.w.dispose();r.data.stop();
});
it.each(['gap','revoke','cancel','dispose'] as const)('actual ready successor %s retains accepted rows and cannot blend old prefix',async mode=>{
 const r=await readyTarget(), before=r.w.acceptedView.peek();
 const lease=r.w.prepareBoundReadyRead(r.record); expect('state' in lease).toBe(true);
 if(mode==='gap') {const answer=r.db.answer.bind(r.db);r.db.answer=call=>call.command==='history.window'?{ok:true,result:{thread_id:'a',revision:7,total:2,items:[baseNodes[1]!]}}:answer(call);}
 else if(mode==='revoke')r.w.acceptedView.revoke(); else if(mode==='cancel')r.h.cancelReads(); else r.w.dispose();
 await r.pump();
 expect(r.w.acceptedView.peek().rows).toEqual(before.rows);
 expect(r.w.acceptedView.peek().rows.some(row=>row.node_id==='answer')).toBe(false);
 expect(r.h.handoff.peek()[0]?.text).toBe('whole live preview');
 r.w.dispose();r.data.stop();
});
it('Store rejects copied ready record and foreign qualification before dispatch',async()=>{
 const r=await readyTarget(), token=r.h.captureReadQualification()!;
 const request={id:'ready-negative' as import('../../data/src/terminal-read').SelectedRequestId,args:{thread_id:'a',node_id:'answer',before:1,after:0,items:true}};
 expect(r.h.requestTerminalRead(token,{kind:'ready',record:{...r.record},scope:r.h.handoffScope()},request)).toEqual({phase:'unavailable',reason:'cancelled'});
 const foreign=r.data.openThread('a'), other=foreign.captureReadQualification()!;
 expect(r.h.requestTerminalRead(other,{kind:'ready',record:r.record,scope:r.h.handoffScope()},request)).toEqual({phase:'unavailable',reason:'cancelled'});
 foreign.close(); r.w.dispose();r.data.stop();
});


it('actual ready bounded selected coverage need not read the entire Thread total',async()=>{
 const r=await readyTarget(1000);const reads=r.t.calls('history.window').length;
 r.w.prepareBoundReadyRead(r.record);await r.pump();
 const selected=r.t.calls('history.window').slice(reads);
 expect(selected).toHaveLength(1);expect(selected[0]!.args).toMatchObject({node_id:'answer',before:1,after:0,items:true});
 expect(r.w.acceptedView.peek().total).toBe(1000);
 expect(r.w.acceptedView.peek().rows.map(row=>row.node_id)).toEqual(['tool','answer']);
 expect(r.h.handoff.peek()).toHaveLength(0);r.w.dispose();r.data.stop();
});


it.each([{node_id:'answer',before:1,after:0},{ordinal:1,before:1,after:0},
 {ordinal:1,expect_node_id:'answer',before:1,after:0},{before:1,after:0}])('shared fake owner applies before/after around the public anchor %#',args=>{
 const db=new FakeOwnerDb();db.history.a=structuredClone(baseNodes);
 const reply=db.answer({t:'call',id:1,command:'history.window',args:{thread_id:'a',items:true,...args}});
 expect(reply).toMatchObject({ok:true,result:{revision:1,total:2,items:baseNodes}});
});
it('actual ready lease survives layout generation without a second selected read',async()=>{
 const r=await readyTarget();const start=r.t.calls('history.window').length;
 const lease=r.w.prepareBoundReadyRead(r.record);expect('state' in lease).toBe(true);
 r.w.layoutChanged();expect(r.w.prepareBoundReadyRead(r.record)).toBe(lease);await r.pump();
 expect(r.t.calls('history.window').slice(start)).toHaveLength(1);expect(r.h.handoff.peek()).toHaveLength(0);
 r.w.dispose();r.data.stop();
});
