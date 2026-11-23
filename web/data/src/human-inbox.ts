// Human inbox: one displayed keyset page, one coalesced
// refresh. Owned by AppModel; close cancels reads/subscriptions. No polling.
import { batch, effect, signal, untracked, type ReadonlySignal } from "@preact/signals-core";
import { Cancel, messageCancelFailure, REPLY_PAGE_SIZE } from "./operations";
import { Refresher } from "./refresher";
import type { ShellboyData } from "./store";
import type { Outcome, OpError } from "./errors";

export const HUMAN_PAGE_LIMIT = REPLY_PAGE_SIZE;
export interface PendingItem {
  id: string;
  threadId: string;
  threadTitle: string;
  question: string;
  askedAt: string | undefined;
  count?: number;
  countExact?: boolean;
}
export interface PendingAdapter {
  readonly items: ReadonlySignal<PendingItem[]>;
  readonly error?: ReadonlySignal<OpError | undefined>;
  readonly loading?: ReadonlySignal<boolean>;
  readonly stale?: ReadonlySignal<boolean>;
  readonly hasMore?: ReadonlySignal<boolean>;
  more?(): Promise<void>;
  answer(id: string, text: string): Promise<Outcome<unknown>>;
  cancel?(id: string): Promise<Outcome<unknown>>;
  close?(): void;
}

export class HumanInbox implements PendingAdapter {
  readonly items = signal<PendingItem[]>([]);
  readonly error = signal<OpError | undefined>(undefined);
  readonly hasMore = signal(false);
  readonly loading = signal(false);
  readonly stale = signal(true);
  private ownerKey: string | undefined;
  private scopeEpoch = 0;
  private page: { owner: string; epoch: number; cursor?: string; ids: ReadonlySet<string> } | undefined;
  private cursor: string | undefined;
  private nextCursor: string | undefined;
  private readCancel = new Cancel();
  private closed = false;
  private generation = 0;
  private stop: () => void;
  private stopSession: () => void;
  // At most the current page's 16 duties. Keep only unconfirmed outcomes
  // across rereads; never replace their receipt with a fresh mutation identity.
  private attempts = new Map<string, { text: string | undefined; owner: string; epoch: number; operationId?: string; result?: Promise<Outcome<unknown>>; settled?: boolean; outcomeShown?: boolean }>();
  private refresher: Refresher;
  constructor(private readonly data: ShellboyData) {
    this.refresher = new Refresher(async (_, sent) => this.read(sent));
    // Observe disconnects even if reactive subscribers coalesce an unknown -> same-owner ABA.
    this.stopSession = data.link.subscribe(event => {
      if (event.kind === "closed") { this.ownerKey = undefined; this.resetScope(); }
      if (event.kind === "frame" && (event.frame.t === "owner" || event.frame.t === "hello")) {
        const owner = event.frame.owner;
        const key = owner.state === "connected" ? owner.info.instance_id ?? undefined : undefined;
        const restarted = event.frame.t === "owner" && event.frame.event === "restarted";
        if (key !== this.ownerKey || restarted) {
          this.ownerKey = key;
          this.resetScope();
        }
        const current = data.owner.peek();
        if (restarted && key && this.ownerKey === key && current.state === "connected" && current.info.instance_id === key) {
          void this.refresher.requestFresh("human");
        }
      }
    });
    this.stop = effect(() => {
      const owner = data.owner.value;
      const connected = data.connection.value === "open";
      const key = owner.state === "connected" && connected ? owner.info.instance_id ?? undefined : undefined;
      data.listHint.value;
      untracked(() => {
        if (key !== this.ownerKey || this.cursor !== undefined) {
          this.ownerKey = key;
          this.resetScope();
        }
        if (key && key === this.ownerKey && !this.closed) void this.refresher.request("human");
      });
    });
  }

