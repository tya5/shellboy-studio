import type { AppModel, BranchFamily, RecordedCounter } from "../../../ui-core/src";
import { Button, KeyValue, Notice } from "../system/components";

const show = (v: RecordedCounter, unknown: string) => `${v.known ?? unknown}${v.exact ? "" : ` (${unknown}; unknown=${v.unknown ?? "?"}; overflow=${v.overflow})`}`;
export function BranchCompare({ model, family }: { model: AppModel; family: BranchFamily }) {
  const c = model.branchCompare; const s = c.state.value; const body = c.body.value; const t = model.t.value;
  const unknown = t("b3.unknown");
  return <section aria-label={t("b3.title")}>
    <h3>{t("b3.title")}</h3><p class="muted caption">{t("b3.limit")}</p>
    <Button disabled={s.selected.length !== 2 || s.sides.some(x => x.busy)} onClick={() => void c.refresh(family)}>{t("b3.refresh")}</Button>
    {s.stale ? <Notice tone="wait">{t("b3.stale")}</Notice> : null}
    {s.unavailable ? <Notice tone="wait">{t("b3.unavailable")}</Notice> : null}
    <div class="band">{s.sides.map((side, index) => <section key={side.item.threadId}>
      <h4>{side.item.title ?? side.item.threadId}</h4>
      <KeyValue rows={[{ key: t("b3.kind"), value: side.item.branchKind }, { key: t("b3.anchor"), value: `${side.anchor ?? unknown} / ${side.ordinal ?? unknown} / ${side.revision ?? unknown}` }]} />
      {side.error ? <Notice tone="wait">{t(`b3.${side.error}` as "b3.readFailed")}</Notice> : null}
      {side.pages.map((page, n) => <div key={n}>{page.map((row, j) => n > 0 && j === 0 ? null : <div key={row.node_id}><p class="caption mono">{row.selection?.ordinal} / {row.kind} / {row.node_id}</p><p>{row.excerpt || unknown}</p><Button disabled={s.stale || side.busy || !!body.node && body.node !== row.node_id} onClick={() => void c.openBody(index, row.node_id!)}>{t("b3.body")}</Button></div>)}</div>)}
      <Button disabled={s.stale || side.busy || side.next === undefined} onClick={() => void c.more(index)}>{t("b3.more")}</Button>
      <p class="muted caption">{t("b3.period")}</p><p class="mono caption">Thread {side.item.threadId}; until {s.until}</p>
      <Button disabled={s.stale || side.busy || side.usageCalls >= 4 || !!side.usage && !side.usageCursor || s.sides.some(x => !x.pages.length || !!x.error)} onClick={() => void c.usage(index)}>{t("b3.usage")} ({side.usageCalls}/4)</Button>
      {side.usage ? <div><p>{t("b3.tokens")}</p><p>{show(side.usage.input, unknown)} / {show(side.usage.cached, unknown)} / {show(side.usage.output, unknown)}</p>{side.usage.partial ? <Notice tone="wait">{t("b3.partial")}</Notice> : null}<pre>{JSON.stringify({ period: side.usage.period, summary: side.usage.summary, coverage: side.usage.coverage }, null, 2)}</pre></div> : null}
    </section>)}</div>
    {body.node ? <div><p>{t("b3.bodyLimit")}</p><pre>{body.unavailable ? unknown : body.text}</pre>{body.next ? <p>{t("b3.partial")}</p> : null}</div> : null}
  </section>;
}
