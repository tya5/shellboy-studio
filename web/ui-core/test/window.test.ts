import { describe, expect, it } from "vitest";
import { flush } from "../../data/test/harness";
import { correctedScrollTop, READS_IN_FLIGHT, WINDOW_NODES, WINDOWS_HELD } from "../src/window";
import { rig, type Rig } from "./window-owner";

const VIEW = 600;
const args = (c: { args?: unknown }) => c.args as Record<string, number | string | undefined>;
function paint(r: Rig): void {
  const range = r.w.renderRange();
  if (range) r.w.measure(Array.from({ length: range.last - range.first + 1 }, (_, i) =>
    [range.first + i, r.w.itemAt(range.first + i)?.kind === "event" ? 0 : 40] as [number, number]));
}
async function open(total = 1000): Promise<Rig> {
  const r = await rig(total);
  await r.settle();
  paint(r);
  return r;
}
async function older(r: Rig): Promise<void> {
  r.w.view(0, VIEW, false);
  r.pause();
  await r.settle();
  paint(r);
}
const close = (r: Rig) => { r.w.dispose(); r.data.stop(); };

describe("opening and measured coordinates", () => {
  it("reads only the tail, never history.list, without allocating by the full total", async () => {
    const r = await open(1_000_000_000_000);
    expect(r.calls()).toHaveLength(1);
    expect(args(r.calls()[0]!)).toMatchObject({ before: WINDOW_NODES - 1, after: 0 });
    expect(r.t.calls("history.list")).toHaveLength(0);
    expect(r.w.renderRange()).toEqual({ first: 999_999_999_900, last: 999_999_999_999 });
    expect(r.w.measurementsHeld).toBeLessThanOrEqual(WINDOW_NODES);
    expect(r.w.offsetOf(999_999_999_900)).toBe(0);
    expect(r.w.status.value).toBe("ready");
    close(r);
  });
  it("does not use unmeasured or unheld rows in offsets", async () => {
    const r = await rig(1000);
    await r.settle();
    r.w.measure([[900, 40], [0, 999], [999, Number.NaN], [950, -1]]);
    expect(r.w.offsetOf(900)).toBe(0);
    expect(r.w.offsetOf(901)).toBe(40);
    expect(r.w.totalHeight()).toBe(40);
    close(r);
  });
  it("with the capability a hint does not walk history; without it the old reader runs", async () => {
    const withCap = await open(10);
    withCap.t.push({ t: "changed", thread_ids: ["t"], list: false });
    await withCap.settle();
    expect(withCap.t.calls("history.list")).toHaveLength(0);
    expect(withCap.handle.historyTick.value).toBeGreaterThan(0);
    const without = await rig(10, { capability: false });
    without.t.push({ t: "changed", thread_ids: ["t"], list: false });
    await flush();
    expect(without.t.calls("history.list").length).toBeGreaterThan(0);
    close(withCap); close(without);
  });
});

