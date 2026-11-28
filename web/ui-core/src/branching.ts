import { batch, signal, type Signal } from "@preact/signals-core";
import { Cancel, type Operations, type OpError, type Outcome, type HistoryWindowArgs, type HistoryWindowResult } from "../../data/src";
import { LANE_CONCURRENCY, LANE_EXCERPT_CHARS, LANE_OPENED_MAX, LANE_PAGE, LANE_QUEUE_MAX, LaneReader, laneGraph, needKey, type LaneNeed } from "./branch-lanes";
import { readFamily, readRewind, type BranchFamily, type RewindFacts } from "./branches";
import { CAPABILITY_TAGS, checkTag, TAGS_PER_CALL, type TagInvalid } from "./org";

const BRANCH_PAGE = 200;
const BRANCH_PAGES = 4;
const BRANCH_RESTARTS = 3;
const expired = (e: OpError) => e.kind === "owner" && e.code === "cursor_expired";

export interface FamilyState {
  threadId: string | undefined;
  loading: boolean;
  family: BranchFamily | undefined;
  error: OpError | undefined;
}

/** One family read to its end. Also used for the marks in a conversation. */
export async function readWholeFamily(ops: Operations, threadId: string, cancel?: Cancel): Promise<{ ok: true; family: BranchFamily } | { ok: false; error: OpError }> {
  restart: for (let attempt = 0; ; attempt++) {
    const pages: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < BRANCH_PAGES; n++) {
      const out = await ops.threadBranches({ thread_id: threadId, limit: BRANCH_PAGE, ...(cursor !== undefined && { cursor }) }, cancel ? { cancel } : undefined);
      if (!out.ok) {
        if (expired(out.error) && attempt < BRANCH_RESTARTS) continue restart;
        return { ok: false, error: out.error };
      }
      pages.push(out.value);
      cursor = typeof out.value.next_cursor === "string" ? out.value.next_cursor : undefined;
      if (cursor === undefined) break;
    }
    const family = readFamily(pages);
    const revisions = new Map(family.items.map(row => [row.threadId, row.selectionRevision]));
    const inconsistent = family.items.some(row => row.parentId && revisions.has(row.parentId)
      && row.divergence?.parentSelectionRevision !== undefined
      && row.divergence.parentSelectionRevision !== revisions.get(row.parentId));
    if (inconsistent) {
      if (attempt < BRANCH_RESTARTS) continue;
      return { ok: false, error: { kind: "invalid_response", message: "Branch parent path changed during read" } };
    }
    return { ok: true, family };
  }
}

export interface BranchTarget {
  threadId: string;
  nodeId: string;
}

export type RewindState =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "ready"; facts: RewindFacts; target: BranchTarget }
  | { kind: "refused"; error: OpError }
  | { kind: "rewinding"; facts: RewindFacts; target: BranchTarget }
  | { kind: "done"; facts: RewindFacts }
  | { kind: "failed"; facts: RewindFacts; target: BranchTarget; error: OpError };

export type ForkState = { kind: "idle" } | { kind: "forking" } | { kind: "done"; threadId: string; title: string } | { kind: "failed"; error: OpError };

const sameTarget = (a: BranchTarget | undefined, b: BranchTarget): boolean => a?.threadId === b.threadId && a?.nodeId === b.nodeId;

interface Invocation {
  owner: string | undefined;
  generation: number;
  epoch: number;
  view: string | undefined;
  target?: BranchTarget;
}
interface BranchReceipt<T> {
  id: string;
  outcome?: Outcome<T>;
  pending?: Promise<Outcome<T>>;
}
interface BranchAttempt {
  owner: string | undefined;
  key: string;
  uncertain: boolean;
  receipt: BranchReceipt<unknown>;
  target: BranchTarget;
  text: string;
  send?: BranchReceipt<unknown>;
  running?: Promise<void>;
}
interface RewindAttempt extends BranchAttempt { facts: RewindFacts }
interface ForkAttempt extends BranchAttempt { child?: { threadId: string; title: string } }
const uncertainOutcome = (out: Outcome<unknown>): boolean => !out.ok && !["not_connected", "busy"].includes(out.error.kind);
const outcomeMessage = (out: Outcome<unknown>): string | undefined => out.ok ? undefined :
  out.error.kind === "not_connected" || out.error.kind === "busy" ? `Not sent: ${out.error.message}` :
  `Not confirmed; may have applied (${out.operationId ?? "receipt unavailable"}): ${out.error.message}`;

