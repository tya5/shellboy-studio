import { emptyOwnSendLocalRegion } from "./own-send-presentation";
import type { HandoffRecord } from '../../data/src/handoff';
import type { WorkItem } from '../../data/src/protocol';
import type { WindowAcceptedSnapshot } from './window';
import type { OwnUserDecision, ConversationDisplayPlan } from './conversation-display-plan';
import { projectHistoryWindowItems, projectOwnedHandoffFacts, projectSavedItems,
  normalizeLiveWorkFacts, scopeIssuedWorkFacts,
  type NormalizedSavedItem, type SavedItemProjection } from './conversation-items';

export interface CanonicalHistoryInput {
 readonly rows:WindowAcceptedSnapshot['rows'];readonly revision:number|undefined;readonly scope:string;
 readonly projection:SavedItemProjection;
}
function canonicalHistoryInput(snapshot:WindowAcceptedSnapshot,scope:string):CanonicalHistoryInput{
 const held=snapshot.canonicalInput;
 const sameRows=held&&held.revision===snapshot.revision&&held.rows.length===snapshot.rows.length
   &&held.rows.every((row,index)=>row===snapshot.rows[index]);
 if(held&&sameRows&&held.scope===scope)return held;
 return Object.freeze({rows:snapshot.rows,revision:snapshot.revision,scope,
  projection:projectHistoryWindowItems({revision:snapshot.revision??0,nodes:snapshot.rows,keyScope:Object.freeze([scope])}).projection});
}

export interface ConversationIdentity {
  readonly rows: WindowAcceptedSnapshot['rows']; readonly revision: number | undefined;
  readonly records?: readonly HandoffRecord[]; readonly work: WorkCaptureDescriptor;
  readonly own?: OwnSendIdentity; readonly scope: string; readonly current: boolean;
}
export interface WorkCaptureDescriptor {
  readonly source: object;
  readonly facts: readonly NormalizedSavedItem[];
}
export const EMPTY_WORK_SOURCE = Object.freeze({});
export const EMPTY_WORK_DESCRIPTOR: WorkCaptureDescriptor = Object.freeze({ source: EMPTY_WORK_SOURCE, facts: Object.freeze([]) });
export function captureWork(source: object, facts: readonly NormalizedSavedItem[]): WorkCaptureDescriptor {
  return Object.freeze({ source, facts: Object.freeze([...facts]) });
}
export function captureCurrentWork(scope: string, value: { readonly items: readonly WorkItem[] } | undefined): WorkCaptureDescriptor {
  return value ? captureWork(value, normalizeLiveWorkFacts({ scope, items: value.items })) : EMPTY_WORK_DESCRIPTOR;
}
export interface OwnSendIdentity {
  readonly accepted: object; readonly pending: object | undefined; readonly reservation: object | undefined;
  readonly retryCurrent: (() => boolean) | undefined; readonly eligible: boolean;
}
export function createConversationIdentity(base: Omit<ConversationIdentity, 'own'>, own?: OwnSendIdentity): ConversationIdentity {
  return Object.freeze(own ? { ...base, own } : base);
}
function ownSendIdentityEqual(a: OwnSendIdentity | undefined, b: OwnSendIdentity | undefined): boolean {
  return a === b || (!!a && !!b && a.accepted === b.accepted && a.pending === b.pending
    && a.reservation === b.reservation && a.retryCurrent === b.retryCurrent && a.eligible === b.eligible);
}
export function conversationIdentityEqual(a: ConversationIdentity, b: ConversationIdentity): boolean {
  return a.rows === b.rows && a.revision === b.revision && a.records === b.records
    && a.work.source === b.work.source && ownSendIdentityEqual(a.own, b.own) && a.scope === b.scope && a.current === b.current;
}


/** Keep canonical history as the chronology spine; replace matching live attempts at their saved slot.
 * Unmatched live/work facts stay in their captured order after the nearest matched slot. */