describe("bounded loaded edges", () => {
  it("holds at an unloaded edge during a fling, then requests only its adjacent window", async () => {
    const r = await open(100_000);
    const mark = r.calls().length;
    for (let i = 0; i < 50; i++) r.w.view(0, VIEW, false);
    expect(r.since(mark)).toHaveLength(0);
    expect(r.w.renderRange()).toEqual({ first: 99_900, last: 99_999 });
    r.pause();
    await r.settle();
    expect(r.since(mark).map((c) => args(c).ordinal)).toEqual([99_800]);
    expect(r.w.renderRange()).toEqual({ first: 99_800, last: 99_999 });
    close(r);
  });
  it("bounds in-flight reads and cancels a departed edge, dropping its late reply", async () => {
    const r = await open(100_000);
    r.w.view(0, VIEW, false); r.pause(); await flush();
    const sent = r.calls().at(-1)!;
    expect(args(sent).ordinal).toBe(99_800);
    expect(r.w.readsInFlight).toBeGreaterThan(0);
    expect(r.w.readsInFlight).toBeLessThanOrEqual(READS_IN_FLIGHT);
    r.w.view(2000, VIEW, false);
    expect(r.t.cancels()).toContain(sent.id);
    expect(r.w.readsInFlight).toBe(0);
    r.owner.answered.add(sent.id);
    const response = r.owner.answer(sent);
    if (response.ok) r.t.ok(sent.id, response.result);
    await flush();
    expect(r.w.isLoaded(99_800)).toBe(false);
    close(r);
  });
  it("evicts opposite edges and their measurements during sustained bidirectional reading", async () => {
    const r = await open(10_000);
    for (let k = 0; k < 40; k++) {
      await older(r);
      expect(r.w.windowsHeld).toBeLessThanOrEqual(WINDOWS_HELD);
      expect(r.w.measurementsHeld).toBeLessThanOrEqual(WINDOWS_HELD * WINDOW_NODES);
    }
    expect(r.w.renderRange()).toEqual({ first: 5900, last: 7499 });
    expect(r.w.isLoaded(9999)).toBe(false);
    for (let k = 0; k < 20; k++) {
      r.w.view(r.w.totalHeight() - VIEW, VIEW, true); r.pause(); await r.settle(); paint(r);
      expect(r.w.following.value).toBe(false); // a loaded edge is not the Thread's end
      expect(r.w.windowsHeld).toBeLessThanOrEqual(WINDOWS_HELD);
    }
    expect(r.w.renderRange()).toEqual({ first: 7900, last: 9499 });
    close(r);
  });
  it("never walks older pages automatically when the loaded content fits", async () => {
    const r = await open(100_000);
    for (let i = 0; i < 30; i++) { r.w.view(0, VIEW, true); r.pause(); await r.settle(); }
    expect(r.calls()).toHaveLength(1);
    r.w.requestOlder(); await r.settle();
    expect(r.calls()).toHaveLength(2);
    expect(r.w.following.value).toBe(true);
    close(r);
  });
  it("does not redraw for a pixel-only move within the same loaded run", async () => {
    const r = await open();
    r.w.view(800, VIEW, false);
    const version = r.w.version.value;
    r.w.view(840, VIEW, false);
    expect(r.w.version.value).toBe(version);
    close(r);
  });
  it("notifies and switches the rendered run when jumping to a disjoint held tail", async () => {
    const r = await open(10_000);
    for (let k = 0; k < 20; k++) await older(r);
    expect(r.w.renderRange()!.last).toBeLessThan(9999);
    const version = r.w.version.value;
    r.w.view(0, VIEW, false); // an old edge timer must not outlive explicit navigation
    r.w.jumpToEnd(); r.pause(); await r.settle();
    expect(r.w.renderRange()).toEqual({ first: 9900, last: 9999 });
    expect(r.w.rangeItems().at(-1)?.node_id).toBe("n0-9999");
    expect(r.w.version.value).toBeGreaterThan(version);
    close(r);
  });
});

describe("keeping position", () => {
  it("corrects only the measured change above the anchor", () => {
    expect(correctedScrollTop(1000, 500, 620)).toBe(1120);
    expect(correctedScrollTop(1000, 500, 500)).toBe(1000);
    expect(correctedScrollTop(1000, 500, 450)).toBe(950);
  });
  it("preserves a detached node and its offset through prepend and above/below measurements", async () => {
    const r = await open();
    r.w.view(405, VIEW, false);
    const anchor = r.w.anchor(405);
    expect(anchor.nodeId).toBeDefined();
    r.w.takeScroll();
    r.w.measure([[950, 500]]);
    expect(r.w.takeScroll()).toBeUndefined();
    r.w.measure([[905, 80]]);
    expect(r.w.takeScroll()).toBe(445);
    expect(r.w.anchor(r.w.scrollTop)).toEqual(anchor);
    r.w.view(r.w.scrollTop, VIEW, false); r.pause(); await r.settle(); paint(r);
    expect(r.w.anchor(r.w.scrollTop)).toEqual(anchor);
    expect(r.w.following.value).toBe(false);
    close(r);
  });
  it("preserves the row below the caption when prepending at scrollTop zero", async () => {
    const r = await open();
    r.w.view(-102, VIEW, false);
    const anchor = r.w.anchor(-102);
    r.pause(); await r.settle(); paint(r);
    expect(r.w.offsetOf(anchor.ordinal) - r.w.scrollTop).toBe(102);
    close(r);
  });
  it("retains the anchor during opposite-edge eviction", async () => {
    const r = await open(5000);
    for (let k = 0; k < WINDOWS_HELD; k++) await older(r);
    r.w.view(200, VIEW, false);
    const anchor = r.w.anchor(200);
    r.pause(); await r.settle(); paint(r);
    expect(r.w.anchor(r.w.scrollTop)).toEqual(anchor);
    close(r);
  });
});

