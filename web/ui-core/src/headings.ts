// Headings for the Tag and Directory groupings: names from `thread.tags` / `thread.cwds`, and the
// members of a heading read on demand through `thread.list`. Nothing here reads every Thread:
// each heading is a page walk with a fixed ceiling, and only a few headings are open at once.
import { signal, type Signal } from "@preact/signals-core";
import { Cancel, type ArchivedFilter, type Operations, type OpError, type Outcome, type Page, type ThreadSummary } from "../../data/src";

export type HeadingKind = "tag" | "cwd";

/** Names per page; the owner's largest. */
export const HEADING_PAGE = 200;
/** Pages of names held and re-read: at most 1000 headings. Past it the list says so. */
export const HEADING_MAX_PAGES = 5;
/** Members per page of one heading. */
export const MEMBER_PAGE = 100;
/** Pages of members per heading: at most 500 rows. Past it the heading says so. */
export const MEMBER_MAX_PAGES = 5;
/** Headings open at once. Opening another closes the one opened longest ago. */
export const OPEN_MAX = 6;
/** A cursor bound to a filter or list that changed expires. Start over this many times. */
const RESTARTS = 3;

export interface HeadingsState {
  kind: HeadingKind | undefined;
  names: string[];
  nextCursor: string | undefined;
  pages: number;
  loading: boolean;
  loaded: boolean;
  error: OpError | undefined;
}

export interface MemberState {
  items: ThreadSummary[];
  nextCursor: string | undefined;
  pages: number;
  loading: boolean;
  loaded: boolean;
  error: OpError | undefined;
}

export interface MemberFilter {
  mode: Extract<ArchivedFilter, "exclude" | "only">;
  query: string;
}

const first: HeadingsState = { kind: undefined, names: [], nextCursor: undefined, pages: 1, loading: false, loaded: false, error: undefined };
const empty = (pages: number): MemberState => ({ items: [], nextCursor: undefined, pages, loading: true, loaded: false, error: undefined });

export class ThreadHeadings {
  readonly headings: Signal<HeadingsState> = signal(first);
  /** Open headings, oldest first. */
  readonly open: Signal<ReadonlyMap<string, MemberState>> = signal(new Map());
  private cancel = new Cancel();
  private generation = 0;

  constructor(
    private readonly ops: Operations,
    private readonly filter: () => MemberFilter,
    /** Rows that can be selected changed. */
    private readonly changed: () => void,
  ) {}

  /** Rows of every open heading, each Thread once. */
  members(): ThreadSummary[] {
    const seen = new Map<string, ThreadSummary>();
    for (const m of this.open.peek().values()) for (const s of m.items) seen.set(s.thread_id, s);
    return [...seen.values()];
  }

  loadedFor(kind: HeadingKind): boolean {
    const h = this.headings.peek();
    return h.kind === kind && h.loaded;
  }

  /** Reads names for `kind` unless they are already here or on their way. */
  ensure(kind: HeadingKind): void {
    const h = this.headings.peek();
    if (h.kind === kind && (h.loaded || h.loading)) return;
    void this.reload(kind);
  }

  /** Nobody is looking: cancels reads. What's listed stays. */
  leave(): void {
    this.generation++;
    this.cancel.cancel();
    const h = this.headings.peek();
    if (h.loading) this.headings.value = { ...h, loading: false };
    const next = new Map<string, MemberState>();
    for (const [name, m] of this.open.peek()) next.set(name, m.loading ? { ...m, loading: false } : m);
    this.open.value = next;
  }

  /** Names again up to the pages shown, then each open heading up to its pages. */
  async reload(kind: HeadingKind): Promise<void> {
    this.cancel.cancel();
    this.cancel = new Cancel();
    const cancel = this.cancel;
    const generation = ++this.generation;
    const now = this.headings.peek();
    if (now.kind !== kind) {
      this.open.value = new Map();
      this.headings.value = { ...first, kind, loading: true };
    } else {
      this.headings.value = { ...now, loading: true };
    }
    const pages = this.headings.peek().pages;
    const read = await this.walk((cursor) => this.names(kind, cursor, cancel), pages);
    if (generation !== this.generation) return;
    if (read.error?.kind === "cancelled") return;
    const h = this.headings.peek();
    this.headings.value = read.error
      ? { ...h, loading: false, error: read.error }
      : { ...h, loading: false, loaded: true, error: undefined, names: read.items, nextCursor: read.next };
    for (const name of [...this.open.peek().keys()]) {
      if (generation !== this.generation) return;
      await this.readMembers(kind, name, generation, cancel);
    }
    if (generation === this.generation) this.changed();
  }

