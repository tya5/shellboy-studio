import { computed, signal, type ReadonlySignal } from '@preact/signals-core';
import { LiveText, MAX_PREVIEW_CHARS, type LiveFrame, type Preview, type PreviewDiscardReason, type Schedule } from './live';

/** ADR-C1: UTF-8 retained text accounting, not a JavaScript heap guarantee. */
export const MAX_HANDOFF_RECORDS = 8;
export const MAX_HANDOFF_BYTES = 1024 * 1024;
export const MAX_HANDOFF_READS = 8;
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
export type HandoffStatus = 'streaming' | 'confirming' | 'failed' | 'ready';
export interface HandoffRecord {
  readonly key: string;
  readonly attemptId: string;
  readonly text: string;
  readonly incomplete: boolean;
  readonly status: HandoffStatus;
  readonly nodeId?: string;
  readonly proof?: Readonly<{ scope: string; turnId: string; ordinal: number; revision: string | number; kind: 'assistant_response' }>;
  readonly transferred?: boolean;
}
interface Held { admitted: number; transferring?: boolean; attemptId: string; source: LiveText; stop: () => void; record: HandoffRecord }

/** One ledger per watched Thread. No queue, spill or timer. Hints cannot refill read budget. */
export class Handoff {
  private held: Held[] = [];
  private publications = new Map<string, string | undefined>();
  private get publicationSlots(): number { return [...this.publications.values()].filter(id => !id || !this.held.some(h => h.attemptId === id)).length; }
  claimPublication(nodeId: string, attemptId?: string): boolean {
    if (this.publications.has(nodeId)) { if (attemptId) this.publications.set(nodeId, attemptId); return true; }
    if (this.publications.size >= MAX_HANDOFF_RECORDS || this.held.length + this.publicationSlots >= MAX_HANDOFF_RECORDS) { this.overflowSig.value = true; return false; }
    this.publications.set(nodeId, attemptId); return true;
  }
  resetPublicationPriority(): void { this.publications.clear(); }

  private active: string | undefined;
  private epochValue = 0;
  private lifetimeValue = 0;
  get lifetime(): number { return this.lifetimeValue; }
  private blockedAttempt: string | undefined;
  private reads = MAX_HANDOFF_READS;
  private readonly discarded = signal<PreviewDiscardReason | undefined>(undefined);
  private publishing = false;
  private readonly sig = signal<readonly HandoffRecord[]>([]);
  readonly records: ReadonlySignal<readonly HandoffRecord[]> = this.sig;
  private readonly overflowSig = signal(false);
  readonly overflow: ReadonlySignal<boolean> = this.overflowSig;
  readonly preview: ReadonlySignal<Preview> = computed(() => {
    const r = this.records.value.find(r => r.attemptId === this.active);
    return r ? { kind: 'live', attemptId: r.attemptId, text: r.text, incomplete: r.incomplete, ending: r.status !== 'streaming' } : { kind: 'none', ...(this.discarded.value ? { discarded: this.discarded.value } : {}) };
  });
  constructor(private readonly schedule: Schedule) {}
  get epoch(): number { return this.epochValue; }
  get remainingReads(): number { return this.reads; }
  get retainedBytes(): number { return this.held.reduce((n, h) => n + bytes(h.record.text), 0); }
  get isEnding(): boolean { return this.held.some(h => h.record.status === 'confirming'); }
  takeRead(): boolean { if (!this.reads) return false; this.reads--; return true; }
  reconcile(): void { this.reads = MAX_HANDOFF_READS; this.epochValue++; }
  invalidate(): void { this.epochValue++; }

