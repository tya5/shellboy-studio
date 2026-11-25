import { expect, it } from "vitest";
import { ReplyPages } from "../src/replies";
import { ShellboyData } from "../src/store";
import { FakeTransport, connected, flush, pendingReply } from "./harness";

it("qualifies the owed page by the recipient and preserves the saved CLI sender", async () => {
  const transport = new FakeTransport();
  const data = new ShellboyData({ transport });
  data.start(); transport.open();
  transport.push({ t: "hello", bridge_version: "test", data_dir: "/synthetic", owner: connected });
  const row = { message_id: "m", asked_by: null, created_at: "2026-01-01T00:00:00Z",
    sender: { kind: "external_cli", label: "tool" }, recipient: { kind: "thread", thread_id: "t" }, excerpt: "Review" };
  const read = data.operations.messageList({ owed_by: "t" });
  await flush(); transport.ok(transport.calls("message.list").at(-1)!.id, { items: [row] });
  expect(await read).toEqual({ ok: true, value: { items: [row], limit: 16, filters: { owed_by_thread_id: "t", asked_by_thread_id: null } }, ownerOperationId: "op" });
  const wrong = data.operations.messageList({ owed_by: "other" });
  await flush(); transport.ok(transport.calls("message.list").at(-1)!.id, { items: [row] });
  expect(await wrong).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  data.stop();
});

it("pages only the requested direction and ignores a late continuation after switching Threads", async () => {
  const t = new FakeTransport();
  const data = new ShellboyData({ transport: t });
  data.start(); t.open();
  t.push({ t: "hello", bridge_version: "test", data_dir: "/synthetic", owner: connected });
  const pages = new ReplyPages(data);
  pages.observe("first");
  await flush();
  const [owed, asked] = t.calls("message.list");
  expect(owed!.args).toEqual({ owed_by_thread_id: "first", limit: 16 });
  expect(asked!.args).toEqual({ asked_by_thread_id: "first", limit: 16 });
  const row = pendingReply("m", "sender", { kind: "thread", thread_id: "first" }, "Review");
  t.ok(owed!.id, { items: [row], next_cursor: "next" });
  t.ok(asked!.id, { items: [] });
  await flush();
  pages.more("owed_by");
  await flush();
  const continuation = t.calls("message.list").at(-1)!;
  expect(continuation.args).toEqual({ owed_by_thread_id: "first", limit: 16, cursor: "next" });
  pages.observe("second");
  t.ok(continuation.id, { items: [{ ...row, message_id: "late" }] });
  await flush();
  expect(pages.owed_by.value.items).toEqual([]);
  expect(pages.asked_by.value.items).toEqual([]);
  pages.close(); data.stop();
});

it("refreshes every loaded reply page after a change hint without dropping the prefix", async () => {
  const t = new FakeTransport(); const data = new ShellboyData({ transport: t });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "test", data_dir: "/synthetic", owner: connected });
  const pages = new ReplyPages(data); const stop = pages.observe("thread"); await flush();
  const initial = t.calls("message.list");
  const item = (id: string) => pendingReply(id, "sender", { kind: "thread", thread_id: "thread" }, id);
  t.ok(initial[0]!.id, { items: Array.from({ length: 16 }, (_, i) => item(`r${i}`)), next_cursor: "page-2" });
  t.ok(initial[1]!.id, { items: [] }); await flush();
  pages.more("owed_by"); await flush();
  const second = t.calls("message.list").at(-1)!;
  expect(second.args).toMatchObject({ cursor: "page-2" });
  t.ok(second.id, { items: [item("r16")], next_cursor: "page-3" }); await flush();
  t.push({ t: "changed", config_changed: false, thread_ids: ["thread"], list: false }); await flush();
  const owed = () => t.calls("message.list").filter(call => (call.args as { owed_by_thread_id?: string }).owed_by_thread_id === "thread");
  const refreshFirst = owed().at(-1)!;
  expect((refreshFirst.args as { cursor?: string }).cursor).toBeUndefined();
  t.ok(refreshFirst.id, { items: Array.from({ length: 16 }, (_, i) => item(`r${i}`)), next_cursor: "page-2" }); await flush();
  const refreshSecond = owed().at(-1)!;
  expect((refreshSecond.args as { cursor?: string }).cursor).toBe("page-2");
  t.ok(refreshSecond.id, { items: [item("r16")], next_cursor: "page-3" });
  const askedRefresh = t.calls("message.list").filter(call => (call.args as { asked_by_thread_id?: string }).asked_by_thread_id === "thread").at(-1)!;
  t.ok(askedRefresh.id, { items: [] }); await flush();
  expect(pages.owed_by.value.items.map(row => row.message_id)).toEqual(Array.from({ length: 17 }, (_, i) => `r${i}`));
  stop(); data.stop();
});

