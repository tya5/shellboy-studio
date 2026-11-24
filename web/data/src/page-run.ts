import { signal, type ReadonlySignal } from "@preact/signals-core";
import { Cancel } from "./operations";
import { MAX_LIST_ROWS, type ShellboyData, type Handle } from "./store";
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

  constructor(private readonly data: ShellboyData, private readonly key: (row: T) => string | number, private readonly invalidContinuation: string, private readonly rowLimit = MAX_LIST_ROWS) {}

  observe(hints: HintSource, load: Load<T, H>): () => void {
    this.close();
    const notify = () => {
      if (this.session !== session) return;
      if (session.read) session.rerun = true;
      else void this.read();
    };
    const watch = typeof hints === "string" ? this.data.watchHints(hints, notify) : hints(notify);
    const session = { load, owner: this.data.owner.peek(), watch, pages: 1, rerun: false };
    this.session = session;
    void this.read();
    return () => { if (this.session === session) this.close(); };
  }

  close(): void {
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    // Publish the empty scope before cancellation callbacks can observe the old rows.
    this.stateSignal.value = { items: [], loading: false };
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
    this.stateSignal.value = { ...previous, loading: previous.items.length === 0 || appendCursor !== undefined,
      loadingMore: appendCursor !== undefined, error: undefined };
    const current = () => this.session === session && session.read === cancel && this.data.owner.peek() === session.owner;
    const items = appendCursor === undefined ? [] : [...previous.items];
    const ids = new Set(items.map(this.key));
    const cursors = new Set<string>();
    let cursor = appendCursor;
    let capped = false;
    let header = appendCursor === undefined ? undefined : previous.header;
    const pages = appendCursor === undefined ? session.pages : 1;
    const fail = (error: OpError, invalidateCursor: boolean) => {
      session.read = undefined;
      this.stateSignal.value = { ...previous, cursor: invalidateCursor ? undefined : previous.cursor, complete: false, loading: false, loadingMore: false, error };
      this.rerunIfNeeded(session);
    };
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
      const { page } = result.value;
      if (i === 0 && appendCursor === undefined) header = result.value.header;
      cursor = page.next_cursor;
      if ((cursor !== undefined && (!page.items.length || cursors.has(cursor))) || page.items.some(row => ids.has(this.key(row)))) {
        fail({ kind: "invalid_response", message: this.invalidContinuation }, false); return;
      }
      const remaining = this.rowLimit - items.length;
      capped = page.items.length > remaining || (page.items.length === remaining && cursor !== undefined);
      for (const row of page.items.slice(0, remaining)) { ids.add(this.key(row)); items.push(row); }
      if (cursor === undefined || capped) break;
    }
    session.read = undefined;
    if (appendCursor !== undefined) session.pages++;
    this.stateSignal.value = { items, ...(header === undefined ? {} : { header }), loading: false, loadingMore: false, loaded: true, cursor: capped ? undefined : cursor, capped, complete: cursor === undefined && !capped };
    this.rerunIfNeeded(session);
  }

  private rerunIfNeeded(session: NonNullable<PageRun<T, H>["session"]>): void {
    if (this.session !== session || !session.rerun) return;
    session.rerun = false;
    void this.read();
  }
}
