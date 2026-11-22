import { signal, type ReadonlySignal } from "@preact/signals-core";
import { Cancel, MAX_LIST_ROWS, type AttachmentDetails, type Handle, type ShellboyData } from "../../data/src";

export const ATTACHMENT_RETENTION = MAX_LIST_ROWS;
type Section = { items: readonly AttachmentDetails[]; cursor?: string; loading: boolean; error?: string; capped?: boolean; complete?: boolean };

/** One visible Thread section. Each hint rebuilds the loaded prefix before publishing it. */
export class AttachmentSection {
  private readonly stateSignal = signal<Section>({ items: [], loading: false });
  readonly state: ReadonlySignal<Section> = this.stateSignal;
  private session?: { threadId: string; owner: ReturnType<ShellboyData["owner"]["peek"]>; watch: Handle; read?: Cancel; pages: number };

  constructor(private readonly data: ShellboyData) {}

  observe(threadId: string): () => void {
    this.close();
    const watch = this.data.watchHints(threadId, () => { if (this.session === session) void this.read(); });
    const session = { threadId, owner: this.data.owner.peek(), watch, pages: 1 };
    this.session = session;
    void this.read();
    return () => { if (this.session === session) this.close(); };
  }

  close(): void {
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    session.watch.close();
    session.read?.cancel();
    this.stateSignal.value = { items: [], loading: false };
  }

  more(): void {
    const { cursor, loading } = this.stateSignal.peek();
    if (cursor !== undefined && !loading) void this.read(cursor);
  }

  private async read(appendCursor?: string): Promise<void> {
    const session = this.session;
    if (!session || this.data.owner.peek() !== session.owner) return;
    session.read?.cancel();
    const cancel = new Cancel();
    session.read = cancel;
    const previous = this.stateSignal.peek();
    this.stateSignal.value = { ...previous, loading: true, error: undefined };
    const current = () => this.session === session && session.read === cancel && this.data.owner.peek() === session.owner;
    const items = appendCursor === undefined ? [] : [...previous.items];
    const ids = new Set(items.map(row => row.attachment_id));
    const cursors = new Set<string>();
    let cursor = appendCursor;
    let capped = false;
    const pages = appendCursor === undefined ? session.pages : 1;
    const fail = (error: string, invalidateCursor: boolean) => {
      session.read = undefined;
      this.stateSignal.value = { ...previous, cursor: invalidateCursor ? undefined : previous.cursor, complete: false, loading: false, error };
    };
    for (let i = 0; i < pages; i++) {
      if (cursor !== undefined) cursors.add(cursor);
      const result = await this.data.operations.attachmentList(session.threadId, cursor, { cancel });
      if (!current()) return;
      if (!result.ok) {
        // Only Core can invalidate the continuation of the retained cut.
        const expired = result.error.kind === "owner" && result.error.code === "cursor_expired";
        fail(result.error.message, expired);
        return;
      }
      const page = result.value;
      cursor = page.next_cursor;
      if ((cursor !== undefined && (!page.items.length || cursors.has(cursor))) || page.items.some(row => ids.has(row.attachment_id))) {
        fail("Invalid attachment continuation", false); return;
      }
      const remaining = ATTACHMENT_RETENTION - items.length;
      capped = page.items.length > remaining || (page.items.length === remaining && cursor !== undefined);
      for (const row of page.items.slice(0, remaining)) { ids.add(row.attachment_id); items.push(row); }
      if (cursor === undefined || capped) break;
    }
    session.read = undefined;
    if (appendCursor !== undefined) session.pages++;
    this.stateSignal.value = { items, loading: false, cursor: capped ? undefined : cursor, capped, complete: cursor === undefined && !capped };
  }
}
