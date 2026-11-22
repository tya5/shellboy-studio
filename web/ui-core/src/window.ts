import type { HistoryWindowInput } from '../../data/src/history-input';
import { captureConversationInput, conversationIdentityEqual, captureCurrentWork, type ConversationSemanticInput } from "./conversation-input";
import type { ThreadHandle } from "../../data/src/store";
import { projectHistoryWindowItems } from './conversation-items';
import type { HistoryBody } from "../../data/src/protocol";
import { AcceptedView, makeConversationPublication, type AcceptedCapability, type AcceptedPublication, type PublicationReason } from "./accepted-view";
import { composeConversationDisplayPlan, conversationCohortKey, type ConversationDisplayPlan } from './conversation-display-plan';
// The long-thread reader's model (docs/design/long-threads.md): positional windows of a Thread's
// path held in bounded buckets, a measured scroll space over one loaded run, and adjacent reads.
// It stops at an unloaded edge. It knows no pixels except the heights it is told, and never walks the history.
import { batch, signal } from "@preact/signals-core";
import { Cancel, type HistoryItem, type HistoryWindowArgs, type HistoryWindowResult, type Outcome, HISTORY_WINDOW_EXCERPT_CHARS } from "../../data/src";

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
  read(args: WindowReadArgs, cancel: Cancel): Promise<Outcome<HistoryWindowInput>>;
}
export interface WindowOptions {
  /** Defaults to `setTimeout`; returns the canceller. */
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export interface WindowAcceptedSnapshot {
  readonly displayPlan?: ConversationDisplayPlan;
  readonly canonicalInput?: import("./conversation-input").CanonicalHistoryInput;
  readonly generation: number; readonly epoch: number; readonly disposed: boolean;
  readonly rows: readonly HistoryItem[]; readonly range: Readonly<{ first: number; last: number }> | undefined;
  readonly total: number; readonly revision: number | undefined; readonly pending: boolean;
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

// A response-budget omission is a transport downgrade, not a deletion of a known body.
const mergeHistoryItem = (previous: HistoryItem | undefined, incoming: HistoryItem): HistoryItem => {
  if (previous?.node_id !== undefined && previous.node_id === incoming.node_id
    && previous.selection?.ordinal === incoming.selection?.ordinal
    && incoming.items == null && incoming.items_unavailable_reason === "response_budget"
    && previous.items != null && previous.items.length > 0) {
    const { items_unavailable_reason: _downgrade, ...metadata } = incoming;
    return { ...metadata, items: previous.items };
  }
  return incoming;
};

class Bucket {
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

function revisionRelation(candidate: number, current: number | undefined): "uninitialized" | "same" | "newer" | "older" {
  if (current === undefined) return "uninitialized";
  return candidate === current ? "same" : candidate > current ? "newer" : "older";
}

function revisionIsCurrentOrNewer(candidate: number, current: number | undefined): boolean {
  const relation = revisionRelation(candidate, current);
  return relation === "uninitialized" || relation === "same" || relation === "newer";
}

type PreparedConversationPublication = { replacement: boolean; publication: AcceptedPublication<WindowAcceptedSnapshot, import("./conversation-input").ConversationIdentity>; binding: { handle: ThreadHandle; threadId: string; epoch: number } };

export class ConversationWindow {
  private readonly reader: WindowReader;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;
  private buckets = new Map<number, Bucket>();
  private heights = new Heights();
  private revision: number | undefined;
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
  private acceptedGeneration = 0;
  private acceptedInput?:{ref:WindowAcceptedSnapshot;identity:ConversationSemanticInput["identity"]};
  private conversationInputOwner: ((snapshot: WindowAcceptedSnapshot, replacement?: readonly import("../../data/src/handoff").HandoffRecord[]) => ConversationSemanticInput) | undefined;
  private currentThread?: { handle: ThreadHandle; threadId: string; epoch: number };
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
  readonly diagnostic=signal<Readonly<{reason:'input-bound'|'invalid-input'|'cyclic-input'|'publication-rejected';generation:number;revision:number|undefined;ownerEpoch:number;at:number}>|undefined>(undefined);
  /** At the newest node with the view at the bottom: new rows keep it there. */
  readonly following = signal(true);
  /** Rows exist past what is shown, while not following: offer the jump to the newest. */
  readonly newer = signal(false);
  /** The path was rewritten (compaction, rewind, prune) and the view re-read. */
  readonly pathChanged = signal(false);
  total = 0;

  constructor(reader: WindowReader, options: WindowOptions = {}) {
    this.reader={read:async(args,cancel)=>{
      const out=await reader.read(args,cancel);
      if(!out.ok&&out.error.kind==='invalid_response'){
        const ref=this.acceptedView.peek(),reason=out.error.message;
        this.diagnostic.value=Object.freeze({reason:reason==='input-bound'||reason==='cyclic-input'?reason:'invalid-input',generation:ref.generation,revision:ref.revision,ownerEpoch:this.epoch,at:Date.now()});
      }
      return out;
    }};
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
    const pendingTail = !!this.tailCancel || this.verifying || this.tailAgain;
    const follow = atBottom && (pendingTail ? this.following.peek() : now.last === this.total - 1);
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
  layoutChanged(): void { if (!this.disposed) this.version.value++; }

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
    this.disposed = true;
    this.conversationInputOwner = undefined;
    this.acceptedView.dispose();
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

  isCurrentThread(handle: ThreadHandle): boolean {
    const current = this.currentThread;
    return !!current && current.handle === handle && current.threadId === handle.threadId && current.epoch === handle.liveEpoch();
  }

  bindCurrentThread(handle: ThreadHandle): boolean {
    const current = this.currentThread;
    if (current && (current.handle !== handle || current.threadId !== handle.threadId || current.epoch !== handle.liveEpoch())) {
      this.currentThread = undefined;
      return false;
    }
    this.currentThread = { handle, threadId: handle.threadId, epoch: handle.liveEpoch() };
    return true;
  }

  private conversationCommit?: (snapshot: WindowAcceptedSnapshot) => void;

  bindConversationInput(capture: (snapshot: WindowAcceptedSnapshot, replacement?: readonly import("../../data/src/handoff").HandoffRecord[]) => ConversationSemanticInput, committed?: (snapshot: WindowAcceptedSnapshot) => void): boolean {
    if (this.disposed || this.conversationInputOwner) return false;
    this.conversationCommit = committed;
    this.conversationInputOwner = capture;
    return true;
  }

  captureConversationInput(snapshot: WindowAcceptedSnapshot, replacement?: readonly import("../../data/src/handoff").HandoffRecord[]): ConversationSemanticInput {
    if (!this.conversationInputOwner) throw new Error('ConversationWindow requires a typed input binding');
    return this.conversationInputOwner(snapshot, replacement);
  }

  /** A semantic source change uses the same constructor as an arriving history cut. */
  refreshConversationInput(ref: WindowAcceptedSnapshot): boolean {
    const capability=this.acceptedView.currentCapability;
    if(this.disposed||!this.acceptedView.isCurrent(ref))return false;
    const input=this.captureConversationInput(ref);
    const prior=this.acceptedInput;
    if(prior?.ref===ref&&conversationIdentityEqual(prior.identity,input.identity))return true;
    const generation=this.nextAcceptedGeneration();
    const staged=this.prepareCaptured({...ref,generation},capability,input,'bump');
    if(!staged||!this.acceptedView.isCurrent(ref)||capability!==this.acceptedView.currentCapability)return false;
    return staged ? this.commitAccepted(staged) : false;
  }

  private prepareCaptured(snapshot: WindowAcceptedSnapshot, capability: AcceptedCapability, input: ConversationSemanticInput, reason: PublicationReason, replacement = false): PreparedConversationPublication | undefined {
    const displayPlan = composeConversationDisplayPlan({ generation: snapshot.generation, revision: snapshot.revision,
      capability, rows: snapshot.rows, canonicalProjection: input.canonicalProjection, projection: input.projection,
      userDecision: input.decision, scope: input.scope, coverage: input.coverage }).plan;
    const binding = this.currentThread;
    if (!binding) return undefined;
    const lease = {
      capability,
      isCurrent: () => input.isCurrent() && !this.disposed && this.currentThread?.handle === binding.handle
        && this.currentThread.threadId === binding.threadId && this.currentThread.epoch === binding.epoch
        && binding.handle.liveEpoch() === binding.epoch,
    };
    const publication = makeConversationPublication({ ...snapshot, canonicalInput: input.canonicalInput, displayPlan }, reason, lease, input.identity);
    return { publication, binding, replacement };
  }

  private prepareAccepted(snapshot: WindowAcceptedSnapshot, capability: AcceptedCapability, ownerRead: boolean): PreparedConversationPublication | undefined {
    const replacement = ownerRead ? this.currentThread?.handle.captureHandoffReplacement() : undefined;
    return this.prepareCaptured(snapshot, capability, this.captureConversationInput(snapshot, replacement), ownerRead ? "read" : "bump", replacement !== undefined);
  }

  private commitAccepted(candidate: PreparedConversationPublication, afterCommit: () => void = () => {}): boolean {
    const { publication, binding, replacement } = candidate;
    let published = false;
    batch(() => {
      published = this.acceptedView.publish(publication, snapshot => {
        const savedAttempts = new Set<string>(snapshot.rows.flatMap(row => row.kind === "assistant_response" && row.provenance?.attempt_id ? [row.provenance.attempt_id] : []));
        if (replacement) binding.handle.commitHandoffReplacement();
        afterCommit();
        this.conversationCommit?.(snapshot);
        for (const record of binding.handle.handoff.peek()) {
          if (savedAttempts.has(record.attemptId)) binding.handle.releaseAcceptedHandoff(record.attemptId);
        }
      });
      const ref = this.acceptedView.peek();
      if (published && ref === publication.snapshot && publication.inputIdentity) this.acceptedInput = { ref, identity: publication.inputIdentity };
      if (!published) this.diagnostic.value = Object.freeze({ reason: 'publication-rejected', generation: ref.generation, revision: ref.revision, ownerEpoch: this.epoch, at: Date.now() });
    });
    return published;
  }

  private commitSelectedPublication(candidate: PreparedConversationPublication, buckets: Map<number, Bucket>, expected: WindowAcceptedSnapshot, capability: AcceptedCapability, geometry: () => void): boolean {
    if (this.disposed || capability !== this.acceptedView.currentCapability || !this.acceptedView.isCurrent(expected)) return false;
    return this.commitAccepted(candidate, () => {
      this.buckets = buckets;
      this.total = candidate.publication.snapshot.total;
      this.revision = candidate.publication.snapshot.revision;
      geometry();
    });
  }

  private nextAcceptedGeneration(): number { return ++this.acceptedGeneration; }

  private snapshotForSelection(selection: Pick<WindowAcceptedSnapshot, 'generation'|'epoch'|'rows'|'range'|'total'|'revision'|'pending'>,
    _capability: AcceptedCapability, canonicalInput?: WindowAcceptedSnapshot['canonicalInput']): WindowAcceptedSnapshot {
    return { ...selection, rows: canonicalInput?.rows ?? selection.rows, canonicalInput, disposed: false };
  }

  private bump(capability: AcceptedCapability = this.acceptedView.currentCapability, ownerRead = false): void {
    if (this.disposed || capability !== this.acceptedView.currentCapability) return;
    const epoch = this.epoch, generation = this.nextAcceptedGeneration();
    const accepted = this.acceptedView.peek(), rows = this.rangeItems();
    const canonicalInput = accepted.canonicalInput && accepted.revision === this.revision
      && accepted.rows.length === rows.length && accepted.rows.every((row, index) => row === rows[index])
      ? accepted.canonicalInput : undefined;
    const snapshot = this.snapshotForSelection({ generation, epoch, rows, range: this.renderRange(),
      total: this.total, revision: this.revision, pending: this.status.peek() === 'loading' }, capability, canonicalInput);
    const staged = this.prepareAccepted(snapshot, capability, ownerRead);
    if (staged && !this.disposed && epoch === this.epoch && generation === this.acceptedGeneration) {
      if (staged && this.commitAccepted(staged)) this.version.value++;
    }
  }

  private async refreshSelection(minimumRevision:number):Promise<void>{
    if(this.disposed||this.tailCancel||this.verifying)return;
    const expected=this.acceptedView.peek(),capability=this.acceptedView.currentCapability,epoch=this.epoch;
    if(!this.acceptedView.isCurrent(expected))return;
    const startIdentity=this.acceptedInput?.ref===expected?this.acceptedInput.identity:undefined;
    const follow=this.following.peek(),cancel=new Cancel();this.tailCancel=cancel;
    let owner=expected;
    const semanticOwnerCurrent=()=>{
      const accepted=this.acceptedView.peek(),input=this.acceptedInput;
      return !!startIdentity&&input?.ref===accepted&&conversationIdentityEqual(startIdentity,input.identity);
    };
    const captureResponseOwner=()=>{
      const accepted=this.acceptedView.peek();
      const sameCanonical=accepted===expected || accepted.canonicalInput !== undefined && accepted.canonicalInput === expected.canonicalInput
        && accepted.revision === expected.revision && accepted.epoch === expected.epoch
        && capability === this.acceptedView.currentCapability;
      if(!sameCanonical || accepted!==expected&&!semanticOwnerCurrent())return false;
      owner=accepted; return true;
    };
    const readOwnerCurrent=()=>{
      const state={disposed:this.disposed,cancelled:cancel.cancelled,tailCurrent:this.tailCancel===cancel,epochMatch:this.epoch===epoch,capMatch:this.acceptedView.currentCapability===capability,refCurrent:this.acceptedView.isCurrent(owner)};
      const ok=!state.disposed&&!state.cancelled&&state.tailCurrent&&state.epochMatch&&state.capMatch&&state.refCurrent;
      return ok;
    };
    const range=expected.range,rows:HistoryItem[]=[];let revision:number|undefined,total:number|undefined;
    try{
      if(!follow&&(!range||range.last-range.first+1>WINDOW_NODES*WINDOWS_HELD))return;
      const first=follow?0:range!.first,last=follow?0:range!.last;
      for(let ordinal=first;ordinal<=last;ordinal+=2*WINDOW_NODES){
        const args:WindowReadArgs=follow?{before:WINDOW_NODES-1,after:0,excerpt_chars:HISTORY_WINDOW_EXCERPT_CHARS,items:true}:
          {ordinal,before:0,after:Math.min(2*WINDOW_NODES-1,last-ordinal),expect_node_id:expected.rows[ordinal-first]?.node_id,excerpt_chars:HISTORY_WINDOW_EXCERPT_CHARS,items:true};
        const out=await this.reader.read(args,cancel);if(!captureResponseOwner()||!readOwnerCurrent())return;
        if(!out.ok){if(out.error.kind!=='cancelled')this.error.value=out.error.message;return;}
        const page=out.value;
        if(page.revision<minimumRevision||revision!==undefined&&(revision!==page.revision||total!==page.total))return;
        revision=page.revision;total=page.total;
        const begin=follow?Math.max(0,page.total-WINDOW_NODES):ordinal;
        const end=follow?page.total-1:Math.min(last,ordinal+2*WINDOW_NODES-1);
        if(page.items.length!==Math.max(0,end-begin+1))return;
        rows.push(...page.items);
      }
      if(!readOwnerCurrent()||revision===undefined||total===undefined)return;
      // An upward gesture during the owned latest read is not permission to navigate away.
      if(follow&&!this.following.peek()){this.newer.value=true;return;}
      const cursor={revision,total};
      const firstOrdinal=follow?Math.max(0,total-WINDOW_NODES):range!.first,lastOrdinal=follow?total-1:range!.last;
      // Validate and compose from the one bounded plain capture, then retain those exact rows.
      const selected=Object.freeze(rows);
      if(selected.length!==Math.max(0,lastOrdinal-firstOrdinal+1)||new Set(selected.map(row=>row.node_id)).size!==selected.length
        ||selected.some((row,index)=>!row.node_id||row.selection?.ordinal!==firstOrdinal+index))return;
      const commitExpected=owner;
      const generation=this.nextAcceptedGeneration();
      const snapshot=this.snapshotForSelection({generation,epoch,rows:selected,range:selected.length?{first:firstOrdinal,last:lastOrdinal}:undefined,
        total:cursor.total,revision:cursor.revision,pending:false},capability);
      const staged=this.prepareAccepted(snapshot,capability,true);
      if(!staged||!readOwnerCurrent()||generation!==this.acceptedGeneration||follow&&!this.following.peek())return;
      const replacement=new Map<number,Bucket>();
      for(const row of selected){const ordinal=row.selection!.ordinal!,index=Math.floor(ordinal/WINDOW_NODES);
        let bucket=replacement.get(index);if(!bucket){bucket=new Bucket();replacement.set(index,bucket);}
        bucket.items[ordinal%WINDOW_NODES]=row;bucket.filled++;
      }
      if(replacement.size>WINDOWS_HELD)return;
      const old={buckets:this.buckets,total:this.total,revision:this.revision,tailKnown:this.tailKnown,lastAnchor:this.lastAnchor,heights:this.heights,scroll:this.scrollRequest,
        inflight:new Map(this.inflight),wanted:this.wanted};
      const nextHeights=new Heights();
      for(const row of selected){const ordinal=row.selection!.ordinal!,prior=old.buckets.get(Math.floor(ordinal/WINDOW_NODES))?.items[ordinal%WINDOW_NODES];
        const height=old.heights.h.get(ordinal);if(prior&&prior.node_id===row.node_id&&prior.kind===row.kind&&height!==undefined)nextHeights.set(ordinal,height);
      }
      const nextTailKnown=selected.at(-1)?.node_id?{nodeId:selected.at(-1)!.node_id!,ordinal:lastOrdinal}:undefined;
      const nextLastAnchor=follow?undefined:old.lastAnchor, nextScroll=follow?Number.MAX_SAFE_INTEGER:old.scroll;
      if(!readOwnerCurrent()||this.acceptedView.peek()!==commitExpected||this.acceptedGeneration!==generation||capability!==this.acceptedView.currentCapability)return;
      if(!this.commitSelectedPublication(staged,replacement,commitExpected,capability,()=>{
        this.heights=nextHeights; this.tailKnown=nextTailKnown; this.lastAnchor=nextLastAnchor; this.scrollRequest=nextScroll;
      })){ return; }
      if(this.buckets!==replacement||this.disposed||capability!==this.acceptedView.currentCapability)return;
        for(const [index,read] of old.inflight)if(this.inflight.get(index)===read){read.cancel.cancel();this.inflight.delete(index);}
      if(follow&&this.following.peek()&&this.wanted===old.wanted)this.wanted.clear();this.failed.clear();
      if(follow&&!this.following.peek())this.scrollRequest=undefined;
      this.status.value='ready';this.error.value=undefined;this.jumping=false;this.version.value++;
    }finally{
      if(this.tailCancel===cancel){
        this.tailCancel=undefined;
        this.drainTailHint();this.pump();
      }
    }
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
      this.admitBucket(b);
    }
  }

  private admitBucket(b: number, request?: WindowReadArgs): boolean {
    // Pump, deferred retry and all other callers share this owner-level two-bucket gate.
    if (this.disposed || this.inflight.has(b) || this.inflight.size >= READS_IN_FLIGHT) return false;
    const epoch = this.epoch, capability = this.acceptedView.currentCapability;
    const cancel = new Cancel();
    this.inflight.set(b, { cancel });
    void this.runBucket(b, request, cancel, epoch, capability);
    return true;
  }
  private async runBucket(b: number, request: WindowReadArgs | undefined, cancel: Cancel, epoch: number, capability: AcceptedCapability): Promise<void> {
    const out = await this.reader.read(
      request ?? { ordinal: b * WINDOW_NODES, before: 0, after: WINDOW_NODES - 1, excerpt_chars: HISTORY_WINDOW_EXCERPT_CHARS, items: true },
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
    const out = await this.reader.read({ ordinal: known.ordinal, before: 0, after: 0, expect_node_id: known.nodeId, excerpt_chars: HISTORY_WINDOW_EXCERPT_CHARS, items: true }, cancel);
    if (this.disposed || capability !== this.acceptedView.currentCapability || epoch !== this.epoch || this.tailCancel !== cancel) return;
    this.verifying = false;
    this.tailCancel = undefined;
    if (!out.ok) {
      if (out.error.kind === "owner" && out.error.code === "path_changed" && this.revision !== undefined && this.following.peek()) {
        void this.refreshSelection(this.revision); return;
      }
      if (out.error.kind === "owner" && out.error.code === "cursor_expired") this.reset();
      else if (out.error.kind !== "cancelled") this.fail(out.error.message);
      return;
    }
    const relation = revisionRelation(out.value.revision, this.revision);
    if (relation === "older") {
      this.drainTailHint();
      this.pump();
      return;
    }
    if (relation === "newer") { void this.refreshSelection(out.value.revision); return; }
    this.revision = out.value.revision;
    this.setTotal(out.value.total);
    // Verification is evidence, not navigation to an evicted tail island.
    if (this.isLoaded(known.ordinal)) this.install(out.value, capability);
    if (capability !== this.acceptedView.currentCapability || epoch !== this.epoch || this.disposed) return;
    this.drainTailHint();
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
      ? { ordinal: known.ordinal, before: 0, after: 2 * WINDOW_NODES - 1, expect_node_id: known.nodeId, excerpt_chars: HISTORY_WINDOW_EXCERPT_CHARS, items: true }
      : { before: WINDOW_NODES - 1, after: 0, excerpt_chars: HISTORY_WINDOW_EXCERPT_CHARS, items: true };
    const epoch = this.epoch, capability = this.acceptedView.currentCapability;
    const cancel = new Cancel();
    this.tailCancel = cancel;
    const out = await this.reader.read(args, cancel);
    if (this.disposed || capability !== this.acceptedView.currentCapability || epoch !== this.epoch || this.tailCancel !== cancel) return;
    this.tailCancel = undefined;
    if (!out.ok) {
      if (out.error.kind === "owner" && out.error.code === "path_changed" && this.revision !== undefined && this.following.peek()) {
        void this.refreshSelection(this.revision); return;
      }
      if (out.error.kind === "owner" && out.error.code === "cursor_expired") this.reset();
      else if (out.error.kind === "cancelled") this.drainTailHint();
      else {
        this.tailFailed = true;
        if (this.jumping) { this.jumping = false; this.following.value = false; }
        this.fail(out.error.message);
        this.version.value++;
      }
      return;
    }
    this.tailFailed = false;
    const relation = revisionRelation(out.value.revision, this.revision);
    // The first successful tail read establishes the cursor; only established cursors need verification.
    if (relation === "newer") { void this.refreshSelection(out.value.revision); return; }
    if (relation === "older") {
      // Verify stale evidence once; only a real queued hint may demand another tail read.
      void this.verify();
      return;
    }
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
    this.drainTailHint();
    this.pump();
  }

  /** Consume one coalesced hint after the active owner read releases its slot. */
  private drainTailHint(): void {
    if (!this.tailAgain || this.disposed || this.tailCancel || this.verifying) return;
    this.tailAgain = false;
    void this.readTail();
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
    const capability = this.acceptedView.currentCapability;
    this.cancelAll();
    if (capability !== this.acceptedView.currentCapability || this.disposed) return;
    this.verifying = false;
    this.tailAgain = false;
    this.jumping = false;
    this.lastAnchor = undefined;
    this.wanted.clear();
    this.buckets.clear();
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
    const around = (extra: WindowReadArgs): WindowReadArgs => ({ items: true, before: WINDOW_NODES / 2, after: WINDOW_NODES / 2 - 1, excerpt_chars: HISTORY_WINDOW_EXCERPT_CHARS, ...extra });
    const attempts: WindowReadArgs[] = [];
    if (!follow && anchor) {
      if (anchor.nodeId) attempts.push(around({ node_id: anchor.nodeId }));
      attempts.push(around({ ordinal: anchor.ordinal }));
    }
    attempts.push({ before: WINDOW_NODES - 1, after: 0, excerpt_chars: HISTORY_WINDOW_EXCERPT_CHARS, items: true });
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
      if (this.disposed || epoch !== this.epoch) return;
      this.drainTailHint();
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
    for (const b of [...this.buckets.keys()]) {
      if (b * WINDOW_NODES >= total) { this.dropBucket(b); continue; }
      const held = this.buckets.get(b)!;
      const first = b * WINDOW_NODES;
      const limit = Math.max(0, total - first);
      for (let slot = limit; slot < held.items.length; slot++) {
        if (held.items[slot] !== undefined) held.filled--;
        held.items[slot] = undefined;
      }
    }
    for (const i of this.heights.h.keys()) if (i >= total) this.heights.clear(i);
  }

  /** Eviction discards both content and its measurements. */
  private dropBucket(b: number): void {
    const held = this.buckets.get(b);
    this.buckets.delete(b);
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
        held.items[slot] = mergeHistoryItem(held.items[slot], item);
        if (item.node_id !== undefined && (this.tailKnown === undefined || o >= this.tailKnown.ordinal)) this.tailKnown = { ordinal: o, nodeId: item.node_id };
      }
      return true;
    }, false);
    batch(() => {
      this.status.value = "ready";
      this.error.value = undefined;
      this.bump(capability, true);
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
    if (changed && publish) this.version.value++;
  }
}
