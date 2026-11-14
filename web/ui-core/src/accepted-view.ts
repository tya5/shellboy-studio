// Local authority identity only: never decoded or reconstructed from wire fields.
declare const acceptedCapabilityBrand: unique symbol;
export type AcceptedCapability = Readonly<{ readonly [acceptedCapabilityBrand]: true }>;
declare const stagedBrand: unique symbol;
export type StagedView<T> = Readonly<{ readonly [stagedBrand]: T }>;

/** Materialize bounded plain data before qualification; no getters survive staging. */
function materialize<T>(value: T): T {
  let nodes = 0;
  const seen = new Set<object>();
  const copy = (v: unknown, depth: number): unknown => {
    if (++nodes > 65536 || depth > 64) throw new Error("accepted view staging bound exceeded");
    if (v === null || typeof v !== "object") {
      if (typeof v === "function" || typeof v === "symbol") throw new Error("accepted view requires plain data");
      return v;
    }
    if (seen.has(v)) throw new Error("accepted view requires acyclic data");
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("accepted view requires plain data");
    seen.add(v);
    const result = Array.isArray(v) ? v.map(item => copy(item, depth + 1)) : Object.fromEntries(Object.keys(v).map(key => [key, copy((v as Record<string, unknown>)[key], depth + 1)]));
    seen.delete(v);
    return Object.freeze(result);
  };
  return copy(value, 0) as T;
}

/** One current reference, one staged replacement, one coalesced notification slot. */
export class AcceptedView<T> {
  private value: T;
  private epoch = 0;
  private ended = false;
  private acceptedEpoch = 0;
  private capability = Object.freeze({}) as AcceptedCapability;
  private staged?: { handle: StagedView<T>; expected: T; epoch: number; capability: AcceptedCapability; value?: T };
  private listeners = new Set<(value: T) => void>();
  private notifying = false;
  private pending = false;
  private scheduled = false;
  constructor(initial: T) { this.value = materialize(initial); }
  get current(): T { return this.value; }
  peek(): T { return this.value; }
  isCurrent(ref: T): boolean { return !this.ended && this.value === ref && this.epoch === this.acceptedEpoch; }
  get currentCapability(): AcceptedCapability { return this.capability; }
  stage(value: T, capability: AcceptedCapability = this.capability): StagedView<T> {
    const handle = Object.freeze({}) as StagedView<T>;
    const slot = { handle, expected: this.value, epoch: this.epoch, capability, value: undefined as T | undefined };
    this.staged = slot;
    slot.value = materialize(value);
    return handle;
  }
  commit(handle: StagedView<T>): boolean {
    const slot = this.staged;
    if (!slot || slot.handle !== handle || slot.value === undefined || this.ended) return false;
    // Only private materialized fields are read between this check and the swap.
    if (this.staged !== slot || this.capability !== slot.capability || this.epoch !== slot.epoch || this.value !== slot.expected || this.ended) return false;
    this.staged = undefined;
    this.value = slot.value;
    ++this.epoch;
    this.acceptedEpoch = this.epoch;
    this.pending = true;
    this.notify();
    return true;
  }
  subscribe(listener: (value: T) => void): () => void {
    if (this.ended) return () => {};
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  /** Revoke before cancellation/other external callbacks, without replacing display. */
  invalidate(): void { this.capability = Object.freeze({}) as AcceptedCapability; ++this.epoch; this.staged = undefined; this.pending = false; }
  revoke(): void { this.invalidate(); }
  dispose(): void { this.ended = true; this.invalidate(); this.listeners.clear(); }
  private notify(): void {
    if (this.notifying || this.ended) return;
    this.notifying = true;
    try {
      // One synchronous trailing generation; further reentry uses one microtask slot.
      for (let pass = 0; pass < 2 && this.pending && !this.ended; pass++) {
        this.pending = false;
        const value = this.value, epoch = this.epoch;
        for (const listener of [...this.listeners]) {
          if (this.ended || this.epoch !== epoch) break;
          if (this.listeners.has(listener)) listener(value);
        }
      }
    } finally {
      this.notifying = false;
      if (this.pending && !this.ended && !this.scheduled) {
        this.scheduled = true;
        queueMicrotask(() => { this.scheduled = false; if (!this.ended) this.notify(); });
      }
    }
  }
}
