// Human inbox: the shared PageRun over `message.list {to: human}`. Show more appends a
// page; a list hint re-reads the loaded pages (#105). Owned by AppModel; close cancels
// reads/subscriptions. No polling.
import { computed, effect, untracked, type ReadonlySignal } from "@preact/signals-core";
import { messageCancelFailure, REPLY_PAGE_SIZE } from "./operations";
import { PageRun } from "./page-run";
import { REPLY_RETENTION } from "./replies";
import type { OwnerState, PendingReply } from "./protocol";
import type { ShellboyData } from "./store";
import type { Outcome, OpError } from "./errors";

export const HUMAN_PAGE_LIMIT = REPLY_PAGE_SIZE;
/** Questions retained across Show more; also the bound of the reply-outcome ledger. */
export const HUMAN_RETAINED = REPLY_RETENTION;
export interface PendingItem {
  id: string;
  threadId: string;
  question: string;
  askedAt: string | undefined;
}
export interface PendingAdapter {
  readonly items: ReadonlySignal<PendingItem[]>;
  readonly error?: ReadonlySignal<OpError | undefined>;
  readonly loading?: ReadonlySignal<boolean>;
  readonly stale?: ReadonlySignal<boolean>;
  readonly hasMore?: ReadonlySignal<boolean>;
  /** True only when the last read reached the end of Core's list within the retention bound. */
  readonly complete?: ReadonlySignal<boolean>;
  /** The retention bound stopped Show more. */
  readonly capped?: ReadonlySignal<boolean>;
  more?(): Promise<void>;
  answer(id: string, text: string): Promise<Outcome<unknown>>;
  cancel?(id: string): Promise<Outcome<unknown>>;
  close?(): void;
}

type Connected = Extract<OwnerState, { state: "connected" }>;

export class HumanInbox implements PendingAdapter {
  private readonly pages: PageRun<PendingReply>;
  readonly items: ReadonlySignal<PendingItem[]>;
  readonly error: ReadonlySignal<OpError | undefined>;
  readonly hasMore: ReadonlySignal<boolean>;
  readonly loading: ReadonlySignal<boolean>;
  readonly stale: ReadonlySignal<boolean>;
  readonly complete: ReadonlySignal<boolean>;
  readonly capped: ReadonlySignal<boolean>;
  /** The owner the retained pages belong to; any new owner value is a new scope. */
  private scope: Connected | undefined;
  private scopeEpoch = 0;
  private hint: (() => void) | undefined;
  private closed = false;
  private stop: () => void;
  private stopSession: () => void;
  private stopRows: () => void;
  // At most the retained questions' duties. Keep only unconfirmed outcomes
  // across rereads; never replace their receipt with a fresh mutation identity.
  private attempts = new Map<string, { text: string | undefined; owner: string; epoch: number; operationId?: string; result?: Promise<Outcome<unknown>>; settled?: boolean; outcomeShown?: boolean }>();
  constructor(private readonly data: ShellboyData) {
    this.pages = new PageRun(data, row => row.message_id, "Invalid human inbox continuation", HUMAN_RETAINED);
    const state = this.pages.state;
    let source: readonly PendingReply[] | undefined; let mapped: PendingItem[] = [];
    // Same rows, same array: a loading flag or a failed reread does not re-render the list.
    this.items = computed(() => {
      const rows = state.value.items;
      if (rows !== source) { source = rows; mapped = rows.map(duty => ({ id: duty.message_id, threadId: duty.asked_by!, question: duty.excerpt, askedAt: duty.created_at })); }
      return mapped;
    });
    this.error = computed(() => state.value.error);
    this.hasMore = computed(() => state.value.cursor !== undefined);
    this.loading = computed(() => state.value.loading);
    this.stale = computed(() => { const s = state.value; return s.loading || s.error !== undefined || !s.loaded; });
    this.complete = computed(() => state.value.complete === true);
    this.capped = computed(() => state.value.capped === true);
    // Observe disconnects even if reactive subscribers coalesce an unknown -> same-owner ABA.
    this.stopSession = data.link.subscribe(event => {
      if (event.kind === "closed") { this.scope = undefined; this.resetScope(); }
      if (event.kind === "frame" && (event.frame.t === "owner" || event.frame.t === "hello")) {
        const restarted = event.frame.t === "owner" && event.frame.event === "restarted";
        const scope = this.currentScope();
        if (scope !== this.scope || restarted) { this.scope = scope; this.resetScope(); }
        if (restarted) this.request();
      }
    });
    this.stop = effect(() => {
      data.owner.value; data.connection.value; data.listHint.value;
      untracked(() => {
        const scope = this.currentScope();
        if (scope !== this.scope) { this.scope = scope; this.resetScope(); }
        this.request();
      });
    });
    this.stopRows = effect(() => {
      const s = state.value;
      if (!s.loaded || s.loading || s.error) return;
      const items = this.items.value;
      untracked(() => {
        const ids = new Set(items.map(i => i.id));
        for (const [id, attempt] of this.attempts) if (!ids.has(id) && attempt.settled && attempt.outcomeShown) this.attempts.delete(id);
        const threadIds = [...new Set(items.map(i => i.threadId))];
        if (threadIds.length) void this.data.readActiveRows(threadIds);
      });
    });
  }