export class Branches {
  readonly state: Signal<FamilyState> = signal({ threadId: undefined, loading: false, family: undefined, error: undefined });
  readonly rewind: Signal<RewindState> = signal({ kind: "idle" });
  readonly actionError: Signal<string | undefined> = signal(undefined);
  private rewindAttempt?: RewindAttempt;
  private forkAttempt?: ForkAttempt;
  private previewCancel = new Cancel();
  private refusal(message: string): void { this.actionError.value = message; }
  private projectionEpoch = 0;
  private ownerGeneration = 0;
  private observedOwner: string | undefined;
  private ownerObserved = false;
  ownerChanged(owner: string | undefined): void {
    if (!this.ownerObserved || owner !== this.observedOwner) {
      this.ownerObserved = true;
      this.observedOwner = owner;
      ++this.ownerGeneration;
      ++this.familyGeneration;
      this.again = false;
      const familyCancel = this.cancel;
      const previewCancel = this.previewCancel;
      this.previewCancel = new Cancel();
      batch(() => {
        this.resetLanes(true);
        this.state.value = { threadId: this.state.peek().threadId, loading: false, family: undefined, error: undefined };
        familyCancel.cancel();
        previewCancel.cancel();
      });
    }
  }
  private invocation(target?: BranchTarget): Invocation {
    this.ownerChanged(this.owner());
    return { owner: this.owner(), generation: this.ownerGeneration, epoch: this.projectionEpoch, view: this.currentView(), target: target ? { ...target } : undefined };
  }
  private visible(attempt: Pick<BranchAttempt, "owner">, token: Invocation): boolean {
    this.ownerChanged(this.owner());
    return !!token.owner && attempt.owner === token.owner && token.owner === this.owner() &&
      token.generation === this.ownerGeneration && token.epoch === this.projectionEpoch &&
      token.view === this.currentView() && (!token.target || sameTarget(this.target.peek(), token.target));
  }
  private receipt<T>(attempt: BranchAttempt, slot: BranchReceipt<T>, send: (id: string) => Promise<Outcome<T>>): Promise<Outcome<T>> {
    if (slot.pending) return slot.pending;
    if (attempt.owner && attempt.owner === this.owner() && slot.outcome?.ok) return Promise.resolve(slot.outcome);
    let settle!: (out: Outcome<T>) => void;
    const pending = new Promise<Outcome<T>>(resolve => { settle = resolve; });
    slot.pending = pending;
    const diagnostic = !attempt.owner || attempt.owner !== this.owner();
    const result = diagnostic
      ? this.ops.branchReceipt(slot.id) as Promise<Outcome<T>>
      : send(slot.id);
    void result.then(out => {
      if (!diagnostic) slot.outcome = out;
      slot.pending = undefined;
      settle(out);
    });
    return pending;
  }

  private runOnce(attempt: BranchAttempt, run: () => Promise<void>): Promise<void> {
    if (attempt.running) return attempt.running;
    let settle!: () => void;
    const running = attempt.running = new Promise<void>(resolve => { settle = resolve; });
    void run().finally(() => { attempt.running = undefined; settle(); });
    return running;
  }

  readonly fork: Signal<ForkState> = signal({ kind: "idle" });
  readonly target: Signal<BranchTarget | undefined> = signal(undefined);
  readonly targetRevision = signal<number | undefined>(undefined);
  private familyGeneration = 0;
  private running = false;
  private again = false;
  private cancel = new Cancel();

  readonly lanes = new LaneReader();
  readonly opening = signal<ReadonlySet<string>>(new Set());
  readonly openFailed = signal<ReadonlySet<string>>(new Set());
  private disclosed = new Map<string, Set<number>>();
  private revisions = new Map<string, number>();
  private seen = new Map<string, number>();
  private failed = new Set<string>();
  private queued = new Map<string, LaneNeed>();
  private pending = new Set<string>();
  private laneCancel = new Cancel();

