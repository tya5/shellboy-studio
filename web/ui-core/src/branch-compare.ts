// Limited read-only comparison. A verified node is not proof of a common prefix/LCA.
import { signal } from "@preact/signals-core";
import { Cancel, type HistoryItem, type HistoryWindowResult, type Operations } from "../../data/src";
import type { BranchFamily, BranchItem } from "./branches";

export const compareInteger = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const object = (v: unknown): Record<string, unknown> | undefined => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const revision = (v: unknown): v is string | number => typeof v === "string" && v.length > 0 || compareInteger(v);
export interface RecordedCounter { known?: number; unknown?: number; overflow: boolean; exact: boolean }
export function recordedCounter(v: unknown): RecordedCounter {
  const o = object(v);
  const known = compareInteger(o?.known_sum) ? o.known_sum : undefined;
  const unknown = compareInteger(o?.unknown_count) ? o.unknown_count : undefined;
  const overflow = o?.overflow === true;
  return { ...(known !== undefined && { known }), ...(unknown !== undefined && { unknown }), overflow, exact: known !== undefined && unknown === 0 && o?.overflow === false };
}
export interface CompareUsageFacts {
  period: unknown; coverage: unknown; summary: RecordedCounter[]; partial: boolean; responses: number;
  input: RecordedCounter; cached: RecordedCounter; output: RecordedCounter;
}
function add(a: RecordedCounter, b: RecordedCounter): RecordedCounter {
  const sum = a.known !== undefined && b.known !== undefined ? a.known + b.known : undefined;
  const count = a.unknown !== undefined && b.unknown !== undefined ? a.unknown + b.unknown : undefined;
  const safe = compareInteger(sum); const safeCount = compareInteger(count);
  return { ...(safe && { known: sum }), ...(safeCount && { unknown: count }), overflow: a.overflow || b.overflow || sum !== undefined && !safe, exact: a.exact && b.exact && safe && safeCount && count === 0 };
}
export function anchorCandidate(a: BranchItem, b: BranchItem, family: BranchFamily): string | undefined {
  if (a.threadId === b.threadId || family.familyTruncated || family.ancestorsTruncated || family.rootParentUnavailable) return;
  if (a.divergenceUnknown || b.divergenceUnknown) return;
  if (a.parentId === b.threadId) return a.divergence?.nodeId;
  if (b.parentId === a.threadId) return b.divergence?.nodeId;
  if (a.parentId && a.parentId === b.parentId && a.divergence?.nodeId === b.divergence?.nodeId) return a.divergence?.nodeId;
  return;
}
export interface CompareSide {
  item: BranchItem; anchor?: string; ordinal?: number; revision?: string | number; total?: number;
  pages: HistoryItem[][]; next?: number; busy: boolean; error?: string; usage?: CompareUsageFacts;
  usageCalls: number; usageCursor?: string; usageSeen: string[]; period?: unknown; coverage?: unknown;
}
export interface CompareState { selected: string[]; sides: CompareSide[]; stale: boolean; unavailable: boolean; until?: string }

