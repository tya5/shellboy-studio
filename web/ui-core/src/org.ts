// The Threads view: grouping and selection over a saved list. Parent links are real relations.
import type { ThreadSummary } from "../../data/src";
import { statusOfActivity, STATUS_KEYS, type StatusKey } from "./status";
import { threadTree, type ThreadRow } from "./threads";

export const THREAD_GROUPINGS = ["tree", "directory", "state", "tag"] as const;

/** What a bridge and owner can do beyond the pinned contract. Protocol 2 has no way to ask an owner. */
export const CAPABILITY_REPARENT = "thread.reparent";
/** Tags are Shellboy #222 stage 3, whose wire doesn't exist yet. Nothing here assumes it. */
export const CAPABILITY_TAGS = "thread.tags";
export type ThreadGrouping = (typeof THREAD_GROUPINGS)[number];

export interface ThreadGroup {
  key: string;
  rows: ThreadRow[];
}

/**
 * Keeps the owner's order. Within a group, children nest under a parent in the same group; one whose
 * parent is elsewhere stays a root, with `parentTitle` naming it.
 */
export function groupThreads(items: readonly ThreadSummary[], by: ThreadGrouping): ThreadGroup[] {
  if (by === "tag") return [];
  const titles = new Map(items.map((s) => [s.thread_id, s.title]));
  if (by === "tree") return items.length === 0 ? [] : [{ key: "", rows: threadTree([...items]) }];
  const groups = new Map<string, ThreadSummary[]>();
  const keyOf = (s: ThreadSummary): string => (by === "directory" ? s.cwd : (statusOfActivity(s.activity) ?? "idle"));
  for (const s of items) {
    const key = keyOf(s);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  const out = [...groups.entries()].map(([key, list]) => ({
    key,
    rows: threadTree(list).map((r) => ({ ...r, parentTitle: r.summary.parent_id !== undefined ? titles.get(r.summary.parent_id) : undefined })),
  }));
  if (by === "state") out.sort((a, b) => STATUS_KEYS.indexOf(a.key as StatusKey) - STATUS_KEYS.indexOf(b.key as StatusKey));
  return out;
}

/** Listed descendants of a selection, outside the selection itself. The owner applies its own rule on the real set. */
export function listedDescendants(items: readonly ThreadSummary[], selected: ReadonlySet<string>): number {
  const children = new Map<string, string[]>();
  for (const s of items) {
    if (s.parent_id === undefined) continue;
    const list = children.get(s.parent_id);
    if (list) list.push(s.thread_id);
    else children.set(s.parent_id, [s.thread_id]);
  }
  const found = new Set<string>();
  const stack = [...selected];
  while (stack.length > 0) {
    for (const c of children.get(stack.pop() as string) ?? []) {
      if (!found.has(c) && !selected.has(c)) {
        found.add(c);
        stack.push(c);
      }
    }
  }
  return found.size;
}
