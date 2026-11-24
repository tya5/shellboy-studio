// The Branches lane graph and its bounded reads (#138): stable keys from Core IDs, counts from the owner's
// ordinals, columns reused once a lane ends, and reads that a re-read never repeats or clears.
import { describe, expect, it } from "vitest";
import { Link } from "../../data/src/link";
import { Cancel, Operations } from "../../data/src/operations";
import { FakeTransport, flush } from "../../data/test/harness";
import { LANE_CONCURRENCY, LANE_OPENED_MAX, LANE_QUEUE_MAX, LaneReader, headNeed, laneGraph, leavingRows } from "../src/branch-lanes";
import { readFamily, type BranchFamily } from "../src/branches";
import { fixtureBranches } from "./fixture";

const family = (): BranchFamily => readFamily([structuredClone(fixtureBranches) as unknown as Record<string, unknown>]);

describe("lane graph", () => {
  it("rows follow Conversation's order, depth first, with counts from the owner's ordinals", () => {
    const g = laneGraph(family());
    expect(g.lanes.map((l) => [l.item.threadId, l.start, l.end, l.detached])).toEqual([["lead", 0, 225, false], ["fork-a", 101, 112, false], ["rewound", 151, 225, false], ["plain-child", 0, 8, true]]);
    expect(g.rows.map((r) => r.key)).toEqual(["lead|start", "lead|run|1", "lead|split|n100", "lead|run|101", "lead|split|n150", "lead|run|151", "lead|tip", "fork-a|start", "fork-a|run|102", "fork-a|tip", "rewound|start", "rewound|run|152", "rewound|tip", "plain-child|start", "plain-child|run|1", "plain-child|tip"]);
    const run = g.rows.find((r) => r.key === "lead|run|101")!;
    expect([run.from, run.to]).toEqual([101, 149]);
    expect(g.rows.find((r) => r.key === "lead|split|n100")!.branchTo).toEqual(["fork-a"]);
    expect(g.rows.find((r) => r.key === "lead|tip")!.nodeId).toBe("n225");
  });

  it("a branch's line runs beside its parent from the split; ended lanes free their column", () => {
    const g = laneGraph(family());
    const column = (id: string) => g.byId.get(id)!.column;
    expect(column("lead")).toBe(0);
    expect(column("fork-a")).toBe(1);
    expect(column("rewound")).toBe(2);
    expect(column("plain-child")).toBe(0);
    expect(g.columns).toBe(3);
    expect(g.rows.find((r) => r.key === "lead|run|101")!.pass).toEqual(["fork-a"]);
    expect(g.rows.find((r) => r.key === "lead|tip")!.pass).toEqual(["fork-a", "rewound"]);
    expect(g.rows.find((r) => r.key === "fork-a|start")!.pass).toEqual(["rewound"]);
    expect(g.rows.find((r) => r.key === "plain-child|start")!.pass).toEqual([]);
  });

  it("every child lane's first segment starts at its parent's split row, also when it reuses a column to the left", () => {
    // Root "r" ends before its child's rows, so the grandchild takes column 0, left of its parent "c".
    const item = (id: string, parent: string | null, split: [string, number] | null, path: number) => ({ thread_id: id, parent_thread_id: parent, depth: 0, state: id === "r" ? "current" : "branch",
      divergence: split ? { node_id: split[0], ordinal: split[1], parent_continues: true } : null, size: { path_nodes: path }, tip: { node_id: `${id}-tip` } });
    const nested = readFamily([{ thread_id: "r", items: [item("r", null, null, 14), item("c", "r", ["n5", 5], 12), item("g", "c", ["n9", 9], 12)] }]);
    for (const f of [nested, family()]) {
      const g = laneGraph(f);
      for (const lane of g.lanes) {
        if (!lane.parent || lane.detached) continue;
        const id = lane.item.threadId;
        const split = g.rows.findIndex((r) => r.branchTo.includes(id));
        const own = g.rows.findIndex((r) => r.lane === id);
        expect(split, id).toBeGreaterThanOrEqual(0);
        expect(g.rows[split]!.lane, id).toBe(lane.parent.threadId);
        expect(g.rows[split]!.nodeId, id).toBe(lane.item.divergence!.nodeId);
        // Not drawn above the split; one unbroken line from the split down to the lane's own rows.
        g.rows.slice(0, split + 1).forEach((r) => expect(r.pass, `${id} above ${r.key}`).not.toContain(id));
        g.rows.slice(split + 1, own).forEach((r) => expect(r.pass, `${id} at ${r.key}`).toContain(id));
        expect(lane.column, id).not.toBe(g.byId.get(lane.parent.threadId)!.column);
      }
    }
    const g = laneGraph(nested);
    expect([g.byId.get("r")!.column, g.byId.get("c")!.column, g.byId.get("g")!.column]).toEqual([0, 1, 0]);
  });

  it("the same facts give the same keys; an appended message changes only the last run and the tip", () => {
    const a = laneGraph(family());
    expect(laneGraph(family()).rows.map((r) => r.key)).toEqual(a.rows.map((r) => r.key));
    const grown = family();
    const lead = grown.items.find((i) => i.threadId === "lead")!;
    lead.pathNodes = 227;
    lead.tipNodeId = "n226";
    const b = laneGraph(grown);
    expect(b.rows.map((r) => r.key)).toEqual(a.rows.map((r) => r.key));
    expect(b.rows.find((r) => r.key === "lead|run|151")!.to).toBe(225);
    expect(b.rows.find((r) => r.key === "lead|tip")!.nodeId).toBe("n226");
  });

  it("opened positions become message rows keyed by node ID, and split the run around them", () => {
    const g = laneGraph(family(), (id, o) => id === "lead" ? `n${o}` : undefined, (id) => id === "lead" ? [101, 102] : []);
    expect(g.rows.slice(3, 7).map((r) => r.key)).toEqual(["lead|n|n101", "lead|n|n102", "lead|run|103", "lead|split|n150"]);
  });

  it("two children leaving at one node make one split row; a parent listed only by ID keeps its child as a root", () => {
    const items = [...fixtureBranches.items, { ...fixtureBranches.items[1]!, thread_id: "fork-c" }];
    const two = laneGraph(readFamily([{ ...structuredClone(fixtureBranches), items } as unknown as Record<string, unknown>]));
    expect(two.rows.filter((r) => r.kind === "split" && r.nodeId === "n100").map((r) => r.branchTo)).toEqual([["fork-a", "fork-c"]]);
    const orphan = laneGraph(readFamily([{ ...structuredClone(fixtureBranches), items: [{ ...fixtureBranches.items[1]!, parent_thread_id: "unlisted" }] } as unknown as Record<string, unknown>]));
    expect(orphan.lanes).toHaveLength(1);
    expect(orphan.lanes[0]!).toMatchObject({ start: 0, detached: true });
    expect(orphan.rows.some((r) => r.kind === "split")).toBe(false);
  });

  it("a rewind preview marks only that lane's later rows", () => {
    const g = laneGraph(family());
    expect([...leavingRows(g, "lead", 100)]).toEqual(["lead|run|101", "lead|split|n150", "lead|run|151", "lead|tip"]);
    expect([...leavingRows(g, "fork-a", 101)]).toEqual(["fork-a|run|102", "fork-a|tip"]);
  });
});