  constructor(private readonly ops: Operations, private readonly owner: () => string | undefined = () => "synthetic-owner", private readonly view?: () => string | undefined, private readonly historyWindow: () => boolean = () => true) {}

  private resetLanes(clear: boolean): void {
    const old = this.laneCancel;
    this.laneCancel = new Cancel();
    this.disclosed.clear(); this.revisions.clear(); this.seen.clear(); this.failed.clear(); this.queued.clear(); this.pending.clear();
    if (this.opening.peek().size) this.opening.value = new Set();
    if (this.openFailed.peek().size) this.openFailed.value = new Set();
    this.lanes.reset(clear);
    old.cancel();
  }

  opened(id: string): number[] { return [...(this.disclosed.get(id) ?? [])].filter(o => this.lanes.nodeAt(id, o) !== undefined); }
  private get disclosedCount(): number { return [...this.disclosed.values()].reduce((n, set) => n + set.size, 0); }
  canOpenMore(): boolean { return this.disclosedCount < LANE_OPENED_MAX; }
  failedFor(need: LaneNeed): boolean { return this.failed.has(needKey(need)); }
  release(need: LaneNeed): void { this.queued.delete(needKey(need)); }

  private history(args: HistoryWindowArgs, cancel: Cancel) {
    return this.ops.historyWindow({ before: 0, after: 0, excerpt_chars: LANE_EXCERPT_CHARS, ...args }, { cancel });
  }

  private observe({ thread_id: id, revision }: HistoryWindowResult): void {
    this.seen.set(id, Math.max(this.seen.get(id) ?? 0, revision));
  }

  // A window must agree with the revision saved in the family snapshot, even at the same tip and size.
  private async admit(family: BranchFamily, id: string, cancel: Cancel, s?: HistoryWindowResult, cut?: Map<string, number>) {
    const lane = family.items.find(i => i.threadId === id);
    if (!lane) return false;
    const { pathNodes: size, tipNodeId: tip, selectionRevision } = lane;
    const paths = cut ?? this.revisions;
    let guard: HistoryWindowResult | undefined;
    if (!paths.has(id)) {
      if (size && tip && !s?.items.some(i => i.selection?.ordinal === size - 1 && i.node_id === tip)) {
        const out = await this.history({ thread_id: id, ordinal: size - 1, expect_node_id: tip, excerpt_chars: 0 }, cancel);
        if (cancel.cancelled) return false;
        if (!out.ok) return expired(out.error) ? "changed" as const : out.error;
        guard = out.value;
      } else if (!cut && (!size || !tip)) return false;
    }
    if (cancel.cancelled || (!cut && (this.running || this.state.peek().family !== family))) return false;
    let rev = paths.get(id);
    for (const w of [guard, s]) {
      if (!w) continue;
      if (w.thread_id !== id) return false;
      this.observe(w);
      if (selectionRevision !== w.revision || (rev ?? w.revision) !== w.revision || this.seen.get(id) !== w.revision ||
          (size !== undefined && size !== w.total) ||
          (tip !== undefined && w.items.some(i => i.selection?.ordinal === w.total - 1 && i.node_id !== tip))) return "changed" as const;
      rev = w.revision;
    }
    if (rev !== undefined) paths.set(id, rev);
    if (!cut && s) this.lanes.project([s]);
    return true;
  }

  private async extend(s: HistoryWindowResult, family: BranchFamily, cancel: Cancel, fail: () => void) {
    const result = await this.admit(family, s.thread_id, cancel, s);
    if (result === true || cancel.cancelled || this.running || this.state.peek().family !== family) return;
    if (result === "changed") void this.read(this.state.peek().threadId!);
    else fail();
  }

  want(need: LaneNeed): void {
    const key = needKey(need);
    const id = need.kind === "node" ? need.nodeId : this.lanes.nodeAt(need.threadId, need.start);
    if (!this.historyWindow() || this.lanes.node(id) || this.failed.has(key) || this.pending.has(key)) return;
    this.queued.set(key, need);
    if (this.queued.size > LANE_QUEUE_MAX) this.queued.delete(this.queued.keys().next().value!);
    this.drain();
  }

