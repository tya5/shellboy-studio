import { batch, computed, signal, type ReadonlySignal } from '@preact/signals-core';
import { LiveText, type LiveFrame, type Preview, type PreviewDiscardReason, type Schedule } from './live';
import type { AttemptOutputLimit } from './protocol';

/** ADR-C1: UTF-8 retained text accounting, not a JavaScript heap guarantee. */
export const MAX_HANDOFF_RECORDS = 8;
export const MAX_HANDOFF_BYTES = 1024 * 1024;
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
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
  admitted: number; attemptId: string; source: LiveText; stop: () => void; record: HandoffRecord
}

/** One ledger per watched Thread. No queue, spill, or timer; retained bytes are bounded. */
export class Handoff {
  private held: Held[] = [];
  private readonly terminal = new Set<string>();

  private replacing = false;
  private active: string | undefined;
  /** Canonical owner-lifetime epoch; the public view is read-only. */
  private readonly epochState = signal(0);
  readonly epochSignal: ReadonlySignal<number> = this.epochState;
  private blockedAttempt: string | undefined;
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
  constructor(private readonly schedule: Schedule, private readonly nextOrdinal: () => number) {}
  get epoch(): number { return this.epochState.peek(); }
  get retainedBytes(): number { return this.held.reduce((n, h) => n + bytes(h.record.text), 0); }
  advanceEpoch(): void { this.epochState.value = this.epochState.peek() + 1; }

  apply(frame: LiveFrame): void {
    if (this.terminal.has(frame.attempt_id)) return;
    let h = this.held.find(h => h.attemptId === frame.attempt_id);
    if (h && this.active !== h.attemptId && h.record.status !== "streaming") return;
    if (!h) {
      // Refuse new previews at capacity; an accepted window owns retirement.
      if (this.held.length >= MAX_HANDOFF_RECORDS || this.blockedAttempt === frame.attempt_id) { this.overflowSig.value = true; this.blockedAttempt = frame.attempt_id; return; }
      if (this.active) this.finish();
      const source = new LiveText(this.schedule);
      const record: HandoffRecord = Object.freeze({ key: `handoff:${frame.attempt_id}`, attemptId: frame.attempt_id, clientOrdinal: this.nextOrdinal(), ...(frame.input_through_node_id !== undefined ? { inputThroughNodeId: frame.input_through_node_id } : {}), text: '', incomplete: frame.gap, status: 'streaming' });
      h = { admitted: 0, attemptId: frame.attempt_id, source, stop: () => {}, record };
      const held = h;
      this.held.push(h);
      h.stop = source.preview.subscribe(p => {
        if (p.kind !== 'live' || !this.held.includes(held)) return;
        const used = this.retainedBytes - bytes(held.record.text);
        if (used + bytes(p.text) > MAX_HANDOFF_BYTES) {
          this.overflowSig.value = true;
          this.updateRecord(held, { ...held.record, incomplete: true });
        } else this.updateRecord(held, { ...held.record, text: p.text, incomplete: p.incomplete, status: p.ending ? 'ended' : 'streaming' });
        held.admitted = bytes(p.text);
        this.publish();
      });
    }
    this.discarded.value = undefined;
    this.active = frame.attempt_id;
    // Stop client admission, not the Core stream. Do not replace previously visible text.
    const incoming = frame.deltas.reduce((n, d) => n + (d.reasoning ? 0 : bytes(d.text)), 0);
    if (this.held.reduce((n,h)=>n+Math.max(bytes(h.record.text),h.admitted),0) + incoming > MAX_HANDOFF_BYTES) {
      this.overflowSig.value = true;
      this.updateRecord(h, { ...h.record, incomplete: true });
      this.publish();
      return;
    }
    h.admitted += incoming;
    h.source.apply(frame);
  }
  end(attemptId: string, outcome: "adopted" | "not_adopted", outputLimit?: AttemptOutputLimit | null): void {
    if (this.terminal.has(attemptId)) return;
    this.terminal.add(attemptId);
    if (this.terminal.size > 256) this.terminal.delete(this.terminal.values().next().value!);
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
    h.stop(); this.held = this.held.filter(x => x !== h); this.publish();
  }

  discard(_reason: PreviewDiscardReason): void {
    batch(() => {
      if (_reason !== "resync") this.advanceEpoch();
      this.discarded.value = _reason;
      this.replacing = _reason === "resync" && this.sig.peek().length > 0;
      this.terminal.clear();
      for (const h of this.held) { h.stop(); h.source.discard(_reason); }
      this.held = []; this.active = undefined; this.blockedAttempt = undefined;
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
    this.publish();
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
  private update(id: string, fn: (r: HandoffRecord) => HandoffRecord): void {
    const h = this.held.find(h => h.attemptId === id); if (!h) return; this.updateRecord(h, fn(h.record)); this.publish();
  }
  private publish(): void {
    this.publicationDirty = true;
    if (this.replacing || this.publishing) return;
    this.publishing = true;
    try {
      // Coalesce nested mutations without recursive notification or a queued task.
      for (let pass = 0; pass < MAX_HANDOFF_RECORDS; pass++) {
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
