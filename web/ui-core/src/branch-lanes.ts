// Branch rows use owner ordinals and stable node IDs.
import { signal } from "@preact/signals-core";
import type { HistoryItem, HistoryWindowResult } from "../../data/src";
import type { BranchFamily, BranchItem } from "./branches";

export type LaneRowKind = "start" | "message" | "split" | "run" | "tip";

export interface LaneRow {
  /** Stable lane + node, role, or run start. */
  key: string;
  lane: string;
  kind: LaneRowKind;
  /** Zero-based path position, when known. */
  ordinal: number | undefined;
  nodeId: string | undefined;
  /** A run: the first and last hidden positions, inclusive. */
  from?: number;
  to?: number;
  branchTo: string[];
  pass: string[];
}

export interface Lane {
  item: BranchItem;
  /** Drawing column; at most LANE_COLUMNS, shared once a lane has ended. */
  column: number;
  /** Colour slot (0..2): the three chart tokens, always paired with the lane's name. */
  tone: number;
  parent: BranchItem | undefined;
  /** Starts with no shared prefix (or its parent is not in the family): drawn apart, never joined by a guess. */
  detached: boolean;
  /** First position the lane owns: 0 for a root, the split plus one for a branch. */
  start: number;
  /** Last position (the tip), when the owner reports the path size. */
  end: number | undefined;
}

export interface LaneGraph {
  lanes: Lane[];
  byId: ReadonlyMap<string, Lane>;
  rows: LaneRow[];
  /** Columns drawn: the most lanes open at one row, capped at LANE_COLUMNS. */
  columns: number;
}

// Keep labels when lanes share the final column.
export const LANE_COLUMNS = 6;