  private drain(): void {
    const family = this.state.peek().family;
    if (!family || this.running) return;
    while (this.pending.size < LANE_CONCURRENCY && this.queued.size) {
      const [key, need] = this.queued.entries().next().value!;
      this.queued.delete(key); this.pending.add(key);
      const cancel = this.laneCancel;
      const args = need.kind === "node" ? { node_id: need.nodeId } : need.split !== undefined ? { node_id: need.split, after: 1 } : { ordinal: need.start };
      void this.history({ thread_id: need.threadId, ...args }, cancel).then(async out => {
        if (cancel.cancelled) return;
        const fail = () => { this.failed.add(key); this.lanes.touch(); };
        if (out.ok && out.value.thread_id === need.threadId) {
          this.observe(out.value);
          if (this.running || this.state.peek().family !== family) this.lanes.cache(out.value.items);
          else await this.extend(out.value, family, cancel, fail);
        } else fail();
        if (!cancel.cancelled) { this.pending.delete(key); this.drain(); }
      });
    }
  }

  async open(id: string, key: string, from: number, to: number): Promise<void> {
    const family = this.state.peek().family;
    if (!family || !this.historyWindow() || this.opening.peek().size || !this.canOpenMore()) return;
    const count = Math.min(LANE_PAGE, to - from + 1, LANE_OPENED_MAX - this.disclosedCount);
    const anchor = this.lanes.nodeAt(id, from - 1);
    const cancel = this.laneCancel;
    this.opening.value = new Set([key]); this.openFailed.value = new Set();
    const out = await this.history({ thread_id: id, ...(anchor ? { ordinal: from - 1, expect_node_id: anchor, after: count } : { ordinal: from, after: count - 1 }) }, cancel);
    if (cancel.cancelled) return;
    batch(() => {
      this.opening.value = new Set();
      if (!out.ok || out.value.thread_id !== id) { this.openFailed.value = new Set([key]); return; }
      const shown = this.disclosed.get(id) ?? new Set<number>();
      this.disclosed.set(id, shown);
      for (let o = from; o < from + count; o++) shown.add(o);
      this.observe(out.value);
      if (this.running) this.again = true;
      else void this.extend(out.value, this.state.peek().family ?? family, cancel, () => this.openFailed.value = new Set([key]));
    });
  }

