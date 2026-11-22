import { signal } from "@preact/signals-core";
import { Cancel } from "./operations";
import type { PendingReply } from "./protocol";
import type { ShellboyData } from "./store";

export type ReplySide = "owed_by" | "asked_by";
type ReplyPage = { items: PendingReply[]; cursor?: string; loading: boolean; complete: boolean };
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

  observe(thread: string): () => void {
    this.close();
    this.thread = thread;
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
    void this.read("owed_by");
    void this.read("asked_by");
  }

  more(side: ReplySide): void {
    const { cursor, loading } = this[side].peek();
    if (cursor && !loading) void this.read(side, cursor);
  }

  private async read(side: ReplySide, cursor?: string): Promise<void> {
    const thread = this.thread;
    const owner = this.data.owner.peek();
    if (!thread || owner.state !== "connected") return;
    this.reads[side]?.cancel();
    const cancel = new Cancel();
    this.reads[side] = cancel;
    const previous = this[side].peek();
    this[side].value = { ...previous, loading: true, complete: false };
    const out = await this.data.operations.messageList(side === "owed_by" ? { owed_by: thread } : { asked_by: thread }, cursor, { cancel });
    if (cancel.cancelled || this.reads[side] !== cancel || this.thread !== thread || this.data.owner.peek() !== owner) return;
    delete this.reads[side];
    if (!out.ok) { this[side].value = empty(); return; }
    const old = cursor ? previous.items : [];
    const ids = new Set(old.map(item => item.message_id));
    const items = [...old, ...out.value.items.filter(item => !ids.has(item.message_id))].slice(0, MAX_RETAINED);
    const next = out.value.next_cursor;
    this[side].value = { items, cursor: items.length < MAX_RETAINED && next !== cursor ? next : undefined,
      loading: false, complete: next === undefined && items.length === old.length + out.value.items.length };
  }
}
