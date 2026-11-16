import { describe, expect, it } from "vitest";
import { Handoff } from "../src/handoff";

describe("accepted window live retirement", () => {
  it("keeps the ordinary live preview until explicit accepted release", () => {
    const h = new Handoff(fn => fn());
    h.apply({ attempt_id: "live", gap: false, deltas: [{ offset: 0, reasoning: false, text: "saved body" }] });
    h.finish();
    expect(h.records.value[0]?.text).toBe("saved body");
    h.releaseAccepted("live");
    expect(h.records.value).toEqual([]);
  });

  it("retains long text within the bounded byte ledger", () => {
    const h = new Handoff(fn => fn());
    const text = "x".repeat(4096);
    h.apply({ attempt_id: "long", gap: false, deltas: [{ offset: 0, reasoning: false, text }] });
    expect(h.records.value[0]?.text.length).toBeGreaterThan(0);
    expect(h.retainedBytes).toBeLessThanOrEqual(1024 * 1024);
  });
});
