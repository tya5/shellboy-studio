// Grouping of the saved Thread list. No visual assumptions (row counts, colours).
import type { ThreadSummary } from "../../data/src";
import { statusOfActivity, STATUS_KEYS, type StatusKey } from "./status";

export interface ThreadRow {
  summary: ThreadSummary;
  status: StatusKey | undefined;
  depth: number;
  childCount: number;
  parentTitle: string | undefined;
  pending: number;
}

const statusOf = (s: ThreadSummary, pending: number): StatusKey | undefined =>
  pending > 0 ? "awaiting" : statusOfActivity(s.activity);

/** Depth-first by parent, keeping the owner's order among siblings. A child whose parent isn't listed is a root. */
export function threadTree(items: ThreadSummary[], pending: ReadonlyMap<string, number> = new Map()): ThreadRow[] {
  const known = new Map(items.map((s) => [s.thread_id, s]));
  const children = new Map<string, ThreadSummary[]>();
  const roots: ThreadSummary[] = [];
  for (const s of items) {
    if (s.parent_id !== undefined && known.has(s.parent_id)) {
      const list = children.get(s.parent_id);
      if (list) list.push(s);
      else children.set(s.parent_id, [s]);
    } else roots.push(s);
  }
  const out: ThreadRow[] = [];
  const seen = new Set<string>();
  const walk = (s: ThreadSummary, depth: number): void => {
    if (seen.has(s.thread_id)) return;
    seen.add(s.thread_id);
    const kids = children.get(s.thread_id) ?? [];
    const count = pending.get(s.thread_id) ?? 0;
    out.push({
      summary: s,
      status: statusOf(s, count),
      depth,
      childCount: kids.length,
      parentTitle: s.parent_id !== undefined ? known.get(s.parent_id)?.title : undefined,
      pending: count,
    });
    for (const k of kids) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // A parent cycle can't come from the owner, but must not hide a Thread.
  for (const s of items) walk(s, 0);
  return out;
}

export type StatusCounts = Partial<Record<StatusKey, number>>;

export function countByStatus(rows: ThreadRow[]): StatusCounts {
  const counts: StatusCounts = {};
  for (const r of rows) if (r.status) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

/** Monitor order: what needs a person first, then live work, then the rest; owner order within a state. */
export function byUrgency(rows: ThreadRow[]): ThreadRow[] {
  const rank = (r: ThreadRow) => (r.status ? STATUS_KEYS.indexOf(r.status) : STATUS_KEYS.length);
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}
