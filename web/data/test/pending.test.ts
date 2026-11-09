import { describe, expect, it } from "vitest";
import { ShellboyData } from "../src/store";
import { HumanInbox, HUMAN_PAGE_LIMIT } from "../src/pending";
import { FakeTransport, connected, details, flush, summary } from "./harness";

async function fixture() {
  const t = new FakeTransport(); let seq = 0;
  const data = new ShellboyData({ transport: t, newId: () => `uuid-${++seq}` });
  const inbox = new HumanInbox(data); const list = data.trackThreadList(); data.start(); t.open();
  t.push({ t: "hello", bridge_version: "test", data_dir: "/synthetic", owner: connected });
  await flush(); t.ok(t.calls("thread.list").find(c => !(c.args as Record<string, unknown>).awaiting)!.id, { items: [] }); await flush();
  const close = () => { inbox.close(); list.close(); data.stop(); };
  return { t, data, inbox, close };
}
const human = (id: string) => ({ message_id: id, recipient_kind: "human", recipient_thread_id: "a", excerpt: `Question ${id}`, delivery_status: "accepted" });
async function fill(f: Awaited<ReturnType<typeof fixture>>, cursor?: string) {
  const list = f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!;
  expect(list.args).toEqual({ awaiting: "human", limit: HUMAN_PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
  f.t.ok(list.id, { items: [summary("a", { awaiting_human_count: 17, awaiting_human_count_exact: false })], next_cursor: "next-key" }); await flush();
  f.t.ok(f.t.calls("thread.get").at(-1)!.id, details("a", { awaiting_replies: [human("h"), { ...human("q"), recipient_kind: "thread", recipient_thread_id: "other" }] })); await flush();
}
describe("bounded protocol5 human inbox", () => {
  it("reads only its page, preserves 17+/unknown oldest, filters Thread duties and keysets", async () => {
    const f = await fixture(); await fill(f);
    expect(f.inbox.items.value).toEqual([{ id: "h", threadId: "a", threadTitle: "t-a", question: "Question h", askedAt: undefined, count: 17, countExact: false }]);
    expect(f.t.calls("thread.get").map(c => (c.args as Record<string, unknown>).thread_id)).toEqual(["a"]);
    const more = f.inbox.more(); await flush(); await fill(f, "next-key"); await more;
    expect(f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting)).toHaveLength(2);
    expect(f.t.calls("thread.get")).toHaveLength(2);
    f.close();
  });
  it("never sends reply for an unrelated/Thread duty, and coalesces double clicks", async () => {
    const f = await fixture(); await fill(f);
    expect((await f.inbox.answer("q", "no")).ok).toBe(false);
    const first = f.inbox.answer("h", "answer"), duplicate = f.inbox.answer("h", "answer"); await flush();
    expect(f.t.calls("message.reply")).toHaveLength(1);
    const reply = f.t.calls("message.reply")[0]!; expect(reply.args).toEqual({ message_id: "h", text: "answer" });
    f.t.ok(reply.id, {}); await flush(); const list = f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!; f.t.ok(list.id, { items: [] }); await flush();
    expect((await first).ok).toBe(true); expect((await duplicate).ok).toBe(true); expect(f.inbox.items.value).toEqual([]); f.close();
  });
  it("reuses an unconfirmed receipt and rejects changed retry text", async () => {
    const f = await fixture(); await fill(f);
    const first = f.inbox.answer("h", "answer"); await flush(); const sent = f.t.calls("message.reply")[0]!;
    f.t.drop(); await flush(); await first;
    f.t.open(); f.t.push({ t: "hello", bridge_version: "test", data_dir: "/synthetic", owner: connected }); await flush();
    const base = f.t.calls("thread.list").filter(c => !(c.args as Record<string, unknown>).awaiting).at(-1)!; f.t.ok(base.id, { items: [] }); await flush(); await fill(f);
    expect((await f.inbox.answer("h", "different")).ok).toBe(false);
    const retry = f.inbox.answer("h", "answer"); await flush(); const resent = f.t.calls("message.reply").at(-1)!;
    expect(resent.operation_id).toBe(sent.operation_id); f.t.ok(resent.id, {}); await flush(); f.t.ok(f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!.id, { items: [] }); await retry; f.close();
  });
  it("reports expired cursors instead of silently scanning/restarting, and cancels on close", async () => {
    const f = await fixture(); await fill(f); const more = f.inbox.more(); await flush();
    const list = f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!; f.t.ownerError(list.id, "cursor_expired"); await more;
    expect(f.inbox.error.value).toMatchObject({ code: "cursor_expired" }); expect(f.inbox.items.value).toEqual([]); f.close();
  });
});

it("invalidates a stale read before it can publish, keeps unrelated list facts and cancels reads on shutdown", async () => {
  const f = await fixture(); const before = f.data.threadList.value;
  const call = f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!;
  f.inbox.close(); await flush(); expect(f.t.cancels()).toContain(call.id);
  f.t.ok(call.id, { items: [summary("unrelated")] }); await flush();
  expect(f.inbox.items.value).toEqual([]); expect(f.data.threadList.value).toEqual(before); f.close();
});

it("fails loud for oversized pages without scanning detail records", async () => {
  const f = await fixture(); const call = f.t.calls("thread.list").filter(c => (c.args as Record<string, unknown>).awaiting).at(-1)!;
  f.t.ok(call.id, { items: Array.from({ length: HUMAN_PAGE_LIMIT + 1 }, (_, i) => summary(String(i))) }); await flush();
  expect(f.inbox.error.value?.kind).toBe("invalid_response"); expect(f.t.calls("thread.get")).toHaveLength(0); f.close();
});
