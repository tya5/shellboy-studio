import { AcceptedView } from "./accepted-view";
import type { ThreadHandle, ThreadReadQualification, AttemptPresentation, Resource } from "../../data/src/store";
import type { HistoryItem, Page, WorkItem } from "../../data/src/protocol";
import type { HandoffRecord, TerminalPersistedProof } from "../../data/src/handoff";

export interface LegacyPresentationSnapshot {
  readonly scope: string;
  readonly projectionGeneration: number;
  readonly rows: readonly HistoryItem[];
  readonly live: readonly HandoffRecord[];
  readonly work: Resource<Page<WorkItem>>;
  readonly attemptPresentations: readonly AttemptPresentation[];
  readonly terminalPersistedAttempts: readonly TerminalPersistedProof[];
  /** Exact transfer receipts survive CURRENT representation-proof GC. */
  readonly structuralTerminalReceipts: readonly TerminalPersistedProof[];
}
interface Sources {
  history: ReturnType<ThreadHandle["history"]["peek"]>;
  live: readonly HandoffRecord[];
  work: Resource<Page<WorkItem>>;
  pending: readonly AttemptPresentation[];
  fingerprint: string;
}

/** One owned legacy view. No reads, fresh admissions, reconstructed revision or order. */
export class LegacyAcceptedPresentation {
  readonly acceptedView: AcceptedView<LegacyPresentationSnapshot>;
  private readonly token: ThreadReadQualification | undefined;
  private readonly scope: string;
  private ended = false;
  private syncing = false;
  private generation = 0;
  private publishedSources: Sources | undefined;
  constructor(private readonly handle: ThreadHandle) {
    this.scope = handle.handoffScope();
    this.token = handle.captureReadQualification();
    this.acceptedView = new AcceptedView<LegacyPresentationSnapshot>({ scope: this.scope, projectionGeneration: 0, rows: [], live: [],
      work: { value: undefined, loading: false, stale: false, error: undefined }, attemptPresentations: [], terminalPersistedAttempts: [], structuralTerminalReceipts: [] });
  }
  private qualified(): boolean {
    return !this.ended && !!this.token && this.handle.isReadQualificationCurrent(this.token) && this.handle.handoffScope() === this.scope;
  }
  private capture(): Sources {
    const history = this.handle.history.peek(), live = this.handle.handoff.peek(), work = this.handle.work.peek(), pending = this.handle.attemptPresentations.peek();
    // Producers replace their snapshots, but their public nested types are not deeply readonly.
    return { history, live, work, pending, fingerprint: JSON.stringify([history, live, work, pending]) };
  }
  private current(sources: Sources): boolean {
    if (!this.qualified()) return false;
    const now = this.capture();
    return sources.history === now.history && sources.live === now.live && sources.work === now.work
      && sources.pending === now.pending && sources.fingerprint === now.fingerprint;
  }
  isCurrent(ref: LegacyPresentationSnapshot): boolean {
    return !!this.publishedSources && this.current(this.publishedSources) && this.acceptedView.isCurrent(ref);
  }
  private representationProofs(sources: Sources, proofs: readonly TerminalPersistedProof[]): readonly TerminalPersistedProof[] {
    const work = sources.work;
    if (!work.value || work.loading || work.stale || work.error || work.value.next_cursor !== undefined) return proofs;
    const ids = new Set<string>();
    for (const item of work.value.items) {
      if (typeof item.attempt_id !== "string" || !item.attempt_id) return proofs;
      ids.add(item.attempt_id);
    }
    for (const record of sources.live) ids.add(record.attemptId);
    return proofs.filter(proof => ids.has(proof.attemptId));
  }
  private value(sources: Sources, proofs: readonly TerminalPersistedProof[], receipts: readonly TerminalPersistedProof[]): LegacyPresentationSnapshot {
    return { scope: this.scope, projectionGeneration: this.generation + 1, rows: sources.history.items, live: sources.live, work: sources.work,
      attemptPresentations: sources.pending.filter(f => !receipts.some(p => p.scope === f.scope && p.attemptId === f.attemptId)),
      terminalPersistedAttempts: this.representationProofs(sources, proofs), structuralTerminalReceipts: receipts };
  }
  private publish(expected: LegacyPresentationSnapshot, sources: Sources, value: LegacyPresentationSnapshot): LegacyPresentationSnapshot | undefined {
    const cap = this.acceptedView.currentCapability;
    const staged = this.acceptedView.stage(value, cap);
    if (!this.current(sources) || !this.acceptedView.isCurrent(expected) || cap !== this.acceptedView.currentCapability) return undefined;
    const before = this.publishedSources;
    this.publishedSources = sources;
    if (!this.acceptedView.commit(staged)) { this.publishedSources = before; return undefined; }
    this.generation = value.projectionGeneration;
    const ref = this.acceptedView.peek();
    return this.isCurrent(ref) && ref.projectionGeneration === value.projectionGeneration && cap === this.acceptedView.currentCapability ? ref : undefined;
  }
  sync(): boolean {
    if (!this.qualified() || this.syncing) return false;
    this.syncing = true;
    try {
      let expected = this.acceptedView.peek();
      let sources = this.capture();
      for (const record of sources.live) {
        if (!record.terminalPersisted || record.transferred) continue;
        const before = expected;
        let ownCommit: LegacyPresentationSnapshot | undefined;
        this.handle.transferHandoff(record.attemptId, (captured, release) => {
          const proof = captured.terminalPersisted;
          if (!proof || !this.current(sources) || !this.acceptedView.isCurrent(expected) || proof.scope !== this.scope || proof.attemptId !== captured.attemptId
            || !["completed", "failed", "incomplete", "cancelled"].includes(proof.terminalState)
            || !proof.nodeIds.length || proof.nodeIds.length > 64 || proof.nodeIds.some(id => !id)) return false;
          const old = expected.structuralTerminalReceipts;
          if (old.length >= 8 && !old.some(p => p.attemptId === proof.attemptId)) return false;
          const receipts = [...old.filter(p => p.attemptId !== proof.attemptId), proof];
          const proofs = [...expected.terminalPersistedAttempts.filter(p => p.attemptId !== proof.attemptId), proof];
          ownCommit = this.publish(expected, sources, this.value(sources, proofs, receipts));
          if (!ownCommit) return false;
          release("end"); return true;
        });
        if (!this.qualified()) return false;
        const now = this.acceptedView.peek();
        // Never overwrite a subscriber's newer ref, including a rejected transfer's reentry.
        if (now !== before && now !== ownCommit) return this.isCurrent(now);
        expected = now;
        sources = this.capture();
      }
      if (!this.current(sources) || !this.acceptedView.isCurrent(expected)) return false;
      const value = this.value(sources, expected.terminalPersistedAttempts, expected.structuralTerminalReceipts);
      const comparable = { ...value, projectionGeneration: expected.projectionGeneration };
      if (JSON.stringify(comparable) !== JSON.stringify(expected) || !this.isCurrent(expected)) {
        return !!this.publish(expected, sources, value);
      }
      return this.isCurrent(expected);
    } finally { this.syncing = false; }
  }
  dispose(): void { this.ended = true; this.publishedSources = undefined; this.acceptedView.dispose(); }
}
