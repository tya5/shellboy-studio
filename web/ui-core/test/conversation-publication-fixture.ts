import { AcceptedView, makeAcceptedPublication, type AcceptedCapability } from '../src/accepted-view';
import { createConversationDisplayPlan, type OwnUserDecision } from '../src/conversation-display-plan';
import { projectHistoryWindowItems } from '../src/conversation-items';
import type { HistoryItem } from '../../data/src/protocol';
import type { WindowAcceptedSnapshot } from '../src/window';

export function publicationSnapshot(base: Omit<WindowAcceptedSnapshot, 'generation' | 'revision' | 'rows' | 'displayPlan'> & { generation?: number; revision: number; rows: readonly HistoryItem[] }, generation: number, capability: AcceptedCapability) {
  const canonical = projectHistoryWindowItems({ revision: base.revision, nodes: base.rows, keyScope: ['test'] }).projection;
  const userDecision: OwnUserDecision = { cohortVersion: { accepted: [] } };
  const plan = createConversationDisplayPlan({ generation, revision: base.revision, capability, rows: base.rows,
    canonicalProjection: canonical, projection: canonical, assistantFacts: base.assistantOwnership ?? [],
    userDecision, scope: 'test', retiredAttempts: base.retiredAttempts ?? [] });
  return { ...base, generation, displayPlan: plan } as WindowAcceptedSnapshot;
}

export function publishSnapshot(view: AcceptedView<WindowAcceptedSnapshot>, snapshot: WindowAcceptedSnapshot) {
  return view.publish(makeAcceptedPublication(snapshot, 'read'), view.currentCapability);
}
