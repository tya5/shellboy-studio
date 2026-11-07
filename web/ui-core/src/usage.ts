// Usage facts as the owner measured them, from `thread.get`. A sum the owner doesn't know is
// absent here; nothing is estimated. Field shapes observed on the pinned revision.
import type { ThreadDetails } from "../../data/src";

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export interface ContextFacts {
  /** Input tokens of the last successful model request. */
  inputTokens: number;
  /** Where automatic summary starts for this Thread. Absent if the owner doesn't report it. */
  autoSummaryAt: number | undefined;
}

export function contextFacts(d: ThreadDetails | undefined): ContextFacts | undefined {
  const attempt = obj(obj(d?.context_usage)?.last_successful_attempt);
  const inputTokens = num(attempt?.input_tokens);
  if (inputTokens === undefined) return undefined;
  return { inputTokens, autoSummaryAt: num(d?.effective_auto_compact_at) };
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
  return { value, partial: (num(m?.unknown_count) ?? 0) > 0 };
}

export function usageFacts(d: ThreadDetails | undefined): UsageFacts | undefined {
  const completed = obj(obj(obj(d?.usage_totals)?.model_attempts)?.completed);
  if (!completed) return undefined;
  const input = measured(completed.input_tokens);
  const output = measured(completed.output_tokens);
  const cached = measured(completed.cached_tokens);
  if (!input && !output && !cached) return undefined;
  const complete = input && cached && !input.partial && !cached.partial && input.value > 0;
  return {
    attempts: num(completed.count),
    input,
    output,
    cached,
    cachedPercent: complete ? Math.round((cached.value / input.value) * 100) : undefined,
    partial: !!(input?.partial || output?.partial || cached?.partial),
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
