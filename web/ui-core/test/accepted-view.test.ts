import { expect, it } from "vitest";
import { AcceptedView } from "../src/accepted-view";

const page = (revision: number) => ({ revision, total: 1, range: { first: 0, last: 0 }, rows: [{ nodeId: `n${revision}` }] });
it("S stages external getters before qualification and never swaps a stale staged page", () => {
  let valid = true;
  const view = new AcceptedView(page(1));
  const staged = view.stage({ get revision() { valid = false; return 2; }, total: 1, range: { first: 0, last: 0 }, rows: [{ nodeId: "n2" }] });
  expect(view.commit(staged, () => valid)).toBe(false);
  expect(view.current.revision).toBe(1); expect(view.current.rows[0]!.nodeId).toBe("n1");
});
it("C swaps one coherent immutable reference without retaining caller-owned rows", () => {
  const view = new AcceptedView(page(1)); const value = page(2); const staged = view.stage(value);
  value.rows[0]!.nodeId = "changed"; value.range.last = 8;
  expect(view.commit(staged, () => true)).toBe(true);
  expect(view.current).toEqual(page(2)); expect(Object.isFrozen(view.current.rows[0])).toBe(true);
});
it("N stops stale listeners after reentry and coalesces only the newest current reference", () => {
  const view = new AcceptedView(page(0)); const seen: string[] = [];
  view.subscribe(p => { seen.push(`a${p.revision}`); if (p.revision === 1) { view.commit(view.stage(page(2)), () => true); view.commit(view.stage(page(3)), () => true); } });
  view.subscribe(p => { seen.push(`b${p.revision}`); expect(p).toBe(view.current); });
  view.commit(view.stage(page(1)), () => true);
  expect(seen).toEqual(["a1", "a3", "b3"]);
});
it("N listener removal during notification does not notify a detached subscription", () => {
  const view = new AcceptedView(page(0)); let calls = 0; let stop = () => {};
  view.subscribe(() => stop()); stop = view.subscribe(() => { calls++; });
  view.commit(view.stage(page(1)), () => true); expect(calls).toBe(0);
});
it("finally releases only its notification frame even after listener throws", () => {
  const view = new AcceptedView(page(0)); const stop = view.subscribe(() => { throw new Error("synthetic listener"); });
  expect(() => view.commit(view.stage(page(1)), () => true)).toThrow("synthetic listener"); stop();
  let seen = 0; view.subscribe(p => { seen = p.revision; });
  view.commit(view.stage(page(2)), () => true); expect(seen).toBe(2);
});
