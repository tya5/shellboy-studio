import type { OwnSendLocalRegion } from "./own-send-presentation";
import { captureWorkElement, type CapturedWorkElement } from "./work-element-display";
import type { AssistantOwnership } from './assistant-ownership';
import type { AcceptedCapability } from './accepted-view';
import { projectHistoryWindowItems, type SavedItemProjection, type ProjectedSavedItem, type ConversationSequence, type WorkGroup } from './conversation-items';
import type { HistoryItem } from '../../data/src/protocol';
import type { LiveWorkIdentity } from './conversation-items';

export interface DisplayCut {
  readonly generation: number; readonly revision: number; readonly scope: string;
  readonly capability: AcceptedCapability;
}
export type DisplayBodySource =
  | Readonly<{ kind: 'preview'; text: string; cut: DisplayCut }>
  | Readonly<{ kind: 'typed-canonical'; text: string; cut: DisplayCut }>
  | Readonly<{ kind: 'unavailable'; reason: string; cut: DisplayCut }>;

export type DisplayLifetime = Readonly<{
  kind: 'valid-owner' | 'canonical-human' | 'retained' | 'revoked'; cut: DisplayCut;
}>;
export interface ConversationDisplayPlanEntry {
  readonly item: ProjectedSavedItem;
  readonly presentationContainer?: string;
  readonly body: DisplayBodySource;
  readonly work?: CapturedWorkElement;
  readonly lifetime: DisplayLifetime;
}
export interface DisplayCohortVersion { readonly accepted: readonly { readonly operationId: string; readonly phase: string; readonly messageId?: string }[]; readonly pending?: { readonly operationId: string; readonly phase: string }; }
export interface OwnUserDecision { readonly cohortVersion: DisplayCohortVersion; readonly localRegion: OwnSendLocalRegion; }

export interface ConversationDisplayPlan {
  readonly acceptedGeneration: number;
  readonly revision: number | undefined;
  readonly capability: AcceptedCapability;
  readonly coverage: "complete" | "unavailable";
  readonly entries: readonly ConversationDisplayPlanEntry[];
  readonly sequence: readonly ConversationSequence[];
  readonly workGroups: readonly WorkGroup[];
  readonly partitionUnknownKeys: readonly string[];
  readonly cohortKey: string;
  readonly cohortVersion: DisplayCohortVersion;
  readonly localRegion: OwnSendLocalRegion;
  readonly scope: string;
  readonly semanticKey: string;
}

/** Constructed only by accepted-window publication, never by a renderer. */
export type QualifiedAssistantFacts = readonly AssistantOwnership[];

export function validateQualifiedAssistantFacts(input: {
  readonly rows: readonly HistoryItem[];
  readonly canonicalProjection: SavedItemProjection;
  readonly facts: readonly AssistantOwnership[];
  readonly revision: number;
  readonly scope: string;
}): QualifiedAssistantFacts {
  if (!input.facts.length) return Object.freeze([]);
  const rebuilt = projectHistoryWindowItems({ revision: input.revision, nodes: input.rows, keyScope: [input.scope] }).projection;
  if (rebuilt.items.length !== input.canonicalProjection.items.length || rebuilt.items.some((item, index) => item.key !== input.canonicalProjection.items[index]?.key)) return Object.freeze([]);
  const keys = new Set(rebuilt.items.map(item => item.key));
  const accepted = input.facts.filter(fact => fact.scope === input.scope && fact.proofRevision === input.revision
    && fact.itemKeys.length > 0 && fact.itemKeys.every(key => keys.has(key)));
  return Object.freeze(accepted);
}

export function displaySemanticKey(canonicalProjection: SavedItemProjection, displayProjection: SavedItemProjection,
  facts: QualifiedAssistantFacts, retiredAttempts: readonly { readonly scope: string; readonly attemptId: string; readonly revision: number }[], work: ReadonlyMap<string, CapturedWorkElement>, localRegion: OwnSendLocalRegion): string {
  // Version the complete authoritative projections and proofs, including body/read state and path order.
  return JSON.stringify({ canonical: { items: canonicalProjection.items, sequence: canonicalProjection.sequence, workGroups: canonicalProjection.workGroups, partitionUnknownKeys: canonicalProjection.partitionUnknownKeys }, display: { items: displayProjection.items, sequence: displayProjection.sequence, workGroups: displayProjection.workGroups, partitionUnknownKeys: displayProjection.partitionUnknownKeys }, facts, retiredAttempts, work: [...work.values()].map(capture => ({ key: capture.key, metadata: capture.metadata })), localRegion });
}

