import { Fragment } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ANALYTICS_SECTIONS, analyticsSection, cacheRate, COMPACTION_ROWS, dayFacts, DEFAULT_WEIGHTS, effectiveTokens, formatClock, formatDuration, formatRoute, formatTokens, groupEffective, groupIncomplete, meanInput, rankingParts, periodTotals, PERIODS, readWeights, shortDay,
  splitParts, type AnalyticsSection, type AppModel, type CompactionEvent, type DayFacts, type DesignContext, type Translate, type UsageGroup, type WalkState, type Weights,
} from "../../../ui-core/src";
import { Button, IconButton } from "../system/components/Button";
import { ButtonGroup } from "../system/components/ButtonGroup";
import { Chart, type ChartPoint, type ChartSeries } from "../system/components/Chart";
import { DataTable } from "../system/components/DataTable";
import { Field } from "../system/components/Field";
import { Notice } from "../system/components/Notice";
import { PageHeader } from "../system/components/PageHeader";
import { RangeBar } from "../system/components/RangeBar";
import { RankedBar, RankedBarLegend } from "../system/components/RankedBar";
import { Section } from "../system/components/Section";
import { Stat } from "../system/components/Stat";
import { SubView } from "../system/components/SubView";
import { type IconRole } from "../system/components/Icon";
import { IndexPane, MemoryPane, StoragePane } from "./Resources";
import { tokenTotal } from "./usage-label";

import { RollingOverview } from "./RollingOverview";

const percent = (v: number): string => `${Math.round(v * 100)}%`;
/** A share too small to round to 0.1% says so, rather than reading as none. */
const shareText = (fraction: number): string => (fraction > 0 && fraction < 0.001 ? "<0.1" : String(Math.round(fraction * 1000) / 10));
const noteOf = (t: Translate, d: DayFacts): string | undefined => (d.inconsistent ? t("common.inconsistent") : d.incomplete ? t("common.incomplete") : undefined);

function peakSummary(t: Translate, days: number, values: (number | undefined)[], format: (n: number) => string, lowerBound = false): string {
  const known = values.filter((v): v is number => v !== undefined);
  const value = known.length ? format(Math.max(...known)) : t("analytics.noValue");
  return t(lowerBound && known.length ? "chart.ariaPeakLowerBound" : "chart.ariaPeak", { days, value });
}

function WalkNotice({ t, state, onStop, onContinue, onRetry }: { t: Translate; state: WalkState; onStop: () => void; onContinue: () => void; onRetry: () => void }) {
  const c = state.coverage;
  if (state.status === "loading")
    return <Notice actions={<Button variant="ghost" onClick={onStop}>{t("analytics.stop")}</Button>}>{t("analytics.walking", { n: c.windows + 1 })}</Notice>;
  if (state.status === "stopped")
    return <Notice tone="wait" actions={state.canContinue ? <Button variant="ghost" onClick={onContinue}>{t("analytics.continue")}</Button> : undefined}>{t("analytics.stopped", { n: c.windows })}</Notice>;
  if (state.status === "failed")
    return <Notice tone="bad" actions={state.canContinue ? <Button variant="ghost" onClick={onContinue}>{t("analytics.continue")}</Button> : <Button variant="ghost" onClick={onRetry}>{t("common.refresh")}</Button>}>{t("analytics.failed", { message: state.error?.message ?? "" })}</Notice>;
  return null;
}