describe("lane reads", () => {
  const setup = (supported = true) => {
    const t = new FakeTransport();
    const link = new Link(t);
    link.start();
    t.open();
    const ops = new Operations(link, () => "op", () => true);
    return { t, reader: new LaneReader(ops, () => supported) };
  };
  const answer = (t: FakeTransport, id: number, threadId: string, items: { node_id: string; kind: string; excerpt: string; ordinal: number }[]) =>
    t.ok(id, { thread_id: threadId, revision: 1, total: 300, items: items.map(({ ordinal, ...i }) => ({ ...i, execution_count: 0, selection: { ordinal } })) });

  it("reads one node or one head window per row, at most two at once, and never twice", async () => {
    const { t, reader } = setup();
    const g = laneGraph(family());
    reader.want({ kind: "node", threadId: "lead", nodeId: "n225" });
    reader.want(headNeed(g.byId.get("lead")!));
    reader.want(headNeed(g.byId.get("fork-a")!));
    reader.want({ kind: "node", threadId: "lead", nodeId: "n225" });
    const calls = t.calls("history.window");
    expect(calls).toHaveLength(LANE_CONCURRENCY);
    expect(calls.map((c) => c.args)).toEqual([
      { thread_id: "lead", node_id: "n225", before: 0, after: 0, excerpt_chars: 160 },
      { thread_id: "lead", ordinal: 0, before: 0, after: 0, excerpt_chars: 160 },
    ]);
    answer(t, calls[0]!.id, "lead", [{ node_id: "n225", kind: "assistant_response", excerpt: "after", ordinal: 225 }]);
    await flush();
    expect(t.calls("history.window")[2]!.args).toEqual({ thread_id: "fork-a", node_id: "n100", before: 0, after: 1, excerpt_chars: 160 });
    expect(reader.node("n225")).toEqual({ kind: "assistant_response", excerpt: "after", ordinal: 225 });
    reader.want({ kind: "node", threadId: "lead", nodeId: "n225" });
    expect(t.calls("history.window")).toHaveLength(3);
  });

  it("keeps a bounded queue, drops rows that left the screen, and reads nothing without the capability", () => {
    const { t, reader } = setup();
    for (let n = 0; n < LANE_QUEUE_MAX + 10; n++) reader.want({ kind: "node", threadId: "lead", nodeId: `x${n}` });
    expect(t.calls("history.window")).toHaveLength(LANE_CONCURRENCY);
    reader.release({ kind: "node", threadId: "lead", nodeId: `x${LANE_QUEUE_MAX + 9}` });
    expect((reader as unknown as { queue: Map<string, unknown> }).queue.size).toBe(LANE_QUEUE_MAX - 1);
    const off = setup(false);
    off.reader.want({ kind: "node", threadId: "lead", nodeId: "n1" });
    expect(off.t.calls("history.window")).toHaveLength(0);
  });

  it("a reset (owner change or leaving) drops late results and positions", async () => {
    const { t, reader } = setup();
    reader.want(headNeed(laneGraph(family()).byId.get("fork-a")!));
    const call = t.calls("history.window")[0]!;
    reader.reset(true);
    answer(t, call.id, "fork-a", [{ node_id: "n100", kind: "user", excerpt: "late", ordinal: 100 }, { node_id: "f101", kind: "user", excerpt: "late", ordinal: 101 }]);
    await flush();
    expect(reader.node("n100")).toBeUndefined();
    expect(reader.nodeAt("fork-a", 101)).toBeUndefined();
  });

  it("Show more opens one guarded page; refresh preserves disclosure but requires new membership", async () => {
    const { t, reader } = setup();
    reader.want(headNeed(laneGraph(family()).byId.get("fork-a")!));
    answer(t, t.calls("history.window")[0]!.id, "fork-a", [{ node_id: "n100", kind: "user", excerpt: "split", ordinal: 100 }, { node_id: "f101", kind: "user", excerpt: "first", ordinal: 101 }]);
    await flush();
    const opening = reader.open("fork-a", "fork-a|run|102", 102, 111);
    expect(reader.opening.value.has("fork-a|run|102")).toBe(true);
    const call = t.calls("history.window").at(-1)!;
    expect(call.args).toEqual({ thread_id: "fork-a", ordinal: 101, expect_node_id: "f101", before: 0, after: 10, excerpt_chars: 160 });
    answer(t, call.id, "fork-a", Array.from({ length: 11 }, (_, k) => ({ node_id: `f${101 + k}`, kind: "user", excerpt: `m${101 + k}`, ordinal: 101 + k })));
    await opening;
    expect([...reader.opened("fork-a")]).toEqual([102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);
    const f = family();
    reader.familyChanged(f);
    const grown = family();
    grown.items[1]!.pathNodes = 114; grown.items[1]!.tipNodeId = "f113";
    const revalidate = reader.readDisclosed(grown, undefined, new Cancel());
    const request = t.calls("history.window").at(-1)!;
    expect(request.args).toEqual({ thread_id: "fork-a", ordinal: 102, before: 0, after: 9, excerpt_chars: 160 });
    answer(t, request.id, "fork-a", Array.from({ length: 10 }, (_, k) => ({ node_id: `f${102 + k}`, kind: "user", excerpt: `m${102 + k}`, ordinal: 102 + k })));
    const windows = await revalidate;
    reader.familyChanged(grown);
    expect([...reader.opened("fork-a")]).toEqual([]);
    for (const { threadId, window } of windows) reader.refreshPoint(threadId, window);
    expect([...reader.opened("fork-a")]).toHaveLength(10);
    const rewound = family();
    rewound.items[1]!.pathNodes = 105; rewound.items[1]!.tipNodeId = "f104";
    reader.familyChanged(rewound);
    expect([...reader.opened("fork-a")]).toEqual([]);
    expect(reader.nodeAt("fork-a", 101)).toBeUndefined();
    expect(reader.node("f101")?.excerpt).toBe("first");
    expect(reader.canOpenMore()).toBe(true);
    expect(LANE_OPENED_MAX).toBeGreaterThan(0);
  });
});
