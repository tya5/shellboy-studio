// Screen logic of the Branches and Threads views: reads when a view opens or a hint says the list changed,
// one at a time, with one trailing read. Mutations are explicit and never optimistic.
import { batch, signal, type Signal } from "@preact/signals-core";
import { Cancel, type ArchiveResult, type ArchivedFilter, type Operations, type OpError, type TagResult, type ThreadSummary } from "../../data/src";
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

export class Branches {
  readonly state: Signal<FamilyState> = signal({ threadId: undefined, loading: false, family: undefined, error: undefined });
  readonly rewind: Signal<RewindState> = signal({ kind: "idle" });
  readonly selection: Signal<ReadonlySet<string>> = signal(new Set());
  readonly actionError: Signal<string | undefined> = signal(undefined);
  readonly actionBusy = signal(false);
  toggleBranch(id: string): void { const next = new Set(this.selection.peek()); next.has(id) ? next.delete(id) : next.add(id); this.selection.value = next; }
  async archiveSelected(): Promise<void> {
    const ids = [...this.selection.peek()]; if (!ids.length || this.actionBusy.peek()) return;
    this.actionBusy.value = true; const out = await this.ops.threadArchive(ids); this.actionBusy.value = false;
    if (!out.ok) this.actionError.value = out.error.message;
    else { const missing = out.value.not_found ?? []; this.selection.value = new Set(missing); this.actionError.value = missing.length ? `Not found: ${missing.join(", ")}` : undefined; const id = this.state.peek().threadId; if (id) void this.read(id); }
  }
  async renameBranch(id: string, title: string): Promise<void> {
    if (!title.trim() || this.actionBusy.peek()) return;
    this.actionBusy.value = true; const out = await this.ops.threadSetTitle(id, title.trim()); this.actionBusy.value = false;
    if (!out.ok) this.actionError.value = out.error.message;
    else { this.actionError.value = undefined; const selected = this.state.peek().threadId; if (selected) void this.read(selected); }
  }
  readonly fork: Signal<ForkState> = signal({ kind: "idle" });
  /** Graph or list; a phone always gets the list. */
  readonly layout: Signal<"graph" | "list"> = signal("graph");
  /** The point the panel acts on. A point belongs to the lane it sits on; any other node to the viewed Thread. */
  readonly target: Signal<BranchTarget | undefined> = signal(undefined);
  private running = false;
  private again = false;
  private cancel = new Cancel();

  constructor(private readonly ops: Operations) {}

  async excerpts(item: import("./branches").BranchItem, cancel: Cancel): Promise<{ split?: string; request?: string; answer?: string }> {
    const result: { split?: string; request?: string; answer?: string } = {};
    if (item.divergence) {
      const out = await this.ops.historyWindow({ thread_id: item.threadId, node_id: item.divergence.nodeId, before: 0, after: 24, excerpt_chars: 256 }, { cancel });
      if (out.ok) {
        result.split = out.value.items.find(n => n.node_id === item.divergence!.nodeId)?.excerpt;
        result.request = out.value.items.find(n => (n.selection?.ordinal ?? -1) > item.divergence!.ordinal && n.kind === "user")?.excerpt;
      }
    }
    if (!cancel.cancelled) {
      const out = await this.ops.historyWindow({ thread_id: item.threadId, before: 48, after: 0, excerpt_chars: 256 }, { cancel });
      if (out.ok) result.answer = out.value.items.filter(n => n.kind === "assistant_response" && n.excerpt).at(-1)?.excerpt?.split("\n").slice(0, 2).join("\n");
    }
    return result;
  }

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
  async confirmRewind(text = ""): Promise<void> {
    const s = this.rewind.peek();
    if (s.kind !== "ready" && s.kind !== "failed") return;
    const { facts, target } = s;
    this.rewind.value = { kind: "rewinding", facts, target };
    const out = await this.ops.threadRewind({ thread_id: target.threadId, node_id: target.nodeId });
    this.rewind.value = out.ok ? { kind: "done", facts: readRewind(out.value) } : { kind: "failed", facts, target, error: out.error };
    if (out.ok && text.trim()) {
      this.actionError.value = undefined;
      const sent = await this.ops.messageSend({ thread_id: target.threadId, text: text.trim() });
      if (!sent.ok) this.actionError.value = `Rewind succeeded; request not sent: ${sent.error.message}`;
    }
    if (out.ok) void this.read(this.state.peek().threadId ?? target.threadId);
  }

  async forkAt(target: BranchTarget, text = ""): Promise<void> {
    this.fork.value = { kind: "forking" };
    const out = await this.ops.threadFork({ thread_id: target.threadId, node_id: target.nodeId });
    if (out.ok && text.trim()) {
      const sent = await this.ops.messageSend({ thread_id: out.value.thread_id, text: text.trim() });
      if (!sent.ok) { this.fork.value = { kind: "done", threadId: out.value.thread_id, title: out.value.title }; this.actionError.value = `Branch ${out.value.thread_id} created; request not sent: ${sent.error.message}`; return; }
    }
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
