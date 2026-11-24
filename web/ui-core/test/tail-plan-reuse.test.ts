import { expect, it } from "vitest";
import { canonicalAttemptId } from "../../data/test/work-fixture";
import { rig } from "./window-owner";

it("streams a changed tail without rebuilding any retained plan entries", async () => {
  const f = await rig(4_000);
  const active = canonicalAttemptId(2), ended = canonicalAttemptId(1);
  try {
    await f.settle();
    const saved = f.w.acceptedView.peek();
    expect(saved.rows.length).toBeGreaterThanOrEqual(100);
    expect(saved.displayPlan!.entries.length).toBeGreaterThan(0);
    f.producer.emitLive(ended, 0, "first");
    f.producer.emitLive(active, 0, "second");
    expect(f.w.refreshConversationInput(saved)).toBe(true);
    const initial = f.w.acceptedView.peek();
    expect(initial.displayPlan!.entries).toBe(saved.displayPlan!.entries);
    expect(initial.displayPlan!.sequence).toBe(saved.displayPlan!.sequence);
    const unchanged = initial.displayPlan!.localRegion.tailRows.find(row => row.kind === "live" && row.item.source.attemptId === ended);
    expect(unchanged?.kind).toBe("live");
    f.producer.emitLive(active, 6, " more");
    expect(f.w.refreshConversationInput(initial)).toBe(true);
    const next = f.w.acceptedView.peek();
    expect(next.generation).toBeGreaterThan(initial.generation);
    expect(f.w.acceptedView.isCurrent(initial)).toBe(false);
    expect(next.displayPlan!.entries).toBe(saved.displayPlan!.entries);
    const rows = next.displayPlan!.localRegion.tailRows;
    expect(rows.find(row => row.kind === "live" && row.item.source.attemptId === active)).toMatchObject({ item: { source: { text: "second more" } } });
    expect(rows.find(row => row.kind === "live" && row.item.source.attemptId === ended)).toMatchObject({ kind: "live" });
    const second = rows.find(row => row.kind === "live" && row.item.source.attemptId === ended);
    if (second?.kind === "live" && unchanged?.kind === "live") expect(second.item).toBe(unchanged.item);
  } finally { f.w.dispose(); f.data.stop(); }
});
