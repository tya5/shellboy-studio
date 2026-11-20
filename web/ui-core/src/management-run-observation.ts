import type { RunDetails, ThreadDetails, TurnDetails } from "../../data/src";

export type ManagementRunObservation = {
  threadId: string;
  runId: string;
  turnId: string;
  runState: RunDetails["state"];
  turnState: TurnDetails["state"];
  recoveryReason?: string;
};

export function correlateManagementRun(thread: ThreadDetails, run: RunDetails, turn: TurnDetails): ManagementRunObservation | undefined {
  if (thread.thread_id !== run.thread_id || thread.thread_id !== turn.thread_id) return undefined;
  if (thread.run_id !== run.run_id || thread.turn_id !== turn.turn_id) return undefined;
  if (run.turn_id !== turn.turn_id || run.run_id !== turn.run_id || run.thread_id !== turn.thread_id) return undefined;
  return {
    threadId: thread.thread_id,
    runId: run.run_id,
    turnId: turn.turn_id,
    runState: run.state,
    turnState: turn.state,
    recoveryReason: typeof turn.recovery_hint === "string" ? turn.recovery_hint.trim() || undefined : undefined,
  };
}

export function managementRunStopEligible(observation: ManagementRunObservation): boolean {
  return observation.runState === "live" && observation.turnState === "running";
}

export function managementObservationCurrent(captured: ManagementObservationFence, current: ManagementObservationFence): boolean {
  return captured.threadId === current.threadId && captured.runId === current.runId && captured.turnId === current.turnId
    && captured.visit === current.visit && captured.token === current.token
    && captured.route === current.route && captured.owner === current.owner;
}
