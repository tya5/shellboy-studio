import { useState } from "preact/hooks";
import {
  ANALYTICS_SECTIONS, analyticsSection, cacheRate, COMPACTION_ROWS, dayFacts, DEFAULT_WEIGHTS, effectiveTokens, formatClock, formatDuration, formatRoute, formatTokens, groupEffective, groupIncomplete, meanInput, periodTotals, PERIODS, readWeights, shortDay,
  splitParts, type AnalyticsSection, type AppModel, type CompactionEvent, type DayFacts, type DesignContext, type Translate, type UsageGroup, type WalkState, type Weights,
} from "../../../ui-core/src";
import { Button, ButtonGroup, Chart, DataTable, Field, Notice, RangeBar, Section, Stat, SubView, type ChartPoint, type ChartSeries, type IconName } from "../system/components";
import { IndexPane, MemoryPane, StoragePane } from "./Resources";

const percent = (v: number): string => `${Math.round(v * 100)}%`;
/** A share too small to round to 0.1% says so, rather than reading as none. */
const shareText = (fraction: number): string => (fraction > 0 && fraction < 0.001 ? "<0.1" : String(Math.round(fraction * 1000) / 10));
const noteOf = (t: Translate, d: DayFacts): string | undefined => (d.inconsistent ? t("common.inconsistent") : d.incomplete ? t("common.incomplete") : undefined);

function peakSummary(t: Translate, days: number, values: (number | undefined)[], format: (n: number) => string): string {
  const known = values.filter((v): v is number => v !== undefined);
  return t("chart.ariaPeak", { days, value: known.length ? format(Math.max(...known)) : t("analytics.noValue") });
}

function WalkNotice({ t, state, onStop, onContinue, onRetry }: { t: Translate; state: WalkState; onStop: () => void; onContinue: () => void; onRetry: () => void }) {
  const c = state.coverage;
  if (state.status === "loading")
    return <Notice actions={<Button onClick={onStop}>{t("analytics.stop")}</Button>}>{t("analytics.walking", { n: c.windows + 1 })}</Notice>;
  if (state.status === "stopped")
    return <Notice tone="wait" actions={state.canContinue ? <Button onClick={onContinue}>{t("analytics.continue")}</Button> : undefined}>{t("analytics.stopped", { n: c.windows })}</Notice>;
  if (state.status === "failed")
    return <Notice tone="bad" actions={state.canContinue ? <Button onClick={onContinue}>{t("analytics.continue")}</Button> : <Button onClick={onRetry}>{t("common.refresh")}</Button>}>{t("analytics.failed", { message: state.error?.message ?? "" })}</Notice>;
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
        <div class="lab">
          {t("weights.n")}
          <Field ariaLabel={t("weights.n")} type="number" min="0" step="0.05" inputMode="decimal" value={draft.n} onInput={(e) => change({ ...draft, n: e.currentTarget.value })} />
        </div>
        <div class="lab">
          {t("weights.m")}
          <Field ariaLabel={t("weights.m")} type="number" min="0" step="0.5" inputMode="decimal" value={draft.m} onInput={(e) => change({ ...draft, m: e.currentTarget.value })} />
        </div>
        <Button onClick={() => { setDraft({ n: String(DEFAULT_WEIGHTS.cached), m: String(DEFAULT_WEIGHTS.output) }); context.setPrefs({ weights: DEFAULT_WEIGHTS }); }}>{t("weights.reset")}</Button>
      </div>
      {invalid ? <Notice tone="wait">{t("weights.invalid")}</Notice> : null}
      <div class="muted caption">{t("weights.note")}</div>
    </Section>
  );
}

