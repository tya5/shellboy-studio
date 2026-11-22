import { signal, type ReadonlySignal } from "@preact/signals-core";
import type { Outcome } from "./errors";
import { Cancel } from "./operations";
import type { ArtifactSummary, ArtifactVersionStamp, Page } from "./protocol";
import { MAX_LIST_ROWS, type ShellboyData } from "./store";

interface Cut<T, Header> {
  items: readonly T[];
  header?: Header;
  cursor?: string;
  loading: boolean;
  error?: string;
  capped?: boolean;
}

type Load<T, Header> = (cursor: string | undefined, cancel: Cancel) => Promise<Outcome<{ page: Page<T>; header?: Header }>>;

/** Owns one displayed prefix of an owner-ordered artifact list or version history. */
class ArtifactPages<T, Header = never> {
  private readonly view = signal<Cut<T, Header>>({ items: [], loading: false });
  readonly state: ReadonlySignal<Cut<T, Header>> = this.view;
  private session?: { owner: ReturnType<ShellboyData["owner"]["peek"]>; load: Load<T, Header>; pages: number; close: () => void; read?: Cancel };

  constructor(private readonly data: ShellboyData, private readonly key: (row: T) => string | number) {}

  observe(thread: string, load: Load<T, Header>): () => void {
    this.close();
    const watch = this.data.watchHints(thread, () => { if (this.session === session) void this.read(); });
    const session = { owner: this.data.owner.peek(), load, pages: 1, close: () => watch.close() };
    this.session = session;
    void this.read();
    return () => { if (this.session === session) this.close(); };
  }

  close(): void {
    const session = this.session;
    this.session = undefined;
    session?.close();
    session?.read?.cancel();
    this.view.value = { items: [], loading: false };
  }

  more(): void {
    const { cursor, loading } = this.view.peek();
    if (cursor !== undefined && !loading) void this.read(cursor);
  }

  private async read(append?: string): Promise<void> {
    const session = this.session;
    if (!session || this.data.owner.peek() !== session.owner) return;
    session.read?.cancel();
    const cancel = session.read = new Cancel();
    const previous = this.view.peek();
    this.view.value = { ...previous, loading: true, error: undefined };
    const items = append === undefined ? [] : [...previous.items];
    const keys = new Set(items.map(this.key));
    const cursors = new Set<string>();
    let cursor = append;
    let header = append === undefined ? undefined : previous.header;
    let capped = false;
    for (let i = 0; i < (append === undefined ? session.pages : 1); i++) {
      if (cursor !== undefined) cursors.add(cursor);
      const result = await session.load(cursor, cancel);
      if (this.session !== session || session.read !== cancel || this.data.owner.peek() !== session.owner) return;
      if (!result.ok) {
        session.read = undefined;
        const expired = result.error.kind === "owner" && result.error.code === "cursor_expired";
        this.view.value = append === undefined ? { items: [], loading: false, error: result.error.message }
          : { ...previous, cursor: expired ? undefined : previous.cursor, loading: false, error: result.error.message };
        return;
      }
      if (i === 0 && append === undefined) header = result.value.header;
      const page = result.value.page;
      cursor = page.next_cursor;
      if ((cursor !== undefined && (!page.items.length || cursors.has(cursor))) || page.items.some(row => keys.has(this.key(row)))) {
        session.read = undefined;
        this.view.value = { items: [], loading: false, error: "Invalid artifact continuation" };
        return;
      }
      const remaining = MAX_LIST_ROWS - items.length;
      for (const row of page.items.slice(0, remaining)) { keys.add(this.key(row)); items.push(row); }
      capped = page.items.length > remaining || (items.length === MAX_LIST_ROWS && cursor !== undefined);
      if (capped || cursor === undefined) break;
    }
    session.read = undefined;
    if (append !== undefined) session.pages++;
    this.view.value = { items, header, cursor: capped ? undefined : cursor, capped, loading: false };
  }
}

export class ArtifactObservation {
  readonly list: ArtifactPages<ArtifactSummary>;
  readonly history: ArtifactPages<ArtifactVersionStamp, ArtifactSummary>;

  constructor(private readonly data: ShellboyData) {
    this.list = new ArtifactPages(data, row => row.artifact_id);
    this.history = new ArtifactPages(data, row => row.version);
  }

  observeList(thread: string): () => void {
    return this.list.observe(thread, async (cursor, cancel) => {
      const out = await this.data.operations.artifactList(thread, cursor, { cancel });
      return out.ok ? { ok: true, value: { page: out.value } } : out;
    });
  }

  observeHistory(thread: string, artifact: string): () => void {
    return this.history.observe(thread, async (cursor, cancel) => {
      const out = await this.data.operations.artifactHistory(thread, artifact, cursor, { cancel });
      if (!out.ok) return out;
      const { versions: page, ...header } = out.value;
      return { ok: true, value: { page, header } };
    });
  }

  close(): void { this.list.close(); this.history.close(); }
}
