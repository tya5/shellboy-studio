import {attemptWork,selectedReadyRefs} from '../../data/test/work-fixture';
import { ShellboyData } from "../../data/src/store";
import { expect, it } from "vitest";
import { ConversationWindow } from "../src/window";
import { declaredPlanExpectation, observePublishedPlans } from "./publication-contract";
import { declaredToolAnswerCut } from "./declared-attempt-cuts";
import type { HandoffRecord, PresentationContainerId, AttemptReadyProof } from "../../data/src/handoff";
import type { HistoryItem } from "../../data/src";
import { FakeOwnerDb, FakeTransport, connectedWithHistory, settle, flush } from "../../data/test/harness";
import {ownedHistory} from '../../data/test/owned-history';
const nodes: HistoryItem[] = [
  { node_id: "tool", kind: "assistant_response", selection: { ordinal: 0 }, items: [{ kind: "tool_call", item_identity: "tc", execution_ids: ["exec"] }] },
  { node_id: "answer", kind: "assistant_response", selection: { ordinal: 1 }, items: [{ kind: "text", item_identity: "text", text: "saved", text_complete: true }] },
];
async function rig(items = nodes) {
  const source={revision:7,items,total:2};
  const w = new ConversationWindow({ read: async () => ({ ok: true, value: ownedHistory({ thread_id: "thread", revision: source.revision, total: source.total, items:source.items }) }) }); await flush();
  const proof: AttemptReadyProof = { scope: '["owner","thread",1]', attemptId: "attempt", turnId: "turn", revision: 7, total: 2, refs: selectedReadyRefs(["answer","tool","answer"],nodes), nodes };
  const record: HandoffRecord = { key: "live-record", presentationContainer: "presentation:test" as PresentationContainerId, attemptId: "attempt", status: "confirming", bodyAuthority: "preview", text: "whole live block", incomplete: false, readyAttempt: proof };
  return { w, record, proof, source, settle: (async () => { await flush(); }) };
}
it("all-ref retirement and saved-order sequence publish once in the SAME observed snapshot", async () => {
  const { w, record, proof, source } = await rig();
  const declared=declaredToolAnswerCut({scope:proof.scope,revision:7,toolIdentity:'tc',answer:'saved',container:record.presentationContainer});
  const publications=observePublishedPlans(w, ref => declaredPlanExpectation(ref,w.acceptedView.currentCapability,declared)); const trace: { saved: string[]; retired: string[] }[] = [];
  const stop = w.acceptedView.subscribe(ref => { expect(w.acceptedView.isCurrent(ref)).toBe(true); trace.push({ saved: ref.rows.map(row => row.node_id!), retired: ref.retiredAttempts?.map(item => item.attemptId) ?? [] }); });
  let releases = 0; expect(w.acceptHandoff(record, proof.scope, () => { releases++; expect(w.acceptedView.peek().retiredAttempts).toHaveLength(1); })).toBe(true);
  expect(trace).toEqual([{ saved: ["tool", "answer"], retired: ["attempt"] }]); expect(releases).toBe(1);
  expect(w.acceptedView.peek().retiredAttempts![0]!.nodeIds).toEqual(["answer", "tool", "answer"]);
  const retiredSnapshot = w.acceptedView.peek();
  expect(retiredSnapshot.assistantOwnership).toHaveLength(1);
  publications.stop(); stop();
  w.layoutChanged();
  expect(w.acceptedView.peek()).toBe(retiredSnapshot);
  expect(w.acceptedView.peek().assistantOwnership).toEqual(retiredSnapshot.assistantOwnership);
  expect(w.acceptedView.peek().displayPlan?.acceptedGeneration).toBe(w.acceptedView.peek().generation);
  expect(w.acceptedView.peek().displayPlan?.entries.map(entry => entry.lifetime.kind)).toContain("valid-owner");
  const revision8 = w.acceptedView.peek();
  expect(revision8.assistantOwnership![0]!.proofRevision).toBe(7);
  expect(revision8.assistantOwnership![0]!.receiptRevision).toBe(7);
  source.revision=8;w.changed();await flush();
  const qualified8 = w.acceptedView.peek();
  expect(qualified8.revision).toBe(8);
  expect(qualified8.assistantOwnership).toHaveLength(1);
  expect(qualified8.assistantOwnership![0]!.proofRevision).toBe(8);
  expect(qualified8.assistantOwnership![0]!.receiptRevision).toBe(7);
  expect(qualified8.retiredAttempts).toEqual(revision8.retiredAttempts);
  source.revision=9;w.changed();await flush();
  const revision9 = w.acceptedView.peek();
  expect(revision9.revision).toBe(9);
  expect(revision9.assistantOwnership).toHaveLength(1);
  expect(revision9.assistantOwnership![0]!.proofRevision).toBe(9);
  expect(revision9.assistantOwnership![0]!.receiptRevision).toBe(7);
  w.acceptedView.revoke();w.layoutChanged();expect(w.acceptedView.isCurrent(revision9)).toBe(false);
  w.changed();await flush();
  expect(w.acceptedView.peek().assistantOwnership).toHaveLength(0);
  expect(w.acceptedView.peek().retiredAttempts).toEqual([]);
  expect(w.acceptedView.peek().displayPlan?.acceptedGeneration).toBe(w.acceptedView.peek().generation);
  w.dispose();
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
it("rejects a partial newer proof instead of publishing it over copied older rows", async () => {
  const { w, record, proof } = await rig();
  (proof as { revision: number }).revision = 8;
  (proof as { nodes: readonly HistoryItem[] }).nodes = [nodes[1]!];
  const before = w.acceptedView.peek();
  expect(w.acceptHandoff(record, proof.scope, () => {})).toBe(false);
  expect(w.acceptedView.peek()).toBe(before);
  expect(w.acceptedView.peek().revision).toBe(7);
  w.dispose();
});
it("delayed ordinary revision 7 cannot replace an accepted revision 8 snapshot", async () => {
  const { w, record, proof } = await rig();
  const shifted = [
    { node_id: "user-0", kind: "user", selection: { ordinal: 0 }, items: [] },
    { ...nodes[0]!, selection: { ordinal: 1 } },
    { ...nodes[1]!, selection: { ordinal: 2 } },
    { node_id: "user-3", kind: "user", selection: { ordinal: 3 }, items: [] },
  ];
  const acceptedProof:AttemptReadyProof={...proof,revision:8,total:4,nodes:shifted,refs:selectedReadyRefs(['answer','tool','answer'],shifted)};
  const acceptedRecord = { ...record, readyAttempt: acceptedProof };
  expect(w.acceptHandoff(acceptedRecord, acceptedProof.scope, () => {})).toBe(true);
  const before = w.acceptedView.peek();
  expect(before.revision).toBe(8);
  w.layoutChanged();
  expect(w.acceptedView.peek()).toBe(before);
  expect(w.acceptedView.peek().revision).toBe(8);
  expect(w.acceptedView.peek().rows.map(row => row.node_id)).toEqual(["user-0", "tool", "answer", "user-3"]);
  w.dispose();
});
it("notification reentry stops old release and never retires another attempt/turn", async () => {
  const { w, record, proof } = await rig(); let nested = false, releases = 0;
  w.acceptedView.subscribe(() => { if (!nested) { nested = true;
    w.setAttemptPresentations([{scope:proof.scope,attemptId:'another',turnId:'another-turn',nodeIds:['unselected'],state:'pending'}]);
  } });
  expect(w.acceptHandoff(record, proof.scope, () => { releases++; })).toBe(false);
  expect(releases).toBe(0); expect(w.acceptedView.peek().retiredAttempts!.every(item => item.turnId === "turn" && item.attemptId === "attempt")).toBe(true); w.dispose();
});
it("actual partial persistence observes one bound receipt without transferring or retiring the original", async () => {
  const t=new FakeTransport(),db=new FakeOwnerDb(),ticks:(()=>void)[]=[];let id=0;
  const data=new ShellboyData({transport:t,newId:()=>`joined-${++id}`,schedule:fn=>ticks.push(fn)});
  const base=db.answer.bind(db);
  db.answer=call=>call.command==='status'?{ok:true,result:{items:[attemptWork({threadId:'thread',attemptId:'attempt',turnId:'turn',state:'completed',
    refs:[{node_id:'tool',ordinal:0,kind:'assistant_response'},{node_id:'answer',ordinal:1,kind:'assistant_response'}],truncated:true})]}}:
    call.command==='history.window'?{ok:true,result:{thread_id:'thread',revision:7,total:2,items:nodes}}:base(call);
  data.start();t.open();t.push({t:'hello',bridge_version:'synthetic',owner:connectedWithHistory});await settle(t,db);
  const h=data.openThread('thread');await settle(t,db);
  const w=new ConversationWindow({read:(args,cancel)=>h.readWindow(args,cancel)});await settle(t,db);
  expect(w.bindTerminalHandle(h)).toBe(true);
  const before=w.acceptedView.peek(),trace:{rows:string[];receipt:string[];overlay:string}[]=[];
  const stop=w.acceptedView.subscribe(ref=>{
    expect(w.acceptedView.isCurrent(ref)).toBe(true);expect(ref.rows).toEqual(before.rows);
    trace.push({rows:ref.rows.map(row=>row.node_id!),receipt:(ref.terminalPersistedAttempts??[]).map(receipt=>receipt.attemptId),overlay:h.handoff.peek()[0]?.text??''});
  });
  try{
    t.push({t:'live',thread_id:'thread',attempt_id:'attempt',gap:false,deltas:[{offset:0,reasoning:false,text:'whole live block'}]});ticks.splice(0).forEach(fn=>fn());
    t.push({t:'live_end',thread_id:'thread'});await settle(t,db);
    const held=h.handoff.peek()[0]!;expect(held.text).toBe('whole live block');expect(held.readyAttempt).toBeUndefined();
    expect(w.acceptedView.peek().terminalPersistedAttempts).toMatchObject([{scope:h.handoffScope(),attemptId:'attempt',nodeIds:['tool','answer']}]);
    expect(trace).toEqual([{rows:['tool','answer'],receipt:['attempt'],overlay:'whole live block'}]);
    let releases=0;
    const transfer=()=>h.transferHandoff('attempt',(record,release)=>w.acceptHandoff(record,h.handoffScope(),reason=>{releases++;release(reason);}));
    expect(transfer()).toBe(false);expect(transfer()).toBe(false);expect(releases).toBe(0);
    expect(h.handoff.peek()[0]).toBe(held);expect(w.acceptedView.peek().retiredAttempts??[]).toEqual([]);expect(trace).toHaveLength(1);
    expect(t.calls('history.window')).toHaveLength(1);expect(t.calls('history.get')).toHaveLength(0);
  }finally{stop();w.dispose();h.close();data.stop();}
});

it("a revoked Window capability cannot re-publish old retirement metadata on a later ordinary generation", async () => {
  const { w, record, proof } = await rig(); expect(w.acceptHandoff(record, proof.scope, () => {})).toBe(true);
  const old=w.acceptedView.peek();w.acceptedView.revoke();w.layoutChanged();
  expect(w.acceptedView.peek()).toBe(old);expect(w.acceptedView.isCurrent(old)).toBe(false);
  w.changed();await flush();expect(w.acceptedView.peek().retiredAttempts).toEqual([]);
  expect(w.acceptedView.peek().assistantOwnership).toEqual([]);expect(w.acceptedView.isCurrent(w.acceptedView.peek())).toBe(true);w.dispose();
});
it("materializes already-qualified all-ref nodes and retirement together without requiring another changed hint/read", async () => {
  const initial: HistoryItem = { node_id: "user", kind: "user", items: [], selection: { ordinal: 0 } };
  let reads = 0;
  const w = new ConversationWindow({ read: async () => { reads++; return { ok: true, value: ownedHistory({ thread_id: "thread", revision: 7, total: 1, items: [initial] }) }; } }); await flush();
  const proof: AttemptReadyProof = { scope: "scope", attemptId: "attempt", turnId: "turn", revision: 7, total: 3,
    refs: [{ nodeId: "answer",ordinal:2,kind:'assistant_response' }, { nodeId: "tool",ordinal:1,kind:'assistant_response' }], nodes: [initial, ...nodes.map((node, i) => ({ ...node, selection: { ordinal: i + 1 } }))] };
  const record: HandoffRecord = { key: "original", presentationContainer: "presentation:test" as PresentationContainerId, attemptId: "attempt", text: "whole live", incomplete: false, status: "confirming", bodyAuthority: "preview", readyAttempt: proof };
  const frames: { ids: string[]; total: number; retired: number }[] = [];
  w.acceptedView.subscribe(ref => frames.push({ ids: ref.rows.map(row => row.node_id!), total: ref.total, retired: ref.retiredAttempts?.length ?? 0 }));
  let releases = 0; expect(w.acceptHandoff(record, "scope", () => { releases++; })).toBe(true);
  expect(frames).toEqual([{ ids: ["user", "tool", "answer"], total: 3, retired: 1 }]);
  expect(w.rangeItems().map(row => row.node_id)).toEqual(["user", "tool", "answer"]); expect(w.total).toBe(3); expect(reads).toBe(1); expect(releases).toBe(1); w.dispose();
});

it("typed Window detaches a later listener during the real body commit notification", async () => {
  const { w, record, proof } = await rig();
  const trace: string[] = []; let stopB = () => {};
  w.acceptedView.subscribe(() => { trace.push("A"); stopB(); });
  stopB = w.acceptedView.subscribe(() => { trace.push("B"); });
  let releases = 0;
  expect(w.acceptHandoff(record, proof.scope, () => { releases++; })).toBe(true);
  expect(trace).toEqual(["A"]);
  expect(releases).toBe(1);
  expect(w.acceptedView.peek().rows.map(row => row.node_id)).toEqual(["tool", "answer"]);
  w.dispose();
});

it("typed Window recovers after a subscriber throws post-swap and a later real publication", async () => {
  const { w, record, proof, source, settle } = await rig();
  let first = true; let unsubscribe = () => {}; const trace: number[] = [];
  unsubscribe = w.acceptedView.subscribe(ref => {
    trace.push(ref.generation);
    if (first) { first = false; unsubscribe(); throw new Error("post-swap observer"); }
  });
  expect(() => w.acceptHandoff(record, proof.scope, () => {})).toThrow("post-swap observer");
  const committed = w.acceptedView.peek();
  expect(committed.rows.map(row => row.node_id)).toEqual(["tool", "answer"]);
  let later: typeof committed | undefined;
  w.acceptedView.subscribe(ref => { later = ref; });
  source.revision = 8; w.changed(); await settle();
  expect(later?.revision).toBe(8);
  expect(later?.generation).toBeGreaterThan(committed.generation);
  expect(trace.length).toBe(1);
  w.dispose();
});

it("coalesces more than two semantic successors from one notification to the newest ref", async () => {
  const { w } = await rig(); const trace: { generation: number; attempt: string | undefined }[] = [];
  let passes = 0;
  w.acceptedView.subscribe(ref => {
    trace.push({ generation: ref.generation, attempt: ref.attemptPresentations?.[0]?.attemptId });
    passes++;
    if (passes === 1) w.setAttemptPresentations([{ scope: "scope", attemptId: "successor-a", turnId: "turn-a", nodeIds: [], state: "pending" }]);
    if (passes === 2) w.setAttemptPresentations([{ scope: "scope", attemptId: "successor-b", turnId: "turn-b", nodeIds: [], state: "pending" }]);
  });
  w.setAttemptPresentations([{ scope: "scope", attemptId: "successor-start", turnId: "turn-start", nodeIds: [], state: "pending" }]);
  expect(trace).toHaveLength(2);
  await flush();
  expect(trace).toHaveLength(3);
  expect(trace.map(item => item.attempt)).toEqual(["successor-start", "successor-a", "successor-b"]);
  expect(trace.at(-1)?.generation).toBe(w.acceptedView.peek().generation);
  w.dispose();
});
