import type { ThreadSummary } from "../../data/src";
import { threadTree, type ThreadRow } from "./threads";

export const SIDEBAR_PIN_TAG = "pin";
export interface SidebarRow extends ThreadRow { key: string; descendants: number; awaiting: number; running: number; reveal: boolean; }
export interface SidebarGroup { key: "pins" | "all"; rows: SidebarRow[]; }

export function sidebarGroups(items: readonly ThreadSummary[], selected?: string, flat = false, allItems: readonly ThreadSummary[] = items): SidebarGroup[] {
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
  const roots = items.filter(item => item.tags?.includes(SIDEBAR_PIN_TAG)).map(item => byId.get(item.thread_id)!);
  const pins = roots.flatMap(index => project("pins", index, flat ? index + 1 : ends[index]!, tree[index]!.depth));
  const allIds = new Set(allItems.map(item => item.thread_id));
  const all = flat
    ? allItems.flatMap(item => { const index = byId.get(item.thread_id); return index === undefined ? [] : project("all", index, index + 1, 0); })
    : project("all", 0, tree.length, 0).filter(row => allIds.has(row.summary.thread_id));
  return [...(pins.length ? [{ key: "pins" as const, rows: pins }] : []), { key: "all", rows: all }];
}
