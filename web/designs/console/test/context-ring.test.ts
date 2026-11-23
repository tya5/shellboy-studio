import { expect, it } from "vitest";
import { contextFacts } from "../../../ui-core/src/usage";
import { details } from "../../../data/test/harness";

it("derives the three ring states only from owner input and effective threshold", () => {
  const facts = (input: number, threshold?: number) => contextFacts(details("thread", {
    effective_auto_compact_at: threshold, context_usage: { last_successful_attempt: { input_tokens: input } },
  }));
  expect(facts(99, 100)).toMatchObject({ state: "normal", fill: 99 });
  expect(facts(100, 100)).toMatchObject({ state: "threshold", fill: 100 });
  expect(facts(101, 100)).toMatchObject({ state: "threshold", fill: 100 });
  expect(facts(101, 0)).toMatchObject({ state: "disabled", fill: 0 });
  expect(facts(101)).toBeUndefined();
});
