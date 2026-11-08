// The long-thread reader's model (docs/design/long-threads.md): positional windows of a Thread's
// path held in bounded buckets, a measured scroll space over one loaded run, and adjacent reads.
// It stops at an unloaded edge. It knows no pixels except the heights it is told, and never walks the history.
import { signal } from "@preact/signals-core";
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
    const follow = atBottom && now.last === this.total - 1;
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
    this.disposed = true;
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

  private bump(): void {
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

  private async readBucket(b: number): Promise<void> {
    const epoch = this.epoch;
    const cancel = new Cancel();
    this.inflight.set(b, { cancel });
    const out = await this.reader.read(
      { ordinal: b * WINDOW_NODES, before: 0, after: WINDOW_NODES - 1, excerpt_chars: HISTORY_EXCERPT_CHARS },
      cancel,
    );
    if (this.disposed || epoch !== this.epoch || this.inflight.get(b)?.cancel !== cancel) return; // scrolled away or reset: dropped
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
    this.install(out.value);
    this.pump();
  }

  /** The last node read still sits at its position, so everything before it is unchanged. */
  private async verify(): Promise<void> {
    if (this.verifying || this.disposed) return;
    const known = this.tailKnown;
    if (!known) return this.reset();
    this.verifying = true;
    const epoch = this.epoch;
    const cancel = new Cancel();
    this.tailCancel?.cancel();
    this.tailCancel = cancel;
    const out = await this.reader.read({ ordinal: known.ordinal, before: 0, after: 0, expect_node_id: known.nodeId, excerpt_chars: HISTORY_EXCERPT_CHARS }, cancel);
    if (this.disposed || epoch !== this.epoch || this.tailCancel !== cancel) return;
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
    if (this.isLoaded(known.ordinal)) this.install(out.value);
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
      ? { ordinal: known.ordinal, before: 0, after: 2 * WINDOW_NODES - 1, expect_node_id: known.nodeId, excerpt_chars: HISTORY_EXCERPT_CHARS }
      : { before: WINDOW_NODES - 1, after: 0, excerpt_chars: HISTORY_EXCERPT_CHARS };
    const epoch = this.epoch;
    const cancel = new Cancel();
    this.tailCancel = cancel;
    const out = await this.reader.read(args, cancel);
    if (this.disposed || epoch !== this.epoch || this.tailCancel !== cancel) return;
    this.tailCancel = undefined;
    if (!out.ok) {
      if (out.error.kind === "owner" && out.error.code === "cursor_expired") this.reset();
      else if (out.error.kind !== "cancelled") {
        this.tailFailed = true;
        if (this.jumping) { this.jumping = false; this.following.value = false; }
        this.fail(out.error.message);
        this.bump();
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
    this.install(out.value);
    if (this.following.peek()) {
      this.lastAnchor = undefined;
      this.jumping = false;
      this.scrollRequest = Number.MAX_SAFE_INTEGER;
      this.bump(); // publish the new run only after its anchor selection changes
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
    this.cancelAll();
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
    const around = (extra: WindowReadArgs): WindowReadArgs => ({ before: WINDOW_NODES / 2, after: WINDOW_NODES / 2 - 1, excerpt_chars: HISTORY_EXCERPT_CHARS, ...extra });
    const attempts: WindowReadArgs[] = [];
    if (!follow && anchor) {
      if (anchor.nodeId) attempts.push(around({ node_id: anchor.nodeId }));
      attempts.push(around({ ordinal: anchor.ordinal }));
    }
    attempts.push({ before: WINDOW_NODES - 1, after: 0, excerpt_chars: HISTORY_EXCERPT_CHARS });
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
    this.buckets.delete(b);
    this.wanted.delete(b);
    this.failed.delete(b);
    this.inflight.get(b)?.cancel.cancel();
    this.inflight.delete(b);
    for (let i = b * WINDOW_NODES; i < (b + 1) * WINDOW_NODES; i++) this.heights.clear(i);
  }

  private install(result: HistoryWindowResult): void {
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
        held.items[slot] = item;
        // A node with nothing to draw takes no height; once known, that's a measurement of zero.
        if (projectConversation([item]).length === 0) this.heights.set(o, 0);
        if (item.node_id !== undefined && (this.tailKnown === undefined || o >= this.tailKnown.ordinal)) this.tailKnown = { ordinal: o, nodeId: item.node_id };
      }
      return true;
    });
    this.status.value = "ready";
    this.error.value = undefined;
  }

  /** Runs a height change with the anchor row held in place. */
  private applyHeights(change: () => boolean): void {
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
    if (changed) this.bump();
  }
}
