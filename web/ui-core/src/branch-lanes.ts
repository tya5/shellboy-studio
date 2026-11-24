// The Branches lane graph (#138): each Thread of a family is one line of work drawn as a vertical lane, in
// Conversation's reading order (top is oldest). Rows and their keys come from `thread.branches` facts and node
// IDs, so a re-read with the same facts yields the same rows and keys, and an appended message changes only the
// lane's last stretch and tip. Message text comes from bounded `history.window` reads, cached by node ID.
import { batch, signal, type Signal } from "@preact/signals-core";
import { Cancel, type HistoryItem, type HistoryWindowResult, type Operations } from "../../data/src";
import type { BranchFamily, BranchItem } from "./branches";

export type LaneRowKind = "start" | "message" | "split" | "run" | "tip";

export interface LaneRow {
  /** Stable across re-reads: lane Thread ID plus a node ID, or a role (start, tip) or a run's first position. */
  key: string;
  /** The Thread whose lane this row is on. Actions on the row act on this Thread. */
  lane: string;
  kind: LaneRowKind;
  /** Position on the lane's path (0-based); absent only when the owner gave no size. */
  ordinal: number | undefined;
  nodeId: string | undefined;
  /** A run: the first and last hidden positions, inclusive. */
  from?: number;
  to?: number;
  /** Lanes that leave at this row's node. */
  branchTo: string[];
  /** Lanes whose line only runs past this row. */
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

/** Past six concurrent lanes the graph gets wide; further lanes share the last column and keep their names. */
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

/**
 * Rows of every lane, top to bottom. A lane shows its first message, each point where a branch leaves it, any
 * messages opened by "Show more", and its tip; the stretches between are runs with counts from the owner's
 * ordinals. `nodeAt` gives a node ID read for a position; `opened` lists positions opened on a lane.
 */
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

// ---- reads ----

export interface NodeExcerpt { kind: string | undefined; excerpt: string | undefined; ordinal: number | undefined }
/** A lane's first row (`start`, read after its split node when it has one), or one node. */
export type LaneNeed = { kind: "head"; threadId: string; start: number; split: string | undefined } | { kind: "node"; threadId: string; nodeId: string };
export const headNeed = (lane: Lane): LaneNeed => ({ kind: "head", threadId: lane.item.threadId, start: lane.start, split: lane.start > 0 ? lane.item.divergence?.nodeId : undefined });

/** Excerpt length asked for; rows show one line. */
export const LANE_EXCERPT_CHARS = 160;
/** Messages one "Show more" on a run opens. */
export const LANE_PAGE = 24;
/** Positions opened across the family before "Show more" stops; Conversation reads the rest. */
export const LANE_OPENED_MAX = 480;
/** Node excerpts kept; the oldest go first. Node text is immutable, so a kept one is never re-read. */
export const LANE_NODES_MAX = 2048;
/** Reads waiting for a visible row; the oldest waiting one is dropped past this. */
export const LANE_QUEUE_MAX = 48;
/** Reads in flight at once. */
export const LANE_CONCURRENCY = 2;

const needKey = (n: LaneNeed): string => n.kind === "head" ? `head:${n.threadId}:${n.start}:${n.split ?? ""}` : `node:${n.threadId}:${n.nodeId}`;
const excerptOf = (i: HistoryItem): NodeExcerpt => ({ kind: i.kind, excerpt: i.excerpt, ordinal: i.selection?.ordinal });

/**
 * Bounded reads behind the lane rows. Only rows on screen ask (`want`), the queue and concurrency are fixed,
 * and results are kept by node ID. Nothing is cleared by a family re-read, so rows keep their text; an owner
 * change or leaving the view (`reset`) drops everything in flight and the position maps.
 */
export class LaneReader {
  /** Bumped when read results land, so rows re-render with them. */
  readonly version: Signal<number> = signal(0);
  /** Runs being opened ("Show more"), by row key, and runs whose last attempt failed. */
  readonly opening: Signal<ReadonlySet<string>> = signal(new Set());
  readonly openFailed: Signal<ReadonlySet<string>> = signal(new Set());
  private revisions = new Map<string, number>();
  private nodes = new Map<string, NodeExcerpt>();
  private failed = new Set<string>();
  private positions = new Map<string, Map<number, string>>();
  private openedAt = new Map<string, Set<number>>();
  private openedCount = 0;
  private sizes = new Map<string, { tip: string | undefined; path: number | undefined }>();
  private queue = new Map<string, LaneNeed>();
  private inFlight = new Set<string>();
  private cancel = new Cancel();
  private epoch = 0;

