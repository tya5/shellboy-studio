import { AcceptedView } from "./accepted-view";
import type { ThreadHandle, ThreadReadQualification, AttemptPresentation } from "../../data/src/store";
import type { HistoryItem } from "../../data/src/protocol";
import type { HandoffRecord, TerminalPersistedProof } from "../../data/src/handoff";

export interface LegacyPresentationSnapshot {
  readonly scope: string;
  readonly rows: readonly HistoryItem[];
  readonly live: readonly HandoffRecord[];
  readonly attemptPresentations: readonly AttemptPresentation[];
  readonly terminalPersistedAttempts: readonly TerminalPersistedProof[];
}

/** One owned legacy view: no window capability, revision, reads or reconstructed order. */
export class LegacyAcceptedPresentation {
  readonly acceptedView: AcceptedView<LegacyPresentationSnapshot>;
  private readonly token: ThreadReadQualification | undefined;
  private readonly scope: string;
  private ended = false;
  private syncing = false;
  constructor(private readonly handle: ThreadHandle) {
    this.scope = handle.handoffScope();
    this.token = handle.captureReadQualification();
    this.acceptedView = new AcceptedView<LegacyPresentationSnapshot>({ scope: this.scope, rows: [], live: [], attemptPresentations: [], terminalPersistedAttempts: [] });
  }
  private qualified(): boolean {
    return !this.ended && !!this.token && this.handle.isReadQualificationCurrent(this.token) && this.handle.handoffScope() === this.scope;
  }
  isCurrent(ref: LegacyPresentationSnapshot): boolean {
    return this.qualified() && this.acceptedView.isCurrent(ref);
  }
  sync(): boolean {
    if (!this.qualified() || this.syncing) return false;
    this.syncing = true;
    try {
      const previous = this.acceptedView.peek();
      const done = previous.terminalPersistedAttempts;
      const next: LegacyPresentationSnapshot = { scope: this.scope, rows: this.handle.history.peek().items,
        live: this.handle.handoff.peek(), attemptPresentations: this.handle.attemptPresentations.peek()
          .filter(f => !done.some(p => p.scope === f.scope && p.attemptId === f.attemptId)), terminalPersistedAttempts: done };
      for (const record of this.handle.handoff.peek()) {
        if (!record.terminalPersisted || record.transferred) continue;
        this.handle.transferHandoff(record.attemptId, (captured, release) => {
          const proof = captured.terminalPersisted, expected = this.acceptedView.peek();
          if (!proof || !this.isCurrent(expected) || proof.scope !== this.scope || proof.attemptId !== captured.attemptId
            || !["completed", "failed", "incomplete", "cancelled"].includes(proof.terminalState)
            || !proof.nodeIds.length || proof.nodeIds.length > 64 || proof.nodeIds.some(id => !id)) return false;
          const old = expected.terminalPersistedAttempts;
          if (old.length >= 8 && !old.some(p => p.attemptId === proof.attemptId)) return false;
          const terminal = [...old.filter(p => p.attemptId !== proof.attemptId), proof];
          const value = { ...next, terminalPersistedAttempts: terminal,
            attemptPresentations: next.attemptPresentations.filter(p => p.scope !== proof.scope || p.attemptId !== proof.attemptId) };
          const cap = this.acceptedView.currentCapability;
          const staged = this.acceptedView.stage(value, cap);
          if (!this.isCurrent(expected) || cap !== this.acceptedView.currentCapability || !this.acceptedView.commit(staged)) return false;
          const committed = this.acceptedView.peek();
          if (!this.isCurrent(committed) || cap !== this.acceptedView.currentCapability
            || committed.terminalPersistedAttempts.at(-1)?.attemptId !== proof.attemptId) return false;
          release("end");
          return true;
        });
      }
      if (this.isCurrent(previous) && JSON.stringify(next) !== JSON.stringify(previous)) {
        const staged = this.acceptedView.stage(next);
        if (!this.qualified() || !this.acceptedView.isCurrent(previous) || !this.acceptedView.commit(staged)) return false;
      }
      return this.isCurrent(this.acceptedView.peek());
    } finally { this.syncing = false; }
  }
  dispose(): void { this.ended = true; this.acceptedView.dispose(); }
}