it("retains reply rows and allows More after a failed hint, until Core expires the cursor", async () => {
  const t = new FakeTransport(); const data = new ShellboyData({ transport: t });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "test", data_dir: "/synthetic", owner: connected });
  const pages = new ReplyPages(data); const stop = pages.observe("thread"); await flush();
  const calls = t.calls("message.list"); const item = pendingReply("kept", "sender", { kind: "thread", thread_id: "thread" }, "kept");
  t.ok(calls[0]!.id, { items: [item], next_cursor: "retained" });
  t.ok(calls[1]!.id, { items: [] }); await flush();
  const hint = async () => {
    t.push({ t: "changed", config_changed: false, thread_ids: ["thread"], list: false }); await flush();
    const [owed, asked] = t.calls("message.list").slice(-2);
    t.ok(asked!.id, { items: [] });
    return owed!;
  };
  const failed = await hint();
  t.push({ t: "result", id: failed.id, response: { protocol_version: 5, operation_id: "failure", ok: false, error: { code: "unavailable", message: "read failed" } } });
  await flush();
  expect(pages.owed_by.value).toMatchObject({ items: [item], loading: false, complete: false, error: { message: "read failed" } });
  expect(pages.asked_by.value.complete).toBe(true);
  pages.more("owed_by"); await flush();
  const more = t.calls("message.list").at(-1)!;
  expect(more.args).toMatchObject({ owed_by_thread_id: "thread", cursor: "retained" });
  t.push({ t: "result", id: more.id, response: { protocol_version: 5, operation_id: "expired", ok: false, error: { code: "cursor_expired", message: "cursor expired" } } });
  await flush();
  expect(pages.owed_by.value).toMatchObject({ items: [item], loading: false, complete: false, error: { code: "cursor_expired", message: "cursor expired" } });
  expect(pages.owed_by.value.cursor).toBeUndefined();
  const before = t.calls("message.list").length;
  pages.more("owed_by"); await flush();
  expect(t.calls("message.list")).toHaveLength(before);
  stop(); data.stop();
});


it("keeps a next cursor on an empty page and reads its continuation", async () => {
  const t = new FakeTransport(); const data = new ShellboyData({ transport: t });
  data.start(); t.open(); t.push({ t: "hello", bridge_version: "test", data_dir: "/synthetic", owner: connected });
  const pages = new ReplyPages(data); pages.observe("thread"); await flush();
  const [owed, asked] = t.calls("message.list");
  const filters = { owed_by_thread_id: "thread" };
  t.ok(owed!.id, { items: [], limit: 16, filters, next_cursor: "still-more" });
  t.ok(asked!.id, { items: [], limit: 16, filters: { asked_by_thread_id: "thread" } });
  await flush();
  expect(pages.owed_by.value).toMatchObject({ items: [], cursor: "still-more", complete: false });
  const more = pages.more("owed_by"); await flush();
  const call = t.calls("message.list").at(-1)!;
  expect(call.args).toMatchObject({ owed_by_thread_id: "thread", cursor: "still-more" });
  const row = pendingReply("m", "sender", { kind: "thread", thread_id: "thread" }, "Review");
  t.ok(call.id, { items: [row], limit: 16, filters }); await more; await flush();
  expect(pages.owed_by.value).toMatchObject({ items: [row], complete: true });
  pages.close(); data.stop();
});
