// Cost and compaction facts from `usage.get` (grouped) and `compact.list`. Sums keep the owner's
// known/unknown/overflow distinction: missing usage is never zero and nothing is estimated.
// Field shapes observed on Shellboy v0.10.0.

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** One owner counter: `known_sum`, `unknown_count`, `overflow`. */
export interface Sum {
  /** Sum of the values reported. Undefined when none was reported or the sum overflowed. */
  known: number | undefined;
  unknown: number;
  overflow: boolean;
}

export const EMPTY_SUM: Sum = { known: undefined, unknown: 0, overflow: false };

export function readSum(v: unknown): Sum {
  const m = obj(v);
  return { known: num(m?.known_sum), unknown: num(m?.unknown_count) ?? 0, overflow: m?.overflow === true };
}

export function addSum(a: Sum, b: Sum): Sum {
  const overflow = a.overflow || b.overflow;
  const known = overflow ? undefined : a.known === undefined ? b.known : b.known === undefined ? a.known : a.known + b.known;
  return { known, unknown: a.unknown + b.unknown, overflow };
}

/** Input includes cached input (Shellboy's normalized usage). */
export interface TokenParts {
  input: Sum;
  cached: Sum;
  output: Sum;
}

export const EMPTY_PARTS: TokenParts = { input: EMPTY_SUM, cached: EMPTY_SUM, output: EMPTY_SUM };

const addParts = (a: TokenParts, b: TokenParts): TokenParts => ({
  input: addSum(a.input, b.input),
  cached: addSum(a.cached, b.cached),
  output: addSum(a.output, b.output),
});

export const partsIncomplete = (p: TokenParts): boolean =>
  [p.input, p.cached, p.output].some((s) => s.unknown > 0 || s.overflow);

export type Split = { uncached: number; cached: number; output: number; inconsistent: false } | { uncached: undefined; cached: number | undefined; output: number | undefined; inconsistent: boolean };

/** Uncached input needs both input and cached. A provider reporting cached over input is not repaired. */
export function splitParts(p: TokenParts): Split {
  const input = p.input.known;
  const cached = p.cached.known;
  const output = p.output.known;
  if (input !== undefined && cached !== undefined && cached <= input && output !== undefined)
    return { uncached: input - cached, cached, output, inconsistent: false };
  return { uncached: undefined, cached, output, inconsistent: input !== undefined && cached !== undefined && cached > input };
}

/** Weights for effective tokens. They are the reader's own, per browser, and are not prices. */
export interface Weights {
  cached: number;
  output: number;
}

export const DEFAULT_WEIGHTS: Weights = { cached: 0.1, output: 5 };

/** uncached + cached x n + output x m. Undefined when a needed counter is missing. */
export function effectiveTokens(p: TokenParts, w: Weights): number | undefined {
  const s = splitParts(p);
  if (s.uncached === undefined) return undefined;
  return s.uncached + s.cached * w.cached + s.output * w.output;
}

/** Cached share of input as a fraction. Not clamped: a value over 1 means the provider's figures disagree. */
export function cacheRate(p: TokenParts): number | undefined {
  const input = p.input.known;
  const cached = p.cached.known;
  return input === undefined || cached === undefined || input === 0 ? undefined : cached / input;
}

export interface UsageGroup {
  key: string;
  /** Conversation requests in the terminal states completed, failed and incomplete. */
  conversation: TokenParts;
  requests: number;
  /** Summary requests of compactions. */
  summary: TokenParts;
  compactions: number;
  summaryRequests: number;
  mapRequests: number;
  reduceRequests: number;
  /** Requests whose input is known, and the sum behind the mean. Percentiles don't merge across windows. */
  inputKnown: number;
  inputMeanSum: number;
  inputMax: number | undefined;
  /** Terminal requests without a cached/input pair. */
  unknownPairs: number;
}

const TERMINAL = ["completed", "failed", "incomplete"];

export function readGroup(item: unknown): UsageGroup | undefined {
  const it = obj(item);
  const key = str(it?.key);
  if (!it || !key) return undefined;
  const attempts = obj(it.model_attempts) ?? {};
  let conversation = EMPTY_PARTS;
  let requests = 0;
  for (const state of TERMINAL) {
    const a = obj(attempts[state]);
    if (!a) continue;
    requests += num(a.count) ?? 0;
    conversation = addParts(conversation, { input: readSum(a.input_tokens), cached: readSum(a.cached_tokens), output: readSum(a.output_tokens) });
  }
  const c = obj(it.compaction) ?? {};
  const perRequest = obj(it.input_per_request) ?? {};
  const inputKnown = num(perRequest.known_count) ?? 0;
  return {
    key,
    conversation,
    requests,
    summary: { input: readSum(c.input_tokens), cached: readSum(c.cached_tokens), output: readSum(c.output_tokens) },
    compactions: num(c.compactions) ?? 0,
    summaryRequests: num(c.requests) ?? 0,
    mapRequests: num(c.map_requests) ?? 0,
    reduceRequests: num(c.reduce_requests) ?? 0,
    inputKnown,
    inputMeanSum: (num(perRequest.mean) ?? 0) * inputKnown,
    inputMax: num(perRequest.max),
    unknownPairs: num(obj(it.cache)?.unknown_pair_count) ?? 0,
  };
}