  private async readCut(family: BranchFamily, target: BranchTarget | undefined, cancel: Cancel) {
    const paths = new Map<string, number>();
    const snapshots: HistoryWindowResult[] = [];
    for (const { item: { threadId, pathNodes }, start } of laneGraph(family).lanes) {
      const ordinals = new Set(this.disclosed.get(threadId));
      if (this.lanes.nodeAt(threadId, start) !== undefined) ordinals.add(start);
      const positions = [...ordinals].filter(o => pathNodes === undefined || o < pathNodes).sort((a, b) => a - b);
      if (positions.length || target?.threadId === threadId) {
        const result = await this.admit(family, threadId, cancel, undefined, paths);
        if (typeof result === "object") return { error: result };
        if (result !== true) return;
      }
      for (let i = 0; i < positions.length;) {
        const from = positions[i++]!;
        let to = from;
        while (positions[i] === to + 1 && to - from + 1 < LANE_PAGE) to = positions[i++]!;
        const out = await this.history({ thread_id: threadId, ordinal: from, after: to - from }, cancel);
        if (!out.ok) return expired(out.error) ? undefined : { error: out.error };
        if (await this.admit(family, threadId, cancel, out.value, paths) !== true) return;
        snapshots.push(out.value);
      }
    }
    let point: number | undefined;
    if (target && family.items.some(i => i.threadId === target.threadId)) {
      const out = await this.history({ thread_id: target.threadId, node_id: target.nodeId }, cancel);
      if (cancel.cancelled) return;
      let selected: HistoryWindowResult;
      if (out.ok) {
        selected = out.value;
        if (selected.items[0]?.node_id !== target.nodeId) return;
        point = selected.revision;
      } else {
        const e = out.error;
        if (e.kind !== "owner" || !expired(e)) return { error: e };
        const { revision, total } = (e.details ?? {}) as Record<string, number>;
        if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(total) || revision! < 0 || total! < 0) return;
        selected = { thread_id: target.threadId, revision: revision!, total: total!, items: [] };
      }
      if (await this.admit(family, target.threadId, cancel, selected, paths) !== true) return;
      if (out.ok) snapshots.push(selected);
    }
    if ([...paths].some(([id, revision]) => revision < (this.seen.get(id) ?? 0))) return;
    return { paths, snapshots, point };
  }
  private currentView(): string | undefined { return this.view ? this.view() : this.state.peek().threadId; }

  leave(): void {
    ++this.projectionEpoch;
    const generation = ++this.familyGeneration;
    this.again = false;
    const previous = this.previewCancel;
    const marker = this.previewCancel = new Cancel();
    const familyCancel = this.cancel;
    this.resetLanes(false);
    familyCancel.cancel();
    previous.cancel();
    if (marker !== this.previewCancel || generation !== this.familyGeneration) return;
    if (this.state.peek().loading) this.state.value = { ...this.state.peek(), loading: false };
  }

  /** One family cut at a time, with bounded retries and one trailing hint. */
  async read(threadId: string): Promise<void> {
    if (!this.owner()) return;
    const generation = ++this.familyGeneration;
    this.cancel.cancel();
    if (generation !== this.familyGeneration) return;
    const had = this.state.peek();
    this.state.value = { threadId, loading: true, family: had.threadId === threadId ? had.family : undefined, error: undefined };
    if (generation !== this.familyGeneration) return;
    if (had.threadId !== threadId) this.clearActions();
    if (generation !== this.familyGeneration) return;
    this.again = true;
    if (this.running) return;
    this.running = true;
    try {
      let retries = 0;
      while (this.again) {
        this.again = false;
        const id = this.state.peek().threadId!;
        const epoch = this.familyGeneration;
        const cancel = this.cancel = new Cancel();
        const out = await readWholeFamily(this.ops, id, cancel);
        if (epoch !== this.familyGeneration) continue;
        const target = this.target.peek();
        const cut = out.ok && this.historyWindow() ? await this.readCut(out.family, target, cancel) : undefined;
        if (epoch !== this.familyGeneration) continue;
        if (out.ok && this.historyWindow() && (!cut || target !== this.target.peek() || this.again)) {
          if (++retries <= BRANCH_RESTARTS) { this.again = true; continue; }
          this.again = false;
          this.clearPreview();
          this.state.value = { ...this.state.peek(), loading: false, error: { kind: "invalid_response", message: "Branch path changed during read" } };
        } else if (!out.ok || cut?.error) this.state.value = { ...this.state.peek(), loading: false, error: out.ok ? cut?.error : out.error };
        else batch(() => {
          if (cut?.paths) {
            this.revisions = cut.paths;
            this.lanes.project(cut.snapshots, true);
            if (target && cut.point === undefined) this.choose(undefined);
            else if (this.targetRevision.peek() !== cut.point) {
              this.targetRevision.value = cut.point;
              if (["ready", "previewing", "refused"].includes(this.rewind.peek().kind)) this.clearPreview();
            }
          }
          this.state.value = { threadId: id, loading: false, family: out.family, error: undefined };
        });
      }
    } finally { this.running = false; this.drain(); }
  }

  ensure(threadId: string): void {
    const s = this.state.peek();
    if (s.threadId !== threadId || (!s.family && !s.loading)) void this.read(threadId);
  }

  private clearPreview(): void {
    const old = this.previewCancel;
    this.previewCancel = new Cancel();
    this.rewind.value = { kind: "idle" };
    old.cancel();
  }

  clearActions(): void {
    const previous = this.previewCancel;
    const marker = this.previewCancel = new Cancel();
    const generation = this.familyGeneration;
    previous.cancel();
    if (marker !== this.previewCancel || generation !== this.familyGeneration) return;
    batch(() => {
      this.rewind.value = { kind: "idle" };
      this.fork.value = { kind: "idle" };
    });
  }

  choose(next: BranchTarget | undefined): void {
    const cur = this.target.peek();
    if (next ? sameTarget(cur, next) : cur === undefined) return;
    batch(() => {
      this.targetRevision.value = next ? this.revisions.get(next.threadId) : undefined;
      this.target.value = next ? { ...next } : undefined;
      this.clearActions();
    });
  }

  select(viewed: string | undefined, nodeId: string | undefined): void {
    const family = this.state.peek().family;
    if (!nodeId || !viewed) return this.choose(undefined);
    const items = family?.items ?? [];
    const ids = new Set(items.map(i => i.threadId));
    const parents = items.filter(i => i.parentId && ids.has(i.parentId) && i.divergence?.nodeId === nodeId).map(i => i.parentId!);
    this.choose({ threadId: parents.includes(viewed) ? viewed : parents[0] ?? viewed, nodeId });
  }

  private superseded({ threadId }: BranchTarget): boolean {
    return (this.seen.get(threadId) ?? 0) > (this.targetRevision.peek() ?? this.revisions.get(threadId) ?? 0);
  }

  async previewRewind(target: BranchTarget): Promise<void> {
    const token = this.invocation(target);
    if (this.state.peek().error || this.superseded(target)) return;
    const previewOwner = { owner: token.owner };
    if (!this.visible(previewOwner, token)) return;
    const previous = this.previewCancel;
    const cancel = this.previewCancel = new Cancel();
    previous.cancel();
    if (cancel !== this.previewCancel || !this.visible(previewOwner, token)) { cancel.cancel(); return; }
    this.rewind.value = { kind: "previewing" };
    if (cancel !== this.previewCancel || !this.visible(previewOwner, token)) { cancel.cancel(); return; }
    const out = await this.ops.threadRewindPreview({ thread_id: target.threadId, node_id: target.nodeId }, { cancel });
    if (cancel !== this.previewCancel || cancel.cancelled || !this.visible(previewOwner, token)) return;
    this.rewind.value = out.ok ? { kind: "ready", facts: readRewind(out.value), target } : { kind: "refused", error: out.error };
  }

  async confirmRewind(text = ""): Promise<void> {
    text = text.trim();
    const s = this.rewind.peek();
    const held = this.rewindAttempt;
    const target = s.kind === "ready" || s.kind === "failed" ? s.target : this.target.peek() ?? held?.target;
    if (!target) return;
    const key = JSON.stringify({ thread_id: target.threadId, node_id: target.nodeId, text });
    if (held && (held.uncertain || held.running) && held.key !== key) {
      this.refusal(`Resolve the original rewind/request outcome (${held.send?.id ?? held.receipt.id}) before changing its owner, target or text`); return;
    }
    let attempt = held;
    if (!attempt || attempt.key !== key) {
      if ((s.kind !== "ready" && s.kind !== "failed") || this.superseded(target) || this.state.peek().error) return;
      if (!this.owner()) { this.refusal("No current owner; rewind was not sent"); return; }
      attempt = { owner: this.owner(), key, target: { ...target }, text, facts: s.facts, uncertain: true, receipt: { id: this.ops.mutationId() } };
      this.rewindAttempt = attempt;
    }
    if (attempt.running) return attempt.running;
    const token = this.invocation(target);
    return this.runOnce(attempt, () => this.runRewind(attempt, token));
  }
  canRetryRewind(): boolean { return !!this.rewindAttempt?.uncertain && !this.rewindAttempt.running && sameTarget(this.target.peek(), this.rewindAttempt.target); }
  private async runRewind(attempt: RewindAttempt, token: Invocation): Promise<void> {
    const { target, facts } = attempt;
    if (attempt.owner === this.owner() && !this.visible(attempt, token)) return;
    if (this.visible(attempt, token)) {
      this.rewind.value = { kind: "rewinding", facts, target };
      if (!this.visible(attempt, token)) return;
    }
    const out = await this.receipt(attempt, attempt.receipt, id => this.ops.threadRewind({ thread_id: target.threadId, node_id: target.nodeId }, id, announced => { attempt.receipt.id = announced; }));
    if (!out.ok) {
      attempt.uncertain = uncertainOutcome(out);
      if (this.visible(attempt, token)) {
        this.rewind.value = { kind: "failed", facts, target, error: out.error };
        if (this.visible(attempt, token)) this.actionError.value = outcomeMessage(out);
      }
      return;
    }
    attempt.facts = readRewind(out.value as Record<string, unknown>);
    if (attempt.owner !== this.owner()) { attempt.uncertain = true; if (this.visible(attempt, token)) this.actionError.value = "Original owner changed; follow-up is not started"; return; }
    if (!this.visible(attempt, token)) { attempt.uncertain = !!attempt.text; return; }
    if (attempt.text) {
      // The successful rewind is immutable. Only this follow-up receipt retries.
      attempt.send ??= { id: this.ops.mutationId() };
      const sent = await this.receipt(attempt, attempt.send, id => this.ops.messageSend({ thread_id: target.threadId, text: attempt.text }, id));
      attempt.uncertain = !sent.ok;
      if (this.visible(attempt, token)) this.actionError.value = sent.ok ? undefined : `Rewind succeeded; request ${outcomeMessage(sent)}`;
    } else attempt.uncertain = false;
    if (this.visible(attempt, token)) {
      this.rewind.value = { kind: "done", facts: attempt.facts };
      if (!this.visible(attempt, token)) return;
      void this.read(this.state.peek().threadId ?? target.threadId);
    }
  }

  async forkAt(target: BranchTarget, text = ""): Promise<void> {
    const token = this.invocation(target);
    text = text.trim();
    const key = JSON.stringify({ thread_id: target.threadId, node_id: target.nodeId, text });
    const original = this.forkAttempt;
    if (!(original?.key === key && original.owner !== this.owner()) && !this.visible({ owner: this.owner() }, token)) return;
    let attempt = this.forkAttempt;
    if (attempt && (attempt.uncertain || attempt.running) && attempt.key !== key) {
      this.refusal(`Resolve the original fork/request outcome (${attempt.send?.id ?? attempt.receipt.id}) before changing its target or text`);
      return;
    }
    if (!attempt || attempt.key !== key) {
      if (this.state.peek().error || this.superseded(target)) return;
      if (!this.owner()) { this.refusal("No current owner; fork was not sent"); return; }
      attempt = { owner: this.owner(), key, target: { ...target }, text,
        uncertain: true, receipt: { id: this.ops.mutationId() } };
      this.forkAttempt = attempt;
    }
    return this.runOnce(attempt, () => this.runFork(attempt, token));
  }
  private async runFork(attempt: ForkAttempt, token: Invocation): Promise<void> {
    if (attempt.owner === this.owner() && !this.visible(attempt, token)) return;
    if (this.visible(attempt, token)) {
      this.fork.value = { kind: "forking" };
      // Signal subscribers may synchronously change owner/view or leave.
      if (!this.visible(attempt, token)) return;
    }
    const out = await this.receipt(attempt, attempt.receipt, id => this.ops.threadFork({
      thread_id: attempt.target.threadId, node_id: attempt.target.nodeId,
    }, id, announced => { attempt.receipt.id = announced; }));
    if (!out.ok) {
      attempt.uncertain = uncertainOutcome(out);
      if (this.visible(attempt, token)) {
        this.fork.value = { kind: "failed", error: out.error };
        if (!this.visible(attempt, token)) return;
        this.actionError.value = outcomeMessage(out);
      }
      return;
    }
    // Only the fork receipt identifies the child.
    const child = out.value as { thread_id: string; title: string };
    attempt.child ??= { threadId: child.thread_id, title: child.title };
    if (!this.visible(attempt, token)) { attempt.uncertain = !!attempt.text && !attempt.send?.outcome?.ok; return; }
    if (attempt.text) {
      attempt.send ??= { id: this.ops.mutationId() };
      const sent = await this.receipt(attempt, attempt.send, id => this.ops.messageSend({
        thread_id: attempt.child!.threadId, text: attempt.text,
      }, id));
      attempt.uncertain = !sent.ok;
      if (!this.visible(attempt, token)) return;
      this.actionError.value = sent.ok ? undefined : `Branch ${attempt.child.threadId} created; request ${outcomeMessage(sent)}`;
    } else {
      attempt.uncertain = false;
      this.actionError.value = undefined;
    }
    if (!this.visible(attempt, token)) return;
    this.fork.value = { kind: "done", ...attempt.child };
    if (!this.visible(attempt, token)) return;
    if (!attempt.uncertain) void this.read(this.state.peek().threadId ?? attempt.target.threadId);
  }

}

