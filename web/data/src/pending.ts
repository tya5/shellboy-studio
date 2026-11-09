// Human inbox: one displayed keyset page, sequential detail reads, one coalesced
// refresh. Owned by AppModel; close cancels reads/subscriptions. No polling.
import { effect, signal, type ReadonlySignal } from "@preact/signals-core";
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
  readonly hasMore?: ReadonlySignal<boolean>;
  more?(): Promise<void>;
  answer(id: string, text: string): Promise<Outcome<unknown>>;
  close?(): void;
}

export class HumanInbox implements PendingAdapter {
  readonly items = signal<PendingItem[]>([]);
  readonly error = signal<OpError | undefined>(undefined);
  readonly hasMore = signal(false);
  private cursor: string | undefined;
  private nextCursor: string | undefined;
  private cancel = new Cancel();
  private closed = false;
  private generation = 0;
  private stop: () => void;
  // At most the current page's 16*128 duties. Keep only unconfirmed outcomes
  // across rereads; never replace their receipt with a fresh mutation identity.
  private attempts = new Map<string, { text: string; operationId?: string; result?: Promise<Outcome<unknown>>; settled?: boolean }>();
  private refresher: Refresher;
  constructor(private readonly data: ShellboyData) {
    this.refresher = new Refresher(async (_, sent) => this.read(sent));
    this.stop = effect(() => {
      const owner = data.owner.value;
      const list = data.threadList.value;
      if (owner.state !== "connected" || list.loading || list.stale) {
        ++this.generation; this.cancel.cancel();
        this.items.value = [];
        return;
      }
      if (list.loaded) {
        this.cursor = undefined; // live keysets must restart on invalidation
        void this.refresher.requestFresh("human");
      }
    });
  }
  private async read(sent: () => void): Promise<void> {
    if (this.closed) return;
    const generation = ++this.generation;
    this.cancel.cancel(); this.cancel = new Cancel();
    const read = { cancel: this.cancel, onSent: sent };
    const page = await this.data.operations.threadList({ awaiting: "human", limit: HUMAN_PAGE_LIMIT, ...(this.cursor ? { cursor: this.cursor } : {}) }, read);
    if (this.closed || generation !== this.generation) return;
    if (!page.ok) { this.error.value = page.error; this.items.value = []; this.hasMore.value = false; return; }
    if (page.value.items.length > HUMAN_PAGE_LIMIT) { this.error.value = { kind: "invalid_response", message: "human inbox page exceeds its bound" }; this.items.value = []; return; }
    const items: PendingItem[] = [];
    for (const summary of page.value.items) {
      const detail = await this.data.operations.threadGet(summary.thread_id, read);
      if (this.closed || generation !== this.generation) return;
      if (!detail.ok) { this.error.value = detail.error; this.items.value = []; return; }
      if (!Array.isArray(detail.value.awaiting_replies) || detail.value.awaiting_replies.length > 128) {
        this.error.value = { kind: "invalid_response", message: "human reply projection is missing or exceeds its bound" };
        this.items.value = []; return;
      }
      const exact = summary.awaiting_human_count_exact !== false;
      for (const duty of threadReplyItems(summary.thread_id, detail.value.awaiting_replies)) {
        if (duty.recipient.kind !== "human") continue;
        items.push({ id: duty.id, threadId: summary.thread_id, threadTitle: summary.title, question: duty.question,
          askedAt: exact ? summary.awaiting_human_oldest_at ?? undefined : undefined,
          count: summary.awaiting_human_count, countExact: exact });
      }
    }
    this.error.value = undefined;
    this.nextCursor = page.value.next_cursor;
    this.hasMore.value = this.nextCursor !== undefined;
    this.items.value = items;
    const ids = new Set(items.map(i => i.id));
    for (const [id, attempt] of this.attempts) if (!ids.has(id) && attempt.settled && !attempt.operationId) this.attempts.delete(id);
  }
  async more(): Promise<void> {
    if (!this.nextCursor || this.closed) return;
    this.cursor = this.nextCursor;
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
  close(): void { this.closed = true; ++this.generation; this.cancel.cancel(); this.stop(); this.items.value = []; this.attempts.clear(); }
}
