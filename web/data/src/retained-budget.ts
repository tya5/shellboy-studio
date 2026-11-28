import { batch, signal, type ReadonlySignal } from "@preact/signals-core";

export const DEFAULT_RETAINED_BYTES = 64 * 1024 * 1024;
const ENTRY_BYTES = 96;
const encoder = new TextEncoder();

export function retainedStringBytes(value: string): number {
  return 32 + Math.max(value.length * 2, encoder.encode(value).byteLength);
}

interface Entry {
  bytes: number;
  pins: number;
  live: boolean;
  evict: () => void;
}

export interface RetainedReservation {
  touch(): void;
  resize(bytes: number): boolean;
  pin(): () => void;
  release(): void;
}

/** One admission and LRU owner. Charge callers' payloads before publishing them. */
export class RetainedBudget {
  private readonly evictable = new Set<Entry>();
  private used = 0;
  private pinned = 0;
  private readonly counts = signal({ used: 0, pinned: 0 });
  readonly usage: ReadonlySignal<{ used: number; pinned: number }> = this.counts;

  constructor(private limit = DEFAULT_RETAINED_BYTES) {
    this.check(limit);
  }

  setLimit(bytes: number): void {
    this.check(bytes);
    batch(() => {
      this.limit = bytes;
      this.trim(0);
      this.publish();
    });
  }

  reserve(bytes: number, evict: () => void): RetainedReservation | undefined {
    this.check(bytes);
    const entry: Entry = { bytes: bytes + ENTRY_BYTES, pins: 0, live: true, evict };
    return batch(() => {
      if (!this.makeRoom(entry.bytes)) return;
      this.used += entry.bytes;
      this.evictable.add(entry);
      this.publish();
      return {
        touch: () => this.touch(entry),
        resize: size => this.resize(entry, size),
        pin: () => this.pin(entry),
        release: () => batch(() => { this.remove(entry); this.publish(); }),
      };
    });
  }

  private check(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > Number.MAX_SAFE_INTEGER - ENTRY_BYTES) {
      throw new RangeError("Invalid retained byte count");
    }
  }

  private publish(): void {
    const old = this.counts.peek();
    if (old.used !== this.used || old.pinned !== this.pinned) this.counts.value = { used: this.used, pinned: this.pinned };
  }

  private makeRoom(bytes: number, except?: Entry): boolean {
    const committed = this.pinned + (except && !except.pins ? except.bytes : 0);
    if (bytes > this.limit - committed) return false;
    this.trim(bytes, except);
    return this.used + bytes <= this.limit;
  }

  private trim(bytes: number, except?: Entry): void {
    const removed: Entry[] = [];
    for (const entry of this.evictable) {
      if (this.used + bytes <= this.limit) break;
      if (entry === except) continue;
      this.remove(entry);
      removed.push(entry);
    }
    for (const entry of removed) entry.evict();
  }

  private remove(entry: Entry): void {
    if (!entry.live) return;
    entry.live = false;
    this.used -= entry.bytes;
    if (entry.pins) this.pinned -= entry.bytes;
    this.evictable.delete(entry);
  }

  private touch(entry: Entry): void {
    if (entry.live && !entry.pins) {
      this.evictable.delete(entry);
      this.evictable.add(entry);
    }
  }

  private resize(entry: Entry, bytes: number): boolean {
    this.check(bytes);
    return batch(() => {
      if (!entry.live) return false;
      const delta = bytes + ENTRY_BYTES - entry.bytes;
      if (delta > 0 && (!this.makeRoom(delta, entry) || !entry.live)) return false;
      entry.bytes += delta;
      this.used += delta;
      if (entry.pins) this.pinned += delta;
      this.touch(entry);
      this.publish();
      return true;
    });
  }

  private pin(entry: Entry): () => void {
    if (!entry.live) return () => {};
    if (entry.pins++ === 0) {
      this.evictable.delete(entry);
      this.pinned += entry.bytes;
      this.publish();
    }
    let held = true;
    return () => batch(() => {
      if (!held || !entry.live) return;
      held = false;
      if (--entry.pins === 0) {
        this.pinned -= entry.bytes;
        this.evictable.add(entry);
        this.trim(0);
        this.publish();
      }
    });
  }
}
