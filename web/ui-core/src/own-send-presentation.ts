import {observeOwnSendTail,placeOwnSendRegion,type OwnSendPath,type OwnSendReservation,type OwnSendPlacement,type OwnSendTailObservation} from "./own-send-region";
import type { SavedItemProjection } from "./conversation-items";
import type { PendingOwnMessage } from "./model";

export interface OwnSendPresentation<Ref> {
  readonly token: object;
  readonly ref: Ref | undefined;
  readonly scope: string;
  readonly cohortVersion?: Readonly<{accepted: readonly PendingOwnMessage[]; pending: PendingOwnMessage | undefined}>;
  readonly projection: SavedItemProjection;
  readonly displayedSavedUserIds: ReadonlySet<string>;
  readonly localRows: readonly PendingOwnMessage[];
  readonly retire: readonly PendingOwnMessage[];
}

export interface OwnSendPresentationInput<Ref> {
  readonly ref: Ref | undefined;
  readonly current: boolean;
  readonly scope: string;
  readonly cohortVersion?: Readonly<{accepted: readonly PendingOwnMessage[]; pending: PendingOwnMessage | undefined}>;
  readonly projection: SavedItemProjection;
  readonly localRows: readonly PendingOwnMessage[];
  /** Supplied by the final renderer adapter, never derived from node presence. */
  readonly hiddenItemKeys: ReadonlySet<string>;
  readonly path?:OwnSendPath;
  readonly nodeOrdinals?:ReadonlyMap<string,number>;
  readonly reservation?:OwnSendReservation<Ref>;
  readonly validateCurrent?:()=>boolean;
}

// Existing CASE classification authorizes the kind; explicit completeness and
// final membership authorize replacement. No aggregate/body equivalence joins.
export function completeDisplayedOwnUserIds<Ref>(input: OwnSendPresentationInput<Ref>): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!input.current || !input.ref) return ids;
  const mounted = new Set((input.projection.sequence ?? []).flatMap(entry=>entry.kind==="conversation"?[entry.itemKey]:[]));
  for (const item of input.projection.items) {
    const source = item.source;
    if (mounted.has(item.key) && !input.hiddenItemKeys.has(item.key) && item.classification?.classification === "conversation" &&
      source.kind === "user" && source.textComplete === true &&
      typeof source.text === "string" && source.text.trim() !== "" && source.nodeId) ids.add(source.nodeId);
  }
  return ids;
}

export interface OwnSendDecision<Ref> extends OwnSendPresentation<Ref> {
  readonly cohort: readonly PendingOwnMessage[];
  readonly conflictIds: readonly string[];
  readonly placement:OwnSendPlacement;
  readonly observation?:OwnSendTailObservation<Ref>;
}

export function ownSendPresentation<Ref>(input: OwnSendPresentationInput<Ref>): OwnSendDecision<Ref> {
  const cohort = Object.freeze(input.localRows.filter(row => row.scope === input.scope));
  const displayed = completeDisplayedOwnUserIds(input);
  const orderedIds: string[] = [];
  for (const entry of input.projection.sequence ?? []) {
    if (entry.kind !== "conversation") continue;
    const item = input.projection.items.find(candidate => candidate.key === entry.itemKey);
    if (item?.source.nodeId && displayed.has(item.source.nodeId)) orderedIds.push(item.source.nodeId);
  }
  const complete = cohort.length > 0 && cohort.every(row => row.phase === "accepted" && !!row.messageId && displayed.has(row.messageId));
  const positions = cohort.map(row => orderedIds.indexOf(row.messageId ?? ""));
  const conflict = complete && positions.some((position, index) => index > 0 && position <= positions[index - 1]!);
  const placement=placeOwnSendRegion(input.reservation,input.scope,input.current,input.projection,input.path,input.nodeOrdinals??new Map());
  const transfer = complete && !conflict && placement.kind==="qualified";
  const suppressedIds = new Set(transfer ? [] : cohort.flatMap(row => row.messageId ? [row.messageId] : []));
  const items = input.current ? input.projection.items.filter(item => !input.hiddenItemKeys.has(item.key) && !suppressedIds.has(item.source.nodeId ?? "")) : [];
  const keys = new Set(items.map(item => item.key));
  const projection = Object.freeze({...input.projection, items: Object.freeze(items), sequence: Object.freeze((input.current ? input.projection.sequence ?? [] : []).filter(entry => entry.kind !== "conversation" || keys.has(entry.itemKey)))});
  const token=Object.freeze({});
  const observation=observeOwnSendTail(token,input.ref,input.scope,input.current,input.projection,input.path,input.validateCurrent??(()=>false));
  return Object.freeze({token,placement,observation,ref:input.ref,scope:input.scope,cohortVersion:input.cohortVersion,projection,displayedSavedUserIds:displayed,
    cohort,localRows:transfer ? Object.freeze([]) : cohort,retire:transfer ? cohort : Object.freeze([]),
    conflictIds:Object.freeze(conflict ? cohort.map(row=>row.messageId!) : [])});
}
