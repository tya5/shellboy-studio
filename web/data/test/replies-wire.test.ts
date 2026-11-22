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
  expect(await read).toEqual({ ok: true, value: { items: [row] } });
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
  expect(owed!.args).toEqual({ owed_by: "first", limit: 16 });
  expect(asked!.args).toEqual({ asked_by: "first", limit: 16 });
  const row = pendingReply("m", "sender", { kind: "thread", thread_id: "first" }, "Review");
  t.ok(owed!.id, { items: [row], next_cursor: "next" });
  t.ok(asked!.id, { items: [] });
  await flush();
  pages.more("owed_by");
  await flush();
  const continuation = t.calls("message.list").at(-1)!;
  expect(continuation.args).toEqual({ owed_by: "first", limit: 16, cursor: "next" });
  pages.observe("second");
  t.ok(continuation.id, { items: [{ ...row, message_id: "late" }] });
  await flush();
  expect(pages.owed_by.value.items).toEqual([]);
  expect(pages.asked_by.value.items).toEqual([]);
  pages.close(); data.stop();
});
