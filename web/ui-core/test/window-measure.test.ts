// Deterministic work and storage bounds on synthetic history, not browser timings.
import { describe, expect, it } from "vitest";
import { flush } from "../../data/test/harness";
import type { HistoryWindowArgs } from "../../data/src";
import { WINDOW_NODES } from "../src/window";
import { rig } from "./window-owner";

describe("100,000-node sustained reading", () => {
  it("reads and builds only bounded windows while scrolling and cancels the pending read on close", async () => {
    const started = performance.now();
    const total = 100_000;
    const olderEdges = 17;
    let itemsMaterialized = 0;
    let peakRowsBuilt = 0;
    const r = await rig(total, { decorate: (_ordinal, item) => { itemsMaterialized++; return item; } });
    try {
      r.data.retainedBudget.setLimit(310_000);
      const readAndMeasure = async () => {
        const before = itemsMaterialized;
        await r.settle();
        expect(itemsMaterialized - before).toBe(WINDOW_NODES);
        const request = r.calls().at(-1)!.args as HistoryWindowArgs;
        expect((request.before ?? 0) + (request.after ?? 0) + 1).toBe(WINDOW_NODES);
        const accepted = r.w.acceptedView.current;
        expect(accepted.total).toBe(total);
        expect(accepted.rows.length).toBeGreaterThan(0);
        expect(r.data.retainedBudget.usage.peek().used).toBeLessThanOrEqual(310_000);
        peakRowsBuilt = Math.max(peakRowsBuilt, accepted.rows.length);
        r.w.measure(accepted.rows.map(row => [row.selection!.ordinal!, 120] as const));
        expect(r.w.measurementsHeld).toBeLessThanOrEqual(accepted.rows.length);
      };
      await readAndMeasure();
      expect(r.calls()).toHaveLength(1);
      for (let k = 0; k < olderEdges; k++) {
        r.w.view(0, 800, false); r.pause(); await readAndMeasure();
        expect(r.calls()).toHaveLength(k + 2);
      }
      expect(r.w.isLoaded(total - 1)).toBe(false);
      expect(itemsMaterialized).toBe((1 + olderEdges) * WINDOW_NODES);

      const beforeDrag = r.calls().length;
      const beforeDragItems = itemsMaterialized;
      const height = r.w.totalHeight();
      const dragMoves = 301;
      for (let i = 0; i < dragMoves; i++) r.w.view((height - 800) * i / (dragMoves - 1), 800, false);
      expect(r.calls()).toHaveLength(beforeDrag);
      expect(itemsMaterialized).toBe(beforeDragItems);
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
      console.log("MEASURED " + JSON.stringify({ total, openCalls: 1, olderEdges, edgeCalls: beforeDrag - 1,
        peakRowsBuilt, itemsMaterializedBeforeDrag: beforeDragItems, dragMoves, callsDuringDrag: 0,
        cancelFrames, elapsedMs: Math.round(performance.now() - started) }));
    } finally {
      r.w.dispose();
      r.data.stop();
    }
  });
});
