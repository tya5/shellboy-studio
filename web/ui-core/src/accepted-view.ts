import { batch, signal, type Signal } from "@preact/signals-core";
// Local authority identity only: never decoded or reconstructed from wire fields.
declare const acceptedCapabilityBrand: unique symbol;
export type AcceptedCapability = Readonly<{ readonly [acceptedCapabilityBrand]: true }>;
declare const stagedBrand: unique symbol;
export type StagedView<T> = Readonly<{ readonly [stagedBrand]: T }>;

const capabilityTokens = new WeakSet<object>();
function mintCapability(): AcceptedCapability {
  const token = Object.freeze({}) as AcceptedCapability;
  capabilityTokens.add(token);
  return token;
}

type PlainCapture = <T>(value: T) => T;
const captureBrand: unique symbol = Symbol("publication capture");
const publicationBrand: unique symbol = Symbol("accepted publication");
export type PublicationReason = "receipt" | "ready" | "read" | "revoke" | "bump" | "own-send";
export type AcceptedPublication<T extends { readonly displayPlan?: unknown }> = Readonly<{
  readonly [publicationBrand]: true;
  readonly [captureBrand]?: PlainCapture;
  readonly snapshot: T;
  readonly plan: NonNullable<T["displayPlan"]>;
  readonly reason: PublicationReason;
  readonly isCurrent: () => boolean;
}>;

export function makeAcceptedPublication<T extends { readonly displayPlan?: { readonly acceptedGeneration?: unknown; readonly revision?: unknown; readonly capability?: unknown }; readonly generation?: unknown; readonly revision?: unknown }>(snapshot: T, reason: PublicationReason, isCurrent: () => boolean = () => true): AcceptedPublication<T> {
  const plan = snapshot.displayPlan;
  if (snapshot === undefined || plan === undefined || plan.acceptedGeneration !== snapshot.generation
    || plan.revision !== snapshot.revision || plan.capability === undefined) {
    throw new Error("accepted publication requires a matching snapshot display plan");
  }
  return Object.freeze({ snapshot, plan, reason, isCurrent, [publicationBrand]: true } as AcceptedPublication<T>);
}

/** Materialize bounded plain data before qualification; no getters survive staging. */
function plainCapture(): PlainCapture {
  let nodes = 0;
  const active = new Set<object>();
  const provenance = new Map<string, { readonly value: unknown; readonly height: number }>();
  const captured = new Map<object, { readonly value: unknown; readonly height: number }>();
  const copy = (v: unknown, depth: number, field?: string): { readonly value: unknown; readonly height: number } => {
    if (++nodes > 65536 || depth > 64) throw new Error("accepted view staging bound exceeded");
    if (v !== null && typeof v === "object" && capabilityTokens.has(v)) return { value: v, height: 0 };
    if (v === null || typeof v !== "object") {
      if (typeof v === "function" || typeof v === "symbol") throw new Error("accepted view requires plain data");
      return { value: v, height: 0 };
    }
    if (active.has(v)) throw new Error("accepted view requires acyclic data");
    const prior = captured.get(v);
    if (prior) {
      if (depth + prior.height > 64) throw new Error("accepted view staging bound exceeded");
      return prior;
    }
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("accepted view requires plain data");
    active.add(v);
    let height = 0;
    const child = (item: unknown, key?: string): unknown => {
      const result = copy(item, depth + 1, key);
      height = Math.max(height, result.height + 1);
      return result.value;
    };
    // One publication graph: rows/plan/group aliases share one immutable capture,
    // rather than expanding the same subtree again for each presentation path.
    const result = Array.isArray(v) ? v.map(item => child(item)) : Object.fromEntries(Object.keys(v).map(key => [key, child((v as Record<string, unknown>)[key], key)]));
    active.delete(v);
    let snapshot: { readonly value: unknown; readonly height: number } = { value: Object.freeze(result), height };
    if (field === "provenance") {
      // Only the already materialized plain value is fingerprinted. No raw getter,
      // toJSON, prototype or deep input traversal can run outside this one budget.
      let token = false;
      const key = JSON.stringify(snapshot.value, (_key, item: unknown) => {
        if (item !== null && typeof item === "object" && capabilityTokens.has(item)) token = true;
        return item;
      });
      if (!token) {
        const prior = provenance.get(key);
        if (prior) snapshot = prior;
        else provenance.set(key, snapshot);
      }
    }
    captured.set(v, snapshot);
    if (snapshot.value !== null && typeof snapshot.value === "object") captured.set(snapshot.value, snapshot);
    return snapshot;
  };
  return <T>(value: T): T => copy(value, 0).value as T;
}
function materialize<T>(value: T): T { return plainCapture()(value); }

