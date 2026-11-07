import { describe, expect, it } from "vitest";
import { settle } from "../../data/test/harness";
import { branchLayout, branchMarks, branchRowMarks, branchTitle, formatRoute, groupThreads, listedDescendants, parseRoute, projectConversation, readFamily, readRewind, readWholeFamily } from "../src";
import type { HistoryItem, ThreadSummary } from "../../data/src";
import { fixtureBranches, fixtureModel, fixtureRewind } from "./fixture";

const family = () => readFamily([fixtureBranches]);

describe("reading a family", () => {
  it("keeps what the owner reports, and absence stays absent", () => {
    const f = family();
    expect(f.rootId).toBe("lead");
    const [root, child] = f.items;
    expect(root).toMatchObject({ state: "current", pathNodes: 226, divergence: undefined });
    expect(child).toMatchObject({ parentId: "lead", divergence: { nodeId: "n100", ordinal: 100, parentContinues: true, request: "step 21" }, nodesAfterDivergence: 12 });
    expect(child!.title).toBeUndefined();
    expect(branchTitle(child!)).toBe("last asked");
  });
  it("merges pages without repeating an item, and carries truncation from any page", () => {
    const f = readFamily([fixtureBranches, { ...fixtureBranches, family_truncated: true }]);
    expect(f.items).toHaveLength(fixtureBranches.items.length);
    expect(f.familyTruncated).toBe(true);
  });
});

describe("layout", () => {
  it("columns follow order along the paths, tips stay in one last column, and counts come from the read", () => {
    const l = branchLayout(family());
    expect(l.tipColumn).toBe(3);
    expect(l.points.map((p) => [p.nodeId, p.column])).toEqual([["n100", 1], ["n150", 2]]);
    const edges = new Map(l.edges.map((e) => [e.key, e]));
    expect(edges.get("run:lead:n100")!.nodes).toBe(101);
    expect(edges.get("run:lead:n150")!.nodes).toBe(50);
    expect(edges.get("tip:lead")!.nodes).toBe(75);
    expect(edges.get("tip:fork-a")!.nodes).toBe(12);
    expect(edges.get("join:fork-a")).toMatchObject({ fromRow: 0, toRow: 1 });
  });
  it("highlights the current Thread, and an ancestor only up to where the current path leaves it", () => {
    const f = readFamily([{ ...fixtureBranches, thread_id: "fork-a", items: fixtureBranches.items.map((i) => ({ ...i, state: i.thread_id === "fork-a" ? "current" : i.thread_id === "lead" ? "ancestor" : "branch" })) }]);
    const l = branchLayout(f);
    const edges = new Map(l.edges.map((e) => [e.key, e]));
    expect(edges.get("run:lead:n100")!.active).toBe(true);
    expect(edges.get("run:lead:n150")!.active).toBe(false);
    expect(edges.get("tip:lead")!.active).toBe(false);
    expect(edges.get("join:fork-a")!.active).toBe(true);
    expect(edges.get("tip:fork-a")!.active).toBe(true);
    expect(l.points.find((p) => p.nodeId === "n100")!.active).toBe(true);
    expect(l.points.find((p) => p.nodeId === "n150")!.active).toBe(false);
  });
  it("a child with no shared prefix is drawn apart and never joined by a guess", () => {
    const l = branchLayout(family());
    const plain = l.lanes.find((x) => x.item.threadId === "plain-child")!;
    expect(plain.detached).toBe(true);
    expect(plain.item.divergenceUnknown).toBe("no_shared_prefix");
    expect(l.edges.some((e) => e.key === "join:plain-child")).toBe(false);
  });
  it("two children leaving at one node make one point", () => {
    const items = [...fixtureBranches.items, { ...fixtureBranches.items[1]!, thread_id: "fork-c" }];
    const l = branchLayout(readFamily([{ ...fixtureBranches, items }]));
    expect(l.points.find((p) => p.nodeId === "n100")!.branches).toBe(2);
  });
  it("a parent listed only by id doesn't lose its child", () => {
    const orphan = { ...fixtureBranches.items[1]!, parent_thread_id: "unlisted" };
    const l = branchLayout(readFamily([{ ...fixtureBranches, items: [orphan] }]));
    expect(l.lanes).toHaveLength(1);
    expect(l.points).toHaveLength(0);
  });
});

