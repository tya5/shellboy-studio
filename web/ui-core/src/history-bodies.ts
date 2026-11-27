import { Cancel } from "../../data/src";
import { signal } from "@preact/signals-core";

export interface BodyState {
  text: string | undefined;
  loading: boolean;
  error: string | undefined;
}

export interface BodyLocation { nodeId: string; ordinal: number | undefined }

/** Fetched bodies for one reader lifetime, not a cache shared between readers. */
export class HistoryBodies {
  private readonly entries = signal<ReadonlyMap<string, { position: BodyLocation; body: BodyState }>>(new Map());
  readonly reads = new Map<string, { position: BodyLocation; manualAuthorized: boolean; cancel: Cancel }>();
  private closed = false;
  constructor(private readonly limit: number) {}
  static key(nodeId: string, variant?: string) { return JSON.stringify([nodeId, variant]); }
  get(nodeId: string, variant?: string) { return this.entries.value.get(HistoryBodies.key(nodeId, variant))?.body; }
  peek(key: string) { return this.entries.peek().get(key)?.body; }
  set(key: string, position: BodyLocation, body: BodyState | undefined) {
    if (this.closed) return;
    const next = new Map(this.entries.peek());
    next.delete(key);
    if (body !== undefined) next.set(key, { position, body });
    while (next.size > this.limit) next.delete(next.keys().next().value!);
    this.entries.value = next;
  }
  reconcile(ordinalOf: (position: BodyLocation) => number | undefined) {
    for (const [key, read] of this.reads) {
      const ordinal = ordinalOf(read.position);
      if (ordinal !== undefined) { read.position.ordinal = ordinal; continue; }
      this.reads.delete(key);
      read.cancel.cancel();
    }
    const entries = this.entries.peek();
    let next: Map<string, { position: BodyLocation; body: BodyState }> | undefined;
    for (const [key, { position }] of entries) {
      const ordinal = ordinalOf(position);
      if (ordinal === undefined) (next ??= new Map(entries)).delete(key);
      else position.ordinal = ordinal;
    }
    if (next) this.entries.value = next;
  }
  dispose() {
    this.closed = true;
    for (const read of this.reads.values()) read.cancel.cancel();
    this.reads.clear();
    this.entries.value = new Map();
  }
}