  private currentScope(): Connected | undefined {
    const owner = this.data.owner.peek();
    return !this.closed && this.data.connection.peek() === "open" && owner.state === "connected" && owner.info.instance_id ? owner : undefined;
  }
  private resetScope(): void {
    // Revoke actions before cancellation can run a subscriber against displayed old rows.
    ++this.scopeEpoch;
    this.pages.close();
  }
  /** Re-read the loaded pages, or start the first one for this scope. */
  private request(): void {
    if (this.closed || !this.scope || this.scope !== this.currentScope()) return;
    if (this.hint) { this.hint(); return; }
    this.pages.observe(notify => {
      this.hint = notify;
      return { close: () => { if (this.hint === notify) this.hint = undefined; } };
    }, async (cursor, cancel) => {
      const page = await this.data.operations.messageList({ to: "human" }, cursor, { cancel });
      if (!page.ok) return page;
      if (page.value.items.some(duty => !duty.asked_by)) return { ok: false, error: { kind: "invalid_response", message: "named reply lacks its asking Thread" } };
      return { ok: true, value: { page: page.value } };
    });
  }
  more(): Promise<void> {
    return this.closed ? Promise.resolve() : this.pages.more();
  }
  answer(id: string, text: string): Promise<Outcome<unknown>> { return this.mutate(id, text); }
  cancel(id: string): Promise<Outcome<unknown>> { return this.mutate(id, undefined); }

  private async mutate(id: string, text: string | undefined): Promise<Outcome<unknown>> {
    const fail = (message: string): Outcome<unknown> => ({ ok: false, error: { kind: "bridge", code: "not_available", message } });
    const scope = this.scope; const epoch = this.scopeEpoch;
    const authorized = () => !this.closed && !!scope && scope === this.scope && epoch === this.scopeEpoch && scope === this.currentScope()
      && this.pages.state.peek().items.some(row => row.message_id === id);
    if (!authorized()) return fail("question is no longer in the displayed human inbox");
    const owner = scope!.info.instance_id!;
    let attempt = this.attempts.get(id);
    if (attempt && attempt.owner !== owner) return fail("inspect the original owner reply outcome before retrying");
    if (attempt && attempt.text !== text) return fail("resolve the previous question action before changing it");
    if (attempt?.result) return attempt.result;
    if (!attempt) {
      if (this.attempts.size >= HUMAN_RETAINED) return fail("reply outcome capacity reached; inspect previous outcomes");
      if (!authorized()) return fail("human inbox scope changed");
      attempt = { text, owner, epoch }; this.attempts.set(id, attempt);
    }
    const entry = attempt;
    if (!authorized()) return fail("human inbox scope changed");
    const operation = text === undefined ? this.data.operations.messageCancel(id, entry.operationId)
      : this.data.operations.messageReply(id, text, entry.operationId);
    entry.result = operation.then(out => {
      entry.settled = true;
      if (!out.ok && out.error.kind === "unconfirmed") entry.operationId = out.error.operationId;
      else if (!out.ok && (out.error.kind === "owner" || out.error.kind === "invalid_response")) entry.operationId = out.operationId ?? entry.operationId;
      else if (!out.ok) this.attempts.delete(id);
      // A receipt does not change the list; Core's next hint does.
      if (!out.ok) entry.result = undefined;
      entry.outcomeShown = true;
      if (out.ok && text === undefined) {
        const failure = messageCancelFailure(out.value, id, "reply");
        if (failure !== undefined) {
          entry.result = undefined;
          // A definitive refusal must not replay the same mutation receipt on retry.
          this.attempts.delete(id);
          return fail(failure);
        }
      }
      return out;
    });
    return entry.result;
  }
  close(): void { this.closed = true; ++this.scopeEpoch; this.scope = undefined; this.stop(); this.stopSession(); this.stopRows(); this.pages.close(); this.attempts.clear(); }
}
