// Limited read-only comparison of two lines from their confirmed shared node: excerpts after it, nothing more.
// A verified node is not proof of a common prefix/LCA.
import { signal } from "@preact/signals-core";
import { Cancel, type HistoryItem, type HistoryWindowResult, type Operations } from "../../data/src";
import type { BranchFamily, BranchItem } from "./branches";

export const compareInteger = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const revision = (v: unknown): v is number => typeof v === "string" && v.length > 0 || compareInteger(v);
export function anchorCandidate(a: BranchItem, b: BranchItem, family: BranchFamily): string | undefined {
  if (a.threadId === b.threadId || family.familyTruncated || family.ancestorsTruncated || family.rootParentUnavailable) return;
  if (a.divergenceUnknown || b.divergenceUnknown) return;
  if (a.parentId === b.threadId) return a.divergence?.nodeId;
  if (b.parentId === a.threadId) return b.divergence?.nodeId;
  if (a.parentId && a.parentId === b.parentId && a.divergence?.nodeId === b.divergence?.nodeId) return a.divergence?.nodeId;
  return;
}
export interface CompareSide {
  item: BranchItem; anchor?: string; ordinal?: number; revision?: number; total?: number;
  pages: HistoryItem[][]; next?: number; busy: boolean; error?: string;
}
export interface CompareState { selected: string[]; sides: CompareSide[]; stale: boolean; unavailable: boolean }

interface CompareInvocation {
  readonly epoch: number;
  readonly context: string;
  readonly cancel: Cancel;
  readonly pair: readonly string[];
}

export class BranchCompare {
  readonly state = signal<CompareState>({ selected: [], sides: [], stale: false, unavailable: false });
  private epoch = 0;
  private contextKey = "";
  private ready = false;
  private cancel = new Cancel();
  // Cancelled requests still occupy capacity until their promises settle.
  private active = new Map<number, CompareInvocation>();
  constructor(private readonly ops: Operations) {}
  context(key: string, ready: boolean): void {
    if (key === this.contextKey && ready === this.ready) return;
    this.contextKey = key; this.ready = ready; this.invalidate(true);
  }
  private invalidate(clear: boolean): void {
    const epoch = ++this.epoch;
    const old = this.cancel; this.cancel = new Cancel();
    old.cancel();
    if (epoch !== this.epoch) return;
    this.state.value = clear ? { selected: [], sides: [], stale: false, unavailable: false } : { ...this.state.peek(), sides: [], stale: true };
  }

  leave(): void { this.context("", false); }
  choose(id: string): void {
    const chosen = this.state.peek().selected;
    const next = chosen.includes(id) ? chosen.filter(x => x !== id) : chosen.length < 2 ? [...chosen, id] : chosen;
    if (next === chosen) return;
    const epoch = this.epoch + 1;
    this.invalidate(true);
    if (epoch !== this.epoch) return;
    this.state.value = { ...this.state.peek(), selected: next };
  }
  private update(index: number, patch: Partial<CompareSide>): void {
    const s = this.state.peek(); this.state.value = { ...s, sides: s.sides.map((x, i) => i === index ? { ...x, ...patch } : x) };
  }
  private capture(): CompareInvocation {
    return Object.freeze({ epoch: this.epoch, context: this.contextKey, cancel: this.cancel, pair: Object.freeze([...this.state.peek().selected]) });
  }
  private async run(index: number, task: (token: CompareInvocation) => Promise<void>, token: CompareInvocation): Promise<void> {
    if (!this.valid(token) || this.active.has(index) || this.active.size >= 2) return;
    this.active.set(index, token); this.update(index, { busy: true });
    try { if (this.valid(token)) await task(token); }
    catch { if (this.valid(token)) this.update(index, { error: "readFailed" }); }
    finally { if (this.active.get(index) === token) this.active.delete(index); if (this.valid(token)) this.update(index, { busy: false }); }
  }
  private valid(token: CompareInvocation): boolean {
    return this.ready && token.epoch === this.epoch && token.context === this.contextKey && token.cancel === this.cancel && !token.cancel.cancelled && token.pair.join("\0") === this.state.peek().selected.join("\0");
  }

  async refresh(family: BranchFamily): Promise<void> {
    // An explicit refresh, not a hint, may refill budgets. Reentry while busy does not.
    if (!this.ready || this.active.size || this.state.peek().selected.length !== 2) return;
    const selected = [...this.state.peek().selected];
    const pair = selected.map(id => family.items.find(x => x.threadId === id));
    const invocationEpoch = this.epoch + 1;
    this.invalidate(false);
    if (this.epoch !== invocationEpoch || !this.ready) return;
    const token = this.capture();
    if (!pair[0] || !pair[1]) { this.state.value = { selected, sides: [], stale: false, unavailable: true }; return; }
    const anchor = anchorCandidate(pair[0], pair[1], family);
    const sides = pair.map(item => ({ item: Object.freeze({ ...item! }), pages: [], busy: false } as CompareSide));
    this.state.value = { selected, sides, stale: false, unavailable: !anchor };
    if (!anchor || !this.valid(token)) return;
    await Promise.all(sides.map((_, i) => this.run(i, async token => {
      const item = sides[i]!.item;
      const point = await this.ops.historyWindow({ thread_id: item.threadId, node_id: anchor, before: 0, after: 0, excerpt_chars: 0 }, { cancel: token.cancel });
      if (!this.valid(token)) return;
      if (!point.ok) { this.update(i, { error: "anchorUnavailable" }); return; }
      const p = point.value; const node = p.items[0]; const ordinal = node?.selection?.ordinal;
      if (!revision(p.revision) || !compareInteger(p.total) || p.thread_id !== item.threadId || p.items.length !== 1 || node?.node_id !== anchor || !compareInteger(ordinal) || ordinal >= p.total) { this.update(i, { error: "anchorUnavailable" }); return; }
      this.update(i, { anchor, ordinal, revision: p.revision, total: p.total });
      await this.window(i, token, ordinal, anchor, p.revision);
    }, token)));
  }
  private async window(index: number, token: CompareInvocation, ordinal: number, expected: string, rev: number): Promise<void> {
    if (!this.valid(token)) return;
    const side = this.state.peek().sides[index]; if (!side) return;
    const out = await this.ops.historyWindow({ thread_id: token.pair[index]!, ordinal, expect_node_id: expected, before: 0, after: 49, excerpt_chars: 256 }, { cancel: token.cancel });
    if (!this.valid(token)) return;
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
    const token = this.capture();
    await this.run(index, token => this.window(index, token, side.next!, last.node_id!, side.revision!), token);
  }
}
