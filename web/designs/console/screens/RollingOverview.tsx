import { formatRoute, hourlyTotals, usageChange, type AppModel, type DesignContext, type Translate } from "../../../ui-core/src";
import { Button, IconButton } from "../system/components/Button";
import { Chart } from "../system/components/Chart";
import { Notice } from "../system/components/Notice";
import { Stat } from "../system/components/Stat";
import { useState } from "preact/hooks";
import { Field } from "../system/components/Field";
import { DataTable } from "../system/components/DataTable";
import { RankedBar } from "../system/components/RankedBar";
import { Section } from "../system/components/Section";

const localLabel = (time: string, exact = false) => time.slice(exact ? 0 : 5, exact ? -6 : 16).replace("T", " ");

export function RollingOverview({ context }: { context: DesignContext }) {
  const { model } = context;
  const t = model.t.value;
  const rolling = model.insights.rolling;
  const active = rolling.walk.state.value;
  const cut = rolling.displayed.value;
  if (!cut) return <Notice>{t("analytics.notRead")}</Notice>;
  const { interval, walk, stale, selection, partial: cutIncomplete } = cut;
  const drilldown = model.insights.bucketDrilldown.value;
  const hours = interval.hours;
  const display = (n: number | undefined) => n === undefined ? t("analytics.noValue") : n.toLocaleString(model.lang.value);
  const facts = hours.map(h => {
    const group = walk.groups.get(h.key);
    const value = group && Number.isSafeInteger(group.requests) ? group.requests : undefined;
    return { ...h, value };
  });
  const totals = hourlyTotals(hours.flatMap(h => {
    const group = walk.groups.get(h.key);
    return group ? [group] : [];
  }));
  const comparing = rolling.comparison.enabled.value;
  const prior = rolling.comparison.walk.state.value;
  const priorInterval = rolling.comparison.interval.value;
  const aligned = priorInterval?.until === interval.since && priorInterval.zone === interval.zone;
  const bothComplete = comparing && !stale && !cutIncomplete && aligned && prior.status === "done" &&
    !prior.coverage.scopeIncomplete && prior.coverage.excludedTime === 0;
  const bothEmpty = bothComplete && !walk.groups.size && !prior.groups.size;
  const baseline = bothComplete ? hourlyTotals(priorInterval.hours.flatMap(h => {
    const group = prior.groups.get(h.key);
    return group ? [group] : [];
  })) : undefined;
  const requestsDelta = baseline ? usageChange(totals.requests, baseline.requests) : undefined;
  const inputDelta = baseline ? usageChange(totals.uncached, baseline.uncached) : undefined;
  const cacheDelta = totals.share === undefined || baseline?.share === undefined ? undefined : (totals.share - baseline.share) * 100;
  const signed = (n: number, style: "percent" | "decimal") => n.toLocaleString(model.lang.value, { style, maximumFractionDigits: 1, signDisplay: "exceptZero" });
  const changeLabel = ({ difference, ratio }: NonNullable<ReturnType<typeof usageChange>>) =>
    `${signed(difference, "decimal")} (${ratio === undefined ? t("analytics.percentUnavailable") : signed(ratio, "percent")})`;
  const deltaNote = (base: number | undefined, change: ReturnType<typeof usageChange>) =>
    change ? `${t("analytics.periodPrevious")}: ${display(base)} · ${changeLabel(change)}` : undefined;
  const outline = bothComplete && totals.requests !== undefined && baseline?.requests !== undefined ? {
    label: t("analytics.periodPrevious"), currentLabel: t("analytics.periodCurrent"),
    values: new Map<string, number>(), details: new Map<string, string>(),
    differenceLabel: t("analytics.difference"), differences: new Map<string, string>(),
  } : undefined;
  const detail = (h: (typeof hours)[number]) => `${localLabel(h.since, true)} – ${localLabel(h.until, true)} (UTC${interval.zone})`;
  if (outline) facts.forEach((h, i) => {
    const previous = priorInterval!.hours[i]!;
    const n = prior.groups.get(previous.key)?.requests;
    if (n !== undefined && Number.isSafeInteger(n)) outline.values.set(h.key, n);
    outline.details.set(h.key, detail(previous));
    const change = usageChange(h.value, n);
    if (change) outline.differences.set(h.key, changeLabel(change));
  });
  const bucket = facts.find(h => h.key === selection?.key);
  const count = (n: number | undefined) => cutIncomplete && n !== undefined ? t("usage.minimum", { value: display(n) }) : display(n);
  const intervalLabel = `${localLabel(hours[0]!.since)} – ${localLabel(hours[hours.length - 1]!.until)} (UTC${interval.zone})`;
  const selectBucket = (key: string) => {
    const next = facts.find(h => h.key === key);
    if (next) model.insights.selectBucketThreads(next.key);
  };
  const moveBucket = (delta: -1 | 1) => {
    const current = selection ? hours.findIndex(h => h.key === selection.key) : delta > 0 ? -1 : 0;
    selectBucket(hours[(current + delta + hours.length) % hours.length]!.key);
  };
  return <div class="rolling-overview">
    <div class="head">
      <div class="muted caption">{t("analytics.ownerWide")} · {intervalLabel}</div>
      <Button aria-pressed={comparing} onClick={() => context.setPrefs({ analyticsCompare: !comparing })}>{t("analytics.compare24")}</Button>
    </div>
    {comparing && !bothComplete ? <Notice tone="wait" actions={prior.status === "loading" ? <Button onClick={() => rolling.comparison.walk.stop()}>{t("analytics.stopPrevious")}</Button>
      : prior.canContinue ? <Button onClick={() => void rolling.comparison.walk.continue()}>{t("analytics.continuePrevious")}</Button>
      : prior.status === "failed" ? <Button onClick={() => rolling.retryComparison()}>{t("analytics.retryPrevious")}</Button> : undefined}>
      {t("analytics.compareIncomplete")}
    </Notice> : null}
    {bothComplete && !bothEmpty && [requestsDelta, inputDelta, cacheDelta].some(v => v === undefined) ? <Notice tone="wait">{t("analytics.compareLimited")}</Notice> : null}
    {stale ? <Notice tone="wait">{t("analytics.asOf")}</Notice> : null}
    {active.status === "loading" ? <Notice actions={<Button onClick={() => rolling.stop()}>{t("analytics.stop")}</Button>}>{t("analytics.walking", { n: active.coverage.windows + 1 })}</Notice> : null}
    {active.status === "stopped" || active.status === "failed" ? <Notice tone={active.status === "failed" ? "bad" : "wait"}
      actions={active.status === "failed" && !active.canContinue ? <Button onClick={() => rolling.retry()}>{t("analytics.retry")}</Button>
        : active.canContinue ? <Button onClick={() => rolling.continue()}>{t("analytics.continue")}</Button> : undefined}>
      {active.status === "failed" ? t("analytics.failed", { message: active.error?.message ?? "" }) : t("analytics.stopped", { n: active.coverage.windows })}
    </Notice> : null}
    {walk.status === "done" && cutIncomplete ? <Notice tone="wait">{t("usage.unfinished")}</Notice> : null}
    <div class="stats">
      <Stat label={t("analytics.requests")} value={count(totals.requests)} note={deltaNote(baseline?.requests, requestsDelta)} />
      <Stat label={t("analytics.uncachedInput")} value={display(cutIncomplete ? undefined : totals.uncached)} note={deltaNote(baseline?.uncached, inputDelta)} />
      <Stat label={t("analytics.pairedCache")} value={cutIncomplete || totals.share === undefined ? t("analytics.noValue") : totals.share.toLocaleString(model.lang.value, { style: "percent", maximumFractionDigits: 1 })} note={<>{cacheDelta === undefined ? null : <div>{t("analytics.periodPrevious")}: {baseline?.share?.toLocaleString(model.lang.value, { style: "percent", maximumFractionDigits: 1 })} · {t("analytics.changePoints", { value: signed(cacheDelta, "decimal") })}</div>}{t("analytics.reportedPairs")}</>} />
    </div>
    <Chart kind="columns" whole title={t("analytics.hourlyRequests")} ariaSummary={t("analytics.hourlyRequests")}
      series={[{ id: "requests", label: t("analytics.requests"), tone: "neutral" }]} format={n => display(n)}
      points={facts.map(h => ({ key: h.key, label: h.label, detail: detail(h), values: { requests: h.value }, note: [h.partial && t("analytics.partialHour"), cutIncomplete && h.value !== undefined && t("usage.unfinished")].filter(Boolean).join(" · ") }))}
      {...(outline ? { reference: outline } : {})}
      selection={{ key: selection?.key, select: selectBucket }}
      tableLabel={t("analytics.table")} categoryLabel={t("analytics.period")} noData={t("analytics.noValue")}
      source={bothEmpty ? t("analytics.compareEmpty") : walk.status === "done" && !walk.groups.size && !cutIncomplete ? t("analytics.empty") : "Core · usage.get"}
      extra={bothEmpty ? undefined : <div class="rolling-stepper">
        <IconButton glyph="analytics.previousBucket" label={t("analytics.previousBucket")} onClick={() => moveBucket(-1)} />
        <div aria-live="polite">{bucket ? <><strong>{localLabel(bucket.since)} – {localLabel(bucket.until)}</strong>
          <div class="muted caption">{t("analytics.requests")}: {count(bucket.value)}{bucket.partial ? ` · ${t("analytics.partialHour")}` : ""}</div>
          {outline ? <div class="muted caption">{outline.label}: {display(outline.values.get(bucket.key))}{outline.differences.has(bucket.key) ? ` · ${outline.differences.get(bucket.key)}` : ""}</div> : null}
        </> : <span class="muted caption">{t("analytics.noBucket")}</span>}</div>
        <IconButton glyph="analytics.nextBucket" label={t("analytics.nextBucket")} onClick={() => moveBucket(1)} />
      </div>}
    />
    {drilldown && bucket && selection?.key === drilldown.key ? <BucketDrilldown key={JSON.stringify([drilldown.owner, drilldown.key, drilldown.since, drilldown.until, drilldown.threadId])} model={model} t={t} bucket={drilldown} /> : null}
  </div>;
}

