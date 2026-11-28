import { batch, computed, signal, type ReadonlySignal } from '@preact/signals-core';
import { LiveText, type LiveFrame, type Preview, type PreviewDiscardReason, type Schedule } from './live';
import type { AttemptOutputLimit } from './protocol';

import { RetainedBudget, retainedStringBytes, type RetainedReservation } from './retained-budget';

const MAX_PUBLICATION_PASSES = 8;
export type HandoffStatus = 'streaming' | 'ended';
export interface HandoffRecord {
  readonly key: string;
  readonly attemptId: string;
  readonly clientOrdinal: number;
  readonly inputThroughNodeId?: string | null;
  readonly text: string;
  readonly incomplete: boolean;
  readonly status: HandoffStatus;
  /** Only the owner's typed attempt_end can establish saved adoption. */
  readonly adopted?: true;
  readonly outputLimit?: AttemptOutputLimit;
}
interface Held {
  baseBytes: number; reservation: RetainedReservation; attemptId: string; source: LiveText; stop: () => void; record: HandoffRecord
}

/** One ledger per watched Thread. No queue, spill, or timer; retained bytes are bounded. */
export class Handoff {
  private held: Held[] = [];
  private readonly terminal = new Map<string, RetainedReservation>();
  private retiring: RetainedReservation[] = [];
  private terminalBlocked = false;

  private replacing = false;
  private active: string | undefined;
  /** Canonical owner-lifetime epoch; the public view is read-only. */
  private readonly epochState = signal(0);
  readonly epochSignal: ReadonlySignal<number> = this.epochState;
  private readonly discarded = signal<PreviewDiscardReason | undefined>(undefined);
  private publishing = false;
  private publicationDirty = false;
  private readonly sig = signal<readonly HandoffRecord[]>([]);
  readonly records: ReadonlySignal<readonly HandoffRecord[]> = this.sig;
  private readonly overflowSig = signal(false);
  readonly overflow: ReadonlySignal<boolean> = this.overflowSig;
  readonly preview: ReadonlySignal<Preview> = computed(() => {
    const records = this.records.value;
    const r = records.find(r => r.attemptId === this.active) ?? (this.replacing ? records.at(-1) : undefined);
    return r ? { kind: 'live', attemptId: r.attemptId, text: r.text, incomplete: r.incomplete, ending: r.status !== 'streaming' } : { kind: 'none', ...(this.discarded.value ? { discarded: this.discarded.value } : {}) };
  });
  constructor(private readonly schedule: Schedule, private readonly nextOrdinal: () => number, private readonly budget = new RetainedBudget()) {}
  get epoch(): number { return this.epochState.peek(); }
  advanceEpoch(): void { this.epochState.value = this.epochState.peek() + 1; }

  apply(frame: LiveFrame): void {
    if (this.terminalBlocked || this.terminal.has(frame.attempt_id)) return;
    let h = this.held.find(h => h.attemptId === frame.attempt_id);
    if (h && this.active !== h.attemptId && h.record.status !== "streaming") return;
    if (!h) {
      const key = `handoff:${frame.attempt_id}`;
      const baseBytes = 512 + retainedStringBytes(key) + retainedStringBytes(frame.attempt_id)
        + retainedStringBytes(frame.input_through_node_id ?? '');
      const reservation = this.budget.reserve(baseBytes, () => {});
      if (!reservation) { this.overflowSig.value = true; return; }
      reservation.pin();
      if (this.active) this.finish();
      const source = new LiveText(this.schedule);
      const record: HandoffRecord = Object.freeze({ key, attemptId: frame.attempt_id, clientOrdinal: this.nextOrdinal(), ...(frame.input_through_node_id !== undefined ? { inputThroughNodeId: frame.input_through_node_id } : {}), text: '', incomplete: frame.gap, status: 'streaming' });
      h = { baseBytes, reservation, attemptId: frame.attempt_id, source, stop: () => {}, record };
      const held = h;
      this.held.push(h);
      h.stop = source.preview.subscribe(p => {
        if (p.kind !== 'live' || !this.held.includes(held)) return;
        this.updateRecord(held, { ...held.record, text: p.text, incomplete: p.incomplete, status: p.ending ? 'ended' : 'streaming' });
        held.reservation.resize(held.baseBytes + retainedStringBytes(p.text));
        this.publish();
      });
    }
    this.discarded.value = undefined;
    this.active = frame.attempt_id;
    const held = h;
    held.source.apply(frame, (before, additional) => {
      // The published prefix and the pending assembly may differ until the next tick.
      const bytes = held.baseBytes + retainedStringBytes(held.record.text)
        + retainedStringBytes(before) + retainedStringBytes(additional);
      if (held.reservation.resize(bytes)) return true;
      this.overflowSig.value = true;
      return false;
    });
  }
  end(attemptId: string, outcome: "adopted" | "not_adopted", outputLimit?: AttemptOutputLimit | null): void {
    if (this.terminalBlocked || this.terminal.has(attemptId)) return;
    const terminal = this.budget.reserve(64 + retainedStringBytes(attemptId), () => {});
    if (terminal) {
      terminal.pin();
      this.terminal.set(attemptId, terminal);
    } else {
      // Without dedup evidence, accepting a later preview could resurrect this attempt.
      this.terminalBlocked = true;
      this.overflowSig.value = true;
      this.advanceEpoch();
    }
    const held = this.held.find(h => h.attemptId === attemptId);
    if (outcome === "adopted" && held) {
      this.updateRecord(held, { ...held.record, status: "ended", adopted: true, ...(outputLimit?.stop ? { outputLimit } : {}) });
      if (this.active === attemptId) this.active = undefined;
      this.publish();
      held.source.finish();
    } else if (outcome === "not_adopted") {
      if (this.active === attemptId) this.active = undefined;
      this.releaseAccepted(attemptId);
    }
  }

