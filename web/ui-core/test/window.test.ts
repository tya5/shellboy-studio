import { describe, expect, it } from "vitest";
import { flush } from "../../data/test/harness";
import { correctedScrollTop, ESTIMATED_ROW_PX, READS_IN_FLIGHT, WINDOW_NODES, WINDOWS_HELD } from "../src/window";
import { rig } from "./window-owner";

const VIEW = 600;
const args = (c: { args?: unknown }) => c.args as Record<string, number | string | undefined>;

describe("opening", () => {
  it("reads the last window by position and never walks the history", async () => {
    const r = await rig(100_000);
    await r.settle();
    expect(r.calls().length).toBe(1);
    expect(args(r.calls()[0]!)).toMatchObject({ before: WINDOW_NODES - 1, after: 0 });
    expect(args(r.calls()[0]!).ordinal).toBeUndefined();
    expect(r.t.calls("history.list").length).toBe(0);
    expect(r.w.total).toBe(100_000);
    expect(r.w.isLoaded(99_999)).toBe(true);
    expect(r.w.isLoaded(99_900)).toBe(true);
    expect(r.w.isLoaded(99_899)).toBe(false);
    expect(r.w.status.value).toBe("ready");
  });

  it("with the capability a hint reads nothing by itself; without it the old walk runs", async () => {
    const withCap = await rig(10);
    await withCap.settle();
    withCap.t.push({ t: "changed", thread_ids: ["t"], list: false });
    await withCap.settle();
    expect(withCap.t.calls("history.list").length).toBe(0);
    expect(withCap.handle.historyTick.value).toBeGreaterThan(0);
    const without = await rig(10, { capability: false });
    without.t.push({ t: "changed", thread_ids: ["t"], list: false });
    await flush();
    expect(without.t.calls("history.list").length).toBeGreaterThan(0);
  });
});

describe("requests follow what shows", () => {
  it("asks for nothing during a fling and for the margin only after a pause", async () => {
    const r = await rig(100_000);
    await r.settle();
    const mark = r.calls().length;
    for (let i = 0; i < 50; i++) r.w.view(1_000_000 + i * 5000, VIEW, false); // flung across
    expect(r.since(mark).length).toBe(0);
    r.pause();
    await r.settle();
    const sent = r.since(mark).map((c) => args(c).ordinal as number);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThanOrEqual(3); // the viewport and a viewport above and below
    for (const o of sent) expect(o % WINDOW_NODES).toBe(0);
  });

  it("keeps at most two reads in flight, nearest the viewport first", async () => {
    const r = await rig(100_000);
    await r.settle();
    r.w.view(400 * ESTIMATED_ROW_PX, 250 * ESTIMATED_ROW_PX, false); // spans four windows
    r.pause();
    await flush();
    const mark = r.calls().length - READS_IN_FLIGHT;
    expect(r.w.readsInFlight).toBe(READS_IN_FLIGHT);
    expect(r.since(mark).length).toBe(READS_IN_FLIGHT);
    await r.settle();
    expect(r.w.readsInFlight).toBe(0);
  });

  it("cancels a read that left the margin and drops its late reply", async () => {
    const r = await rig(100_000);
    await r.settle();
    r.w.view(5000 * ESTIMATED_ROW_PX, VIEW, false);
    r.pause();
    await flush();
    const sent = r.calls().at(-1)!;
    const ordinal = args(sent).ordinal as number;
    expect(r.w.readsInFlight).toBeGreaterThan(0);
    r.w.view(60_000 * ESTIMATED_ROW_PX, VIEW, false); // scrolled away
    expect(r.t.cancels()).toContain(sent.id);
    expect(r.w.readsInFlight).toBe(0);
    r.owner.answered.add(sent.id);
    r.t.ok(sent.id, r.owner.answer(sent).ok ? (r.owner.answer(sent) as { result: unknown }).result : {});
    await flush();
    expect(r.w.isLoaded(ordinal)).toBe(false);
  });

  it("holds at most 16 windows, dropping the least recently shown", async () => {
    const r = await rig(100_000);
    await r.settle();
    for (let k = 1; k <= 40; k++) {
      r.w.view(r.w.offsetOf(k * 1000), VIEW, false);
      r.pause();
      await r.settle();
      expect(r.w.windowsHeld).toBeLessThanOrEqual(WINDOWS_HELD);
    }
    expect(r.w.isLoaded(1000)).toBe(false);
    expect(r.w.isLoaded(40_000)).toBe(true);
    const mark = r.calls().length;
    r.w.view(1000 * ESTIMATED_ROW_PX, VIEW, false);
    r.pause();
    await r.settle();
    expect(r.since(mark).length).toBeGreaterThan(0); // read again, on demand
  });
});

