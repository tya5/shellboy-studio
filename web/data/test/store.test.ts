import { describe, expect, it } from "vitest";
import { MAX_PREVIEW_CHARS, type Preview } from "../src/live";
import { MAX_LIST_ROWS, PAGE_LIMIT, MAX_WATCHED_THREADS, ShellboyData } from "../src/store";
import { Cancel } from "../src/operations";
import { connected, details, FakeOwnerDb, FakeTransport, flush, settle, summary } from "./harness";

async function setup(opts: { owner?: boolean; capabilities?: string[] } = {}) {
  const t = new FakeTransport();
  const data = new ShellboyData({ transport: t, newId: () => "id" });
  const db = new FakeOwnerDb();
  data.start();
  t.open();
  if (opts.owner !== false) {
    t.push({ t: "hello", bridge_version: "0.1.0", owner: opts.capabilities ? { state: "connected", info: { protocol_version: 5, instance_id: "i1", capabilities: opts.capabilities } } : connected });
    await flush();
  }
  return { t, data, db };
}

describe("shared subscription", () => {
  it("sends one coalesced watch frame replacing the subscription as tabs of the UI come and go", async () => {
    const { t, data, db } = await setup();
    const before = t.watches().length;
    const list = data.trackThreadList();
    const a = data.openThread("a");
    const b = data.openThread("b");
    const a2 = data.openThread("a"); // same Thread twice: still one id
    await settle(t, db);
    expect(t.watches().length - before).toBe(1);
    expect(t.watches().at(-1)).toEqual({ t: "watch", thread_ids: ["a", "b"], list: true });
    a.close();
    await flush();
    expect(t.watches().at(-1)!.thread_ids).toEqual(["a", "b"]); // a2 still holds it
    a2.close();
    b.close();
    list.close();
    await flush();
    expect(t.watches().at(-1)).toEqual({ t: "watch", thread_ids: [], list: false });
  });

  it("re-sends the subscription after the socket reopens", async () => {
    const { t, data } = await setup();
    data.openThread("a");
    await flush();
    t.drop();
    const n = t.watches().length;
    t.open();
    expect(t.watches().length).toBe(n + 1);
    expect(t.watches().at(-1)!.thread_ids).toEqual(["a"]);
  });

  it("bounds open Threads", async () => {
    const { data } = await setup();
    for (let i = 0; i < MAX_WATCHED_THREADS; i++) data.openThread(`t${i}`);
    expect(() => data.openThread("one-too-many")).toThrow(RangeError);
    data.openThread("t0"); // already open: fine
  });
});

describe("history capability is required", () => {
  it("fails closed before both current and removed RPCs when capability is absent", async () => {
    const { t, data, db } = await setup({ capabilities: [] });
    const h = data.openThread("a");
    await settle(t, db);
    const out = await h.readWindow({ before: 0, after: 0 }, new Cancel());
    expect(out).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
    expect(t.calls("history.list")).toHaveLength(0);
    expect(t.calls("history.window")).toHaveLength(0);
    h.close(); data.stop();
  });
});