export type MoveState =
  | { kind: "idle" }
  | { kind: "picking"; threadId: string; title?: string; parentId?: string }
  | { kind: "preview"; threadId: string; parent: string }
  | { kind: "moving"; threadId: string; parent: string }
  | { kind: "moved"; threadId: string; parent: string }
  | { kind: "refused"; threadId: string; parent: string; message: string };

export type TagAction = { kind: "idle" } | { kind: "running" } | { kind: "missing"; targets: readonly string[] } | { kind: "failed"; limit: boolean; message: string };

export interface TagDraft {
  id: number;
  action: TagAction;
  open: boolean;
  target: string | undefined;
  add: string[];
  remove: ReadonlySet<string>;
}

export class ThreadActions {
  readonly move: Signal<MoveState> = signal({ kind: "idle" });
  readonly tagDraft: Signal<TagDraft> = signal({ id: 0, action: { kind: "idle" }, open: false, target: undefined, add: [], remove: new Set() });

  constructor(private readonly ops: Operations) {}

  pickParent(threadId: string, title?: string, parentId?: string): void {
    this.move.value = { kind: "picking", threadId, title, parentId };
  }

  previewMove(threadId: string, parent: string): void {
    this.move.value = { kind: "preview", threadId, parent };
  }

  cancelMove(): void {
    this.move.value = { kind: "idle" };
  }