describe("marks on conversation rows", () => {
  const items: HistoryItem[] = [
    { node_id: "a", kind: "user", excerpt: "hello", provenance: { sender: { kind: "human" } } },
    { node_id: "b", kind: "assistant_response", excerpt: "reply" },
    { node_id: "c", kind: "tool_result", excerpt: "output" },
    { node_id: "d", kind: "event", excerpt: "bookkeeping" },
  ];
  it("a point on a hidden node goes on the row before it; a node not read shows nothing", () => {
    const rows = projectConversation(items);
    expect(branchRowMarks(items, rows, new Map([["c", 2]])).get("b")).toEqual({ nodeId: "c", branches: 2 });
    expect(branchRowMarks(items, rows, new Map([["b", 1]])).get("b")).toEqual({ nodeId: "b", branches: 1 });
    expect(branchRowMarks(items, rows, new Map([["elsewhere", 1]])).size).toBe(0);
  });
  it("a Thread's marks are its children's points and its own departure", () => {
    expect(branchMarks(family(), "lead")).toEqual(new Map([["n100", 1], ["n150", 1]]));
    expect(branchMarks(family(), "fork-a")).toEqual(new Map([["n100", 1]]));
  });
});

describe("rewind facts", () => {
  it("reads a dry run", () => {
    expect(readRewind(fixtureRewind)).toMatchObject({ removedNodes: 125, removedTurns: 25, pathBefore: 226, pathAfter: 101, branchThreadId: undefined, shells: { count: 1, items: ["cargo test"] } });
    expect(readRewind({ ...fixtureRewind, branch_thread_id: "kept" }).branchThreadId).toBe("kept");
  });
});

describe("routes", () => {
  it("branches keep the Thread and the point in the hash", () => {
    for (const r of [{ view: "branches" }, { view: "branches", threadId: "t" }, { view: "branches", threadId: "t", nodeId: "n" }, { view: "threads" }] as const) expect(parseRoute(formatRoute(r))).toEqual(r);
  });
});