export interface AcceptedPublicationInput {
  readonly coverage: ConversationDisplayPlan["coverage"];
  readonly generation: number;
  readonly revision: number;
  readonly capability: AcceptedCapability;
  readonly rows: readonly HistoryItem[];
  readonly projection: SavedItemProjection;
  readonly canonicalProjection: SavedItemProjection;
  readonly assistantFacts: readonly AssistantOwnership[];
  readonly userDecision: OwnUserDecision;
  readonly scope: string;
  readonly retiredAttempts: readonly { readonly scope: string; readonly attemptId: string; readonly revision: number }[];
}

export function conversationCohortKey(version: DisplayCohortVersion): string {
  return [...version.accepted.map(row => `${row.operationId}:${row.phase}:${row.messageId ?? ''}`), version.pending ? `pending:${version.pending.operationId}:${version.pending.phase}` : 'pending:none'].join('|');
}

export function createConversationDisplayPlan(input: AcceptedPublicationInput): ConversationDisplayPlan {
  if (!Number.isSafeInteger(input.generation)) throw new Error('display plan requires accepted generation');
  const qualifiedFacts = validateQualifiedAssistantFacts({ rows: input.rows, canonicalProjection: input.canonicalProjection, facts: input.assistantFacts, revision: input.revision, scope: input.scope });
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
  const cut: DisplayCut = Object.freeze({ generation, revision, capability: input.capability, scope: input.scope });
  const work = new Map<string, CapturedWorkElement>();
  const workContexts = new Map<string, CapturedWorkElement["metadata"]>();
  for (const item of input.projection.items) {
    const capture = captureWorkElement(item);
    if (!capture) continue;
    // Equal immutable issuer contexts share one bounded capture in this cut.
    // Receipt identity is source-owned and must never be interned by value.
    if (capture.metadata.receipt) { work.set(item.key, capture); continue; }
    const key = JSON.stringify(capture.metadata);
    const metadata = workContexts.get(key) ?? capture.metadata;
    workContexts.set(key, metadata);
    work.set(item.key, Object.freeze({ ...capture, metadata }));
  }
  const semanticKey = displaySemanticKey(input.canonicalProjection, input.projection, qualifiedFacts, input.retiredAttempts, work, input.userDecision.localRegion);
  const version = input.userDecision.cohortVersion;
  const cohortKey = conversationCohortKey(version);
  const canonicalItems = new Map(input.canonicalProjection.items.map(item => [item.key, item]));
  const lifetimes = new Map<DisplayLifetime["kind"], DisplayLifetime>();
  const unavailableBodies = new Map<string, DisplayBodySource>();
  const unavailable = (reason: string): DisplayBodySource => {
    let body = unavailableBodies.get(reason);
    if (!body) {
      body = Object.freeze({ kind: 'unavailable', reason, cut });
      unavailableBodies.set(reason, body);
    }
    return body;
  };
  const lifetimeFor = (kind: DisplayLifetime["kind"]): DisplayLifetime => {
    let lifetime = lifetimes.get(kind);
    if (!lifetime) {
      lifetime = Object.freeze({ kind, cut });
      lifetimes.set(kind, lifetime);
    }
    return lifetime;
  };
  const entries = input.projection.items.map(item => {
    const source = item.source;
    const canonical = canonicalItems.get(item.key);
    const canonicalSource = canonical?.source;
    const owner = owners.get(item.key);
    const host = ('domain' in source ? (source as LiveWorkIdentity).presentationContainer : undefined) ?? (owner?.containerKey as string | undefined);
    const human = (source.kind === 'user' || source.kind === 'summary') && source.textComplete === true;
    const typedCanonical = source.kind === 'text' && source.textComplete === true && canonicalSource?.kind === 'text' && canonicalSource.textComplete === true;
    const body: DisplayBodySource = (typedCanonical || human)
      ? { kind: 'typed-canonical', text: source.text, cut }
      : source.kind === 'text' && (owner?.mode === 'preview' || !!host)
        ? { kind: 'preview', text: source.text, cut }
        : unavailable(source.kind);
    const retired = 'domain' in source && !!source.attemptId && input.retiredAttempts.some(item => item.scope === input.scope && item.attemptId === source.attemptId && item.revision === revision);
    const lifetime = lifetimeFor(retired ? 'revoked' : human && !owner ? 'canonical-human' : owner || host ? 'valid-owner' : 'retained');
    return Object.freeze({ item, ...(host ? { presentationContainer: host } : {}), body, lifetime, ...(work.has(item.key) ? { work: work.get(item.key) } : {}) });
  });
  return Object.freeze({ acceptedGeneration: generation, revision, capability: input.capability, coverage: input.coverage, sequence: Object.freeze([...(input.projection.sequence ?? [])]), workGroups: Object.freeze([...(input.projection.workGroups ?? [])]), partitionUnknownKeys: Object.freeze([...input.projection.partitionUnknownKeys]), entries: Object.freeze(entries), cohortKey, cohortVersion: version, localRegion: input.userDecision.localRegion, scope: input.scope, semanticKey });
}