  canLoadMoreNames(): boolean {
    const h = this.headings.peek();
    return h.nextCursor !== undefined && h.pages < HEADING_MAX_PAGES;
  }

  loadMoreNames(): void {
    const h = this.headings.peek();
    if (!h.kind || !this.canLoadMoreNames()) return;
    this.headings.value = { ...h, pages: h.pages + 1 };
    void this.reloadNamesOnly(h.kind);
  }

  private async reloadNamesOnly(kind: HeadingKind): Promise<void> {
    const generation = this.generation;
    const cancel = this.cancel;
    this.headings.value = { ...this.headings.peek(), loading: true };
    const read = await this.walk((cursor) => this.names(kind, cursor, cancel), this.headings.peek().pages);
    if (generation !== this.generation || read.error?.kind === "cancelled") return;
    const h = this.headings.peek();
    this.headings.value = read.error ? { ...h, loading: false, error: read.error } : { ...h, loading: false, error: undefined, names: read.items, nextCursor: read.next };
  }

  /** Opens or closes a heading. Opening reads its first page of members. */
  toggle(name: string): void {
    const kind = this.headings.peek().kind;
    if (!kind) return;
    const open = new Map(this.open.peek());
    if (open.delete(name)) {
      this.open.value = open;
      this.changed();
      return;
    }
    while (open.size >= OPEN_MAX) open.delete(open.keys().next().value as string);
    open.set(name, empty(1));
    this.open.value = open;
    this.changed();
    void this.readMembers(kind, name, this.generation, this.cancel);
  }

  canLoadMore(name: string): boolean {
    const m = this.open.peek().get(name);
    return m !== undefined && m.nextCursor !== undefined && m.pages < MEMBER_MAX_PAGES;
  }

  loadMore(name: string): void {
    const kind = this.headings.peek().kind;
    const m = this.open.peek().get(name);
    if (!kind || !m || !this.canLoadMore(name)) return;
    this.setMember(name, { ...m, pages: m.pages + 1 });
    void this.readMembers(kind, name, this.generation, this.cancel);
  }

  private setMember(name: string, state: MemberState): void {
    const open = this.open.peek();
    if (!open.has(name)) return;
    this.open.value = new Map([...open].map(([k, v]) => [k, k === name ? state : v]));
  }

  private async readMembers(kind: HeadingKind, name: string, generation: number, cancel: Cancel): Promise<void> {
    const before = this.open.peek().get(name);
    if (!before) return;
    this.setMember(name, { ...before, loading: true });
    const { mode, query } = this.filter();
    const where = kind === "tag" ? { tags: [name] } : { cwd: name };
    const read = await this.walk(
      (cursor) => this.ops.threadList({ limit: MEMBER_PAGE, archived: mode, ...where, ...(query ? { query } : {}), ...(cursor !== undefined && { cursor }) }, { cancel }),
      before.pages,
    );
    if (generation !== this.generation || read.error?.kind === "cancelled") return;
    const now = this.open.peek().get(name);
    if (!now) return;
    this.setMember(name, read.error ? { ...now, loading: false, error: read.error } : { ...now, loading: false, loaded: true, error: undefined, items: read.items, nextCursor: read.next });
    this.changed();
  }

  private names(kind: HeadingKind, cursor: string | undefined, cancel: Cancel): Promise<Outcome<Page<string>>> {
    const args = { limit: HEADING_PAGE, ...(cursor !== undefined && { cursor }) };
    return kind === "tag" ? this.ops.threadTags(args, { cancel }) : this.ops.threadCwds(args, { cancel });
  }

  /** `pages` pages from the start. An expired cursor starts over, a few times, then is reported. */
  private async walk<T>(fetch: (cursor: string | undefined) => Promise<Outcome<Page<T>>>, pages: number): Promise<{ items: T[]; next: string | undefined; error?: OpError }> {
    for (let attempt = 0; ; attempt++) {
      const items: T[] = [];
      let cursor: string | undefined;
      let expired = false;
      for (let page = 0; page < pages; page++) {
        const out = await fetch(cursor);
        if (!out.ok) {
          if (out.error.kind === "owner" && out.error.code === "cursor_expired" && attempt < RESTARTS) {
            expired = true;
            break;
          }
          return { items, next: cursor, error: out.error };
        }
        items.push(...out.value.items);
        cursor = out.value.next_cursor;
        if (cursor === undefined) break;
      }
      if (!expired) return { items, next: cursor };
    }
  }
}
