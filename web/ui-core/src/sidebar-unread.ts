import { MAX_LIST_ROWS, type ThreadSummary } from "../../data/src";

export const UNREAD_LIMIT = MAX_LIST_ROWS;
export interface UnreadRecord {
  thread: string;
  node: string | null;
  manual: boolean;
}

type End = ThreadSummary["last_end_message"];
function marker(thread: string, end: End, manual: boolean): UnreadRecord {
  const node = end?.node_id || null;
  return { thread, node, manual: node !== null && manual };
}

export function isUnread(seen: UnreadRecord | undefined, end: End): boolean {
  return !!(seen && end?.node_id && (seen.manual || end.node_id !== seen.node));
}

export function markUnread(records: UnreadRecord[], thread: string, end: End, manual: boolean): UnreadRecord[] {
  const next = marker(thread, end, manual);
  const old = records.find((item) => item.thread === thread);
  if (old && old.node === next.node && old.manual === next.manual) return records;
  return [...records.filter((item) => item.thread !== thread), next].slice(-UNREAD_LIMIT);
}

/** Seed missing entries in the same bounded store as explicit and automatic reads. */
export function seedUnreadMarkers(records: UnreadRecord[], rows: readonly Pick<ThreadSummary, "thread_id" | "last_end_message">[]): UnreadRecord[] {
  const known = new Set(records.map((item) => item.thread));
  const added: UnreadRecord[] = [];
  for (const row of rows) {
    if (known.has(row.thread_id)) continue;
    known.add(row.thread_id);
    added.push(marker(row.thread_id, row.last_end_message, false));
  }
  return added.length ? [...records, ...added].slice(-UNREAD_LIMIT) : records;
}

export function readUnreadRecords(value: unknown): UnreadRecord[] {
  if (!Array.isArray(value)) return [];
  const records = new Map<string, UnreadRecord>();
  for (const record of value.slice(-UNREAD_LIMIT)) {
    if (!record || typeof record.thread !== "string" || !record.thread || record.thread.length > 256
      || (record.node !== null && (typeof record.node !== "string" || record.node.length > 256))
      || typeof record.manual !== "boolean") continue;
    records.set(record.thread, { thread: record.thread, node: record.node, manual: record.manual });
  }
  return [...records.values()];
}