function Weighting({ context }: { context: DesignContext }) {
  const t = context.model.t.value;
  const weights = context.prefs.value.weights;
  const [draft, setDraft] = useState<{ n: string; m: string }>({ n: String(weights.cached), m: String(weights.output) });
  const parse = (s: string): number | undefined => {
    const v = s.trim() === "" ? NaN : Number(s);
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  const invalid = parse(draft.n) === undefined || parse(draft.m) === undefined;
  const change = (next: { n: string; m: string }) => {
    setDraft(next);
    const cached = parse(next.n);
    const output = parse(next.m);
    context.setPrefs({ weights: readWeights({ cached: cached ?? weights.cached, output: output ?? weights.output }) });
  };
  return (
    <Section title={t("weights.title")} sub={<span class="mono">{t("weights.formula")}</span>}>
      <div class="fieldrow">
        <Field label={t("weights.n")} type="number" min="0" step="0.05" inputMode="decimal" value={draft.n} onInput={(e) => change({ ...draft, n: e.currentTarget.value })} />
        <Field label={t("weights.m")} type="number" min="0" step="0.5" inputMode="decimal" value={draft.m} onInput={(e) => change({ ...draft, m: e.currentTarget.value })} />
        <Button variant="ghost" onClick={() => { setDraft({ n: String(DEFAULT_WEIGHTS.cached), m: String(DEFAULT_WEIGHTS.output) }); context.setPrefs({ weights: DEFAULT_WEIGHTS }); }}>{t("weights.reset")}</Button>
      </div>
      {invalid ? <Notice tone="wait">{t("weights.invalid")}</Notice> : null}
      <div class="muted caption">{t("weights.note")}</div>
    </Section>
  );
}

function walkComplete(walk: WalkState): boolean {
  const c = walk.coverage;
  return walk.status === "done" && !c.scopeIncomplete && c.excludedTime === 0 && c.unknownTimeCompactions === 0 && c.malformedCompactions === 0;
}

function periodPlaceholder(t: Translate, walk: WalkState, complete: boolean): string {
  if (walk.status === "loading") return t("usage.aggregating");
  if (complete) return t("analytics.noValue");
  return t(walk.groups.size ? "usage.unfinished" : "analytics.notRead");
}

function effectiveLabel(t: Translate, value: number, lowerBound: boolean): string {
  return lowerBound ? t("usage.minimum", { value: Math.floor(value).toLocaleString("en-US") }) : formatTokens(Math.round(value));
}

function usageColumns(t: Translate) {
  return [{ label: t("usage.input"), numeric: true }, { label: t("usage.cached"), numeric: true }, { label: t("usage.output"), numeric: true }];
}

function usageCells(t: Translate, parts: UsageGroup["conversation"], incomplete: boolean) {
  return [parts.input, parts.cached, parts.output].map(sum => tokenTotal(t, sum, incomplete));
}

function ModelUsage({ model, threadId, title, onClose }: { model: AppModel; threadId: string; title: string; onClose: () => void }) {
  const t = model.t.value;
  const i = model.insights;
  const period = i.period.value;
  const walk = useMemo(() => i.modelWalk(threadId, period), [i, threadId, period]);
  useEffect(() => { void walk.start(); return () => walk.reset(); }, [walk]);
  const state = walk.state.value;
  const label = t("usage.models", { thread: title });
  return <Section title={label} sub={t("usage.modelScope")} actions={<IconButton glyph="settings.close" label={t("usage.closeModels")} onClick={onClose} />} source={<code>usage.get group_by=model</code>}>
    <WalkNotice t={t} state={state} onStop={() => walk.stop()} onContinue={() => void walk.continue()} onRetry={() => void walk.start()} />
    <Coverage t={t} walk={state} />
    {state.capped ? <Notice tone="wait">{t("usage.unfinished")}</Notice> : null}
    {state.groups.size ? <DataTable caption={label} columns={[{ label: t("usage.model") }, ...usageColumns(t)]}
      rows={[...state.groups.values()].map(g => ({ key: g.key, cells: [g.key, ...usageCells(t, g.conversation, !walkComplete(state))] }))} />
      : state.status === "done" ? <Notice>{t("analytics.empty")}</Notice> : null}
  </Section>;
}

const RANK_METRICS = [
  { label: "ranking.excluding", parts: [0, 2] },
  { label: "ranking.total", parts: [0, 1, 2] },
  { label: "ranking.cached", parts: [1] },
  { label: "usage.summary", parts: [2] },
] as const;
const RANK_PARTS = ["ranking.other", "ranking.cached", "usage.summary"] as const;

function ByThread({ model, weights }: { model: AppModel; weights: Weights }) {
  const t = model.t.value;
  const i = model.insights;
  const walk = i.byThread.state.value;
  const threadRows = model.rowById.value;
  const [limit, setLimit] = useState(25);
  const [choice, choose] = useState(0);
  const [details, setDetails] = useState(false);
  const [selected, select] = useState<string>();
  const returnTo = useRef<string>();
  const detailBack = useRef<HTMLButtonElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const metric = RANK_METRICS[choice]!;
  const included: readonly number[] = metric.parts;
  const nameOf = (key: string) => threadRows.get(key)?.summary.title || key;
  const rows = [...walk.groups.values()].map(group => {
    const values = rankingParts(group);
    const parts = values.map((value, index) => included.includes(index) ? value : 0);
    const sum = parts.reduce<number>((n, value) => n + (value ?? NaN), 0);
    return { key: group.key, title: nameOf(group.key), parts, sum, values };
  }).sort((a, b) => (Number.isFinite(b.sum) ? b.sum : -1) - (Number.isFinite(a.sum) ? a.sum : -1) || a.key.localeCompare(b.key));
  const total = rows.reduce((n, row) => n + row.sum, 0);
  const complete = walkComplete(walk) && !walk.capped && Number.isSafeInteger(total) && rows.every(row => Number.isSafeInteger(row.sum));
  const top = Math.max(1, rows[0]?.sum ?? 0);
  const detail = rows.find(row => row.key === selected);
  const number = (value: number) => value.toLocaleString();
  useLayoutEffect(() => {
    if (selected) detailBack.current?.focus();
    else if (returnTo.current) {
      buttons.current.get(returnTo.current)?.focus();
      returnTo.current = undefined;
    }
  }, [selected]);
  return <>
    <PeriodHead model={model} section="threads" />
    <Button variant="ghost" aria-pressed={details} onClick={() => setDetails(!details)}>{t("ranking.detailed")}</Button>
    {details ? <ThreadUsageDetails model={model} weights={weights} /> : <Section title={t("threads.heading")} sub={t("ranking.note")} source={<code>usage.get group_by=thread</code>}>
      <ButtonGroup label={t("ranking.metric")}>{RANK_METRICS.map((item, index) =>
        <Button key={item.label} aria-pressed={choice === index} onClick={() => choose(index)}>{t(item.label)}</Button>)}</ButtonGroup>
      <WalkNotice t={t} state={walk} onStop={() => i.byThread.stop()} onContinue={() => void i.byThread.continue()} onRetry={() => void i.byThread.start()} />
      <Coverage t={t} walk={walk} />
      {!complete ? <Notice tone="wait">{t(walk.status === "loading" ? "usage.aggregating" : "ranking.unavailable")}</Notice> :
        !rows.length ? <Notice>{t("threads.none")}</Notice> : detail ? <>
          <Section title={detail.title} sub={t("ranking.detail")} actions={<Button variant="ghost" buttonRef={detailBack} onClick={() => select(undefined)}>{t("ranking.back")}</Button>}>
            <DataTable flat caption={detail.title} columns={[{ label: t("ranking.part") }, { label: t("ranking.tokens"), numeric: true }]}
              rows={RANK_PARTS.map((part, index) => ({ key: part, cells: [t(part), detail.values[index] === undefined ? t("analytics.noValue") : number(detail.values[index])] }))} />
            {threadRows.has(detail.key) ? <a class="nav-link" href={formatRoute({ view: "conversation", threadId: detail.key })}>{detail.title}</a> : null}
            <Button variant="ghost" onClick={() => { void i.showCompaction(detail.key); model.navigate({ view: "analytics", section: "compaction" }); }}>{t("threads.show")}</Button>
          </Section>
          <ModelUsage model={model} threadId={detail.key} title={detail.title} onClose={() => select(undefined)} />
        </> : <>
          <RankedBarLegend labels={RANK_PARTS.map((part, index) => included.includes(index) ? t(part) : undefined)} />
          <DataTable flat centerRows compact caption={t(metric.label)} columns={[
            { label: t("ranking.rank"), numeric: true }, { label: t("threads.thread") },
            { label: t("ranking.tokens"), numeric: true }, { label: t("ranking.share"), numeric: true },
          ]} rows={rows.slice(0, limit).map(({ key, title, parts, sum }, index) => ({ key, cells: [index + 1,
            <Button variant="ghost" aria-label={t("ranking.open", { title })} title={title} buttonRef={node => { if (node) buttons.current.set(key, node); else buttons.current.delete(key); }}
              onClick={() => { returnTo.current = key; select(key); }}><RankedBar name={title} parts={parts.map(value => value ?? 0)} max={top} /></Button>,
            number(sum), total === 0 ? t("analytics.noValue") : sum === 0 ? "0%" : `${shareText(sum / total)}%`,
          ] }))} />
          {rows.length > limit ? <Button variant="ghost" onClick={() => setLimit(limit + 25)}>{t("usage.moreRows")}</Button> : null}
        </>}
    </Section>}
  </>;
}

function ThreadUsageDetails({ model, weights }: { model: AppModel; weights: Weights }) {
  const t = model.t.value;
  const i = model.insights;
  const walk = i.byThread.state.value;
  const threadRows = model.rowById.value;
  const [limit, setLimit] = useState(25);
  const [selected, select] = useState<string>();
  const rows = [...walk.groups.values()].map(g => ({ g, effective: groupEffective(g, weights) }))
    .sort((a, b) => (b.effective.value ?? -1) - (a.effective.value ?? -1)).slice(0, limit);
  const nameOf = (key: string) => threadRows.get(key)?.summary.title ?? key.slice(0, 8);
  const complete = walkComplete(walk);
  const placeholder = periodPlaceholder(t, walk, complete);
  return <>
    <Section title={t("threads.heading")} sub={t("threads.sub")}
      source={<>{t("common.source", { source: "" })}<code>usage.get group_by=thread</code></>}>
      {walk.capped ? <Notice tone="wait">{t("threads.groupsCapped")}</Notice> : null}
      <WalkNotice t={t} state={walk} onStop={() => i.byThread.stop()} onContinue={() => void i.byThread.continue()} onRetry={() => void i.byThread.start()} />
      <Coverage t={t} walk={walk} />
      {rows.length > 0 ? <DataTable caption={t("threads.heading")}
        columns={[{ label: t("threads.thread") }, ...usageColumns(t), { label: t("series.effective"), numeric: true }, { label: t("series.cacheRate"), numeric: true }, { label: t("usage.summary") }, { label: t("threads.mean"), numeric: true }, { label: t("threads.max"), numeric: true }, { label: t("threads.events"), numeric: true }, { label: "" }]}
        rows={rows.map(({ g, effective }) => {
          const rate = complete ? cacheRate(g.conversation, g.unknownPairs) : undefined;
          const mean = meanInput(g);
          const count = t("usage.requests");
          const summary = g.summaryRequests || !complete ? <>
            {usageCells(t, g.summary, !complete).map((value, index) => <div key={index}>{usageColumns(t)[index]!.label}: {value}</div>)}
            <div>{count}: {complete ? g.summaryRequests : t("usage.minimum", { value: g.summaryRequests })}</div>
          </> : `${count}: 0`;
          return { key: g.key, cells: [
            <>{threadRows.has(g.key) ? <a class="nav-link" href={formatRoute({ view: "conversation", threadId: g.key })}>{nameOf(g.key)}</a> : <span class="mono">{nameOf(g.key)}</span>}
              {groupIncomplete(g) ? <div class="muted caption">{t("common.incomplete")}</div> : null}</>,
            ...usageCells(t, g.conversation, !complete), walk.status === "loading" || effective.value === undefined ? placeholder : effectiveLabel(t, effective.value, effective.lowerBound || !complete), rate === undefined ? placeholder : percent(rate), summary,
            mean !== undefined ? formatTokens(Math.round(mean)) : t("analytics.noValue"),
            g.inputMax !== undefined ? formatTokens(g.inputMax) : t("analytics.noValue"), g.compactions,
            <><Button variant="ghost" aria-pressed={selected === g.key} aria-label={`${t("usage.showModels")}: ${nameOf(g.key)}`} onClick={() => select(selected === g.key ? undefined : g.key)}>{t("usage.showModels")}</Button>
              <Button variant="ghost" onClick={() => { void i.showCompaction(g.key); model.navigate({ view: "analytics", section: "compaction" }); }}>{t("threads.show")}</Button></>,
          ] };
        })} /> : walk.status === "done" ? <div class="muted">{t("threads.none")}</div> : null}
      {walk.groups.size > limit ? <Button variant="ghost" onClick={() => setLimit(limit + 25)}>{t("usage.moreRows")}</Button> : null}
    </Section>
    {selected ? <ModelUsage model={model} threadId={selected} title={nameOf(selected)} onClose={() => select(undefined)} /> : null}
  </>;
}

const KIND: Record<string, Parameters<Translate>[0]> = { automatic_reduction: "compact.automatic", summary: "compact.summaryKind", spill: "compact.spill", restore: "compact.restore", compact: "compact.compactKind" };
const REASON: Record<string, Parameters<Translate>[0]> = { proactive_threshold: "compact.proactive", failure: "compact.failure" };

function Effect({ t, e, max, shared }: { t: Translate; e: CompactionEvent; max: number; shared: boolean }) {
  if (!e.afterApplies) return <span class="muted">{t("compact.na")}</span>;
  return (
    <>
      <div class="mono">
        {e.triggerInput !== undefined ? formatTokens(e.triggerInput) : t("analytics.noValue")} {t("compact.to")} {e.afterInput !== undefined ? formatTokens(e.afterInput) : t("analytics.noValue")}
      </div>
      {e.triggerInput !== undefined && e.afterInput !== undefined ? <RangeBar from={e.triggerInput} to={e.afterInput} max={max} aria={t("compact.aria", { from: e.triggerInput, to: e.afterInput })} /> : null}
      {e.afterInput === undefined ? <div class="muted caption">{t("compact.notYet")}</div> : null}
      {e.triggerInput === undefined ? <div class="muted caption">{t("compact.manual")}</div> : null}
      {shared ? <div class="muted caption">{t("compact.shared")}</div> : null}
    </>
  );
}

function CompactionEffect({ model, weights }: { model: AppModel; weights: Weights }) {
  const t = model.t.value;
  const c = model.insights.compaction.value;
  const threadRows = model.rowById.value;
  const name = c.threadId ? (threadRows.get(c.threadId)?.summary.title ?? c.threadId.slice(0, 8)) : "";
  const max = Math.max(0, ...c.events.flatMap((e) => [e.triggerInput ?? 0, e.afterInput ?? 0]));
  const attempts = new Map<string, number>();
  for (const e of c.events) if (e.afterAttempt) attempts.set(e.afterAttempt, (attempts.get(e.afterAttempt) ?? 0) + 1);
  return (
    <Section title={t("compact.heading")} sub={c.threadId ? t("compact.sub", { thread: name, n: COMPACTION_ROWS }) : t("compact.noThread")} actions={<a class="nav-link" href={formatRoute({ view: "analytics", section: "threads" })}>{t("compact.other")}</a>} source={<>{t("common.source", { source: "" })}<code>compact.list</code></>}>
      {c.error ? <Notice tone="bad">{t("common.readError", { message: c.error.message })}</Notice> : null}
      {c.loading ? <div class="muted">{t("common.loading")}</div> : null}
      {c.threadId && !c.loading && !c.error && c.events.length === 0 ? <div class="muted">{t("compact.none")}</div> : null}
      {c.events.length > 0 ? (
        <DataTable
          caption={t("compact.heading")}
          columns={[{ label: t("compact.at") }, { label: t("compact.kind") }, { label: t("compact.effect") }, { label: t("compact.cost"), numeric: true }]}
          rows={c.events.map((e) => {
            const split = e.summary ? splitParts(e.summary) : undefined;
            const effective = e.summary ? effectiveTokens(e.summary, weights) : undefined;
            const kind = KIND[e.kind];
            const reason = e.reason ? REASON[e.reason] : undefined;
            return {
              key: e.id,
              cells: [
                <span class="mono">{e.at ? `${e.at.slice(5, 10)} ${formatClock(e.at) ?? ""}` : t("analytics.noValue")}</span>,
                <>
                  {kind ? t(kind) : <span class="mono">{e.kind}</span>}
                  {reason ? <div class="muted caption">{t(reason)}</div> : null}
                  {e.state ? <div class="muted caption mono">{e.state}</div> : null}
                </>,
                <Effect t={t} e={e} max={max} shared={!!e.afterAttempt && (attempts.get(e.afterAttempt) ?? 0) > 1} />,
                split && effective !== undefined ? (
                  <>
                    {formatTokens(Math.round(effective))}
                    <div class="muted caption">{t("compact.costNote", { requests: e.summaryRequests ?? 0 })}</div>
                  </>
                ) : (
                  <span class="muted">{t("analytics.noValue")}</span>
                ),
              ],
            };
          })}
        />
      ) : null}
      {c.limited ? <div class="muted caption">{t("compact.limited")}</div> : null}
      {c.more ? <div class="muted caption">{t("compact.more")}</div> : null}
    </Section>
  );
}

const ICONS: Record<AnalyticsSection, IconRole> = { overview: "analytics.overview", tokens: "analytics.tokens", compaction: "analytics.compaction", threads: "analytics.threads", storage: "analytics.storage", memory: "analytics.memory", index: "analytics.index" };

function PeriodHead({ model, section }: { model: AppModel; section: AnalyticsSection }) {
  const t = model.t.value;
  const i = model.insights;
  const rolling = section === "overview" && i.rolling.enabled.value;
  const walk = section === "threads" ? i.byThread.state.value : i.daily.state.value;
  return (
    <PageHeader title={t(`ana.section.${section}`)} description={rolling ? undefined : `${t(`ana.sub.${section}`)} ${t("analytics.subtitle", { zone: i.period.value.zone })}`} toolbar={
      <div class={section === "overview" ? "choice-row analytics-period" : "choice-row"}>
        <ButtonGroup label={t("analytics.period")}>
          {PERIODS.map((p) => (
            <Fragment key={p}>
              <Button aria-pressed={!rolling && i.periodDays.value === p} onClick={() => i.setPeriod(p)}>
                {p === 1 ? t("analytics.today") : t("analytics.days", { n: p })}
              </Button>
              {p === 1 && section === "overview" ? <Button aria-pressed={rolling} onClick={() => { i.rolling.enabled.value = true; }}>{t("analytics.hours24")}</Button> : null}
            </Fragment>
          ))}
        </ButtonGroup>
        {!rolling ? <IconButton glyph="action.retry" label={t("common.refresh")} disabled={walk.status === "loading"} onClick={() => i.refreshUsage()} /> : null}
      </div>
    } />
  );
}

function Coverage({ t, walk }: { t: Translate; walk: WalkState }) {
  const c = walk.coverage;
  if (walk.status !== "done") return null;
  return (
    <div class="muted caption">
      {t("analytics.covered", { windows: c.windows, ms: formatDuration(c.elapsedMs), requests: c.matchedAttempts.toLocaleString("en-US"), compactions: c.matchedCompactions.toLocaleString("en-US") })}{" "}
      {c.scopeIncomplete ? t("usage.unfinished") : null}{" "}
      {c.excludedTime + c.unknownTimeCompactions + c.malformedCompactions > 0 ? t("analytics.excluded", { time: c.excludedTime, unknown: c.unknownTimeCompactions, malformed: c.malformedCompactions }) : null}
    </div>
  );
}

function UsagePane({ context, section }: { context: DesignContext; section: "overview" | "tokens" | "compaction" }) {
  const model = context.model;
  const t = model.t.value;
  const i = model.insights;
  const weights = context.prefs.value.weights;
  const walk = i.daily.state.value;
  const days = dayFacts(i.period.value.dayKeys, walk.groups, weights);
  const totals = periodTotals(walk.groups, weights);
  // Nothing read yet isn't the same as the owner having no value.
  const notReported = walk.groups.size > 0 || walk.status === "done" ? t("analytics.noValue") : walk.status === "loading" ? t("common.loading") : t("analytics.notRead");
  const hasSomething = walk.groups.size > 0;
  const complete = walkComplete(walk);
  const periodValue = periodPlaceholder(t, walk, complete);
  const parts: ChartSeries[] = [
    { id: "cached", label: t("series.cached"), tone: "2" },
    { id: "uncached", label: t("series.uncached"), tone: "1" },
    { id: "output", label: t("series.output"), tone: "3" },
  ];
  const point = (d: DayFacts, values: ChartPoint["values"]): ChartPoint => ({ key: d.key, label: shortDay(d.key), values, note: !complete && d.recorded ? t("usage.unfinished") : noteOf(t, d) });
  const tokens = (n: number) => formatTokens(Math.round(n));
  const source = (read: string) => <>{t("common.source", { source: "" })}<code>{read}</code></>;
  const common = { tableLabel: t("analytics.table"), categoryLabel: t("analytics.day"), noData: notReported };
  const dailyParts = days.map(d => [d.cached, d.uncached, d.output]);
  const dailyTotals = dailyParts.map(values => values.some(v => v !== undefined) ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0) : undefined);
  const dailyLowerBound = !complete || days.some((d, index) => d.recorded && (d.incomplete || d.inconsistent || dailyParts[index]!.some(v => v === undefined)));

  const summaryStat = (
    <Stat
      label={t("stat.summary")}
      value={walk.status !== "loading" && totals.summaryEffective !== undefined ? effectiveLabel(t, totals.summaryEffective, totals.summaryEffectiveLowerBound || !complete) : periodValue}
      note={complete && !totals.effectiveLowerBound && totals.summaryEffective !== undefined && totals.effective ? t("stat.summaryNote", { share: shareText(totals.summaryEffective / totals.effective), n: totals.summaryRequests.toLocaleString("en-US") }) : undefined}
    />
  );
  const eventsStat = <Stat label={t("stat.compactions")} value={hasSomething && walk.status !== "loading" ? complete ? totals.compactions.toLocaleString("en-US") : t("usage.minimum", { value: totals.compactions.toLocaleString("en-US") }) : periodValue} note={t("stat.compactionsNote")} />;

  return (
    <>
      <PeriodHead model={model} section={section} />
      <WalkNotice t={t} state={walk} onStop={() => i.daily.stop()} onContinue={() => void i.daily.continue()} onRetry={() => i.refreshUsage()} />
      <Coverage t={t} walk={walk} />
      {walk.status === "done" && !hasSomething ? <Notice>{t("analytics.empty")}</Notice> : null}

      {section === "overview" ? (
        <>
          <div class="stats">
            <Stat label={t("stat.effective")} value={walk.status !== "loading" && totals.effective !== undefined ? effectiveLabel(t, totals.effective, totals.effectiveLowerBound || !complete) : periodValue} note={totals.incomplete ? t("common.incomplete") : t("stat.effectiveNote")} />
            <Stat label={t("stat.cacheRate")} value={complete && totals.rate !== undefined ? percent(totals.rate) : periodValue} note={t("stat.cacheRateNote")} />
            {summaryStat}
            {eventsStat}
          </div>
          <Weighting context={context} />
          <Chart
            kind="columns"
            title={t("chart.effective")}
            sub={t("chart.effectiveSub")}
            series={[{ id: "effective", label: t("series.effective"), tone: "neutral" }]}
            points={complete ? days.map(d => ({ ...point(d, { effective: d.effective }), note: d.effectiveLowerBound && d.effective !== undefined ? effectiveLabel(t, d.effective, true) : noteOf(t, d) })) : []}
            format={n => Math.floor(n).toLocaleString("en-US")}
            ariaSummary={t("chart.effectiveAria", { summary: peakSummary(t, days.length, complete ? days.map(d => d.effective) : [], n => Math.floor(n).toLocaleString("en-US"), days.some(d => d.effectiveLowerBound)) })}
            source={<>{source("usage.get group_by=day")}, {t("chart.effectiveLocal")}</>}
            {...common}
          />
        </>
      ) : null}

      {section === "tokens" ? (
        <>
          <Chart
            kind="columns"
            title={t("chart.daily")}
            sub={t("chart.dailySub")}
            series={parts}
            points={days.map((d) => point(d, { cached: d.cached, uncached: d.uncached, output: d.output }))}
            format={tokens}
            ariaSummary={t("chart.dailyAria", { summary: peakSummary(t, days.length, dailyTotals, tokens, dailyLowerBound) })}
            source={source("usage.get group_by=day")}
            {...common}
          />
          <Chart
            kind="line"
            title={t("chart.cache")}
            sub={t("chart.cacheSub")}
            series={[{ id: "rate", label: t("series.cacheRate"), tone: "2" }]}
            points={days.map((d) => point(d, { rate: complete ? d.rate : undefined }))}
            format={percent}
            floorMax={1}
            ariaSummary={t("chart.cacheAria", { summary: peakSummary(t, days.length, days.map((d) => complete ? d.rate : undefined), percent) })}
            source={source("usage.get group_by=day")}
            {...common}
          />
        </>
      ) : null}

      {section === "compaction" ? (
        <>
          <div class="stats">
            {summaryStat}
            {eventsStat}
          </div>
          <div class="charts">
            <Chart
              kind="columns"
              title={t("chart.summary")}
              sub={t("chart.summarySub")}
              series={parts}
              points={days.map((d) => point(d, { cached: d.summaryCached, uncached: d.summaryUncached, output: d.summaryOutput }))}
              format={tokens}
              ariaSummary={t("chart.summaryAria", { summary: peakSummary(t, days.length, days.map((d) => (d.recorded ? (d.summaryCached ?? 0) + (d.summaryUncached ?? 0) + (d.summaryOutput ?? 0) : undefined)), tokens) })}
              source={source("usage.get group_by=day, compaction")}
              {...common}
            />
            <Chart
              kind="columns"
              title={t("chart.events")}
              sub={t("chart.eventsSub")}
              series={[{ id: "events", label: t("series.compactions"), tone: "neutral" }]}
              points={days.map((d) => point(d, { events: d.recorded ? d.compactions : undefined }))}
              format={String}
              whole
              ariaSummary={t("chart.eventsAria", { summary: peakSummary(t, days.length, days.map((d) => (d.recorded ? d.compactions : undefined)), String) })}
              source={source("usage.get group_by=day, compaction.compactions")}
              {...common}
            />
          </div>
          <CompactionEffect model={model} weights={weights} />
        </>
      ) : null}
    </>
  );
}

export function Analytics({ context }: { context: DesignContext }) {
  const model = context.model;
  const t = model.t.value;
  const section = analyticsSection(model.route.value);
  return (
    <SubView
      title={t("view.analytics")}
      items={ANALYTICS_SECTIONS.map((s) => ({ key: s, href: formatRoute({ view: "analytics", section: s }), role: ICONS[s], label: t(`ana.section.${s}`), current: s === section }))}
    >
      {section === "overview" || section === "tokens" || section === "compaction" ? (
        section === "overview" && model.insights.rolling.enabled.value ? <>
          <PeriodHead model={model} section={section} />
          <RollingOverview model={model} />
        </> : <UsagePane context={context} section={section} />
      ) : section === "threads" ? (
        <ByThread model={model} weights={context.prefs.value.weights} />
      ) : section === "storage" ? (
        <StoragePane model={model} />
      ) : section === "memory" ? (
        <MemoryPane model={model} />
      ) : (
        <IndexPane model={model} />
      )}
    </SubView>
  );
}
