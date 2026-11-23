// Usage facts as the owner measured them, from `usage.get`. A sum the owner doesn't know is
// absent here; nothing is estimated. Field shapes observed on the pinned revision.
import type { ThreadDetails } from "../../data/src";
import { cacheRate, readTokenParts, terminalUsage, type TokenParts } from "./analytics";

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export type ContextRingState = "normal" | "threshold" | "disabled" | "summarizing";
export interface ContextFacts {
  inputTokens: number | undefined;
  threshold: number | undefined;
  state: ContextRingState;
  fill: number | undefined;
}

export function contextFacts(d: ThreadDetails | undefined): ContextFacts | undefined {
  const input = num(obj(obj(d?.context_usage)?.last_successful_attempt)?.input_tokens);
  const limit = num(d?.effective_auto_compact_at);
  const inputTokens = input !== undefined && input >= 0 ? input : undefined;
  const threshold = limit !== undefined && limit >= 0 ? limit : undefined;
  // A current owner fact does not depend on a previous input measurement.
  if (d?.summarizing === true) return { inputTokens, threshold, state: "summarizing", fill: undefined };
  if (threshold === 0) return { inputTokens, threshold, state: "disabled", fill: 0 };
  if (threshold === undefined || inputTokens === undefined) return;
  return { inputTokens, threshold, state: inputTokens >= threshold ? "threshold" : "normal",
    fill: Math.min(100, inputTokens * 100 / threshold) };
}

export interface UsageFacts {
  attempts: number;
  conversation: TokenParts;
  cachedPercent: number | undefined;
  scopeIncomplete: boolean;
  summary: { parts: TokenParts; requests: number | undefined; incomplete: boolean } | undefined;
}

export function usageFacts(d: Record<string, unknown> | undefined): UsageFacts | undefined {
  if (!obj(d?.model_attempts) && !obj(d?.compaction)) return undefined;
  const { conversation, requests } = terminalUsage(d?.model_attempts);
  const scopeIncomplete = obj(d?.coverage)?.scope_complete === false;
  const rate = scopeIncomplete ? undefined : cacheRate(conversation);
  const summary = obj(d?.compaction);
  return {
    attempts: requests,
    conversation,
    cachedPercent: rate === undefined ? undefined : Math.round(rate * 100),
    scopeIncomplete,
    summary: summary ? { parts: readTokenParts(summary), requests: num(summary.requests), incomplete: scopeIncomplete || (num(summary.malformed_records) ?? 0) > 0 } : undefined,
  };
}

export interface RecoveryFacts {
  message: string | undefined;
  hint: string | undefined;
}

/** `recovery_reason` is a JSON string on the pinned revision; otherwise it is shown as text. */
export function recoveryFacts(d: ThreadDetails | undefined): RecoveryFacts | undefined {
  const reason = d?.recovery_reason;
  if (typeof reason !== "string" || reason === "") return undefined;
  try {
    const parsed = obj(JSON.parse(reason));
    if (parsed) {
      return {
        message: typeof parsed.message === "string" ? parsed.message : undefined,
        hint: typeof parsed.hint === "string" ? parsed.hint : undefined,
      };
    }
  } catch {
    // Not JSON: the text is the reason.
  }
  return { message: reason, hint: undefined };
}
