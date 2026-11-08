import { describe, expect, it } from "vitest";
import { WINDOW_NODES, WINDOWS_HELD } from "../src/window";
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
  it("evicts only the opposite edge and never exceeds the held-window bound", async () => {
    const r = await rig(3000);
    await r.settle();
    for (let i = 0; i < WINDOWS_HELD + 3; i++) {
      r.w.view(0, 600, false);
      r.pause();
      await r.settle();
      expect(r.w.windowsHeld).toBeLessThanOrEqual(WINDOWS_HELD);
    }
    const range = r.w.renderRange();
    expect(range).toBeDefined();
    expect(range!.first).toBeLessThan(3000 - WINDOW_NODES);
    expect(range!.last).toBeLessThan(2999);
    r.w.dispose();
    r.data.stop();
  });

});
