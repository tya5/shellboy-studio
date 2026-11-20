import type { Operations, ThreadDetails } from "../../data/src";
import { correlateManagementRun } from "./management-run-observation";

export type ManagementRetryResult =
  | { kind: "stale" }
  | { kind: "refused"; reason: "thread" | "identity" | "run" | "turn" | "ineligible"; recoveryReason?: string }
  | { kind: "sent"; runId: string; turnId: string; recoveryReason: string; outcome: Awaited<ReturnType<Operations["runRetry"]>> };

export async function managementRetry(
  ops: Pick<Operations, "threadGet" | "runGet" | "turnGet" | "runRetry">,
  threadId: string,
  expected: { runId: string; turnId: string },
  operationId: string,
  isCurrent: () => boolean,
): Promise<ManagementRetryResult> {
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
  const recoveryReason = typeof turn.value.recovery_hint === "string" ? turn.value.recovery_hint.trim() : "";
  const correlated = correlateManagementRun(thread, run.value, turn.value);
  if (!correlated || run.value.state !== "live" || turn.value.state !== "recovery_wait" || !recoveryReason) return { kind: "refused", reason: "ineligible", recoveryReason: recoveryReason || undefined };
  if (!isCurrent()) return { kind: "stale" };
  const outcome = await ops.runRetry(expected.runId, operationId);
  return { kind: "sent", runId: expected.runId, turnId: expected.turnId, recoveryReason, outcome };
}
