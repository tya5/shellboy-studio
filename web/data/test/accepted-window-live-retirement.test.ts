import { describe, expect, it } from "vitest";
import { Handoff } from "../src/handoff";
import { RetainedBudget } from "../src/retained-budget";

describe("accepted window live retirement", () => {
  it("keeps the ordinary live preview until explicit accepted release", () => {
    let ordinal = 0;
    const h = new Handoff(fn => fn(), () => ++ordinal);
    h.apply({ attempt_id: "live", gap: false, deltas: [{ offset: 0, reasoning: false, text: "saved body" }] });
    h.finish();
    expect(h.records.value[0]?.text).toBe("saved body");
    h.releaseAccepted("live");
    expect(h.records.value).toEqual([]);
  });

  it("retains over eight admitted previews and preserves their pins under mixed-holder pressure", () => {
    const budget = new RetainedBudget(32_768);
    let ordinal = 0;
    const h = new Handoff(fn => fn(), () => ++ordinal, budget);
    let evicted = false;
    expect(budget.reserve(4096, () => { evicted = true; })).toBeDefined();
    for (let i = 0; i < 10; i++) {
      h.apply({ attempt_id: `a-${i}`, gap: false, deltas: [{ offset: 0, reasoning: false, text: "x".repeat(1024) }] });
    }
    expect(h.records.value.map(record => record.attemptId)).toEqual(Array.from({ length: 10 }, (_, i) => `a-${i}`));
    budget.setLimit(budget.usage.peek().pinned);
    expect(evicted).toBe(true);
    expect(h.records.value[0]?.text).toBe("x".repeat(1024));
    h.discard("owner_restarted");
    expect(budget.usage.peek().used).toBe(0);
  });

  it("does not forget old terminal evidence or resurrect an attempt when dedup admission fails", () => {
    const budget = new RetainedBudget();
    const h = new Handoff(fn => fn(), () => 1, budget);
    for (let i = 0; i < 260; i++) h.end(`done-${i}`, "not_adopted");
    const live = (id: string) => h.apply({ attempt_id: id, gap: false, deltas: [{ offset: 0, reasoning: false, text: id }] });
    live("done-0");
    expect(h.records.value).toEqual([]);
    budget.setLimit(budget.usage.peek().pinned);
    h.end("newly-ended", "not_adopted");
    expect(h.overflow.value).toBe(true);
    budget.setLimit(64 * 1024 * 1024);
    live("newly-ended");
    expect(h.records.value).toEqual([]);
    h.discard("resync");
    live("new-authority");
    expect(h.records.value[0]?.text).toBe("new-authority");
  });
});
