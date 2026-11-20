import { expect, it } from "vitest";
import { correlateManagementRun, managementObservationCurrent, managementRunStopEligible, type ManagementObservationFence } from "../src/management-run-observation";
import { details } from "../../data/test/harness";

const ids = () => ({ visit: {}, token: {}, route: {}, owner: {} });
const run = (state: "live" | "completed" = "live") => ({ run_id: "run-a", thread_id: "A", turn_id: "turn-a", state });
const turn = (state: "running" | "recovery_wait" = "running") => ({ turn_id: "turn-a", run_id: "run-a", thread_id: "A", state });

it("accepts an exact live/running Thread/Run/Turn correlation", () => {
  const observation = correlateManagementRun(details("A", { run_id: "run-a", turn_id: "turn-a" }), run(), turn());
  expect(observation).toMatchObject({ threadId: "A", runId: "run-a", turnId: "turn-a", runState: "live", turnState: "running" });
  expect(managementRunStopEligible(observation!)).toBe(true);
});

it("rejects mismatched identities and recovery state", () => {
  expect(correlateManagementRun(details("A", { run_id: "run-a", turn_id: "turn-a" }), run(), { ...turn(), turn_id: "other" })).toBeUndefined();
  const recovery = correlateManagementRun(details("A", { run_id: "run-a", turn_id: "turn-a" }), run(), turn("recovery_wait"));
  expect(managementRunStopEligible(recovery!)).toBe(false);
});

it("rejects a stale observation fence after visit/token replacement", () => {
  const a = ids();
  const captured: ManagementObservationFence = { threadId: "A", runId: "run-a", turnId: "turn-a", ...a };
  const current: ManagementObservationFence = { ...captured, visit: {}, token: {} };
  expect(managementObservationCurrent(captured, current)).toBe(false);
});
