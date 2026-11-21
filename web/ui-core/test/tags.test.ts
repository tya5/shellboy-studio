import { describe, expect, it } from "vitest";
import { summary, settle, type FakeOwnerDb } from "../../data/test/harness";
import { checkTag, HEADING_PAGE, MEMBER_PAGE, OPEN_MAX, TAG_SELECTION_MAX } from "../src";
import { fixtureModel } from "./fixture";

const both = ["thread.tags", "thread.cwds"];
type Args = Record<string, unknown>;

/** A fake owner with `n` Threads, each tagged `tag-<k>` for a few k, in two directories. */
const populate = (db: FakeOwnerDb, tagged: Record<string, string[]>, cwd = "/home/me/dev/shellboy") => {
  for (const [name, ids] of Object.entries(tagged)) for (const id of ids) {
    const t = (db.threads[id] ??= summary(id, { cwd })) as { tags?: string[] };
    t.tags = [...(t.tags ?? []), name].sort();
  }
};

const open = async (options: { capabilities?: string[]; configure?: (db: FakeOwnerDb) => void } = {}) => {
  const made = await fixtureModel({ route: "threads", ...options });
  return made;
};

describe("checking a tag", () => {
  it("applies the owner's rule", () => {
    expect(checkTag("  bug hunt ")).toEqual({ ok: true, tag: "bug hunt" });
    expect(checkTag("   ")).toEqual({ ok: false, invalid: "empty" });
    expect(checkTag("a".repeat(129))).toEqual({ ok: false, invalid: "long" });
    expect(checkTag("a".repeat(128)).ok).toBe(true);
    expect(checkTag("x\u0007y")).toEqual({ ok: false, invalid: "chars" });
    expect(checkTag("a\nb")).toEqual({ ok: false, invalid: "chars" });
    expect(checkTag("Case").ok && checkTag("case").ok).toBe(true);
  });
});

describe("grouping by tag", () => {
  it("reads names a page at a time and never lists every Thread", async () => {
    const { t, db, model } = await open({
      capabilities: both,
      configure: (d) => populate(d, Object.fromEntries(Array.from({ length: HEADING_PAGE + 5 }, (_, k) => [`tag-${String(k).padStart(3, "0")}`, [`m${k}`]]))),
    });
    const org = model.org;
    const before = t.calls("thread.list").length;
    org.setGrouping("tag");
    await settle(t, db);
    expect(org.headings.headings.value.names).toHaveLength(HEADING_PAGE);
    expect(org.headings.headings.value.nextCursor).toBe(String(HEADING_PAGE));
    expect(t.calls("thread.tags")[0]!.args).toEqual({ limit: HEADING_PAGE });
    org.headings.loadMoreNames();
    await settle(t, db);
    expect(org.headings.headings.value.names).toHaveLength(HEADING_PAGE + 5);
    expect(org.headings.canLoadMoreNames()).toBe(false);
    // Members are read per heading, on demand: opening the grouping reads no list at all.
    expect(t.calls("thread.list")).toHaveLength(before);
  });

  it("opens a heading through thread.list with that tag, in the shown mode and filter, and pages its members", async () => {
    const ids = Array.from({ length: MEMBER_PAGE + 40 }, (_, k) => `big${k}`);
    const { t, db, model } = await open({ capabilities: both, configure: (d) => populate(d, { big: ids, small: ["lead"] }) });
    const org = model.org;
    org.setGrouping("tag");
    await settle(t, db);
    org.headings.toggle("big");
    await settle(t, db);
    const call = t.calls("thread.list").at(-1)!.args as Args;
    expect(call).toEqual({ limit: MEMBER_PAGE, archived: "exclude", tags: ["big"] });
    expect(org.headings.open.value.get("big")!.items).toHaveLength(MEMBER_PAGE);
    expect(org.headings.canLoadMore("big")).toBe(true);
    org.headings.loadMore("big");
    await settle(t, db);
    expect(org.headings.open.value.get("big")!.items).toHaveLength(MEMBER_PAGE + 40);
    expect(org.headings.canLoadMore("big")).toBe(false);
    org.setQuery("x");
    await settle(t, db);
    expect((t.calls("thread.list").at(-1)!.args as Args).query).toBe("x");
  });

  it("keeps at most a few headings open, closing the oldest", async () => {
    const tagged = Object.fromEntries(Array.from({ length: OPEN_MAX + 2 }, (_, k) => [`g${k}`, [`a${k}`]]));
    const { t, db, model } = await open({ capabilities: both, configure: (d) => populate(d, tagged) });
    const org = model.org;
    org.setGrouping("tag");
    await settle(t, db);
    for (let k = 0; k < OPEN_MAX + 2; k++) {
      org.headings.toggle(`g${k}`);
      await settle(t, db);
    }
    expect([...org.headings.open.value.keys()]).toEqual(Array.from({ length: OPEN_MAX }, (_, k) => `g${k + 2}`));
  });

  it("selection follows the rows shown: closing a heading drops its rows from it", async () => {
    const { t, db, model } = await open({ capabilities: both, configure: (d) => populate(d, { a: ["x1", "x2"], b: ["y1"] }) });
    const org = model.org;
    org.setGrouping("tag");
    await settle(t, db);
    org.headings.toggle("a");
    org.headings.toggle("b");
    await settle(t, db);
    org.setMany(["x1", "y1"], true);
    org.headings.toggle("a");
    expect([...org.selected.value]).toEqual(["y1"]);
  });

  it("reports an expired cursor after starting over a few times", async () => {
    const ids = Array.from({ length: MEMBER_PAGE + 5 }, (_, k) => `e${k}`);
    const { t, db, model } = await open({ capabilities: both, configure: (d) => populate(d, { e: ids }) });
    const org = model.org;
    org.setGrouping("tag");
    await settle(t, db);
    org.headings.toggle("e");
    await settle(t, db);
    db.expiredCursors.add(String(MEMBER_PAGE));
    org.headings.loadMore("e");
    await settle(t, db);
    const m = org.headings.open.value.get("e")!;
    expect(m.error).toMatchObject({ code: "cursor_expired" });
    expect(t.calls("thread.list").filter((c) => (c.args as Args).cursor === String(MEMBER_PAGE))).toHaveLength(4);
  });
});

