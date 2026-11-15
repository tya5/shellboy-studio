import {createInputCapture} from '../../data/src/immutable-input';
import type {WindowAcceptedSnapshot} from './window';
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
const publicationBrand: unique symbol = Symbol("accepted publication");
export type PublicationReason = "receipt" | "ready" | "read" | "revoke" | "bump" | "own-send";
export type AcceptedPublication<T extends { readonly displayPlan?: unknown }> = Readonly<{
  readonly [publicationBrand]: true;
  readonly snapshot: T;
  readonly plan: NonNullable<T["displayPlan"]>;
  readonly reason: PublicationReason;
  readonly inputIdentity?:readonly unknown[];
  readonly isCurrent: () => boolean;
}>;

export function makeAcceptedPublication<T extends { readonly displayPlan?: { readonly acceptedGeneration?: unknown; readonly revision?: unknown; readonly capability?: unknown }; readonly generation?: unknown; readonly revision?: unknown }>(snapshot: T, reason: PublicationReason, isCurrent: () => boolean = () => true): AcceptedPublication<T> {
  snapshot = materialize(snapshot);
  const plan = snapshot.displayPlan;
  if (snapshot === undefined || plan === undefined || plan.acceptedGeneration !== snapshot.generation
    || plan.revision !== snapshot.revision || plan.capability === undefined) {
    throw new Error("accepted publication requires a matching snapshot display plan");
  }
  return Object.freeze({ snapshot, plan, reason, isCurrent, [publicationBrand]: true } as AcceptedPublication<T>);
}

/** Materialize bounded plain data before qualification; no getters survive staging. */
function plainCapture():PlainCapture{return createInputCapture(value=>capabilityTokens.has(value));}

function materialize<T>(value: T): T { return plainCapture()(value); }

/** Preparation and final staging share the same private counter and memo, with no reset. */
export function prepareAcceptedPublication<T extends { readonly displayPlan?: unknown }>(
  prepare: (capture: PlainCapture) => AcceptedPublication<T>): AcceptedPublication<T>;
export function prepareAcceptedPublication<T extends { readonly displayPlan?: unknown }>(
  prepare: (capture: PlainCapture) => AcceptedPublication<T> | undefined): AcceptedPublication<T> | undefined;
export function prepareAcceptedPublication<T extends { readonly displayPlan?: unknown }>(
  prepare: (capture: PlainCapture) => AcceptedPublication<T> | undefined): AcceptedPublication<T> | undefined {
  const capture = plainCapture();
  const publication = prepare(capture);
  return publication;
}

/** The Window's private typed producer; external callers use makeAcceptedPublication. */
export function makeConversationPublication(snapshot:WindowAcceptedSnapshot,reason:PublicationReason,isCurrent:()=>boolean,
 inputIdentity:readonly unknown[]):AcceptedPublication<WindowAcceptedSnapshot>{
 const freeze=<T>(items:readonly T[]|undefined)=>items?Object.freeze(items):items;
 const value=Object.freeze({...snapshot,rows:freeze(snapshot.rows)!,range:snapshot.range?Object.freeze(snapshot.range):undefined,
  assistantOwnership:freeze(snapshot.assistantOwnership),retiredAttempts:freeze(snapshot.retiredAttempts),
  terminalPersistedAttempts:freeze(snapshot.terminalPersistedAttempts),terminalPresence:freeze(snapshot.terminalPresence),
  attemptPresentations:freeze(snapshot.attemptPresentations)});
 const publication:AcceptedPublication<WindowAcceptedSnapshot>={snapshot:value,plan:value.displayPlan!,reason,isCurrent,inputIdentity:Object.freeze(inputIdentity),[publicationBrand]:true};
 return Object.freeze(publication);
}

/** One current reference, one staged replacement, one coalesced notification slot. */
export class AcceptedView<T> {
  private readonly value: Signal<T>;
  private acceptedCapability:AcceptedCapability;
  private ended = false;

  private readonly capability = signal(mintCapability());
  private staged?: { handle: StagedView<T>; expected: T; capability: AcceptedCapability; isCurrent: () => boolean; value?: T };
  private listeners = new Set<(value: T) => void>();
  private notifying = false;
  private pending = false;
  private scheduled = false;
  constructor(initial: T) {
    this.value = signal(materialize(initial));
    const initialPlan = (initial as { readonly displayPlan?: { readonly capability?: AcceptedCapability } }).displayPlan;
    if (initialPlan?.capability && capabilityTokens.has(initialPlan.capability)) this.capability.value = initialPlan.capability;
    this.acceptedCapability=this.capability.peek();
  }
  get current(): T { return this.value.value; }
  peek(): T { return this.value.peek(); }
  isCurrent(ref: T): boolean { return !this.ended && this.value.peek() === ref && this.capability.peek() === this.acceptedCapability; }
  get currentCapability(): AcceptedCapability { return this.capability.value; }
  private stage(value: T, capability: AcceptedCapability, isCurrent: () => boolean): StagedView<T> {
    const handle = Object.freeze({}) as StagedView<T>;
    const slot = { handle, expected: this.value.peek(), capability, isCurrent, value: undefined as T | undefined };
    this.staged = slot;
    slot.value = value;
    return handle;
  }
  publish<S extends { readonly displayPlan?: { readonly capability?: unknown }; readonly generation?: unknown }>(publication: AcceptedPublication<S>, capability: AcceptedCapability = this.capability.peek()): boolean {
    if (publication.snapshot.displayPlan !== publication.plan || publication.plan.capability !== capability
      || typeof publication.snapshot.generation !== "number"
      || typeof (this.value.peek() as { readonly generation?: unknown }).generation !== "number"
      || publication.snapshot.generation <= (this.value.peek() as { readonly generation: number }).generation) return false;
    const staged = this.stage(publication.snapshot as unknown as T, capability, publication.isCurrent);
    return this.commit(staged);
  }

  private commit(handle: StagedView<T>): boolean {
    const slot = this.staged;
    if (!slot || slot.handle !== handle || slot.value === undefined || this.ended) return false;
    if (!slot.isCurrent()) return false;
    // Input qualification runs before the final callback-free ownership checks.
    if (this.staged !== slot || this.capability.peek() !== slot.capability || this.value.peek() !== slot.expected || this.ended) return false;
    batch(() => {
      this.staged = undefined;
      this.acceptedCapability=slot.capability;
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
  invalidate(): void { batch(() => { this.staged = undefined; this.pending = false; this.capability.value = mintCapability(); }); }
  revoke(): void { this.invalidate(); }
  dispose(): void { this.ended = true; this.invalidate(); this.listeners.clear(); }
  private notify(): void {
    if (this.notifying || this.ended) return;
    this.notifying = true;
    try {
      // One synchronous trailing generation; further reentry uses one microtask slot.
      for (let pass = 0; pass < 2 && this.pending && !this.ended; pass++) {
        this.pending = false;
        const value = this.value.peek(), capability = this.capability.peek();
        for (const listener of [...this.listeners]) {
          if (this.ended || this.value.peek() !== value || this.capability.peek() !== capability) break;
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
