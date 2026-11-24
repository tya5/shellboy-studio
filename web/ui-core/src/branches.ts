// A Thread family from `thread.branches`, and how it lays out. Branches are Threads: a child that shares
// a path prefix with its parent. Counts come from the read; nothing here derives them from anything else.
const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

export interface BranchItem {
  threadId: string;
  branchKind: "fork" | "rewind" | "unknown";
  /** Null from the owner when untitled. */
  title: string | undefined;
  parentId: string | undefined;
  depth: number;
  state: "current" | "ancestor" | "branch";
  running: boolean;
  divergence: { nodeId: string; ordinal: number; request: string | undefined } | undefined;
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
    branchKind: o.branch_kind === "fork" || o.branch_kind === "rewind" ? o.branch_kind : "unknown",
    title: str(o.title),
    parentId: str(o.parent_thread_id),
    depth: num(o.depth) ?? 0,
    state,
    running: o.running === true,
    divergence: d && nodeId && ordinal !== undefined ? { nodeId, ordinal, request: str(obj(d.request)?.text) } : undefined,
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
