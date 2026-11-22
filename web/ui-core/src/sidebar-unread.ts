import type { ThreadSummary } from "../../data/src";

export const UNREAD_LIMIT = 1000;
export interface UnreadRecord {
  thread: string;
  node: string | null;
  at: number | null;
  manual: boolean;
}

type End = ThreadSummary["last_end_message"];
function marker(thread: string, end: End, manual: boolean): UnreadRecord {
  const at = end?.at ? Date.parse(end.at) : NaN;
  return { thread, node: end?.node_id || null, at: Number.isFinite(at) ? at : null, manual };
}

export function isUnread(seen: UnreadRecord | undefined, end: End): boolean {
  if (!seen) return false;
  if (seen.manual) return true;
  if (!end?.node_id || end.node_id === seen.node) return false;
  if (!seen.node) return true;
  const at = marker(seen.thread, end, false).at;
  return seen.at !== null && at !== null && at > seen.at;
}

export function markUnread(records: UnreadRecord[], thread: string, end: End, manual: boolean): UnreadRecord[] {
  const next = marker(thread, end, manual);
  const old = records.find((item) => item.thread === thread);
  if (old && old.node === next.node && old.at === next.at && old.manual === next.manual) return records;
  return [...records.filter((item) => item.thread !== thread), next].slice(-UNREAD_LIMIT);
}

/** In-memory defaults for Threads never opened or marked on this device. */
export function baselineUnread(base: UnreadRecord[], rows: readonly Pick<ThreadSummary, "thread_id" | "last_end_message">[]): UnreadRecord[] {
  const known = new Set(base.map((item) => item.thread));
  const added: UnreadRecord[] = [];
  for (const row of rows) {
    if (known.has(row.thread_id)) continue;
    known.add(row.thread_id);
    added.push(marker(row.thread_id, row.last_end_message, false));
  }
  return added.length ? [...base, ...added].slice(-UNREAD_LIMIT) : base;
}

export function readUnreadRecords(value: unknown): UnreadRecord[] {
  if (!Array.isArray(value)) return [];
  const records = new Map<string, UnreadRecord>();
  for (const record of value.slice(-UNREAD_LIMIT)) {
    if (!record || typeof record.thread !== "string" || !record.thread || record.thread.length > 256
      || (record.node !== null && (typeof record.node !== "string" || record.node.length > 256))
      || (record.at !== null && !Number.isFinite(record.at)) || typeof record.manual !== "boolean") continue;
    records.set(record.thread, { thread: record.thread, node: record.node, at: record.at, manual: record.manual });
  }
  return [...records.values()];
}
