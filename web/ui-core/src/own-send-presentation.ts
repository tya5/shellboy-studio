import type {HistoryItem} from "../../data/src/protocol";
import {observeOwnSendTail,placeOwnSendRegion,type OwnSendInsertion,type OwnSendPath,type OwnSendReservation,type OwnSendPlacement,type OwnSendTailObservation} from "./own-send-region";
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
  readonly canonicalRows?: readonly HistoryItem[];
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
  readonly slots:readonly {readonly row:PendingOwnMessage;readonly insertion:OwnSendInsertion}[];
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
  const complete = cohort.length > 0 && cohort.every(row => {
    if(row.phase!=="accepted"||!row.messageId||!displayed.has(row.messageId)||row.plainMessageSend!==true)return false;
    const candidates=(input.canonicalRows??[]).filter(node=>node.node_id===row.messageId);
    if(candidates.length!==1)return false;
    const node=candidates[0]!,part=node.items?.[0];
    // Only the proven plain send route creates exactly one input text part.
    return node.kind==="user"&&node.items?.length===1&&part?.kind==="text"&&part.text_complete===true&&typeof part.text==="string"&&part.text.trim().length>0;
  });
  const sequence=input.projection.sequence??[];
  const placement=placeOwnSendRegion(input.reservation,input.scope,input.current,input.projection,input.path,input.nodeOrdinals??new Map());
  // Slot association uses the same accepted DTOs and final CASE members only.
  const slots=cohort.map(row=>{
    if(!input.current||!row.messageId||row.phase!=="accepted")return;
    const nodes=(input.canonicalRows??[]).filter(node=>node.node_id===row.messageId&&node.kind==="user");
    if(nodes.length!==1)return;
    const members=input.projection.items.filter(item=>item.source.nodeId===row.messageId);
    if(!members.length||members.some(item=>input.hiddenItemKeys.has(item.key)))return;
    const positions=sequence.flatMap((entry,index)=>{
      if(entry.kind==="conversation")return members.some(item=>item.key===entry.itemKey)?[index]:[];
      const group=input.projection.workGroups?.find(group=>group.key===entry.groupKey);
      if(!group?.memberKeys.some(key=>members.some(item=>item.key===key)))return [];
      return group.memberKeys.every(key=>members.some(item=>item.key===key))?[index]:[-1];
    });
    if(!positions.length||positions.some((position,index)=>position<0||index>0&&position!==positions[index-1]!+1))return;
    return {row,insertion:sequence[positions.at(-1)!]!,first:positions[0]!,last:positions.at(-1)!};
  });
  const allSlots=cohort.length>0&&slots.every(slot=>!!slot);
  const boundaryIndex=placement.kind==="qualified"&&placement.insertion.kind!=="beginning"
    ? sequence.findIndex(entry=>entry.kind===placement.insertion.kind&&(entry.kind==="conversation"?placement.insertion.kind==="conversation"&&entry.itemKey===placement.insertion.itemKey:placement.insertion.kind==="work"&&entry.groupKey===placement.insertion.groupKey)) : -1;
  const mutualConflict=allSlots&&slots.some((slot,index)=>index>0&&slot!.first<=slots[index-1]!.last);
  const boundaryConflict=boundaryIndex>=0&&slots.some(slot=>slot&&slot.first<=boundaryIndex);
  const conflict=mutualConflict||boundaryConflict;
  const usableSlots=allSlots&&!conflict?slots.flatMap(slot=>slot?[{row:slot.row,insertion:slot.insertion}]:[]):[];
  // Fresh canonical replacement is independent of the old local placement proof.
  const freshReplacement=input.current&&!!input.ref;
  const transfer = complete && !conflict && freshReplacement;
  const suppressedIds = new Set(transfer ? [] : cohort.flatMap(row => row.messageId ? [row.messageId] : []));
  const items = input.current ? input.projection.items.filter(item => !input.hiddenItemKeys.has(item.key) && !suppressedIds.has(item.source.nodeId ?? "")) : [];
  const keys = new Set(items.map(item => item.key));
  const projection = Object.freeze({...input.projection, items: Object.freeze(items), sequence: Object.freeze((input.current ? input.projection.sequence ?? [] : []).filter(entry => usableSlots.length>0 || entry.kind !== "conversation" || keys.has(entry.itemKey)))});
  const token=Object.freeze({});
  const observation=observeOwnSendTail(token,input.ref,input.scope,input.current,input.projection,input.path,input.validateCurrent??(()=>false));
  return Object.freeze({token,placement,slots:Object.freeze(transfer?[]:usableSlots),observation,ref:input.ref,scope:input.scope,cohortVersion:input.cohortVersion,projection,displayedSavedUserIds:displayed,
    cohort,localRows:transfer ? Object.freeze([]) : cohort,retire:transfer ? cohort : Object.freeze([]),
    conflictIds:Object.freeze(conflict ? cohort.map(row=>row.messageId!) : [])});
}
