import { useEffect, useMemo, useState } from "preact/hooks";
import { CAPABILITY_REPARENT, formatAge, formatRoute, groupThreads, listedDescendants, statusLabel, THREAD_GROUPINGS, type AppModel, type StatusKey, type ThreadGrouping, type Translate } from "../../../ui-core/src";
import { Button, ButtonGroup, EmptyState, Field, Icon, Notice, Section, SelectionBar, SelectRow, StatusMark, ThreadGroup } from "../system/components";

const SEARCH_DEBOUNCE_MS = 200;

const groupLabel = (t: Translate, by: ThreadGrouping, key: string): string => (by === "state" ? statusLabel(t, key as StatusKey) : by === "tree" ? t("org.allThreads") : key);

/** Choosing a parent, then the same preview a drop leads to. The owner decides, and its refusal shows as it wrote it. */
function MovePanel({ model }: { model: AppModel }) {
  const t = model.t.value;
  const org = model.org;
  const move = org.move.value;
  const [filter, setFilter] = useState("");
  if (move.kind === "idle") return null;
  const rows = model.org.state.value.items;
  const titleOf = (id: string) => rows.find((r) => r.thread_id === id)?.title ?? id.slice(0, 8);
  const self = rows.find((r) => r.thread_id === move.threadId);
  const title = titleOf(move.threadId);
  const close = <Button variant="link" onClick={() => org.cancelMove()}>{t("common.close")}</Button>;
  if (move.kind === "picking") {
    const shown = rows.filter((r) => r.thread_id !== move.threadId && r.title.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 50);
    return (
      <Section title={t("org.moveTitle", { title })} actions={close}>
        <Field ariaLabel={t("org.moveFilter")} placeholder={t("org.moveFilter")} value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
        <div class="band">
          <Button onClick={() => org.previewMove(move.threadId, "")}>{t("org.noParent")}</Button>
          {shown.map((r) => (
            <Button key={r.thread_id} aria-pressed={self?.parent_id === r.thread_id} onClick={() => org.previewMove(move.threadId, r.thread_id)}>{r.title}</Button>
          ))}
        </div>
      </Section>
    );
  }
  const text = move.parent === "" ? t("org.previewDetach", { title }) : t("org.previewUnder", { title, parent: titleOf(move.parent) });
  if (move.kind === "moved")
    return <Notice actions={close}>{t("org.moved", { title })}{move.liveRun ? ` ${t("org.movedLive")}` : ""}</Notice>;
  return (
    <Section title={text} sub={t("org.previewNote")} actions={close}>
      {move.kind === "refused" ? <Notice tone="bad">{t("org.moveRefused", { message: move.message })}</Notice> : null}
      {move.kind !== "refused" ? (
        <div class="band">
          <Button variant="warn" disabled={move.kind === "moving"} onClick={() => void org.confirmMove()}>{t("org.confirmMove")}</Button>
        </div>
      ) : null}
    </Section>
  );
}

