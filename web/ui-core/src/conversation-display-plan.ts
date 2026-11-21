import { ownSendOuterRowKey, type OwnSendLocalRegion } from "./own-send-presentation";
import { captureWorkElement, type CapturedWorkElement } from "./work-element-display";
import type { AcceptedCapability } from './accepted-view';
import { projectHistoryWindowItems, type SavedItemProjection, type ProjectedSavedItem, type ConversationSequence, type WorkGroup } from './conversation-items';
import type { HistoryItem } from '../../data/src/protocol';
import type { LiveWorkIdentity } from './conversation-items';

export interface DisplayCut {
  readonly generation: number; readonly revision: number | undefined; readonly scope: string;
  readonly capability: AcceptedCapability;
}
export type DisplayBodySource =
  | Readonly<{ kind: 'preview'; text: string; cut: DisplayCut }>
  | Readonly<{ kind: 'typed-canonical'; text: string; cut: DisplayCut }>
  | Readonly<{ kind: 'typed-partial'; text: string; cut: DisplayCut }>
  | Readonly<{ kind: 'unavailable'; reason: string; cut: DisplayCut }>;

export type DisplayLifetime = Readonly<{
  kind: 'valid-owner' | 'canonical-human' | 'retained' | 'revoked'; cut: DisplayCut;
}>;
export interface ConversationDisplayPlanEntry {
  readonly item: ProjectedSavedItem;
  readonly outerRowKey?: string;
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
}

/** Constructed only by accepted-window publication, never by a renderer. */
export interface AcceptedPublicationInput {
  readonly coverage: ConversationDisplayPlan["coverage"];
  readonly generation: number;
  readonly revision: number | undefined;
  readonly capability: AcceptedCapability;
  readonly rows: readonly HistoryItem[];
  readonly projection: SavedItemProjection;
  readonly canonicalProjection: SavedItemProjection;
  readonly userDecision: OwnUserDecision;
  readonly scope: string;
}

export function conversationCohortKey(version: DisplayCohortVersion): string {
  return [...version.accepted.map(row => `${row.operationId}:${row.phase}:${row.messageId ?? ''}`), version.pending ? `pending:${version.pending.operationId}:${version.pending.phase}` : 'pending:none'].join('|');
}

export function createConversationDisplayPlan(input: AcceptedPublicationInput): ConversationDisplayPlan {
  if (!Number.isSafeInteger(input.generation)) throw new Error('display plan requires accepted generation');
  const generation = input.generation, revision = input.revision;
  const cut: DisplayCut = Object.freeze({ generation, revision, capability: input.capability, scope: input.scope });
  const work = new Map<string, CapturedWorkElement>();
  const workContexts = new Map<string, CapturedWorkElement["metadata"]>();
  for (const item of input.projection.items) {
    const capture = captureWorkElement(item);
    if (!capture) continue;
    // Equal immutable issuer contexts share one bounded capture in this cut.
    // Receipt identity is source-owned and must never be interned by value.
    const key = JSON.stringify(capture.metadata);
    const metadata = workContexts.get(key) ?? capture.metadata;
    workContexts.set(key, metadata);
    work.set(item.key, Object.freeze({ ...capture, metadata }));
  }
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
  // Spend each adoption key once, on the first eligible saved row in this publication.
  const adopting = new Map(input.userDecision.localRegion.retire.map(row => [row.messageId, ownSendOuterRowKey(row)]));
  const conversationKeys = new Set(input.projection.sequence?.flatMap(row => row.kind === "conversation" ? [row.itemKey] : []));
  const entries = input.projection.items.map(item => {
    const source = item.source;
    const canonical = canonicalItems.get(item.key);
    const canonicalSource = canonical?.source;
    const human = (source.kind === 'user' || source.kind === 'summary') && source.textComplete === true;
    const typedCanonical = source.kind === 'text' && source.textComplete === true && canonicalSource?.kind === 'text' && canonicalSource.textComplete === true;
    const body: DisplayBodySource = (typedCanonical || human)
      ? { kind: 'typed-canonical', text: source.text, cut }
      : source.kind === 'user' && canonicalSource?.kind === 'user'
        ? { kind: 'typed-partial', text: canonicalSource.text, cut }
      : source.kind === 'text'
        ? { kind: 'preview', text: source.text, cut }
        : unavailable(source.kind);
    const outerRowKey = source.kind === "user" && source.nodeId && conversationKeys.has(item.key) ? adopting.get(source.nodeId) : undefined;
    if (outerRowKey !== undefined) adopting.delete(source.nodeId);
    const lifetime = lifetimeFor(human ? 'canonical-human' : 'retained');
    return Object.freeze({ item, body, lifetime, ...(outerRowKey !== undefined ? { outerRowKey } : {}), ...(work.has(item.key) ? { work: work.get(item.key) } : {}) });
  });
  return Object.freeze({ acceptedGeneration: generation, revision, capability: input.capability, coverage: input.coverage, sequence: Object.freeze([...(input.projection.sequence ?? [])]), workGroups: Object.freeze([...(input.projection.workGroups ?? [])]), partitionUnknownKeys: Object.freeze([...input.projection.partitionUnknownKeys]), entries: Object.freeze(entries), cohortKey, cohortVersion: version, localRegion: input.userDecision.localRegion, scope: input.scope });
}


/** One captured set of accepted inputs for the window's conversation publication boundary. */
export interface ConversationDisplayComposition extends AcceptedPublicationInput {}
export interface ComposedConversationDisplay {
  readonly projection: SavedItemProjection;
  readonly plan: ConversationDisplayPlan;
}

export function composeConversationDisplayPlan(input: ConversationDisplayComposition): ComposedConversationDisplay {
  const projection=input.projection;
  const cohortVersion: DisplayCohortVersion = Object.freeze({
    accepted: Object.freeze(input.userDecision.cohortVersion.accepted.map(row => Object.freeze({ ...row }))),
    ...(input.userDecision.cohortVersion.pending ? { pending: Object.freeze({ ...input.userDecision.cohortVersion.pending }) } : {}),
  });
  const captured = Object.freeze({...input,projection,userDecision:Object.freeze({cohortVersion,localRegion:input.userDecision.localRegion})});
  return Object.freeze({ projection, plan: createConversationDisplayPlan(captured) });
}

/** Read-only renderer input reconstructed solely from the accepted immutable plan. */
export function projectionFromDisplayPlan(plan: ConversationDisplayPlan): SavedItemProjection {
  return Object.freeze({ items: plan.entries.map(entry => entry.item), toolSummaries: plan.workGroups,
    workGroups: plan.workGroups, sequence: plan.sequence, partitionUnknownKeys: plan.partitionUnknownKeys });
}
