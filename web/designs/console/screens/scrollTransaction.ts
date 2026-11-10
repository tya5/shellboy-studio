/** Local normalized seam; not a producer wire type or a connected Window adapter. */
export interface ScrollRequest {
  readonly id: object;
  readonly target: number;
}
export interface ScrollViewPort<View extends object> {
  readonly acceptedView: { peek(): View; isCurrent(ref: View): boolean };
  peekScroll(ref: View): ScrollRequest | undefined;
  consumeScroll(ref: View, id: object): boolean;
}
export interface ScrollCommitPlan {
  /** G-owned, callback-free consumption of a previously peeked heading/intent plan. */
  consume(): void;
  write(): void;
  capture(): void;
}
export interface ScrollSyncEffects<View extends object> {
  measure(ref: View): void;
  plan(ref: View, request: ScrollRequest | undefined): ScrollCommitPlan;
}
export type ScrollSyncResult = 'committed' | 'obsolete' | 'busy' | 'disposed' | 'rejected';

/** One synchronous writer and one coalesced resync bit; no queue, timer or task. */
export class CurrentScrollSync {
  private epoch = 0;
  private disposed = false;
  private active: { interrupted: boolean } | undefined;
  private resync = false;
  dispose(): void { this.disposed = true; this.cancel(); }
  cancel(): void { this.epoch++; this.resync = false; }
  takeResync(): boolean {
    const pending = !this.disposed && this.resync;
    this.resync = false;
    return pending;
  }
  run<View extends object>(port: ScrollViewPort<View>, effects: ScrollSyncEffects<View>): ScrollSyncResult {
    if (this.disposed) return 'disposed';
    if (this.active) {
      this.active.interrupted = true;
      this.resync = true;
      return 'busy';
    }
    const active = { interrupted: false }, epoch = this.epoch;
    this.active = active;
    this.resync = false;
    try {
      const ref = port.acceptedView.peek();
      const current = () => !this.disposed && epoch === this.epoch &&
        !active.interrupted && port.acceptedView.isCurrent(ref);
      const obsolete = (): ScrollSyncResult => {
        // Scope cancellation/disposal owns its own restart policy.
        if (!this.disposed && epoch === this.epoch) this.resync = true;
        return 'obsolete';
      };
      if (!current()) return obsolete();
      const request = port.peekScroll(ref);
      if (!current()) return obsolete();
      effects.measure(ref);
      if (!current()) return obsolete();
      const plan = effects.plan(ref, request);
      if (!current()) return obsolete();
      // Both consumes are callback-free. A successful request consume preserves ref/epoch.
      if (request && !port.consumeScroll(ref, request.id)) return 'rejected';
      plan.consume();
      if (!current()) return obsolete();
      plan.write();
      if (!current()) return obsolete();
      plan.capture();
      return 'committed';
    } finally {
      if (this.active === active) this.active = undefined;
    }
  }
}
