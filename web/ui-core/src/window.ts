import type { AttemptPresentation, ThreadHandle, ThreadReadQualification } from "../../data/src/store";
import type { HistoryBody } from "../../data/src/protocol";
import { AcceptedView, type AcceptedCapability } from "./accepted-view";
import type { HandoffRecord } from "../../data/src/handoff";
// The long-thread reader's model (docs/design/long-threads.md): positional windows of a Thread's
// path held in bounded buckets, a measured scroll space over one loaded run, and adjacent reads.
// It stops at an unloaded edge. It knows no pixels except the heights it is told, and never walks the history.
import { batch, signal } from "@preact/signals-core";
import { Cancel, HISTORY_EXCERPT_CHARS, type HistoryItem, type HistoryWindowArgs, type HistoryWindowResult, type Outcome } from "../../data/src";
import { projectConversation } from "./conversation";

/** Positions in one window of the path. */
export const WINDOW_NODES = 100;
/** Windows held per open Thread (1,600 nodes), evicting the opposite edge. */
export const WINDOWS_HELD = 16;
/** Window reads running at once (a tail or verify read is one more). */
export const READS_IN_FLIGHT = 2;
/** Fast scrolling must pause this long before a window is requested. */
export const PAUSE_MS = 80;

export type WindowReadArgs = Omit<HistoryWindowArgs, "thread_id">;
export interface WindowReader {
  read(args: WindowReadArgs, cancel: Cancel): Promise<Outcome<HistoryWindowResult>>;
}
export interface WindowOptions {
  /** Defaults to `setTimeout`; returns the canceller. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export interface RetiredAttempt {
  readonly scope: string;
  readonly attemptId: string;
  readonly turnId: string;
  readonly nodeIds: readonly string[];
  readonly revision: string | number;
}
declare const summaryIdBrand: unique symbol;
export type SummaryTransitionId = string & { readonly [summaryIdBrand]: true };
export interface AcceptedCoverage {
  readonly transitionId: SummaryTransitionId;
  readonly scope: string;
  readonly summaryNodeId: string;
  readonly sourceNodeIds: readonly string[];
  readonly source: { readonly nodeId: string; readonly offset: number; readonly revision: string | number };
  readonly targetRevision: string | number;
  readonly kind: "inside" | "below";
}
export interface WindowAcceptedSnapshot {
  readonly generation: number;
  readonly epoch: number;
  readonly disposed: boolean;
  readonly rows: readonly HistoryItem[];
  readonly range: Readonly<{ first: number; last: number }> | undefined;
  readonly total: number;
  readonly revision: string | number | undefined;
  readonly pending: boolean;
  readonly coverage?: AcceptedCoverage;
  readonly attemptPresentations?: readonly AttemptPresentation[];
  readonly retiredAttempts?: readonly RetiredAttempt[];
}
export interface WindowScrollRequest { readonly id: object; readonly target: number }

export type WindowStatus = "loading" | "ready" | "error";
export interface Anchor {
  ordinal: number;
  nodeId: string | undefined;
  /** Pixels the viewport top lies below the top of the anchor row. */
  offset: number;
}

/** The scroll offset that keeps the anchor row where it was after rows above it changed height. */
export const correctedScrollTop = (scrollTop: number, anchorOffsetBefore: number, anchorOffsetAfter: number): number =>
  scrollTop + (anchorOffsetAfter - anchorOffsetBefore);

const ordinalOf = (item: HistoryItem): number | undefined => item.selection?.ordinal;

class Bucket {
  readonly handoffs = new Map<number, { record: HandoffRecord; release: (reason: "return" | "end") => void }>();
  items: (HistoryItem | undefined)[] = new Array(WINDOW_NODES).fill(undefined);
  filled = 0;
}

/** Sparse measurements: storage and all scans are bounded by the held windows, not total. */
class Heights {
  readonly h = new Map<number, number>();
  set(i: number, v: number): boolean {
    if (this.h.get(i) === v) return false;
    this.h.set(i, v);
    return true;
  }
  clear(i: number): void { this.h.delete(i); }
  offsetOf(i: number, first: number): number {
    let sum = 0;
    for (const [ordinal, height] of this.h) if (ordinal >= first && ordinal < i) sum += height;
    return sum;
  }
}

export class ConversationWindow {
  private readonly reader: WindowReader;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;
  private buckets = new Map<number, Bucket>();
  private heights = new Heights();
  private revision: string | number | undefined;
  private tailKnown: { ordinal: number; nodeId: string } | undefined;
  private epoch = 0;
  private disposed = false;
  private inflight = new Map<number, { cancel: Cancel }>();
  private failed = new Set<number>();
  private tailCancel: Cancel | undefined;
  private tailAgain = false;
  private tailFailed = false;
  private verifying = false;
  private stopTimer: (() => void) | undefined;
  private viewTop = 0;
  private viewHeight = 0;
  private wanted = new Set<number>();
  private lastAnchor: Anchor | undefined;
  private scrollRequest: number | undefined;
  private scrollHandle: WindowScrollRequest | undefined;
  private attemptPresentations: readonly AttemptPresentation[] = [];
  private summarySerial = 0;
  private summaryTransition: { id: SummaryTransitionId; handle: ThreadHandle; token: ThreadReadQualification;
    sourceRef: WindowAcceptedSnapshot; sourceCap: AcceptedCapability; nodeId: string; offset: number; scope: string;
    consumed: boolean; targetCap?: AcceptedCapability; coverage?: AcceptedCoverage } | undefined;
  private acceptedGeneration = 0;
  private retiredAttempts: readonly RetiredAttempt[] = [];
  private retiredCapability: AcceptedCapability | undefined;
  readonly acceptedView = new AcceptedView<WindowAcceptedSnapshot>({
    generation: 0, epoch: 0, disposed: false, rows: [], range: undefined,
    total: 0, revision: undefined, pending: true,
  });
  private jumping = false;
  get pendingNavigation(): boolean { return this.jumping; }