  private invalidateRead(): number {
    const generation = ++this.generation;
    const previous = this.readCancel; this.readCancel = new Cancel();
    previous.cancel();
    return generation;
  }
  private resetScope(): void {
    // Revoke actions before cancellation can run a subscriber against displayed old rows.
    this.page = undefined; ++this.scopeEpoch;
    ++this.generation;
    const previous = this.readCancel; this.readCancel = new Cancel();
    this.cursor = undefined; this.nextCursor = undefined;
    batch(() => {
      this.items.value = []; this.error.value = undefined; this.hasMore.value = false;
      this.loading.value = false; this.stale.value = true;
      previous.cancel();
    });
  }
  private async read(sent: () => void): Promise<void> {
    if (this.closed || !this.ownerKey) return;
    const owner = this.ownerKey; const cursor = this.cursor; const epoch = this.scopeEpoch;
    const generation = this.invalidateRead(); const cancel = this.readCancel;
    const valid = () => epoch === this.scopeEpoch && !this.closed && this.data.connection.peek() === "open" && this.data.owner.peek().state === "connected" && generation === this.generation && owner === this.ownerKey && cancel === this.readCancel && !cancel.cancelled;
    if (!valid()) return;
    batch(() => { this.loading.value = true; this.stale.value = true; });
    if (!valid()) return;
    const read = { cancel, onSent: sent };
    const fail = (error: OpError) => {
      if (!valid()) return;
      batch(() => { this.error.value = error; this.stale.value = true; });
    };
    try {
      const page = await this.data.operations.messageList({ to: "human" }, cursor, read);
      if (!valid()) return;
      if (!page.ok) { fail(page.error); return; }
      const threadIds = [...new Set(page.value.items.flatMap(duty => duty.asked_by ? [duty.asked_by] : []))];
      const byId = new Map(this.data.threadRows.peek());
      const items: PendingItem[] = [];
      for (const duty of page.value.items) {
        if (!duty.asked_by) { fail({ kind: "invalid_response", message: "named reply lacks its asking Thread" }); return; }
        const summary = byId.get(duty.asked_by);
        items.push({ id: duty.message_id, threadId: duty.asked_by, threadTitle: summary?.title ?? duty.asked_by,
          question: duty.excerpt, askedAt: duty.created_at, count: summary?.awaiting_named_count,
          countExact: summary?.awaiting_named_count_exact });
      }
      this.nextCursor = page.value.next_cursor;
      const ids = new Set(items.map(i => i.id));
      for (const [id, attempt] of this.attempts) if (!ids.has(id) && attempt.settled && attempt.outcomeShown) this.attempts.delete(id);
      this.page = Object.freeze({ owner, epoch, ...(cursor && { cursor }), ids });
      // Publish a validated page together; no intermediate empty list during reread.
      batch(() => { this.error.value = undefined; this.hasMore.value = this.nextCursor !== undefined; this.stale.value = false; this.items.value = items; });
      if (threadIds.length) void this.data.operations.threadList({ thread_ids: threadIds }, { cancel }).then(out => {
        if (!valid() || !out.ok) return;
        const exact = new Map(out.value.items.map(row => [row.thread_id, row]));
        this.items.value = this.items.peek().map(item => {
          const row = exact.get(item.threadId);
          return row ? { ...item, threadTitle: row.title, count: row.awaiting_named_count, countExact: row.awaiting_named_count_exact } : item;
        });
      });
    } finally {
      if (valid()) this.loading.value = false;
    }
  }
  async more(): Promise<void> {
    if (this.loading.peek() || !this.nextCursor || this.closed) return;
    const next = this.nextCursor;
    const generation = this.generation + 1; const owner = this.ownerKey;
    this.resetScope();
    if (generation !== this.generation || owner !== this.ownerKey || this.closed) return;
    this.cursor = next;
    await this.refresher.requestFresh("human");
  }
  answer(id: string, text: string): Promise<Outcome<unknown>> { return this.mutate(id, text); }
  cancel(id: string): Promise<Outcome<unknown>> { return this.mutate(id, undefined); }

  private async mutate(id: string, text: string | undefined): Promise<Outcome<unknown>> {
    const fail = (message: string): Outcome<unknown> => ({ ok: false, error: { kind: "bridge", code: "not_available", message } });
    const page = this.page;
    const authorized = () => {
      const owner = this.data.owner.peek();
      return !this.closed && !!page && page === this.page && page.epoch === this.scopeEpoch && page.owner === this.ownerKey && page.cursor === this.cursor && this.data.connection.peek() === "open" && owner.state === "connected" && owner.info.instance_id === page.owner && page.ids.has(id);
    };
    if (!authorized()) return fail("question is no longer in the displayed human inbox");
    let attempt = this.attempts.get(id);
    if (attempt && (attempt.owner !== page!.owner)) return fail("inspect the original owner reply outcome before retrying");
    if (attempt && attempt.text !== text) return fail("resolve the previous question action before changing it");
    if (attempt?.result) return attempt.result;
    if (!attempt) {
      if (this.attempts.size >= HUMAN_PAGE_LIMIT) return fail("reply outcome capacity reached; inspect previous outcomes");
      if (!authorized()) return fail("human page scope changed");
      attempt = { text, owner: page!.owner, epoch: page!.epoch }; this.attempts.set(id, attempt);
    }
    const entry = attempt;
    if (!authorized()) return fail("human page scope changed");
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
  close(): void { this.page = undefined; ++this.scopeEpoch; this.closed = true; ++this.generation; this.readCancel.cancel(); this.stop(); this.stopSession(); this.items.value = []; this.attempts.clear(); }
}
