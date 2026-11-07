import { useEffect, useState } from "preact/hooks";
import { formatAge, formatRoute, groupThreads, listedDescendants, statusLabel, THREAD_GROUPINGS, type AppModel, type StatusKey, type Translate } from "../../../ui-core/src";
import { Button, ButtonGroup, EmptyState, Field, Icon, Notice, SelectionBar, SelectRow, StatusMark, ThreadGroup } from "../system/components";

const SEARCH_DEBOUNCE_MS = 200;

const groupLabel = (t: Translate, by: "directory" | "state", key: string): string => (by === "directory" ? key : statusLabel(t, key as StatusKey));

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
  const groups = groupThreads(state.items, by);
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
                  age={formatAge(s.updated_at, model.now.value)}
                />
              );
            })}
          </ThreadGroup>
        );
      })}
      {state.nextCursor ? <span class="more"><Button disabled={state.loading} onClick={() => org.loadMore()}>{t("threads.more")}</Button></span> : null}
      <div class="muted caption">{t("org.seam")}</div>
      <div class="sect-source">{t("common.source", { source: "" })}<code>thread.list</code></div>
    </div>
  );
}