describe("append, rewind and delayed replies", () => {
  it("keeps windows after a verified append while reading an older edge", async () => {
    const r = await open(500);
    r.owner.append(3);
    await older(r);
    expect(r.w.pathChanged.value).toBe(false);
    expect(r.w.total).toBe(503);
    expect(r.w.isLoaded(450)).toBe(true);
    expect(r.w.isLoaded(300)).toBe(true);
    close(r);
  });
  it("recovers at the same node after a revision rewrite that preserves it", async () => {
    const r = await open(5000);
    r.w.view(200, VIEW, false);
    const anchor = r.w.anchor(200);
    r.owner.revision++;
    r.pause(); await r.settle(); paint(r);
    expect(r.w.pathChanged.value).toBe(false);
    expect(r.w.anchor(r.w.scrollTop)).toEqual(anchor);
    close(r);
  });
  it("recovers a surviving node at its new ordinal after compaction", async () => {
    const r = await open(5000);
    r.w.view(205, VIEW, false);
    const anchor = r.w.anchor(205);
    r.owner.rewrite(3000);
    const at = 2400;
    r.owner.decorate = (i, item) => i === at ? { ...item, node_id: anchor.nodeId, kind: "user" } : item;
    const answer = r.owner.answer.bind(r.owner);
    r.owner.answer = (call) => (call.args as { node_id?: string }).node_id === anchor.nodeId
      ? answer({ ...call, args: { ...call.args as object, node_id: undefined, ordinal: at } }) : answer(call);
    r.pause(); await r.settle(); paint(r);
    expect(r.w.pathChanged.value).toBe(true);
    expect(r.w.anchor(r.w.scrollTop)).toEqual({ ...anchor, ordinal: at });
    close(r);
  });
  it("recovers at the nearest surviving ordinal when the anchor node is removed", async () => {
    const r = await open(5000);
    for (let i = 0; i < 25; i++) await older(r);
    r.w.view(200, VIEW, false);
    const anchor = r.w.anchor(200);
    r.owner.rewrite(3000);
    r.pause(); await r.settle(); paint(r);
    expect(r.w.pathChanged.value).toBe(true);
    expect(r.w.total).toBe(3000);
    expect(r.w.following.value).toBe(false);
    expect(r.w.anchor(r.w.scrollTop).ordinal).toBe(anchor.ordinal);
    expect(r.w.rangeItems().every((item) => item.node_id?.startsWith("n1-"))).toBe(true);
    close(r);
  });
  it("falls back to the new tail after a rewind removes the anchor ordinal too", async () => {
    const r = await open(5000);
    r.w.view(200, VIEW, false);
    r.owner.rewrite(2500);
    r.pause(); await r.settle(); paint(r);
    expect(r.w.pathChanged.value).toBe(true);
    expect(r.w.total).toBe(2500);
    expect(r.w.following.value).toBe(false);
    expect(r.w.renderRange()!.last).toBe(2499);
    close(r);
  });
});