/** The same group can recur in several scan windows; counters add, percentiles and ratios don't. */
export function mergeGroups(a: UsageGroup, b: UsageGroup): UsageGroup {
  return {
    key: a.key,
    conversation: addParts(a.conversation, b.conversation),
    requests: a.requests + b.requests,
    summary: addParts(a.summary, b.summary),
    compactions: a.compactions + b.compactions,
    summaryRequests: a.summaryRequests + b.summaryRequests,
    mapRequests: a.mapRequests + b.mapRequests,
    reduceRequests: a.reduceRequests + b.reduceRequests,
    inputKnown: a.inputKnown + b.inputKnown,
    inputMeanSum: a.inputMeanSum + b.inputMeanSum,
    inputMax: a.inputMax === undefined ? b.inputMax : b.inputMax === undefined ? a.inputMax : Math.max(a.inputMax, b.inputMax),
    unknownPairs: a.unknownPairs + b.unknownPairs,
  };
}

export const meanInput = (g: UsageGroup): number | undefined => (g.inputKnown > 0 ? g.inputMeanSum / g.inputKnown : undefined);

export function totalGroups(groups: readonly UsageGroup[]): UsageGroup | undefined {
  if (groups.length === 0) return undefined;
  return groups.reduce((a, b) => mergeGroups(a, b));
}

/** What one walk really covered, added up from each scan window's own report. */
export interface WalkCoverage {
  windows: number;
  matchedAttempts: number;
  matchedCompactions: number;
  excludedTime: number;
  unknownTimeCompactions: number;
  malformedCompactions: number;
  scannedCandidates: number;
  elapsedMs: number;
}

export const EMPTY_COVERAGE: WalkCoverage = { windows: 0, matchedAttempts: 0, matchedCompactions: 0, excludedTime: 0, unknownTimeCompactions: 0, malformedCompactions: 0, scannedCandidates: 0, elapsedMs: 0 };

export function addCoverage(c: WalkCoverage, page: Record<string, unknown>): WalkCoverage {
  return {
    windows: c.windows + 1,
    matchedAttempts: c.matchedAttempts + (num(page.matched_attempts) ?? 0),
    matchedCompactions: c.matchedCompactions + (num(page.matched_compactions) ?? 0),
    excludedTime: c.excludedTime + (num(page.excluded_time_count) ?? 0),
    unknownTimeCompactions: c.unknownTimeCompactions + (num(page.unknown_time_compaction_records) ?? 0),
    malformedCompactions: c.malformedCompactions + (num(page.malformed_compaction_records) ?? 0),
    scannedCandidates: c.scannedCandidates + (num(page.scanned_candidates) ?? 0),
    elapsedMs: c.elapsedMs + (num(page.elapsed_ms) ?? 0),
  };
}

// ---- the period ----

export const PERIODS = [1, 7, 14, 31] as const;
export type PeriodDays = (typeof PERIODS)[number];

const pad = (n: number): string => String(n).padStart(2, "0");

