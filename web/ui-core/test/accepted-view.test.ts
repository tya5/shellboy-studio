import { expect, it } from "vitest";
import { AcceptedView, makeAcceptedPublication } from "../src/accepted-view";

type Page = { generation: number; revision: number; displayPlan: { acceptedGeneration: number; revision: number; capability: object; entries: readonly unknown[] }; total: number; range: { first: number; last: number }; rows: { nodeId: string }[] };
const page = (revision: number, capability: object = Object.freeze({})): Page => {
  const displayPlan = Object.freeze({ acceptedGeneration: revision, revision, capability, entries: [] });
  return { generation: revision, revision, displayPlan, total: 1, range: { first: 0, last: 0 }, rows: [{ nodeId: `n${revision}` }] };
};
const next = (view: AcceptedView<Page>, revision: number) => page(revision, view.currentCapability);
const publish = (view: AcceptedView<Page>, value: Page, capability = view.currentCapability) =>
  view.publish(makeAcceptedPublication(value, "read"), capability);

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
