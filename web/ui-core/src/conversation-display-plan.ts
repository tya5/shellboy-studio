import type { AssistantOwnership } from './assistant-ownership';
import type { AcceptedCapability } from './accepted-view';
import { projectHistoryWindowItems, type SavedItemProjection, type ProjectedSavedItem } from './conversation-items';
import type { HistoryItem } from '../../data/src/protocol';
import type { LiveWorkIdentity } from './conversation-items';

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
export interface DisplayCohortVersion { readonly accepted: readonly { readonly operationId: string; readonly phase: string; readonly messageId?: string }[]; readonly pending?: { readonly operationId: string; readonly phase: string }; }
export interface OwnUserDecision { readonly cohortVersion: DisplayCohortVersion; }

export interface ConversationDisplayPlan {
  readonly acceptedGeneration: number;
  readonly revision: string | number;
  readonly capability: AcceptedCapability;
  readonly entries: readonly ConversationDisplayPlanEntry[];
  readonly cohortKey: string;
  readonly cohortVersion: DisplayCohortVersion;
  readonly scope: string;
  readonly semanticKey: string;
}

/** Constructed only by accepted-window publication, never by a renderer. */
export type QualifiedAssistantFacts = readonly AssistantOwnership[];

export function validateQualifiedAssistantFacts(input: {
  readonly rows: readonly HistoryItem[];
  readonly projection: SavedItemProjection;
  readonly canonicalProjection: SavedItemProjection;
  readonly facts: readonly AssistantOwnership[];
  readonly revision: string | number;
  readonly scope: string;
}): QualifiedAssistantFacts {
  const rebuilt = projectHistoryWindowItems({ revision: input.revision, nodes: input.rows, keyScope: [input.scope] }).projection;
  if (rebuilt.items.length !== input.canonicalProjection.items.length || rebuilt.items.some((item, index) => item.key !== input.canonicalProjection.items[index]?.key)) return Object.freeze([]);
  const keys = new Set(rebuilt.items.map(item => item.key));
  const accepted = input.facts.filter(fact => fact.scope === input.scope && fact.proofRevision === input.revision
    && fact.itemKeys.length > 0 && fact.itemKeys.every(key => keys.has(key)));
  return Object.freeze(accepted);
}

export function displaySemanticKey(canonicalProjection: SavedItemProjection, displayProjection: SavedItemProjection,
  facts: QualifiedAssistantFacts, retiredAttempts: readonly { readonly scope: string; readonly attemptId: string; readonly revision: string | number }[]): string {
  // Version the complete authoritative projections and proofs, including body/read state and path order.
  return JSON.stringify({ canonical: canonicalProjection.items, display: displayProjection.items, facts, retiredAttempts });
}

export interface AcceptedPublicationInput {
  readonly generation: number;
  readonly revision: string | number;
  readonly capability: AcceptedCapability;
  readonly rows: readonly HistoryItem[];
  readonly projection: SavedItemProjection;
  readonly canonicalProjection: SavedItemProjection;
  readonly assistantFacts: readonly AssistantOwnership[];
  readonly userDecision: OwnUserDecision;
  readonly scope: string;
  readonly retiredAttempts: readonly { readonly scope: string; readonly attemptId: string; readonly revision: string | number }[];
}

export function createConversationDisplayPlan(input: AcceptedPublicationInput): ConversationDisplayPlan {
  if (!Number.isSafeInteger(input.generation)) throw new Error('display plan requires accepted generation');
  const qualifiedFacts = validateQualifiedAssistantFacts({ rows: input.rows, projection: input.projection, facts: input.assistantFacts, revision: input.revision, scope: input.scope });
  const owners = new Map<string, AssistantOwnership>();
  for (const fact of qualifiedFacts) {
    if (fact.scope !== input.scope || !fact.itemKeys.length) continue;
    for (const key of fact.itemKeys) {
      const prior = owners.get(key);
      if (prior && prior.containerKey !== fact.containerKey) throw new Error('conflicting display owner');
      owners.set(key, fact);
    }
  }
  const generation = input.generation, revision = input.revision;
  const semanticKey = displaySemanticKey(input.canonicalProjection, input.projection, qualifiedFacts, input.retiredAttempts);
  const version = input.userDecision.cohortVersion;
  const cohortKey = [...version.accepted.map(row => `${row.operationId}:${row.phase}:${row.messageId ?? ''}`), version.pending ? `pending:${version.pending.operationId}:${version.pending.phase}` : 'pending:none'].join('|');
  const entries = input.projection.items.map(item => {
    const source = item.source;
    const owner = owners.get(item.key);
    const host = ('domain' in source ? (source as LiveWorkIdentity).presentationContainer : undefined) ?? (owner?.containerKey as string | undefined);
    const human = (source.kind === 'user' || source.kind === 'summary') && source.textComplete === true;
    const body: DisplayBodySource = ((source.kind === 'text' && owner?.mode === 'canonical' && source.textComplete === true) || human)
      ? { kind: 'typed-canonical', text: source.text, generation, revision, capability: input.capability }
      : source.kind === 'text' && (owner?.mode === 'preview' || !!host)
        ? { kind: 'preview', text: source.text, generation, revision }
        : { kind: 'unavailable', reason: source.kind, generation, revision };
    const retired = 'domain' in source && !!source.attemptId && input.retiredAttempts.some(item => item.scope === input.scope && item.attemptId === source.attemptId && item.revision === revision);
    const lifetime: DisplayLifetime = Object.freeze({ kind: retired ? 'revoked' : human && !owner ? 'canonical-human' : owner || host ? 'valid-owner' : 'retained', scope: input.scope, generation, revision });
    return Object.freeze({ item, ...(host ? { presentationContainer: host } : {}), body, lifetime });
  });
  return Object.freeze({ acceptedGeneration: generation, revision, capability: input.capability, entries: Object.freeze(entries), cohortKey, cohortVersion: version, scope: input.scope, semanticKey });
}
