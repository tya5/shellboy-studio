import { signal } from "@preact/signals-core";
import { Cancel } from "./operations";
import type { PendingReply } from "./protocol";
import type { ShellboyData } from "./store";

export type ReplySide = "owed_by" | "asked_by";
type ReplyPage = { items: PendingReply[]; cursor?: string; loading: boolean; complete: boolean; error?: string };
const empty = (): ReplyPage => ({ items: [], loading: false, complete: false });
const MAX_RETAINED = 128;

/** The selected Thread owns at most one bounded retained prefix per direction. */
export class ReplyPages {
  readonly owed_by = signal(empty());
  readonly asked_by = signal(empty());
  constructor(private readonly data: ShellboyData) {}
  private reads: Partial<Record<ReplySide, Cancel>> = {};
  private thread?: string;
  private closeWatch?: () => void;
  private pages: Record<ReplySide, number> = { owed_by: 1, asked_by: 1 };

  observe(thread: string): () => void {
    this.close();
    this.thread = thread;
    this.pages = { owed_by: 1, asked_by: 1 };
    const watch = this.data.watchHints(thread, () => this.refresh());
    this.closeWatch = () => watch.close();
    this.refresh();
    return () => this.close();
  }

  close(): void {
    this.closeWatch?.();
    this.closeWatch = undefined;
    this.thread = undefined;
    for (const side of ["owed_by", "asked_by"] as const) {
      this.reads[side]?.cancel();
      this[side].value = empty();
    }
    this.reads = {};
  }

  private refresh(): void {
    void this.read("owed_by", undefined, this.pages.owed_by);
    void this.read("asked_by", undefined, this.pages.asked_by);
  }

  more(side: ReplySide): void {
    const { cursor, loading } = this[side].peek();
    if (cursor && !loading) void this.read(side, cursor, 1);
  }

  private async read(side: ReplySide, cursor?: string, pageCount = 1): Promise<void> {
    const thread = this.thread;
    const owner = this.data.owner.peek();
    if (!thread || owner.state !== "connected") return;
    this.reads[side]?.cancel();
    const cancel = new Cancel();
    this.reads[side] = cancel;
    const previous = this[side].peek();
    this[side].value = { ...previous, loading: true, error: undefined, complete: false };
    const old = cursor ? previous.items : [];
    const items = [...old];
    const ids = new Set(old.map(item => item.message_id));
    const cursors = new Set<string>();
    let next = cursor;
    for (let page = 0; page < pageCount; page++) {
      const out = await this.data.operations.messageList(side === "owed_by" ? { owed_by: thread } : { asked_by: thread }, next, { cancel });
      if (cancel.cancelled || this.reads[side] !== cancel || this.thread !== thread || this.data.owner.peek() !== owner) return;
      if (!out.ok) {
        delete this.reads[side];
        this[side].value = { ...previous, loading: false, error: out.error.message };
        return;
      }
      const pageItems = out.value.items;
      next = out.value.next_cursor;
      if ((next !== undefined && (!pageItems.length || cursors.has(next))) || pageItems.some(item => ids.has(item.message_id))) {
        delete this.reads[side];
        this[side].value = { ...previous, loading: false, error: "Invalid reply continuation" };
        return;
      }
      if (next !== undefined) cursors.add(next);
      for (const item of pageItems) { ids.add(item.message_id); items.push(item); }
      if (next === undefined || items.length >= MAX_RETAINED) break;
    }
    if (cancel.cancelled || this.reads[side] !== cancel || this.thread !== thread || this.data.owner.peek() !== owner) return;
    delete this.reads[side];
    if (cursor === undefined) this.pages[side] = pageCount;
    else if (next !== cursor) this.pages[side] += 1;
    const retained = items.slice(0, MAX_RETAINED);
    this[side].value = { items: retained, cursor: retained.length < MAX_RETAINED ? next : undefined,
      loading: false, complete: next === undefined };
  }
}