  finish(): void {
    const h = this.held.find(h => h.attemptId === this.active);
    if (h) h.source.finish();
  }
  /** Release a matching source after accepted-window ownership is published. */
  releaseAccepted(attemptId: string): void {
    const h = this.held.find(h => h.attemptId === attemptId);
    if (!h) return;
    h.stop(); this.held = this.held.filter(x => x !== h);
    this.publish(); h.reservation.release();
  }

  discard(_reason: PreviewDiscardReason): void {
    batch(() => {
      if (_reason !== "resync") this.advanceEpoch();
      this.discarded.value = _reason;
      this.replacing = _reason === "resync" && this.sig.peek().length > 0;
      for (const entry of this.terminal.values()) entry.release();
      this.terminal.clear(); this.terminalBlocked = false;
      if (!this.replacing) this.releaseRetiring();
      for (const h of this.held) {
        h.stop(); h.source.discard(_reason);
        if (this.replacing && this.sig.peek().includes(h.record)) this.retiring.push(h.reservation);
        else h.reservation.release();
      }
      this.held = []; this.active = undefined;
      this.overflowSig.value = false; this.publish();
    });
  }
  captureReplacement(): readonly HandoffRecord[] | undefined {
    if (!this.replacing) return;
    for (const held of this.held) held.source.flush();
    return this.held.map(held => held.record);
  }
  commitReplacement(): void {
    this.replacing = false;
    this.publish(); this.releaseRetiring();
  }
  private sameOwnRecord(a: HandoffRecord, b: HandoffRecord): boolean {
    const entries = (value: HandoffRecord) => Object.entries(value);
    const left = entries(a), right = entries(b);
    return left.length === right.length && left.every(([key, value]) => right.some(([other, otherValue]) => key === other && Object.is(value, otherValue)));
  }
  /** All own keys define the current live source identity. */
  private updateRecord(held: Held, next: HandoffRecord): HandoffRecord {
    const previous = held.record;
    if (this.sameOwnRecord(previous, next)) return previous;
    held.record = Object.freeze(next);
    return held.record;
  }
  private releaseRetiring(): void {
    for (const entry of this.retiring) entry.release();
    this.retiring = [];
  }
  private publish(): void {
    this.publicationDirty = true;
    if (this.replacing || this.publishing) return;
    this.publishing = true;
    try {
      // Coalesce nested mutations without recursive notification or a queued task.
      for (let pass = 0; pass < MAX_PUBLICATION_PASSES; pass++) {
        this.publicationDirty = false;
        const latest = this.held.map(h => h.record);
        const current = this.sig.peek();
        if (latest.length !== current.length || latest.some((record, i) => record !== current[i])) this.sig.value = latest;
        if (!this.publicationDirty) return;
      }
      // A continuously mutating observer cannot keep old capture authority alive.
      this.advanceEpoch();
      this.overflowSig.value = true;
    } finally { this.publishing = false; }
  }
}
