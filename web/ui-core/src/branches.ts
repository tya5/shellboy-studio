// A Thread family from `thread.branches`, and how it lays out. Branches are Threads: a child that shares
// a path prefix with its parent. Counts come from the read; nothing here derives them from anything else.
const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

export interface BranchItem {
  threadId: string;
  /** Null from the owner when untitled. */
  title: string | undefined;
  parentId: string | undefined;
  depth: number;
  state: "current" | "ancestor" | "branch";
  running: boolean;
  /** The Thread holds a pruned replacement: those originals are gone. */
  prunedOriginals: boolean;
  divergence: { nodeId: string; ordinal: number; parentContinues: boolean; request: string | undefined } | undefined;
  /** `no_shared_prefix`: a child that shares no first node with its parent. */
  divergenceUnknown: string | undefined;
  tipNodeId: string | undefined;
  tipAt: string | undefined;
  tipRequest: string | undefined;
  pathNodes: number | undefined;
  nodesAfterDivergence: number | undefined;
}

export function readBranchItem(v: unknown): BranchItem | undefined {
  const o = obj(v);
  const threadId = str(o?.thread_id);
  if (!o || !threadId) return undefined;
  const d = obj(o.divergence);
  const nodeId = str(d?.node_id);
  const ordinal = num(d?.ordinal);
  const tip = obj(o.tip);
  const size = obj(o.size);
  const state = o.state === "current" || o.state === "ancestor" ? o.state : "branch";
  return {
    threadId,
    title: str(o.title),
    parentId: str(o.parent_thread_id),
    depth: num(o.depth) ?? 0,
    state,
    running: o.running === true,
    prunedOriginals: o.pruned_originals === true,
    divergence: d && nodeId && ordinal !== undefined ? { nodeId, ordinal, parentContinues: d.parent_continues === true, request: str(obj(d.request)?.text) } : undefined,
    divergenceUnknown: str(o.divergence_unknown),
    tipNodeId: str(tip?.node_id),
    tipAt: str(tip?.at),
    tipRequest: str(obj(tip?.last_request)?.text),
    pathNodes: num(size?.path_nodes),
    nodesAfterDivergence: num(size?.nodes_after_divergence),
  };
}

export interface BranchFamily {
  threadId: string | undefined;
  rootId: string | undefined;
  items: BranchItem[];
  familyThreads: number | undefined;
  /** More than 256 Threads in the family. */
  familyTruncated: boolean;
  ancestorsTruncated: boolean;
  rootParentUnavailable: boolean;
}

export function readFamily(pages: readonly Record<string, unknown>[]): BranchFamily {
  const first = pages[0] ?? {};
  const seen = new Set<string>();
  const items: BranchItem[] = [];
  for (const page of pages)
    for (const raw of Array.isArray(page.items) ? page.items : []) {
      const item = readBranchItem(raw);
      if (item && !seen.has(item.threadId)) {
        seen.add(item.threadId);
        items.push(item);
      }
    }
  return {
    threadId: str(first.thread_id),
    rootId: str(first.root_thread_id),
    items,
    familyThreads: num(first.family_threads),
    familyTruncated: pages.some((p) => p.family_truncated === true),
    ancestorsTruncated: pages.some((p) => p.ancestors_truncated === true),
    rootParentUnavailable: pages.some((p) => p.root_parent_unavailable === true),
  };
}

export const branchTitle = (i: BranchItem): string => i.title ?? i.tipRequest ?? i.threadId.slice(0, 8);

// ---- layout ----

/** A divergence point: where one or more children leave one parent's path. */
export interface GraphPoint {
  key: string;
  threadId: string;
  nodeId: string;
  ordinal: number;
  request: string | undefined;
  branches: number;
  column: number;
  row: number;
  active: boolean;
}

export interface GraphEdge {
  key: string;
  fromColumn: number;
  fromRow: number;
  toColumn: number;
  toRow: number;
  active: boolean;
  /** Nodes along this stretch, when the read gives what's needed. */
  nodes: number | undefined;
}

