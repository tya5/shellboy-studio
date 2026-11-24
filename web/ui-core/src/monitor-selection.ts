import { Cancel, type Operations, type ThreadSummary } from "../../data/src";

import { signal } from "@preact/signals-core";

import type { StatusKey } from "./status";
import { threadTree, type ThreadRow } from "./threads";

export type MonitorArchive = "exclude" | "include" | "only";
export interface MonitorCriteria { statuses: readonly StatusKey[]; query: string; archive: MonitorArchive; pinnedOnly: boolean; attention?: boolean; pins: readonly string[]; refresh: number }
export interface MonitorSelectionResult { rows: ThreadRow[]; outOfFilter: ReadonlySet<string> }

/** Keeps previously displayed matches when only their status changes. */
export class MonitorSelection {
  private signature = "";
  private activeScope = "";
  private held = new Set<string>();
  select(rows: readonly ThreadRow[], c: MonitorCriteria): MonitorSelectionResult {
    const signature = JSON.stringify([c.statuses.slice().sort(), c.query, c.archive, c.refresh]);
    if (signature !== this.signature) { this.signature = signature; this.held.clear(); }
    if (this.activeScope !== `${c.pinnedOnly}:${!!c.attention}`) { this.activeScope = `${c.pinnedOnly}:${!!c.attention}`; this.held.clear(); }
    const query = c.query.trim().toLocaleLowerCase();
    const pins = new Set(c.pins);
    const mismatch = new Set<string>();
    const visible = rows.filter((row) => {
      const id = row.summary.thread_id;
      if (query && !row.summary.title.toLocaleLowerCase().includes(query)) return false;
      if (c.pinnedOnly) { if (pins.has(id)) { this.held.add(id); return true; } return false; }
      const archived = !!row.summary.archived_at;
      if ((c.archive === "exclude" && archived) || (c.archive === "only" && !archived)) return false;
      const matches = (c.statuses.length === 0 || (row.status !== undefined && c.statuses.includes(row.status))) && (!c.attention || row.status === "error" || row.status === "awaiting");
      if (matches) { this.held.add(id); return true; }
      if (this.held.has(id)) { mismatch.add(id); return true; }
      return false;
    });
    if (!c.pinnedOnly) visible.sort((a, b) => Number(pins.has(b.summary.thread_id)) - Number(pins.has(a.summary.thread_id)));
    return { rows: visible, outOfFilter: mismatch };
  }
}

// Resolves pins outside the currently loaded list. Four reads run at once; the owner is the view model.

export class MissingPins {
  readonly rows = signal<readonly ThreadRow[]>([]);
  readonly deleted = signal<readonly string[]>([]);
  private wanted = new Set<string>();
  private present = new Set<string>();
  private pending = new Set<string>();
  private running = new Map<string, Cancel>();
  private facts = new Map<string, ThreadSummary>();
  private closed = false;
  constructor(private ops: Operations) {}
  sync(pins: readonly string[], loaded: readonly ThreadRow[], active: boolean): void {
    this.present = new Set(loaded.map((r) => r.summary.thread_id));
    this.wanted = new Set(active ? pins : []);
    for (const [id, cancel] of this.running) { if (!this.wanted.has(id)) cancel.cancel(); else if (!cancel.cancelled) this.pending.add(id); }
    for (const id of this.pending) if (!this.wanted.has(id)) this.pending.delete(id);
    let changed = false;
    for (const id of this.facts.keys()) if (!this.wanted.has(id)) { this.facts.delete(id); changed = true; }
    if (changed || this.facts.size) this.publish();
    for (const id of this.wanted) this.pending.add(id);
    this.pump();
  }
  close(): void { this.closed = true; this.pending.clear(); for (const cancel of this.running.values()) cancel.cancel(); this.facts.clear(); this.publish(); }
  private publish(): void { this.rows.value = threadTree([...this.facts.values()].filter((row) => !this.present.has(row.thread_id)), new Map()); }
  private pump(): void {
    while (!this.closed && this.running.size < 4 && this.pending.size) {
      const id = [...this.pending].find((key) => !this.running.has(key));
      if (!id) break;
      this.pending.delete(id);
      const cancel = new Cancel(); this.running.set(id, cancel);
      void this.ops.threadList({ thread_ids: [id] }, { cancel }).then((out) => {
        if (cancel.cancelled || !this.wanted.has(id)) return;
        if (!out.ok) return;
        const d = out.value.items[0];
        if (!d) { this.deleted.value = [...new Set([...this.deleted.peek(), id])]; return; }
        this.facts.set(id, d);
        this.publish();
      }).finally(() => { this.running.delete(id); this.pump(); });
    }
  }
}


export const MAX_MONITOR_ARCHIVED_ROWS = 1000;

/** Owns the optional archived-list read without changing the shared sidebar filter. */
export class MonitorArchiveRows {
  readonly rows = signal<readonly ThreadRow[]>([]);
  private cancel?: Cancel;
  private generation = 0;
  constructor(private readonly ops: Operations) {}
  sync(active: boolean, archive: MonitorArchive): void {
    const wanted = active && archive !== "exclude";
    if (!wanted) { this.cancel?.cancel(); this.cancel = undefined; if (this.rows.peek().length) this.rows.value = []; this.generation++; return; }
    if (this.cancel) return;
    const cancel = this.cancel = new Cancel();
    const generation = ++this.generation;
    void this.read(cancel, generation);
  }
  close(): void { this.cancel?.cancel(); this.cancel = undefined; this.generation++; if (this.rows.peek().length) this.rows.value = []; }
  private async read(cancel: Cancel, generation: number): Promise<void> {
    const rows = new Map<string, ThreadSummary>();
    let cursor: string | undefined;
    while (!cancel.cancelled && rows.size < MAX_MONITOR_ARCHIVED_ROWS) {
      const page = await this.ops.threadList({ archived: "only", limit: Math.min(50, MAX_MONITOR_ARCHIVED_ROWS - rows.size), ...(cursor ? { cursor } : {}) }, { cancel });
      if (!page.ok || cancel.cancelled || generation !== this.generation) return;
      for (const row of page.value.items) { rows.set(row.thread_id, row); if (rows.size >= MAX_MONITOR_ARCHIVED_ROWS) break; }
      cursor = page.value.next_cursor;
      if (!cursor || page.value.items.length === 0) break;
    }
    if (cancel.cancelled || generation !== this.generation) return;
    this.rows.value = threadTree([...rows.values()], new Map());
  }
}
