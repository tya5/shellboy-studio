// Branch family reads and mutations are explicit and never optimistic.
import { batch, signal, type Signal } from "@preact/signals-core";
import { Cancel, type Operations, type OpError, type Outcome } from "../../data/src";
import { LANE_EXCERPT_CHARS, LaneReader } from "./branch-lanes";
import { readFamily, readRewind, type BranchFamily, type RewindFacts } from "./branches";
import { CAPABILITY_TAGS, checkTag, TAGS_PER_CALL, type TagInvalid } from "./org";

/** A family holds at most 256 Threads; 200 per page, so a walk needs 2. The extra allows for retries. */
const BRANCH_PAGE = 200;
const BRANCH_PAGES = 4;
/** A cursor expires when a family Thread is created or deleted. Start over this many times. */
const BRANCH_RESTARTS = 3;

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

// Fork and rewind retain their primary and follow-up receipts across reads and navigation.
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
  /** Synchronous owner/session notification; even A -> unavailable -> A invalidates. */
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
      this.lanes.reset(true);
      batch(() => {
        // Install invalid projection before callbacks, notify only after old cancellation.
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

  readonly fork: Signal<ForkState> = signal({ kind: "idle" });
  /** The point the panel acts on. A point belongs to the lane it sits on; any other node to the viewed Thread. */
  readonly target: Signal<BranchTarget | undefined> = signal(undefined);
  readonly targetRevision = signal<number | undefined>(undefined);
  private familyGeneration = 0;
  private running = false;
  private again = false;
  private cancel = new Cancel();

  /** Bounded excerpt reads behind the lane rows; kept by node ID across family re-reads. */
  readonly lanes: LaneReader;

  constructor(private readonly ops: Operations, private readonly owner: () => string | undefined = () => "synthetic-owner", private readonly view?: () => string | undefined, private readonly historyWindow: () => boolean = () => true) {
    this.lanes = new LaneReader(ops, historyWindow, (threadId, revision) => {
      const current = this.targetRevision.peek();
      if (this.target.peek()?.threadId === threadId && current !== undefined && revision > current) this.choose(undefined);
    });
  }
  private currentView(): string | undefined { return this.view ? this.view() : this.state.peek().threadId; }

  /** Nobody is looking: cancels the read. The family read so far stays. */
  leave(): void {
    ++this.projectionEpoch;
    const generation = ++this.familyGeneration;
    this.again = false;
    const previous = this.previewCancel;
    const marker = this.previewCancel = new Cancel();
    const familyCancel = this.cancel;
    this.lanes.reset(false);
    familyCancel.cancel();
    previous.cancel();
    if (marker !== this.previewCancel || generation !== this.familyGeneration) return;
    if (this.state.peek().loading) this.state.value = { ...this.state.peek(), loading: false };
  }

  /** The view opened on this Thread, or a hint arrived. One read at a time, one trailing. */
  async read(threadId: string): Promise<void> {
    if (!this.owner()) return;
    const generation = ++this.familyGeneration;
    const ownerGeneration = this.ownerGeneration;
    this.cancel.cancel();
    if (generation !== this.familyGeneration) return;
    const had = this.state.peek();
    if (had.threadId !== threadId) {
      this.cancel.cancel();
      this.state.value = { threadId, loading: true, family: undefined, error: undefined };
      if (generation !== this.familyGeneration || ownerGeneration !== this.ownerGeneration) return;
      this.clearActions();
    } else this.state.value = { ...had, loading: true };
    if (generation !== this.familyGeneration || ownerGeneration !== this.ownerGeneration || this.state.peek().threadId !== threadId) return;
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
        const target = this.target.peek();
        const disclosed = out.ok ? await this.lanes.readDisclosed(out.family, target?.threadId, this.cancel) : [];
        // Membership and revision come from one targeted reply, never from the graph cache.
        const point = out.ok && target && target === this.target.peek() && this.historyWindow()
          ? await this.ops.historyWindow({ thread_id: target.threadId, node_id: target.nodeId,
              before: 0, after: 0, excerpt_chars: LANE_EXCERPT_CHARS }, { cancel: this.cancel })
          : undefined;
        if (generation !== this.familyGeneration || ownerGeneration !== this.ownerGeneration) continue;
        batch(() => {
          if (out.ok) this.lanes.familyChanged(out.family);
          if (target && target === this.target.peek() && point) {
            const floor = Math.max(this.targetRevision.peek() ?? 0, this.lanes.revision(target.threadId) ?? 0,
              ...disclosed.filter(d => d.threadId === target.threadId).map(d => d.snapshot.revision));
            if (point.ok && point.value.thread_id === target.threadId && point.value.revision >= floor
              && point.value.items.length === 1 && point.value.items[0]?.node_id === target.nodeId) {
              if (this.targetRevision.peek() !== point.value.revision) {
                this.targetRevision.value = point.value.revision;
                const rewind = this.rewind.peek().kind;
                if (rewind === "ready" || rewind === "previewing" || rewind === "refused") this.clearPreview();
              }
            } else {
              this.choose(undefined);
            }
          }
          for (const { threadId, snapshot } of disclosed) this.lanes.refreshPoint(threadId, snapshot);
          if (target && point?.ok && point.value.thread_id === target.threadId) this.lanes.refreshPoint(target.threadId, point.value);
          if (target && point && !point.ok && point.error.kind === "owner" && ["cursor_expired", "thread_not_found"].includes(point.error.code)) {
            const details = point.error.details;
            const revision = details && typeof details === "object" && "revision" in details ? details.revision : undefined;
            if (typeof revision === "number" && Number.isSafeInteger(revision) && revision > (this.lanes.revision(target.threadId) ?? 0)) {
              this.lanes.invalidatePath(target.threadId, revision);
            }
          }
          // A failed re-read keeps the last family, marked with the error.
          this.state.value = out.ok ? { threadId: id, loading: this.again, family: out.family, error: undefined } : { ...this.state.peek(), loading: this.again, error: out.error };
        });
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

  private clearPreview(): void {
    const previous = this.previewCancel;
    this.previewCancel = new Cancel();
    this.rewind.value = { kind: "idle" };
    previous.cancel();
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

  /** A message on the graph was chosen (or the choice cleared). A preview of another point must not be confirmable. */
  choose(next: BranchTarget | undefined): void {
    const cur = this.target.peek();
    if (next ? sameTarget(cur, next) : cur === undefined) return;
    batch(() => {
      this.targetRevision.value = next ? this.lanes.revision(next.threadId) : undefined;
      this.target.value = next ? { ...next } : undefined;
      this.clearActions();
    });
  }

  /** The route chose a node. A preview of another point must not be confirmable, so a change clears it. */
  select(viewed: string | undefined, nodeId: string | undefined): void {
    const family = this.state.peek().family;
    // A node where branches leave belongs to the parent they leave; any other node to the viewed Thread.
    const ids = new Set(family?.items.map((i) => i.threadId));
    const owners = (family?.items ?? []).filter((i) => i.divergence?.nodeId === nodeId && i.parentId !== undefined && ids.has(i.parentId)).map((i) => ({ threadId: i.parentId! }));
    const owner = owners.find((p) => p.threadId === viewed) ?? owners[0];
    const next = nodeId !== undefined && viewed !== undefined ? { threadId: owner?.threadId ?? viewed, nodeId } : undefined;
    this.choose(next);
  }

  /** Shows what would change. Nothing is written. */
  async previewRewind(target: BranchTarget): Promise<void> {
    const token = this.invocation(target);
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
      attempt = { owner: this.owner(), key, target: { ...target }, text, facts: s.facts, uncertain: true, receipt: { id: this.ops.mutationId() } };
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
    if (attempt.owner === this.owner() && !this.visible(attempt, token)) return;
    if (this.visible(attempt, token)) {
      this.rewind.value = { kind: "rewinding", facts, target };
      if (!this.visible(attempt, token)) return;
    }
    const out = await this.receipt(attempt, attempt.receipt, id => this.ops.threadRewind({ thread_id: target.threadId, node_id: target.nodeId }, id));
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
    const diagnostic = original && original.key === key && original.owner !== this.owner();
    if (!diagnostic && !this.visible({ owner: this.owner() }, token)) return;
    let attempt = this.forkAttempt;
    if (attempt && (attempt.uncertain || attempt.running) && attempt.key !== key) {
      this.refusal(`Resolve the original fork/request outcome (${attempt.send?.id ?? attempt.receipt.id}) before changing its target or text`);
      return;
    }
    if (!attempt || attempt.key !== key) {
      if (!this.owner()) { this.refusal("No current owner; fork was not sent"); return; }
      attempt = { owner: this.owner(), key, target: { ...target }, text,
        uncertain: true, receipt: { id: this.ops.mutationId() } };
      this.forkAttempt = attempt;
    }
    if (attempt.running) return attempt.running;
    const active = attempt;
    let settle!: () => void;
    const running = new Promise<void>(resolve => { settle = resolve; });
    active.running = running;
    void this.runFork(active, token).finally(() => { active.running = undefined; settle(); });
    return running;
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
    }, id));
    if (!out.ok) {
      attempt.uncertain = uncertainOutcome(out);
      if (this.visible(attempt, token)) {
        this.fork.value = { kind: "failed", error: out.error };
        if (!this.visible(attempt, token)) return;
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
  }

  // ---- tags ----

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

  /** Puts a tag on the list to add. Returns why it can't, or nothing. */
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

  /** ACK settles only the submitting session; owner hints refresh the displayed tags. */
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