/** One captured set of accepted inputs for the window's conversation publication boundary. */
export interface ConversationDisplayComposition extends AcceptedPublicationInput {}
export interface ComposedConversationDisplay {
  readonly projection: SavedItemProjection;
  readonly plan: ConversationDisplayPlan;
}

export function composeConversationDisplayPlan(input: ConversationDisplayComposition): ComposedConversationDisplay {
  const projection: SavedItemProjection = Object.freeze({
    items: Object.freeze([...input.projection.items]),
    toolSummaries: Object.freeze([...input.projection.toolSummaries]),
    ...(input.projection.workGroups ? { workGroups: Object.freeze([...input.projection.workGroups]) } : {}),
    ...(input.projection.sequence ? { sequence: Object.freeze([...input.projection.sequence]) } : {}),
    partitionUnknownKeys: Object.freeze([...input.projection.partitionUnknownKeys]),
  });
  const cohortVersion: DisplayCohortVersion = Object.freeze({
    accepted: Object.freeze(input.userDecision.cohortVersion.accepted.map(row => Object.freeze({ ...row }))),
    ...(input.userDecision.cohortVersion.pending ? { pending: Object.freeze({ ...input.userDecision.cohortVersion.pending }) } : {}),
  });
  const captured = Object.freeze({ ...input, rows: Object.freeze([...input.rows]), projection,
    userDecision: Object.freeze({ cohortVersion, localRegion: input.userDecision.localRegion }), canonicalProjection: Object.freeze({ ...input.canonicalProjection,
      items: Object.freeze([...input.canonicalProjection.items]),
      toolSummaries: Object.freeze([...input.canonicalProjection.toolSummaries]),
      ...(input.canonicalProjection.workGroups ? { workGroups: Object.freeze([...input.canonicalProjection.workGroups]) } : {}),
      ...(input.canonicalProjection.sequence ? { sequence: Object.freeze([...input.canonicalProjection.sequence]) } : {}),
      partitionUnknownKeys: Object.freeze([...input.canonicalProjection.partitionUnknownKeys]),
    }), assistantFacts: Object.freeze([...input.assistantFacts]), retiredAttempts: Object.freeze([...input.retiredAttempts]) });
  return Object.freeze({ projection, plan: createConversationDisplayPlan(captured) });
}

/** Read-only renderer input reconstructed solely from the accepted immutable plan. */
export function projectionFromDisplayPlan(plan: ConversationDisplayPlan): SavedItemProjection {
  return Object.freeze({ items: plan.entries.map(entry => entry.item), toolSummaries: plan.workGroups,
    workGroups: plan.workGroups, sequence: plan.sequence, partitionUnknownKeys: plan.partitionUnknownKeys });
}
