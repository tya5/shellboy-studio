import { expect } from 'vitest';
import type { AcceptedCapability } from '../src/accepted-view';
import type { ConversationDisplayPlan, DisplayBodySource } from '../src/conversation-display-plan';
import type { SavedItemProjection } from '../src/conversation-items';
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

export function canonicalPlanExpectation(ref: WindowAcceptedSnapshot, coverage: 'complete' | 'unavailable'): ExactPlanExpectation {
  const { projectHistoryWindowItems } = requireConversationItems();
  const projection = projectHistoryWindowItems({ revision: ref.revision ?? 0, nodes: ref.rows,
    keyScope: [ref.displayPlan?.scope ?? ''] }).projection;
  const owners = new Map<string, { containerKey: string }>();
  for (const fact of ref.assistantOwnership ?? []) for (const key of fact.itemKeys) owners.set(key, fact);
  return {
    coverage, projection,
    bodyAuthorities: projection.items.map(item => {
      const source = item.source;
      const canonicalText = source.kind === 'text' && source.textComplete === true;
      const humanText = (source.kind === 'user' || source.kind === 'summary') && source.textComplete === true;
      return canonicalText || humanText
        ? { kind: 'typed-canonical', text: source.text, generation: ref.generation, revision: ref.revision ?? 0,
            capability: ref.displayPlan?.capability! }
        : { kind: 'unavailable', reason: source.kind, generation: ref.generation, revision: ref.revision ?? 0 };
    }),
    containers: projection.items.map(item => owners.get(item.key)?.containerKey),
    lifetimes: projection.items.map(item => {
      const source = item.source;
      return (source.kind === 'user' || source.kind === 'summary') && source.textComplete === true
        ? 'canonical-human' : owners.has(item.key) ? 'valid-owner' : 'retained';
    }),
  };
}
function requireConversationItems(): typeof import('../src/conversation-items') {
  // Static import avoided here only to keep test helpers' runtime module graph narrow.
  return conversationItems;
}
import * as conversationItems from '../src/conversation-items';
