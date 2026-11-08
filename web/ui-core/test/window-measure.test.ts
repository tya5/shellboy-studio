// Deterministic counts and resource bounds on synthetic history, not browser timings.
import { describe, expect, it } from "vitest";
import { flush } from "../../data/test/harness";
import { WINDOW_NODES, WINDOWS_HELD } from "../src/window";
import { rig } from "./window-owner";

describe("100,000-node sustained reading", () => {
  it("bounds storage, edge reads, fling reads and shutdown", async () => {
    const r = await rig(100_000);
    await r.settle();
    const paint = () => {
      const range = r.w.renderRange()!;
      r.w.measure(Array.from({ length: range.last - range.first + 1 }, (_, i) => [range.first + i, 120] as [number, number]));
    };
    paint();
    expect(r.calls()).toHaveLength(1);
    const mark = r.calls().length;
    for (let k = 0; k < 100; k++) {
      r.w.view(0, 800, false); r.pause(); await r.settle(); paint();
      expect(r.w.windowsHeld).toBeLessThanOrEqual(WINDOWS_HELD);
      expect(r.w.measurementsHeld).toBeLessThanOrEqual(WINDOWS_HELD * WINDOW_NODES);
    }
    expect(r.calls().length - mark).toBe(100);
    const beforeDrag = r.calls().length;
    const height = r.w.totalHeight();
    for (let i = 0; i <= 300; i++) r.w.view((height - 800) * i / 300, 800, false);
    expect(r.calls().length).toBe(beforeDrag);
    r.pause(); await flush();
    expect(r.w.readsInFlight).toBe(1);
    const sent = r.t.sent.length;
    r.w.dispose();
    const cancelFrames = r.t.sent.length - sent;
    expect(cancelFrames).toBe(1);
    const stopped = r.t.sent.length;
    r.w.view(0, 800, false); r.w.changed(); r.pause(); await r.settle();
    expect(r.t.sent.length).toBe(stopped);
    expect(r.t.calls("history.list")).toHaveLength(0);
    console.log("MEASURED " + JSON.stringify({ openCalls: 1, olderEdges: 100, edgeCalls: r.calls().length - mark - 1,
      windowsHeld: r.w.windowsHeld, measurementsHeld: r.w.measurementsHeld, dragMoves: 301, callsDuringDrag: 0, cancelFrames }));
    r.data.stop();
  });
});
