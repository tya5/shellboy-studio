import { expect, it } from "vitest";
import { ConversationWindow } from "../src/window";
import { flush } from "../../data/test/harness";
import type { HistoryItem } from "../../data/src";
import { rig } from "./window-owner";

it("publishes immutable coherent window tuples and stops obsolete notifications", async () => {
  const r = await rig(10); await r.settle();
  const first = r.w.acceptedView.peek();
  expect(first.total).toBe(10); expect(first.pending).toBe(false); expect(first.range).toEqual(r.w.renderRange());
  expect(first.rows).toEqual(r.w.rangeItems()); expect(Object.isFrozen(first.rows[0])).toBe(true);
  let nested = false; const seen: number[] = [];
  r.w.acceptedView.subscribe(() => { if (!nested) { nested = true; r.w.layoutChanged(); } });
  r.w.acceptedView.subscribe(ref => { expect(ref).toBe(r.w.acceptedView.peek()); seen.push(ref.generation); });
  r.w.layoutChanged(); expect(seen).toHaveLength(1); expect(seen[0]).toBe(r.w.acceptedView.peek().generation);
  expect(first.rows).toHaveLength(10); r.w.dispose(); expect(r.w.acceptedView.isCurrent(first)).toBe(false); r.data.stop();
});
it("scroll peek is non-consuming and only an unchanged current view consumes once without publication", async () => {
  const r = await rig(10); await r.settle();
  const original = r.w.acceptedView.peek(), request = r.w.peekScroll(original);
  expect(request).toBeDefined(); expect(r.w.peekScroll(original)).toBe(request);
  r.w.layoutChanged(); const next = r.w.acceptedView.peek();
  expect(r.w.consumeScroll(original, request!.id)).toBe(false);
  expect(r.w.peekScroll(next)).toBe(request);
  expect(r.w.consumeScroll(next, request!.id)).toBe(true);
  expect(r.w.acceptedView.peek()).toBe(next); expect(r.w.acceptedView.isCurrent(next)).toBe(true);
  expect(r.w.consumeScroll(next, request!.id)).toBe(false); r.w.dispose(); r.data.stop();
});
it("disposal revokes publication and request eligibility before cancellation callbacks", async () => {
  const r = await rig(10); await r.settle(); const ref = r.w.acceptedView.peek();
  const plan = r.w.peekScroll(ref); r.w.dispose();
  expect(r.w.acceptedView.isCurrent(ref)).toBe(false); expect(r.w.peekScroll(ref)).toBeUndefined();
  expect(r.w.consumeScroll(ref, plan!.id)).toBe(false); r.data.stop();
});

it("tail response publishes rows/range/total/revision coherently without treating pending as follow intent", async () => {
  const r = await rig(10); await r.settle();
  const before = r.w.acceptedView.peek();
  const seen: number[] = [];
  const stop = r.w.acceptedView.subscribe(ref => {
    expect(ref).toBe(r.w.acceptedView.peek());
    expect(ref.total).toBe(r.w.total);
    expect(ref.range).toEqual(r.w.renderRange());
    expect(ref.rows).toEqual(r.w.rangeItems());
    expect(ref.rows.every(row => row.selection!.ordinal! < ref.total)).toBe(true);
    expect(ref.revision).toBe(2); seen.push(ref.generation);
  });
  r.owner.append(2); r.w.changed();
  expect(r.w.following.peek()).toBe(true);
  r.w.following.value = false;
  expect(r.w.following.peek()).toBe(false);
  expect(r.w.acceptedView.peek()).toBe(before);
  await r.settle(); expect(seen.length).toBeGreaterThan(0);
  expect(r.w.acceptedView.peek().total).toBe(12);
  expect(r.w.following.peek()).toBe(false);
  stop(); r.w.dispose(); r.data.stop();
});

it("getter reentry during actual Window staging cannot overwrite a nested accepted generation", async () => {
  const row: HistoryItem = { node_id: "plain-local", kind: "user", excerpt: "local", selection: { ordinal: 0 } };
  const w = new ConversationWindow({ read: async () => ({ ok: true, value: { thread_id: "t", total: 1, revision: 1, items: [row] } }) });
  await flush(); let nested = false;
  Object.defineProperty(row, "syntheticGetter", { configurable: true, enumerable: true, get() {
    if (!nested) { nested = true; w.layoutChanged(); }
    return "materialized";
  } });
  const seen: number[] = [];
  const stop = w.acceptedView.subscribe(ref => seen.push(ref.generation));
  w.layoutChanged();
  expect(nested).toBe(true); expect(seen).toHaveLength(1);
  expect(seen[0]).toBe(w.acceptedView.peek().generation);
  stop(); w.dispose();
});

it("pending latest-tail evidence does not detach follow intent at the loaded bottom", async () => {
  const replies: ((value: { ok: true; value: { thread_id: string; total: number; revision: number; items: HistoryItem[] } }) => void)[] = [];
  const w = new ConversationWindow({ read: () => new Promise(resolve => { replies.push(resolve); }) });
  const rows = (first: number, last: number): HistoryItem[] => Array.from({ length: last - first + 1 }, (_, offset) => ({ node_id: `n${first + offset}`, kind: "user", excerpt: "local", selection: { ordinal: first + offset } }));
  replies.shift()!({ ok: true, value: { thread_id: "t", total: 100, revision: 1, items: rows(0, 99) } }); await flush();
  w.changed();
  replies.shift()!({ ok: true, value: { thread_id: "t", total: 1100, revision: 2, items: rows(99, 298) } }); await flush();
  expect(replies).toHaveLength(1);
  expect(w.following.peek()).toBe(true);
  w.view(0, 600, true); expect(w.following.peek()).toBe(true);
  w.view(0, 600, false); expect(w.following.peek()).toBe(false);
  w.view(0, 600, true); expect(w.following.peek()).toBe(false);
  w.dispose();
});
