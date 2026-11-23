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

it("only shows timestamps for completed summary/compaction candidates with complete coverage", () => {
  const at = "2026-11-22T18:00:00Z";
  const time = (candidate: object, latest_complete: boolean) => contextFacts(details("thread", {
    effective_auto_compact_at: 0,
    last_compaction: { bounded_candidate: { at, ...candidate }, coverage: { latest_complete } },
  }))?.lastCompactionAt;
  for (const candidate of [{ kind: "summary", record_kind: "retained_replacement" }, { kind: "compact", state: "completed" }, { kind: "automatic_reduction", state: "adopted" }]) {
    expect(time(candidate, true)).toBe(Date.parse(at));
    expect(time(candidate, false)).toBeUndefined();
  }
  for (const candidate of [{ kind: "restore", state: "completed" }, { kind: "automatic_reduction", state: "failed" }, { kind: "compact", state: "queued" }, { kind: "summary" }]) {
    expect(time(candidate, true)).toBeUndefined();
  }
});