describe("Branches over the fake transport", () => {
  const branches = async (route: "branches" | "conversation" = "branches") => {
    const made = await fixtureModel({ route });
    await settle(made.t, made.db);
    return made;
  };
  it("reads nothing until the view opens; opens no history", async () => {
    const { t } = await fixtureModel({ route: "monitor" });
    expect(t.calls("thread.branches")).toHaveLength(0);
    const open = await branches();
    expect(open.t.calls("thread.branches")).toHaveLength(1);
    expect(open.t.calls("thread.branches")[0]!.args).toMatchObject({ thread_id: "lead", limit: 200 });
    expect(open.t.calls("history.list")).toHaveLength(0);
    expect(open.model.branches.state.value.family?.items).toHaveLength(4);
  });
  it("walks pages, and starts over when the cursor expires", async () => {
    const { t, db, model } = await fixtureModel({ route: "monitor" });
    const plain = db.answer;
    let n = 0;
    db.answer = (c) => {
      if (c.command !== "thread.branches") return plain(c);
      n++;
      if (n === 1) return { ok: true, result: { ...fixtureBranches, items: fixtureBranches.items.slice(0, 2), next_cursor: "c1" } };
      if (n === 2) return { ok: false, code: "cursor_expired" };
      if (n === 3) return { ok: true, result: { ...fixtureBranches, items: fixtureBranches.items.slice(0, 2), next_cursor: "c2" } };
      return { ok: true, result: { ...fixtureBranches, items: fixtureBranches.items.slice(2) } };
    };
    const read = readWholeFamily(model.ops, "lead");
    await settle(t, db);
    const out = await read;
    expect(out).toMatchObject({ ok: true });
    expect(out.ok && out.family.items).toHaveLength(4);
    expect(n).toBe(4);
  });
  it("gives up on an expiring cursor after its bound and reports it", async () => {
    const { t, db, model } = await fixtureModel({ route: "monitor" });
    const plain = db.answer;
    db.answer = (c) => (c.command === "thread.branches" ? { ok: false, code: "cursor_expired" } : plain(c));
    const read = readWholeFamily(model.ops, "lead");
    await settle(t, db);
    expect(await read).toMatchObject({ ok: false, error: { code: "cursor_expired" } });
  });
  it("rewind runs only after a preview of that exact point, with an operation id only on the real one", async () => {
    const { t, db, model } = await branches();
    const b = model.branches;
    model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n100" });
    expect(b.target.value).toEqual({ threadId: "lead", nodeId: "n100" });
    void b.confirmRewind();
    await settle(t, db);
    expect(t.calls("thread.rewind")).toHaveLength(0);
    void b.previewRewind(b.target.value!);
    await settle(t, db);
    expect(b.rewind.value.kind).toBe("ready");
    const [preview] = t.calls("thread.rewind");
    expect(preview!.args).toMatchObject({ thread_id: "lead", node_id: "n100", dry_run: true });
    expect(preview!.operation_id).toBeUndefined();
    void b.confirmRewind();
    await settle(t, db);
    const real = t.calls("thread.rewind")[1]!;
    expect(real.args).toEqual({ thread_id: "lead", node_id: "n100" });
    expect(real.operation_id).toBeTruthy();
    expect(b.rewind.value).toMatchObject({ kind: "done", facts: { branchThreadId: "kept" } });
  });
  it("choosing another point withdraws the preview", async () => {
    const { t, db, model } = await branches();
    const b = model.branches;
    model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n100" });
    void b.previewRewind(b.target.value!);
    await settle(t, db);
    model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n150" });
    expect(b.rewind.value.kind).toBe("idle");
    void b.confirmRewind();
    await settle(t, db);
    expect(t.calls("thread.rewind")).toHaveLength(1);
  });
  it("a refused preview shows the owner's reason and offers no confirmation", async () => {
    const { t, db, model } = await branches();
    const plain = db.answer;
    db.answer = (c) => (c.command === "thread.rewind" ? { ok: false, code: "invalid_state" } : plain(c));
    model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n100" });
    void model.branches.previewRewind(model.branches.target.value!);
    await settle(t, db);
    expect(model.branches.rewind.value).toMatchObject({ kind: "refused", error: { code: "invalid_state" } });
  });
  it("a failed real rewind keeps the preview, so it can be tried again", async () => {
    const { t, db, model } = await branches();
    const plain = db.answer;
    db.answer = (c) => (c.command === "thread.rewind" && !(c.args as { dry_run?: boolean }).dry_run ? { ok: false, code: "invalid_state" } : plain(c));
    model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n100" });
    void model.branches.previewRewind(model.branches.target.value!);
    await settle(t, db);
    void model.branches.confirmRewind();
    await settle(t, db);
    expect(model.branches.rewind.value).toMatchObject({ kind: "failed", facts: { removedNodes: 125 } });
  });
  it("fork names the new Thread and re-reads the family", async () => {
    const { t, db, model } = await branches();
    const before = t.calls("thread.branches").length;
    void model.branches.forkAt({ threadId: "lead", nodeId: "n100" });
    await settle(t, db);
    expect(model.branches.fork.value).toMatchObject({ kind: "done", threadId: "forked" });
    expect(t.calls("thread.fork")[0]!.operation_id).toBeTruthy();
    expect(t.calls("thread.branches").length).toBe(before + 1);
  });
  it("a list hint re-reads while open and not after leaving", async () => {
    const { t, db, model } = await branches();
    const before = t.calls("thread.branches").length;
    db.threads.fresh = { ...db.threads.lead!, thread_id: "fresh" };
    t.push({ t: "changed", thread_ids: ["fresh"], list: true });
    await settle(t, db);
    const after = t.calls("thread.branches").length;
    expect(after).toBeGreaterThan(before);
    model.applyRoute({ view: "monitor" });
    db.threads.fresh2 = { ...db.threads.lead!, thread_id: "fresh2" };
    t.push({ t: "changed", thread_ids: ["fresh2"], list: true });
    await settle(t, db);
    expect(t.calls("thread.branches").length).toBe(after);
  });
  it("a conversation reads marks once per Thread opened, not per hint", async () => {
    const { t, db, model } = await branches("conversation");
    expect(t.calls("thread.branches")).toHaveLength(1);
    expect(model.marks.value.get("n100")).toBe(1);
    t.push({ t: "changed", thread_ids: ["lead"], list: false });
    await settle(t, db);
    expect(t.calls("thread.branches")).toHaveLength(1);
    const plain = db.answer;
    db.answer = (c) => (c.command === "thread.branches" ? { ok: true, result: { ...fixtureBranches, items: [] } } : plain(c));
    model.openThread("broken");
    await settle(t, db);
    expect(t.calls("thread.branches")).toHaveLength(2);
    expect(model.marks.value.size).toBe(0);
  });
});

const summaryOf = (id: string, extra: Partial<ThreadSummary>): ThreadSummary => ({ thread_id: id, title: `t-${id}`, cwd: "/a", state: "idle", activity: "idle", updated_at: "2026-11-07T00:00:00+00:00", excerpt: "", ...extra });