function ByThread({ model, weights }: { model: AppModel; weights: Weights }) {
  const t = model.t.value;
  const i = model.insights;
  const walk = i.byThread.state.value;
  const threadRows = model.rowById.value;
  const rows = [...walk.groups.values()].sort((a, b) => (groupEffective(b, weights) ?? 0) - (groupEffective(a, weights) ?? 0)).slice(0, 25);
  const nameOf = (g: UsageGroup) => threadRows.get(g.key)?.summary.title ?? g.key.slice(0, 8);
  return (
    <Section
      title={t("threads.heading")}
      sub={t("threads.sub")}
      source={<>{t("common.source", { source: "" })}<code>usage.get group_by=thread</code></>}
    >
      {walk.capped ? <Notice tone="wait">{t("threads.groupsCapped")}</Notice> : null}
      <WalkNotice t={t} state={walk} onStop={() => i.byThread.stop()} onContinue={() => void i.byThread.continue()} onRetry={() => void i.byThread.start()} />
      {rows.length > 0 ? (
        <DataTable
          caption={t("threads.heading")}
          columns={[{ label: t("threads.thread") }, { label: t("series.effective"), numeric: true }, { label: t("series.cacheRate"), numeric: true }, { label: t("threads.mean"), numeric: true }, { label: t("threads.max"), numeric: true }, { label: t("threads.events"), numeric: true }, { label: "" }]}
          rows={rows.map((g) => {
            const effective = groupEffective(g, weights);
            const rate = cacheRate(g.conversation);
            const mean = meanInput(g);
            return {
              key: g.key,
              cells: [
                <>
                  {threadRows.has(g.key) ? <a href={formatRoute({ view: "conversation", threadId: g.key })}>{nameOf(g)}</a> : <span class="mono">{nameOf(g)}</span>}
                  {groupIncomplete(g) ? <div class="muted caption">{t("common.incomplete")}</div> : null}
                </>,
                effective !== undefined ? formatTokens(Math.round(effective)) : t("analytics.noValue"),
                rate !== undefined ? percent(rate) : t("analytics.noValue"),
                mean !== undefined ? formatTokens(Math.round(mean)) : t("analytics.noValue"),
                g.inputMax !== undefined ? formatTokens(g.inputMax) : t("analytics.noValue"),
                g.compactions,
                <Button variant="link" aria-pressed={i.compaction.value.threadId === g.key} onClick={() => { void i.showCompaction(g.key); model.navigate({ view: "analytics", section: "compaction" }); }}>{t("threads.show")}</Button>,
              ],
            };
          })}
        />
      ) : walk.status === "done" ? (
        <div class="muted">{t("threads.none")}</div>
      ) : null}
    </Section>
  );
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
    <Section title={t("compact.heading")} sub={c.threadId ? t("compact.sub", { thread: name, n: COMPACTION_ROWS }) : t("compact.noThread")} actions={<a class="btn" href={formatRoute({ view: "analytics", section: "threads" })}>{t("compact.other")}</a>} source={<>{t("common.source", { source: "" })}<code>compact.list</code></>}>
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

const ICONS: Record<AnalyticsSection, IconName> = { overview: "chart", tokens: "layers", compaction: "retry", threads: "tree", storage: "database", memory: "cube", index: "search" };

function PeriodHead({ model, section }: { model: AppModel; section: AnalyticsSection }) {
  const t = model.t.value;
  const i = model.insights;
  const walk = section === "threads" ? i.byThread.state.value : i.daily.state.value;
  return (
    <div class="head">
      <div class="pagehead">
        <h1>{t(`ana.section.${section}`)}</h1>
        <div class="muted">{t(`ana.sub.${section}`)} {t("analytics.subtitle", { zone: i.period.value.zone })}</div>
      </div>
      <div class="band">
        <ButtonGroup label={t("analytics.period")}>
          {PERIODS.map((p) => (
            <Button key={p} aria-pressed={i.periodDays.value === p} onClick={() => i.setPeriod(p)}>
              {p === 1 ? t("analytics.today") : t("analytics.days", { n: p })}
            </Button>
          ))}
        </ButtonGroup>
        <Button disabled={walk.status === "loading"} onClick={() => i.refreshUsage()}>{t("common.refresh")}</Button>
      </div>
    </div>
  );
}

function Coverage({ t, walk }: { t: Translate; walk: WalkState }) {
  const c = walk.coverage;
  if (walk.status !== "done") return null;
  return (
    <div class="muted caption">
      {t("analytics.covered", { windows: c.windows, ms: formatDuration(c.elapsedMs), requests: c.matchedAttempts.toLocaleString("en-US"), compactions: c.matchedCompactions.toLocaleString("en-US") })}{" "}
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
  const parts: ChartSeries[] = [
    { id: "cached", label: t("series.cached"), tone: "2" },
    { id: "uncached", label: t("series.uncached"), tone: "1" },
    { id: "output", label: t("series.output"), tone: "3" },
  ];
  const point = (d: DayFacts, values: ChartPoint["values"]): ChartPoint => ({ key: d.key, label: shortDay(d.key), values, note: noteOf(t, d) });
  const tokens = (n: number) => formatTokens(Math.round(n));
  const source = (read: string) => <>{t("common.source", { source: "" })}<code>{read}</code></>;
  const common = { tableLabel: t("analytics.table"), categoryLabel: t("analytics.day"), noData: notReported };
  const dailyTotals = days.map((d) => (d.recorded ? (d.cached ?? 0) + (d.uncached ?? 0) + (d.output ?? 0) : undefined));

  const summaryStat = (
    <Stat
      label={t("stat.summary")}
      value={totals.summaryEffective !== undefined ? tokens(totals.summaryEffective) : notReported}
      note={totals.summaryEffective !== undefined && totals.effective ? t("stat.summaryNote", { share: shareText(totals.summaryEffective / totals.effective), n: totals.summaryRequests.toLocaleString("en-US") }) : undefined}
    />
  );
  const eventsStat = <Stat label={t("stat.compactions")} value={hasSomething ? totals.compactions.toLocaleString("en-US") : notReported} note={t("stat.compactionsNote")} />;

  return (
    <>
      <PeriodHead model={model} section={section} />
      <WalkNotice t={t} state={walk} onStop={() => i.daily.stop()} onContinue={() => void i.daily.continue()} onRetry={() => i.refreshUsage()} />
      <Coverage t={t} walk={walk} />
      {walk.status === "done" && !hasSomething ? <Notice>{t("analytics.empty")}</Notice> : null}

      {section === "overview" ? (
        <>
          <div class="stats">
            <Stat label={t("stat.effective")} value={totals.effective !== undefined ? tokens(totals.effective) : notReported} note={totals.incomplete ? t("common.incomplete") : t("stat.effectiveNote")} />
            <Stat label={t("stat.cacheRate")} value={totals.rate !== undefined ? percent(totals.rate) : notReported} note={t("stat.cacheRateNote")} />
            {summaryStat}
            {eventsStat}
          </div>
          <Weighting context={context} />
          <Chart
            kind="columns"
            title={t("chart.effective")}
            sub={t("chart.effectiveSub")}
            series={[{ id: "effective", label: t("series.effective"), tone: "neutral" }]}
            points={days.map((d) => point(d, { effective: d.effective }))}
            format={tokens}
            ariaSummary={t("chart.effectiveAria", { summary: peakSummary(t, days.length, days.map((d) => d.effective), tokens) })}
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
            ariaSummary={t("chart.dailyAria", { summary: peakSummary(t, days.length, dailyTotals, tokens) })}
            source={source("usage.get group_by=day")}
            extra={<div class="muted caption">{t("chart.byModelMissing")}</div>}
            {...common}
          />
          <Chart
            kind="line"
            title={t("chart.cache")}
            sub={t("chart.cacheSub")}
            series={[{ id: "rate", label: t("series.cacheRate"), tone: "2" }]}
            points={days.map((d) => point(d, { rate: d.rate }))}
            format={percent}
            floorMax={1}
            ariaSummary={t("chart.cacheAria", { summary: peakSummary(t, days.length, days.map((d) => d.rate), percent) })}
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
      items={ANALYTICS_SECTIONS.map((s) => ({ key: s, href: formatRoute({ view: "analytics", section: s }), icon: ICONS[s], label: t(`ana.section.${s}`), current: s === section }))}
    >
      {section === "overview" || section === "tokens" || section === "compaction" ? (
        <UsagePane context={context} section={section} />
      ) : section === "threads" ? (
        <>
          <PeriodHead model={model} section={section} />
          <ByThread model={model} weights={context.prefs.value.weights} />
        </>
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