describe("grouping by directory", () => {
  it("takes headings from thread.cwds and members by exact cwd", async () => {
    const { t, db, model } = await open({ capabilities: both });
    const org = model.org;
    org.setGrouping("directory");
    await settle(t, db);
    expect(org.headings.headings.value.names).toEqual(["/home/me/dev/rag", "/home/me/dev/shellboy"]);
    expect(t.calls("thread.cwds")[0]!.args).toEqual({ limit: HEADING_PAGE });
    org.headings.toggle("/home/me/dev/rag");
    await settle(t, db);
    expect(t.calls("thread.list").at(-1)!.args).toEqual({ limit: MEMBER_PAGE, archived: "exclude", cwd: "/home/me/dev/rag" });
    expect(org.headings.open.value.get("/home/me/dev/rag")!.items.map((s) => s.thread_id)).toEqual(["broken", "hold"]);
  });

  it("an owner with tags but no thread.cwds keeps today's directory grouping from the list read", async () => {
    const { t, db, model } = await open({ capabilities: ["thread.tags"] });
    const org = model.org;
    org.setGrouping("directory");
    await settle(t, db);
    expect(org.headingKind()).toBeUndefined();
    expect(t.calls("thread.cwds")).toHaveLength(0);
    expect(org.state.value.items.length).toBeGreaterThan(0);
  });
});

