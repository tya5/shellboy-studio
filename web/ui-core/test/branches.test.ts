import { describe, expect, it } from "vitest";
import { details, flush, settle } from "../../data/test/harness";
import { branchMarks, branchRowMarks, branchTitle, formatRoute, parseRoute, materializeHistoryPresentation, readFamily, readRewind, readWholeFamily } from "../src";
import { Cancel } from "../../data/src";
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

describe("marks on conversation rows", () => {
  const items: HistoryItem[] = [
    { node_id: "a", kind: "user", excerpt: "hello", provenance: { sender: { kind: "human" } } },
    { node_id: "b", kind: "assistant_response", excerpt: "reply" },
    { node_id: "c", kind: "tool_result", excerpt: "output" },
    { node_id: "d", kind: "event", excerpt: "bookkeeping" },
  ];
  it("a canonical tool record keeps its own point; a node not read shows nothing", () => {
    const rows = materializeHistoryPresentation(items).rows;
    expect(branchRowMarks(items, rows, new Map([["c", 2]])).get("c")).toEqual({ nodeId: "c", branches: 2 });
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
    for (const r of [{ view: "branches" }, { view: "branches", threadId: "t" }, { view: "branches", threadId: "t", nodeId: "n" }] as const) expect(parseRoute(formatRoute(r))).toEqual(r);
    expect(parseRoute("#/monitor")).toEqual({ view: "conversation" });
    expect(parseRoute("#/threads")).toEqual({ view: "conversation" });
  });
});

describe("Branches over the fake transport", () => {
  const branches = async (route: "branches" | "conversation" = "branches") => {
    const made = await fixtureModel({ route });
    await settle(made.t, made.db);
    return made;
  };
  it("reads nothing until the view opens; opens no history", async () => {
    const { model, t, db } = await fixtureModel({ route: "inbox" });
    try {
      expect(t.calls("thread.branches")).toHaveLength(0);
      model.navigate({ view: "branches" });
      await settle(t, db);
      expect(t.calls("thread.branches")).toHaveLength(1);
      expect(t.calls("thread.branches")[0]!.args).toMatchObject({ thread_id: "lead", limit: 200 });
      expect(t.calls("history.list")).toHaveLength(0);
      expect(model.branches.state.value.family?.items).toHaveLength(4);
    } finally { model.dispose(); }
  });
  it("walks pages, and starts over when the cursor expires", async () => {
    const { t, db, model } = await fixtureModel({ route: "inbox" });
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
    const { t, db, model } = await fixtureModel({ route: "inbox" });
    const plain = db.answer;
    db.answer = (c) => (c.command === "thread.branches" ? { ok: false, code: "cursor_expired" } : plain(c));
    const read = readWholeFamily(model.ops, "lead");
    await settle(t, db);
    expect(await read).toMatchObject({ ok: false, error: { code: "cursor_expired" } });
  });
  it("keeps the new branch visible when its follow-up request fails", async () => {
    const { t, db, model } = await branches();
    const plain = db.answer;
    db.answer = c => c.command === "message.send" ? { ok: false, code: "invalid_state", message: "Cannot send" } : plain(c);
    model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n100" });
    const task = model.branches.forkAt({ threadId: "lead", nodeId: "n100" }, "new request");
    await settle(t, db); await settle(t, db); await task;
    expect(model.branches.fork.value.kind).toBe("done");
    expect(model.branches.actionError.value).toContain("Cannot send");
    model.dispose();
  });
  it("keeps rewind complete and reports a failed follow-up request", async () => {
    const { t, db, model } = await branches();
    const plain = db.answer;
    db.answer = c => c.command === "message.send" ? { ok: false, code: "invalid_state", message: "Cannot send" } : plain(c);
    model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n100" });
    void model.branches.previewRewind(model.branches.target.value!); await settle(t, db);
    const task = model.branches.confirmRewind("new request"); await settle(t, db); await settle(t, db); await task;
    expect(model.branches.rewind.value.kind).toBe("done");
    expect(model.branches.actionError.value).toContain("Cannot send");
    model.dispose();
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
    model.applyRoute({ view: "branches", threadId: "lead", nodeId: "n100" });
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
    t.push({ t: "changed", config_changed: false, thread_ids: ["fresh"], list: true });
    await settle(t, db);
    const after = t.calls("thread.branches").length;
    expect(after).toBeGreaterThan(before);
    model.applyRoute({ view: "inbox" });
    db.threads.fresh2 = { ...db.threads.lead!, thread_id: "fresh2" };
    t.push({ t: "changed", config_changed: false, thread_ids: ["fresh2"], list: true });
    await settle(t, db);
    expect(t.calls("thread.branches").length).toBe(after);
  });
  it("a conversation reads marks once per Thread opened, not per hint", async () => {
    const { t, db, model } = await branches("conversation");
    expect(t.calls("thread.branches")).toHaveLength(1);
    expect(model.marks.value.get("n100")).toBe(1);
    t.push({ t: "changed", config_changed: false, thread_ids: ["lead"], list: false });
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

describe("leaving these views cancels their reads", () => {
  it("Branches: leaving, and then a hint does nothing; returning reads", async () => {
    const { t, db, model } = await fixtureModel();
    model.applyRoute({ view: "branches" });
    await flush();
    const first = t.calls("thread.branches").at(-1)!;
    model.applyRoute({ view: "inbox" });
    await flush();
    expect(t.cancels()).toContain(first.id);
    db.answered.add(first.id);
    await settle(t, db);
    expect(model.branches.state.value).toMatchObject({ loading: false, family: undefined, error: undefined });
    model.applyRoute({ view: "branches" });
    await settle(t, db);
    expect(model.branches.state.value.family).toBeDefined();
  });
});