export interface GraphLane {
  item: BranchItem;
  row: number;
  /** The Thread's own path from its start to its tip is on the current path. */
  active: boolean;
  /** Starts with no shared prefix: drawn apart, not joined by a guess. */
  detached: boolean;
}

export interface BranchLayout {
  lanes: GraphLane[];
  points: GraphPoint[];
  edges: GraphEdge[];
  /** Columns before the tips: 0 is the start, then one per distinct divergence position. */
  tipColumn: number;
}

/**
 * Columns are structural: a point's position among all points, by ordinal, not its distance in nodes,
 * which could differ by thousands. The node counts are written on the stretches instead.
 */
export function branchLayout(family: BranchFamily): BranchLayout {
  const byId = new Map(family.items.map((i) => [i.threadId, i]));
  const children = new Map<string, BranchItem[]>();
  const roots: BranchItem[] = [];
  for (const i of family.items) {
    const joined = i.parentId !== undefined && byId.has(i.parentId);
    if (!joined) roots.push(i);
    else {
      const list = children.get(i.parentId!);
      if (list) list.push(i);
      else children.set(i.parentId!, [i]);
    }
  }
  const order: BranchItem[] = [];
  const seen = new Set<string>();
  const walk = (i: BranchItem): void => {
    if (seen.has(i.threadId)) return;
    seen.add(i.threadId);
    order.push(i);
    for (const c of children.get(i.threadId) ?? []) walk(c);
  };
  for (const r of roots) walk(r);
  for (const i of family.items) walk(i);
  const rowOf = new Map(order.map((i, n) => [i.threadId, n]));

  // The current path: the current Thread and, on each ancestor, up to where the next one leaves.
  const current = family.items.find((i) => i.state === "current") ?? family.items.find((i) => i.threadId === family.threadId);
  const activeUpTo = new Map<string, number>();
  const onPath = new Set<string>();
  for (let at = current, guard = 0; at && guard < 300; guard++) {
    onPath.add(at.threadId);
    const parent = at.parentId !== undefined ? byId.get(at.parentId) : undefined;
    if (parent && at.divergence && !activeUpTo.has(parent.threadId)) activeUpTo.set(parent.threadId, at.divergence.ordinal);
    at = parent;
  }
  const reached = (threadId: string, ordinal: number): boolean => {
    if (!onPath.has(threadId)) return false;
    const limit = activeUpTo.get(threadId);
    return limit === undefined || ordinal <= limit;
  };

  // One point per parent and node, however many children leave there.
  const points = new Map<string, GraphPoint>();
  for (const i of order) {
    if (!i.divergence || i.parentId === undefined || !byId.has(i.parentId)) continue;
    const key = `${i.parentId}|${i.divergence.nodeId}`;
    const had = points.get(key);
    if (had) had.branches++;
    else points.set(key, { key, threadId: i.parentId, nodeId: i.divergence.nodeId, ordinal: i.divergence.ordinal, request: i.divergence.request, branches: 1, column: 0, row: rowOf.get(i.parentId) ?? 0, active: reached(i.parentId, i.divergence.ordinal) });
  }
  const ordinals = [...new Set([...points.values()].map((p) => p.ordinal))].sort((a, b) => a - b);
  const columnOf = (ordinal: number) => ordinals.indexOf(ordinal) + 1;
  for (const p of points.values()) p.column = columnOf(p.ordinal);
  const tipColumn = ordinals.length + 1;

  const edges: GraphEdge[] = [];
  const lanes: GraphLane[] = order.map((item, row) => {
    const parent = item.parentId !== undefined ? byId.get(item.parentId) : undefined;
    const startsAtPoint = parent !== undefined && item.divergence !== undefined;
    const startColumn = startsAtPoint ? columnOf(item.divergence!.ordinal) : 0;
    const own = [...points.values()].filter((p) => p.threadId === item.threadId).sort((a, b) => a.ordinal - b.ordinal);
    if (startsAtPoint) {
      edges.push({ key: `join:${item.threadId}`, fromColumn: startColumn, fromRow: rowOf.get(parent!.threadId) ?? 0, toColumn: startColumn, toRow: row, active: onPath.has(item.threadId), nodes: undefined });
    }
    let column = startColumn;
    let ordinal = startsAtPoint ? item.divergence!.ordinal : -1;
    for (const p of own) {
      edges.push({ key: `run:${item.threadId}:${p.nodeId}`, fromColumn: column, fromRow: row, toColumn: p.column, toRow: row, active: reached(item.threadId, p.ordinal), nodes: p.ordinal - ordinal });
      column = p.column;
      ordinal = p.ordinal;
    }
    // After the last point: to the tip. The owner's count applies when no point sits on this lane.
    const remaining = item.pathNodes !== undefined ? item.pathNodes - 1 - ordinal : undefined;
    const nodes = own.length === 0 && startsAtPoint ? (item.nodesAfterDivergence ?? remaining) : remaining;
    edges.push({ key: `tip:${item.threadId}`, fromColumn: column, fromRow: row, toColumn: tipColumn, toRow: row, active: onPath.has(item.threadId) && !activeUpTo.has(item.threadId), nodes: nodes !== undefined && nodes >= 0 ? nodes : undefined });
    return { item, row, active: item.threadId === current?.threadId, detached: !startsAtPoint && item.parentId !== undefined };
  });
  return { lanes, points: [...points.values()], edges, tipColumn };
}

