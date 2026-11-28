import { describe, expect, it } from "vitest";
import { WINDOW_NODES } from "../src/window";
import { rig } from "./window-owner";

describe("loaded history edges", () => {
  it("starts at the loaded tail and prefetches the preceding window at its upper edge", async () => {
    const r = await rig(1000);
    await r.settle();
    expect(r.w.renderRange()).toEqual({ first: 900, last: 999 });
    r.w.view(0, 600, false);
    r.pause();
    await r.settle();
    expect(r.w.renderRange()).toEqual({ first: 800, last: 999 });
    r.w.dispose();
    r.data.stop();
  });
  it("evicts cold rows at byte pressure but not at the old count cap", async () => {
    const r = await rig(3000);
    await r.settle();
    for (let i = 0; i < 19; i++) {
      r.w.view(0, 600, false);
      r.pause();
      await r.settle();

    }
    expect(r.w.windowsHeld).toBeGreaterThan(16);
    expect(r.w.isLoaded(2999)).toBe(true);
    const budget = r.data.retainedBudget;
    const pinned = budget.usage.peek().pinned;
    expect(pinned).toBeGreaterThan(0);
    budget.setLimit(pinned);
    expect(budget.usage.peek().used).toBe(pinned);
    const range = r.w.renderRange();
    expect(range).toBeDefined();
    expect(range!.first).toBeLessThan(3000 - WINDOW_NODES);
    expect(range!.last).toBeLessThan(2999);
    r.w.dispose();
    r.data.stop();
  });

  it("keeps the visible page when pins prevent admission and retries only when requested", async () => {
    const r = await rig(1000);
    try {
      await r.settle();
      r.w.view(0, 600, false);
      const budget = r.data.retainedBudget;
      budget.setLimit(budget.usage.peek().pinned);
      const before = r.calls().length;
      r.pause();
      await r.settle();
      expect(r.calls()).toHaveLength(before + 1);
      expect(r.w.renderRange()).toEqual({ first: 900, last: 999 });
      expect(r.w.error.value).toMatch(/budget/i);
      budget.setLimit(64 * 1024 * 1024);
      await r.settle();
      expect(r.calls()).toHaveLength(before + 1);
      r.w.retry();
      await r.settle();
      expect(r.calls()).toHaveLength(before + 2);
      expect(r.w.renderRange()).toEqual({ first: 800, last: 999 });
      expect(r.w.error.value).toBeUndefined();
    } finally { r.w.dispose(); r.data.stop(); }
  });

});