describe("grouping Threads", () => {
  const items = [summaryOf("p", {}), summaryOf("c", { parent_id: "p" }), summaryOf("other", { parent_id: "p", cwd: "/b" }), summaryOf("run", { activity: "running", cwd: "/b" })];
  it("by directory: keeps the owner's order, nests a real child, names a parent elsewhere", () => {
    const groups = groupThreads(items, "directory");
    expect(groups.map((g) => g.key)).toEqual(["/a", "/b"]);
    expect(groups[0]!.rows.map((r) => [r.summary.thread_id, r.depth])).toEqual([["p", 0], ["c", 1]]);
    const other = groups[1]!.rows.find((r) => r.summary.thread_id === "other")!;
    expect(other).toMatchObject({ depth: 0, parentTitle: "t-p" });
  });
  it("by state: most urgent first", () => {
    const groups = groupThreads(items, "state");
    expect(groups[0]!.key).toBe("running");
    expect(groups.map((g) => g.rows.length).reduce((a, b) => a + b)).toBe(4);
  });
  it("counts listed descendants outside the selection, across levels", () => {
    const deep = [...items, summaryOf("g", { parent_id: "c" })];
    expect(listedDescendants(deep, new Set(["p"]))).toBe(3);
    expect(listedDescendants(deep, new Set(["p", "c"]))).toBe(2);
    expect(listedDescendants(deep, new Set(["run"]))).toBe(0);
  });
});

describe("Threads over the fake transport", () => {
  const open = async () => {
    const made = await fixtureModel({ route: "threads" });
    await settle(made.t, made.db);
    return made;
  };
  it("reads the largest page in the Active mode when opened, and not before", async () => {
    const before = await fixtureModel({ route: "monitor" });
    expect(before.t.calls("thread.list").filter((c) => (c.args as { limit?: number }).limit === 200)).toHaveLength(0);
    const { t, model } = await open();
    expect(t.calls("thread.list").some((c) => (c.args as { limit?: number; archived?: string }).limit === 200 && (c.args as { archived?: string }).archived === "exclude")).toBe(true);
    expect(model.org.state.value.loaded).toBe(true);
  });
  it("Archived reads its own mode and drops the selection; a filter goes to the owner", async () => {
    const { t, db, model } = await open();
    model.org.toggle("lead");
    model.org.setMode("only");
    await settle(t, db);
    expect(model.org.selected.value.size).toBe(0);
    expect((t.calls("thread.list").at(-1)!.args as { archived: string }).archived).toBe("only");
    model.org.setMode("exclude");
    model.org.setQuery("hist");
    await settle(t, db);
    expect((t.calls("thread.list").at(-1)!.args as { query: string }).query).toBe("hist");
  });
  it("archive sends the chosen ids with descendants and an operation id; nothing is optimistic", async () => {
    const { t, db, model } = await open();
    const org = model.org;
    org.setMany(["lead", "done"], true);
    const running = org.apply();
    expect(org.selected.value.size).toBe(2);
    await settle(t, db);
    await running;
    const call = t.calls("thread.archive")[0]!;
    expect(call.args).toEqual({ thread_ids: ["lead", "done"], descendants: true });
    expect(call.operation_id).toBeTruthy();
    expect(org.selected.value.size).toBe(0);
    expect(org.action.value).toMatchObject({ kind: "done", verb: "archive" });
  });
  it("in Archived the same action unarchives; turning descendants off sends none", async () => {
    const { t, db, model } = await open();
    const org = model.org;
    org.setMode("only");
    await settle(t, db);
    org.descendants.value = false;
    org.setMany(["lead"], true);
    const running = org.apply();
    await settle(t, db);
    await running;
    expect(t.calls("thread.unarchive")[0]!.args).toEqual({ thread_ids: ["lead"] });
    expect(t.calls("thread.archive")).toHaveLength(0);
  });
  it("a refusal keeps the selection and reports it", async () => {
    const { t, db, model } = await open();
    const plain = db.answer;
    db.answer = (c) => (c.command === "thread.archive" ? { ok: false, code: "input_limit" } : plain(c));
    model.org.setMany(["lead"], true);
    const running = model.org.apply();
    await settle(t, db);
    await running;
    expect(model.org.selected.value.has("lead")).toBe(true);
    expect(model.org.action.value).toMatchObject({ kind: "failed", error: { code: "input_limit" } });
  });
});
