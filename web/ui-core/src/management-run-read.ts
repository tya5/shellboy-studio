import type { Operations, ThreadDetails } from "../../data/src";
import { correlateManagementRun, type ManagementRunObservation } from "./management-run-observation";

export type ManagementRunReadResult =
  | { kind: "stale" }
  | { kind: "refused"; reason: "thread" | "identity" | "run" | "turn" | "mismatch" }
  | { kind: "ready"; observation: ManagementRunObservation };

/** On-demand exact Thread -> Run -> Turn correlation shared by action callers. */
export async function managementRunRead(
  ops: Pick<Operations, "threadGet" | "runGet" | "turnGet">,
  threadId: string,
  expected: { runId: string; turnId: string } | undefined,
  isCurrent: () => boolean,
): Promise<ManagementRunReadResult> {
  const fresh = await ops.threadGet(threadId);
  if (!isCurrent()) return { kind: "stale" };
  if (!fresh.ok || fresh.value.thread_id !== threadId) return { kind: "refused", reason: "thread" };
  const thread: ThreadDetails = fresh.value;
  const runId = thread.run_id;
  const turnId = thread.turn_id;
  if (typeof runId !== "string" || typeof turnId !== "string") return { kind: "refused", reason: "identity" };
  if (expected && (expected.runId !== runId || expected.turnId !== turnId)) return { kind: "refused", reason: "mismatch" };
  const run = await ops.runGet(runId, { threadId });
  if (!isCurrent()) return { kind: "stale" };
  if (!run.ok || run.value.run_id !== runId || run.value.thread_id !== threadId || run.value.turn_id !== turnId) return { kind: "refused", reason: "run" };
  const turn = await ops.turnGet(turnId, { runId, threadId });
  if (!isCurrent()) return { kind: "stale" };
  if (!turn.ok || turn.value.turn_id !== turnId || turn.value.run_id !== runId || turn.value.thread_id !== threadId) return { kind: "refused", reason: "turn" };
  const observation = correlateManagementRun(thread, run.value, turn.value);
  return observation ? { kind: "ready", observation } : { kind: "refused", reason: "mismatch" };
}