function BucketDrilldown({ model, t, bucket }: { model: AppModel; t: Translate; bucket: NonNullable<AppModel["insights"]["bucketDrilldown"]["value"]> }) {
  const [rankLimit, setRankLimit] = useState(25);
  const state = bucket.walk.state.value;
  const groups = [...state.groups.values()].sort((a, b) => b.requests - a.requests || a.key.localeCompare(b.key));
  const max = Math.max(1, ...groups.map(group => group.requests));
  const isThreadScope = bucket.threadId !== undefined;
  const partial = state.status !== "done" || state.coverage.scopeIncomplete || state.coverage.excludedTime > 0 || state.coverage.unknownTimeCompactions > 0 || state.coverage.malformedCompactions > 0 || state.capped === true;
  const options = [
    { value: "", label: t("analytics.allThreads") },
    ...(!isThreadScope ? groups : []).map(group => ({ value: group.key, label: model.rowById.value.get(group.key)?.summary.title ?? group.key })),
    ...(bucket.threadId ? [{ value: bucket.threadId, label: model.rowById.value.get(bucket.threadId)?.summary.title ?? bucket.threadId }] : []),
  ];
  const title = isThreadScope ? t("analytics.bucketModels") : t("analytics.bucketThreads");
  const threadLabel = bucket.threadId ? model.rowById.value.get(bucket.threadId)?.summary.title ?? bucket.threadId : undefined;
  const rows = groups.slice(0, rankLimit).map(group => ({ key: group.key, cells: [
    <RankedBar name={isThreadScope ? group.key : model.rowById.value.get(group.key)?.summary.title ?? group.key} parts={[group.requests]} max={max} />,
    <>{group.requests.toLocaleString(model.lang.value)}{!isThreadScope ? <> · <a class="nav-link" href={formatRoute({ view: "conversation", threadId: group.key })}>{t("analytics.bucketOpen")}</a></> : null}</>,
  ] }));
  return <Section title={title} sub={`${localLabel(bucket.since, true)} – ${localLabel(bucket.until, true)} (UTC${bucket.zone})${threadLabel ? ` · ${t("analytics.scopeThread", { thread: threadLabel })}` : ""}`} source={<code>usage.get group_by={isThreadScope ? "model" : "thread"}</code>}>
    {state.status === "loading" ? <Notice tone="wait">{t("analytics.bucketLoading")}</Notice> : null}
    {state.status === "stopped" ? <Notice tone="wait" actions={state.canContinue ? <Button variant="ghost" onClick={() => void bucket.walk.continue()}>{t("analytics.continue")}</Button> : undefined}>{t("analytics.stopped", { n: state.coverage.windows })}</Notice> : null}
    {state.status === "failed" ? <Notice tone="bad" actions={state.canContinue ? <Button variant="ghost" onClick={() => void bucket.walk.continue()}>{t("analytics.continue")}</Button> : <Button variant="ghost" onClick={() => void bucket.walk.start()}>{t("analytics.retry")}</Button>}>{t("analytics.failed", { message: state.error?.message ?? "" })}</Notice> : null}
    <Field as="select" label={t("analytics.bucketScope")} value={bucket.threadId ?? ""} options={options} onSelectChange={threadId => {
      model.insights.selectBucketThreads(bucket.key, threadId || undefined);
    }} />
    {partial ? <Notice tone="wait">{t("usage.unfinished")} · {t("analytics.bucketPartial")}</Notice> : null}
    {rows.length ? <DataTable caption={title} columns={[{ label: isThreadScope ? t("usage.model") : t("analytics.bucketThreads") }, { label: t("analytics.bucketRequests"), numeric: true }]} rows={rows} /> : null}
    {groups.length > rankLimit ? <Button variant="ghost" onClick={() => setRankLimit(rankLimit + 25)}>{t("usage.moreRows")}</Button> : null}
    {state.status === "done" && !groups.length ? <Notice>{t("analytics.bucketEmpty")}</Notice> : null}
  </Section>;
}