  apply(frame: LiveFrame): void {
    let h = this.held.find(h => h.attemptId === frame.attempt_id);
    if (h && (h.record.status === "ready" || (this.active !== h.attemptId && h.record.status !== "streaming"))) return;
    if (!h) {
      if (this.held.length + this.publicationSlots >= MAX_HANDOFF_RECORDS || this.blockedAttempt === frame.attempt_id) { this.overflowSig.value = true; this.blockedAttempt = frame.attempt_id; return; }
      if (this.active) this.finish();
      const source = new LiveText(this.schedule);
      const record: HandoffRecord = { key: `handoff:${frame.attempt_id}`, attemptId: frame.attempt_id, text: '', incomplete: frame.gap, status: 'streaming' };
      h = { admitted: 0, attemptId: frame.attempt_id, source, stop: () => {}, record };
      const held = h;
      this.held.push(h);
      h.stop = source.preview.subscribe(p => {
        if (p.kind !== 'live' || !this.held.includes(held)) return;
        const used = this.retainedBytes - bytes(held.record.text);
        if (used + bytes(p.text) > MAX_HANDOFF_BYTES) {
          this.overflowSig.value = true;
          held.record = { ...held.record, incomplete: true };
        } else held.record = { ...held.record, text: p.text, incomplete: p.incomplete, status: p.ending ? 'confirming' : 'streaming' };
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
      h.record = { ...h.record, incomplete: true };
      this.publish();
      return;
    }
    h.admitted += incoming;
    h.source.apply(frame);
  }
  finish(): void {
    const h = this.held.find(h => h.attemptId === this.active);
    if (h && h.record.status !== 'ready') h.source.finish();
  }
  fail(attemptId: string): void { this.update(attemptId, r => ({ ...r, status: 'failed' })); }
  confirming(attemptId: string): void { this.update(attemptId, r => ({ ...r, status: 'confirming' })); }
  /** Reserve exact saved identity without claiming its body is safe to display. */
  identify(attemptId: string, nodeId: string): void {
    this.update(attemptId, r => r.status === 'ready' ? r : ({ ...r, nodeId }));
  }
  /** Called only after exact identity and intended safe body are verified. One signal write. */
  ready(attemptId: string, nodeId: string, text: string, proof?: HandoffRecord["proof"]): boolean {
    const h = this.held.find(h => h.attemptId === attemptId);
    if (!h || text.length > MAX_PREVIEW_CHARS || this.retainedBytes - bytes(h.record.text) + bytes(text) > MAX_HANDOFF_BYTES) { this.overflowSig.value = true; return false; }
    h.stop();
    h.source.discard('saved');
    h.admitted = bytes(text);
    h.record = { ...h.record, text, nodeId, proof, incomplete: false, status: 'ready' };
    this.publish();
    return true;
  }
  transfer(attemptId: string, accept: (record: HandoffRecord, release: (reason: 'return' | 'end') => void) => boolean): boolean {
    const h = this.held.find(h => h.attemptId === attemptId);
    if (!h || h.transferring || h.record.status !== 'ready' || !h.record.proof || h.record.transferred) return false;
    const epoch = this.lifetimeValue;
    const moved = Object.freeze({ ...h.record, transferred: true });
    h.transferring = true;
    let deferred: 'return' | 'end' | undefined;
    let receiving = true;
    try {
      if (!accept(moved, reason => {
        if (receiving) { deferred = reason; return; }
        if (this.lifetimeValue !== epoch || h.record !== moved || !this.held.includes(h)) return;
        if (reason === 'end') this.release(attemptId);
        else { h.record = { ...moved, transferred: false }; this.publish(); }
      })) return false;
      if (epoch !== this.lifetimeValue || !this.held.includes(h)) return false;
      receiving = false;
      h.record = moved;
      if (deferred === 'end') this.release(attemptId);
      else if (deferred === 'return') { h.record = { ...moved, transferred: false }; this.publish(); }
      else this.publish();
      return true;
    } finally { h.transferring = false; }
  }

  /** Release only after the canonical window has accepted the exact record's display ownership. */
  release(attemptId: string): void {
    const h = this.held.find(h => h.attemptId === attemptId);
    if (!h || h.record.status !== 'ready') return;
    h.stop(); this.held = this.held.filter(x => x !== h); this.publish();
  }
  discard(_reason: PreviewDiscardReason): void {
    this.epochValue++;
    this.lifetimeValue++;
    this.discarded.value = _reason;
    for (const h of this.held) { h.stop(); h.source.discard(_reason); }
    this.publications.clear();
    this.held = []; this.active = undefined; this.blockedAttempt = undefined;
    this.overflowSig.value = false; this.publish();
  }
  private update(id: string, fn: (r: HandoffRecord) => HandoffRecord): void {
    const h = this.held.find(h => h.attemptId === id); if (!h) return; h.record = fn(h.record); this.publish();
  }
  private publish(): void {
    if (this.publishing) return;
    this.publishing = true;
    try { this.sig.value = this.held.map(h => h.record); } finally { this.publishing = false; }
  }
}
