import { signal, type Signal, type ReadonlySignal } from "@preact/signals-core";
import type { TerminalPersistedProof, HandoffRecord } from "./handoff";
import type { HistoryWindowArgs, HistoryWindowResult } from "./protocol";
import type { Outcome } from "./errors";
import { Cancel } from "./operations";
export type TerminalReadTicketId = string & { readonly terminalTicket: unique symbol };
export type SelectedRequestId = string & { readonly selectedRequest: unique symbol };
export interface SelectedReadPlan { readonly first:number; readonly last:number; readonly revision:number }
export interface SelectedCanonicalRequest {
  readonly id: SelectedRequestId;
  readonly args: Readonly<HistoryWindowArgs>;
  /** Owned logical-cut intent, never an invented public RPC argument. */
  readonly selection?: Readonly<SelectedReadPlan>;
}
export type SelectedReadAdmission =
  | { readonly kind: "persisted"; readonly receipt: TerminalPersistedProof }
  | { readonly kind: "ready"; readonly record: HandoffRecord; readonly scope: string };
function identity(admission: SelectedReadAdmission): readonly [string, string] {
  return admission.kind === "persisted" ? [admission.receipt.scope, admission.receipt.attemptId] : [admission.scope, admission.record.attemptId];
}
function sameAdmission(a: SelectedReadAdmission, b: SelectedReadAdmission): boolean {
  return a.kind === "persisted" ? b.kind === "persisted" && a.receipt === b.receipt
    : b.kind === "ready" && a.record === b.record && a.scope === b.scope;
}
export interface TerminalReadTicket { readonly id: TerminalReadTicketId; readonly request: SelectedCanonicalRequest; readonly admission: SelectedReadAdmission }
export type TicketOutcome =
  | { readonly phase: "queued" | "reading"; readonly ticket: TerminalReadTicket }
  | { readonly phase: "settled"; readonly ticket: TerminalReadTicket; readonly result: Outcome<HistoryWindowResult> }
  | { readonly phase: "unavailable"; readonly reason: "unsupported" | "budget-exhausted" | "capacity" | "cancelled" };
export interface OwnedTerminalReadLease { readonly ticket: TerminalReadTicket; readonly state: ReadonlySignal<TicketOutcome>; cancel(): void }
interface Marker { ticket: TerminalReadTicket; state: Signal<TicketOutcome>; leases: Set<OwnedTerminalReadLease>; valid: () => boolean; cancel: Cancel; detach?: () => void }
/** Marker ownership is the existing receipt's scope, not the lifetime of a lease. */
export class TerminalReadSlots {
  private markers = new Map<string, Marker>();
  private serial = 0;
  request(admission: SelectedReadAdmission, request: SelectedCanonicalRequest, valid: () => boolean, parent: Cancel): OwnedTerminalReadLease | TicketOutcome {
    const args = request.args, before = args.before ?? 0, after = args.after ?? 0;
    if (!valid()) return { phase: "unavailable", reason: "cancelled" };
    if (args.items !== true || !Number.isInteger(before) || !Number.isInteger(after) || before < 0 || after < 0 || before + after + 1 > 200)
      return { phase: "unavailable", reason: "capacity" };
    const key = JSON.stringify(identity(admission));
    let marker = this.markers.get(key);
    if (!marker) {
      if (this.markers.size >= 8) return { phase: "unavailable", reason: "capacity" };
      const ticket = Object.freeze({ id: `terminal-${++this.serial}` as TerminalReadTicketId, admission: Object.freeze({ ...admission }), request: Object.freeze({ id: request.id, args: Object.freeze({ ...request.args }),
        ...(request.selection ? { selection: Object.freeze({ ...request.selection }) } : {}) }) });
      marker = { ticket, state: signal<TicketOutcome>({ phase: "queued", ticket }), leases: new Set(), valid, cancel: new Cancel() };
      this.markers.set(key, marker);
      const owned = marker;
      marker.detach = parent.add(() => { owned.cancel.cancel(); owned.state.value = { phase: "unavailable", reason: "cancelled" }; owned.leases.clear(); });
    } else if (marker.ticket.request.id !== request.id || JSON.stringify(marker.ticket.request.args) !== JSON.stringify(request.args)
      || JSON.stringify(marker.ticket.request.selection) !== JSON.stringify(request.selection) || !sameAdmission(marker.ticket.admission, admission)) {
      return { phase: "unavailable", reason: "cancelled" };
    }
    if (marker.leases.size >= 2) return { phase: "unavailable", reason: "capacity" };
    const owned = marker;
    const lease: OwnedTerminalReadLease = { ticket: marker.ticket, state: marker.state, cancel: () => {
      if (!owned.leases.delete(lease) || owned.leases.size) return;
      owned.cancel.cancel(); owned.detach?.();
      owned.state.value = { phase: "unavailable", reason: "cancelled" };
      // Keep the consumed marker: cancellation is never automatic-read permission.
    } };
    marker.leases.add(lease);
    return lease;
  }

  replace(admission: SelectedReadAdmission, request: SelectedCanonicalRequest, valid: () => boolean, parent: Cancel): OwnedTerminalReadLease | TicketOutcome {
    const key = JSON.stringify(identity(admission)), marker = this.markers.get(key);
    if (!marker || !valid() || !marker.valid() || marker.cancel.cancelled
      || !sameAdmission(marker.ticket.admission, admission) || marker.state.peek().phase !== "settled") return { phase: "unavailable", reason: "cancelled" };
    marker.cancel.cancel(); marker.detach?.(); this.markers.delete(key);
    return this.request(admission, request, valid, parent);
  }
  isCurrent(lease: OwnedTerminalReadLease): boolean {
    const marker = this.markers.get(JSON.stringify(identity(lease.ticket.admission)));
    return !!marker && marker.ticket === lease.ticket && marker.valid() && !marker.cancel.cancelled && marker.leases.has(lease);
  }
  get queued(): boolean { return [...this.markers.values()].some(m => m.state.peek().phase === "queued"); }
  async dispatch(takeRead: () => boolean, read: (args: HistoryWindowArgs, cancel: Cancel) => Promise<Outcome<HistoryWindowResult>>, followup = true): Promise<void> {
    const marker = [...this.markers.values()].find(m => m.state.peek().phase === "queued");
    if (!marker) return;
    const valid = () => marker.valid() && !marker.cancel.cancelled && marker.leases.size > 0;
    if (!valid()) { marker.state.value = { phase: "unavailable", reason: "cancelled" }; return; }
    if (!takeRead()) { marker.state.value = { phase: "unavailable", reason: "budget-exhausted" }; return; }
    marker.state.value = { phase: "reading", ticket: marker.ticket };
    if (!valid()) { marker.state.value = { phase: "unavailable", reason: "cancelled" }; return; }
    try {
      const result = await read(marker.ticket.request.args, marker.cancel);
      marker.state.value = valid() ? { phase: "settled", ticket: marker.ticket, result: structuredClone(result) }
        : { phase: "unavailable", reason: "cancelled" };
    } finally { marker.detach?.(); }
    // A replacement can be queued synchronously by the settled callback. Consume
    // that one successor in this owned dispatch, not via resolver re-entry.
    if (followup && this.queued) await this.dispatch(takeRead, read, false);
  }
  clear(): void {
    const old = [...this.markers.values()]; this.markers.clear();
    for (const marker of old) { marker.cancel.cancel(); marker.detach?.(); marker.leases.clear(); marker.state.value = { phase: "unavailable", reason: "cancelled" }; }
  }
}
