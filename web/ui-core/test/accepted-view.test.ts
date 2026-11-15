import { emptyOwnSendLocalRegion, ownSendPresentation, captureOwnSendLocalRegion } from "../src/own-send-presentation";
import { expect, it } from "vitest";
import { createConversationDisplayPlan } from "../src/conversation-display-plan";
import { projectHistoryWindowItems } from "../src/conversation-items";
import { WINDOW_NODES, WINDOWS_HELD, type WindowAcceptedSnapshot } from "../src/window";
import type { HistoryItem } from "../../data/src/protocol";
import { AcceptedView, makeAcceptedPublication } from "../src/accepted-view";

type Page = { generation: number; revision: number; displayPlan: { acceptedGeneration: number; revision: number; capability: object; entries: readonly unknown[] }; total: number; range: { first: number; last: number }; rows: { nodeId: string }[] };
const page = (revision: number, capability: object = Object.freeze({})): Page => {
  const displayPlan = Object.freeze({ acceptedGeneration: revision, revision, capability, entries: [] });
  return { generation: revision, revision, displayPlan, total: 1, range: { first: 0, last: 0 }, rows: [{ nodeId: `n${revision}` }] };
};
const next = (view: AcceptedView<Page>, revision: number) => page(revision, view.currentCapability);
const publish = (view: AcceptedView<Page>, value: Page, capability = view.currentCapability) =>
  view.publish(makeAcceptedPublication({ ...value, displayPlan: { ...value.displayPlan, capability } }, "read"));

it("stages external getters before qualification and never swaps a revoked page", () => {
  const view = new AcceptedView(page(1));
  const value = next(view, 2);
  Object.defineProperty(value, "revision", { get() { view.revoke(); return 2; } });
  expect(publish(view, value)).toBe(false);
  expect(view.current.revision).toBe(1); expect(view.current.rows[0]!.nodeId).toBe("n1");
});
it("swaps one coherent immutable reference without retaining caller-owned rows", () => {
  const view = new AcceptedView(page(1)); const value = next(view, 2);
  expect(publish(view, value)).toBe(true);
  expect(view.current.rows[0]!.nodeId).toBe("n2"); expect(Object.isFrozen(view.current.rows[0])).toBe(true);
});
it("stops stale listeners after reentry and coalesces only the newest current reference", () => {
  const view = new AcceptedView(page(0)); const seen: string[] = [];
  view.subscribe(p => { seen.push(`a${p.revision}`); if (p.revision === 1) { publish(view, next(view, 2)); publish(view, next(view, 3)); } });
  view.subscribe(p => { seen.push(`b${p.revision}`); expect(p).toBe(view.current); });
  publish(view, next(view, 1));
  expect(seen).toEqual(["a1", "a3", "b3"]);
});
it("listener removal during notification does not notify a detached subscription", () => {
  const view = new AcceptedView(page(0)); let calls = 0; let stop = () => {};
  view.subscribe(() => stop()); stop = view.subscribe(() => { calls++; });
  publish(view, next(view, 1)); expect(calls).toBe(0);
});
it("releases its notification frame even after listener throws", () => {
  const view = new AcceptedView(page(0)); const stop = view.subscribe(() => { throw new Error("synthetic listener"); });
  expect(() => publish(view, next(view, 1))).toThrow("synthetic listener"); stop();
  let seen = 0; view.subscribe(p => { seen = p.revision; });
  publish(view, next(view, 2)); expect(seen).toBe(2);
});
it("rejects a captured capability after revoke", () => {
  const view = new AcceptedView(page(1)), cap = view.currentCapability, ref = view.current;
  view.revoke(); expect(view.isCurrent(ref)).toBe(false);
  expect(publish(view, next(view, 2), cap)).toBe(false);
  expect(publish(view, next(view, 3))).toBe(true);
});
it("revocation permanently invalidates retained leases and publications", () => {
  const view = new AcceptedView(page(1)), oldLease = view.currentLease, old = makeAcceptedPublication(next(view, 2), "read");
  view.revoke();
  const newLease = view.currentLease;
  expect(oldLease.isCurrent()).toBe(false); expect(newLease.isCurrent()).toBe(true);
  view.revoke(); expect(oldLease.isCurrent()).toBe(false); expect(newLease.isCurrent()).toBe(false);
  expect(view.publish(old)).toBe(false); expect(view.current.revision).toBe(1);
});

