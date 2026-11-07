import { describe, expect, it } from "vitest";
import { applyOwnerLiveText, LiveTextWireUnknownError, MAX_PREVIEW_CHARS } from "../src/live";
import { MAX_LIST_ROWS, PAGE_LIMIT, HISTORY_WINDOW, MAX_WATCHED_THREADS, ShellboyData } from "../src/store";
import { connected, details, FakeOwnerDb, FakeTransport, flush, settle, summary } from "./harness";

async function setup(opts: { owner?: boolean } = {}) {
  const t = new FakeTransport();
  const data = new ShellboyData({ transport: t, newId: () => "id" });
  const db = new FakeOwnerDb();
  data.start();
  t.open();
  if (opts.owner !== false) {
    t.push({ t: "hello", bridge_version: "0.1.0", owner: connected });
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

describe("hints are not data", () => {
  it("opening reads detail and history; a list hint re-reads the list only", async () => {
    const { t, data, db } = await setup();
    db.threads.a = summary("a");
    db.details.a = details("a");
    db.history.a = [{ node_id: "n1" }];
    data.trackThreadList();
    const h = data.openThread("a");
    await settle(t, db);
    expect(data.threadList.value.items).toEqual([summary("a")]);
    expect(h.detail.value.value).toMatchObject({ thread_id: "a" });
    expect(h.history.value.items).toEqual([{ node_id: "n1" }]);

    db.reads.length = 0;
    db.threads.b = summary("b");
    t.push({ t: "changed", thread_ids: [], list: true });
    await settle(t, db);
    expect(db.reads).toEqual(["thread.list"]);
    expect(data.threadList.value.items.map((x) => x.thread_id)).toEqual(["a", "b"]);
  });

  it("a thread hint re-reads that Thread's detail and history, and ignores untracked Threads", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a", { title: "old" });
    const h = data.openThread("a");
    await settle(t, db);
    db.reads.length = 0;
    db.details.a = details("a", { title: "new" });
    t.push({ t: "changed", thread_ids: ["a", "nobody-watches-this"], list: false });
    await settle(t, db);
    expect(db.reads.sort()).toEqual(["history.list:a", "thread.get:a"]);
    expect(h.detail.value.value!.title).toBe("new");
  });

  it("does not read the list when nobody shows it", async () => {
    const { t, db } = await setup();
    t.push({ t: "changed", thread_ids: [], list: true });
    await settle(t, db);
    expect(db.reads).toEqual([]);
  });

  it("coalesces concurrent hints for one target into one read, plus one trailing read when the first was already sent", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    data.openThread("a");
    await settle(t, db);
    db.reads.length = 0;
    const base = t.calls().length;

    for (let i = 0; i < 5; i++) t.push({ t: "changed", thread_ids: ["a"], list: false });
    expect(t.calls().length - base).toBe(2); // thread.get + history.list, once each
    // the change that triggered more hints lands while those reads are on the wire
    for (let i = 0; i < 5; i++) t.push({ t: "changed", thread_ids: ["a"], list: false });
    await settle(t, db);
    expect(db.reads.sort()).toEqual(["history.list:a", "history.list:a", "thread.get:a", "thread.get:a"]);
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
    expect(db.reads.sort()).toEqual(["history.list:a", "history.list:b", "thread.get:a", "thread.get:b", "thread.list"]);
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
    expect(db.reads.sort()).toEqual(["history.list:a", "history.list:a", "thread.get:a", "thread.get:a"]);
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
    expect(h.history.value.stale).toBe(true);
    db.reads.length = 0;
    t.open();
    t.push({ t: "hello", bridge_version: "0.1.0", owner: connected });
    await settle(t, db);
    expect(db.reads.sort()).toEqual(["history.list:a", "thread.get:a"]);
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
    const { t, data } = await setup();
    const h = data.openThread("a");
    const sent = t.calls().length;
    expect(sent).toBe(2);
    h.close();
    t.ok(t.calls()[0]!.id, details("a"));
    await flush();
    expect(h.detail.value.value).toBeUndefined();
  });
});

const node = (n: number, ordinal = n) => ({
  node_id: `n${n}`,
  kind: "user",
  provenance: { created_at: `2026-01-01T00:00:00.${String(n).padStart(6, "0")}+00:00` },
  selection: { ordinal },
});
const ids = (items: { node_id?: string }[]) => items.map((i) => i.node_id);

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

