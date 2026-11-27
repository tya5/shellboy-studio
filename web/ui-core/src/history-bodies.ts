import { signal } from "@preact/signals-core";

export interface BodyState {
  text: string | undefined;
  loading: boolean;
  error: string | undefined;
}

/** Fetched bodies for one reader lifetime, not a cache shared between readers. */
export class HistoryBodies {
  private readonly entries = signal<ReadonlyMap<string, BodyState>>(new Map());
  readonly reads = new Map<string, { manualAuthorized: boolean }>();
  private closed = false;
  constructor(private readonly limit: number) {}
  get(key: string) { return this.entries.value.get(key); }
  peek(key: string) { return this.entries.peek().get(key); }
  set(key: string, body: BodyState | undefined) {
    if (this.closed) return;
    const next = new Map(this.entries.peek());
    next.delete(key);
    if (body !== undefined) next.set(key, body);
    while (next.size > this.limit) next.delete(next.keys().next().value!);
    this.entries.value = next;
  }
  dispose() {
    this.closed = true;
    this.reads.clear();
    this.entries.value = new Map();
  }
}