/** Which nodes of this Thread's path other branches leave at: node id to the number of branches. */
export function branchMarks(family: BranchFamily, threadId: string): Map<string, number> {
  const marks = new Map<string, number>();
  for (const i of family.items) {
    if (!i.divergence) continue;
    if (i.parentId === threadId || i.threadId === threadId) marks.set(i.divergence.nodeId, (marks.get(i.divergence.nodeId) ?? 0) + 1);
  }
  return marks;
}

/** What a rewind would do, from a dry run. Lists are the owner's, capped at 20 items by it. */
export interface RewindFacts {
  threadId: string | undefined;
  title: string | undefined;
  nodeId: string | undefined;
  removedNodes: number | undefined;
  removedTurns: number | undefined;
  pathBefore: number | undefined;
  pathAfter: number | undefined;
  shells: { count: number; truncated: boolean; items: string[] };
  children: { count: number; truncated: boolean };
  pendingReplies: { count: number; truncated: boolean };
  attachmentsRemoved: number;
  intoSummary: boolean;
  /** The owner's own sentence about what isn't undone. */
  note: string | undefined;
  /** A real rewind only: the child that keeps the removed part. Opening it is the undo. */
  branchThreadId: string | undefined;
}

const listOf = (v: unknown) => {
  const o = obj(v);
  return { count: num(o?.count) ?? 0, truncated: o?.truncated === true, items: Array.isArray(o?.items) ? o.items : [] };
};

export function readRewind(v: Record<string, unknown>): RewindFacts {
  const removed = obj(v.removed);
  const path = obj(v.path_nodes);
  const shells = listOf(v.shell_executions_after_node);
  const children = listOf(v.child_threads_after_node);
  const pending = listOf(v.pending_replies_to_sent_messages);
  return {
    threadId: str(v.thread_id),
    title: str(v.title),
    nodeId: str(v.node_id),
    removedNodes: num(removed?.nodes),
    removedTurns: num(removed?.turns),
    pathBefore: num(path?.before),
    pathAfter: num(path?.after),
    shells: { count: shells.count, truncated: shells.truncated, items: shells.items.flatMap((i) => str(obj(i)?.command_excerpt) ?? []) },
    children: { count: children.count, truncated: children.truncated },
    pendingReplies: { count: pending.count, truncated: pending.truncated },
    attachmentsRemoved: num(v.attachment_selections_removed) ?? 0,
    intoSummary: v.rewound_into_summarized_range === true,
    note: str(v.note),
    branchThreadId: str(v.branch_thread_id),
  };
}
