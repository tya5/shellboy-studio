import type { ThreadSummary } from "../../data/src";
import { threadTree, type ThreadRow } from "./threads";

export const SIDEBAR_PIN_TAG = "pin";
export interface SidebarRow extends ThreadRow { key: string; descendants: number; awaiting: number; running: number; reveal: boolean; }
/** `count` is the band's Threads: pinned roots for Pins, listed rows for All and Archive. */
export interface SidebarGroup { key: "pins" | "all" | "archive"; rows: SidebarRow[]; count: number; }

function groupsFor(items: readonly ThreadSummary[], pinIds: ReadonlySet<string>, selected?: string, flat = false, allItems: readonly ThreadSummary[] = items, listKey: "all" | "archive" = "all"): SidebarGroup[] {
  const tree = threadTree([...items]);
  const byId = new Map(tree.map((row, index) => [row.summary.thread_id, index]));
  const ends: number[] = [];
  const totals = tree.map(() => ({ descendants: 0, awaiting: 0, running: 0 }));
  const ancestors: number[] = [];
  // A preorder subtree is contiguous; close it once and roll its status totals up.
  const close = (end: number) => {
    const index = ancestors.pop()!;
    ends[index] = end;
    const row = tree[index]!;
    const total = totals[index]!;
    total.descendants = end - index - 1;
    const parent = ancestors.at(-1);
    if (parent !== undefined) {
      totals[parent]!.awaiting += total.awaiting + Number(row.status === "awaiting");
      totals[parent]!.running += total.running + Number(row.status === "running");
    }
  };
  tree.forEach((row, index) => {
    while (ancestors.length > row.depth) close(index);
    ancestors.push(index);
  });
  while (ancestors.length) close(tree.length);

  const project = (band: SidebarGroup["key"], start: number, end: number, baseDepth: number): SidebarRow[] => {
    const rows: SidebarRow[] = [];
    const path: SidebarRow[] = [];
    for (let index = start; index < end; index++) {
      const row = tree[index]!;
      const depth = flat ? 0 : row.depth - baseDepth;
      path.length = depth;
      if (row.summary.thread_id === selected) for (const parent of path) parent.reveal = true;
      const key = JSON.stringify([band, ...path.map(parent => parent.summary.thread_id), row.summary.thread_id]);
      const counts = flat ? { descendants: 0, awaiting: 0, running: 0 } : totals[index]!;
      const copy = { ...row, ...counts, childCount: flat ? 0 : row.childCount, depth, key, reveal: false };
      rows.push(copy);
      path.push(copy);
    }
    return rows;
  };
  const roots = items.filter(item => pinIds.has(item.thread_id)).map(item => byId.get(item.thread_id)!);
  const pins = roots.flatMap(index => project("pins", index, flat ? index + 1 : ends[index]!, tree[index]!.depth));
  const allIds = new Set(allItems.map(item => item.thread_id));
  const all = flat
    ? allItems.flatMap(item => { const index = byId.get(item.thread_id); return index === undefined ? [] : project(listKey, index, index + 1, 0); })
    : project(listKey, 0, tree.length, 0).filter(row => allIds.has(row.summary.thread_id));
  return [...(pins.length ? [{ key: "pins" as const, rows: pins, count: roots.length }] : []), { key: listKey, rows: all, count: all.length }];
}

/**
 * `items` holds every row a band may show (listed, archived and the owner's pinned rows); `pinIds` is
 * the owner's pinned set (`thread.list` with the `pin` tag), the only source of Pins membership;
 * archived rows are dropped from Pins and All (see `unarchived`).
 * `allItems` and `archivedItems` are the owner's All and Archive reads, each its own tree, in Core order.
 */
export function sidebarGroups(items: readonly ThreadSummary[], pinIds: readonly string[], selected?: string, flat = false, allItems: readonly ThreadSummary[] = items, archivedItems: readonly ThreadSummary[] = []): SidebarGroup[] {
  const pinSet = new Set(pinIds);
  // The one row rule: a Thread Core reports as archived is shown only in Archive, never in Pinned or All (nor as their children).
  const unarchived = (rows: readonly ThreadSummary[]) => rows.filter(item => !item.archived_at);
  // Newest first, like Core's created order; a missing or unparseable time sorts last.
  const created = (item: ThreadSummary) => {
    const time = item.created_at ? Date.parse(item.created_at) : Number.NaN;
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };
  const pinnedItems = unarchived(items).sort((a, b) => {
    const aCreated = created(a), bCreated = created(b);
    return aCreated === bCreated ? b.thread_id.localeCompare(a.thread_id) : bCreated - aCreated;
  });
  const pinned = groupsFor(pinnedItems, pinSet, selected, flat, []).find(group => group.key === "pins");
  // Build the All tree from its own membership so hidden pin-only parents cannot affect depth or totals.
  const all = groupsFor(unarchived(allItems), new Set(), selected, flat, unarchived(allItems)).find(group => group.key === "all")!;
  // Archive is built the same way: archived children under their archived parent; an archived child of a listed parent is a root.
  const archive = groupsFor(archivedItems, new Set(), selected, flat, archivedItems, "archive").find(group => group.key === "archive")!;
  return [...(pinned?.rows.length ? [pinned] : []), all, ...(archive.rows.length ? [archive] : [])];
}
