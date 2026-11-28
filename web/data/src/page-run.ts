import { batch, signal, type ReadonlySignal } from "@preact/signals-core";
import { Cancel } from "./operations";
import type { ShellboyData, Handle } from "./store";
import { retainedStringBytes, type RetainedReservation } from "./retained-budget";
import type { Page } from "./protocol";
import type { Outcome, OpError } from "./errors";

type Load<T, H> = (cursor: string | undefined, cancel: Cancel) => Promise<Outcome<{ page: Page<T>; header?: H }>>;
type Section<T, H> = { items: readonly T[]; header?: H; cursor?: string; loading: boolean; loadingMore?: boolean; error?: OpError; capped?: boolean; complete?: boolean; loaded?: boolean };
/** A Thread ID (its hints), or a caller-owned hint source for a list that spans Threads. */
export type HintSource = string | ((notify: () => void) => Handle);

/** One visible section. Each hint rebuilds the loaded prefix before publishing it. */
export class PageRun<T, H = never> {
  private readonly stateSignal = signal<Section<T, H>>({ items: [], loading: false });
  readonly state: ReadonlySignal<Section<T, H>> = this.stateSignal;
  private session?: { load: Load<T, H>; owner: ReturnType<ShellboyData["owner"]["peek"]>; watch: Handle; read?: Cancel; pages: number; rerun: boolean };

  private retained: RetainedReservation[] = [];

  constructor(private readonly data: ShellboyData, private readonly key: (row: T) => string | number, private readonly invalidContinuation: string) {}

  observe(hints: HintSource, load: Load<T, H>): () => void {
    this.close();
    const notify = () => {
      if (this.session !== session) return;
      if (session.read) session.rerun = true;
      else void this.read();
    };
    const watch = typeof hints === "string" ? this.data.watchHints(hints, notify) : hints(notify);
    const session: { load: Load<T, H>; owner: ReturnType<ShellboyData["owner"]["peek"]>; watch: Handle; read?: Cancel; pages: number; rerun: boolean } = { load, owner: this.data.owner.peek(), watch, pages: 1, rerun: false };
    this.session = session;
    void this.read();
    return () => { if (this.session === session) this.close(); };
  }

  close(): void {
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    // Publish the empty scope before cancellation callbacks can observe the old rows.
    batch(() => {
      this.stateSignal.value = { items: [], loading: false };
      for (const hold of this.retained.splice(0)) hold.release();
    });
    session.watch.close();
    session.read?.cancel();
  }

  /** Append the next page; resolves when that read settles. */
  more(): Promise<void> {
    const { cursor, loading } = this.stateSignal.peek();
    return cursor !== undefined && !loading ? this.read(cursor) : Promise.resolve();
  }

  private async read(appendCursor?: string): Promise<void> {
    const session = this.session;
    if (!session || this.data.owner.peek() !== session.owner) return;
    session.read?.cancel();
    const cancel = new Cancel();
    session.read = cancel;
    const previous = this.stateSignal.peek();
    this.stateSignal.value = { ...previous, loading: true,
      loadingMore: appendCursor !== undefined, error: undefined };
    const current = () => this.session === session && session.read === cancel && this.data.owner.peek() === session.owner;
    const items = appendCursor === undefined ? [] : [...previous.items];
    const ids = new Set(items.map(this.key));
    const cursors = new Set<string>();
    let cursor = appendCursor;
    const staged: RetainedReservation[] = [];
    const release = () => { for (const hold of staged.splice(0)) hold.release(); };
    const removeCancel = cancel.add(release);
    let header = appendCursor === undefined ? undefined : previous.header;
    let readPages = 0;
    const pages = appendCursor === undefined ? session.pages : 1;
    const fail = (error: OpError, invalidateCursor: boolean) => {
      release();
      session.read = undefined;
      this.stateSignal.value = { ...previous, cursor: invalidateCursor ? undefined : previous.cursor, complete: false, loading: false, loadingMore: false, error };
      this.rerunIfNeeded(session);
    };
    try {
      for (let i = 0; i < pages; i++) {
        if (cursor !== undefined) cursors.add(cursor);
        const result = await session.load(cursor, cancel);
        if (!current()) return;
        if (!result.ok) {
          // A cancelled read is not a failure: keep what was shown, as it was.
          if (result.error.kind === "cancelled") { session.read = undefined; this.stateSignal.value = { ...previous, loading: false, loadingMore: false }; this.rerunIfNeeded(session); return; }
          // Only Core can invalidate the continuation of the retained cut.
          const expired = result.error.kind === "owner" && result.error.code === "cursor_expired";
          fail(result.error, expired);
          return;
        }
        readPages++;
        const { page } = result.value;
        if (i === 0 && appendCursor === undefined) header = result.value.header;
        cursor = page.next_cursor;
        if ((cursor !== undefined && cursors.has(cursor)) || page.items.some(row => ids.has(this.key(row)))) {
          fail({ kind: "invalid_response", message: this.invalidContinuation }, false); return;
        }
        const bytes = 128 + retainedStringBytes(cursor ?? "")
          + (i === 0 && appendCursor === undefined && header !== undefined ? retainedStringBytes(JSON.stringify(header)) : 0)
          + page.items.reduce((total, row) => total + 96 + retainedStringBytes(JSON.stringify(row)) + retainedStringBytes(String(this.key(row))), 0);
        const hold = this.data.retainedBudget.reserve(bytes, () => {});
        if (!hold) {
          release();
          session.read = undefined;
          session.rerun = false;
          this.stateSignal.value = { ...previous, capped: true, complete: false, loading: false, loadingMore: false,
            error: { kind: "busy", message: "Retained data budget is full" } };
          return;
        }
        hold.pin();
        staged.push(hold);
        for (const row of page.items) { ids.add(this.key(row)); items.push(row); }
        if (cursor === undefined) break;
      }
      batch(() => {
        if (appendCursor === undefined) for (const hold of this.retained.splice(0)) hold.release();
        this.retained.push(...staged.splice(0));
        session.read = undefined;
        session.pages = appendCursor === undefined ? readPages : session.pages + readPages;
        this.stateSignal.value = { items, ...(header === undefined ? {} : { header }), loading: false, loadingMore: false, loaded: true, cursor, capped: false, complete: cursor === undefined };
      });
      this.rerunIfNeeded(session);
    } finally { removeCancel(); release(); }
  }

  private rerunIfNeeded(session: NonNullable<PageRun<T, H>["session"]>): void {
    if (this.session !== session || !session.rerun) return;
    session.rerun = false;
    void this.read();
  }
}
