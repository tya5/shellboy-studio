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
  const value = num(m?.known_sum);
  const overflow = m?.overflow === true || (value !== undefined && !Number.isSafeInteger(value));
  return { known: overflow ? undefined : value, unknown: num(m?.unknown_count) ?? 0, overflow };
}

export function addSum(a: Sum, b: Sum): Sum {
  const known = a.known === undefined ? b.known : b.known === undefined ? a.known : a.known + b.known;
  const overflow = a.overflow || b.overflow || (known !== undefined && !Number.isSafeInteger(known));
  return { known: overflow ? undefined : known, unknown: a.unknown + b.unknown, overflow };
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
  if (partsIncomplete(p)) return undefined;
  const s = splitParts(p);
  if (s.uncached === undefined) return undefined;
  return s.uncached + s.cached * w.cached + s.output * w.output;
}

/** A full-scope ratio requires complete, consistent input/cache pairs. */
export function cacheRate(p: TokenParts, unknownPairs = 0): number | undefined {
  const input = p.input.known;
  const cached = p.cached.known;
  return input === undefined || cached === undefined || input <= 0 || cached < 0 || cached > input || p.input.unknown > 0 || p.cached.unknown > 0 || p.input.overflow || p.cached.overflow || unknownPairs > 0 ? undefined : cached / input;
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

export function terminalUsage(value: unknown) {
  const attempts = obj(value) ?? {};
  let conversation = EMPTY_PARTS;
  let requests = 0;
  for (const state of TERMINAL) {
    const a = obj(attempts[state]);
    if (!a) continue;
    requests += num(a.count) ?? 0;
    conversation = addParts(conversation, { input: readSum(a.input_tokens), cached: readSum(a.cached_tokens), output: readSum(a.output_tokens) });
  }
  return { conversation, requests };
}

export function readTokenParts(value: unknown): TokenParts {
  const p = obj(value);
  return { input: readSum(p?.input_tokens), cached: readSum(p?.cached_tokens), output: readSum(p?.output_tokens) };
}

export function readGroup(item: unknown): UsageGroup | undefined {
  const it = obj(item);
  const key = str(it?.key);
  if (!it || !key) return undefined;
  const { conversation, requests } = terminalUsage(it.model_attempts);
  const c = obj(it.compaction) ?? {};
  const perRequest = obj(it.input_per_request) ?? {};
  const inputKnown = num(perRequest.known_count) ?? 0;
  return {
    key,
    conversation,
    requests,
    summary: readTokenParts(c),
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
  scopeIncomplete?: boolean;
}

export const EMPTY_COVERAGE: WalkCoverage = { windows: 0, matchedAttempts: 0, matchedCompactions: 0, excludedTime: 0, unknownTimeCompactions: 0, malformedCompactions: 0, scannedCandidates: 0, elapsedMs: 0 };

export function addCoverage(c: WalkCoverage, page: Record<string, unknown>): WalkCoverage {
  return {
    windows: c.windows + 1,
    ...(c.scopeIncomplete || page.scope_complete === false ? { scopeIncomplete: true } : {}),
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
  effectiveLowerBound: boolean;
  summaryEffective: number | undefined;
  rate: number | undefined;
  compactions: number;
  requests: number;
  /** Some records had no value, so sums are lower bounds. */
  incomplete: boolean;
  /** A provider reported more cached than input; the split isn't drawn. */
  inconsistent: boolean;
}

function effectiveBound(p: TokenParts, w: Weights, requests: number, unpaired = false) {
  if (requests === 0) return { value: 0, lowerBound: false };
  const exact = unpaired ? undefined : effectiveTokens(p, w);
  if (exact !== undefined && Number.isFinite(exact)) return { value: exact, lowerBound: false };
  const { input, cached, output } = p;
  if (![input, cached, output].some(sum => sum.known !== undefined)) return { value: undefined, lowerBound: true };
  // Without a reliable split, charge known cached input at its weight and remaining known input
  // at the cheaper weight. Unknown output contributes nothing to this floor.
  const c = cached.known ?? 0;
  const value = c * w.cached + Math.max(0, (input.known ?? 0) - c) * Math.min(1, w.cached) + (output.known ?? 0) * w.output;
  return { value: Number.isFinite(value) ? value : undefined, lowerBound: true };
}

function combineEffective(parts: readonly ReturnType<typeof effectiveBound>[]) {
  const values = parts.flatMap(part => part.value === undefined ? [] : [part.value]);
  const value = values.reduce((sum, n) => sum + n, 0);
  return { value: values.length && Number.isFinite(value) ? value : undefined, lowerBound: parts.some(part => part.lowerBound) };
}

function summaryEffectiveOf(g: UsageGroup, w: Weights) {
  return effectiveBound(g.summary, w, g.summaryRequests);
}

export function groupEffective(g: UsageGroup, w: Weights) {
  return combineEffective([
    effectiveBound(g.conversation, w, g.requests, g.unknownPairs > 0),
    summaryEffectiveOf(g, w),
  ]);
}

export const groupIncomplete = (g: UsageGroup): boolean =>
  partsIncomplete(g.conversation) || (g.summaryRequests > 0 && partsIncomplete(g.summary)) || g.unknownPairs > 0;

export function dayFacts(dayKeys: readonly string[], groups: ReadonlyMap<string, UsageGroup>, w: Weights): DayFacts[] {
  return dayKeys.map((key) => {
    const g = groups.get(key);
    if (!g) return { key, recorded: false, uncached: undefined, cached: undefined, output: undefined, summaryUncached: undefined, summaryCached: undefined, summaryOutput: undefined, effective: undefined, effectiveLowerBound: false, summaryEffective: undefined, rate: undefined, compactions: 0, requests: 0, incomplete: false, inconsistent: false };
    const c = splitParts(g.conversation);
    const s = splitParts(g.summary);
    const effective = groupEffective(g, w);
    return {
      key,
      recorded: true,
      uncached: c.uncached,
      cached: c.cached,
      output: c.output,
      summaryUncached: s.uncached,
      summaryCached: s.cached,
      summaryOutput: s.output,
      effective: effective.value,
      effectiveLowerBound: effective.lowerBound,
      summaryEffective: summaryEffectiveOf(g, w).value,
      rate: cacheRate(g.conversation, g.unknownPairs),
      compactions: g.compactions,
      requests: g.requests,
      incomplete: groupIncomplete(g),
      inconsistent: c.inconsistent || s.inconsistent,
    };
  });
}

export interface PeriodTotals {
  effective: number | undefined;
  effectiveLowerBound: boolean;
  summaryEffective: number | undefined;
  summaryEffectiveLowerBound: boolean;
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
  if (!total) return { effective: undefined, effectiveLowerBound: false, summaryEffective: undefined, summaryEffectiveLowerBound: false, rate: undefined, compactions: 0, summaryRequests: 0, requests: 0, incomplete: false, days: 0 };
  const effective = combineEffective(all.map(group => groupEffective(group, w)));
  const summary = combineEffective(all.map(group => summaryEffectiveOf(group, w)));
  return {
    effective: effective.value,
    effectiveLowerBound: effective.lowerBound,
    summaryEffective: summary.value,
    summaryEffectiveLowerBound: summary.lowerBound,
    rate: cacheRate(total.conversation, total.unknownPairs),
    compactions: total.compactions,
    summaryRequests: total.summaryRequests,
    requests: total.requests,
    incomplete: all.some(groupIncomplete),
    days: all.length,
  };
}

/** Raw token parts without overlaps. Unknown counters are not zero. */
export function rankingParts(group: UsageGroup): readonly [number | undefined, number | undefined, number | undefined] {
  const exact = (s: Sum) => s.unknown === 0 && !s.overflow && s.known !== undefined && s.known >= 0 ? s.known : undefined;
  const add = (a: number | undefined, b: number | undefined) =>
    a !== undefined && b !== undefined && Number.isSafeInteger(a + b) ? a + b : undefined;
  const { conversation, summary } = group;
  const input = exact(conversation.input);
  const cached = exact(conversation.cached);
  const pair = input !== undefined && cached !== undefined && cached <= input && group.unknownPairs === 0;
  return [group.requests === 0 ? 0 : pair ? add(input - cached, exact(conversation.output)) : undefined,
    group.requests === 0 ? 0 : pair ? cached : undefined,
    group.summaryRequests === 0 ? 0 : add(exact(summary.input), exact(summary.output))];
}

const HOUR_MS = 3_600_000;

export function rollingPeriod(untilMs: number, offsetMinutes: number) {
  const sinceMs = untilMs - DAY_MS;
  const offset = offsetMinutes * 60_000;
  const zone = zoneOf(offsetMinutes);
  const local = (ms: number) => new Date(ms + offset).toISOString();
  const hours = [];
  for (let start = Math.floor((sinceMs + offset) / HOUR_MS) * HOUR_MS - offset; start < untilMs; start += HOUR_MS) {
    const since = Math.max(start, sinceMs);
    const until = Math.min(start + HOUR_MS, untilMs);
    hours.push({ key: local(start).slice(0, 19) + zone, label: local(start).slice(11, 16),
      since: local(since).slice(0, -1) + zone, until: local(until).slice(0, -1) + zone, partial: until - since < HOUR_MS });
  }
  return { since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString(), zone, offsetMinutes, hours };
}

export function hourlyTotals(groups: readonly UsageGroup[]) {
  const total = totalGroups(groups);
  const hasPair = (g: UsageGroup) => {
    const { input, cached } = g.conversation;
    return input.known !== undefined && cached.known !== undefined && cached.known >= 0 && cached.known <= input.known &&
      !input.unknown && !cached.unknown && !input.overflow && !cached.overflow && g.unknownPairs === 0;
  };
  const input = total?.conversation.input;
  const cached = total?.conversation.cached;
  const uncached = total && input?.known !== undefined && cached?.known !== undefined && hasPair(total) &&
    groups.every(g => !g.requests || hasPair(g)) ? input.known - cached.known : undefined;
  return { requests: total && Number.isSafeInteger(total.requests) ? total.requests : undefined,
    uncached, share: total && uncached !== undefined ? cacheRate(total.conversation, total.unknownPairs) : undefined };
}