export function Threads({ model }: { model: AppModel }) {
  const t = model.t.value;
  const org = model.org;
  const state = org.state.value;
  const by = org.groupBy.value;
  const selected = org.selected.value;
  const action = org.action.value;
  const descendants = org.descendants.value;
  const [query, setQuery] = useState(state.query);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => org.setQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [org, query]);
  useEffect(() => setArmed(false), [selected, state.mode]);
  const groups = useMemo(() => groupThreads(state.items, by), [state.items, by]);
  const canMove = model.data.capabilities.value.includes(CAPABILITY_REPARENT);
  const [dragging, setDragging] = useState<string | undefined>(undefined);
  const [over, setOver] = useState<string | undefined>(undefined);
  const extra = descendants ? listedDescendants(state.items, selected) : 0;
  const archiving = state.mode === "exclude";
  const run = () => {
    if (archiving && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    void org.apply();
  };
  const result = action.kind === "done" ? action.result : undefined;
  return (
    <div class="org">
      <div class="head">
        <div class="pagehead">
          <h1>{t("view.threads")}</h1>
          <div class="muted">{t("org.sub")}</div>
        </div>
        <div class="toolbar">
          <ButtonGroup label={t("org.groupBy")}>
            {THREAD_GROUPINGS.map((g) => (
              <Button key={g} aria-pressed={by === g} onClick={() => (org.groupBy.value = g)}>{t(`org.by.${g}`)}</Button>
            ))}
          </ButtonGroup>
          <ButtonGroup label={t("org.show")}>
            <Button aria-pressed={state.mode === "exclude"} onClick={() => org.setMode("exclude")}>{t("org.active")}</Button>
            <Button aria-pressed={state.mode === "only"} onClick={() => org.setMode("only")}>{t("org.archived")}</Button>
          </ButtonGroup>
        </div>
      </div>
      {canMove ? <div class="muted caption">{t("org.dragHint")}</div> : <Notice>{t("org.moveUnavailable")}</Notice>}
      <MovePanel model={model} />
      {by === "tag" ? <Notice>{t("org.tagsUnavailable")}</Notice> : null}
      <Field ariaLabel={t("org.filter")} placeholder={t("org.filter")} leading={<Icon name="search" small />} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      {selected.size > 0 ? (
        <SelectionBar text={extra > 0 ? t("org.selectedWith", { n: selected.size, extra }) : t("org.selected", { n: selected.size })} option={{ label: t("org.descendants"), checked: descendants, onChange: (on) => (org.descendants.value = on) }}>
          <Button variant={armed ? "warn" : "plain"} disabled={action.kind === "running"} onClick={run}>
            {archiving ? t(armed ? "org.archiveConfirm" : "action.archive") : t("org.unarchive")}
          </Button>
          <Button variant="link" onClick={() => org.clear()}>{t("org.clear")}</Button>
        </SelectionBar>
      ) : null}
      {action.kind === "failed" ? <Notice tone="bad">{t("org.failed", { message: action.error.message })}</Notice> : null}
      {result ? (
        <Notice>
          {t(action.kind === "done" && action.verb === "archive" ? "org.archivedResult" : "org.unarchivedResult", { n: (result.archived ?? result.unarchived ?? []).length, already: (result.already ?? []).length })}
          {(result.not_found ?? []).length > 0 ? ` ${t("org.notFound", { n: (result.not_found ?? []).length })}` : ""}
        </Notice>
      ) : null}
      {state.error ? <Notice tone="bad" actions={<Button onClick={() => void org.read()}>{t("common.refresh")}</Button>}>{t("common.readError", { message: state.error.message })}</Notice> : null}
      {!state.loaded && state.loading ? <div class="muted">{t("common.loading")}</div> : null}
      {state.loaded && state.items.length === 0 ? (
        <EmptyState icon="tree" title={state.query ? t("threads.noMatch") : t(archiving ? "threads.empty" : "org.noArchived")} />
      ) : null}
      {groups.map((g) => {
        const ids = g.rows.map((r) => r.summary.thread_id);
        const chosen = ids.filter((id) => selected.has(id)).length;
        const label = groupLabel(t, by, g.key);
        return (
          <ThreadGroup key={g.key} label={label} mono={by === "directory"} count={t("org.count", { n: ids.length })} all={chosen === ids.length} some={chosen > 0} selectLabel={t("org.selectGroup", { group: label })} onSelect={(on) => org.setMany(ids, on)}>
            {g.rows.map((r) => {
              const s = r.summary;
              const notes = [r.depth === 0 && r.parentTitle ? t("monitor.parent", { title: r.parentTitle }) : "", by === "state" ? s.cwd : ""].filter(Boolean).join(", ");
              return (
                <SelectRow
                  key={s.thread_id}
                  title={s.title}
                  href={formatRoute({ view: "conversation", threadId: s.thread_id })}
                  status={r.status ? <StatusMark status={r.status} label={statusLabel(t, r.status)} word={false} /> : null}
                  depth={r.depth}
                  checked={selected.has(s.thread_id)}
                  checkLabel={t("org.selectOne", { title: s.title })}
                  onToggle={() => org.toggle(s.thread_id)}
                  note={notes || undefined}
                  age={formatAge(s.updated_at, model.coarseNow.value)}
                  action={canMove ? <button type="button" class="srow-act" onClick={() => org.pickParent(s.thread_id)}>{t("org.move")}</button> : undefined}
                  drag={
                    canMove
                      ? {
                          over: over === s.thread_id && dragging !== s.thread_id,
                          onDragStart: () => setDragging(s.thread_id),
                          onOver: (on) => setOver(on ? s.thread_id : undefined),
                          onDrop: () => {
                            if (dragging && dragging !== s.thread_id) org.previewMove(dragging, s.thread_id);
                            setDragging(undefined);
                            setOver(undefined);
                          },
                        }
                      : undefined
                  }
                />
              );
            })}
          </ThreadGroup>
        );
      })}
      {org.canLoadMore() ? <span class="more"><Button disabled={state.loading} onClick={() => org.loadMore()}>{t("threads.more")}</Button></span> : state.nextCursor ? <div class="muted caption">{t("threads.capped")}</div> : null}
      <div class="muted caption">{t("org.totals")}</div>
      <div class="sect-source">{t("common.source", { source: "" })}<code>thread.list</code></div>
    </div>
  );
}
