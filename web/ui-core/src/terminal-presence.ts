import type { TerminalPersistedProof } from "../../data/src/handoff";
import type { HistoryItem } from "../../data/src/protocol";
export type TerminalPresenceReason = "canonical-pending" | "read-inflight" | "missing-candidate" | "body-unavailable" | "partial-items" | "read-error" | "budget-exhausted" | "unsupported" | "capacity" | "selection-gap";
export interface TerminalPresence {
  readonly scope: string; readonly attemptId: string; readonly receipt: TerminalPersistedProof;
  readonly phase: "pending" | "reading" | "settled";
  readonly reason: TerminalPresenceReason;
  readonly answerAvailability: "unknown";
}
export function terminalPresence(receipt: TerminalPersistedProof, rows: readonly HistoryItem[], fallback: TerminalPresenceReason = "canonical-pending"): TerminalPresence | undefined {
  const found = receipt.nodeIds.map(id => rows.find(row => row.node_id === id));
  const accounted = found.every(row => row && Array.isArray(row.items) && row.items.length > 0
    && row.items.every(item => item.kind !== "unavailable" && (item.kind !== "text" || item.text_complete)));
  if (accounted) return undefined;
  const reason = found.some(row => row?.items?.some(item => item.kind === "unavailable")) ? "body-unavailable"
    : found.some(row => row?.items?.some(item => item.kind === "text" && !item.text_complete)) ? "partial-items" : fallback;
  return { scope: receipt.scope, attemptId: receipt.attemptId, receipt, phase: fallback === "canonical-pending" ? "pending" : "settled", reason, answerAvailability: "unknown" };
}
