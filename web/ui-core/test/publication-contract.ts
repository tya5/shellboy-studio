import { captureConversationInput } from '../src/conversation-input';
import { expect } from 'vitest';
import type { AcceptedCapability } from '../src/accepted-view';
import type { ConversationDisplayPlan, DisplayBodySource } from '../src/conversation-display-plan';
import { CANONICAL_CASES, type CanonicalCaseId, type NormalizedSavedItem, type ConversationSequence, type WorkGroup, type SavedItemProjection } from '../src/conversation-items';
import type { WindowAcceptedSnapshot } from '../src/window';

export interface ExactPlanExpectation {
  readonly coverage: 'complete' | 'unavailable';
  readonly projection: SavedItemProjection;
  readonly bodyAuthorities: readonly DisplayBodySource[];
  readonly containers: readonly (string | undefined)[];
  readonly lifetimes: readonly string[];
}

export function assertPublishedPlan(ref: WindowAcceptedSnapshot, capability: AcceptedCapability,
  expected: ExactPlanExpectation): asserts ref is WindowAcceptedSnapshot & { displayPlan: ConversationDisplayPlan } {
  const plan = ref.displayPlan;
  expect(plan, `generation ${ref.generation} must publish a plan`).toBeDefined();
  expect(plan!.acceptedGeneration).toBe(ref.generation);
  expect(plan!.revision).toBe(ref.revision);
  expect(plan!.capability).toBe(capability);
  expect(plan!.coverage).toBe(expected.coverage);
  expect(plan!.entries.map(entry => entry.item)).toEqual(expected.projection.items);
  expect(plan!.entries.map(entry => entry.item.key)).toEqual(expected.projection.items.map(item => item.key));
  expect(plan!.sequence).toEqual(expected.projection.sequence ?? []);
  expect(plan!.workGroups).toEqual(expected.projection.workGroups ?? []);
  expect(plan!.entries.map(entry => entry.body)).toEqual(expected.bodyAuthorities);
  expect(plan!.entries.map(entry => entry.presentationContainer)).toEqual(expected.containers);
  expect(plan!.entries.map(entry => entry.lifetime.kind)).toEqual(expected.lifetimes);
}

export function observePublishedPlans(window: { acceptedView: { currentCapability: AcceptedCapability; subscribe(listener: (ref: WindowAcceptedSnapshot) => void): () => void } },
  expected: (ref: WindowAcceptedSnapshot, index: number) => ExactPlanExpectation) {
  const generations: number[] = [];
  const stop = window.acceptedView.subscribe(ref => {
    assertPublishedPlan(ref, window.acceptedView.currentCapability, expected(ref, generations.length));
    generations.push(ref.generation);
  });
  return { generations, stop };
}

export function currentInputPlanExpectation(ref: WindowAcceptedSnapshot, coverage: 'complete' | 'unavailable'): ExactPlanExpectation {
  const projection = captureConversationInput(ref, { scope: ref.displayPlan?.scope ?? 'history',
    threadId: 'fixture', records: [], work: [], current: true }).projection;
  const owners = new Map<string, { containerKey: string }>();
  for (const fact of ref.assistantOwnership ?? []) for (const key of fact.itemKeys) owners.set(key, fact);
  return {
    coverage, projection,
    bodyAuthorities: projection.items.map(item => {
      const source = item.source;
      const canonicalText = source.kind === 'text' && source.textComplete === true;
      const humanText = (source.kind === 'user' || source.kind === 'summary') && source.textComplete === true;
      return canonicalText || humanText
        ? { kind: 'typed-canonical', text: source.text, cut:{generation: ref.generation, revision: ref.revision ?? 0,
            capability: ref.displayPlan?.capability!,scope:ref.displayPlan?.scope??'history'} }
        : { kind: 'unavailable', reason: source.kind, cut:{generation: ref.generation, revision: ref.revision ?? 0,capability:ref.displayPlan?.capability!,scope:ref.displayPlan?.scope??'history'} };
    }),
    containers: projection.items.map(item => ('domain' in item.source ? item.source.presentationContainer : undefined) ?? owners.get(item.key)?.containerKey),
    lifetimes: projection.items.map(item => {
      const source = item.source;
      return (source.kind === 'user' || source.kind === 'summary') && source.textComplete === true
        ? 'canonical-human' : owners.has(item.key) ? 'valid-owner' : 'retained';
    }),
  };
}


export interface DeclaredPlanCut {
  readonly revision: number;
  readonly scope: string;
  readonly coverage: 'complete' | 'unavailable';
  readonly rows: readonly string[];
  readonly entries: readonly {
    readonly key: string; readonly source: NormalizedSavedItem; readonly case: CanonicalCaseId;
    readonly body: { readonly kind: 'typed-canonical'; readonly text: string } | { readonly kind: 'preview'; readonly text: string } | { readonly kind: 'unavailable'; readonly reason: string };
    readonly lifetime: 'canonical-human' | 'valid-owner' | 'retained' | 'revoked'; readonly container?: string;
  }[];
  readonly sequence: readonly ConversationSequence[];
  readonly groups: readonly WorkGroup[];
}
/** Expected inputs are fixture-owned literals. Never calls the production plan/input factory. */
export function declaredPlanExpectation(ref: WindowAcceptedSnapshot, capability: AcceptedCapability, input: DeclaredPlanCut): ExactPlanExpectation {
  expect(ref.revision).toBe(input.revision);
  expect(ref.rows.map(row=>row.node_id)).toEqual(input.rows);
  expect(ref.displayPlan?.scope).toBe(input.scope);
  return { coverage: input.coverage,
    projection: { items: input.entries.map(entry=>({key:entry.key,canonicalKey:entry.key,source:entry.source,classification:CANONICAL_CASES[entry.case],presentationContainer:entry.container})),
      sequence: input.sequence, workGroups: input.groups, toolSummaries: input.groups, partitionUnknownKeys: [] },
    bodyAuthorities: input.entries.map(entry=>{
      const cut={generation:ref.generation,revision:input.revision,scope:input.scope,capability};
      if(entry.body.kind==='typed-canonical')return {kind:'typed-canonical',text:entry.body.text,cut};
      if(entry.body.kind==='preview')return {kind:'preview',text:entry.body.text,cut};
      return {kind:'unavailable',reason:entry.body.reason,cut};
    }),
    containers: input.entries.map(entry=>entry.container),lifetimes: input.entries.map(entry=>entry.lifetime) };
}