describe("redrawing", () => {
  it("reports a change when the view moves to other rows, and not when it stays", async () => {
    const r = await rig(1000);
    await r.settle();
    r.w.view(0, VIEW, false);
    const v = r.w.version.value;
    r.w.view(0, VIEW, false);
    expect(r.w.version.value).toBe(v);
    r.w.view(300 * ESTIMATED_ROW_PX, VIEW, false);
    expect(r.w.version.value).toBeGreaterThan(v);
  });
});

describe("keeping position", () => {
  it("corrects the scroll offset by the height change above the anchor", () => {
    expect(correctedScrollTop(1000, 500, 620)).toBe(1120);
    expect(correctedScrollTop(1000, 500, 500)).toBe(1000);
    expect(correctedScrollTop(1000, 500, 450)).toBe(950);
  });

  it("asks for a corrected offset when rows above the viewport are measured", async () => {
    const r = await rig(1000);
    await r.settle();
    r.w.view(0, VIEW, false);
    r.w.view(500 * ESTIMATED_ROW_PX, VIEW, false);
    r.pause();
    await r.settle();
    r.w.takeScroll();
    const top = r.w.scrollTop;
    const anchor = r.w.anchor(top);
    r.w.measure([[10, 400], [20, 400]]); // two rows above grew by about 300 each
    const next = r.w.takeScroll();
    expect(next).toBeDefined();
    expect(r.w.offsetOf(anchor.ordinal) + anchor.offset).toBeCloseTo(next!, 5);
    expect(next!).not.toBeCloseTo(top, 0);
  });

  it("holds the anchor when a row below it is measured and the estimate for unread rows shifts", async () => {
    const r = await rig(1000);
    await r.settle();
    r.w.view(500 * ESTIMATED_ROW_PX, VIEW, false);
    r.w.takeScroll();
    const anchor = r.w.anchor(r.w.scrollTop);
    r.w.measure([[900, 500]]);
    const next = r.w.takeScroll() ?? r.w.scrollTop;
    expect(r.w.offsetOf(anchor.ordinal) + anchor.offset).toBeCloseTo(next, 5);
  });
});

describe("the path changes", () => {
  it("keeps everything after an append", async () => {
    const r = await rig(500);
    await r.settle();
    r.w.view(0, VIEW, false);
    r.owner.append(3);
    r.w.view(100 * ESTIMATED_ROW_PX, VIEW, false);
    r.pause();
    await r.settle();
    expect(r.w.pathChanged.value).toBe(false);
    expect(r.w.isLoaded(450)).toBe(true); // the tail window read before the append is still held
    expect(r.w.total).toBe(503);
  });

  it("drops all windows after a rewrite and re-reads at the anchor, with a note", async () => {
    const r = await rig(5000);
    await r.settle();
    r.w.view(2000 * ESTIMATED_ROW_PX, VIEW, false);
    r.pause();
    await r.settle();
    const anchorOrdinal = r.w.anchor(2000 * ESTIMATED_ROW_PX).ordinal;
    r.owner.rewrite(3000); // the old node ids are gone
    r.w.view(2200 * ESTIMATED_ROW_PX, VIEW, false);
    r.pause();
    await r.settle();
    expect(r.w.pathChanged.value).toBe(true);
    expect(r.w.total).toBe(3000);
    expect(r.w.isLoaded(0)).toBe(false); // no stale window survives
    expect(r.w.takeScroll()).toBeDefined();
    const near = r.w.takeScroll() ?? r.w.locate(r.w.offsetOf(2000));
    expect(Math.abs(near - anchorOrdinal)).toBeLessThan(WINDOW_NODES * 3);
    expect(r.w.status.value).toBe("ready");
  });

  it("does not jump a reader away from the middle after a rewind", async () => {
    const r = await rig(5000);
    await r.settle();
    r.w.view(2000 * ESTIMATED_ROW_PX, VIEW, false);
    r.pause();
    await r.settle();
    r.owner.rewrite(2500);
    r.w.view(2100 * ESTIMATED_ROW_PX, VIEW, false);
    r.pause();
    await r.settle();
    expect(r.w.following.value).toBe(false);
    const top = r.w.takeScroll();
    expect(top).toBeDefined();
    expect(r.w.locate(top!)).toBeLessThan(2500);
  });
});

