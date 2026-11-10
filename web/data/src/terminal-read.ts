import { signal, type Signal, type ReadonlySignal } from "@preact/signals-core";
import type { TerminalPersistedProof } from "./handoff";
import type { HistoryWindowArgs, HistoryWindowResult } from "./protocol";
import type { Outcome } from "./errors";
import { Cancel } from "./operations";
export type TerminalReadTicketId = string & { readonly terminalTicket: unique symbol };
export type SelectedRequestId = string & { readonly selectedRequest: unique symbol };
export interface SelectedCanonicalRequest { readonly id: SelectedRequestId; readonly args: Readonly<HistoryWindowArgs> }
export interface TerminalReadTicket { readonly id: TerminalReadTicketId; readonly request: SelectedCanonicalRequest; readonly receipt: TerminalPersistedProof }
export type TicketOutcome =
  | { readonly phase: "queued" | "reading"; readonly ticket: TerminalReadTicket }
  | { readonly phase: "settled"; readonly ticket: TerminalReadTicket; readonly result: Outcome<HistoryWindowResult> }
  | { readonly phase: "unavailable"; readonly reason: "unsupported" | "budget-exhausted" | "capacity" | "cancelled" };
export interface OwnedTerminalReadLease { readonly ticket: TerminalReadTicket; readonly state: ReadonlySignal<TicketOutcome>; cancel(): void }
interface Marker { ticket: TerminalReadTicket; state: Signal<TicketOutcome>; leases: Set<object>; valid: () => boolean; cancel: Cancel; detach?: () => void }
/** Marker ownership is the existing receipt's scope, not the lifetime of a lease. */
export class TerminalReadSlots {
  private markers = new Map<string, Marker>();
  private serial = 0;
  request(receipt: TerminalPersistedProof, request: SelectedCanonicalRequest, valid: () => boolean, parent: Cancel): OwnedTerminalReadLease | TicketOutcome {
    const args = request.args, before = args.before ?? 0, after = args.after ?? 0;
    if (!valid()) return { phase: "unavailable", reason: "cancelled" };
    if (args.items !== true || !Number.isInteger(before) || !Number.isInteger(after) || before < 0 || after < 0 || before + after + 1 > 200)
      return { phase: "unavailable", reason: "capacity" };
    const key = JSON.stringify([receipt.scope, receipt.attemptId]);
    let marker = this.markers.get(key);
    if (!marker) {
      if (this.markers.size >= 8) return { phase: "unavailable", reason: "capacity" };
      const ticket = Object.freeze({ id: `terminal-${++this.serial}` as TerminalReadTicketId, receipt, request: Object.freeze({ id: request.id, args: Object.freeze({ ...request.args }) }) });
      marker = { ticket, state: signal<TicketOutcome>({ phase: "queued", ticket }), leases: new Set(), valid, cancel: new Cancel() };
      this.markers.set(key, marker);
      const owned = marker;
      marker.detach = parent.add(() => { owned.cancel.cancel(); owned.state.value = { phase: "unavailable", reason: "cancelled" }; owned.leases.clear(); });
    } else if (marker.ticket.request.id !== request.id || JSON.stringify(marker.ticket.request.args) !== JSON.stringify(request.args) || marker.ticket.receipt !== receipt) {
      return { phase: "unavailable", reason: "cancelled" };
    }
    if (marker.leases.size >= 2) return { phase: "unavailable", reason: "capacity" };
    const lease = {}, owned = marker; marker.leases.add(lease);
    return { ticket: marker.ticket, state: marker.state, cancel: () => {
      if (!owned.leases.delete(lease) || owned.leases.size) return;
      owned.cancel.cancel(); owned.detach?.();
      owned.state.value = { phase: "unavailable", reason: "cancelled" };
      // Keep the consumed marker: cancellation is never automatic-read permission.
    } };
  }
  get queued(): boolean { return [...this.markers.values()].some(m => m.state.peek().phase === "queued"); }
  async dispatch(takeRead: () => boolean, read: (args: HistoryWindowArgs, cancel: Cancel) => Promise<Outcome<HistoryWindowResult>>): Promise<void> {
    const marker = [...this.markers.values()].find(m => m.state.peek().phase === "queued");
    if (!marker) return;
    const valid = () => marker.valid() && !marker.cancel.cancelled && marker.leases.size > 0;
    if (!valid()) { marker.state.value = { phase: "unavailable", reason: "cancelled" }; return; }
    if (!takeRead()) { marker.state.value = { phase: "unavailable", reason: "budget-exhausted" }; return; }
    marker.state.value = { phase: "reading", ticket: marker.ticket };
    if (!valid()) return;
    try {
      const result = await read(marker.ticket.request.args, marker.cancel);
      if (valid()) marker.state.value = { phase: "settled", ticket: marker.ticket, result: structuredClone(result) };
    } finally { marker.detach?.(); }
  }
  clear(): void {
    const old = [...this.markers.values()]; this.markers.clear();
    for (const marker of old) { marker.cancel.cancel(); marker.detach?.(); marker.leases.clear(); marker.state.value = { phase: "unavailable", reason: "cancelled" }; }
  }
}
