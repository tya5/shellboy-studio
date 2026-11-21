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
  readonly accepted: object; readonly pending: object | undefined;
  readonly retryCurrent: (() => boolean) | undefined; readonly eligible: boolean;
}
export function createConversationIdentity(base: Omit<ConversationIdentity, 'own'>, own?: OwnSendIdentity): ConversationIdentity {
  return Object.freeze(own ? { ...base, own } : base);
}
function ownSendIdentityEqual(a: OwnSendIdentity | undefined, b: OwnSendIdentity | undefined): boolean {
  return a === b || (!!a && !!b && a.accepted === b.accepted && a.pending === b.pending
    && a.retryCurrent === b.retryCurrent && a.eligible === b.eligible);
}
export function conversationIdentityEqual(a: ConversationIdentity, b: ConversationIdentity): boolean {
  return a.rows === b.rows && a.revision === b.revision && a.records === b.records
    && a.work.source === b.work.source && ownSendIdentityEqual(a.own, b.own) && a.scope === b.scope && a.current === b.current;
}


export interface ConversationSemanticInput {
  readonly liveOrdinals?: ReadonlyMap<string, number>;
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
  readonly liveOrdinals?: ReadonlyMap<string, number>;
  readonly work: WorkCaptureDescriptor; readonly current: () => boolean;
}): ConversationSemanticInput {
  const canonicalInput=canonicalHistoryInput(snapshot,input.scope),canonicalProjection=canonicalInput.projection;
  const current = input.current();
  const retained = current ? input.work.facts : [];
  // Unsaved facts are only a suffix of a tail-complete accepted cut. An older
  // window must not render them after an incomplete canonical prefix.
  const tailComplete = snapshot.total === 0 || snapshot.range?.last === snapshot.total - 1;
  const live = current && tailComplete ? projectOwnedHandoffFacts(input.scope, input.records) : [];
  const work = current && tailComplete ? scopeIssuedWorkFacts([...live, ...retained], [input.scope]) : undefined;
  const acceptedAttempts = new Set(snapshot.rows.flatMap(row => row.kind === "assistant_response" && row.provenance?.attempt_id ? [String(row.provenance.attempt_id)] : []));
  const remainingWork = work?.filter(item => !("domain" in item && item.domain === "live" && item.namespace === "handoff" && item.attemptId && acceptedAttempts.has(String(item.attemptId)))) ?? [];
  const projected = work?.length ? projectSavedItems([...canonicalProjection.items.map(item => item.source), ...remainingWork]) : canonicalProjection;
  return { liveOrdinals: input.liveOrdinals, isCurrent: input.current,
    identity: createConversationIdentity({ rows: snapshot.rows, revision: snapshot.revision, records: input.records,
      work: input.work, scope: input.scope, current }),
    canonicalInput, scope: input.scope, canonicalProjection, projection: projected,
    decision: { cohortVersion: { accepted: [] }, localRegion: emptyOwnSendLocalRegion(input.scope) },
    coverage: work === undefined ? 'unavailable' : 'complete' };
}
