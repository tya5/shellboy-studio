import type { ThreadSummary } from "../../data/src";
import { threadTree, type ThreadRow } from "./threads";
import { folderName } from "./format";

export const SIDEBAR_PIN_TAG = "pin";
export interface SidebarRow extends ThreadRow { descendants: number; awaiting: number; running: number; reveal: boolean; }
export interface SidebarGroup { key: string; directory?: string; rows: SidebarRow[]; }

export function sidebarGroups(items: readonly ThreadSummary[], selected?: string): SidebarGroup[] {
  const dirs = new Map<string, ThreadSummary[]>();
  const pins: ThreadSummary[] = [];
  for (const item of items) {
    if (item.tags?.includes(SIDEBAR_PIN_TAG)) pins.push(item);
    else {
      const group = dirs.get(item.cwd);
      if (group) group.push(item);
      else dirs.set(item.cwd, [item]);
    }
  }
  const pending = new Map(items.map(item => [item.thread_id, item.awaiting_human_count ?? 0]));
  const totals = new Map<string, { descendants: number; awaiting: number; running: number }>();
  const ancestors: string[] = [];
  for (const row of threadTree([...items], pending)) {
    ancestors.length = row.depth;
    for (const id of ancestors) {
      const count = totals.get(id)!;
      count.descendants++;
      if (row.status === "awaiting") count.awaiting++;
      if (row.status === "running") count.running++;
    }
    totals.set(row.summary.thread_id, { descendants: 0, awaiting: 0, running: 0 });
    ancestors.push(row.summary.thread_id);
  }
  const rowsFor = (group: ThreadSummary[]): SidebarRow[] => {
    const rows = threadTree(group, pending).map(row => ({ ...row, ...totals.get(row.summary.thread_id)!, reveal: false }));
    const parents: SidebarRow[] = [];
    for (const row of rows) {
      parents.length = row.depth;
      if (row.summary.thread_id === selected) for (const parent of parents) parent.reveal = true;
      parents.push(row);
    }
    return rows;
  };
  return [...(pins.length ? [{ key: "pins", rows: rowsFor(pins) }] : []),
    ...[...dirs].sort(([a], [b]) => (folderName(a) ?? a).localeCompare(folderName(b) ?? b) || a.localeCompare(b))
      .map(([directory, group]) => ({ key: `cwd:${directory}`, directory, rows: rowsFor(group) }))];
}