describe("row spacing measurement", () => {
  it("retains the anchor and following state when padded row heights change", async () => {
    const r = await rig(300);
    await r.settle();
    r.w.view(100 * ESTIMATED_ROW_PX, VIEW, false);
    r.w.takeScroll();
    const anchor = r.w.anchor(r.w.scrollTop);
    r.w.measure([[10, ESTIMATED_ROW_PX + 8], [20, ESTIMATED_ROW_PX + 8]]);
    const next = r.w.takeScroll() ?? r.w.scrollTop;
    expect(r.w.offsetOf(anchor.ordinal) + anchor.offset).toBeCloseTo(next, 5);
    expect(r.w.following.value).toBe(false);
    r.w.view(r.w.totalHeight() - VIEW, VIEW, true);
    r.w.measure([[299, ESTIMATED_ROW_PX + 8]]);
    expect(r.w.following.value).toBe(true);
  });
});

describe("following", () => {
  it("follows again at the scroller's end, even when the last nodes draw nothing", async () => {
    const r = await rig(300);
    await r.settle();
    r.w.view(100 * ESTIMATED_ROW_PX, VIEW, false);
    expect(r.w.following.value).toBe(false);
    // A position that locates to a row before the last: hidden kinds have no height.
    r.w.view(100 * ESTIMATED_ROW_PX, VIEW, true);
    expect(r.w.following.value).toBe(true);
  });
  it("reads only after the last known node while at the bottom", async () => {
    const r = await rig(300);
    await r.settle();
    r.w.view(r.w.totalHeight() - VIEW, VIEW, true);
    expect(r.w.following.value).toBe(true);
    r.owner.append(2);
    const mark = r.calls().length;
    r.w.changed();
    await r.settle();
    const sent = r.since(mark);
    expect(sent.length).toBe(1);
    expect(args(sent[0]!)).toMatchObject({ ordinal: 299, before: 0 });
    expect(args(sent[0]!).expect_node_id).toBe("n0-299");
    expect(r.w.total).toBe(302);
    expect(r.w.isLoaded(301)).toBe(true);
    expect(r.w.following.value).toBe(true);
  });

  it("stays put and offers the newest when scrolled up, reading nothing", async () => {
    const r = await rig(300);
    await r.settle();
    r.w.view(100 * ESTIMATED_ROW_PX, VIEW, false);
    expect(r.w.following.value).toBe(false);
    const mark = r.calls().length;
    r.owner.append(5);
    r.w.changed();
    r.w.changed();
    await r.settle();
    expect(r.since(mark).length).toBe(0);
    expect(r.w.newer.value).toBe(true);
    r.w.jumpToEnd();
    await r.settle();
    expect(r.w.total).toBe(305);
    expect(r.w.following.value).toBe(true);
    expect(r.w.newer.value).toBe(false);
  });

  it("starts over when the path changed under a followed tail", async () => {
    const r = await rig(300);
    await r.settle();
    r.w.view(r.w.totalHeight() - VIEW, VIEW, true);
    r.owner.rewrite(120);
    r.w.changed();
    await r.settle();
    expect(r.w.pathChanged.value).toBe(true);
    expect(r.w.total).toBe(120);
    expect(r.w.isLoaded(119)).toBe(true);
  });
});

describe("leaving", () => {
  it("cancels what is running and sends nothing more", async () => {
    const r = await rig(100_000);
    await r.settle();
    r.w.view(30_000 * ESTIMATED_ROW_PX, VIEW, false);
    r.pause();
    await flush();
    expect(r.w.readsInFlight).toBeGreaterThan(0);
    const pending = r.calls().filter((c) => !r.owner.answered.has(c.id)).map((c) => c.id);
    r.w.dispose();
    for (const id of pending) expect(r.t.cancels()).toContain(id);
    const mark = r.t.sent.length;
    r.w.view(50_000 * ESTIMATED_ROW_PX, VIEW, false);
    r.w.changed();
    r.pause();
    await r.settle();
    expect(r.t.sent.length).toBe(mark);
  });
});
