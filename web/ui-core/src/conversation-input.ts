import type { HistoryItem } from "../../data/src/protocol";
import { ownSendPresentation, type OwnSendTailRow } from "./own-send-presentation";
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
   &&(held.rows === snapshot.rows || held.rows.every((row,index)=>row===snapshot.rows[index]));
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
const workBySource = new WeakMap<object, { scope: string; descriptor: WorkCaptureDescriptor }>();
export function captureCurrentWork(scope: string, value: { readonly items: readonly WorkItem[] } | undefined): WorkCaptureDescriptor {
  if (!value) return EMPTY_WORK_DESCRIPTOR;
  const previous = workBySource.get(value);
  if (previous?.scope === scope) return previous.descriptor;
  const descriptor = captureWork(value, normalizeLiveWorkFacts({ scope, items: value.items }));
  workBySource.set(value, { scope, descriptor });
  return descriptor;
}

export interface OwnSendIdentity {
  readonly accepted: object; readonly pending: object | undefined;
  readonly sendCurrent: (() => boolean) | undefined; readonly eligible: boolean;
}
export function createConversationIdentity(base: Omit<ConversationIdentity, 'own'>, own?: OwnSendIdentity): ConversationIdentity {
  return Object.freeze(own ? { ...base, own } : base);
}
function ownSendIdentityEqual(a: OwnSendIdentity | undefined, b: OwnSendIdentity | undefined): boolean {
  return a === b || (!!a && !!b && a.accepted === b.accepted && a.pending === b.pending
    && a.sendCurrent === b.sendCurrent && a.eligible === b.eligible);
}
export function conversationIdentityEqual(a: ConversationIdentity, b: ConversationIdentity): boolean {
  return a.rows === b.rows && a.revision === b.revision && a.records === b.records
    && a.work.source === b.work.source && ownSendIdentityEqual(a.own, b.own) && a.scope === b.scope && a.current === b.current;
}


export interface ConversationSemanticInput {
  readonly liveTail?: readonly OwnSendTailRow[];
  readonly isCurrent: () => boolean;
  readonly identity:ConversationIdentity;
  readonly canonicalInput:CanonicalHistoryInput;
  readonly scope: string;
  readonly canonicalProjection: SavedItemProjection;
  readonly projection: SavedItemProjection;
  readonly decision: OwnUserDecision;
  readonly coverage: ConversationDisplayPlan['coverage'];
}

const attemptsByRows = new WeakMap<readonly HistoryItem[], ReadonlySet<string>>();
export function savedAttemptIds(rows: readonly HistoryItem[]): ReadonlySet<string> {
  let held = attemptsByRows.get(rows);
  if (!held) {
    held = new Set(rows.flatMap(row => row.kind === "assistant_response" && row.provenance?.attempt_id ? [row.provenance.attempt_id] : []));
    attemptsByRows.set(rows, held);
  }
  return held;
}

const projectionsWithWork = new WeakMap<SavedItemProjection, WeakMap<object, SavedItemProjection>>();
function projectWithWork(canonical: SavedItemProjection, input: WorkCaptureDescriptor, work: readonly NormalizedSavedItem[]): SavedItemProjection {
  let bySource = projectionsWithWork.get(canonical);
  if (!bySource) { bySource = new WeakMap(); projectionsWithWork.set(canonical, bySource); }
  let held = bySource.get(input.source);
  if (!held) {
    held = projectSavedItems([...canonical.items.map(item => item.source), ...work]);
    bySource.set(input.source, held);
  }
  return held;
}

const projectedHandoffs = new WeakMap<HandoffRecord, { scope: string; rows: readonly OwnSendTailRow[] }>();
function projectHandoff(scope: string, record: HandoffRecord): readonly OwnSendTailRow[] {
  const cached = projectedHandoffs.get(record);
  if (cached?.scope === scope) return cached.rows;
  const live = scopeIssuedWorkFacts(projectOwnedHandoffFacts(scope, [record]), [scope])!;
  const rows = projectSavedItems(live).items.map(item => ({ kind: "live" as const, inputThroughNodeId: record.inputThroughNodeId, item, ...(record.outputLimit ? { outputLimit: record.outputLimit } : {}) }));
  projectedHandoffs.set(record, { scope, rows });
  return rows;
}

/** One current semantic recipe for both candidate publication and fixture admission. */
export function captureConversationInput(snapshot: WindowAcceptedSnapshot, input: {
  readonly scope: string; readonly threadId: string; readonly records: readonly HandoffRecord[];
  readonly work: WorkCaptureDescriptor; readonly current: () => boolean;
}): ConversationSemanticInput {
  const canonicalInput=canonicalHistoryInput(snapshot,input.scope),canonicalProjection=canonicalInput.projection;
  const current = input.current();
  const tailComplete = snapshot.total === 0 || snapshot.range?.last === snapshot.total - 1;
  const work = current && tailComplete ? scopeIssuedWorkFacts(input.work.facts, [input.scope]) : undefined;
  const acceptedAttempts = savedAttemptIds(snapshot.rows);
  const liveTail = work ? input.records.flatMap(record => acceptedAttempts.has(record.attemptId) ? [] : projectHandoff(input.scope, record)) : [];
  const projected = work?.length ? projectWithWork(canonicalProjection, input.work, work) : canonicalProjection;
  return { liveTail, isCurrent: input.current,
    identity: createConversationIdentity({ rows: snapshot.rows, revision: snapshot.revision, records: input.records,
      work: input.work, scope: input.scope, current }),
    canonicalInput, scope: input.scope, canonicalProjection, projection: projected,
    decision: { cohortVersion: { accepted: [] }, localRegion: ownSendPresentation(input.scope, [], snapshot.rows, liveTail, projected) },
    coverage: work === undefined ? 'unavailable' : 'complete' };
}
