import { signal } from "@preact/signals-core";
import { ATTACHMENT_PAGE_SIZE, Cancel, type AttachmentDetails, type Handle, type ShellboyData } from "../../data/src";

const MAX_ROWS = ATTACHMENT_PAGE_SIZE * 4;
type Section = { items: readonly AttachmentDetails[]; cursor?: string; loading: boolean; error?: string; capped?: boolean };

/** One visible Thread section, one read at a time. A hint invalidates the cursor chain. */
export class AttachmentSection {
  private readonly stateSignal = signal<Section>({ items: [], loading: false });
  readonly state = this.stateSignal as import("@preact/signals-core").ReadonlySignal<Section>;
  private session?: { threadId: string; owner: ReturnType<ShellboyData["owner"]["peek"]>; watch: Handle; read?: Cancel };

  constructor(private readonly data: ShellboyData) {}

  observe(threadId: string): () => void {
    this.close();
    const watch = this.data.watchHints(threadId, () => { if (this.session === session) void this.read(); });
    const session = { threadId, owner: this.data.owner.peek(), watch };
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

  private async read(cursor?: string): Promise<void> {
    const session = this.session;
    if (!session || this.data.owner.peek() !== session.owner) return;
    session.read?.cancel();
    const cancel = new Cancel();
    session.read = cancel;
    const items = this.stateSignal.peek().items;
    this.stateSignal.value = { items, loading: true };
    const result = await this.data.operations.attachmentList(session.threadId, cursor, { cancel });
    if (this.session !== session || session.read !== cancel || this.data.owner.peek() !== session.owner) return;
    session.read = undefined;
    if (!result.ok) {
      this.stateSignal.value = { items, loading: false, error: result.error.message };
      return;
    }
    const page = result.value;
    const ids = new Set(items.map(row => row.attachment_id));
    if (cursor !== undefined && (page.next_cursor === cursor || page.items.some(row => ids.has(row.attachment_id)))) {
      this.stateSignal.value = { items, loading: false, error: "Invalid attachment continuation" };
      return;
    }
    const next = cursor === undefined ? page.items : [...items, ...page.items];
    const capped = next.length >= MAX_ROWS && page.next_cursor !== undefined;
    this.stateSignal.value = { items: next.slice(0, MAX_ROWS), loading: false, cursor: capped ? undefined : page.next_cursor, capped };
  }
}