it("a getter-triggered nested publication wins over the outer publication", () => {
  const view = new AcceptedView(page(0)); const value = next(view, 2);
  Object.defineProperty(value, "generation", { get() { publish(view, next(view, 3)); return 2; } });
  expect(publish(view, value)).toBe(false); expect(view.current.revision).toBe(3);
});
it("dispose and revoke during notification stop remaining listeners and future publication", () => {
  const view = new AcceptedView(page(0)); let calls = 0;
  view.subscribe(() => view.dispose()); view.subscribe(() => { calls++; });
  publish(view, next(view, 1)); expect(calls).toBe(0); expect(publish(view, next(view, 2))).toBe(false);
  const other = new AcceptedView(page(0)); other.subscribe(() => other.revoke()); other.subscribe(() => { calls++; });
  publish(other, next(other, 1)); expect(calls).toBe(0);
});
it("rejects malformed and non-plain publication payloads", () => {
  const view = new AcceptedView(page(1));
  expect(() => makeAcceptedPublication({ ...next(view, 2), displayPlan: undefined }, "read")).toThrow("matching snapshot display plan");
  const cycle: { self?: unknown; generation: number; revision: number; displayPlan: Page["displayPlan"] } = { ...next(view, 2) }; cycle.self = cycle;
  expect(() => publish(view, cycle as Page)).toThrow("acyclic"); expect(view.current.revision).toBe(1);
});
it("coalesces repeated trailing reentry into one scheduled current notification", async () => {
  const view = new AcceptedView(page(0)); const seen: number[] = [];
  view.subscribe(p => { if (p.revision < 4) publish(view, next(view, p.revision + 1)); });
  view.subscribe(p => seen.push(p.revision)); publish(view, next(view, 1));
  await Promise.resolve(); expect(seen).toEqual([4]);
});


it("rejects duplicate and delayed old publications after a newer accepted generation", () => {
  const view = new AcceptedView(page(1));
  const old = makeAcceptedPublication(next(view, 2), "read");
  expect(view.publish(old)).toBe(true);
  const newer = next(view, 3), publication = makeAcceptedPublication(newer, "bump");
  expect(view.publish(publication)).toBe(true);
  expect(view.publish(publication)).toBe(false);
  expect(view.publish(old)).toBe(false);
  expect(view.current.revision).toBe(3); expect(view.current).not.toBe(newer);
});


it("captures shared publication subgraphs once without retaining caller-owned data", () => {
  const shared = { items: Array.from({ length: 2000 }, (_, i) => ({ id: i, text: `item-${i}` })) };
  const view = new AcceptedView({ ...page(0), graph: [shared] });
  const candidate = { ...page(1, view.currentCapability), graph: Array.from({ length: 20 }, () => shared) };
  expect(view.publish(makeAcceptedPublication(candidate, "read"))).toBe(true);
  const captured = view.current.graph[0]!;
  expect(captured).not.toBe(shared);expect(view.current.graph.every(node => node === captured)).toBe(true);
  shared.items[0]!.text = "caller mutation";
  expect(captured.items[0]!.text).toBe("item-0");expect(Object.isFrozen(captured.items[0])).toBe(true);
});
it("shared capture reads each getter once before qualification", () => {
  let reads = 0;
  const shared = { get body() { reads++; return "captured"; } };
  const graph: { readonly body: string }[] = [];
  const view = new AcceptedView({ ...page(0), graph });
  expect(view.publish(makeAcceptedPublication({ ...page(1, view.currentCapability), graph: [shared, shared] }, "read"))).toBe(true);
  expect(reads).toBe(1);expect(view.current.graph[0]).toBe(view.current.graph[1]);
});
it("keeps the original node budget for a genuinely large unique graph", () => {
  const view = new AcceptedView({ ...page(0), graph: [{ value: "initial" }] });
  const ref = view.current;
  const candidate = { ...page(1, view.currentCapability), graph: Array.from({ length: 40000 }, () => ({ value: "unique" })) };
  expect(() => view.publish(makeAcceptedPublication(candidate, "read"))).toThrow("staging bound exceeded");
  expect(view.current).toBe(ref);
});
it("cached aliases cannot bypass the original maximum path depth", () => {
  interface Branch { next?: Branch }
  const chain = (length: number, tail: Branch = {}): Branch => {
    let node = tail; for (let i = 0; i < length; i++) node = { next: node }; return node;
  };
  const shallow = chain(40);
  const view = new AcceptedView({ ...page(0), graph: { shallow: {}, deep: {} } });
  const candidate = { ...page(1, view.currentCapability), graph: { shallow, deep: chain(30, shallow) } };
  expect(() => view.publish(makeAcceptedPublication(candidate, "read"))).toThrow("staging bound exceeded");
  expect(view.current.revision).toBe(0);
});


