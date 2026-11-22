import { expect, it } from "vitest";
import { seedUnreadMarkers, isUnread, markUnread, UNREAD_LIMIT } from "../src/sidebar-unread";

const old = { node_id: "old", at: "2026-01-01T00:00:00Z" };
const next = { node_id: "next", at: "2026-01-02T00:00:00Z" };

it("starts read and bolds a different completion, including a rewind, but not a metadata edit", () => {
  expect(isUnread(undefined, old)).toBe(false);
  const [baseline] = seedUnreadMarkers([], [{ thread_id: "t", last_end_message: old }]);
  expect(isUnread(baseline, { ...old })).toBe(false);
  expect(isUnread(baseline, next)).toBe(true);
  const [read] = markUnread([], "t", next, false);
  expect(isUnread(read, old)).toBe(true);
  expect(isUnread(read, undefined)).toBe(false);
});

it("never flags an empty Thread, even when manually marked", () => {
  const unread = markUnread([], "t", undefined, true);
  expect(isUnread(unread[0], undefined)).toBe(false);
  expect(isUnread(markUnread(unread, "t", undefined, false)[0], undefined)).toBe(false);
  const [empty] = seedUnreadMarkers([], [{ thread_id: "new" }]);
  expect(isUnread(empty, next)).toBe(true);
});

it("bounds retention without deleting records merely hidden by a list filter", () => {
  let records: ReturnType<typeof markUnread> = [];
  for (let i = 0; i <= UNREAD_LIMIT; i++) records = markUnread(records, `t-${i}`, old, false);
  expect(records).toHaveLength(UNREAD_LIMIT);
  expect(records[0]?.thread).toBe("t-1");
  expect(records.at(-1)?.thread).toBe(`t-${UNREAD_LIMIT}`);
  expect(markUnread(records, `t-${UNREAD_LIMIT}`, old, false)).toBe(records);
});


it("reseeds evicted Threads as read without reviving an old marker", () => {
  let records = seedUnreadMarkers([], [{ thread_id: "gone", last_end_message: old }]);
  for (let i = 0; i < UNREAD_LIMIT; i++) records = markUnread(records, `t-${i}`, old, false);
  expect(records.some(r => r.thread === "gone")).toBe(false);
  const rows = [{ thread_id: "gone", last_end_message: next }];
  records = seedUnreadMarkers(records, rows);
  expect(records).toHaveLength(UNREAD_LIMIT);
  expect(records.at(-1)).toEqual({ thread: "gone", node: "next", manual: false });
  expect(isUnread(records.at(-1), next)).toBe(false);
  expect(seedUnreadMarkers(records, [{ thread_id: "gone", last_end_message: old }])).toBe(records);
});
