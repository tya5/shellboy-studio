import type { StatusKey } from "./status";
import type { ThreadRow } from "./threads";

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
      const matches = (c.statuses.length === 0 || (row.status !== undefined && c.statuses.includes(row.status))) && (!c.attention || row.status === "recovery" || row.status === "awaiting");
      if (matches) { this.held.add(id); return true; }
      if (this.held.has(id)) { mismatch.add(id); return true; }
      return false;
    });
    if (!c.pinnedOnly) visible.sort((a, b) => Number(pins.has(b.summary.thread_id)) - Number(pins.has(a.summary.thread_id)));
    return { rows: visible, outOfFilter: mismatch };
  }
}

// Resolves pins outside the currently loaded list. Four reads run at once; the owner is the view model.
import { signal } from "@preact/signals-core";
import { Cancel, type Operations, type ThreadSummary } from "../../data/src";
import { threadTree } from "./threads";

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
      void this.ops.threadGet(id, { cancel }).then((out) => {
        if (cancel.cancelled || !this.wanted.has(id)) return;
        if (!out.ok) {
          if (out.error.kind === "owner" && out.error.code === "not_found") this.deleted.value = [...new Set([...this.deleted.peek(), id])];
          return;
        }
        const d = out.value;
        const field = (key: string) => typeof d[key] === "string" ? d[key] as string : "";
        this.facts.set(id, { thread_id: id, title: d.title, cwd: d.cwd ?? "", state: field("state"), activity: field("activity"), updated_at: field("updated_at"), excerpt: "", ...(d.archived_at ? { archived_at: d.archived_at } : {}) });
        this.publish();
      }).finally(() => { this.running.delete(id); this.pump(); });
    }
  }
}