it.each(["mixed", "all-work"] as const)("stages the legal maximum %s selected range plus eight local rows as one bounded graph", mode => {
  const rows = Array.from<unknown, HistoryItem>({ length: WINDOW_NODES * WINDOWS_HELD }, (_, ordinal) => ({
    node_id: `selected-${ordinal}`, kind: mode === "all-work" || ordinal % 7 === 3 ? "event" : "assistant_response", selection: { ordinal },
    ...(mode === "all-work" || ordinal % 7 === 3 ? {} : { items: [{ kind: "text" as const, item_identity: "text", text: `complete-${ordinal}`, text_complete: true }] }),
    provenance: { created_at: '2026-01-01', sender: { kind: 'human' } },
  }));
  const initial: WindowAcceptedSnapshot = { generation: 0, epoch: 0, disposed: false, rows: [],
    range: undefined, total: 0, revision: undefined, pending: true };
  const view = new AcceptedView(initial);
  const projection = projectHistoryWindowItems({ revision: 1, nodes: rows, keyScope: ["scope"] }).projection;
  const localRows = Array.from({ length: 8 }, (_, index) => ({ threadId: 't', scope: 'scope', operationId: `local-${index}`,
    text: `pending-${index}`, phase: 'accepted' as const, messageId: `pending-node-${index}`, plainMessageSend: true as const }));
  const decision = ownSendPresentation({ ref: initial, current: true, scope: 'scope', projection,
    localRows, canonicalRows: rows, hiddenItemKeys: new Set<string>(),
    path: { tail: true, empty: false, revision: 1, lastNodeId: rows.at(-1)?.node_id, lastOrdinal: rows.length - 1 },
    nodeOrdinals: new Map(rows.map((row, ordinal) => [row.node_id!, ordinal])),
    cohortVersion: { accepted: localRows, pending: undefined } });
  const localRegion = captureOwnSendLocalRegion(decision);
  const plan = createConversationDisplayPlan({ coverage: "complete", generation: 1, revision: 1, capability: view.currentCapability,
    rows, canonicalProjection: projection, projection: decision.projection, assistantFacts: [], scope: "scope",
    userDecision: { cohortVersion: { accepted: localRows, pending: undefined }, localRegion }, retiredAttempts: [] });
  const candidate: WindowAcceptedSnapshot = { ...initial, generation: 1, revision: 1, pending: false,
    rows, range: { first: 0, last: rows.length - 1 }, total: rows.length, displayPlan: plan };
  expect(view.publish(makeAcceptedPublication(candidate, "read"))).toBe(true);
  expect(view.current.rows).toHaveLength(WINDOW_NODES * WINDOWS_HELD);
  expect(view.current.displayPlan!.localRegion.localRows).toHaveLength(8);
  expect(view.current.displayPlan!.localRegion.placement).toEqual(localRegion.placement);
  expect(view.current.displayPlan!.localRegion.localRows[0]).toBe(view.current.displayPlan!.localRegion.cohort[0]);
  const entries = view.current.displayPlan!.entries;
  expect(entries).toHaveLength(rows.length);expect(entries[0]!.lifetime).toBe(entries[1]!.lifetime);
  if(mode==='mixed'){
    expect(entries[0]!.body).toMatchObject({ kind: "typed-canonical", text: "complete-0" });
    expect(entries.at(-2)!.body).toMatchObject({ kind: "typed-canonical", text: `complete-${rows.length - 2}` });
  }else{
    expect(entries.every(entry=>entry.work&&entry.item.classification?.headingCategory==='Notifications')).toBe(true);
    expect(view.current.displayPlan!.workGroups).toHaveLength(1);
    expect(view.current.displayPlan!.workGroups[0]!.memberKeys).toEqual(rows.map(row=>JSON.stringify(['node',row.node_id])));
    expect(view.current.displayPlan!.workGroups[0]!.executionIds).toEqual([]);
  }
  expect(entries.at(-1)!.work).toBeDefined();
});


