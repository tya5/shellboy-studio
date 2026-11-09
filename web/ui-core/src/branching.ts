// Screen logic of the Branches and Threads views: reads when a view opens or a hint says the list changed,
// one at a time, with one trailing read. Mutations are explicit and never optimistic.
import { batch, signal, type Signal } from "@preact/signals-core";
import { Cancel, type ArchiveResult, type ArchivedFilter, type Operations, type OpError, type Outcome, type TagResult, type ThreadSummary } from "../../data/src";
import { branchLayout, readFamily, readRewind, type BranchFamily, type RewindFacts } from "./branches";
import { ThreadHeadings, type HeadingKind } from "./headings";
import { CAPABILITY_CWDS, CAPABILITY_TAGS, checkTag, TAG_SELECTION_MAX, TAGS_PER_CALL, type TagInvalid, type ThreadGrouping } from "./org";

/** A family holds at most 256 Threads; 200 per page, so a walk needs 2. The extra allows for retries. */
const BRANCH_PAGE = 200;
const BRANCH_PAGES = 4;
/** A cursor expires when a family Thread is created or deleted. Start over this many times. */
const BRANCH_RESTARTS = 3;
/** One `thread.list` page; the owner's largest. */
export const ORG_PAGE = 200;
/** Pages this view holds and re-reads: at most 1000 rows, however many Threads exist. Past it, filter. */
export const ORG_MAX_PAGES = 5;

export interface FamilyState {
  threadId: string | undefined;
  loading: boolean;
  family: BranchFamily | undefined;
  error: OpError | undefined;
}

/** One family read to its end. Also used for the marks in a conversation. */
export async function readWholeFamily(ops: Operations, threadId: string, cancel?: Cancel): Promise<{ ok: true; family: BranchFamily } | { ok: false; error: OpError }> {
  for (let attempt = 0; ; attempt++) {
    const pages: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    let expired = false;
    for (let n = 0; n < BRANCH_PAGES; n++) {
      const out = await ops.threadBranches({ thread_id: threadId, limit: BRANCH_PAGE, ...(cursor !== undefined && { cursor }) }, cancel ? { cancel } : undefined);
      if (!out.ok) {
        if (out.error.kind === "owner" && out.error.code === "cursor_expired" && attempt < BRANCH_RESTARTS) {
          expired = true;
          break;
        }
        return { ok: false, error: out.error };
      }
      pages.push(out.value);
      cursor = typeof out.value.next_cursor === "string" ? out.value.next_cursor : undefined;
      if (cursor === undefined) break;
    }
    if (!expired) return { ok: true, family: readFamily(pages) };
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

export const EXCERPT_ROWS = 8;
export interface BranchExcerpts { split?: string; request?: string; answer?: string }

/** One displayed batch, at most eight admissions/two RPCs each; no retry queue. */
export class ExcerptBatch {
  private epoch = 0;
  private running = false;
  private admitted = new Set<string>();
  private visible = new Map<string, { item: import("./branches").BranchItem; cancel: Cancel; publish: (v: BranchExcerpts) => void }>();
  constructor(private readonly read: (item: import("./branches").BranchItem, cancel: Cancel) => Promise<BranchExcerpts>) {}
  reset(): void {
    ++this.epoch;
    const previous = [...this.visible.values()];
    this.visible.clear(); this.admitted.clear();
    for (const row of previous) row.cancel.cancel();
    for (const row of previous) row.publish({});
  }
  show(item: import("./branches").BranchItem, publish: (v: BranchExcerpts) => void): () => void {
    publish({});
    if (this.admitted.has(item.threadId) || this.admitted.size >= EXCERPT_ROWS) return () => {};
    this.admitted.add(item.threadId);
    const row = { item, publish, cancel: new Cancel() };
    this.visible.set(item.threadId, row); void this.drain();
    return () => { row.cancel.cancel(); row.publish({}); if (this.visible.get(item.threadId) === row) this.visible.delete(item.threadId); };
  }
  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        const row = [...this.visible.values()].find(r => !r.cancel.cancelled);
        if (!row) break;
        const epoch = this.epoch;
        let facts: BranchExcerpts = {};
        try { facts = await this.read(row.item, row.cancel); } catch { /* Failed reads remain unknown. */ }
        if (epoch === this.epoch && !row.cancel.cancelled) row.publish(facts);
        // Retain the entry for invalidation, but never schedule it twice.
        row.cancel.cancel();
      }
    } finally { this.running = false; }
  }
}
// Four model-owned slots, six receipts maximum. Reads/navigation never evict
// uncertain outcomes. Immutable keys include the initiating owner and payload.
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
  threadId: string;
  uncertain: boolean;
  receipt: BranchReceipt<unknown>;
}
interface RewindAttempt extends BranchAttempt {
  target: BranchTarget;
  facts: RewindFacts;
  text: string;
  send?: BranchReceipt<unknown>;
  running?: Promise<void>;
}
interface ForkAttempt extends BranchAttempt {
  target: BranchTarget;
  text: string;
  child?: { threadId: string; title: string };
  send?: BranchReceipt<unknown>;
  running?: Promise<void>;
}
const uncertainOutcome = (out: Outcome<unknown>): boolean => !out.ok && !["not_connected", "busy"].includes(out.error.kind);
const outcomeMessage = (out: Outcome<unknown>): string | undefined => out.ok ? undefined :
  out.error.kind === "not_connected" || out.error.kind === "busy" ? `Not sent: ${out.error.message}` :
  `Not confirmed; may have applied (${out.operationId ?? "receipt unavailable"}): ${out.error.message}`;

