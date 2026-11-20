import type { MutationResult, Operations, Outcome, ThreadDetails } from "../../data/src";
import { correlateManagementRun, managementRunStopEligible } from "./management-run-observation";

export type ManagementStopResult =
  | { kind: "stale" }
  | { kind: "refused"; reason: "thread" | "identity" | "run" | "turn" | "ineligible" }
  | { kind: "sent"; runId: string; turnId: string; outcome: Outcome<MutationResult> };

/** Exact on-demand Stop preflight; caller owns the lifetime and mutation reservation. */
export async function managementStop(
  ops: Pick<Operations, "threadGet" | "runGet" | "turnGet" | "runStop">,
  threadId: string,
  expected: { runId: string; turnId: string } | undefined,
  isCurrent: () => boolean,
): Promise<ManagementStopResult> {
  const fresh = await ops.threadGet(threadId);
  if (!isCurrent()) return { kind: "stale" };
  if (!fresh.ok || fresh.value.thread_id !== threadId) return { kind: "refused", reason: "thread" };
  const thread: ThreadDetails = fresh.value;
  const runId = expected?.runId ?? thread.run_id;
  const turnId = expected?.turnId ?? thread.turn_id;
  if (typeof runId !== "string" || typeof turnId !== "string") return { kind: "refused", reason: "identity" };
  if (expected && (thread.run_id !== runId || thread.turn_id !== turnId)) return { kind: "refused", reason: "identity" };

  const run = await ops.runGet(runId, { threadId });
  if (!isCurrent()) return { kind: "stale" };
  if (!run.ok || run.value.run_id !== runId || run.value.thread_id !== threadId || run.value.turn_id !== turnId) return { kind: "refused", reason: "run" };

  const turn = await ops.turnGet(turnId, { runId, threadId });
  if (!isCurrent()) return { kind: "stale" };
  if (!turn.ok || turn.value.turn_id !== turnId || turn.value.run_id !== runId || turn.value.thread_id !== threadId) return { kind: "refused", reason: "turn" };
  const correlated = correlateManagementRun(thread, run.value, turn.value);
  if (!correlated || !managementRunStopEligible(correlated)) return { kind: "refused", reason: "ineligible" };
  if (!isCurrent()) return { kind: "stale" };

  const outcome = await ops.runStop(runId);
  return { kind: "sent", runId, turnId, outcome };
}