describe("resync, restart and loss", () => {
  it("resync re-reads everything tracked", async () => {
    const { t, data, db } = await setup();
    db.threads.a = summary("a");
    db.details.a = details("a");
    db.details.b = details("b");
    data.trackThreadList();
    data.openThread("a");
    data.openThread("b");
    await settle(t, db);
    db.reads.length = 0;
    t.push({ t: "resync" });
    await settle(t, db);
    expect(db.reads.sort()).toEqual(["thread.get:a", "thread.get:b", "thread.list"]);
  });

  it("restarted followed by resync (the bridge sends both) costs at most one trailing read per target", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    data.openThread("a");
    await settle(t, db);
    db.reads.length = 0;
    t.push({ t: "owner", event: "restarted", owner: connected });
    t.push({ t: "resync" });
    await settle(t, db);
    // the first reads were already on the wire when resync arrived, so one trailing read each
    expect(db.reads.sort()).toEqual(["thread.get:a", "thread.get:a"]);
  });

  it("owner unreachable keeps values but marks them stale; recovery re-reads", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    const h = data.openThread("a");
    await settle(t, db);
    t.push({ t: "owner", event: "unreachable", owner: { state: "unreachable" } });
    expect(data.owner.value).toEqual({ state: "unreachable" });
    expect(h.detail.value).toMatchObject({ stale: true, value: { thread_id: "a" } });
    expect(data.capabilities.value).toEqual([]);

    t.push({ t: "owner", event: "connected", owner: connected });
    t.push({ t: "resync" });
    await settle(t, db);
    expect(h.detail.value.stale).toBe(false);
  });

  it("socket close marks stale and forgets the owner; hello after reconnect re-reads", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    const h = data.openThread("a");
    await settle(t, db);
    t.drop();
    expect(data.owner.value).toEqual({ state: "unknown" });
    expect(h.detail.value.stale).toBe(true);
    db.reads.length = 0;
    t.open();
    t.push({ t: "hello", bridge_version: "0.1.0", owner: connected });
    await settle(t, db);
    expect(db.reads.sort()).toEqual(["thread.get:a"]);
    expect(h.detail.value.stale).toBe(false);
  });

  it("a failed re-read keeps the old value, flags it stale and records the error", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    const h = data.openThread("a");
    await settle(t, db);
    delete db.details.a;
    t.push({ t: "changed", thread_ids: ["a"], list: false });
    await settle(t, db);
    expect(h.detail.value).toMatchObject({
      stale: true,
      value: { thread_id: "a" },
      error: { kind: "owner", code: "not_found" },
    });
  });

  it("does not read before the owner is known to be connected", async () => {
    const { t, data, db } = await setup({ owner: false });
    const h = data.openThread("a");
    await settle(t, db);
    expect(t.calls()).toEqual([]);
    db.details.a = details("a");
    t.push({ t: "hello", bridge_version: "0.1.0", owner: connected });
    await settle(t, db);
    expect(h.detail.value.value).toMatchObject({ thread_id: "a" });
  });

  it("closing a Thread drops its late read results and queued reads", async () => {
    const { t, data, db } = await setup({ capabilities: ["history.window"] });
    db.details.a = details("a");
    db.history.a = [];
    const h = data.openThread("a");
    const pending = t.calls("thread.get")[0]!;
    const window = h.readWindow({ before: 0, after: 0 }, new Cancel());
    await flush();
    expect(t.calls()).toHaveLength(2);
    h.close();
    t.ok(pending.id, details("a"));
    const windowCall = t.calls("history.window")[0]!;
    t.ok(windowCall.id, { thread_id: "a", revision: "empty", total: 0, items: [] });
    await flush();
    await window;
    expect(h.detail.value.value).toBeUndefined();
  });
});

describe("operation ids", () => {
  it("are prefixed with the connected owner's instance", async () => {
    const { t, data } = await setup();
    void data.operations.messageSend({ thread_id: "a", text: "x" });
    await flush();
    expect(t.calls("message.send")[0]!.operation_id).toBe("i1:id");
  });
  it("an explicit id is reused unchanged, so a retry stays the same operation", async () => {
    const { t, data } = await setup();
    void data.operations.messageSend({ thread_id: "a", text: "x" }, "i0:kept");
    await flush();
    expect(t.calls("message.send")[0]!.operation_id).toBe("i0:kept");
  });
});

describe("paging", () => {
  it("changing the list filter re-reads with the new filter", async () => {
    const { t, data, db } = await setup();
    data.trackThreadList();
    await settle(t, db);
    data.setListFilter({ query: "x", archived: "only" });
    await settle(t, db);
    expect(t.calls("thread.list").at(-1)!.args).toEqual({ limit: 50, query: "x", archived: "only" });
  });
});

