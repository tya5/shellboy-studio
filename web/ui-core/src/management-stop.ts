import type { MutationResult, Operations, Outcome, ThreadDetails } from "../../data/src";
import { managementRunRead } from "./management-run-read";
import { managementRunStopEligible } from "./management-run-observation";

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
  const read = await managementRunRead(ops, threadId, expected, isCurrent);
  if (read.kind === "stale") return read;
  if (read.kind === "refused") return { kind: "refused", reason: read.reason === "mismatch" ? "identity" : read.reason === "ineligible" ? "ineligible" : read.reason };
  if (!managementRunStopEligible(read.observation)) return { kind: "refused", reason: "ineligible" };
  const { runId, turnId } = read.observation;
  if (!isCurrent()) return { kind: "stale" };

  const outcome = await ops.runStop(runId);
  return { kind: "sent", runId, turnId, outcome };
}