  async confirmMove(): Promise<void> {
    const m = this.move.peek();
    if (m.kind !== "preview") return;
    this.move.value = { kind: "moving", threadId: m.threadId, parent: m.parent };
    const out = await this.ops.threadSetParent(m.threadId, m.parent);
    if (!out.ok) {
      this.move.value = { kind: "refused", threadId: m.threadId, parent: m.parent, message: out.error.message };
      return;
    }
    this.move.value = { kind: "moved", threadId: m.threadId, parent: m.parent };
  }

  openTags(on: boolean): void {
    this.tagDraft.value = { ...this.tagDraft.peek(), open: on };
  }

  openTagsFor(threadId: string): void {
    const draft = this.tagDraft.peek();
    if (draft.target === threadId) {
      this.tagDraft.value = { ...draft, open: true };
      return;
    }
    this.tagDraft.value = { id: draft.id + 1, action: { kind: "idle" }, open: true, target: threadId, add: [], remove: new Set() };
  }

  addTag(raw: string): TagInvalid | undefined {
    const checked = checkTag(raw);
    if (!checked.ok) return checked.invalid;
    const draft = this.tagDraft.peek();
    if (!draft.open || draft.action.kind === "running") return;
    if (draft.remove.has(checked.tag)) return "both";
    if (draft.add.includes(checked.tag)) return undefined;
    if (draft.add.length >= TAGS_PER_CALL) return "many";
    this.tagDraft.value = { ...draft, add: [...draft.add, checked.tag] };
    return undefined;
  }

