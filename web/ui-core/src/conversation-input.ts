import { emptyOwnSendLocalRegion } from "./own-send-presentation";
import type { HandoffRecord } from '../../data/src/handoff';
import type { WorkItem } from '../../data/src/protocol';
import type { WindowAcceptedSnapshot } from './window';
import type { OwnUserDecision, ConversationDisplayPlan } from './conversation-display-plan';
import { projectHistoryWindowItems, projectOwnedHandoffFacts, projectSavedItems, retainUnretiredLiveFacts,
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
  const live = current ? projectOwnedHandoffFacts(input.scope, input.records) : [];
  const work = current ? scopeIssuedWorkFacts([...retained, ...live], [input.scope]) : undefined;
  const projected = work?.length ? projectSavedItems([...work, ...canonicalProjection.items.map(item => item.source)]) : canonicalProjection;
  return { isCurrent: input.current,
    identity: createConversationIdentity({ rows: snapshot.rows, revision: snapshot.revision, records: input.records,
      work: input.work, scope: input.scope, current }),
    canonicalInput, scope: input.scope, canonicalProjection, projection: projected,
    decision: { cohortVersion: { accepted: [] }, localRegion: emptyOwnSendLocalRegion(input.scope) },
    coverage: work === undefined ? 'unavailable' : 'complete' };
}