/** Preparation and final staging share the same private counter and memo, with no reset. */
export function prepareAcceptedPublication<T extends { readonly displayPlan?: unknown }>(
  prepare: (capture: PlainCapture) => AcceptedPublication<T>): AcceptedPublication<T> {
  const capture = plainCapture();
  const publication = prepare(capture);
  return Object.freeze({ ...publication, [captureBrand]: capture });
}

/** One current reference, one staged replacement, one coalesced notification slot. */
export class AcceptedView<T> {
  private readonly value: Signal<T>;
  private epoch = 0;
  private ended = false;
  private acceptedEpoch = 0;
  private readonly capability = signal(mintCapability());
  private staged?: { handle: StagedView<T>; expected: T; epoch: number; capability: AcceptedCapability; isCurrent: () => boolean; value?: T };
  private listeners = new Set<(value: T) => void>();
  private notifying = false;
  private pending = false;
  private scheduled = false;
  constructor(initial: T) {
    this.value = signal(materialize(initial));
    const initialPlan = (initial as { readonly displayPlan?: { readonly capability?: AcceptedCapability } }).displayPlan;
    if (initialPlan?.capability && capabilityTokens.has(initialPlan.capability)) this.capability.value = initialPlan.capability;
  }
  get current(): T { return this.value.value; }
  peek(): T { return this.value.peek(); }
  isCurrent(ref: T): boolean { return !this.ended && this.value.peek() === ref && this.epoch === this.acceptedEpoch; }
  get currentCapability(): AcceptedCapability { return this.capability.value; }
  private stage(value: T, capability: AcceptedCapability, isCurrent: () => boolean, capture: PlainCapture): StagedView<T> {
    const handle = Object.freeze({}) as StagedView<T>;
    const slot = { handle, expected: this.value.peek(), epoch: this.epoch, capability, isCurrent, value: undefined as T | undefined };
    this.staged = slot;
    slot.value = capture(value);
    return handle;
  }
  publish<S extends { readonly displayPlan?: { readonly capability?: unknown }; readonly generation?: unknown }>(publication: AcceptedPublication<S>, capability: AcceptedCapability = this.capability.peek()): boolean {
    if (publication.snapshot.displayPlan !== publication.plan || publication.plan.capability !== capability
      || typeof publication.snapshot.generation !== "number"
      || typeof (this.value.peek() as { readonly generation?: unknown }).generation !== "number"
      || publication.snapshot.generation <= (this.value.peek() as { readonly generation: number }).generation) return false;
    const staged = this.stage(publication.snapshot as unknown as T, capability, publication.isCurrent, publication[captureBrand] ?? plainCapture());
    return this.commit(staged);
  }

  private commit(handle: StagedView<T>): boolean {
    const slot = this.staged;
    if (!slot || slot.handle !== handle || slot.value === undefined || this.ended) return false;
    if (!slot.isCurrent()) return false;
    // Input qualification runs before the final callback-free ownership checks.
    if (this.staged !== slot || this.capability.peek() !== slot.capability || this.epoch !== slot.epoch || this.value.peek() !== slot.expected || this.ended) return false;
    batch(() => {
      this.staged = undefined;
      ++this.epoch;
      this.acceptedEpoch = this.epoch;
      this.pending = true;
      this.value.value = slot.value!;
      this.notify();
    });
    return true;
  }
  subscribe(listener: (value: T) => void): () => void {
    if (this.ended) return () => {};
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  /** Revoke before cancellation/other external callbacks, without replacing display. */
  invalidate(): void { batch(() => { ++this.epoch; this.staged = undefined; this.pending = false; this.capability.value = mintCapability(); }); }
  revoke(): void { this.invalidate(); }
  dispose(): void { this.ended = true; this.invalidate(); this.listeners.clear(); }
  private notify(): void {
    if (this.notifying || this.ended) return;
    this.notifying = true;
    try {
      // One synchronous trailing generation; further reentry uses one microtask slot.
      for (let pass = 0; pass < 2 && this.pending && !this.ended; pass++) {
        this.pending = false;
        const value = this.value.peek(), epoch = this.epoch;
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
