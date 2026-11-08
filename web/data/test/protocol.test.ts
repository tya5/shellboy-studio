import { describe, expect, it } from "vitest";
import { parseServerFrame } from "../src/protocol";

const j = (v: unknown) => JSON.stringify(v);

describe("parseServerFrame", () => {
  it("accepts every frame the bridge defines", () => {
    const owner = { state: "connected", info: { protocol_version: 5, instance_id: null, capabilities: [] } };
    for (const f of [
      { t: "hello", bridge_version: "0.1.0", owner },
      { t: "hello", bridge_version: "0.1.0", owner: { state: "unreachable" } },
      { t: "result", id: 1, response: { protocol_version: 5, operation_id: "a", ok: true, result: {} } },
      { t: "result", id: 1, error: { code: "busy", message: "m" } },
      { t: "changed", thread_ids: ["a"], list: false },
      { t: "live", thread_id: "a", attempt_id: "x", gap: false, deltas: [{ offset: 0, reasoning: false, text: "x" }] },
      { t: "live", thread_id: "a", attempt_id: "x", gap: true, deltas: [] },
      { t: "live_end", thread_id: "a" },
      { t: "resync" },
      { t: "owner", event: "restarted", owner },
      { t: "error", error: { code: "invalid_frame", message: "m" } },
    ])
      expect(parseServerFrame(j(f)).ok, j(f)).toBe(true);
  });

  it("reports, rather than guesses at, malformed or unknown frames", () => {
    for (const bad of [
      "not json",
      j([]),
      j({}),
      j({ t: "mystery" }),
      j({ t: "changed", thread_ids: "a", list: true }),
      j({ t: "stream", thread_id: "a", cursor: "c", text: "", gap: false }),
      j({ t: "live", thread_id: "a", attempt_id: "x", gap: false, deltas: [{ offset: "0", reasoning: false, text: "" }] }),
      j({ t: "live", thread_id: "a", attempt_id: "x", gap: false }),
      j({ t: "live_end" }),
      j({ t: "result", id: 1 }),
      j({ t: "owner", event: "exploded", owner: { state: "unreachable" } }),
    ]) {
      const r = parseServerFrame(bad);
      expect(r.ok, bad).toBe(false);
    }
  });
});