describe("following and leaving", () => {
  it("reads only after the known tail for a small append", async () => {
    const r = await open(300);
    r.w.view(r.w.totalHeight() - VIEW, VIEW, true);
    r.owner.append(2);
    const mark = r.calls().length;
    r.w.changed(); await r.settle();
    expect(r.since(mark)).toHaveLength(1);
    expect(args(r.since(mark)[0]!)).toMatchObject({ ordinal: 299, before: 0, expect_node_id: "n0-299" });
    expect(r.w.total).toBe(302);
    expect(r.w.isLoaded(301)).toBe(true);
    expect(r.w.following.value).toBe(true);
    close(r);
  });
  it("jumps across a large append with two bounded reads, not a walk", async () => {
    const r = await open(300);
    r.owner.append(100_000);
    const mark = r.calls().length;
    r.w.changed(); await r.settle();
    expect(r.since(mark)).toHaveLength(2);
    expect(r.w.renderRange()).toEqual({ first: 100_200, last: 100_299 });
    expect(r.w.windowsHeld).toBeLessThanOrEqual(WINDOWS_HELD);
    close(r);
  });
  it("stays put on detached hints and offers an explicit return to the end", async () => {
    const r = await open(300);
    r.w.view(200, VIEW, false);
    const mark = r.calls().length;
    r.owner.append(5); r.w.changed(); r.w.changed(); await r.settle();
    expect(r.since(mark)).toHaveLength(0);
    expect(r.w.newer.value).toBe(true);
    r.w.jumpToEnd(); await r.settle();
    expect(r.w.total).toBe(305);
    expect(r.w.following.value).toBe(true);
    expect(r.w.newer.value).toBe(false);
    close(r);
  });
  it("recovers a rewritten followed tail", async () => {
    const r = await open(300);
    r.owner.rewrite(120); r.w.changed(); await r.settle();
    expect(r.w.pathChanged.value).toBe(true);
    expect(r.w.total).toBe(120);
    expect(r.w.isLoaded(119)).toBe(true);
    close(r);
  });
  it("preserves the old run while navigating, and cancels a late tail on upward motion", async () => {
    const r = await open(10_000);
    for (let i = 0; i < 20; i++) await older(r);
    const range = r.w.renderRange();
    r.w.jumpToEnd(); await flush();
    const pending = r.calls().at(-1)!;
    expect(r.w.pendingNavigation).toBe(true);
    expect(r.w.renderRange()).toEqual(range);
    r.w.view(200, VIEW, false);
    expect(r.t.cancels()).toContain(pending.id);
    expect(r.w.pendingNavigation).toBe(false);
    const result = r.owner.answer(pending);
    r.owner.answered.add(pending.id);
    if (result.ok) r.t.ok(pending.id, result.result);
    await flush();
    expect(r.w.following.value).toBe(false);
    expect(r.w.renderRange()).toEqual(range);
    close(r);
  });
  it("allows retry after a failed explicit tail navigation", async () => {
    const r = await open();
    r.w.view(200, VIEW, false);
    r.w.jumpToEnd(); await flush();
    const pending = r.calls().at(-1)!;
    r.owner.answered.add(pending.id);
    r.t.ownerError(pending.id, "io_failed", "synthetic read failure"); await flush();
    expect(r.w.pendingNavigation).toBe(false);
    expect(r.w.error.value).toBe("synthetic read failure");
    r.w.retry(); await r.settle();
    expect(r.w.following.value).toBe(true);
    expect(r.w.error.value).toBeUndefined();
    close(r);
  });
  it("cancels active reads and sends nothing after disposal", async () => {
    const r = await open(100_000);
    r.w.view(0, VIEW, false); r.pause(); await flush();
    expect(r.w.readsInFlight).toBeGreaterThan(0);
    const pending = r.calls().filter((c) => !r.owner.answered.has(c.id)).map((c) => c.id);
    r.w.dispose();
    for (const id of pending) expect(r.t.cancels()).toContain(id);
    const mark = r.t.sent.length;
    r.w.view(0, VIEW, false); r.w.changed(); r.pause(); await r.settle();
    expect(r.t.sent.length).toBe(mark);
    r.data.stop();
  });
});
