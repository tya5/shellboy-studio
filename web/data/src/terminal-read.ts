import {HistoryWindowInput, MAX_HISTORY_ROWS} from './history-input';
import {InputCaptureError} from './immutable-input';
import { signal, type Signal, type ReadonlySignal } from "@preact/signals-core";
import type { TerminalPersistedProof, HandoffRecord } from "./handoff";
import type { HistoryItem, HistoryWindowArgs, HistoryWindowResult } from "./protocol";
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
export type TerminalDispatchOutcome = "success" | "cancelled" | "budget-exhausted" | "selection-gap" | "error" | "no-work";
export type TicketOutcome =
  | { readonly phase: "queued" | "reading"; readonly ticket: TerminalReadTicket }
  | { readonly phase: "settled"; readonly ticket: TerminalReadTicket; readonly result: Outcome<HistoryWindowInput> }
  | { readonly phase: "unavailable"; readonly reason: "unsupported" | "budget-exhausted" | "capacity" | "cancelled" | "selection-gap" };
export interface OwnedTerminalReadLease { readonly ticket: TerminalReadTicket; readonly state: ReadonlySignal<TicketOutcome>; cancel(): void }
interface Marker { ticket: TerminalReadTicket; state: Signal<TicketOutcome>; leases: Set<OwnedTerminalReadLease>; valid: () => boolean; cancel: Cancel; detach?: () => void }
function validRequest(request:SelectedCanonicalRequest):boolean{
 const {args,selection}=request,before=args.before??0,after=args.after??0;
 if(args.items!==true||!Number.isInteger(before)||!Number.isInteger(after)||before<0||after<0||before+after+1>200)return false;
 return !selection||(Number.isSafeInteger(selection.first)&&Number.isSafeInteger(selection.last)&&Number.isSafeInteger(selection.revision)
  &&selection.first>=0&&selection.last>=selection.first&&selection.last-selection.first+1<=MAX_HISTORY_ROWS&&selection.revision>=0
  &&args.ordinal===selection.first&&args.node_id===undefined&&before===0&&after===Math.min(199,selection.last-selection.first));
}

/** Marker ownership is the existing receipt's scope, not the lifetime of a lease. */
export class TerminalReadSlots {
  private markers = new Map<string, Marker>();
  private serial = 0;
  request(admission: SelectedReadAdmission, request: SelectedCanonicalRequest, valid: () => boolean, parent: Cancel): OwnedTerminalReadLease | TicketOutcome {
    if (!valid()) return { phase: "unavailable", reason: "cancelled" };
    if (!validRequest(request)) return { phase: "unavailable", reason: "capacity" };
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
    if (!validRequest(request)) return {phase:'unavailable',reason:'capacity'};
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
  async dispatch(takeRead: () => boolean, read: (args: HistoryWindowArgs, cancel: Cancel) => Promise<Outcome<HistoryWindowInput>>, followup = true): Promise<TerminalDispatchOutcome> {
    const marker = [...this.markers.values()].find(m => m.state.peek().phase === "queued");
    if (!marker) return "no-work";
    const valid = () => marker.valid() && !marker.cancel.cancelled && marker.leases.size > 0;
    let primary: TerminalDispatchOutcome = "cancelled", admitted = false;
    try {
      if (!valid()) marker.state.value = { phase: "unavailable", reason: "cancelled" };
      else if (!takeRead()) { marker.state.value = { phase: "unavailable", reason: "budget-exhausted" }; primary = "budget-exhausted"; }
      else {
        marker.state.value = { phase: "reading", ticket: marker.ticket };
        if (!valid()) marker.state.value = { phase: "unavailable", reason: "cancelled" };
        else {
          admitted = true;
          const result = await this.readOwned(marker, valid, read);
          if (!valid()) marker.state.value = { phase: "unavailable", reason: "cancelled" };
          else if (typeof result === "string") { marker.state.value = { phase: "unavailable", reason: result }; primary = result; }
          else { primary = result.ok ? "success" : "error"; marker.state.value = { phase: "settled", ticket: marker.ticket, result }; }
        }
      }
    } finally { marker.detach?.(); }
    if (admitted && followup && this.queued) {
      const successor = await this.dispatch(takeRead, read, false);
      if (primary === "success" && successor !== "success" && successor !== "no-work") return successor;
    }
    return primary;
  }
  private async readOwned(marker:Marker,valid:()=>boolean,
    read:(args:HistoryWindowArgs,cancel:Cancel)=>Promise<Outcome<HistoryWindowInput>>):
    Promise<Outcome<HistoryWindowInput>|'cancelled'|'budget-exhausted'|'selection-gap'>{
    const request=marker.ticket.request,plan=request.selection;
    if(!plan)return read(request.args,marker.cancel);
    const rows:HistoryItem[]=[],pages:HistoryWindowInput[]=[],ids=new Set<string>();let cursor:HistoryWindowInput|undefined;
    for(let first=plan.first;first<=plan.last;first+=200){
      if(!valid())return 'cancelled';
      const count=Math.min(200,plan.last-first+1);
      const page=await read({...request.args,ordinal:first,before:0,after:count-1},marker.cancel);
      if(!valid())return 'cancelled';
      if(!page.ok)return page;
      const value=page.value;
      if(value.thread_id!==request.args.thread_id||value.revision!==plan.revision||value.total<=plan.last
        ||cursor&&value.total!==cursor.total||value.items.length!==count
        ||value.items.some((row,index)=>!row.node_id||ids.has(row.node_id)||row.selection?.ordinal!==first+index))return 'selection-gap';
      for(const row of value.items){if(ids.has(row.node_id!))return 'selection-gap';ids.add(row.node_id!);rows.push(row);}
      pages.push(value);cursor??=value;
    }
    if(!cursor)return 'selection-gap';
    try{return{ok:true,value:HistoryWindowInput.join(pages)};}catch(error){if(error instanceof InputCaptureError)return{ok:false,error:{kind:'invalid_response',message:error.reason}};throw error;}
  }
  clear(): void {
    const old = [...this.markers.values()]; this.markers.clear();
    for (const marker of old) { marker.cancel.cancel(); marker.detach?.(); marker.leases.clear(); marker.state.value = { phase: "unavailable", reason: "cancelled" }; }
  }
}
