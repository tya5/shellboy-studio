import { useState } from "preact/hooks";
import { formatAge, formatRoute, plainExcerpt, statusLabel, STATUS_KEYS, type AppModel, type ThreadRow } from "../../../ui-core/src";
import { Button, Chip, EmptyState, Icon, StatusMark, ThreadCard } from "../system/components";

function Archive({ model, id }: { model: AppModel; id: string }) {
  const t = model.t.value;
  const [armed, setArmed] = useState(false);
  return (
    <Button variant={armed ? "warn" : "plain"} onBlur={() => setArmed(false)} onClick={() => (armed ? void model.archive(id) : setArmed(true))}>
      {t(armed ? "action.archiveConfirm" : "action.archive")}
    </Button>
  );
}

function Card({ model, row }: { model: AppModel; row: ThreadRow }) {
  const t = model.t.value;
  const s = row.summary;
  const tone = row.status === "awaiting" ? "need" : row.status === "recovery" ? "err" : row.childCount > 0 ? "lead" : undefined;
  const age = formatAge(s.updated_at, model.coarseNow.value);
  return (
    <ThreadCard
      tone={tone}
      status={row.status ? <StatusMark status={row.status} label={statusLabel(t, row.status)} /> : null}
      age={age}
      title={s.title}
      excerpt={plainExcerpt(s.excerpt)}
      foot={
        <>
          {row.childCount > 0 ? (
            <span class="rel">
              <Icon name="tree" small />
              <span>{row.childCount === 1 ? t("monitor.child") : t("monitor.children", { n: row.childCount })}</span>
            </span>
          ) : row.parentTitle ? (
            <span class="rel">
              <Icon name="tree" small />
              <span>{t("monitor.parent", { title: row.parentTitle })}</span>
            </span>
          ) : null}
          {row.status === "recovery" ? (
            <Button variant="warn" onClick={() => void model.retry(s.thread_id)}>
              <Icon name="retry" small />
              {t("action.retry")}
            </Button>
          ) : null}
          {row.status === "completed" || row.status === "stopped" || row.status === "failed" ? <Archive model={model} id={s.thread_id} /> : null}
          <a class="btn link go" href={formatRoute({ view: "conversation", threadId: s.thread_id })}>
            {t("monitor.open")}
            <Icon name="arrow" small />
          </a>
        </>
      }
    />
  );
}

export function Monitor({ model }: { model: AppModel }) {
  const t = model.t.value;
  const counts = model.counts.value;
  const filter = model.monitorFilter.value;
  const rows = model.monitorRows.value;
  const list = model.data.threadList.value;
  return (
    <div class="mon">
      <div class="head">
        <div>
          <h1>{t("view.monitor")}</h1>
          <div class="muted">{t("monitor.subtitle")}</div>
        </div>
        <div class="chips" role="group" aria-label={t("monitor.filter")}>
          {STATUS_KEYS.filter((k) => (counts[k] ?? 0) > 0).map((k) => (
            <Chip key={k} status={k} label={statusLabel(t, k)} count={counts[k] ?? 0} pressed={filter === k} onClick={() => (model.monitorFilter.value = filter === k ? undefined : k)} />
          ))}
        </div>
      </div>
      {rows.length > 0 ? (
        <div class="grid">
          {rows.map((r) => (
            <Card key={r.summary.thread_id} model={model} row={r} />
          ))}
        </div>
      ) : filter ? (
        <EmptyState icon="monitor" title={t("monitor.noMatch")}>
          <Button onClick={() => (model.monitorFilter.value = undefined)}>{t("monitor.showAll")}</Button>
        </EmptyState>
      ) : list.loaded ? (
        <EmptyState icon="monitor" title={t("monitor.empty")} body={t("monitor.emptyBody")} />
      ) : null}
      {model.data.canLoadMoreThreads() ? <span class="more"><Button disabled={list.loadingMore} onClick={() => void model.data.loadMoreThreads()}>{t("threads.more")}</Button></span> : list.nextCursor ? <div class="muted caption">{t("threads.capped")}</div> : null}
    </div>
  );
}
