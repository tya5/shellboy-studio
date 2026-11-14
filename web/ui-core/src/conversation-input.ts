import { emptyOwnSendLocalRegion } from "./own-send-presentation";
import type { HandoffRecord } from '../../data/src/handoff';
import type { WindowAcceptedSnapshot } from './window';
import type { OwnUserDecision, ConversationDisplayPlan } from './conversation-display-plan';
import { projectHistoryWindowItems, projectOwnedHandoffFacts, projectSavedItems, retainUnretiredLiveFacts,
  normalizeTerminalPresenceFacts, scopeIssuedWorkFacts, withPresentationContainers,
  type NormalizedSavedItem, type SavedItemProjection } from './conversation-items';

export interface ConversationSemanticInput {
  readonly isCurrent: () => boolean;
  readonly scope: string;
  readonly canonicalProjection: SavedItemProjection;
  readonly projection: SavedItemProjection;
  readonly decision: OwnUserDecision;
  readonly coverage: ConversationDisplayPlan['coverage'];
}

/** One current semantic recipe for both candidate publication and fixture admission. */
export function captureConversationInput(snapshot: WindowAcceptedSnapshot, input: {
  readonly scope: string; readonly threadId: string; readonly records: readonly HandoffRecord[];
  readonly work: readonly NormalizedSavedItem[]; readonly current: boolean;
}): ConversationSemanticInput {
  const canonicalProjection = projectHistoryWindowItems({ revision: snapshot.revision ?? 0,
    nodes: snapshot.rows, keyScope: [input.scope] }).projection;
  const ownership = snapshot.assistantOwnership ?? [];
  const canonicalOwners = new Set(ownership.filter(item => item.mode === 'canonical').map(item => item.recordKey));
  const reserved = new Set(ownership.filter(item => item.mode === 'preview').flatMap(item => item.itemKeys));
  const handoffs = retainUnretiredLiveFacts(snapshot, input.scope, input.current,
    projectOwnedHandoffFacts(input.threadId, input.current ? input.records : []).filter(fact => !('domain' in fact) || !canonicalOwners.has(fact.recordId)));
  const retained = retainUnretiredLiveFacts(snapshot, input.scope, input.current,
    input.work.filter(fact => !('domain' in fact && fact.namespace === 'handoff')));
  const work = input.current ? scopeIssuedWorkFacts([...retained,
    ...normalizeTerminalPresenceFacts(snapshot.terminalPresence ?? [])], [input.scope]) : undefined;
  const projected = projectSavedItems([...canonicalProjection.items.filter(item => !reserved.has(item.key)).map(item => item.source),
    ...handoffs, ...(work ?? [])]);
  const projection = work === undefined ? Object.freeze({ ...projected,
    partitionUnknownKeys: Object.freeze([...projected.partitionUnknownKeys, 'unavailable-work-cut']) }) : projected;
  const containers = new Map<string, string>();
  for (const item of projection.items) if ('domain' in item.source && item.source.presentationContainer)
    containers.set(item.key, item.source.presentationContainer);
  const keys = new Set(projection.items.map(item => item.key));
  for (const owner of ownership.filter(item => item.mode === 'canonical'))
    for (const key of owner.itemKeys) if (keys.has(key)) containers.set(key, owner.containerKey);
  return { isCurrent: () => true, scope: input.scope, canonicalProjection, projection: withPresentationContainers(projection, containers),
    decision: { cohortVersion: { accepted: [] }, localRegion: emptyOwnSendLocalRegion(input.scope) }, coverage: work === undefined ? 'unavailable' : 'complete' };
}
