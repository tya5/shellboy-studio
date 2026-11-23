// Human inbox: one displayed keyset page, one coalesced
// refresh. Owned by AppModel; close cancels reads/subscriptions. No polling.
import { batch, effect, signal, type ReadonlySignal } from "@preact/signals-core";
import { Cancel, REPLY_PAGE_SIZE } from "./operations";
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
  private cancel = new Cancel();
  private closed = false;
  private generation = 0;
  private stop: () => void;
  private stopSession: () => void;
  // At most the current page's 16 duties. Keep only unconfirmed outcomes
  // across rereads; never replace their receipt with a fresh mutation identity.
  private attempts = new Map<string, { text: string; owner: string; epoch: number; operationId?: string; result?: Promise<Outcome<unknown>>; settled?: boolean; outcomeShown?: boolean }>();
  private refresher: Refresher;
  constructor(private readonly data: ShellboyData) {
    this.refresher = new Refresher(async (_, sent) => this.read(sent));
    // Observe disconnects even if reactive subscribers coalesce an unknown -> same-owner ABA.
    this.stopSession = data.link.subscribe(event => {
      if (event.kind === "closed") { this.ownerKey = undefined; this.resetScope(); }
      if (event.kind === "frame" && (event.frame.t === "owner" || event.frame.t === "hello")) {
        const owner = event.frame.owner;
        const key = owner.state === "connected" ? owner.info.instance_id ?? undefined : undefined;
        if (key !== this.ownerKey || event.frame.t === "owner" && event.frame.event === "restarted") { this.ownerKey = key; this.resetScope(); }
      }
    });
    this.stop = effect(() => {
      const owner = data.owner.value;
      const list = data.threadList.value;
      data.listHint.value; // Core change hints invalidate the global message.list projection too.
      const key = owner.state === "connected" && data.connection.value === "open" ? owner.info.instance_id ?? undefined : undefined;
      if (key !== this.ownerKey) {
        this.ownerKey = key;
        this.resetScope();
      }
      if (key !== this.ownerKey || this.closed) return;
      if (!key || list.loading || list.stale) {
        batch(() => {
          this.loading.value = false; this.stale.value = true;
          this.invalidateRead();
        });
        return;
      }
      if (list.loaded) {
        if (this.cursor !== undefined) {
          const generation = this.generation + 1;
          this.resetScope();
          if (generation !== this.generation || key !== this.ownerKey || this.closed) return;
        }
        this.cursor = undefined; // live keysets must restart on invalidation
        void this.refresher.requestFresh("human");
      }
    });
  }
  private invalidateRead(): number {
    const generation = ++this.generation;
    const previous = this.cancel; this.cancel = new Cancel();
    previous.cancel();
    return generation;
  }
  private resetScope(): void {
    // Revoke actions before cancellation can run a subscriber against displayed old rows.
    this.page = undefined; ++this.scopeEpoch;
    ++this.generation;
    const previous = this.cancel; this.cancel = new Cancel();
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
    const generation = this.invalidateRead(); const cancel = this.cancel;
    const valid = () => epoch === this.scopeEpoch && !this.closed && this.data.connection.peek() === "open" && this.data.owner.peek().state === "connected" && generation === this.generation && owner === this.ownerKey && cancel === this.cancel && !cancel.cancelled;
    if (!valid()) return;
    batch(() => { this.loading.value = true; this.stale.value = this.items.peek().length > 0; });
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
      const items: PendingItem[] = [];
      for (const duty of page.value.items) {
        if (!duty.asked_by) { fail({ kind: "invalid_response", message: "named reply lacks its asking Thread" }); return; }
        const summary = this.data.threadList.peek().items.find(row => row.thread_id === duty.asked_by);
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
  async answer(id: string, text: string): Promise<Outcome<unknown>> {
    const fail = (message: string): Outcome<unknown> => ({ ok: false, error: { kind: "bridge", code: "not_available", message } });
    const page = this.page;
    const authorized = () => {
      const owner = this.data.owner.peek();
      return !this.closed && !!page && page === this.page && page.epoch === this.scopeEpoch && page.owner === this.ownerKey && page.cursor === this.cursor && this.data.connection.peek() === "open" && owner.state === "connected" && owner.info.instance_id === page.owner && page.ids.has(id);
    };
    if (!authorized()) return fail("question is no longer in the displayed human inbox");
    let attempt = this.attempts.get(id);
    if (attempt && (attempt.owner !== page!.owner)) return fail("inspect the original owner reply outcome before retrying");
    if (attempt?.text !== undefined && attempt.text !== text) return fail("resolve the previous reply outcome before changing its text");
    if (attempt?.result) return attempt.result;
    if (!attempt) {
      if (this.attempts.size >= HUMAN_PAGE_LIMIT) return fail("reply outcome capacity reached; inspect previous outcomes");
      if (!authorized()) return fail("human page scope changed");
      attempt = { text, owner: page!.owner, epoch: page!.epoch }; this.attempts.set(id, attempt);
    }
    const entry = attempt;
    if (!authorized()) return fail("human page scope changed");
    entry.result = this.data.operations.messageReply(id, text, entry.operationId).then(async out => {
      entry.settled = true;
      if (!out.ok && out.error.kind === "unconfirmed") entry.operationId = out.error.operationId;
      else if (!out.ok && (out.error.kind === "owner" || out.error.kind === "invalid_response")) entry.operationId = out.operationId ?? entry.operationId;
      else if (!out.ok) this.attempts.delete(id);
      // Keep the original canonical receipt fact, but never refresh a different scope.
      if (authorized()) {
        const owner = page!.owner;
        const epoch = this.scopeEpoch + (this.cursor !== undefined ? 1 : 0);
        const generation = this.generation + (this.cursor !== undefined ? 1 : 0);
        if (this.cursor !== undefined) this.resetScope();
        // This token describes our intended first-page transition, not whatever a callback installed.
        const current = this.data.owner.peek();
        if (epoch === this.scopeEpoch && generation === this.generation && owner === this.ownerKey && !this.closed && this.data.connection.peek() === "open" && current.state === "connected" && current.info.instance_id === owner) {
          this.cursor = undefined;
          await this.refresher.requestFresh("human");
        }
      }
      if (!out.ok) entry.result = undefined;
      entry.outcomeShown = true;
      return out;
    });
    return entry.result;
  }
  close(): void { this.page = undefined; ++this.scopeEpoch; this.closed = true; ++this.generation; this.cancel.cancel(); this.stop(); this.stopSession(); this.items.value = []; this.attempts.clear(); }
}
