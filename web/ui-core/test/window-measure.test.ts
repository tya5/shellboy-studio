// Counts on a fake transport seeded with 100,000 nodes (docs/design/long-threads.md, "Measured").
// Rows are given 120 px when drawn, as a screen would measure them. Not browser timings.
import { describe, expect, it } from "vitest";
import { flush } from "../../data/test/harness";
import { rig, type Rig } from "./window-owner";

const VIEW = 800;
const NOTCH = 100;

function paint(r: Rig): void {
  const range = r.w.renderRange();
  if (!range) return;
  const changes: [number, number][] = [];
  for (let i = range.first; i <= range.last; i++) if (r.w.isLoaded(i) && r.w.itemAt(i)!.kind !== "event") changes.push([i, 120]);
  r.w.measure(changes);
}
async function at(r: Rig, top: number): Promise<void> {
  r.w.view(top, VIEW, false);
  r.pause();
  await r.settle();
  paint(r);
  r.w.takeScroll();
}
const windows = (r: Rig) => r.calls().length;

describe("100,000 nodes", () => {
  it("measures", async () => {
    const out: Record<string, unknown> = {};
    const r = await rig(100_000);
    await r.settle();
    out.open = { calls: windows(r), windowsHeld: r.w.windowsHeld, historyList: r.t.calls("history.list").length };

    // Wheel notches in the middle, pausing after each (a reader scrolling steadily).
    await at(r, r.w.offsetOf(50_000));
    let mark = windows(r);
    let top = r.w.scrollTop;
    for (let i = 0; i < 400; i++) {
      top += NOTCH;
      await at(r, top);
      top = r.w.scrollTop;
    }
    out.wheel = { notches: 400, calls: windows(r) - mark, callsPerNotch: (windows(r) - mark) / 400 };

    // A drag of the scrollbar from one end to the other: one view per pointer move, no pause.
    mark = windows(r);
    const cancelsBefore = r.t.cancels().length;
    const height = r.w.totalHeight();
    for (let i = 0; i <= 300; i++) r.w.view(((height - VIEW) * i) / 300, VIEW, false);
    const duringDrag = windows(r) - mark;
    r.pause();
    await r.settle();
    out.dragNoPause = { moves: 301, callsDuringDrag: duringDrag, callsAfter: windows(r) - mark, cancels: r.t.cancels().length - cancelsBefore };

    // The same drag with a pause every 20 moves (a slow drag).
    const slow = await rig(100_000);
    await slow.settle();
    mark = windows(slow);
    const h2 = slow.w.totalHeight();
    for (let i = 0; i <= 300; i++) {
      slow.w.view(((h2 - VIEW) * i) / 300, VIEW, false);
      if (i % 20 === 19) {
        slow.pause();
        await flush();
      }
    }
    slow.pause();
    await slow.settle();
    out.dragPausing = { moves: 301, calls: windows(slow) - mark, cancels: slow.t.cancels().length, completed: slow.calls().filter((c) => slow.owner.answered.has(c.id)).length - 1 };

    // Jump to the middle and back to the newest.
    const j = await rig(100_000);
    await j.settle();
    mark = windows(j);
    await at(j, j.w.offsetOf(50_000));
    const toMiddle = windows(j) - mark;
    mark = windows(j);
    j.w.jumpToEnd();
    await j.settle();
    paint(j);
    j.w.view(Math.max(0, j.w.totalHeight() - VIEW), VIEW, true);
    j.pause();
    await j.settle();
    out.jump = { toMiddleCalls: toMiddle, backCalls: windows(j) - mark, following: j.w.following.value };

    // Leaving mid-scroll.
    const l = await rig(100_000);
    await l.settle();
    l.w.view(l.w.offsetOf(30_000), VIEW, false);
    l.pause();
    await flush();
    const inflight = l.w.readsInFlight;
    const sent = l.t.sent.length;
    l.w.dispose();
    const cancelled = l.t.cancels().length;
    l.w.view(l.w.offsetOf(70_000), VIEW, false);
    l.w.changed();
    l.pause();
    await l.settle();
    out.leave = { inFlightWhenLeft: inflight, cancelFrames: cancelled, framesSentAfter: l.t.sent.length - sent - cancelled };

    console.log("MEASURED " + JSON.stringify(out));
    expect((out.leave as { framesSentAfter: number }).framesSentAfter).toBe(0);
    expect((out.open as { historyList: number }).historyList).toBe(0);
    expect((out.dragNoPause as { callsDuringDrag: number }).callsDuringDrag).toBe(0);
  });
});
