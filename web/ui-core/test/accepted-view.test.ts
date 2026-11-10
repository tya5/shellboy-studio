import { expect, it } from "vitest";
import { AcceptedView } from "../src/accepted-view";

const page = (revision: number) => ({ revision, total: 1, range: { first: 0, last: 0 }, rows: [{ nodeId: `n${revision}` }] });
it("S stages external getters before qualification and never swaps a stale staged page", () => {
  const view = new AcceptedView(page(1));
  const staged = view.stage({ get revision() { view.revoke(); return 2; }, total: 1, range: { first: 0, last: 0 }, rows: [{ nodeId: "n2" }] });
  expect(view.commit(staged)).toBe(false);
  expect(view.current.revision).toBe(1); expect(view.current.rows[0]!.nodeId).toBe("n1");
});
it("C swaps one coherent immutable reference without retaining caller-owned rows", () => {
  const view = new AcceptedView(page(1)); const value = page(2); const staged = view.stage(value);
  value.rows[0]!.nodeId = "changed"; value.range.last = 8;
  expect(view.commit(staged)).toBe(true);
  expect(view.current).toEqual(page(2)); expect(Object.isFrozen(view.current.rows[0])).toBe(true);
});
it("N stops stale listeners after reentry and coalesces only the newest current reference", () => {
  const view = new AcceptedView(page(0)); const seen: string[] = [];
  view.subscribe(p => { seen.push(`a${p.revision}`); if (p.revision === 1) { view.commit(view.stage(page(2))); view.commit(view.stage(page(3))); } });
  view.subscribe(p => { seen.push(`b${p.revision}`); expect(p).toBe(view.current); });
  view.commit(view.stage(page(1)));
  expect(seen).toEqual(["a1", "a3", "b3"]);
});
it("N listener removal during notification does not notify a detached subscription", () => {
  const view = new AcceptedView(page(0)); let calls = 0; let stop = () => {};
  view.subscribe(() => stop()); stop = view.subscribe(() => { calls++; });
  view.commit(view.stage(page(1))); expect(calls).toBe(0);
});
it("finally releases only its notification frame even after listener throws", () => {
  const view = new AcceptedView(page(0)); const stop = view.subscribe(() => { throw new Error("synthetic listener"); });
  expect(() => view.commit(view.stage(page(1)))).toThrow("synthetic listener"); stop();
  let seen = 0; view.subscribe(p => { seen = p.revision; });
  view.commit(view.stage(page(2))); expect(seen).toBe(2);
});

it("rejects a previously captured capability after revoke, without reviving display qualification", () => {
  const v = new AcceptedView(page(1)), cap = v.currentCapability, ref = v.current;
  v.revoke(); expect(v.isCurrent(ref)).toBe(false);
  expect(v.commit(v.stage(page(2), cap))).toBe(false);
  expect(v.commit(v.stage(page(3), v.currentCapability))).toBe(true);
});
it("a getter's nested publication wins over the outer staging slot", () => {
  const v = new AcceptedView(page(0));
  const stage = v.stage({ get revision() { v.commit(v.stage(page(3))); return 2; }, total: 1, range: { first: 0, last: 0 }, rows: [] });
  expect(v.commit(stage)).toBe(false); expect(v.current.revision).toBe(3);
});
it("dispose during notification stops all remaining listeners and future publication", () => {
  const v = new AcceptedView(page(0)); let calls = 0;
  v.subscribe(() => v.dispose()); v.subscribe(() => { calls++; });
  v.commit(v.stage(page(1))); expect(calls).toBe(0); expect(v.commit(v.stage(page(2)))).toBe(false);
});
it("revocation during notification stops the old generation even without a replacement", () => {
  const v = new AcceptedView(page(0)); let calls = 0;
  v.subscribe(() => v.revoke()); v.subscribe(() => { calls++; });
  v.commit(v.stage(page(1))); expect(calls).toBe(0);
});
it("only the latest bounded staging slot can commit", () => {
  const v = new AcceptedView(page(0)), a = v.stage(page(1)), b = v.stage(page(2));
  expect(v.commit(a)).toBe(false); expect(v.commit(b)).toBe(true); expect(v.commit(b)).toBe(false);
});
it("rejects mutable collection payloads and cycles before publication", () => {
  const v = new AcceptedView<unknown>({}); const cycle: { self?: unknown } = {}; cycle.self = cycle;
  expect(() => v.stage(new Map())).toThrow("plain data"); expect(() => v.stage(cycle)).toThrow("acyclic");
  expect(v.current).toEqual({});
});
it("coalesces repeated trailing reentry into one owned scheduled current notification", async () => {
  const v = new AcceptedView(page(0)); const seen: number[] = [];
  v.subscribe(p => { if (p.revision < 4) v.commit(v.stage(page(p.revision + 1))); });
  v.subscribe(p => seen.push(p.revision)); v.commit(v.stage(page(1)));
  await Promise.resolve(); expect(seen).toEqual([4]);
});
