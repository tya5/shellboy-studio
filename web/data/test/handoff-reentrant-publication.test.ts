import { expect, it } from "vitest";
import { Handoff } from "../src/handoff";

it("synchronous exact end during staged-record notification publishes the final empty ledger", () => {
  const h = new Handoff(fn => fn());
  h.apply({ attempt_id: "a", gap: false, deltas: [{ offset: 0, reasoning: false, text: "synthetic" }] }); h.finish();
  const original = h.records.peek()[0]!; const results: boolean[] = [], lengths: number[] = [];
  const stop = h.records.subscribe(records => {
    lengths.push(records.length);
    if (records[0]?.terminalPersisted) results.push(h.transfer("a", (_, end) => { end("end"); return true; }));
  });
  h.stageTerminalPersisted(original, { scope: "s", attemptId: "a", nodeIds: ["saved"], terminalState: "completed" });
  expect(results).toEqual([true]); expect(h.retainedBytes).toBe(0); expect(h.records.peek()).toEqual([]);
  expect(lengths.at(-1)).toBe(0); stop();
});
it("nested discard publishes only the current empty lifetime and invalidates the old transfer", () => {
  const h = new Handoff(fn => fn()); h.apply({ attempt_id: "a", gap: false, deltas: [{ offset: 0, reasoning: false, text: "x" }] }); h.finish();
  const original = h.records.peek()[0]!; let result: boolean | undefined;
  const stop = h.records.subscribe(records => {
    if (records[0]?.terminalPersisted) result = h.transfer("a", () => { h.discard("owner_restarted"); return true; });
  });
  h.stageTerminalPersisted(original, { scope: "s", attemptId: "a", nodeIds: ["n"], terminalState: "completed" });
  expect(result).toBe(false); expect(h.records.peek()).toEqual([]); expect(h.retainedBytes).toBe(0); stop();
});
it("a continuously mutating observer has a bounded synchronous publication burst", () => {
  const h = new Handoff(fn => fn()); h.apply({ attempt_id: "a", gap: false, deltas: [] });
  let calls = 0, armed = false;
  const stop = h.records.subscribe(() => { if (armed) { calls++; h.fail("a"); } });
  armed = true; const epoch = h.epoch; h.fail("a");
  expect(calls).toBeLessThanOrEqual(8); expect(h.epoch).toBeGreaterThan(epoch); expect(h.overflow.peek()).toBe(true); stop();
});