describe("history window", () => {
  it("walks to the end of the path, oldest to newest, keeping the newest items", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    db.history.a = Array.from({ length: HISTORY_WINDOW + 150 }, (_, i) => node(i));
    const h = data.openThread("a");
    await settle(t, db);
    const { items, earlierHidden } = h.history.value;
    expect(items).toHaveLength(HISTORY_WINDOW);
    expect(items[0]!.node_id).toBe("n150");
    expect(items.at(-1)!.node_id).toBe(`n${HISTORY_WINDOW + 149}`);
    expect(earlierHidden).toBe(true);
  });

  it("a hint reads only since the last known item and appends", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    db.history.a = [node(1), node(2)];
    const h = data.openThread("a");
    await settle(t, db);
    db.history.a = [node(1), node(2), node(3)];
    const before = t.calls("history.list").length;
    t.push({ t: "changed", thread_ids: ["a"], list: false });
    await settle(t, db);
    const reads = t.calls("history.list").slice(before);
    expect(reads).toHaveLength(1);
    expect((reads[0]!.args as { since?: string }).since).toBe(node(2).provenance.created_at);
    expect(ids(h.history.value.items)).toEqual(["n1", "n2", "n3"]);
  });

  it("starts over when the last known item moved (the path was rewritten)", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    db.history.a = [node(1), node(2)];
    const h = data.openThread("a");
    await settle(t, db);
    db.history.a = [node(9, 0), node(2, 1), node(3, 2)];
    t.push({ t: "changed", thread_ids: ["a"], list: false });
    await settle(t, db);
    expect(ids(h.history.value.items)).toEqual(["n9", "n2", "n3"]);
  });

  it("an expired cursor continues from the last item read, without duplicates", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    db.history.a = Array.from({ length: 250 }, (_, i) => node(i));
    db.expiredCursors.add("100");
    const h = data.openThread("a");
    await settle(t, db);
    const got = ids(h.history.value.items);
    expect(got).toHaveLength(250);
    expect(new Set(got).size).toBe(250);
    expect(h.history.value.error).toBeUndefined();
  });

  it("resync reads the whole path again", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    db.history.a = [node(1), node(2)];
    const h = data.openThread("a");
    await settle(t, db);
    db.history.a = [node(2, 0)];
    t.push({ t: "resync" });
    await settle(t, db);
    expect(ids(h.history.value.items)).toEqual(["n2"]);
  });

  it("loadOlderHistory widens the window with a new walk", async () => {
    const { t, data, db } = await setup();
    db.details.a = details("a");
    db.history.a = Array.from({ length: HISTORY_WINDOW + 10 }, (_, i) => node(i));
    const h = data.openThread("a");
    await settle(t, db);
    expect(h.history.value.earlierHidden).toBe(true);
    await Promise.all([h.loadOlderHistory(), settle(t, db)]);
    expect(h.history.value.items).toHaveLength(HISTORY_WINDOW + 10);
    expect(h.history.value.earlierHidden).toBe(false);
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
  const frame = (text: string, gap = false, thread_id = "a") => ({ t: "stream" as const, thread_id, cursor: `c-${text}`, text, gap });

  it("appends text since the last frame for open Threads only", async () => {
    const { t, data } = await setup();
    const h = data.openThread("a");
    t.push(frame("Hel"));
    t.push(frame("lo"));
    t.push(frame("ignored", false, "other"));
    expect(h.preview.value).toEqual({ kind: "live", text: "Hello", cursor: "c-lo" });
  });

  it("discards on gap and stays on saved output afterwards", async () => {
    const { t, data } = await setup();
    const h = data.openThread("a");
    t.push(frame("abc"));
    t.push(frame("dropped middle", true));
    expect(h.preview.value).toEqual({ kind: "none", discarded: "gap" });
    t.push(frame("tail"));
    expect(h.preview.value).toEqual({ kind: "none", discarded: "gap" });
  });

  it("discards on resync, restart, unreachable and socket close", async () => {
    for (const [push, reason] of [
      [(t: FakeTransport) => t.push({ t: "resync" }), "resync"],
      [(t: FakeTransport) => t.push({ t: "owner", event: "restarted", owner: connected }), "owner_restarted"],
      [(t: FakeTransport) => t.push({ t: "owner", event: "unreachable", owner: { state: "unreachable" } }), "owner_unreachable"],
      [(t: FakeTransport) => t.drop(), "connection_closed"],
    ] as const) {
      const { t, data } = await setup();
      const h = data.openThread("a");
      t.push(frame("abc"));
      push(t);
      expect(h.preview.value, reason).toEqual({ kind: "none", discarded: reason });
    }
  });

  it("discards instead of growing past the bound", async () => {
    const { t, data } = await setup();
    const h = data.openThread("a");
    t.push(frame("x".repeat(MAX_PREVIEW_CHARS)));
    expect(h.preview.value.kind).toBe("live");
    t.push(frame("y"));
    expect(h.preview.value).toEqual({ kind: "none", discarded: "overflow" });
  });

  it("owner-wire rules (attempt_id, live_text membership, baseline, resync_required) are a loud stub", () => {
    expect(() => applyOwnerLiveText({ anything: 1 })).toThrow(LiveTextWireUnknownError);
  });
});

describe("diagnostics", () => {
  it("exposes owner capabilities, bridge version, bridge errors and invalid frames", async () => {
    const { t, data } = await setup();
    t.push({
      t: "owner",
      event: "connected",
      owner: { state: "connected", info: { protocol_version: 3, instance_id: "i2", capabilities: ["live_text"] } },
    });
    expect(data.capabilities.value).toEqual(["live_text"]);
    expect(data.bridgeVersion.value).toBe("0.1.0");
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
