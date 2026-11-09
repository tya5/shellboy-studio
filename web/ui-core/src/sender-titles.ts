import { signal } from '@preact/signals-core';
import { Cancel, type Operations, type ThreadSummary } from '../../data/src';
export const SENDER_TITLE_LIMIT = 16;
export type SenderTitle = { state: 'loading' | 'unresolved'; title?: undefined } | { state: 'ready'; title: string };
interface Entry { cacheVersion: number; id: string; attempted: boolean; title: SenderTitle }
interface Flight { entry: Entry; scope: string; lifetime: number; cacheVersion: number; cancel: Cancel }
/** ADR-A285: one view-owned resolver; route/owner/explicit page alone reset the budget. */
export class SenderTitles {
  readonly values = signal<ReadonlyMap<string, SenderTitle>>(new Map());
  private entries = new Map<string, Entry>();
  private candidates = new Set<string>();
  private scope: string | undefined;
  private lifetime = 0;
  private updateRevision = 0;
  private attempts = 0;
  private flight: Flight | undefined;
  private closed = false;
  private pumping = false;
  constructor(private readonly ops: Pick<Operations, 'threadGet'>) {}
  get candidateCount(): number { return this.entries.size; }
  get attemptCount(): number { return this.attempts; }
  get inFlight(): number { return this.flight ? 1 : 0; }
  update(scope: string | undefined, ids: readonly string[], cached: readonly ThreadSummary[] = []): void {
    if (this.closed) return;
    const revision = ++this.updateRevision;
    const current = () => !this.closed && this.updateRevision === revision && this.scope === scope;
    if (scope !== this.scope) {
      this.scope = scope; this.lifetime++; this.entries.clear(); this.candidates.clear(); this.attempts = 0;
      const oldFlight = this.flight;
      oldFlight?.cancel.cancel();
      if (!current()) return;
    }
    const next = new Set<string>();
    if (scope !== undefined) for (const id of ids) {
      if (typeof id !== 'string' || id.trim() === '') continue;
      if (!this.entries.has(id) && this.entries.size < SENDER_TITLE_LIMIT) this.entries.set(id, { cacheVersion: 0, id, attempted: false, title: { state: 'unresolved' } });
      if (this.entries.has(id)) next.add(id);
    }
    if (next.size !== this.candidates.size || [...next].some(id => !this.candidates.has(id))) {
      this.candidates = next;
      if (this.flight && !next.has(this.flight.entry.id)) { this.flight.entry.title = { state: "unresolved" }; this.flight.cancel.cancel(); if (!current()) return; }
    }
    if (scope === undefined) { this.publish(); return; }
    for (const id of this.candidates) {
      const entry = this.entries.get(id);
      const hit = cached.find(row => row.thread_id === id);
      if (entry && hit && typeof hit.title === 'string' && (entry.title.state !== 'ready' || entry.title.title !== hit.title)) { entry.cacheVersion++; entry.title = { state: 'ready', title: hit.title }; }
    }
    this.publish(); if (current()) this.pump();
  }
  close(): void {
    this.closed = true; this.updateRevision++; this.lifetime++; this.scope = undefined; this.entries.clear(); this.candidates.clear();
    this.flight?.cancel.cancel(); this.values.value = new Map();
  }
  private valid(f: Flight): boolean {
    return !this.closed && this.flight === f && !f.cancel.cancelled && this.scope === f.scope && this.lifetime === f.lifetime && this.candidates.has(f.entry.id) && this.entries.get(f.entry.id) === f.entry;
  }
  private pump(): void {
    if (this.pumping || this.closed || !this.scope || this.flight || this.attempts >= SENDER_TITLE_LIMIT) return;
    const entry = [...this.entries.values()].find(e => !e.attempted && e.title.state !== 'ready' && this.candidates.has(e.id));
    if (!entry) return;
    this.pumping = true;
    entry.attempted = true; entry.title = { state: 'loading' }; this.attempts++;
    const f: Flight = { entry, scope: this.scope, lifetime: this.lifetime, cacheVersion: entry.cacheVersion, cancel: new Cancel() };
    this.flight = f;
    this.publish();
    // Ownership and cancellation are reserved before invoking transport (including reentrant doubles).
    Promise.resolve().then(async () => {
      if (!this.valid(f)) return;
      const result = await this.ops.threadGet(entry.id, { cancel: f.cancel });
      if (!this.valid(f) || entry.cacheVersion !== f.cacheVersion) return;
      entry.title = result.ok && result.value.thread_id === entry.id && typeof result.value.title === 'string'
        ? { state: 'ready', title: result.value.title } : { state: 'unresolved' };
      this.publish();
    }).catch(() => { if (this.valid(f) && entry.cacheVersion === f.cacheVersion) { entry.title = { state: 'unresolved' }; this.publish(); } }).finally(() => {
      if (this.flight === f) this.flight = undefined;
      this.pump();
    });
    this.pumping = false;
  }
  private publish(): void {
    const visible = new Map<string, SenderTitle>();
    for (const [id, entry] of this.entries) if (this.candidates.has(id)) visible.set(id, entry.title);
    this.values.value = visible;
  }
}
