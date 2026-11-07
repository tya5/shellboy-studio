import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { activityLabel, formatAge, formatDuration, formatRoute, parseTime, TilePreviews, statusLabel, STATUS_KEYS, type AppModel, type DesignContext, type ThreadRow } from "../../../ui-core/src";
import { Button, ButtonGroup, Chip, EmptyState, Field, Icon, StatusMark, ThreadCard, MonitorTile } from "../system/components";

function Archive({ model, id }: { model: AppModel; id: string }) {
  const t = model.t.value;
  const [armed, setArmed] = useState(false);
  return (
    <Button variant={armed ? "warn" : "plain"} onBlur={() => setArmed(false)} onClick={() => (armed ? void model.archive(id) : setArmed(true))}>
      {t(armed ? "action.archiveConfirm" : "action.archive")}
    </Button>
  );
}

function Card({ model, row, pinned, togglePin }: { model: AppModel; row: ThreadRow; pinned: boolean; togglePin: () => void }) {
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
      foot={
        <>
          <Button aria-pressed={pinned} onClick={togglePin}>{t(pinned ? "monitor.unpin" : "monitor.pin")}</Button>
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

function Tile({ model, row, reader, supported, pinned, togglePin }: { model: AppModel; row: ThreadRow; reader: TilePreviews; supported: boolean; pinned: boolean; togglePin: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = row.summary.thread_id;
  useEffect(() => {
    const el = ref.current;
    if (!el || !supported) return;
    if (typeof IntersectionObserver === "undefined") { reader.show(id); return () => reader.hide(id); }
    const observer = new IntersectionObserver((entries) => { for (const entry of entries) entry.isIntersecting ? reader.show(id) : reader.hide(id); });
    observer.observe(el);
    return () => { observer.disconnect(); reader.hide(id); };
  }, [id, reader, supported]);
  const t = model.t.value;
  const preview = reader.previews.value.get(id);
  const rows = preview?.rows ?? [];
  const running = rows.flatMap((r) => r.type === "steps" ? r.steps : []).find((step) => step.status === "running");
  const start = parseTime(running?.startedAt);
  const detail = running ? [running.description ?? running.command, start === undefined ? "" : formatDuration(model.now.value - start)].filter(Boolean).join(" ") : "";
  const status = <>{row.status ? <StatusMark status={row.status} label={statusLabel(t, row.status)} /> : null}<span class="tile-detail">{row.status === "awaiting" ? "" : activityLabel(model.lang.value, row.summary.activity)}{detail ? ` ${detail}` : ""}</span></>;
  return <div ref={ref}>
    <MonitorTile href={formatRoute({ view: "conversation", threadId: id })} title={row.summary.title} headingStatus={row.status ? <StatusMark status={row.status} label={statusLabel(t, row.status)} word={false} /> : null} status={status} pin={<Button aria-pressed={pinned} onClick={togglePin}>{t(pinned ? "monitor.unpin" : "monitor.pin")}</Button>}>
      {supported ? rows.map((r) => {
        if (r.type === "message") {
          const who = r.speaker.kind === "other" ? r.speaker.label : t(r.speaker.kind === "you" ? "convo.you" : r.speaker.kind === "cli" ? "convo.cli" : "convo.shellboy");
          return <p key={r.id}><strong>{who} </strong>{r.text.split(/\r?\n/, 1)[0]}</p>;
        }
        if (r.type !== "steps") return null;
        const failed = r.steps.filter((step) => step.exitCode != null && step.exitCode !== 0).length;
        const active = r.steps.find((step) => step.status === "running");
        const unknown = r.steps.some((step) => step.exitCode == null && step.state === "exited");
        return <p key={r.id}>{t("monitor.tools", { n: r.steps.length, failed })}{active ? ` ${t("monitor.running", { description: active.description ?? active.command })}` : ""}{unknown || preview?.incomplete ? ` ${t("monitor.toolsPartial")}` : ""}</p>;
      }) : null}
    </MonitorTile>
  </div>;
}

export function Monitor({ context }: { context: DesignContext }) {
  const { model, prefs, setPrefs } = context;
  const t = model.t.value;
  const counts = model.counts.value;
  const filter = model.monitorFilter.value;
  const tiles = prefs.value.monitorView === "tiles";
  const pins = prefs.value.monitorPins ?? [];
  const pinnedOnly = model.monitorPinnedOnly.value;
  useEffect(() => { model.monitorPins.value = prefs.value.monitorPins ?? []; }, [model, prefs.value.monitorPins]);
  const [page, setPage] = useState(0);
  const reader = useMemo(() => new TilePreviews(model.data), [model]);
  useEffect(() => () => reader.close(), [reader]);
  const supported = model.data.capabilities.value.includes("history.window");
  const selectedRows = model.monitorRows.value;
  const groups: ThreadRow[][] = [];
  for (let i = 0; i < selectedRows.length;) {
    const remaining = selectedRows.length - i;
    const count = remaining === 5 ? 3 : Math.min(6, remaining);
    groups.push(selectedRows.slice(i, i + count));
    i += count;
  }
  const pages = Math.max(1, groups.length);
  const currentPage = Math.min(page, pages - 1);
  const rows = tiles ? groups[currentPage] ?? [] : selectedRows;
  const togglePin = (id: string) => { const next = pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id].slice(0, 100); model.monitorPins.value = next; setPrefs({ monitorPins: next }); };
  const list = model.data.threadList.value;
  return (
    <div class={tiles ? "mon pane-monitor" : "mon"}>
      <div class={tiles ? "pane-controls" : undefined}>
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
      <ButtonGroup label={t("monitor.view")}>
        {(["cards", "tiles"] as const).map((view) => <Button key={view} aria-pressed={(tiles ? "tiles" : "cards") === view} onClick={() => setPrefs({ monitorView: view })}>{t(view === "tiles" ? "monitor.tiles" : "monitor.cards")}</Button>)}
        <Button aria-pressed={pinnedOnly} onClick={() => { model.monitorPinnedOnly.value = !pinnedOnly; setPage(0); }}>{t("monitor.pinnedOnly")}</Button>
      </ButtonGroup>
      <Field ariaLabel={t("threads.search")} placeholder={t("threads.search")} value={model.monitorQuery.value} onInput={(e) => { model.monitorQuery.value = e.currentTarget.value; setPage(0); }} />
      <ButtonGroup label={t("monitor.sort")}>
        {(["stable", "recent"] as const).map((sort) => <Button key={sort} aria-pressed={(prefs.value.monitorSort ?? "stable") === sort} onClick={() => { model.monitorSort.value = sort; setPrefs({ monitorSort: sort }); }}>{t(sort === "stable" ? "monitor.sortStable" : "monitor.sortRecent")}</Button>)}
      </ButtonGroup>
      {tiles && pages > 1 ? <ButtonGroup label={t("monitor.page", { page: currentPage + 1, pages })}>
        <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("monitor.previous")}</Button>
        <span>{t("monitor.page", { page: currentPage + 1, pages })}</span>
        <Button disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>{t("monitor.next")}</Button>
      </ButtonGroup> : null}
      </div>
      {rows.length > 0 ? (
        <div class={tiles ? "pane-grid" : "grid"} data-count={tiles ? rows.length : undefined}>
          {rows.map((r) => (
            tiles ? <Tile key={r.summary.thread_id} model={model} row={r} reader={reader} supported={supported} pinned={pins.includes(r.summary.thread_id)} togglePin={() => togglePin(r.summary.thread_id)} /> : <Card key={r.summary.thread_id} model={model} row={r} pinned={pins.includes(r.summary.thread_id)} togglePin={() => togglePin(r.summary.thread_id)} />
          ))}
        </div>
      ) : filter || pinnedOnly || model.monitorQuery.value ? (
        <EmptyState icon="monitor" title={t("monitor.noMatch")}>
          <Button onClick={() => { model.monitorFilter.value = undefined; model.monitorPinnedOnly.value = false; model.monitorQuery.value = ""; }}>{t("monitor.showAll")}</Button>
        </EmptyState>
      ) : list.loaded ? (
        <EmptyState icon="monitor" title={t("monitor.empty")} body={t("monitor.emptyBody")} />
      ) : null}
      {model.data.canLoadMoreThreads() ? <span class="more"><Button disabled={list.loadingMore} onClick={() => void model.data.loadMoreThreads()}>{t("threads.more")}</Button></span> : list.nextCursor ? <div class="muted caption">{t("threads.capped")}</div> : null}
    </div>
  );
}