export function orderSemanticSources(
  snapshot: WindowAcceptedSnapshot,
  canonical: readonly NormalizedSavedItem[],
  overlays: readonly NormalizedSavedItem[],
): readonly NormalizedSavedItem[] {
  const nodeIndexes = new Map<string, number[]>();
  canonical.forEach((item, index) => { if ("nodeId" in item && typeof item.nodeId === "string") nodeIndexes.set(item.nodeId, [...(nodeIndexes.get(item.nodeId) ?? []), index]); });
  const nodeIndex = new Map([...nodeIndexes].flatMap(([nodeId, indexes]) => indexes.every((index, offset) => index === indexes[0]! + offset)
    ? [[nodeId, indexes.at(-1)!] as const] : []));
  const attemptIndex = new Map(snapshot.rows.flatMap(row => row.kind === "assistant_response" && row.provenance?.attempt_id && row.node_id
    ? [[String(row.provenance.attempt_id), nodeIndex.get(row.node_id)] as const] : []));
  const pending: NormalizedSavedItem[][] = Array.from({ length: canonical.length + 1 }, () => []);
  let anchor: number | undefined;
  for (const item of overlays) {
    if (!("domain" in item) || item.domain !== "live") { pending[anchor ?? canonical.length]!.push(item); continue; }
    const ownMatch = item.attemptId ? attemptIndex.get(String(item.attemptId)) : undefined;
    const predecessorMatch = ownMatch === undefined ? (item.afterAttemptId ? attemptIndex.get(String(item.afterAttemptId)) : item.afterNodeId ? nodeIndex.get(item.afterNodeId) : undefined) : undefined;
    if (ownMatch !== undefined) { anchor = ownMatch + 1; continue; }
    if (predecessorMatch !== undefined) { anchor = predecessorMatch + 1; pending[anchor]!.push(item); continue; }
    // No observed placement provenance: keep the canonical boundary, never invent an anchor.
    pending[anchor ?? canonical.length]!.push(item);
  }
  const ordered: NormalizedSavedItem[] = [];
  for (let index = 0; index <= canonical.length; index++) {
    if (index) ordered.push(canonical[index - 1]!);
    ordered.push(...pending[index]!);
  }
  return Object.freeze(ordered);
}
export interface ConversationSemanticInput {
  readonly isCurrent: () => boolean;
  readonly identity:ConversationIdentity;
  readonly canonicalInput:CanonicalHistoryInput;
  readonly scope: string;
  readonly canonicalProjection: SavedItemProjection;
  readonly projection: SavedItemProjection;
  readonly decision: OwnUserDecision;
  readonly coverage: ConversationDisplayPlan['coverage'];
}

/** One current semantic recipe for both candidate publication and fixture admission. */
export function captureConversationInput(snapshot: WindowAcceptedSnapshot, input: {
  readonly scope: string; readonly threadId: string; readonly records: readonly HandoffRecord[];
  readonly work: WorkCaptureDescriptor; readonly current: () => boolean;
}): ConversationSemanticInput {
  const canonicalInput=canonicalHistoryInput(snapshot,input.scope),canonicalProjection=canonicalInput.projection;
  const current = input.current();
  const retained = current ? input.work.facts : [];
  const live = current ? projectOwnedHandoffFacts(input.scope, input.records, input.placements) : [];
  const work = current ? scopeIssuedWorkFacts([...live, ...retained], [input.scope]) : undefined;
  const projected = work?.length ? projectSavedItems(orderSemanticSources(snapshot, canonicalProjection.items.map(item => item.source), work)) : canonicalProjection;
  return { isCurrent: input.current,
    identity: createConversationIdentity({ rows: snapshot.rows, revision: snapshot.revision, records: input.records,
      work: input.work, scope: input.scope, current }),
    canonicalInput, scope: input.scope, canonicalProjection, projection: projected,
    decision: { cohortVersion: { accepted: [] }, localRegion: emptyOwnSendLocalRegion(input.scope) },
    coverage: work === undefined ? 'unavailable' : 'complete' };
}
