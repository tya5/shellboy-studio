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


export interface DeclaredPlanCut {
  readonly revision: number;
  readonly scope: string;
  readonly coverage: 'complete' | 'unavailable';
  readonly rows: readonly string[];
  readonly entries: readonly {
    readonly key: string; readonly canonicalKey?: string; readonly toolIdentity?: "execution" | "call" | "unresolved"; readonly source: NormalizedSavedItem; readonly case: CanonicalCaseId;
    readonly body: { readonly kind: 'typed-canonical'; readonly text: string } | { readonly kind: 'preview'; readonly text: string } | { readonly kind: 'unavailable'; readonly reason: string };
    readonly lifetime: 'canonical-human' | 'valid-owner' | 'retained' | 'revoked'; readonly container?: string;
  }[];
  readonly sequence: readonly ConversationSequence[];
  readonly groups: readonly WorkGroup[];
  readonly unknownKeys?: readonly string[];
}
/** Expected inputs are fixture-owned literals. Never calls the production plan/input factory. */
export function declaredPlanExpectation(ref: WindowAcceptedSnapshot, capability: AcceptedCapability, input: DeclaredPlanCut): ExactPlanExpectation {
  expect(ref.revision).toBe(input.revision);
  expect(ref.rows.map(row=>row.node_id)).toEqual(input.rows);
  expect(ref.displayPlan?.scope).toBe(input.scope);
  return declaredExpectedPlan(ref, capability, input);
}
function declaredExpectedPlan(ref: WindowAcceptedSnapshot, capability: AcceptedCapability, input: DeclaredPlanCut): ExactPlanExpectation {
  return { coverage: input.coverage,
    projection: { items: input.entries.map(entry=>({key:entry.key,canonicalKey:entry.canonicalKey??entry.key,source:entry.source,classification:CANONICAL_CASES[entry.case],presentationContainer:entry.container,...(entry.toolIdentity?{toolIdentity:entry.toolIdentity}:{})})),
      sequence: input.sequence, workGroups: input.groups, toolSummaries: input.groups, partitionUnknownKeys: input.unknownKeys??[] },
    bodyAuthorities: input.entries.map(entry=>{
      const cut={generation:ref.generation,revision:input.revision,scope:input.scope,capability};
      if(entry.body.kind==='typed-canonical')return {kind:'typed-canonical',text:entry.body.text,cut};
      if(entry.body.kind==='preview')return {kind:'preview',text:entry.body.text,cut};
      return {kind:'unavailable',reason:entry.body.reason,cut};
    }),
    containers: input.entries.map(entry=>entry.container),lifetimes: input.entries.map(entry=>entry.lifetime) };
}


/** Membership in fixture-declared legal cuts, not an expectation reconstructed from output. */
export function observeDeclaredCuts(window: { acceptedView: { currentCapability: AcceptedCapability; subscribe(listener: (ref: WindowAcceptedSnapshot) => void): () => void } },
  cuts: () => readonly DeclaredPlanCut[]) {
  const generations:number[]=[];
  const stop=window.acceptedView.subscribe(ref=>{
    const capability=window.acceptedView.currentCapability,plan=ref.displayPlan!;
    expect(plan.acceptedGeneration).toBe(ref.generation);expect(plan.capability).toBe(capability);
    for(const entry of plan.entries){
      expect(entry.body.cut.generation).toBe(ref.generation);expect(entry.body.cut.revision).toBe(ref.revision);
      expect(entry.body.cut.capability).toBe(capability);expect(entry.body.cut.scope).toBe(plan.scope);
      expect(entry.lifetime.cut).toBe(entry.body.cut);
    }
    const declared=cuts().map(cut=>{
      const expected=declaredExpectedPlan(ref,capability,cut);
      return {revision:cut.revision,scope:cut.scope,rows:cut.rows,coverage:expected.coverage,
        items:expected.projection.items,sequence:expected.projection.sequence??[],groups:expected.projection.workGroups??[],
        unknown:expected.projection.partitionUnknownKeys,bodies:expected.bodyAuthorities,containers:expected.containers,lifetimes:expected.lifetimes};
    });
    const actual={revision:ref.revision,scope:plan.scope,rows:ref.rows.map(row=>row.node_id),coverage:plan.coverage,
      items:plan.entries.map(entry=>entry.item),sequence:plan.sequence,groups:plan.workGroups,unknown:plan.partitionUnknownKeys,
      bodies:plan.entries.map(entry=>entry.body),containers:plan.entries.map(entry=>entry.presentationContainer),lifetimes:plan.entries.map(entry=>entry.lifetime.kind)};
    expect(declared).toContainEqual(actual);generations.push(ref.generation);
  });
  return{generations,stop};
}
