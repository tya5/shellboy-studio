import type { AssistantOwnership } from './assistant-ownership';
import type { AcceptedCapability } from './accepted-view';
import type { SavedItemProjection, ProjectedSavedItem } from './conversation-items';
import type { WindowAcceptedSnapshot } from './window';

export type DisplayBodySource =
  | Readonly<{ kind: 'preview'; text: string; generation: number; revision: string | number }>
  | Readonly<{ kind: 'typed-canonical'; text: string; generation: number; revision: string | number; capability: AcceptedCapability }>
  | Readonly<{ kind: 'unavailable'; reason: string; generation: number; revision: string | number }>;

export type DisplayLifetime = Readonly<{
  kind: 'valid-owner' | 'canonical-human' | 'retained' | 'revoked'; scope: string; generation: number; revision: string | number;
}>;
export interface ConversationDisplayPlanEntry {
  readonly item: ProjectedSavedItem;
  readonly presentationContainer?: string;
  readonly body: DisplayBodySource;
  readonly lifetime: DisplayLifetime;
}
export interface ConversationDisplayPlan {
  readonly acceptedGeneration: number;
  readonly revision: string | number;
  readonly capability: AcceptedCapability;
  readonly entries: readonly ConversationDisplayPlanEntry[];
  readonly userDecision: unknown;
  readonly cohortKey: string;
}

/** Constructed only by accepted-window publication, never by a renderer. */
export function createConversationDisplayPlan(input: {
  readonly acceptedRef: WindowAcceptedSnapshot;
  readonly capability: AcceptedCapability;
  readonly projection: SavedItemProjection;
  readonly assistantFacts: readonly AssistantOwnership[];
  readonly userDecision: unknown;
  readonly scope: string;
}): ConversationDisplayPlan {
  if (input.acceptedRef.revision === undefined || input.acceptedRef.revision === null) throw new Error('display plan requires accepted revision');
  const owners = new Map<string, AssistantOwnership>();
  for (const fact of input.assistantFacts) {
    if (fact.scope !== input.scope || !fact.itemKeys.length) continue;
    for (const key of fact.itemKeys) {
      const prior = owners.get(key);
      if (prior && prior.containerKey !== fact.containerKey) throw new Error('conflicting display owner');
      owners.set(key, fact);
    }
  }
  const generation = input.acceptedRef.generation, revision = input.acceptedRef.revision;
  const version = (input.userDecision as { cohortVersion?: { accepted?: readonly { operationId: string; phase: string; messageId?: string }[]; pending?: { operationId: string; phase: string } } } | undefined)?.cohortVersion;
  const cohortKey = JSON.stringify({ accepted: version?.accepted?.map(row => [row.operationId, row.phase, row.messageId ?? '']) ?? [], pending: version?.pending ? [version.pending.operationId, version.pending.phase] : [] });
  const entries = input.projection.items.map(item => {
    const source = item.source;
    const owner = owners.get(item.key);
    const host = ('domain' in source ? source.presentationContainer : undefined) ?? (owner?.containerKey as string | undefined);
    const body: DisplayBodySource = ((source.kind === 'text' && owner?.mode === 'canonical' && source.textComplete === true) || human)
      ? { kind: 'typed-canonical', text: source.text, generation, revision, capability: input.capability }
      : source.kind === 'text' && owner?.mode === 'preview'
        ? { kind: 'preview', text: source.text, generation, revision }
        : { kind: 'unavailable', reason: source.kind, generation, revision };
    const retired = 'domain' in source && !!source.attemptId && input.acceptedRef.retiredAttempts?.some(item => item.scope === input.scope && item.attemptId === source.attemptId && item.revision === revision);
    const human = (source.kind === 'user' || source.kind === 'summary') && source.textComplete === true;
    const lifetime: DisplayLifetime = Object.freeze({ kind: retired ? 'revoked' : human && !owner ? 'canonical-human' : owner ? 'valid-owner' : 'retained', scope: input.scope, generation, revision });
    return Object.freeze({ item, ...(host ? { presentationContainer: host } : {}), body, lifetime });
  });
  return Object.freeze({ acceptedGeneration: generation, revision, capability: input.capability, entries: Object.freeze(entries), userDecision: input.userDecision, cohortKey });
}
