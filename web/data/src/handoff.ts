import {responseRefsMatchSelected,type SelectedResponseRef} from "./public-response-refs";
import { computed, signal, type ReadonlySignal } from '@preact/signals-core';
import { LiveText, MAX_PREVIEW_CHARS, type LiveFrame, type Preview, type PreviewDiscardReason, type Schedule } from './live';

import type { HistoryItem } from './protocol';
declare const presentationContainerBrand: unique symbol;
export type PresentationContainerId = string & { readonly [presentationContainerBrand]: true };
/** Partial persisted-node evidence, not complete body/item coverage. S owns scope authority. */
export interface TerminalPersistedProof {
  readonly scope: string;
  readonly attemptId: string;
  readonly recordKey?: string;
  readonly turnId?: string;
  readonly nodeIds: readonly string[];
  /** Immutable ownership transferred with the receipt; never recovered from the retired ledger. */
  readonly presentationContainer?: PresentationContainerId;
  readonly refs?: readonly { readonly nodeId: string; readonly ordinal: number; readonly kind: string }[];
  readonly terminalState: 'completed' | 'failed' | 'incomplete' | 'cancelled';
}
export interface AttemptReadyProof { readonly scope: string; readonly attemptId: string; readonly turnId: string; readonly revision: number; readonly total: number; readonly refs: readonly SelectedResponseRef[]; readonly nodes: readonly HistoryItem[] }

function mintPresentationContainer(attemptId: string): PresentationContainerId {
  if (globalThis.crypto?.randomUUID) return `presentation:${globalThis.crypto.randomUUID()}` as PresentationContainerId;
  // The attempt is only a non-colliding fallback in runtimes without Web Crypto.
  return `presentation:${attemptId}` as PresentationContainerId;
}

export interface DisplayAssociation {
  readonly scope: string;
  readonly attemptId: string;
  readonly turnId: string;
  readonly presentationContainer: PresentationContainerId;
  readonly refs: readonly { readonly nodeId: string; readonly ordinal: number; readonly kind: string }[];
}
/** Borrowed original held slot; no second preview or receipt ledger. */
export interface DisplayLease {
  readonly original: HandoffRecord;
  /** Returns the current immutable record for the same held source transition. */
  currentRecord(): HandoffRecord | undefined;
  current(): boolean;
  stage(generation: number, current: (generation: number) => boolean): () => void;
}
export type DisplayObservation =
  | Readonly<{ kind: 'readable'; lease: DisplayLease; association?: DisplayAssociation; receipt?: TerminalPersistedProof }>
  | Readonly<{ kind: 'receipt'; record: HandoffRecord; receipt: TerminalPersistedProof }>;
export interface DisplayTarget { publish(observations: readonly DisplayObservation[]): boolean }

/** ADR-C1: UTF-8 retained text accounting, not a JavaScript heap guarantee. */
export const MAX_HANDOFF_RECORDS = 8;
export const MAX_HANDOFF_BYTES = 1024 * 1024;
export const MAX_HANDOFF_READS = 8;
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
export type HandoffStatus = 'streaming' | 'confirming' | 'failed' | 'ready';
export type HandoffPathAnchor={readonly kind:'beginning'}|{readonly kind:'after-node';readonly nodeId:string;readonly ordinal:number};
export interface HandoffPlacement {readonly scope:string;readonly revision:number;readonly anchor:HandoffPathAnchor|
 {readonly kind:'after-record';readonly recordKey:string;readonly container:PresentationContainerId;readonly path:HandoffPathAnchor}}