describe("editing tags", () => {
  const setup = async () => {
    const made = await open({ capabilities: both, configure: (d) => populate(d, { old: ["lead", "done"], keep: ["lead"] }) });
    made.model.org.setGrouping("tag");
    await settle(made.t, made.db);
    made.model.org.headings.toggle("old");
    await settle(made.t, made.db);
    return made;
  };

  it("adds and removes on several Threads in one call, then reads again; nothing is optimistic", async () => {
    const { t, db, model } = await setup();
    const org = model.org;
    org.setMany(["lead", "done"], true);
    expect(org.selectedTags()).toEqual(["keep", "old"]);
    expect(org.addTag("  fresh ")).toBeUndefined();
    org.toggleRemoveTag("old");
    const running = org.applyTags();
    expect(org.tagAction.value.kind).toBe("running");
    expect((db.threads.lead as { tags?: string[] }).tags).toEqual(["keep", "old"]);
    await settle(t, db);
    await running;
    const call = t.calls("thread.tag")[0]!;
    expect(call.args).toEqual({ thread_ids: ["lead", "done"], add: ["fresh"], remove: ["old"] });
    expect(call.operation_id).toBeTruthy();
    expect(org.tagAction.value).toMatchObject({ kind: "done", result: { changed: ["lead", "done"], unchanged: [], not_found: [] } });
    expect((db.threads.lead as { tags?: string[] }).tags).toEqual(["fresh", "keep"]);
    // Headings were read again: the open one, now empty, and the new tag.
    expect(org.headings.headings.value.names).toEqual(["fresh", "keep"]);
    expect(org.tagDraft.value.add).toEqual([]);
  });

  it("shows a partial result: Threads the owner no longer has are reported", async () => {
    const { t, db, model } = await setup();
    const org = model.org;
    org.selected.value = new Set(["lead", "ghost"]);
    org.addTag("keep");
    const running = org.applyTags();
    await settle(t, db);
    await running;
    expect(org.tagAction.value).toMatchObject({ kind: "done", result: { changed: [], unchanged: ["lead"], not_found: ["ghost"] } });
  });

  it("reports the 64-tag limit as such, changes nothing, and keeps the draft", async () => {
    const { t, db, model } = await open({
      capabilities: both,
      configure: (d) => populate(d, Object.fromEntries(Array.from({ length: 64 }, (_, k) => [`t${String(k).padStart(2, "0")}`, ["full"]]))),
    });
    const org = model.org;
    org.setGrouping("tag");
    await settle(t, db);
    org.setMany(["full"], true);
    org.addTag("one-too-many");
    const running = org.applyTags();
    await settle(t, db);
    await running;
    expect(org.tagAction.value).toMatchObject({ kind: "failed", limit: true });
    expect((db.threads.full as { tags?: string[] }).tags).toHaveLength(64);
    expect(org.tagDraft.value.add).toEqual(["one-too-many"]);
  });

  it("refuses more than 200 Threads before calling", async () => {
    const { t, db, model } = await setup();
    const org = model.org;
    org.selected.value = new Set(Array.from({ length: TAG_SELECTION_MAX + 1 }, (_, k) => `s${k}`));
    org.addTag("x");
    await org.applyTags();
    await settle(t, db);
    expect(org.tagAction.value).toEqual({ kind: "selection", n: TAG_SELECTION_MAX + 1 });
    expect(t.calls("thread.tag")).toHaveLength(0);
  });

  it("keeps a tag out of both lists", async () => {
    const { model } = await setup();
    const org = model.org;
    org.toggleRemoveTag("old");
    expect(org.addTag("old")).toBe("both");
    org.toggleRemoveTag("old");
    expect(org.addTag("old")).toBeUndefined();
    org.toggleRemoveTag("old");
    expect(org.tagDraft.value.add).toEqual([]);
  });

  it("flat views carry tags on their rows", async () => {
    const { model } = await open({ capabilities: both, configure: (d) => populate(d, { old: ["lead"] }) });
    expect(model.org.state.value.items.find((s) => s.thread_id === "lead")!.tags).toEqual(["old"]);
  });
});

describe("an owner without tags (v0.10.0)", () => {
  it("makes no tag, cwd or filtered call, and offers no editing", async () => {
    const { t, db, model } = await open();
    const org = model.org;
    expect(org.canTag()).toBe(false);
    org.setGrouping("tag");
    await settle(t, db);
    org.setGrouping("directory");
    await settle(t, db);
    expect(org.headingKind()).toBeUndefined();
    for (const command of ["thread.tags", "thread.cwds", "thread.tag"]) expect(t.calls(command)).toHaveLength(0);
    expect(t.calls("thread.list").every((c) => (c.args as Args).tags === undefined && (c.args as Args).cwd === undefined)).toBe(true);
    expect(org.state.value.loaded).toBe(true);
  });
});
