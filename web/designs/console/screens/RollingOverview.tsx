import { hourlyTotals, type AppModel } from "../../../ui-core/src";
import { Button, IconButton } from "../system/components/Button";
import { Chart } from "../system/components/Chart";
import { Notice } from "../system/components/Notice";
import { Stat } from "../system/components/Stat";

const localLabel = (time: string, exact = false) => time.slice(exact ? 0 : 5, exact ? -6 : 16).replace("T", " ");

export function RollingOverview({ model }: { model: AppModel }) {
  const t = model.t.value;
  const rolling = model.insights.rolling;
  const active = rolling.walk.state.value;
  const cut = rolling.displayed.value;
  if (!cut) return <Notice>{t("analytics.notRead")}</Notice>;
  const { interval, walk, stale, selection, partial: cutIncomplete } = cut;
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
  const bucket = facts.find(h => h.key === selection?.key);
  const count = (n: number | undefined) => cutIncomplete && n !== undefined ? t("usage.minimum", { value: display(n) }) : display(n);
  const intervalLabel = `${localLabel(hours[0]!.since)} – ${localLabel(hours[hours.length - 1]!.until)} (UTC${interval.zone})`;
  return <div class="rolling-overview">
    <div class="muted caption">{t("analytics.ownerWide")} · {intervalLabel}</div>
    {stale ? <Notice tone="wait">{t("analytics.asOf")}</Notice> : null}
    {active.status === "loading" ? <Notice actions={<Button onClick={() => rolling.stop()}>{t("analytics.stop")}</Button>}>{t("analytics.walking", { n: active.coverage.windows + 1 })}</Notice> : null}
    {active.status === "stopped" || active.status === "failed" ? <Notice tone={active.status === "failed" ? "bad" : "wait"}
      actions={active.status === "failed" && !active.canContinue ? <Button onClick={() => rolling.retry()}>{t("analytics.retry")}</Button>
        : active.canContinue ? <Button onClick={() => rolling.continue()}>{t("analytics.continue")}</Button> : undefined}>
      {active.status === "failed" ? t("analytics.failed", { message: active.error?.message ?? "" }) : t("analytics.stopped", { n: active.coverage.windows })}
    </Notice> : null}
    {walk.status === "done" && cutIncomplete ? <Notice tone="wait">{t("usage.unfinished")}</Notice> : null}
    <div class="stats">
      <Stat label={t("analytics.requests")} value={count(totals.requests)} />
      <Stat label={t("analytics.uncachedInput")} value={display(cutIncomplete ? undefined : totals.uncached)} />
      <Stat label={t("analytics.pairedCache")} value={cutIncomplete || totals.share === undefined ? t("analytics.noValue") : totals.share.toLocaleString(model.lang.value, { style: "percent", maximumFractionDigits: 1 })} note={t("analytics.reportedPairs")} />
    </div>
    <Chart kind="columns" whole title={t("analytics.hourlyRequests")} ariaSummary={t("analytics.hourlyRequests")}
      series={[{ id: "requests", label: t("analytics.requests"), tone: "neutral" }]} format={n => display(n)}
      points={facts.map(h => ({ key: h.key, label: h.label, detail: `${localLabel(h.since, true)} – ${localLabel(h.until, true)} (UTC${interval.zone})`, values: { requests: h.value }, note: [h.partial && t("analytics.partialHour"), cutIncomplete && h.value !== undefined && t("usage.unfinished")].filter(Boolean).join(" · ") }))}
      selection={{ key: selection?.key, select: key => rolling.select(key) }}
      tableLabel={t("analytics.table")} categoryLabel={t("analytics.period")} noData={t("analytics.noValue")}
      source={walk.status === "done" && !walk.groups.size && !cutIncomplete ? t("analytics.empty") : "Core · usage.get"}
      extra={<div class="rolling-stepper">
        <IconButton glyph="analytics.previousBucket" label={t("analytics.previousBucket")} onClick={() => rolling.step(-1)} />
        <div aria-live="polite">{bucket ? <>
          <strong>{localLabel(bucket.since)} – {localLabel(bucket.until)}</strong>
          <div class="muted caption">{t("analytics.requests")}: {count(bucket.value)}{bucket.partial ? ` · ${t("analytics.partialHour")}` : ""}</div>
        </> : <span class="muted caption">{t("analytics.noBucket")}</span>}</div>
        <IconButton glyph="analytics.nextBucket" label={t("analytics.nextBucket")} onClick={() => rolling.step(1)} />
      </div>}
    />
  </div>;
}
