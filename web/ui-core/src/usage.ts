// Usage facts as the owner measured them, from `usage.get`. A sum the owner doesn't know is
// absent here; nothing is estimated. Field shapes observed on the pinned revision.
import type { ThreadDetails } from "../../data/src";

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export type ContextRingState = "normal" | "threshold" | "disabled";
export interface ContextFacts {
  inputTokens: number | undefined;
  threshold: number;
  state: ContextRingState;
  fill: number;
  lastCompactionAt: number | undefined;
}

function lastCompletedCompaction(last: unknown): number | undefined {
  const fact = obj(last);
  const candidate = obj(fact?.bounded_candidate);
  if (obj(fact?.coverage)?.latest_complete !== true || typeof candidate?.at !== "string") return;
  const completed = (candidate.kind === "summary" && candidate.record_kind === "retained_replacement")
    || ((candidate.kind === "compact" || candidate.kind === "summary") && candidate.state === "completed")
    || (candidate.kind === "automatic_reduction" && candidate.state === "adopted");
  if (!completed) return;
  const at = Date.parse(candidate.at);
  return Number.isFinite(at) ? at : undefined;
}

export function contextFacts(d: ThreadDetails | undefined): ContextFacts | undefined {
  const inputTokens = num(obj(obj(d?.context_usage)?.last_successful_attempt)?.input_tokens);
  const threshold = num(d?.effective_auto_compact_at);
  if (threshold === undefined || threshold < 0 || (threshold > 0 && (inputTokens === undefined || inputTokens < 0))) return;
  return {
    inputTokens, threshold,
    state: threshold === 0 ? "disabled" : inputTokens! >= threshold ? "threshold" : "normal",
    fill: threshold === 0 ? 0 : Math.min(100, inputTokens! * 100 / threshold),
    lastCompactionAt: lastCompletedCompaction(d?.last_compaction),
  };
}

export interface Measured {
  value: number;
  /** Some records had no value, so `value` is a lower bound. */
  partial: boolean;
}

export interface UsageFacts {
  attempts: number | undefined;
  input: Measured | undefined;
  output: Measured | undefined;
  cached: Measured | undefined;
  /** Cached share of input in percent, only when both sums are complete. */
  cachedPercent: number | undefined;
  partial: boolean;
}

function measured(v: unknown): Measured | undefined {
  const m = obj(v);
  const value = num(m?.known_sum);
  if (value === undefined) return undefined;
  return { value, partial: m?.overflow === true || (num(m?.unknown_count) ?? 0) > 0 };
}

export function usageFacts(d: Record<string, unknown> | undefined): UsageFacts | undefined {
  const completed = obj(obj(d?.model_attempts)?.completed);
  if (!completed) return undefined;
  const input = measured(completed.input_tokens);
  const output = measured(completed.output_tokens);
  const cached = measured(completed.cached_tokens);
  if (!input && !output && !cached) return undefined;
  const incomplete = obj(d?.coverage)?.scope_complete === false;
  const complete = !incomplete && input && cached && !input.partial && !cached.partial && input.value > 0;
  return {
    attempts: num(completed.count),
    input,
    output,
    cached,
    cachedPercent: complete ? Math.round((cached.value / input.value) * 100) : undefined,
    partial: !!(incomplete || input?.partial || output?.partial || cached?.partial),
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
