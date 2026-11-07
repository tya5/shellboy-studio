// Screen logic of the Branches and Threads views: reads when a view opens or a hint says the list changed,
// one at a time, with one trailing read. Mutations are explicit and never optimistic.
import { batch, signal, type Signal } from "@preact/signals-core";
import { Cancel, type ArchiveResult, type ArchivedFilter, type Operations, type OpError, type ThreadSummary } from "../../data/src";
import { branchLayout, readFamily, readRewind, type BranchFamily, type RewindFacts } from "./branches";
import type { ThreadGrouping } from "./org";

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

export class Branches {
  readonly state: Signal<FamilyState> = signal({ threadId: undefined, loading: false, family: undefined, error: undefined });
  readonly rewind: Signal<RewindState> = signal({ kind: "idle" });
  readonly fork: Signal<ForkState> = signal({ kind: "idle" });
  /** Graph or list; a phone always gets the list. */
  readonly layout: Signal<"graph" | "list"> = signal("graph");
  /** The point the panel acts on. A point belongs to the lane it sits on; any other node to the viewed Thread. */
  readonly target: Signal<BranchTarget | undefined> = signal(undefined);
  private running = false;
  private again = false;
  private cancel = new Cancel();

  constructor(private readonly ops: Operations) {}

  /** Nobody is looking: cancels the read. The family read so far stays. */
  leave(): void {
    this.again = false;
    this.cancel.cancel();
    if (this.state.peek().loading) this.state.value = { ...this.state.peek(), loading: false };
  }

  /** The view opened on this Thread, or a hint arrived. One read at a time, one trailing. */
  async read(threadId: string): Promise<void> {
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
        this.cancel = new Cancel();
        const out = await readWholeFamily(this.ops, id, this.cancel);
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
  async confirmRewind(): Promise<void> {
    const s = this.rewind.peek();
    if (s.kind !== "ready" && s.kind !== "failed") return;
    const { facts, target } = s;
    this.rewind.value = { kind: "rewinding", facts, target };
    const out = await this.ops.threadRewind({ thread_id: target.threadId, node_id: target.nodeId });
    this.rewind.value = out.ok ? { kind: "done", facts: readRewind(out.value) } : { kind: "failed", facts, target, error: out.error };
    if (out.ok) void this.read(this.state.peek().threadId ?? target.threadId);
  }

  async forkAt(target: BranchTarget): Promise<void> {
    this.fork.value = { kind: "forking" };
    const out = await this.ops.threadFork({ thread_id: target.threadId, node_id: target.nodeId });
    this.fork.value = out.ok ? { kind: "done", threadId: out.value.thread_id, title: out.value.title } : { kind: "failed", error: out.error };
    if (out.ok) void this.read(this.state.peek().threadId ?? target.threadId);
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
  | { kind: "moved"; threadId: string; parent: string; liveRun: boolean }
  | { kind: "refused"; threadId: string; parent: string; message: string };

export type OrgAction = { kind: "idle" } | { kind: "running" } | { kind: "done"; verb: "archive" | "unarchive"; result: ArchiveResult } | { kind: "failed"; error: OpError };

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

  constructor(private readonly ops: Operations) {}

  ensure(): void {
    if (!this.state.peek().loaded && !this.state.peek().loading) void this.read();
  }

  /** Nobody is looking: cancels the read. What's listed stays. */
  leave(): void {
    this.again = false;
    this.cancel.cancel();
    if (this.state.peek().loading) this.state.value = { ...this.state.peek(), loading: false };
  }

  /** Reads again up to the pages shown. A cursor bound to another mode or list starts over. */
  async read(): Promise<void> {
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
    const change = out.value.parent_change as { live_run_id?: unknown } | undefined;
    this.move.value = { kind: "moved", threadId: m.threadId, parent: m.parent, liveRun: typeof change?.live_run_id === "string" };
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
}