/** Lane order: depth first from each root; children by where they leave, apart-started children last. */
function laneOrder(family: BranchFamily): { order: BranchItem[]; byId: Map<string, BranchItem>; joined: (i: BranchItem) => boolean } {
  const byId = new Map(family.items.map((i) => [i.threadId, i]));
  const joined = (i: BranchItem) => i.parentId !== undefined && byId.has(i.parentId) && i.divergence !== undefined;
  const children = new Map<string, BranchItem[]>();
  for (const i of family.items) if (i.parentId !== undefined && byId.has(i.parentId)) {
    const list = children.get(i.parentId) ?? [];
    list.push(i);
    children.set(i.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => (a.divergence?.ordinal ?? Infinity) - (b.divergence?.ordinal ?? Infinity));
  const order: BranchItem[] = [];
  const seen = new Set<string>();
  const walk = (i: BranchItem): void => {
    if (seen.has(i.threadId)) return;
    seen.add(i.threadId);
    order.push(i);
    for (const c of children.get(i.threadId) ?? []) walk(c);
  };
  for (const i of family.items) if (i.parentId === undefined || !byId.has(i.parentId)) walk(i);
  for (const i of family.items) walk(i);
  return { order, byId, joined };
}

export function laneGraph(family: BranchFamily, nodeAt: (threadId: string, ordinal: number) => string | undefined = () => undefined, opened: (threadId: string) => Iterable<number> = () => []): LaneGraph {
  const { order, byId, joined } = laneOrder(family);
  const rows: LaneRow[] = [];
  const lanes: Lane[] = [];
  const span = new Map<string, { first: number; last: number }>();
  const splitRow = new Map<string, number>();
  order.forEach((item, index) => {
    const parent = item.parentId !== undefined ? byId.get(item.parentId) : undefined;
    const isJoined = joined(item);
    const start = isJoined ? item.divergence!.ordinal + 1 : 0;
    const end = item.pathNodes !== undefined ? item.pathNodes - 1 : undefined;
    lanes.push({ item, column: 0, tone: index % 3, parent, detached: !isJoined && item.parentId !== undefined, start, end });
    const leaving = new Map<number, { nodeId: string; to: string[] }>();
    for (const c of family.items) if (c.parentId === item.threadId && joined(c)) {
      const at = leaving.get(c.divergence!.ordinal);
      if (at) at.to.push(c.threadId);
      else leaving.set(c.divergence!.ordinal, { nodeId: c.divergence!.nodeId, to: [c.threadId] });
    }
    const shown = new Set<number>(leaving.keys());
    const ownEnd = end ?? Infinity;
    if (end === undefined || start <= end) shown.add(start);
    for (const o of opened(item.threadId)) if (o > start && o < ownEnd) shown.add(o);
    if (end !== undefined) shown.add(end);
    const positions = [...shown].sort((a, b) => a - b);
    const first = rows.length;
    let previous: number | undefined;
    for (const o of positions) {
      if (previous !== undefined && previous >= start - 1 && o > previous + 1) rows.push({ key: `${item.threadId}|run|${previous + 1}`, lane: item.threadId, kind: "run", ordinal: undefined, nodeId: undefined, from: previous + 1, to: o - 1, branchTo: [], pass: [] });
      const split = leaving.get(o);
      const kind: LaneRowKind = o === end ? "tip" : split ? "split" : o === start ? "start" : "message";
      const nodeId = kind === "tip" ? item.tipNodeId : split ? split.nodeId : nodeAt(item.threadId, o);
      const key = kind === "tip" ? `${item.threadId}|tip` : kind === "start" ? `${item.threadId}|start` : kind === "split" ? `${item.threadId}|split|${nodeId}` : `${item.threadId}|n|${nodeId ?? o}`;
      if (split) for (const to of split.to) splitRow.set(to, rows.length);
      rows.push({ key, lane: item.threadId, kind, ordinal: o, nodeId, branchTo: split?.to ?? [], pass: [] });
      previous = o;
    }
    // Without a path size the tip's position is unknown; it still ends the lane.
    if (end === undefined) rows.push({ key: `${item.threadId}|tip`, lane: item.threadId, kind: "tip", ordinal: undefined, nodeId: item.tipNodeId, branchTo: [], pass: [] });
    span.set(item.threadId, { first, last: rows.length - 1 });
  });
  // A joined lane's line starts at its parent's split row; columns are reused once a lane has ended.
  const intervals = lanes.map((l) => {
    const own = span.get(l.item.threadId)!;
    return { lane: l, from: splitRow.get(l.item.threadId) ?? own.first, to: own.last };
  }).sort((a, b) => a.from - b.from);
  const busyUntil: number[] = [];
  for (const iv of intervals) {
    let column = busyUntil.findIndex((until) => until < iv.from);
    if (column < 0) column = busyUntil.length;
    busyUntil[column] = iv.to;
    iv.lane.column = Math.min(column, LANE_COLUMNS - 1);
  }
  for (const iv of intervals) for (let r = iv.from + 1; r <= iv.to; r++) if (rows[r]!.lane !== iv.lane.item.threadId) rows[r]!.pass.push(iv.lane.item.threadId);
  return { lanes, byId: new Map(lanes.map((l) => [l.item.threadId, l])), rows, columns: Math.min(Math.max(busyUntil.length, 1), LANE_COLUMNS) };
}

/** The rows a rewind of `threadId` to `ordinal` would take off that lane. */
export function leavingRows(graph: LaneGraph, threadId: string, ordinal: number): Set<string> {
  const out = new Set<string>();
  for (const r of graph.rows) {
    if (r.lane !== threadId) continue;
    if (r.kind === "run" ? r.to! > ordinal : r.ordinal !== undefined ? r.ordinal > ordinal : r.kind === "tip") out.add(r.key);
  }
  return out;
}

export interface NodeExcerpt { kind: string | undefined; excerpt: string | undefined; ordinal: number | undefined }
/** A lane's first row (`start`, read after its split node when it has one), or one node. */
export type LaneNeed = { kind: "head"; threadId: string; start: number; split: string | undefined } | { kind: "node"; threadId: string; nodeId: string };
export const headNeed = (lane: Lane): LaneNeed => ({ kind: "head", threadId: lane.item.threadId, start: lane.start, split: lane.start > 0 ? lane.item.divergence?.nodeId : undefined });

export const LANE_EXCERPT_CHARS = 160;
/** Positions per Show more. */
export const LANE_PAGE = 24;
/** Family-wide disclosure cap. */
export const LANE_OPENED_MAX = 480;
/** Immutable node excerpt LRU. */
export const LANE_NODES_MAX = 2048;
/** Visible-row queue cap; oldest drops first. */
export const LANE_QUEUE_MAX = 48;
export const LANE_CONCURRENCY = 2;

export const needKey = (n: LaneNeed): string => n.kind === "head" ? `head:${n.threadId}:${n.start}:${n.split ?? ""}` : `node:${n.threadId}:${n.nodeId}`;

/** Positions are a projection of accepted Branches evidence; excerpts are immutable. */
export class LaneReader {
  readonly version = signal(0);
  private nodes = new Map<string, NodeExcerpt>();
  private positions = new Map<string, Map<number, string>>();
  node(id: string | undefined): NodeExcerpt | undefined { return id === undefined ? undefined : this.nodes.get(id); }
  nodeAt(id: string, ordinal: number): string | undefined { return this.positions.get(id)?.get(ordinal); }
  touch(): void { this.version.value = this.version.peek() + 1; }
  cache(items: HistoryItem[]): void {
    for (const i of items) if (i.node_id) {
      this.nodes.delete(i.node_id);
      this.nodes.set(i.node_id, { kind: i.kind, excerpt: i.excerpt, ordinal: i.selection?.ordinal });
    }
    while (this.nodes.size > LANE_NODES_MAX) this.nodes.delete(this.nodes.keys().next().value!);
  }
  project(snapshots: readonly HistoryWindowResult[], replace = false): void {
    if (replace) this.positions.clear();
    for (const { thread_id, items } of snapshots) {
      let at = this.positions.get(thread_id);
      if (!at) this.positions.set(thread_id, at = new Map());
      for (const i of items) if (i.node_id && i.selection?.ordinal !== undefined) at.set(i.selection.ordinal, i.node_id);
      this.cache(items);
    }
    this.touch();
  }
  reset(clearNodes: boolean): void {
    if (clearNodes) this.nodes.clear();
    if (this.positions.size || clearNodes) this.project([], true);
  }
}