it.each([Object.freeze(new Map()),Object.freeze(new Set()),Object.freeze(new Date(0))])("rejects frozen non-plain objects rather than retaining mutable internals %#", payload=>{
 const view=new AcceptedView({...page(0),payload:{}}),ref=view.current;
 expect(()=>view.publish(makeAcceptedPublication({...page(1,view.currentCapability),payload},'read'))).toThrow('plain data');
 if(payload instanceof Map){payload.set('later','mutation');expect(payload.size).toBe(1);}
 else if(payload instanceof Set){payload.add('later');expect(payload.size).toBe(1);}
 else if(payload instanceof Date){payload.setTime(1);expect(payload.getTime()).toBe(1);}
 else throw new Error('unsupported frozen-object fixture');
 expect(view.current).toBe(ref);expect(view.current.payload).toEqual({});expect(view.current.revision).toBe(0);
});
it('preserves only minted capability identity, not arbitrary frozen empty objects',()=>{
 const value=Object.freeze({}),view=new AcceptedView({...page(0),payload:value});
 const candidate={...page(1,view.currentCapability),payload:value};
 expect(view.publish(makeAcceptedPublication(candidate,'read'))).toBe(true);
 expect(view.current.payload).not.toBe(value);
 expect(view.current.displayPlan.capability).toBe(view.currentCapability);
});


it('rejects a changed input qualification after materialization without replacing the old reference',()=>{
 const view=new AcceptedView(page(0)),before=view.current;let current=true;
 const candidate=next(view,1);
 Object.defineProperty(candidate,'rows',{get(){current=false;return [{nodeId:'new'}];}});
 expect(view.publish(makeAcceptedPublication(candidate,'read',()=>current))).toBe(false);
 expect(view.current).toBe(before);expect(view.isCurrent(before)).toBe(true);
});
it('reentrant input qualification cannot replace a newer committed local cut',()=>{
 const view=new AcceptedView(page(0));let once=true;
 const candidate=makeAcceptedPublication(next(view,1),'read',()=>{if(once){once=false;publish(view,next(view,2));}return true;});
 expect(view.publish(candidate)).toBe(false);expect(view.current.revision).toBe(2);
});

it('captures an own prototype-named data field without prototype mutation or repeated getter evaluation',()=>{
 let reads=0;const nested={value:'kept'},source:Record<string,unknown>={};
 Object.defineProperty(source,'__proto__',{enumerable:true,get(){reads++;return nested;}});
 const view=new AcceptedView({...page(0),graph:{initial:true}});
 expect(view.publish(makeAcceptedPublication({...page(1,view.currentCapability),graph:source},'read'))).toBe(true);
 const graph=view.current.graph;
 expect(reads).toBe(1);expect(Object.prototype.hasOwnProperty.call(graph,'__proto__')).toBe(true);
 expect(Object.getPrototypeOf(graph)).toBe(Object.prototype);expect(Object.getOwnPropertyDescriptor(graph,'__proto__')?.value).toEqual(nested);
 expect(Object.isFrozen(graph)).toBe(true);
});
