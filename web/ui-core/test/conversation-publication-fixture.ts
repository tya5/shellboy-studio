import { AcceptedView, makeAcceptedPublication, type AcceptedCapability } from '../src/accepted-view';
import { createConversationDisplayPlan, type OwnUserDecision } from '../src/conversation-display-plan';
import { captureConversationInput } from '../src/conversation-input';
import type { HistoryItem } from '../../data/src/protocol';
import type { WindowAcceptedSnapshot } from '../src/window';

export function publicationSnapshot(base: Omit<WindowAcceptedSnapshot, 'generation' | 'revision' | 'rows' | 'displayPlan'> & { generation?: number; revision: number; rows: readonly HistoryItem[] }, generation: number, capability: AcceptedCapability) {
  const snapshot: WindowAcceptedSnapshot = { ...base, generation };
  const input = captureConversationInput(snapshot, { scope: 'test', threadId: 'test', records: [], work: [], current: true });
  const plan = createConversationDisplayPlan({ coverage: input.coverage, generation, revision: base.revision, capability, rows: base.rows,
    canonicalProjection: input.canonicalProjection, projection: input.projection, assistantFacts: base.assistantOwnership ?? [],
    userDecision: input.decision, scope: input.scope, retiredAttempts: base.retiredAttempts ?? [] });
  return { ...snapshot, displayPlan: plan };
}

export function publishSnapshot(view: AcceptedView<WindowAcceptedSnapshot>, snapshot: WindowAcceptedSnapshot) {
  return view.publish(makeAcceptedPublication(snapshot, 'read'), view.currentCapability);
}
