import type { MutationResult, Operations, ThreadDetails } from "../../data/src";
import { correlateManagementRun, managementRunStopEligible } from "./management-run-observation";

export type ManagementStopResult =
  | { kind: "stale" }
  | { kind: "refused"; reason: "thread" | "identity" | "run" | "turn" | "ineligible" }
  | { kind: "sent"; outcome: { ok: true; value: MutationResult } | { ok: false; error: unknown } };

/** Exact on-demand Stop preflight; caller owns the lifetime and mutation reservation. */
export async function managementStop(
  ops: Pick<Operations, "threadGet" | "runGet" | "turnGet" | "runStop">,
  threadId: string,
  expected: { runId: string; turnId: string },
  isCurrent: () => boolean,
): Promise<ManagementStopResult> {
  const fresh = await ops.threadGet(threadId);
  if (!isCurrent()) return { kind: "stale" };
  if (!fresh.ok || fresh.value.thread_id !== threadId) return { kind: "refused", reason: "thread" };
  const thread: ThreadDetails = fresh.value;
  if (thread.run_id !== expected.runId || thread.turn_id !== expected.turnId) return { kind: "refused", reason: "identity" };

  const run = await ops.runGet(expected.runId, { threadId });
  if (!isCurrent()) return { kind: "stale" };
  if (!run.ok || run.value.run_id !== expected.runId || run.value.thread_id !== threadId || run.value.turn_id !== expected.turnId) return { kind: "refused", reason: "run" };

  const turn = await ops.turnGet(expected.turnId, { runId: expected.runId, threadId });
  if (!isCurrent()) return { kind: "stale" };
  if (!turn.ok || turn.value.turn_id !== expected.turnId || turn.value.run_id !== expected.runId || turn.value.thread_id !== threadId) return { kind: "refused", reason: "turn" };
  const correlated = correlateManagementRun(thread, run.value, turn.value);
  if (!correlated || !managementRunStopEligible(correlated)) return { kind: "refused", reason: "ineligible" };
  if (!isCurrent()) return { kind: "stale" };

  const outcome = await ops.runStop(expected.runId);
  return { kind: "sent", outcome };
}