export class Branches {
  readonly excerptBatch = new ExcerptBatch((item, cancel) => this.excerpts(item, cancel));
  readonly state: Signal<FamilyState> = signal({ threadId: undefined, loading: false, family: undefined, error: undefined });
  readonly rewind: Signal<RewindState> = signal({ kind: "idle" });
  readonly selection: Signal<ReadonlySet<string>> = signal(new Set());
  readonly actionError: Signal<string | undefined> = signal(undefined);
  readonly actionBusy = signal(false);
  toggleBranch(id: string): void { const next = new Set(this.selection.peek()); next.has(id) ? next.delete(id) : next.add(id); this.selection.value = next; }
  private renameAttempt?: BranchAttempt;
  private archiveAttempt?: BranchAttempt;
  private rewindAttempt?: RewindAttempt;
  private forkAttempt?: ForkAttempt;
  private refusal(message: string): void { this.actionError.value = message; }
  private projectionEpoch = 0;
  private ownerGeneration = 0;
  private observedOwner: string | undefined;
  private ownerObserved = false;
  /** Synchronous owner/session notification; even A -> unavailable -> A invalidates. */
  ownerChanged(owner: string | undefined): void {
    if (!this.ownerObserved || owner !== this.observedOwner) {
      this.ownerObserved = true;
      this.observedOwner = owner;
      ++this.ownerGeneration;
      ++this.familyGeneration;
      this.again = false;
      this.cancel.cancel();
      const generation = this.familyGeneration;
      this.state.value = { threadId: this.state.peek().threadId, loading: false, family: undefined, error: undefined };
      if (generation === this.familyGeneration) this.excerptBatch.reset();
    }
  }
  private invocation(target?: BranchTarget): Invocation {
    this.ownerChanged(this.owner());
    return { owner: this.owner(), generation: this.ownerGeneration, epoch: this.projectionEpoch, view: this.currentView(), target: target ? { ...target } : undefined };
  }
  private visible(attempt: BranchAttempt, token: Invocation): boolean {
    this.ownerChanged(this.owner());
    return !!token.owner && attempt.owner === token.owner && token.owner === this.owner() &&
      token.generation === this.ownerGeneration && token.epoch === this.projectionEpoch &&
      token.view === this.currentView() && (!token.target || sameTarget(this.target.peek(), token.target));
  }
  private reserve(slot: BranchAttempt | undefined, threadId: string, key: string): BranchAttempt | undefined {
    if (slot && (slot.uncertain || slot.receipt.pending) && slot.key !== key) {
      this.refusal(`Resolve the existing mutation outcome (${slot.receipt.id}) before changing its owner, target or payload`); return;
    }
    if (slot?.key === key) return slot;
    if (!this.owner()) { this.refusal("No current owner; mutation was not sent"); return; }
    return { owner: this.owner(), key, threadId, uncertain: true, receipt: { id: this.ops.mutationId() } };
  }
  private receipt<T>(attempt: BranchAttempt, slot: BranchReceipt<T>, send: (id: string) => Promise<Outcome<T>>): Promise<Outcome<T>> {
    if (slot.pending) return slot.pending;
    if (attempt.owner && attempt.owner === this.owner() && slot.outcome?.ok) return Promise.resolve(slot.outcome);
    let settle!: (out: Outcome<T>) => void;
    const pending = new Promise<Outcome<T>>(resolve => { settle = resolve; });
    // Install the guard before send can synchronously notify model subscribers.
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

  async archiveSelected(): Promise<void> {
    const ids = [...this.selection.peek()].sort(); if (!ids.length) return;
    const threadId = this.state.peek().threadId ?? ids[0]!;
    const attempt = this.reserve(this.archiveAttempt, threadId, JSON.stringify({ thread_ids: ids })); if (!attempt) return;
    this.archiveAttempt = attempt;
    const token = this.invocation();
    const out = await this.receipt(attempt, attempt.receipt, id => this.ops.threadArchive(ids, {}, id));
    attempt.uncertain = uncertainOutcome(out);
    if (!this.visible(attempt, token)) return;
    if (!out.ok) this.actionError.value = outcomeMessage(out);
    else { const missing = (out.value as ArchiveResult).not_found ?? []; this.selection.value = new Set(missing); this.actionError.value = missing.length ? `Not found: ${missing.join(", ")}` : undefined; const id = this.state.peek().threadId; if (id) void this.read(id); }
  }
  async renameBranch(id: string, title: string): Promise<void> {
    title = title.trim(); if (!title) return;
    const attempt = this.reserve(this.renameAttempt, id, JSON.stringify({ thread_id: id, title })); if (!attempt) return;
    this.renameAttempt = attempt;
    const token = this.invocation();
    const out = await this.receipt(attempt, attempt.receipt, op => this.ops.threadSetTitle(id, title, op));
    attempt.uncertain = uncertainOutcome(out);
    if (!this.visible(attempt, token)) return;
    this.actionError.value = outcomeMessage(out);
    if (out.ok) { const selected = this.state.peek().threadId; if (selected) void this.read(selected); }
  }
  readonly fork: Signal<ForkState> = signal({ kind: "idle" });
  /** Graph or list; a phone always gets the list. */
  readonly layout: Signal<"graph" | "list"> = signal("graph");
  /** The point the panel acts on. A point belongs to the lane it sits on; any other node to the viewed Thread. */
  readonly target: Signal<BranchTarget | undefined> = signal(undefined);
  private familyGeneration = 0;
  private running = false;
  private again = false;
  private cancel = new Cancel();

  constructor(private readonly ops: Operations, private readonly owner: () => string | undefined = () => "synthetic-owner", private readonly view?: () => string | undefined) {}
  private currentView(): string | undefined { return this.view ? this.view() : this.state.peek().threadId; }

  async excerpts(item: import("./branches").BranchItem, cancel: Cancel): Promise<{ split?: string; request?: string; answer?: string }> {
    const result: { split?: string; request?: string; answer?: string } = {};
    let revision: string | number | undefined;
    if (cancel.cancelled) return {};
    if (item.divergence) {
      const out = await this.ops.historyWindow({ thread_id: item.threadId, node_id: item.divergence.nodeId, before: 0, after: 24, excerpt_chars: 256 }, { cancel });
      if (!out.ok || cancel.cancelled) return {};
      revision = out.value.revision;
      if (out.ok) {
        result.split = out.value.items.find(n => n.node_id === item.divergence!.nodeId)?.excerpt;
        result.request = out.value.items.find(n => (n.selection?.ordinal ?? -1) > item.divergence!.ordinal && n.kind === "user")?.excerpt;
      }
    }
    if (!cancel.cancelled) {
      const out = await this.ops.historyWindow({ thread_id: item.threadId, before: 48, after: 0, excerpt_chars: 256 }, { cancel });
      if (!out.ok || cancel.cancelled || (revision !== undefined && revision !== out.value.revision)) return {};
      if (out.ok) result.answer = out.value.items.filter(n => n.kind === "assistant_response" && n.excerpt && (!item.divergence || (n.selection?.ordinal ?? -1) > item.divergence.ordinal)).at(-1)?.excerpt?.split("\n").slice(0, 2).join("\n");
    }
    return result;
  }

  /** Nobody is looking: cancels the read. The family read so far stays. */
  leave(): void {
    ++this.projectionEpoch;
    ++this.familyGeneration;
    this.again = false;
    this.cancel.cancel();
    this.excerptBatch.reset();
    if (this.state.peek().loading) this.state.value = { ...this.state.peek(), loading: false };
  }

  /** The view opened on this Thread, or a hint arrived. One read at a time, one trailing. */
  async read(threadId: string): Promise<void> {
    const generation = ++this.familyGeneration;
    this.cancel.cancel();
    this.excerptBatch.reset();
    if (generation !== this.familyGeneration) return;
    const had = this.state.peek();
    if (had.threadId !== threadId) {
      this.cancel.cancel();
      this.state.value = { threadId, loading: true, family: undefined, error: undefined };
      this.clearActions();
    } else this.state.value = { ...had, loading: true };
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        const id = this.state.peek().threadId as string;
        const generation = this.familyGeneration;
        const ownerGeneration = this.ownerGeneration;
        this.cancel = new Cancel();
        const out = await readWholeFamily(this.ops, id, this.cancel);
        if (generation !== this.familyGeneration || ownerGeneration !== this.ownerGeneration) continue;
        if (this.state.peek().threadId !== id) {
          this.again = true;
          continue;
        }
        if (!out.ok && out.error.kind === "cancelled") {
          if (!this.again) this.state.value = { ...this.state.peek(), loading: false };
          continue;
        }
        // A failed re-read keeps the last family, marked with the error.
        this.state.value = out.ok ? { threadId: id, loading: this.again, family: out.family, error: undefined } : { ...this.state.peek(), loading: this.again, error: out.error };
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  ensure(threadId: string): void {
    if (this.state.peek().threadId !== threadId) void this.read(threadId);
    else {
      const s = this.state.peek();
      if (!s.family && !s.loading) void this.read(threadId);
    }
  }

  clearActions(): void {
    batch(() => {
      this.rewind.value = { kind: "idle" };
      this.fork.value = { kind: "idle" };
    });
  }

  /** The route chose a node. A preview of another point must not be confirmable, so a change clears it. */
  select(viewed: string | undefined, nodeId: string | undefined): void {
    const family = this.state.peek().family;
    const points = family ? branchLayout(family).points.filter((p) => p.nodeId === nodeId) : [];
    const owner = points.find((p) => p.threadId === viewed) ?? points[0];
    const next = nodeId !== undefined && viewed !== undefined ? { threadId: owner?.threadId ?? viewed, nodeId } : undefined;
    const cur = this.target.peek();
    if (next ? sameTarget(cur, next) : cur === undefined) return;
    batch(() => {
      this.target.value = next;
      this.clearActions();
    });
  }

  /** Shows what would change. Nothing is written. */
  async previewRewind(target: BranchTarget): Promise<void> {
    this.rewind.value = { kind: "previewing" };
    const out = await this.ops.threadRewindPreview({ thread_id: target.threadId, node_id: target.nodeId });
    if (!sameTarget(this.target.peek(), target)) return;
    this.rewind.value = out.ok ? { kind: "ready", facts: readRewind(out.value), target } : { kind: "refused", error: out.error };
  }

  /** Only after a preview of this exact target. */
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
      if (s.kind !== "ready" && s.kind !== "failed") return;
      if (!this.owner()) { this.refusal("No current owner; rewind was not sent"); return; }
      attempt = { owner: this.owner(), key, threadId: target.threadId, target: { ...target }, text, facts: s.facts, uncertain: true, receipt: { id: this.ops.mutationId() } };
      this.rewindAttempt = attempt;
    }
    if (attempt.running) return attempt.running;
    const active = attempt;
    const token = this.invocation(target);
    let settle!: () => void;
    const running = new Promise<void>(resolve => { settle = resolve; });
    active.running = running;
    void this.runRewind(active, token).finally(() => { active.running = undefined; settle(); });
    return running;
  }
  canRetryRewind(): boolean { return !!this.rewindAttempt?.uncertain && !this.rewindAttempt.running && sameTarget(this.target.peek(), this.rewindAttempt.target); }
  private async runRewind(attempt: RewindAttempt, token: Invocation): Promise<void> {
    const { target, facts } = attempt;
    if (this.visible(attempt, token)) this.rewind.value = { kind: "rewinding", facts, target };
    const out = await this.receipt(attempt, attempt.receipt, id => this.ops.threadRewind({ thread_id: target.threadId, node_id: target.nodeId }, id));
    if (!out.ok) {
      attempt.uncertain = uncertainOutcome(out);
      if (this.visible(attempt, token)) { this.rewind.value = { kind: "failed", facts, target, error: out.error }; this.actionError.value = outcomeMessage(out); }
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
      void this.read(this.state.peek().threadId ?? target.threadId);
    }
  }

