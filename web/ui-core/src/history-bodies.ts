import { Cancel } from "../../data/src";
import { RetainedBudget, retainedStringBytes, type RetainedReservation } from "../../data/src/retained-budget";
import { batch, signal } from "@preact/signals-core";

export interface BodyState {
  text: string | undefined;
  loading: boolean;
  error: string | undefined;
  continuation?: string;
  budgetLimited?: boolean;
}

export interface BodyLocation { nodeId: string; ordinal: number | undefined }

export class RetainedBodies {
  private readonly changed = signal(0);
  private readonly entries = new Map<string, { body: BodyState; reservation: RetainedReservation }>();
  private readonly pins = new Map<string, { count: number; unpin?: () => void }>();
  constructor(private readonly budget: RetainedBudget) {}
  get(key: string) { this.changed.value; return this.peek(key); }
  peek(key: string) { return this.entries.get(key)?.body; }
  touch(key: string) { this.entries.get(key)?.reservation.touch(); }
  set(key: string, body: BodyState | undefined): boolean {
    return batch(() => {
      const existing = this.entries.get(key);
      if (!body) {
        if (!existing) return true;
        existing.reservation.release();
        this.entries.delete(key);
      } else {
        const bytes = 64 + retainedStringBytes(key) + [body.text, body.error, body.continuation].reduce((n, s) => n + (s === undefined ? 0 : retainedStringBytes(s)), 0);
        if (existing) {
          if (!existing.reservation.resize(bytes)) return false;
          existing.body = body;
        } else {
          const reservation = this.budget.reserve(bytes, () => {
            this.entries.delete(key);
            this.changed.value++;
          });
          if (!reservation) return false;
          this.entries.set(key, { body, reservation });
          const pin = this.pins.get(key);
          if (pin) pin.unpin = reservation.pin();
        }
      }
      this.changed.value++;
      return true;
    });
  }
  pin(key: string): () => void {
    const pin = this.pins.get(key) ?? { count: 0, unpin: this.entries.get(key)?.reservation.pin() };
    this.pins.set(key, pin);
    pin.count++;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (--pin.count !== 0 || this.pins.get(key) !== pin) return;
      this.pins.delete(key);
      pin.unpin?.();
    };
  }
  clear() {
    batch(() => {
      for (const { reservation } of this.entries.values()) reservation.release();
      this.entries.clear();
      this.pins.clear();
      this.changed.value++;
    });
  }
}

/** Per-view read lifetime; saved bodies are shared across window and detail views. */
export class HistoryBodies {
  readonly reads = new Map<string, { position: BodyLocation; manualAuthorized: boolean; cancel: Cancel }>();
  private closed = false;
  constructor(private readonly store: RetainedBodies) {}
  static key(nodeId: string, variant?: string) { return JSON.stringify([nodeId, variant]); }
  get(nodeId: string, variant?: string) { return this.store.get(HistoryBodies.key(nodeId, variant)); }
  peek(key: string) { return this.store.peek(key); }
  touch(key: string) { this.store.touch(key); }
  pin(key: string) { return this.store.pin(key); }
  set(key: string, body: BodyState | undefined) { return !this.closed && this.store.set(key, body); }
  reconcile(ordinalOf: (position: BodyLocation) => number | undefined) {
    for (const [key, read] of this.reads) {
      const ordinal = ordinalOf(read.position);
      if (ordinal !== undefined) { read.position.ordinal = ordinal; continue; }
      read.cancel.cancel();
      this.reads.delete(key);
    }
  }
  dispose() {
    this.reconcile(() => undefined);
    this.closed = true;
  }
}
