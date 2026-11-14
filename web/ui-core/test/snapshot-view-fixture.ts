/** Generic publication fixture for scroll/reentry tests that do not model ConversationDisplayPlan. */
export class SnapshotViewFixture<T> {
  private value: T;
  private epoch = 0;
  private ended = false;
  private acceptedEpoch = 0;
  private capability = Object.freeze({});
  private staged?: { handle: object; expected: T; epoch: number; capability: object; value?: T };
  private listeners = new Set<(value: T) => void>();
  private notifying = false;
  private pending = false;
  private scheduled = false;
  constructor(initial: T) { this.value = this.copy(initial); }
  get current(): T { return this.value; }
  peek(): T { return this.value; }
  isCurrent(ref: T): boolean { return !this.ended && this.value === ref && this.epoch === this.acceptedEpoch; }
  stage(value: T, capability = this.capability): object {
    const handle = Object.freeze({});
    const slot = { handle, expected: this.value, epoch: this.epoch, capability, value: undefined as T | undefined };
    this.staged = slot; slot.value = this.copy(value); return handle;
  }
  commit(handle: object): boolean {
    const slot = this.staged;
    if (!slot || slot.handle !== handle || slot.value === undefined || this.ended || this.capability !== slot.capability
      || this.epoch !== slot.epoch || this.value !== slot.expected) return false;
    this.staged = undefined; this.value = slot.value; ++this.epoch; this.acceptedEpoch = this.epoch; this.pending = true; this.notify(); return true;
  }
  subscribe(listener: (value: T) => void): () => void { if (this.ended) return () => {}; this.listeners.add(listener); return () => this.listeners.delete(listener); }
  revoke(): void { this.capability = Object.freeze({}); ++this.epoch; this.staged = undefined; this.pending = false; }
  dispose(): void { this.ended = true; this.revoke(); this.listeners.clear(); }
  private copy<TValue>(value: TValue): TValue {
    let count = 0; const seen = new Set<object>();
    const clone = (v: unknown, depth: number): unknown => {
      if (++count > 65536 || depth > 64) throw new Error("accepted view staging bound exceeded");
      if (v === null || typeof v !== "object") return v;
      if (seen.has(v)) throw new Error("accepted view requires acyclic data");
      if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("accepted view requires plain data");
      seen.add(v); const out = Array.isArray(v) ? v.map(x => clone(x, depth + 1)) : Object.fromEntries(Object.keys(v).map(k => [k, clone((v as Record<string, unknown>)[k], depth + 1)]));
      seen.delete(v); return Object.freeze(out);
    };
    return clone(value, 0) as TValue;
  }
  private notify(): void {
    if (this.notifying || this.ended) return; this.notifying = true;
    try { for (let pass = 0; pass < 2 && this.pending && !this.ended; pass++) { this.pending = false; const value = this.value, epoch = this.epoch;
      for (const listener of [...this.listeners]) { if (this.ended || this.epoch !== epoch) break; if (this.listeners.has(listener)) listener(value); }
    } } finally { this.notifying = false; if (this.pending && !this.ended && !this.scheduled) { this.scheduled = true; queueMicrotask(() => { this.scheduled = false; if (!this.ended) this.notify(); }); } }
  }
}
