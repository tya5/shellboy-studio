import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatAge, formatRoute, plainExcerpt, TILE_LIMIT, TilePreviews, statusLabel, STATUS_KEYS, type AppModel, type DesignContext, type ThreadRow } from "../../../ui-core/src";
import { Button, ButtonGroup, Chip, EmptyState, Icon, StatusMark, ThreadCard, MonitorTile } from "../system/components";

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
      excerpt={plainExcerpt(s.excerpt)}
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
  const messages = preview?.rows.filter((r) => r.type === "message").slice(-3) ?? [];
  const steps = preview?.rows.flatMap((r) => r.type === "steps" ? r.steps : []) ?? [];
  const failed = steps.filter((s) => s.exitCode != null && s.exitCode !== 0).length;
  const unknown = steps.some((s) => s.exitCode == null && s.state === "exited");
  const running = steps.find((s) => s.state === "running" || s.state === "starting" || s.state === "stopping");
  return <div ref={ref}>
    <MonitorTile href={formatRoute({ view: "conversation", threadId: id })} title={row.summary.title} status={row.status ? <StatusMark status={row.status} label={statusLabel(t, row.status)} /> : null}>
      {!supported ? <p>{t("monitor.newer")}</p> : <>
        {messages.map((m) => m.type === "message" ? <p key={m.id}><strong>{m.speaker.kind === "other" ? m.speaker.label : t(m.speaker.kind === "you" ? "convo.you" : m.speaker.kind === "cli" ? "convo.cli" : "convo.shellboy")}: </strong>{m.text.split(/\r?\n/, 1)[0]}</p> : null)}
        {steps.length ? <p>{t("monitor.tools", { n: steps.length, failed })}</p> : null}
        {running ? <p>{t("monitor.running", { description: running.description ?? running.command })}</p> : null}
        {preview?.incomplete || unknown ? <p>{t("monitor.toolsPartial")}</p> : null}
      </>}
    </MonitorTile>
    <Button aria-pressed={pinned} onClick={togglePin}>{t(pinned ? "monitor.unpin" : "monitor.pin")}</Button>
  </div>;
}

export function Monitor({ context }: { context: DesignContext }) {
  const { model, prefs, setPrefs } = context;
  const t = model.t.value;
  const counts = model.counts.value;
  const filter = model.monitorFilter.value;
  const tiles = prefs.value.monitorView === "tiles";
  const pins = prefs.value.monitorPins ?? [];
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const reader = useMemo(() => new TilePreviews(model.data), [model]);
  useEffect(() => () => reader.close(), [reader]);
  const supported = model.data.capabilities.value.includes("history.window");
  const allRows = tiles ? model.monitorStableRows.value : model.monitorRows.value;
  const selectedRows = pinnedOnly ? allRows.filter((r) => pins.includes(r.summary.thread_id)) : allRows;
  const rows = tiles ? selectedRows.slice(0, TILE_LIMIT) : selectedRows;
  const togglePin = (id: string) => setPrefs({ monitorPins: pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id].slice(0, 100) });
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
      <ButtonGroup label={t("monitor.view")}>
        {(["cards", "tiles"] as const).map((view) => <Button key={view} aria-pressed={(tiles ? "tiles" : "cards") === view} onClick={() => setPrefs({ monitorView: view })}>{t(view === "tiles" ? "monitor.tiles" : "monitor.cards")}</Button>)}
        <Button aria-pressed={pinnedOnly} onClick={() => setPinnedOnly(!pinnedOnly)}>{t("monitor.pinnedOnly")}</Button>
      </ButtonGroup>
      {!tiles ? <ButtonGroup label={t("monitor.sort")}>
        {(["stable", "recent"] as const).map((sort) => <Button key={sort} aria-pressed={(prefs.value.monitorSort ?? "stable") === sort} onClick={() => { model.monitorSort.value = sort; setPrefs({ monitorSort: sort }); }}>{t(sort === "stable" ? "monitor.sortStable" : "monitor.sortRecent")}</Button>)}
      </ButtonGroup> : null}
      {tiles && selectedRows.length > TILE_LIMIT ? <div class="muted caption">{t("monitor.tileLimit")}</div> : null}
      {rows.length > 0 ? (
        <div class="grid">
          {rows.map((r) => (
            tiles ? <Tile key={r.summary.thread_id} model={model} row={r} reader={reader} supported={supported} pinned={pins.includes(r.summary.thread_id)} togglePin={() => togglePin(r.summary.thread_id)} /> : <Card key={r.summary.thread_id} model={model} row={r} pinned={pins.includes(r.summary.thread_id)} togglePin={() => togglePin(r.summary.thread_id)} />
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