export interface HandoffRecord {
  readonly key: string;
  readonly presentationContainer: PresentationContainerId;
  readonly attemptId: string;
  readonly placement?:HandoffPlacement;
  readonly text: string;
  readonly incomplete: boolean;
  readonly status: HandoffStatus;
  readonly bodyAuthority: 'preview' | 'saved';
  readonly nodeId?: string;
  readonly proof?: Readonly<{ scope: string; turnId: string; ordinal: number; revision: number; kind: 'assistant_response' }>;
  readonly transferred?: boolean;
  readonly readyAttempt?: AttemptReadyProof;
  readonly terminalPersisted?: TerminalPersistedProof;
}
type RecordTransition = 'source' | 'bookkeeping';
interface Held { display?: { generation: number; sourceCurrent: () => boolean; current: (generation: number) => boolean };
  attemptCapture?: { original: HandoffRecord; staged: HandoffRecord; proof: AttemptReadyProof | TerminalPersistedProof; epoch: number; lifetime: number };
  admitted: number; sourceRevision: number; transferring?: boolean; attemptId: string; source: LiveText; stop: () => void; record: HandoffRecord }

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
  private publicationDirty = false;
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
  clearDisplay(): void { for (const held of this.held) held.display = undefined; }
  reconcile(): void { this.clearDisplay(); this.reads = MAX_HANDOFF_READS; this.epochValue++; }
  invalidate(): void { this.clearDisplay(); this.epochValue++; }

  apply(frame: LiveFrame,placement?:HandoffPlacement): void {
    let h = this.held.find(h => h.attemptId === frame.attempt_id);
    if (h && (h.record.status === "ready" || (this.active !== h.attemptId && h.record.status !== "streaming"))) return;
    if (!h) {
      if (this.held.length + this.publicationSlots >= MAX_HANDOFF_RECORDS || this.blockedAttempt === frame.attempt_id) { this.overflowSig.value = true; this.blockedAttempt = frame.attempt_id; return; }
      if (this.active) this.finish();
      const source = new LiveText(this.schedule);
      const record: HandoffRecord = { key: `handoff:${frame.attempt_id}`, presentationContainer: mintPresentationContainer(frame.attempt_id), attemptId: frame.attempt_id, text: '', incomplete: frame.gap, status: 'streaming', bodyAuthority: 'preview', ...(placement?{placement:Object.freeze({...placement,anchor:Object.freeze({...placement.anchor})})}:{}) };
      h = { admitted: 0, sourceRevision: 0, attemptId: frame.attempt_id, source, stop: () => {}, record };
      const held = h;
      this.held.push(h);
      h.stop = source.preview.subscribe(p => {
        if (p.kind !== 'live' || !this.held.includes(held)) return;
        const used = this.retainedBytes - bytes(held.record.text);
        if (used + bytes(p.text) > MAX_HANDOFF_BYTES) {
          this.overflowSig.value = true;
          this.updateRecord(held, { ...held.record, incomplete: true });
        } else this.updateRecord(held, { ...held.record, text: p.text, incomplete: p.incomplete, status: p.ending ? 'confirming' : 'streaming' });
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
  captureDisplay(original: HandoffRecord): DisplayLease | undefined {
    const held = this.held.find(item => item.record === original);
    if (!held || !original.text) return;
    const epoch = this.epochValue, lifetime = this.lifetimeValue, sourceRevision = held.sourceRevision;
    const currentRecord = () => this.held.includes(held) && epoch === this.epochValue && lifetime === this.lifetimeValue
      && sourceRevision === held.sourceRevision
      ? held.record : undefined;
    const current = () => currentRecord() !== undefined;
    return Object.freeze({ original, currentRecord, current, stage: (generation: number, valid: (generation: number) => boolean) => {
      if (!current()) return () => {};
      const previous = held.display;
      const candidate = { generation, sourceCurrent: current, current: (at: number) => at >= generation && current() && valid(at) };
      held.display = candidate;
      // Rollback restores the prior lease rather than turning a rejected
      // successor into an unintended source revocation.
      return () => { if (held.display === candidate) held.display = previous; };
    } });
  }
  isDisplayCurrent(original: HandoffRecord, generation: number): boolean {
    const held = this.held.find(item => item.record === original);
    return !!held?.display && held.display.current(generation);
  }
  finish(): void {
    const h = this.held.find(h => h.attemptId === this.active);
    if (h && h.record.status !== 'ready') h.source.finish();
  }
  fail(attemptId: string): void {
    const held=this.held.find(item=>item.attemptId===attemptId);
    if (!held) return;
    this.updateRecord(held, {...held.record,status:'failed'}); this.publish();
  }
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
    this.updateRecord(h, { ...h.record, text, nodeId, proof, incomplete: false, status: 'ready', bodyAuthority: 'saved' });
    this.publish();
    return true;
  }
  stageTerminalPersisted(original: HandoffRecord, proof: TerminalPersistedProof): HandoffRecord | undefined {
    const h = this.held.find(h => h.record === original);
    if (!h || h.transferring || proof.attemptId !== original.attemptId || !proof.scope || !['completed', 'failed', 'incomplete', 'cancelled'].includes(proof.terminalState) || !Array.isArray(proof.nodeIds) || !proof.nodeIds.length || proof.nodeIds.length > 64 || !proof.nodeIds.every(id => typeof id === 'string' && id.length > 0)) return;
    // Partial saved-node evidence deliberately does not require complete preview or items.
    const { readyAttempt: _readyAttempt, ...retained } = original;
    const staged = Object.freeze({ ...retained, terminalPersisted: proof });
    const canonical = this.updateRecord(h, staged);
    h.attemptCapture = { original, staged: canonical, proof, epoch: this.epochValue, lifetime: this.lifetimeValue };
    this.publish();
    return canonical;
  }
  stageAttempt(original: HandoffRecord, proof: AttemptReadyProof): HandoffRecord | undefined {
    const h = this.held.find(h => h.record === original);
    if (!h || h.transferring || original.incomplete || !Number.isSafeInteger(proof.total) || proof.total < 0 || proof.attemptId !== original.attemptId || !proof.scope || !proof.turnId || !proof.refs.length || proof.refs.length > 64 || proof.nodes.length > 200) return;
    const nodes = new Map(proof.nodes.map(n => [n.node_id, n]));
    if (nodes.size !== proof.nodes.length || !responseRefsMatchSelected(proof.refs,proof.nodes)) return;
    let visible = false;
    for (const node of proof.nodes) {
      const ordinal = node.selection?.ordinal;
      if (!node.node_id || !Array.isArray(node.items) || typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= proof.total) return;
      for (const item of node.items) {
        if (item.kind === 'unavailable' || (item.kind === 'text' && !item.text_complete)) return;
        if (item.kind !== 'reasoning_unavailable') visible = true;
      }
    }
    if (!visible) return;
    const staged = Object.freeze({ ...original, readyAttempt: proof });
    const canonical = this.updateRecord(h, staged);
    h.attemptCapture = { original, staged: canonical, proof, epoch: this.epochValue, lifetime: this.lifetimeValue };
    this.publish();
    return canonical;
  }
  /** The staged object, capture and lifetime jointly own selected-read admission. */
  isReadyReadCurrent(record: HandoffRecord, scope: string): boolean {
    const held = this.held.find(item => item.record === record);
    const capture = held?.attemptCapture;
    return !!held && !held.transferring && !!capture && capture.staged === record
      && capture.proof === record.readyAttempt && record.readyAttempt?.scope === scope
      && capture.epoch === this.epochValue && capture.lifetime === this.lifetimeValue;
  }
  transferAttempt(original: HandoffRecord, proof: AttemptReadyProof | TerminalPersistedProof, accept: (staged: HandoffRecord, release: (reason: 'return' | 'end') => void) => boolean): boolean {
    const h = this.held.find(h => h.attemptCapture?.original === original);
    const c = h?.attemptCapture;
    if (!h || !c || h.transferring || c.proof !== proof || h.record !== c.staged || c.epoch !== this.epochValue || c.lifetime !== this.lifetimeValue) return false;
    let receiving = true; let accepted = false; let pending: 'return' | 'end' | undefined;
    const release = (reason: 'return' | 'end') => {
      if (receiving) { pending = reason; return; }
      if (!accepted || h.attemptCapture !== c || h.record !== c.staged || c.epoch !== this.epochValue || c.lifetime !== this.lifetimeValue || !this.held.includes(h)) return;
      h.attemptCapture = undefined;
      if (reason === 'end') { h.stop(); this.held = this.held.filter(x => x !== h); }
      else this.updateRecord(h, original);
      this.publish();
    };
    h.transferring = true;
    try {
      accepted = accept(c.staged, release);
      receiving = false;
      if (!accepted || h.attemptCapture !== c || h.record !== c.staged || c.epoch !== this.epochValue || c.lifetime !== this.lifetimeValue || !this.held.includes(h)) return false;
      if (pending) release(pending);
      // A synchronous end may remove this exact slot; invalidation never counts as success.
      if (c.epoch !== this.epochValue || c.lifetime !== this.lifetimeValue) return false;
      return pending === 'end' && !this.held.includes(h);
    } finally { receiving = false; h.transferring = false; }
  }
  transfer(attemptId: string, accept: (record: HandoffRecord, release: (reason: 'return' | 'end') => void) => boolean): boolean {
    const h = this.held.find(h => h.attemptId === attemptId);
    if (h?.attemptCapture) return this.transferAttempt(h.attemptCapture.original, h.attemptCapture.proof, accept);
    if (!h || h.transferring || h.record.status !== 'ready' || !h.record.proof || h.record.transferred) return false;
    const epoch = this.lifetimeValue;
    h.transferring = true;
    const moved = this.updateTransferred(h, true);
    let deferred: 'return' | 'end' | undefined;
    let receiving = true;
    try {
      let accepted = false;
      try {
        accepted = accept(moved, reason => {
          if (receiving) { deferred = reason; return; }
          if (this.lifetimeValue !== epoch || h.record !== moved || !this.held.includes(h)) return;
          if (reason === 'end') this.release(attemptId);
          else { this.updateTransferred(h, false); this.publish(); }
        });
      } catch (error) {
        this.updateTransferred(h, false);
        throw error;
      }
      if (!accepted) { this.updateTransferred(h, false); return false; }
      if (epoch !== this.lifetimeValue || !this.held.includes(h)) return false;
      receiving = false;
      if (deferred === 'end') this.release(attemptId);
      else if (deferred === 'return') { this.updateTransferred(h, false); this.publish(); }
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
  private sameOwnRecord(a: HandoffRecord, b: HandoffRecord, includeTransferred = true): boolean {
    const entries = (value: HandoffRecord) => Object.entries(value).filter(([key]) => includeTransferred || key !== 'transferred');
    const left = entries(a), right = entries(b);
    return left.length === right.length && left.every(([key, value]) => right.some(([other, otherValue]) => key === other && Object.is(value, otherValue)));
  }
  /** All own keys define source identity; only the typed transfer entry is bookkeeping. */
  private updateRecord(held: Held, next: HandoffRecord): HandoffRecord {
    const previous = held.record;
    if (this.sameOwnRecord(previous, next)) return previous;
    held.sourceRevision++;
    held.record = Object.freeze(next);
    return held.record;
  }
  private updateTransferred(held: Held, transferred: boolean): HandoffRecord {
    if (held.record.transferred === transferred) return held.record;
    held.record = Object.freeze({ ...held.record, transferred });
    return held.record;
  }
  private update(id: string, fn: (r: HandoffRecord) => HandoffRecord): void {
    const h = this.held.find(h => h.attemptId === id); if (!h) return; this.updateRecord(h, fn(h.record)); this.publish();
  }
  private publish(): void {
    for (const held of this.held) if (held.display && !held.display.sourceCurrent()) held.display = undefined;
    this.publicationDirty = true;
    if (this.publishing) return;
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
      this.invalidate();
      this.overflowSig.value = true;
    } finally { this.publishing = false; }
  }
}