export class BranchCompare {
  readonly state = signal<CompareState>({ selected: [], sides: [], stale: false, unavailable: false });
  readonly body = signal<{ node?: string; text: string; pages: number; next?: string; busy: boolean; unavailable: boolean }>({ text: "", pages: 0, busy: false, unavailable: false });
  private epoch = 0;
  private contextKey = "";
  private ready = false;
  private cancel = new Cancel();
  // Cancelled requests still occupy capacity until their promises settle.
  private active = new Set<number>();
  private bodySide: number | undefined;
  private bodyAttempts = 0;
  constructor(private readonly ops: Operations, private readonly now: () => number = Date.now) {}
  context(key: string, ready: boolean): void {
    if (key === this.contextKey && ready === this.ready) return;
    this.contextKey = key; this.ready = ready; this.invalidate(true);
  }
  private invalidate(clear: boolean): void {
    this.epoch++; this.cancel.cancel(); this.cancel = new Cancel(); this.bodySide = undefined; this.bodyAttempts = 0;
    this.body.value = { text: "", pages: 0, busy: false, unavailable: false };
    this.state.value = clear ? { selected: [], sides: [], stale: false, unavailable: false } : { ...this.state.peek(), sides: [], stale: true };
  }
  hint(): void { if (this.state.peek().sides.length) this.state.value = { ...this.state.peek(), stale: true }; }
  pageChanged(): void { this.invalidate(true); }
  leave(): void { this.context("", false); }
  choose(id: string): void {
    const chosen = this.state.peek().selected;
    const next = chosen.includes(id) ? chosen.filter(x => x !== id) : chosen.length < 2 ? [...chosen, id] : chosen;
    if (next === chosen) return;
    this.invalidate(true); this.state.value = { ...this.state.peek(), selected: next };
  }
  private update(index: number, patch: Partial<CompareSide>): void {
    const s = this.state.peek(); this.state.value = { ...s, sides: s.sides.map((x, i) => i === index ? { ...x, ...patch } : x) };
  }
  private async run(index: number, task: (epoch: number, cancel: Cancel) => Promise<void>): Promise<void> {
    if (!this.ready || this.active.has(index) || this.active.size >= 2) return;
    const epoch = this.epoch; const cancel = this.cancel;
    this.active.add(index); this.update(index, { busy: true });
    try { await task(epoch, cancel); }
    catch { if (this.valid(epoch)) this.update(index, { error: "readFailed" }); }
    finally { this.active.delete(index); if (this.valid(epoch)) this.update(index, { busy: false }); }
  }
  private valid(epoch: number): boolean { return this.ready && epoch === this.epoch && !this.cancel.cancelled; }
  async refresh(family: BranchFamily): Promise<void> {
    // An explicit refresh, not a hint, may refill budgets. Reentry while busy does not.
    if (!this.ready || this.active.size || this.state.peek().selected.length !== 2) return;
    const selected = [...this.state.peek().selected];
    const pair = selected.map(id => family.items.find(x => x.threadId === id));
    this.invalidate(false);
    if (!pair[0] || !pair[1]) { this.state.value = { selected, sides: [], stale: false, unavailable: true }; return; }
    const anchor = anchorCandidate(pair[0], pair[1], family);
    const until = new Date(this.now()).toISOString();
    const sides = pair.map(item => ({ item: { ...item! }, pages: [], busy: false, usageCalls: 0, usageSeen: [] } as CompareSide));
    this.state.value = { selected, sides, stale: false, unavailable: !anchor, until };
    if (!anchor) return;
    await Promise.all(sides.map((_, i) => this.run(i, async (epoch, cancel) => {
      const item = sides[i]!.item;
      const point = await this.ops.historyWindow({ thread_id: item.threadId, node_id: anchor, before: 0, after: 0, excerpt_chars: 0 }, { cancel });
      if (!this.valid(epoch)) return;
      if (!point.ok) { this.update(i, { error: "anchorUnavailable" }); return; }
      const p = point.value; const node = p.items[0]; const ordinal = node?.selection?.ordinal;
      if (!revision(p.revision) || !compareInteger(p.total) || p.thread_id !== item.threadId || p.items.length !== 1 || node?.node_id !== anchor || !compareInteger(ordinal) || ordinal >= p.total) { this.update(i, { error: "anchorUnavailable" }); return; }
      this.update(i, { anchor, ordinal, revision: p.revision, total: p.total });
      await this.window(i, epoch, cancel, ordinal, anchor, p.revision);
    })));
  }
  private async window(index: number, epoch: number, cancel: Cancel, ordinal: number, expected: string, rev: string | number): Promise<void> {
    const side = this.state.peek().sides[index]; if (!side) return;
    const out = await this.ops.historyWindow({ thread_id: side.item.threadId, ordinal, expect_node_id: expected, before: 0, after: 49, excerpt_chars: 256 }, { cancel });
    if (!this.valid(epoch)) return;
    if (!out.ok) { this.update(index, { error: "pathChanged" }); return; }
    const p: HistoryWindowResult = out.value;
    if (p.revision !== rev || p.total !== side.total || !compareInteger(p.total) || p.items.length > 50 || !p.items.length || p.thread_id !== side.item.threadId || p.items[0]?.node_id !== expected || p.items.some((x, n) => !compareInteger(x.selection?.ordinal) || x.selection!.ordinal !== ordinal + n || typeof x.node_id !== "string" || (x.excerpt ? [...x.excerpt].length : 0) > 256)) { this.update(index, { error: "pathChanged" }); return; }
    const last = p.items.at(-1)!.selection!.ordinal!;
    if (last >= p.total || side.pages.length > 0 && p.items.length < 2 && last + 1 < p.total) { this.update(index, { error: "pathChanged" }); return; }
    this.update(index, { pages: [...side.pages, p.items].slice(-4), total: p.total, ...(last + 1 < p.total ? { next: last } : { next: undefined }), error: undefined });
  }
  async more(index: number): Promise<void> {
    if (this.state.peek().stale) return;
    const side = this.state.peek().sides[index]; if (!side || side.next === undefined || side.revision === undefined) return;
    const last = side.pages.at(-1)?.at(-1); if (!last?.node_id) return;
    // One row overlaps to retain an expected-node guard; remove that row from rendering.
    await this.run(index, (epoch, cancel) => this.window(index, epoch, cancel, side.next!, last.node_id!, side.revision!));
  }
  async usage(index: number): Promise<void> {
    if (this.state.peek().stale) return;
    const s = this.state.peek(); const side = s.sides[index];
    if (!side?.anchor || s.sides.some(x => !x.pages.length || x.error) || side.usageCalls >= 4 || side.usage && !side.usageCursor) return;
    await this.run(index, async (epoch, cancel) => {
      const cursor = side.usageCursor;
      const pageKey = cursor ?? "first";
      if (side.usageSeen.includes(pageKey)) return;
      this.update(index, { usageCalls: side.usageCalls + 1, usageSeen: [...side.usageSeen, pageKey] });
      // Owner enforces the 31-day limit after resolving the saved anchor time. No clipping/fallback.
      const out = await this.ops.usageGet({ thread_id: side.item.threadId, since_node_id: side.anchor!, until: s.until!, group_by: "thread", timezone: "UTC", limit: 168, ...(cursor && { cursor }) }, { cancel });
      if (!this.valid(epoch)) return;
      if (!out.ok) { this.update(index, { error: "usageUnavailable" }); return; }
      const p = out.value;
      if (!Array.isArray(p.items) || p.items.length > 168 || !object(p.requested_period)) { this.update(index, { error: "usageUnavailable" }); return; }
      const period = object(p.requested_period)!;
      const sinceMs = typeof period.since === "string" ? Date.parse(period.since) : NaN;
      const untilMs = typeof period.until === "string" ? Date.parse(period.until) : NaN;
      if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs !== Date.parse(s.until!) || sinceMs > untilMs || untilMs - sinceMs > 31 * 86400000) { this.update(index, { error: "usageUnavailable" }); return; }
      const counters = ["input_tokens", "cached_tokens", "output_tokens"] as const;
      const summary: RecordedCounter[] = counters.map(() => ({ known: 0, unknown: 0, overflow: false, exact: true }));
      const sums: RecordedCounter[] = counters.map(() => ({ known: 0, unknown: 0, overflow: false, exact: true }));
      for (const raw of p.items) {
        const row = object(raw);
        if (!row || row.key !== side.item.threadId) { this.update(index, { error: "usageUnavailable" }); return; }
        counters.forEach((name, j) => { summary[j] = add(summary[j]!, recordedCounter(object(row.compaction)?.[name])); });
        for (const state of ["completed", "failed", "incomplete"]) {
          const record = object(object(row.model_attempts)?.[state]);
          counters.forEach((name, j) => { sums[j] = add(sums[j]!, recordedCounter(record?.[name])); });
        }
      }
      const next = typeof p.next_cursor === "string" ? p.next_cursor : undefined;
      const prior = side.usage;
      this.update(index, { usageCursor: next, usage: { summary: summary.map((x, j) => prior ? add(prior.summary[j]!, x) : x), period: p.requested_period, coverage: { pages: [...(Array.isArray(object(prior?.coverage)?.pages) ? object(prior?.coverage)!.pages as unknown[] : []), { owner: p.coverage, scope_complete: p.scope_complete, statistics_scope: p.statistics_scope, scan_truncated: p.scan_truncated, excluded_time_count: p.excluded_time_count, unknown_time_compaction_records: p.unknown_time_compaction_records, malformed_compaction_records: p.malformed_compaction_records, scanned_candidates: p.scanned_candidates }] }, responses: side.usageCalls + 1, partial: (prior?.partial ?? false) || !!next || p.more === true || p.scope_complete !== true || p.excluded_time_count !== 0 || p.unknown_time_compaction_records !== 0 || p.malformed_compaction_records !== 0, input: prior ? add(prior.input, sums[0]!) : sums[0]!, cached: prior ? add(prior.cached, sums[1]!) : sums[1]!, output: prior ? add(prior.output, sums[2]!) : sums[2]! } });
    });
  }
  async openBody(index: number, node: string): Promise<void> {
    if (this.state.peek().stale) return;
    const side = this.state.peek().sides[index]; if (!side || !side.pages.some(p => p.some(n => n.node_id === node))) return;
    const prior = this.body.peek();
    if (this.bodySide !== undefined && (this.bodySide !== index || prior.node !== node)) return;
    if (this.bodyAttempts >= 2 || prior.pages > 0 && !prior.next || prior.busy) return;
    await this.run(index, async (epoch, cancel) => {
      this.bodyAttempts++; this.bodySide = index; this.body.value = { ...prior, node, busy: true };
      const out = await this.ops.historyGet({ node_id: node, limit_bytes: 16384, ...(prior.next && { cursor: prior.next }) }, { cancel });
      if (!this.valid(epoch)) return;
      if (!out.ok || new TextEncoder().encode(out.value.text).length > 16384 || out.ok && out.value.node_id !== node) { this.body.value = { ...prior, node, busy: false, unavailable: true }; return; }
      this.body.value = { node, text: prior.text + out.value.text, pages: prior.pages + 1, ...(out.value.next_cursor && { next: out.value.next_cursor }), busy: false, unavailable: false };
    });
  }
}