describe("live text preview", () => {
  type Delta = { offset: number; reasoning: boolean; text: string };
  const d = (offset: number, text: string, reasoning = false): Delta => ({ offset, reasoning, text });
  const live = (deltas: Delta[], attempt_id = "a1", gap = false, thread_id = "a") => ({ t: "live" as const, thread_id, attempt_id, gap, deltas });
  const end = (thread_id = "a") => ({ t: "live_end" as const, thread_id });
  /** A hand-driven animation frame: nothing is published until `frame()`. */
  const frames = () => {
    const queue: (() => void)[] = [];
    return { schedule: (cb: () => void) => void queue.push(cb), frame: () => queue.splice(0).forEach((cb) => cb()), count: () => queue.length };
  };
  const asst = (node_id: string, excerpt: string) => ({ node_id, kind: "assistant_response", excerpt });
  async function open(saved: Record<string, unknown>[] = []) {
    const f = frames();
    const t = new FakeTransport();
    const owner = new FakeOwnerDb();
    owner.history["a"] = saved;
    const data = new ShellboyData({ transport: t, newId: () => "op", schedule: f.schedule });
    data.start();
    t.open();
    t.push({ t: "hello", bridge_version: "0", owner: connected });
    await settle(t, owner);
    const h = data.openThread("a");
    await settle(t, owner);
    return { t, owner, data, h, f };
  }
  const text = (h: { preview: { value: Preview } }) => (h.preview.value.kind === "live" ? h.preview.value.text : undefined);

  it("retains a visible response when a change arrives before its persisted body", async () => {
    const { t, owner, h, f } = await open([asst("older", "earlier")]);
    t.push(live([d(0, "VISIBLE_HANDOFF_BODY")]));
    f.frame();
    t.push(end());
    await settle(t, owner);
    t.push({ t: "changed", thread_ids: ["a"], list: false });
    await settle(t, owner);
    expect(h.preview.value).toMatchObject({ kind: "live", attemptId: "a1", text: "VISIBLE_HANDOFF_BODY", ending: true });
  });

  it("does not identify an unrelated saved node as this attempt's persisted body", async () => {
    const { t, owner, h, f } = await open([asst("older", "earlier")]);
    t.push(live([d(0, "VISIBLE_HANDOFF_BODY")]));
    f.frame();
    t.push(end());
    owner.history.a = [asst("unrelated", "unrelated response")];
    t.push({ t: "changed", thread_ids: ["a"], list: false });
    await settle(t, owner);
    expect(h.preview.value).toMatchObject({ kind: "live", attemptId: "a1", text: "VISIBLE_HANDOFF_BODY" });
  });

  it("a baseline starts from the retained tail and says it is incomplete", async () => {
    const { t, h, f } = await open();
    t.push(live([d(5, "tail")]));
    f.frame();
    expect(h.preview.value).toMatchObject({ kind: "live", attemptId: "a1", text: "tail", incomplete: true, ending: false });
  });

  it("deltas append, several frames publish once per animation frame, and only open Threads show text", async () => {
    const { t, h, f } = await open();
    t.push(live([d(0, "Hel")]));
    t.push(live([d(3, "lo")]));
    t.push(live([d(5, " wörld😀")]));
    t.push(live([d(0, "ignored")], "x", false, "other"));
    expect(text(h), "nothing is published between animation frames").toBeUndefined();
    expect(f.count()).toBe(1);
    f.frame();
    expect(h.preview.value).toMatchObject({ kind: "live", text: "Hello wörld😀", incomplete: false });
  });

  it("reasoning advances the offset but is not shown; a repeated or overlapping delta is not doubled", async () => {
    const { t, h, f } = await open();
    t.push(live([d(0, "ab"), d(2, "think", true), d(7, "cd")]));
    t.push(live([d(7, "cd"), d(8, "de")]));
    f.frame();
    expect(h.preview.value).toMatchObject({ text: "abcde", incomplete: false });
  });

  it("a gap discards first, then shows the tail as incomplete; a missing stretch inside an attempt does too", async () => {
    const { t, h, f } = await open();
    t.push(live([d(0, "abc")]));
    f.frame();
    t.push(live([d(40, "after")], "a1", true));
    f.frame();
    expect(h.preview.value).toMatchObject({ text: "after", incomplete: true });
    t.push(live([d(45, "x"), d(99, "y")]));
    f.frame();
    expect(h.preview.value).toMatchObject({ text: "afterxy", incomplete: true });
  });

  it("a new attempt starts a fresh preview", async () => {
    const { t, h, f } = await open();
    t.push(live([d(0, "first")]));
    t.push(live([d(0, "second")], "a2"));
    f.frame();
    expect(h.preview.value).toMatchObject({ attemptId: "a2", text: "second", incomplete: false });
  });

  it("a newest node without exact references cannot resolve the attempt", async () => {
    const { t, owner, h, f } = await open([asst("n1", "earlier")]);
    t.push(live([d(0, "Hello")]));
    f.frame();
    t.push(end());
    expect(h.preview.value).toMatchObject({ kind: "live", text: "Hello", ending: true });
    await settle(t, owner);
    expect(h.preview.value.kind, "no saved message yet, so the text stays").toBe("live");
    owner.history["a"] = [asst("n1", "earlier"), asst("n2", "Hello there")];
    t.push({ t: "changed", thread_ids: ["a"], list: false });
    await settle(t, owner);
    expect(h.preview.value).toMatchObject({ kind: "live", ending: true });
  });

  it("a newest node already read does not establish this attempt identity", async () => {
    const { t, owner, h, f } = await open([asst("n1", "earlier")]);
    t.push(live([d(0, "Hello")]));
    f.frame();
    owner.history["a"] = [asst("n1", "earlier"), asst("n2", "Hello")];
    t.push({ t: "changed", thread_ids: ["a"], list: false });
    await settle(t, owner);
    expect(text(h), "the live text is still the attempt's own until it ends").toBe("Hello");
    t.push(end());
    expect(h.preview.value).toMatchObject({ kind: "live", ending: true });
  });

  it("a stopped attempt without authoritative body remains confirming", async () => {
    const { t, owner, h, f } = await open([asst("n1", "earlier")]);
    t.push(live([d(0, "partial")]));
    f.frame();
    t.push(end());
    await settle(t, owner);
    expect(text(h)).toBe("partial");
    t.push({ t: "changed", thread_ids: ["a"], list: false });
    await settle(t, owner);
    expect(h.preview.value).toMatchObject({ kind: "live", ending: true });
  });

  it("a Thread with no held text shows nothing and a stray end changes nothing", async () => {
    const { t, h, f } = await open();
    t.push(end());
    f.frame();
    expect(h.preview.value).toEqual({ kind: "none" });
  });

  it("discards on resync, restart, unreachable and socket close, and a later frame starts a marked-incomplete tail", async () => {
    for (const [push, reason] of [
      [(t: FakeTransport) => t.push({ t: "resync" }), "resync"],
      [(t: FakeTransport) => t.push({ t: "owner", event: "restarted", owner: connected }), "owner_restarted"],
      [(t: FakeTransport) => t.push({ t: "owner", event: "unreachable", owner: { state: "unreachable" } }), "owner_unreachable"],
      [(t: FakeTransport) => t.drop(), "connection_closed"],
    ] as const) {
      const { t, h, f } = await open();
      t.push(live([d(0, "abc")]));
      f.frame();
      push(t);
      expect(h.preview.value, reason).toEqual({ kind: "none", discarded: reason });
    }
    const { t, h, f } = await open();
    t.push(live([d(0, "abc")]));
    f.frame();
    t.push({ t: "resync" });
    t.push(live([d(3, "def")]));
    f.frame();
    expect(h.preview.value).toMatchObject({ text: "def", incomplete: true });
  });

  it("keeps the newest text past the bound and says it is incomplete", async () => {
    const { t, h, f } = await open();
    t.push(live([d(0, "x".repeat(MAX_PREVIEW_CHARS))]));
    t.push(live([d(MAX_PREVIEW_CHARS, "yz")]));
    f.frame();
    const p = h.preview.value;
    expect(p.kind === "live" && p.text.length).toBe(MAX_PREVIEW_CHARS);
    expect(p.kind === "live" && p.text.endsWith("xyz")).toBe(true);
    expect(p.kind === "live" && p.incomplete).toBe(true);
  });
});

