import type { Operations, ThreadDetails } from "../../data/src";
import { managementRunRead } from "./management-run-read";

export type ManagementRetryResult =
  | { kind: "stale" }
  | { kind: "refused"; reason: "thread" | "identity" | "run" | "turn" | "ineligible"; recoveryReason?: string }
  | { kind: "sent"; runId: string; turnId: string; recoveryReason: string; outcome: Awaited<ReturnType<Operations["runRetry"]>> };

export async function managementRetry(
  ops: Pick<Operations, "threadGet" | "runGet" | "turnGet" | "runRetry">,
  threadId: string,
  expected: { runId: string; turnId: string } | undefined,
  operationId: string,
  isCurrent: () => boolean,
): Promise<ManagementRetryResult> {
  const read = await managementRunRead(ops, threadId, expected, isCurrent);
  if (read.kind === "stale") return read;
  if (read.kind === "refused") return { kind: "refused", reason: read.reason === "mismatch" ? "identity" : read.reason, recoveryReason: undefined };
  const observation = read.observation;
  const recoveryReason = observation.recoveryReason;
  if (observation.runState !== "live" || observation.turnState !== "recovery_wait" || !recoveryReason) return { kind: "refused", reason: "ineligible", recoveryReason };
  if (!isCurrent()) return { kind: "stale" };

  const outcome = await ops.runRetry(observation.runId, operationId);
  return { kind: "sent", runId: observation.runId, turnId: observation.turnId, recoveryReason, outcome };
}