  constructor(private readonly ops: Operations, private readonly supported: () => boolean) {}

  revision(threadId: string): number | undefined { return this.revisions.get(threadId); }
  node(nodeId: string | undefined): NodeExcerpt | undefined { return nodeId === undefined ? undefined : this.nodes.get(nodeId); }
  /** The read for this need ended without text: show it as unknown, do not retry until reset. */
  failedFor(need: LaneNeed): boolean { return this.failed.has(needKey(need)); }
  nodeAt(threadId: string, ordinal: number): string | undefined { return this.positions.get(threadId)?.get(ordinal); }
  opened(threadId: string): Iterable<number> { return this.openedAt.get(threadId) ?? []; }
  canOpenMore(): boolean { return this.openedCount < LANE_OPENED_MAX; }

  /** A row came on screen. */
  want(need: LaneNeed): void {
    if (!this.supported()) return;
    const key = needKey(need);
    if (this.failed.has(key) || this.inFlight.has(key) || this.queue.has(key) || this.satisfied(need)) return;
    this.queue.set(key, need);
    if (this.queue.size > LANE_QUEUE_MAX) this.queue.delete(this.queue.keys().next().value!);
    this.drain();
  }
  /** The row left the screen before its read started. */
  release(need: LaneNeed): void { this.queue.delete(needKey(need)); }

  private satisfied(need: LaneNeed): boolean {
    if (need.kind === "node") return this.nodes.has(need.nodeId);
    const id = this.nodeAt(need.threadId, need.start);
    return id !== undefined && this.nodes.has(id);
  }

  private remember(threadId: string, { revision, items }: HistoryWindowResult): boolean {
    if (revision < (this.revision(threadId) ?? 0)) return false;
    this.revisions.set(threadId, revision);
    let at = this.positions.get(threadId);
    if (!at) this.positions.set(threadId, at = new Map());
    for (const i of items) {
      if (!i.node_id) continue;
      if (i.selection?.ordinal !== undefined) at.set(i.selection.ordinal, i.node_id);
      this.nodes.delete(i.node_id);
      this.nodes.set(i.node_id, excerptOf(i));
    }
    while (this.nodes.size > LANE_NODES_MAX) this.nodes.delete(this.nodes.keys().next().value!);
    return true;
  }

  private drain(): void {
    while (this.inFlight.size < LANE_CONCURRENCY && this.queue.size) {
      const [key, need] = this.queue.entries().next().value!;
      this.queue.delete(key);
      this.inFlight.add(key);
      const epoch = this.epoch;
      const cancel = this.cancel;
      void this.readNeed(need, cancel).then((items) => {
        if (epoch !== this.epoch) return;
        this.inFlight.delete(key);
        batch(() => {
          if (items) this.remember(need.threadId, items);
          else this.failed.add(key);
          this.version.value = this.version.peek() + 1;
        });
        this.drain();
      });
    }
  }

  private async readNeed(need: LaneNeed, cancel: Cancel): Promise<HistoryWindowResult | undefined> {
    const args = need.kind === "node"
      ? { thread_id: need.threadId, node_id: need.nodeId, before: 0, after: 0, excerpt_chars: LANE_EXCERPT_CHARS }
      : need.split !== undefined
        ? { thread_id: need.threadId, node_id: need.split, before: 0, after: 1, excerpt_chars: LANE_EXCERPT_CHARS }
        : { thread_id: need.threadId, ordinal: need.start, before: 0, after: 0, excerpt_chars: LANE_EXCERPT_CHARS };
    const out = await this.ops.historyWindow(args, { cancel });
    return out.ok && out.value.thread_id === need.threadId ? out.value : undefined;
  }