/** `+09:00` from minutes east of UTC: the owner buckets days by this fixed offset. */
export function zoneOf(offsetMinutes: number): string {
  const abs = Math.abs(offsetMinutes);
  return `${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const dayKey = (ms: number, offsetMinutes: number): string => new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);

const DAY_MS = 86_400_000;

export interface Period {
  days: PeriodDays;
  since: string;
  until: string;
  zone: string;
  /** Every calendar day of the period, oldest first. */
  dayKeys: string[];
}

/** From the start of the first calendar day to now, in the reader's offset. Always within the owner's 31 days. */
export function periodOf(days: PeriodDays, nowMs: number, offsetMinutes: number): Period {
  const offsetMs = offsetMinutes * 60_000;
  const startOfToday = Math.floor((nowMs + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
  const start = startOfToday - (days - 1) * DAY_MS;
  const dayKeys: string[] = [];
  for (let i = 0; i < days; i++) dayKeys.push(dayKey(start + i * DAY_MS, offsetMinutes));
  return { days, since: new Date(start).toISOString(), until: new Date(nowMs).toISOString(), zone: zoneOf(offsetMinutes), dayKeys };
}

/** Month and day of a `YYYY-MM-DD` key. */
export const shortDay = (key: string): string => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

// ---- chart scale ----

/** The smallest of 1, 2, 5 x 10^k at or above the value. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const base = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * base >= value) return step * base;
  return 10 * base;
}

// ---- compaction events ----

export interface CompactionEvent {
  id: string;
  at: string | undefined;
  /** Owner words: automatic_reduction, manual kinds, spill, ... */
  kind: string;
  reason: string | undefined;
  state: string | undefined;
  /** Input tokens that triggered it; only automatic events report this. */
  triggerInput: number | undefined;
  autoAt: number | undefined;
  /** Input tokens of the first request after adoption. */
  afterInput: number | undefined;
  afterAttempt: string | undefined;
  /** True when the owner carries the key: an adopted summary, not inherited by a fork. */
  afterApplies: boolean;
  summary: TokenParts | undefined;
  summaryRequests: number | undefined;
  sourceCharacters: number | undefined;
  summaryCharacters: number | undefined;
}

export function readCompactionEvent(item: unknown): CompactionEvent | undefined {
  const it = obj(item);
  const id = str(it?.event_id) ?? str(it?.attempt_id) ?? str(it?.operation_id);
  if (!it || !id) return undefined;
  const metrics = obj(it.metrics) ?? {};
  const trigger = obj(it.trigger) ?? {};
  const usage = obj(metrics.summary_usage);
  return {
    id,
    at: str(it.at),
    kind: str(it.kind) ?? "unknown",
    reason: str(it.reason) ?? undefined,
    state: str(it.state),
    triggerInput: num(trigger.input_tokens),
    autoAt: num(trigger.auto_at_tokens),
    afterInput: num(it.post_compaction_input_tokens),
    afterAttempt: str(it.post_compaction_attempt_id),
    afterApplies: "post_compaction_input_tokens" in it,
    summary: usage ? { input: readSum(usage.input_tokens), cached: readSum(usage.cached_tokens), output: readSum(usage.output_tokens) } : undefined,
    summaryRequests: num(usage?.requests),
    sourceCharacters: num(metrics.source_characters),
    summaryCharacters: num(metrics.summary_characters),
  };
}

// ---- what the charts draw ----

export interface DayFacts {
  key: string;
  /** The owner returned this day. Otherwise every value is absent, and absent isn't zero. */
  recorded: boolean;
  uncached: number | undefined;
  cached: number | undefined;
  output: number | undefined;
  summaryUncached: number | undefined;
  summaryCached: number | undefined;
  summaryOutput: number | undefined;
  /** Conversation plus summary requests, with the reader's weights. */
  effective: number | undefined;
  summaryEffective: number | undefined;
  rate: number | undefined;
  compactions: number;
  requests: number;
  /** Some records had no value, so sums are lower bounds. */
  incomplete: boolean;
  /** A provider reported more cached than input; the split isn't drawn. */
  inconsistent: boolean;
}

/** No request means nothing to sum, which is different from a request with no reported usage. */
function summaryEffectiveOf(g: UsageGroup, w: Weights): number | undefined {
  return g.summaryRequests === 0 ? 0 : effectiveTokens(g.summary, w);
}

export function groupEffective(g: UsageGroup, w: Weights): number | undefined {
  const conversation = g.requests === 0 ? 0 : effectiveTokens(g.conversation, w);
  const summary = summaryEffectiveOf(g, w);
  if (conversation === undefined && summary === undefined) return undefined;
  return (conversation ?? 0) + (summary ?? 0);
}

export const groupIncomplete = (g: UsageGroup): boolean =>
  partsIncomplete(g.conversation) || (g.summaryRequests > 0 && partsIncomplete(g.summary)) || g.unknownPairs > 0;

export function dayFacts(dayKeys: readonly string[], groups: ReadonlyMap<string, UsageGroup>, w: Weights): DayFacts[] {
  return dayKeys.map((key) => {
    const g = groups.get(key);
    if (!g) return { key, recorded: false, uncached: undefined, cached: undefined, output: undefined, summaryUncached: undefined, summaryCached: undefined, summaryOutput: undefined, effective: undefined, summaryEffective: undefined, rate: undefined, compactions: 0, requests: 0, incomplete: false, inconsistent: false };
    const c = splitParts(g.conversation);
    const s = splitParts(g.summary);
    return {
      key,
      recorded: true,
      uncached: c.uncached,
      cached: c.cached,
      output: c.output,
      summaryUncached: s.uncached,
      summaryCached: s.cached,
      summaryOutput: s.output,
      effective: groupEffective(g, w),
      summaryEffective: summaryEffectiveOf(g, w),
      rate: cacheRate(g.conversation),
      compactions: g.compactions,
      requests: g.requests,
      incomplete: groupIncomplete(g),
      inconsistent: c.inconsistent || s.inconsistent,
    };
  });
}

export interface PeriodTotals {
  effective: number | undefined;
  summaryEffective: number | undefined;
  rate: number | undefined;
  compactions: number;
  summaryRequests: number;
  requests: number;
  incomplete: boolean;
  days: number;
}

export function periodTotals(groups: ReadonlyMap<string, UsageGroup>, w: Weights): PeriodTotals {
  const all = [...groups.values()];
  const total = totalGroups(all);
  if (!total) return { effective: undefined, summaryEffective: undefined, rate: undefined, compactions: 0, summaryRequests: 0, requests: 0, incomplete: false, days: 0 };
  return {
    effective: groupEffective(total, w),
    summaryEffective: summaryEffectiveOf(total, w),
    rate: cacheRate(total.conversation),
    compactions: total.compactions,
    summaryRequests: total.summaryRequests,
    requests: total.requests,
    incomplete: all.some(groupIncomplete),
    days: all.length,
  };
}
