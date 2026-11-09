// Human inbox: one displayed keyset page, sequential detail reads, one coalesced
// refresh. Owned by AppModel; close cancels reads/subscriptions. No polling.
import { batch, effect, signal, type ReadonlySignal } from "@preact/signals-core";
import { Cancel } from "./operations";
import { Refresher } from "./refresher";
import type { ShellboyData } from "./store";
import type { Outcome, OpError } from "./errors";
import { threadReplyItems } from "./replies";

export const HUMAN_PAGE_LIMIT = 16;
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
  readonly stale = signal(false);
  private ownerKey: string | undefined;
  private cursor: string | undefined;
  private nextCursor: string | undefined;
  private cancel = new Cancel();
  private closed = false;
  private generation = 0;
  private stop: () => void;
  private stopSession: () => void;
  // At most the current page's 16*128 duties. Keep only unconfirmed outcomes
  // across rereads; never replace their receipt with a fresh mutation identity.
  private attempts = new Map<string, { text: string; operationId?: string; result?: Promise<Outcome<unknown>>; settled?: boolean }>();
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
      const key = owner.state === "connected" && data.connection.value === "open" ? owner.info.instance_id ?? undefined : undefined;
      if (key !== this.ownerKey) {
        this.ownerKey = key;
        this.resetScope();
      }
      if (key !== this.ownerKey || this.closed) return;
      if (!key || list.loading || list.stale) {
        const generation = this.invalidateRead();
        if (generation !== this.generation || key !== this.ownerKey) return;
        batch(() => { this.loading.value = false; if (key) this.stale.value = true; });
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
    const generation = this.invalidateRead();
    if (generation !== this.generation) return;
    this.cursor = undefined; this.nextCursor = undefined;
    batch(() => { this.items.value = []; this.error.value = undefined; this.hasMore.value = false; this.loading.value = false; this.stale.value = false; });
  }
  private async read(sent: () => void): Promise<void> {
    if (this.closed || !this.ownerKey) return;
    const owner = this.ownerKey; const cursor = this.cursor;
    const generation = this.invalidateRead(); const cancel = this.cancel;
    const valid = () => !this.closed && this.data.connection.peek() === "open" && this.data.owner.peek().state === "connected" && generation === this.generation && owner === this.ownerKey && cancel === this.cancel && !cancel.cancelled;
    if (!valid()) return;
    batch(() => { this.loading.value = true; this.stale.value = this.items.peek().length > 0; });
    if (!valid()) return;
    const read = { cancel, onSent: sent };
    const fail = (error: OpError) => {
      if (!valid()) return;
      batch(() => { this.error.value = error; this.stale.value = true; });
    };
    try {
      const page = await this.data.operations.threadList({ awaiting: "human", limit: HUMAN_PAGE_LIMIT, ...(cursor ? { cursor } : {}) }, read);
      if (!valid()) return;
      if (!page.ok) { fail(page.error); return; }
      if (page.value.items.length > HUMAN_PAGE_LIMIT) { fail({ kind: "invalid_response", message: "human inbox page exceeds its bound" }); return; }
      const items: PendingItem[] = [];
      for (const summary of page.value.items) {
        if (!valid()) return;
        const detail = await this.data.operations.threadGet(summary.thread_id, read);
        if (!valid()) return;
        if (!detail.ok) { fail(detail.error); return; }
        if (!Array.isArray(detail.value.awaiting_replies) || detail.value.awaiting_replies.length > 128) {
          fail({ kind: "invalid_response", message: "human reply projection is missing or exceeds its bound" }); return;
        }
        const exact = summary.awaiting_human_count_exact !== false;
        for (const duty of threadReplyItems(summary.thread_id, detail.value.awaiting_replies)) {
          if (duty.recipient.kind !== "human") continue;
          items.push({ id: duty.id, threadId: summary.thread_id, threadTitle: summary.title, question: duty.question,
            askedAt: exact ? summary.awaiting_human_oldest_at ?? undefined : undefined,
            count: summary.awaiting_human_count, countExact: exact });
        }
      }
      if (!valid()) return;
      this.nextCursor = page.value.next_cursor;
      const ids = new Set(items.map(i => i.id));
      for (const [id, attempt] of this.attempts) if (!ids.has(id) && attempt.settled && !attempt.operationId) this.attempts.delete(id);
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
    if (this.closed || !this.items.peek().some(i => i.id === id)) return fail("question is no longer in the displayed human inbox");
    let attempt = this.attempts.get(id);
    if (attempt?.text !== undefined && attempt.text !== text) return fail("resolve the previous reply outcome before changing its text");
    if (attempt?.result) return attempt.result;
    if (!attempt) {
      if (this.attempts.size >= HUMAN_PAGE_LIMIT * 128) return fail("reply outcome capacity reached; inspect previous outcomes");
      attempt = { text }; this.attempts.set(id, attempt);
    }
    const entry = attempt;
    entry.result = this.data.operations.messageReply(id, text, entry.operationId).then(async out => {
      entry.settled = true;
      if (!out.ok && out.error.kind === "unconfirmed") entry.operationId = out.error.operationId;
      else if (!out.ok && (out.error.kind === "owner" || out.error.kind === "invalid_response")) entry.operationId = out.operationId ?? entry.operationId;
      else if (!out.ok) this.attempts.delete(id);
      this.cursor = undefined;
      await this.refresher.requestFresh("human");
      if (!out.ok) entry.result = undefined;
      return out;
    });
    return entry.result;
  }
  close(): void { this.closed = true; ++this.generation; this.cancel.cancel(); this.stop(); this.stopSession(); this.items.value = []; this.attempts.clear(); }
}