  unaddTag(tag: string): void {
    const draft = this.tagDraft.peek();
    if (!draft.open || draft.action.kind === "running") return;
    this.tagDraft.value = { ...draft, add: draft.add.filter((t) => t !== tag) };
  }

  toggleRemoveTag(tag: string): void {
    const draft = this.tagDraft.peek();
    if (!draft.open || draft.action.kind === "running") return;
    const remove = new Set(draft.remove);
    if (!remove.delete(tag)) remove.add(tag);
    this.tagDraft.value = { ...draft, add: draft.add.filter((t) => t !== tag), remove };
  }

  async applyTags(): Promise<void> {
    const draft = this.tagDraft.peek();
    const id = draft.target;
    if (!draft.open || draft.action.kind === "running" || !id || (draft.add.length === 0 && draft.remove.size === 0)) return;
    this.tagDraft.value = { ...draft, action: { kind: "running" } };
    const remove = [...draft.remove];
    const out = await this.ops.threadTag({ thread_ids: [id], ...(draft.add.length > 0 && { add: draft.add }), ...(remove.length > 0 && { remove }) });
    const current = this.tagDraft.peek();
    if (current.id !== draft.id) return;
    if (!out.ok) {
      this.tagDraft.value = { ...current, action: { kind: "failed", limit: out.error.kind === "owner" && out.error.code === "input_limit", message: out.error.message } };
    } else {
      const missing = out.value.not_found;
      this.tagDraft.value = { ...current, add: [], remove: new Set(),
        action: missing.length ? { kind: "missing", targets: missing } : { kind: "idle" } };
    }
  }
}