  async forkAt(target: BranchTarget, text = ""): Promise<void> {
    text = text.trim();
    const key = JSON.stringify({ thread_id: target.threadId, node_id: target.nodeId, text });
    let attempt = this.forkAttempt;
    if (attempt && (attempt.uncertain || attempt.running) && attempt.key !== key) {
      this.refusal(`Resolve the original fork/request outcome (${attempt.send?.id ?? attempt.receipt.id}) before changing its target or text`);
      return;
    }
    if (!attempt || attempt.key !== key) {
      if (!this.owner()) { this.refusal("No current owner; fork was not sent"); return; }
      attempt = { owner: this.owner(), key, threadId: target.threadId, target: { ...target }, text,
        uncertain: true, receipt: { id: this.ops.mutationId() } };
      this.forkAttempt = attempt;
    }
    if (attempt.running) return attempt.running;
    const active = attempt;
    const token = this.invocation(target);
    let settle!: () => void;
    const running = new Promise<void>(resolve => { settle = resolve; });
    active.running = running;
    void this.runFork(active, token).finally(() => { active.running = undefined; settle(); });
    return running;
  }
  private async runFork(attempt: ForkAttempt, token: Invocation): Promise<void> {
    if (this.visible(attempt, token)) {
      this.fork.value = { kind: "forking" };
      // Signal subscribers may synchronously change owner/view or leave.
      if (!this.visible(attempt, token)) return;
    }
    const out = await this.receipt(attempt, attempt.receipt, id => this.ops.threadFork({
      thread_id: attempt.target.threadId, node_id: attempt.target.nodeId,
    }, id));
    if (!out.ok) {
      attempt.uncertain = uncertainOutcome(out);
      if (this.visible(attempt, token)) {
        this.fork.value = { kind: "failed", error: out.error };
        this.actionError.value = outcomeMessage(out);
      }
      return;
    }
    // Only a canonical thread.fork response can establish the immutable child.
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

export type ArchiveMode = Extract<ArchivedFilter, "exclude" | "only">;

export interface OrgState {
  mode: ArchiveMode;
  query: string;
  loading: boolean;
  items: ThreadSummary[];
  nextCursor: string | undefined;
  loaded: boolean;
  error: OpError | undefined;
}

/** Choosing a new parent. `parent` is "" for no parent. There's no dry run: the owner decides on Move. */
export type MoveState =
  | { kind: "idle" }
  | { kind: "picking"; threadId: string }
  | { kind: "preview"; threadId: string; parent: string }
  | { kind: "moving"; threadId: string; parent: string }
  | { kind: "moved"; threadId: string; parent: string }
  | { kind: "refused"; threadId: string; parent: string; message: string };

export type OrgAction = { kind: "idle" } | { kind: "running" } | { kind: "done"; verb: "archive" | "unarchive"; result: ArchiveResult } | { kind: "failed"; error: OpError };

export type TagAction = { kind: "idle" } | { kind: "running" } | { kind: "done"; result: TagResult } | { kind: "failed"; limit: boolean; message: string } | { kind: "selection"; n: number };

export interface TagDraft {
  open: boolean;
  add: string[];
  remove: ReadonlySet<string>;
}

export class ThreadOrg {
  readonly state: Signal<OrgState> = signal({ mode: "exclude", query: "", loading: false, items: [], nextCursor: undefined, loaded: false, error: undefined });
  readonly groupBy: Signal<ThreadGrouping> = signal("tree");
  readonly move: Signal<MoveState> = signal({ kind: "idle" });
  readonly selected: Signal<ReadonlySet<string>> = signal(new Set());
  readonly descendants: Signal<boolean> = signal(true);
  readonly action: Signal<OrgAction> = signal({ kind: "idle" });
  private running = false;
  private again = false;
  private pages = 1;
  private cancel = new Cancel();
  /** Names for the Tag and Directory groupings, and their members. Used only when the owner can list them. */
  readonly headings: ThreadHeadings;
  readonly tagDraft: Signal<TagDraft> = signal({ open: false, add: [], remove: new Set() });
  readonly tagAction: Signal<TagAction> = signal({ kind: "idle" });

  constructor(
    private readonly ops: Operations,
    private readonly capabilities: () => readonly string[] = () => [],
  ) {
    this.headings = new ThreadHeadings(ops, () => ({ mode: this.state.peek().mode, query: this.state.peek().query }), () => this.prune());
  }

  canTag(): boolean {
    return this.capabilities().includes(CAPABILITY_TAGS);
  }

  /** The grouping that reads headings from the owner, if this owner can. Otherwise the flat list is grouped here. */
  headingKind(): HeadingKind | undefined {
    const by = this.groupBy.peek();
    if (by === "tag") return this.canTag() ? "tag" : undefined;
    if (by === "directory") return this.capabilities().includes(CAPABILITY_CWDS) ? "cwd" : undefined;
    return undefined;
  }

  /** Whether what the current grouping shows has been read once. */
  loaded(): boolean {
    const kind = this.headingKind();
    return kind ? this.headings.loadedFor(kind) : this.state.peek().loaded;
  }

  setGrouping(by: ThreadGrouping): void {
    this.groupBy.value = by;
    this.ensure();
  }

  ensure(): void {
    const kind = this.headingKind();
    if (kind) this.headings.ensure(kind);
    else if (!this.state.peek().loaded && !this.state.peek().loading) void this.read();
  }

  /** Every Thread shown by the current grouping, each once. */
  shown(): ThreadSummary[] {
    return this.headingKind() ? this.headings.members() : this.state.peek().items;
  }

  /** Headings hold only some Threads: a selection keeps to rows still shown. */
  private prune(): void {
    if (!this.headingKind()) return;
    const known = new Set(this.headings.members().map((s) => s.thread_id));
    const now = this.selected.peek();
    const kept = [...now].filter((id) => known.has(id));
    if (kept.length !== now.size) this.selected.value = new Set(kept);
  }

  /** Nobody is looking: cancels the read. What's listed stays. */
  leave(): void {
    this.again = false;
    this.cancel.cancel();
    this.headings.leave();
    if (this.state.peek().loading) this.state.value = { ...this.state.peek(), loading: false };
  }

  /** Reads again up to the pages shown. A cursor bound to another mode or list starts over. */
  async read(): Promise<void> {
    const kind = this.headingKind();
    if (kind) {
      await this.headings.reload(kind);
      return;
    }
    this.state.value = { ...this.state.peek(), loading: true };
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        const { mode, query } = this.state.peek();
        this.cancel = new Cancel();
        const cancel = this.cancel;
        const items: ThreadSummary[] = [];
        let cursor: string | undefined;
        let error: OpError | undefined;
        for (let page = 0; page < this.pages; page++) {
          const out = await this.ops.threadList({ limit: ORG_PAGE, archived: mode, ...(query ? { query } : {}), ...(cursor !== undefined && { cursor }) }, { cancel });
          if (!out.ok) {
            error = out.error;
            break;
          }
          items.push(...out.value.items);
          cursor = out.value.next_cursor;
          if (cursor === undefined) break;
        }
        const now = this.state.peek();
        if (now.mode !== mode || now.query !== query) {
          this.again = true;
          continue;
        }
        if (error?.kind === "cancelled") {
          if (!this.again) this.state.value = { ...now, loading: false };
          continue;
        }
        const known = new Set(items.map((s) => s.thread_id));
        batch(() => {
          this.state.value = error ? { ...now, loading: this.again, error } : { ...now, loading: this.again, items, nextCursor: cursor, loaded: true, error: undefined };
          if (!error) this.selected.value = new Set([...this.selected.peek()].filter((id) => known.has(id)));
        });
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  canLoadMore(): boolean {
    return this.state.peek().nextCursor !== undefined && this.pages < ORG_MAX_PAGES;
  }

  loadMore(): void {
    if (!this.canLoadMore()) return;
    this.pages++;
    void this.read();
  }

  /** Active or Archived. Selection doesn't carry over: the action differs. */
  setMode(mode: ArchiveMode): void {
    if (this.state.peek().mode === mode) return;
    this.cancel.cancel();
    this.pages = 1;
    batch(() => {
      this.state.value = { ...this.state.peek(), mode, items: [], nextCursor: undefined, loaded: false };
      this.selected.value = new Set();
      this.action.value = { kind: "idle" };
    });
    void this.read();
  }

  setQuery(query: string): void {
    if (this.state.peek().query === query) return;
    this.cancel.cancel();
    this.pages = 1;
    this.state.value = { ...this.state.peek(), query };
    void this.read();
  }

  pickParent(threadId: string): void {
    this.move.value = { kind: "picking", threadId };
  }

  /** From the picker or a drop. Nothing moves until `confirmMove`. */
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
    await this.read();
  }

  toggle(id: string): void {
    const next = new Set(this.selected.peek());
    if (!next.delete(id)) next.add(id);
    this.selected.value = next;
  }

  setMany(ids: readonly string[], on: boolean): void {
    const next = new Set(this.selected.peek());
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    this.selected.value = next;
  }

  clear(): void {
    this.selected.value = new Set();
    this.action.value = { kind: "idle" };
  }

  /** Archive in Active, unarchive in Archived. Nothing changes here until the owner says so. */
  async apply(): Promise<void> {
    const ids = [...this.selected.peek()];
    if (ids.length === 0) return;
    const verb = this.state.peek().mode === "exclude" ? "archive" : "unarchive";
    const options = { descendants: this.descendants.peek() };
    this.action.value = { kind: "running" };
    const out = verb === "archive" ? await this.ops.threadArchive(ids, options) : await this.ops.threadUnarchive(ids, options);
    if (!out.ok) {
      this.action.value = { kind: "failed", error: out.error };
      return;
    }
    batch(() => {
      this.action.value = { kind: "done", verb, result: out.value };
      this.selected.value = new Set();
    });
    await this.read();
  }

  // ---- tags ----

  /** Tags of the chosen Threads that have been read, sorted. Rows not read can't be named here. */
  selectedTags(): string[] {
    const chosen = this.selected.value;
    const all = new Set<string>();
    for (const s of this.shown()) if (chosen.has(s.thread_id)) for (const tag of s.tags ?? []) all.add(tag);
    return [...all].sort();
  }

  openTags(on: boolean): void {
    this.tagDraft.value = { ...this.tagDraft.peek(), open: on };
    if (on) this.tagAction.value = { kind: "idle" };
  }

  /** Puts a tag on the list to add. Returns why it can't, or nothing. */
  addTag(raw: string): TagInvalid | undefined {
    const checked = checkTag(raw);
    if (!checked.ok) return checked.invalid;
    const draft = this.tagDraft.peek();
    if (draft.remove.has(checked.tag)) return "both";
    if (draft.add.includes(checked.tag)) return undefined;
    if (draft.add.length >= TAGS_PER_CALL) return "many";
    this.tagDraft.value = { ...draft, add: [...draft.add, checked.tag] };
    return undefined;
  }

  unaddTag(tag: string): void {
    const draft = this.tagDraft.peek();
    this.tagDraft.value = { ...draft, add: draft.add.filter((t) => t !== tag) };
  }

  toggleRemoveTag(tag: string): void {
    const draft = this.tagDraft.peek();
    const remove = new Set(draft.remove);
    if (!remove.delete(tag)) remove.add(tag);
    this.tagDraft.value = { ...draft, add: draft.add.filter((t) => t !== tag), remove };
  }

  /** One `thread.tag` for the chosen Threads. Nothing is optimistic: the groups are read again after. */
  async applyTags(): Promise<void> {
    const ids = [...this.selected.peek()];
    const draft = this.tagDraft.peek();
    if (ids.length === 0 || (draft.add.length === 0 && draft.remove.size === 0)) return;
    if (ids.length > TAG_SELECTION_MAX) {
      this.tagAction.value = { kind: "selection", n: ids.length };
      return;
    }
    this.tagAction.value = { kind: "running" };
    const remove = [...draft.remove];
    const out = await this.ops.threadTag({ thread_ids: ids, ...(draft.add.length > 0 && { add: draft.add }), ...(remove.length > 0 && { remove }) });
    if (!out.ok) {
      this.tagAction.value = { kind: "failed", limit: out.error.kind === "owner" && out.error.code === "input_limit", message: out.error.message };
      return;
    }
    batch(() => {
      this.tagAction.value = { kind: "done", result: out.value };
      this.tagDraft.value = { ...draft, add: [], remove: new Set() };
    });
    await this.read();
  }
}