  /** "Show more" on a run: opens up to LANE_PAGE positions from `from`, guarded by the node before it when known. */
  async open(threadId: string, runKey: string, from: number, to: number): Promise<void> {
    if (!this.supported() || this.opening.peek().has(runKey) || !this.canOpenMore()) return;
    const epoch = this.epoch;
    const cancel = this.cancel;
    const count = Math.min(LANE_PAGE, to - from + 1, LANE_OPENED_MAX - this.openedCount);
    const anchor = from > 0 ? this.nodeAt(threadId, from - 1) : undefined;
    const set = (s: Signal<ReadonlySet<string>>, on: boolean) => { const n = new Set(s.peek()); if (on) n.add(runKey); else n.delete(runKey); s.value = n; };
    batch(() => { set(this.opening, true); set(this.openFailed, false); });
    const out = await this.ops.historyWindow(anchor !== undefined
      ? { thread_id: threadId, ordinal: from - 1, expect_node_id: anchor, before: 0, after: count, excerpt_chars: LANE_EXCERPT_CHARS }
      : { thread_id: threadId, ordinal: from, before: 0, after: count - 1, excerpt_chars: LANE_EXCERPT_CHARS }, { cancel });
    if (epoch !== this.epoch) return;
    batch(() => {
      set(this.opening, false);
      const items = out.ok && out.value.thread_id === threadId ? out.value.items.filter((i) => i.node_id && i.selection?.ordinal !== undefined && i.selection.ordinal >= from && i.selection.ordinal <= to) : [];
      if (!items.length) { set(this.openFailed, true); return; }
      if (!out.ok || !this.remember(threadId, { ...out.value, items })) return;
      let shown = this.openedAt.get(threadId);
      if (!shown) this.openedAt.set(threadId, shown = new Set());
      for (const i of items) if (!shown.has(i.selection!.ordinal!)) { shown.add(i.selection!.ordinal!); this.openedCount++; }
      this.version.value = this.version.peek() + 1;
    });
  }

  /** Admit the open point from its targeted refresh, not from cached membership. */
  refreshPoint(threadId: string, window: HistoryWindowResult): boolean {
    if (!this.remember(threadId, window)) return false;
    this.version.value = this.version.peek() + 1;
    return true;
  }

  /** A targeted owner read disproved a cached position, even if the lane grew. */
  invalidatePath(threadId: string, revision?: number): void {
    if (revision !== undefined && revision > (this.revision(threadId) ?? 0)) this.revisions.set(threadId, revision);
    const opened = this.openedAt.get(threadId);
    this.openedCount -= opened?.size ?? 0;
    this.openedAt.delete(threadId);
    this.positions.delete(threadId);
    this.version.value = this.version.peek() + 1;
  }

  /**
   * A new family read. Appending keeps every position; a shorter path, or a new tip without growth (a rewind),
   * drops that lane's positions so they are read again rather than shown from an older path.
   */
  familyChanged(family: BranchFamily): void {
    let dropped = false;
    for (const i of family.items) {
      const had = this.sizes.get(i.threadId);
      this.sizes.set(i.threadId, { tip: i.tipNodeId, path: i.pathNodes });
      if (!had || had.tip === i.tipNodeId) continue;
      if (i.pathNodes === undefined || had.path === undefined || i.pathNodes <= had.path) {
        const opened = this.openedAt.get(i.threadId);
        this.openedCount -= opened?.size ?? 0;
        this.openedAt.delete(i.threadId);
        this.positions.delete(i.threadId);
        dropped = true;
      }
    }
    if (dropped) this.version.value = this.version.peek() + 1;
  }

  /** Owner change or the view closed: nothing in flight may land, positions are re-read next time. */
  reset(clearNodes: boolean): void {
    ++this.epoch;
    const old = this.cancel;
    this.cancel = new Cancel();
    this.queue.clear();
    this.inFlight.clear();
    this.failed.clear();
    this.positions.clear();
    this.openedAt.clear();
    this.openedCount = 0;
    this.sizes.clear();
    this.revisions.clear();
    if (clearNodes) this.nodes.clear();
    old.cancel();
    batch(() => {
      if (this.opening.peek().size) this.opening.value = new Set();
      if (this.openFailed.peek().size) this.openFailed.value = new Set();
      this.version.value = this.version.peek() + 1;
    });
  }
}