describe("diagnostics", () => {
  it("exposes owner capabilities, bridge version, bridge errors and invalid frames", async () => {
    const { t, data } = await setup();
    t.push({
      t: "owner",
      event: "connected",
      owner: { state: "connected", info: { protocol_version: 5, instance_id: "i2", capabilities: ["live_text"] } },
    });
    expect(data.capabilities.value).toEqual(["live_text"]);
    expect(data.bridgeVersion.value).toBe("0.1.0");
    t.push({ t: "hello", bridge_version: "0.1.1", listen: "127.0.0.1:9012", apps_dir: "/tmp/apps", owner: { state: "unreachable" } });
    expect(data.listen.value).toBe("127.0.0.1:9012");
    expect(data.appsDir.value).toBe("/tmp/apps");
    t.push({ t: "error", error: { code: "invalid_watch", message: "too many" } });
    expect(data.bridgeError.value).toEqual({ code: "invalid_watch", message: "too many" });
    t.handlers!.onInvalidFrame("unknown frame x");
    expect(data.invalidFrames.value).toEqual({ count: 1, last: "unknown frame x" });
  });
});

describe("the Thread list stays bounded however many Threads exist", () => {
  async function listed(pages: number) {
    const t = new FakeTransport();
    const db = new FakeOwnerDb();
    const all = Array.from({ length: pages * PAGE_LIMIT }, (_, i) => summary(`t${i}`));
    const answer = db.answer.bind(db);
    db.answer = (c) => {
      if (c.command !== "thread.list") return answer(c);
      const a = (c.args ?? {}) as { cursor?: string };
      const start = a.cursor ? Number(a.cursor) : 0;
      const end = start + PAGE_LIMIT;
      return { ok: true, result: { items: all.slice(start, end), ...(end < all.length ? { next_cursor: String(end) } : {}) } };
    };
    const data = new ShellboyData({ transport: t, newId: () => "x" });
    data.trackThreadList();
    data.start();
    t.open();
    t.push({ t: "hello", bridge_version: "0", owner: connected });
    await settle(t, db);
    return { t, db, data, all };
  }
  const more = async (x: Awaited<ReturnType<typeof listed>>) => {
    const p = x.data.loadMoreThreads();
    await settle(x.t, x.db);
    await p;
  };
  it("a hint reads one page and doesn't collapse rows shown further down", async () => {
    const x = await listed(4);
    await more(x);
    await more(x);
    expect(x.data.threadList.value.items).toHaveLength(150);
    const before = x.t.calls("thread.list").length;
    x.all[60] = { ...x.all[60]!, title: "moved up" };
    x.all.unshift(summary("fresh"));
    x.t.push({ t: "changed", thread_ids: ["fresh"], list: true });
    await settle(x.t, x.db);
    expect(x.t.calls("thread.list").length).toBe(before + 1);
    const items = x.data.threadList.value.items;
    expect(items[0]!.thread_id).toBe("fresh");
    expect(items.length).toBeGreaterThanOrEqual(150);
    expect(new Set(items.map((i) => i.thread_id)).size).toBe(items.length);
  });
  it("a changed search starts over", async () => {
    const x = await listed(3);
    await more(x);
    x.data.setListFilter({ query: "q" });
    await settle(x.t, x.db);
    expect(x.data.threadList.value.items).toHaveLength(PAGE_LIMIT);
  });
  it("stops holding rows at the bound, and says it can't load more", async () => {
    const x = await listed(30);
    for (let i = 0; i < 25; i++) await more(x);
    expect(x.data.threadList.value.items).toHaveLength(MAX_LIST_ROWS);
    expect(x.data.canLoadMoreThreads()).toBe(false);
    const before = x.t.calls("thread.list").length;
    await more(x);
    expect(x.t.calls("thread.list").length).toBe(before);
  });
});