  /** Bumped on every change a screen must redraw for. */
  readonly version = signal(0);
  readonly status = signal<WindowStatus>("loading");
  readonly error = signal<string | undefined>(undefined);
  /** At the newest node with the view at the bottom: new rows keep it there. */
  readonly following = signal(true);
  /** Rows exist past what is shown, while not following: offer the jump to the newest. */
  readonly newer = signal(false);
  /** The path was rewritten (compaction, rewind, prune) and the view re-read. */
  readonly pathChanged = signal(false);
  total = 0;

  constructor(reader: WindowReader, options: WindowOptions = {}) {
    this.reader = reader;
    this.setTimer =
      options.setTimer ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
    void this.readTail();
  }

  // ---- reading what's held ----

  get readsInFlight(): number {
    return this.inflight.size + (this.tailCancel || this.verifying ? 1 : 0);
  }
  get windowsHeld(): number {
    return this.buckets.size;
  }
  get measurementsHeld(): number { return this.heights.h.size; }
  itemAt(i: number): HistoryItem | undefined {
    return this.buckets.get(Math.floor(i / WINDOW_NODES))?.items[i % WINDOW_NODES];
  }
  /** Pure ownership receive; no navigation, reads or scroll correction. */
  beginSummaryTransition(handle: ThreadHandle, ref: WindowAcceptedSnapshot, nodeId: string, offset: number): SummaryTransitionId | undefined {
    if (this.disposed || !this.acceptedView.isCurrent(ref) || ref.pending || ref.revision === undefined || !Number.isFinite(offset)
      || ref.rows.filter(row => row.node_id === nodeId).length !== 1) return undefined;
    const old = this.summaryTransition;
    if (old) return old.handle === handle && old.sourceRef === ref && old.nodeId === nodeId && old.offset === offset
      && !old.consumed && handle.isReadQualificationCurrent(old.token) ? old.id : undefined;
    const token = handle.captureReadQualification();
    if (!token || !this.acceptedView.isCurrent(ref)) return undefined;
    const id = `summary-${++this.summarySerial}` as SummaryTransitionId;
    this.summaryTransition = { id, handle, token, sourceRef: ref, sourceCap: this.acceptedView.currentCapability, nodeId, offset, scope: handle.handoffScope(), consumed: false };
    return id;
  }
  peekSummaryTransitionId(): SummaryTransitionId | undefined {
    const tx = this.summaryTransition;
    return tx && !tx.consumed && !this.disposed && tx.handle.isReadQualificationCurrent(tx.token) && tx.scope === tx.handle.handoffScope() ? tx.id : undefined;
  }
  acceptSummaryCoverage(handle: ThreadHandle, ref: WindowAcceptedSnapshot, id: SummaryTransitionId, body: HistoryBody): boolean {
    const tx = this.summaryTransition;
    if (!tx || tx.id !== id || tx.handle !== handle || tx.consumed || this.disposed || ref.pending || ref.revision === undefined
      || !this.acceptedView.isCurrent(ref) || !handle.isReadQualificationCurrent(tx.token) || handle.handoffScope() !== tx.scope
      || body.kind !== "summary" || ref.rows.filter(row => row.node_id === body.node_id && row.kind === "summary").length !== 1) return false;
    if (ref.revision === tx.sourceRef.revision && tx.sourceCap !== this.acceptedView.currentCapability) return false;
    const ids = body.source_node_ids;
    if (!ids?.length || ids.length > 4096 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !id)) return false;
    let kind: "inside" | "below";
    if (ids.includes(tx.nodeId)) kind = "inside";
    else {
      const ordinal = tx.sourceRef.rows.find(row => row.node_id === tx.nodeId)?.selection?.ordinal;
      if (ordinal === undefined || !ids.every(id => {
        const found = tx.sourceRef.rows.filter(row => row.node_id === id);
        return found.length === 1 && found[0]!.selection?.ordinal !== undefined && found[0]!.selection!.ordinal! < ordinal;
      }) || ref.rows.filter(row => row.node_id === tx.nodeId).length !== 1) return false;
      kind = "below";
    }
    const cap = this.acceptedView.currentCapability;
    const coverage: AcceptedCoverage = { transitionId: id, scope: tx.scope, summaryNodeId: body.node_id, sourceNodeIds: [...ids],
      source: { nodeId: tx.nodeId, offset: tx.offset, revision: tx.sourceRef.revision! }, targetRevision: ref.revision, kind };
    const generation = this.acceptedGeneration + 1;
    const staged = this.acceptedView.stage({ ...ref, generation, coverage }, cap);
    if (!this.acceptedView.isCurrent(ref) || tx !== this.summaryTransition || !handle.isReadQualificationCurrent(tx.token)) return false;
    tx.coverage = coverage; tx.targetCap = cap; this.acceptedGeneration = generation;
    if (!this.acceptedView.commit(staged)) { tx.coverage = undefined; tx.targetCap = undefined; return false; }
    return this.acceptedView.peek().generation === generation && this.peekSummaryCoverage(this.acceptedView.peek()) !== undefined;
  }
  peekSummaryCoverage(ref: WindowAcceptedSnapshot): AcceptedCoverage | undefined {
    const tx = this.summaryTransition;
    return tx && !tx.consumed && !this.disposed && !ref.pending && this.acceptedView.isCurrent(ref)
      && tx.targetCap === this.acceptedView.currentCapability && tx.handle.isReadQualificationCurrent(tx.token)
      && tx.handle.handoffScope() === tx.scope && ref.coverage?.transitionId === tx.id && ref.coverage.targetRevision === ref.revision ? ref.coverage : undefined;
  }
  consumeSummaryCoverage(ref: WindowAcceptedSnapshot, id: SummaryTransitionId): boolean {
    const coverage = this.peekSummaryCoverage(ref);
    if (!coverage || coverage.transitionId !== id) return false;
    this.summaryTransition!.consumed = true; return true;
  }
  clearSummaryTransition(id?: SummaryTransitionId): void {
    if (id === undefined || this.summaryTransition?.id === id) this.summaryTransition = undefined;
  }
  setAttemptPresentations(facts: readonly AttemptPresentation[]): void {
    if (this.disposed || facts.length > 8 || facts.some(f => f.nodeIds.length > 64)) return;
    if (JSON.stringify(facts) === JSON.stringify(this.attemptPresentations)) return;
    this.attemptPresentations = facts.map(f => ({ ...f, nodeIds: [...f.nodeIds] }));
    this.bump(this.acceptedView.currentCapability);
  }

  acceptHandoff(record: HandoffRecord, scope: string, release: (reason: "return" | "end") => void): boolean {
    if (record.readyAttempt) {
      const proof = record.readyAttempt;
      const capability = this.acceptedView.currentCapability;
      const expected = this.acceptedView.peek();
      if (this.disposed || !this.acceptedView.isCurrent(expected) || proof.scope !== scope
        || proof.attemptId !== record.attemptId || !proof.turnId || proof.revision !== this.revision
        || !proof.refs.length || proof.refs.length > 64 || !proof.nodes.length) return false;
      if (!Number.isSafeInteger(proof.total) || proof.total < this.total || proof.nodes.length > 200 || expected.pending) return false;
      const incoming = new Map<string, HistoryItem>();
      const stagedBuckets = new Map(this.buckets);
      const copied = new Set<number>();
      for (const node of proof.nodes) {
        const ordinal = node.selection?.ordinal;
        if (!node.node_id || incoming.has(node.node_id) || ordinal === undefined || !Number.isSafeInteger(ordinal)
          || ordinal < 0 || ordinal >= proof.total || !Array.isArray(node.items)
          || node.items.some(item => item.kind === "unavailable" || item.kind === "text" && !item.text_complete)) return false;
        incoming.set(node.node_id, node);
        const index = Math.floor(ordinal / WINDOW_NODES);
        let holder = stagedBuckets.get(index);
        if (!copied.has(index)) {
          const clone = new Bucket();
          if (holder) { clone.items = [...holder.items]; clone.filled = holder.filled; for (const [key, attachment] of holder.handoffs) clone.handoffs.set(key, attachment); }
          holder = clone; stagedBuckets.set(index, holder); copied.add(index);
        }
        const slot = ordinal % WINDOW_NODES;
        const existing = holder!.items[slot];
        if (existing && existing.node_id !== node.node_id) return false;
        if (!existing) holder!.filled++;
        holder!.items[slot] = node;
      }
      if (stagedBuckets.size > WINDOWS_HELD || proof.refs.some(ref => !incoming.has(ref.nodeId))) return false;
      // The owned staging transaction may extend one contiguous selected run, never
      // fabricate a gap or evict an independent saved row to make the attempt fit.
      const ordinals = proof.nodes.map(node => node.selection!.ordinal!);
      const first = Math.min(expected.range?.first ?? Infinity, ...ordinals);
      const last = Math.max(expected.range?.last ?? -1, ...ordinals);
      if (last - first + 1 > WINDOW_NODES * WINDOWS_HELD) return false;
      const rows: HistoryItem[] = [];
      for (let ordinal = first; ordinal <= last; ordinal++) {
        const node = stagedBuckets.get(Math.floor(ordinal / WINDOW_NODES))?.items[ordinal % WINDOW_NODES];
        if (!node) return false;
        rows.push(node);
      }
      if (!proof.nodes.some(node => node.items?.some(item => item.kind !== "reasoning_unavailable"))) return false;
      const previous = this.retiredCapability === capability ? this.retiredAttempts : [];
      const previousCapability = this.retiredCapability;
      if (previous.length >= 8 && !previous.some(item => item.scope === scope && item.attemptId === record.attemptId)) return false;
      const retired = { scope, attemptId: record.attemptId, turnId: proof.turnId, revision: proof.revision,
        nodeIds: proof.refs.map(ref => ref.nodeId) };
      const next = [...previous.filter(item => item.scope !== scope || item.attemptId !== record.attemptId), retired];
      const generation = this.acceptedGeneration + 1;
      const staged = this.acceptedView.stage({ ...expected, generation, rows, range: { first, last }, total: proof.total, retiredAttempts: next }, capability);
      if (this.disposed || !this.acceptedView.isCurrent(expected) || capability !== this.acceptedView.currentCapability) return false;
      // Publish retirement and saved rows together, before any subscriber can run.
      const oldBuckets = this.buckets, oldTotal = this.total;
      this.buckets = stagedBuckets;
      this.total = proof.total;
      this.retiredAttempts = next;
      this.retiredCapability = capability;
      ++this.acceptedGeneration;
      if (!this.acceptedView.commit(staged)) { if (this.retiredAttempts === next) { this.retiredAttempts = previous; this.retiredCapability = previousCapability; this.buckets = oldBuckets; this.total = oldTotal; } return false; }
      const committed = this.acceptedView.peek();
      if (committed.generation !== generation || this.acceptedGeneration !== generation || capability !== this.acceptedView.currentCapability
        || !this.acceptedView.isCurrent(committed) || committed.retiredAttempts?.at(-1)?.attemptId !== record.attemptId) return false;
      this.version.value++;
      if (!this.acceptedView.isCurrent(committed) || capability !== this.acceptedView.currentCapability) return false;
      release("end");
      return true;
    }
    const proof = record.proof;
    if (this.disposed || !proof || proof.scope !== scope || proof.kind !== 'assistant_response' || proof.revision !== this.revision) return false;
    const bucket = this.buckets.get(Math.floor(proof.ordinal / WINDOW_NODES));
    const item = bucket?.items[proof.ordinal % WINDOW_NODES];
    if (!bucket || !item || item.node_id !== record.nodeId || item.kind !== proof.kind) return false;
    const old = bucket.handoffs.get(proof.ordinal);
    if (old) return old.record === record;
    bucket.handoffs.set(proof.ordinal, { record, release });
    this.bump();
    return true;
  }

  /** Items in the render range that are held, ascending. */
  rangeItems(): HistoryItem[] {
    const r = this.renderRange();
    const out: HistoryItem[] = [];
    if (r) for (let i = r.first; i <= r.last; i++) { const it = this.itemAt(i); if (it) out.push(it); }
    return out;
  }
  /** Held items with shell executions, wherever they are (for finding a selected step). */
  heldSteps(): HistoryItem[] {
    const out: HistoryItem[] = [];
    for (const b of this.buckets.values()) for (const it of b.items) if (it && (it.executions?.length ?? 0) > 0) out.push(it);
    return out;
  }
  isLoaded(i: number): boolean {
    return this.itemAt(i) !== undefined;
  }
  heightOf(i: number): number {
    return this.heights.h.get(i) ?? 0;
  }
  offsetOf(i: number): number {
    const range = this.renderRange();
    return range ? this.heights.offsetOf(Math.max(range.first, Math.min(i, range.last + 1)), range.first) : 0;
  }
  totalHeight(): number {
    return this.offsetOf(this.total);
  }
  locate(y: number): number {
    const range = this.renderRange();
    if (!range) return 0;
    let top = 0;
    let lastVisible = range.first;
    for (let i = range.first; i <= range.last; i++) {
      const height = this.heightOf(i);
      if (height > 0) {
        lastVisible = i;
        if (top + height > y) return i;
        top += height;
      }
    }
    return lastVisible;
  }
  /** The contiguous loaded run around the current anchor, or the newest loaded run. */
  renderRange(): { first: number; last: number } | undefined {
    if (!this.buckets.size) return undefined;
    const candidate = this.lastAnchor?.ordinal;
    let ordinal = candidate !== undefined && this.isLoaded(candidate) ? candidate : -1;
    if (ordinal < 0) {
      for (const [bucket, held] of this.buckets)
        for (let i = 0; i < held.items.length; i++)
          if (held.items[i] !== undefined) ordinal = Math.max(ordinal, bucket * WINDOW_NODES + i);
    }
    if (ordinal < 0) return undefined;
    let first = ordinal, last = ordinal;
    while (first > 0 && this.isLoaded(first - 1)) first--;
    while (last + 1 < this.total && this.isLoaded(last + 1)) last++;
    return { first, last };
  }
  /** The scroll offset as last told or corrected. */
  get scrollTop(): number {
    return this.viewTop;
  }
  /** The scroll offset to apply after a redraw, once. */
  takeScroll(): number | undefined {
    const s = this.scrollRequest;
    this.scrollRequest = undefined;
    return s;
  }

  /** Capture without consuming. A new accepted generation invalidates old plans. */
  peekScroll(ref: WindowAcceptedSnapshot): WindowScrollRequest | undefined {
    if (this.disposed || !this.acceptedView.isCurrent(ref) || ref.epoch !== this.epoch || this.scrollRequest === undefined) return;
    if (!this.scrollHandle || this.scrollHandle.target !== this.scrollRequest)
      this.scrollHandle = Object.freeze({ id: Object.freeze({}), target: this.scrollRequest });
    return this.scrollHandle;
  }
  /** Callback-free consumption leaves the accepted reference and epoch unchanged. */
  consumeScroll(ref: WindowAcceptedSnapshot, id: object): boolean {
    if (this.disposed || !this.acceptedView.isCurrent(ref) || ref.epoch !== this.epoch || !this.scrollHandle || this.scrollHandle.id !== id || this.scrollHandle.target !== this.scrollRequest) return false;
    this.scrollRequest = undefined;
    this.scrollHandle = undefined;
    return true;
  }

  /** Explicit re-window from a deferred node. No fragment merge or automatic retry loop. */
  retryDeferred(ref: WindowAcceptedSnapshot): boolean {
    if (!this.acceptedView.isCurrent(ref) || this.disposed || ref.revision !== this.revision) return false;
    const row = ref.rows.find(row => row.items === null && row.items_unavailable_reason === "response_budget");
    const ordinal = row?.selection?.ordinal;
    if (!row?.node_id || ordinal === undefined) return false;
    const index = Math.floor(ordinal / WINDOW_NODES);
    // Bucket reads share the pump's two slots; the separately owned tail/verify
    // must not be competed with by an explicit deferred retry.
    if (this.inflight.has(index) || this.inflight.size >= READS_IN_FLIGHT || this.tailCancel || this.verifying) return false;
    void this.readBucket(index, { ordinal, expect_node_id: row.node_id, before: 0, after: WINDOW_NODES - 1, excerpt_chars: HISTORY_EXCERPT_CHARS, items: true });
    return true;
  }

  // ---- the viewport ----

  anchor(scrollTop: number): Anchor {
    const ordinal = this.locate(scrollTop);
    return { ordinal, nodeId: this.itemAt(ordinal)?.node_id, offset: scrollTop - this.offsetOf(ordinal) };
  }
  scrollFor(a: Anchor): number {
    return this.offsetOf(a.ordinal) + a.offset;
  }

  /** Tell what shows. Cancels reads that left the margin now; requests what entered it after a pause. */
  view(scrollTop: number, clientHeight: number, atBottom: boolean): void {
    if (this.disposed) return;
    if (this.jumping) {
      if (atBottom) return; // keep the old reading position until the target window arrives
      this.jumping = false; // actual upward movement cancels explicit navigation too
      this.tailCancel?.cancel();
      this.tailCancel = undefined;
      this.verifying = false;
      this.tailAgain = false;
    }
    const moved = this.viewTop !== scrollTop || this.viewHeight !== clientHeight;
    this.viewTop = scrollTop;
    this.viewHeight = clientHeight;
    if (this.total === 0) return;
    this.lastAnchor = this.anchor(scrollTop);
    const now = this.renderRange();
    if (!now) return;
    // Pixels cannot navigate across an unloaded gap. Run switches are explicit and bump version.
    // The scroller's end is the path's end: trailing nodes that draw nothing have no height to reach.
    // Missing tail evidence is not a user detach and cannot create follow intent.
    const follow = atBottom && (now.last === this.total - 1 || this.following.peek() && !!this.tailCancel);
    if (follow !== this.following.peek()) this.following.value = follow;
    if (follow && this.newer.peek()) this.newer.value = false;
    const r = now;
    const wanted = new Set<number>();
    for (let b = Math.floor(r.first / WINDOW_NODES); b <= Math.floor(r.last / WINDOW_NODES); b++) wanted.add(b);
    // Adjacent windows are prefetched before the reader reaches an unloaded edge.
    const nearStart = r.first > 0 && scrollTop <= clientHeight;
    const nearEnd = r.last + 1 < this.total && scrollTop + 2 * clientHeight >= this.totalHeight();
    if (nearStart && !follow) wanted.add(Math.floor((r.first - 1) / WINDOW_NODES));
    else if (nearEnd) wanted.add(Math.floor((r.last + 1) / WINDOW_NODES));
    const sameWanted = wanted.size === this.wanted.size && [...wanted].every((b) => this.wanted.has(b));
    for (const b of this.failed) if (!wanted.has(b)) this.failed.delete(b);
    this.wanted = wanted;
    for (const b of wanted) {
      const held = this.buckets.get(b);
      if (held) {
        this.buckets.delete(b);
        this.buckets.set(b, held); // most recently shown last
      }
    }
    for (const [b, read] of this.inflight)
      if (!wanted.has(b)) {
        read.cancel.cancel();
        this.inflight.delete(b);
      }
    if (this.stopTimer && !moved && sameWanted) return;
    this.stopTimer?.();
    this.stopTimer = this.setTimer(() => {
      this.stopTimer = undefined;
      this.pump();
    }, PAUSE_MS);
  }

  /** An upward gesture against a fitting loaded edge reads once without detaching follow. */
  requestOlder(): void {
    if (this.disposed || this.jumping) return;
    const range = this.renderRange();
    if (!range || range.first === 0) return;
    this.wanted.add(Math.floor((range.first - 1) / WINDOW_NODES));
    this.pump();
  }

  /** A row was measured. Rows above the anchor changing height move the scroll offset, not the text. */
  measure(changes: readonly (readonly [number, number])[]): void {
    this.applyHeights(() => {
      let any = false;
      for (const [i, h] of changes) if (this.isLoaded(i) && Number.isFinite(h) && h >= 0 && this.heights.set(i, h)) any = true;
      return any;
    });
  }

  /** A live child changed layout; the screen remains the sole owner of DOM scroll writes. */
  layoutChanged(): void { if (!this.disposed) this.bump(); }

  /** Called after hints for this Thread. At the bottom this reads the last window only. */
  changed(): void {
    if (this.disposed) return;
    this.failed.clear();
    if (this.following.peek()) void this.readTail();
    else if (!this.newer.peek()) this.newer.value = true;
  }

  /** Jump to the newest: follow again and read the end. */
  jumpToEnd(): void {
    this.stopTimer?.();
    this.stopTimer = undefined;
    this.wanted.clear();
    for (const read of this.inflight.values()) read.cancel.cancel();
    this.inflight.clear();
    this.following.value = true;
    this.newer.value = false;
    this.jumping = true;
    this.scrollRequest = undefined;
    void this.readTail();
    this.bump();
  }

  retry(): void {
    if (this.tailFailed) { this.tailFailed = false; this.jumpToEnd(); return; }
    this.failed.clear();
    if (this.status.peek() === "error" && this.total === 0) void this.readTail();
    this.pump();
  }

  /** Leaving the view or the Thread: nothing more is read. */
  dispose(): void {
    this.clearSummaryTransition();
    this.disposed = true;
    this.acceptedView.dispose();
    const attachments = [...this.buckets.values()].flatMap(bucket => [...bucket.handoffs.values()]);
    for (const bucket of this.buckets.values()) bucket.handoffs.clear();
    this.buckets.clear();
    for (const attachment of attachments) attachment.release(this.disposed ? "end" : "return");
    this.stopTimer?.();
    this.stopTimer = undefined;
    this.cancelAll();
  }

  // ---- reads ----

  private cancelAll(): void {
    for (const r of this.inflight.values()) r.cancel.cancel();
    this.inflight.clear();
    this.tailCancel?.cancel();
    this.tailCancel = undefined;
  }

  private bump(capability: AcceptedCapability = this.acceptedView.currentCapability): void {
    if (this.disposed || capability !== this.acceptedView.currentCapability) return;
    const epoch = this.epoch;
    const generation = ++this.acceptedGeneration;
    const staged = this.acceptedView.stage({ generation, epoch, disposed: false,
      rows: this.rangeItems(), range: this.renderRange(), total: this.total,
      revision: this.revision, pending: this.status.peek() === "loading", attemptPresentations: this.attemptPresentations,
      coverage: this.summaryTransition?.targetCap === capability && !this.summaryTransition?.consumed ? this.summaryTransition?.coverage : undefined,
      retiredAttempts: (this.retiredCapability === capability ? this.retiredAttempts : []).filter(item => item.revision === this.revision) }, capability);
    if (this.disposed || epoch !== this.epoch || generation !== this.acceptedGeneration) return;
    if (!this.acceptedView.commit(staged)) return;
    if (this.disposed || epoch !== this.epoch || generation !== this.acceptedGeneration) return;
    this.version.value++;
  }

  private complete(b: number): boolean {
    const held = this.buckets.get(b);
    return held !== undefined && held.filled >= Math.min(WINDOW_NODES, this.total - b * WINDOW_NODES);
  }

  private pump(): void {
    if (this.disposed || this.total === 0 || this.verifying) return;
    const center = Math.floor(this.locate(this.viewTop + this.viewHeight / 2) / WINDOW_NODES);
    const todo = [...this.wanted]
      .filter((b) => b * WINDOW_NODES < this.total && !this.complete(b) && !this.inflight.has(b) && !this.failed.has(b))
      .sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
    for (const b of todo) {
      if (this.inflight.size >= READS_IN_FLIGHT) break;
      void this.readBucket(b);
    }
  }

  private async readBucket(b: number, request?: WindowReadArgs): Promise<void> {
    const epoch = this.epoch, capability = this.acceptedView.currentCapability;
    const cancel = new Cancel();
    this.inflight.set(b, { cancel });
    const out = await this.reader.read(
      request ?? { ordinal: b * WINDOW_NODES, before: 0, after: WINDOW_NODES - 1, excerpt_chars: HISTORY_EXCERPT_CHARS, items: true },
      cancel,
    );
    if (this.disposed || capability !== this.acceptedView.currentCapability || epoch !== this.epoch || this.inflight.get(b)?.cancel !== cancel) return; // scrolled away or reset: dropped
    this.inflight.delete(b);
    if (!out.ok) {
      if (out.error.kind === "owner" && out.error.code === "cursor_expired") void this.verify();
      else if (out.error.kind !== "cancelled") {
        this.failed.add(b);
        this.status.value = this.total === 0 ? "error" : this.status.peek();
        this.error.value = out.error.message;
      }
      this.pump();
      return;
    }
    if (this.revision !== undefined && out.value.revision !== this.revision) {
      void this.verify(); // the reply may predate or follow a rewrite; check before trusting it
      return;
    }
    this.install(out.value, capability);
    if (capability !== this.acceptedView.currentCapability || epoch !== this.epoch || this.disposed) return;
    this.pump();
  }

  /** The last node read still sits at its position, so everything before it is unchanged. */
  private async verify(): Promise<void> {
    if (this.verifying || this.disposed) return;
    const known = this.tailKnown;
    if (!known) return this.reset();
    this.verifying = true;
    const epoch = this.epoch, capability = this.acceptedView.currentCapability;
    const cancel = new Cancel();
    this.tailCancel?.cancel();
    this.tailCancel = cancel;
    const out = await this.reader.read({ ordinal: known.ordinal, before: 0, after: 0, expect_node_id: known.nodeId, excerpt_chars: HISTORY_EXCERPT_CHARS, items: true }, cancel);
    if (this.disposed || capability !== this.acceptedView.currentCapability || epoch !== this.epoch || this.tailCancel !== cancel) return;
    this.verifying = false;
    this.tailCancel = undefined;
    if (!out.ok) {
      if (out.error.kind === "owner" && out.error.code === "cursor_expired") this.reset();
      else if (out.error.kind !== "cancelled") this.fail(out.error.message);
      return;
    }
    this.revision = out.value.revision;
    this.setTotal(out.value.total);
    // Verification is evidence, not navigation to an evicted tail island.
    if (this.isLoaded(known.ordinal)) this.install(out.value, capability);
    if (capability !== this.acceptedView.currentCapability || epoch !== this.epoch || this.disposed) return;
    if (this.tailAgain) { this.tailAgain = false; void this.readTail(); }
    this.pump();
  }

  /** The newest window; once nodes are known, only what follows the last one known, checked against it. */
  private async readTail(latest = false): Promise<void> {
    if (this.disposed) return;
    if (this.tailCancel || this.verifying) {
      this.tailAgain = true;
      return;
    }
    const known = this.tailKnown;
    const args: WindowReadArgs = known && !latest
      ? { ordinal: known.ordinal, before: 0, after: 2 * WINDOW_NODES - 1, expect_node_id: known.nodeId, excerpt_chars: HISTORY_EXCERPT_CHARS, items: true }
      : { before: WINDOW_NODES - 1, after: 0, excerpt_chars: HISTORY_EXCERPT_CHARS, items: true };
    const epoch = this.epoch, capability = this.acceptedView.currentCapability;
    const cancel = new Cancel();
    this.tailCancel = cancel;
    const out = await this.reader.read(args, cancel);
    if (this.disposed || capability !== this.acceptedView.currentCapability || epoch !== this.epoch || this.tailCancel !== cancel) return;
    this.tailCancel = undefined;
    if (!out.ok) {
      if (out.error.kind === "owner" && out.error.code === "cursor_expired") this.reset();
      else if (out.error.kind !== "cancelled") {
        this.tailFailed = true;
        if (this.jumping) { this.jumping = false; this.following.value = false; }
        this.fail(out.error.message);
        this.bump(capability);
      }
      return;
    }
    if (latest && known && this.revision !== undefined && out.value.revision !== this.revision) {
      this.tailAgain = true;
      void this.verify();
      return;
    }
    this.tailFailed = false;
    this.revision = out.value.revision;
    this.setTotal(out.value.total);
    if (known && !latest && this.following.peek() && !this.isLoaded(Math.max(0, this.total - WINDOW_NODES))) {
      void this.readTail(true);
      return;
    }
    this.install(out.value, capability);
    if (capability !== this.acceptedView.currentCapability || epoch !== this.epoch || this.disposed) return;
    if (this.following.peek()) {
      this.lastAnchor = undefined;
      this.jumping = false;
      this.scrollRequest = Number.MAX_SAFE_INTEGER;
      this.bump(capability); // publish the new run only after its anchor selection changes
    }
    const last = out.value.items.at(-1);
    if (last && (ordinalOf(last) ?? -1) < this.total - 1) {
      void this.readTail(true);
      return;
    }
    if (this.tailAgain) {
      this.tailAgain = false;
      void this.readTail();
    }
    this.pump();
  }

  private fail(message: string): void {
    if (this.total === 0) this.status.value = "error";
    this.error.value = message;
  }

  /** The path was rewritten: drop everything and re-read at the anchor node, else the nearest position. */
  private reset(): void {
    const anchor = this.lastAnchor;
    const follow = this.following.peek();
    this.epoch++;
    this.acceptedView.revoke();
    this.retiredAttempts = [];
    const capability = this.acceptedView.currentCapability;
    this.cancelAll();
    if (capability !== this.acceptedView.currentCapability || this.disposed) return;
    this.verifying = false;
    this.tailAgain = false;
    this.jumping = false;
    this.lastAnchor = undefined;
    this.wanted.clear();
    const attachments = [...this.buckets.values()].flatMap(bucket => [...bucket.handoffs.values()]);
    for (const bucket of this.buckets.values()) bucket.handoffs.clear();
    this.buckets.clear();
    for (const attachment of attachments) attachment.release(this.disposed ? "end" : "return");
    this.failed.clear();
    this.heights = new Heights();
    this.revision = undefined;
    this.tailKnown = undefined;
    this.total = 0;
    this.status.value = "loading";
    this.pathChanged.value = true;
    this.bump();
    void this.recover(anchor, follow, this.epoch);
  }

  private async recover(anchor: Anchor | undefined, follow: boolean, epoch: number): Promise<void> {
    const around = (extra: WindowReadArgs): WindowReadArgs => ({ items: true, before: WINDOW_NODES / 2, after: WINDOW_NODES / 2 - 1, excerpt_chars: HISTORY_EXCERPT_CHARS, ...extra });
    const attempts: WindowReadArgs[] = [];
    if (!follow && anchor) {
      if (anchor.nodeId) attempts.push(around({ node_id: anchor.nodeId }));
      attempts.push(around({ ordinal: anchor.ordinal }));
    }
    attempts.push({ before: WINDOW_NODES - 1, after: 0, excerpt_chars: HISTORY_EXCERPT_CHARS, items: true });
    const cancel = new Cancel();
    this.tailCancel = cancel;
    for (const args of attempts) {
      const out = await this.reader.read(args, cancel);
      if (this.disposed || epoch !== this.epoch) return;
      if (!out.ok) {
        if (out.error.kind === "cancelled") break;
        continue;
      }
      this.tailCancel = undefined;
      this.revision = out.value.revision;
      this.setTotal(out.value.total);
      const recovered = out.value.items.find((item) => item.node_id === anchor?.nodeId);
      const ordinal = recovered ? ordinalOf(recovered) : anchor && this.total > 0 ? Math.min(anchor.ordinal, this.total - 1) : undefined;
      this.lastAnchor = !follow && ordinal !== undefined ? { ordinal, nodeId: recovered?.node_id, offset: recovered ? anchor!.offset : 0 } : undefined;
      this.install(out.value);
      if (!follow && this.lastAnchor) this.scrollRequest = this.scrollFor(this.lastAnchor);
      else if (follow) this.scrollRequest = Number.MAX_SAFE_INTEGER;
      if (this.scrollRequest !== undefined && this.scrollRequest < Number.MAX_SAFE_INTEGER) this.viewTop = this.scrollRequest;
      this.bump();
      this.pump();
      return;
    }
    if (this.tailCancel === cancel) this.tailCancel = undefined;
    this.fail("history could not be re-read");
    this.bump();
  }

  // ---- storing ----

  private setTotal(total: number): void {
    if (total === this.total) return;
    this.total = total;
    for (const b of [...this.buckets.keys()]) if (b * WINDOW_NODES >= total) this.dropBucket(b);
    for (const i of this.heights.h.keys()) if (i >= total) this.heights.clear(i);
  }

  /** Eviction discards both content and its measurements. */
  private dropBucket(b: number): void {
    const held = this.buckets.get(b);
    const attachments = held ? [...held.handoffs.values()] : [];
    held?.handoffs.clear();
    this.buckets.delete(b);
    for (const attachment of attachments) attachment.release("return");
    this.wanted.delete(b);
    this.failed.delete(b);
    this.inflight.get(b)?.cancel.cancel();
    this.inflight.delete(b);
    for (let i = b * WINDOW_NODES; i < (b + 1) * WINDOW_NODES; i++) this.heights.clear(i);
  }

  private install(result: HistoryWindowResult, capability = this.acceptedView.currentCapability): void {
    if (capability !== this.acceptedView.currentCapability || this.disposed) return;
    this.applyHeights(() => {
      for (const item of result.items) {
        const o = ordinalOf(item);
        if (o === undefined || o >= this.total) continue;
        const b = Math.floor(o / WINDOW_NODES);
        let held = this.buckets.get(b);
        if (!held) {
          held = new Bucket();
          this.buckets.set(b, held);
          while (this.buckets.size > WINDOWS_HELD) {
            const keys = [...this.buckets.keys()].sort((a, z) => a - z);
            const edge = b === keys[0] ? keys[keys.length - 1]! : keys[0]!;
            this.dropBucket(edge);
          }
        }
        const slot = o % WINDOW_NODES;
        if (held.items[slot] === undefined) held.filled++;
        const attachment = held.handoffs.get(o);
        if (attachment && attachment.record.nodeId !== item.node_id) { held.handoffs.delete(o); attachment.release("return"); }
        held.items[slot] = item;
        // A node with nothing to draw takes no height; once known, that's a measurement of zero.
        if (projectConversation([item]).length === 0) this.heights.set(o, 0);
        if (item.node_id !== undefined && (this.tailKnown === undefined || o >= this.tailKnown.ordinal)) this.tailKnown = { ordinal: o, nodeId: item.node_id };
      }
      return true;
    }, false);
    batch(() => {
      this.status.value = "ready";
      this.error.value = undefined;
      this.bump(capability);
    });
  }

  /** Runs a height change with the anchor row held in place. */
  private applyHeights(change: () => boolean, publish = true): void {
    const follow = this.following.peek();
    const a = this.total > 0 ? (this.lastAnchor ?? this.anchor(this.viewTop)) : undefined;
    const before = a ? this.offsetOf(a.ordinal) : 0;
    const changed = change();
    if (a && !follow) {
      const top = correctedScrollTop(this.viewTop, before, this.offsetOf(a.ordinal));
      if (Math.abs(top - this.viewTop) > 0.5) {
        this.scrollRequest = top;
        this.viewTop = top;
      }
    }
    if (changed && publish) this.bump();
  }
}