describe("reads nobody needs are cancelled", () => {
  async function opened() {
    const t = new FakeTransport();
    const db = new FakeOwnerDb();
    db.details.a = details("a");
    db.history.a = Array.from({ length: 450 }, (_, i) => ({ node_id: `n${i}`, kind: "user", excerpt: "x", provenance: { created_at: `2026-11-07T00:00:${String(i % 60).padStart(2, "0")}+00:00` }, selection: { ordinal: i } }));
    const data = new ShellboyData({ transport: t, newId: () => "x" });
    data.start();
    t.open();
    t.push({ t: "hello", bridge_version: "0", owner: connected });
    await flush();
    const h = data.openThread("a");
    await flush();
    return { t, db, data, h };
  }
  it("closing a Thread cancels what's on the wire and starts nothing more", async () => {
    const { t, h } = await opened();
    const sent = t.calls().filter((c) => c.command === "thread.get");
    expect(sent.length).toBeGreaterThan(0);
    h.close();
    await flush();
    expect(t.cancels()).toEqual(expect.arrayContaining(sent.map((c) => c.id)));
    const before = t.calls("history.window").length;
    await flush();
    expect(t.calls("history.window").length).toBe(before);
  });
  it("a new search cancels the read for the old one, and reads again even if that was still queued", async () => {
    const t = new FakeTransport();
    const db = new FakeOwnerDb();
    const data = new ShellboyData({ transport: t, newId: () => "x" });
    data.trackThreadList();
    data.start();
    t.open();
    t.push({ t: "hello", bridge_version: "0", owner: connected });
    await flush();
    const first = t.calls("thread.list")[0]!;
    data.setListFilter({ query: "q" });
    await flush();
    expect(t.cancels()).toContain(first.id);
    await settle(t, db);
    expect((t.calls("thread.list").at(-1)!.args as { query?: string }).query).toBe("q");
    expect(data.threadList.value.loaded).toBe(true);
  });
});
