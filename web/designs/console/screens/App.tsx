import { useEffect, useState } from "preact/hooks";
import { formatRoute, statusLabel, viewShortcut, type DesignContext } from "../../../ui-core/src";
import { Button, ContextBar, Field, Icon, NavItem, Notice, StatusMark, ThreadItem } from "../system/components";
import { formatTokens, folderName } from "../../../ui-core/src";
import { Conversation } from "./Conversation";
import { Inbox } from "./Inbox";
import { Monitor } from "./Monitor";
import { Settings } from "./Settings";
import { AuthPrompt } from "./AuthPrompt";

const SEARCH_DEBOUNCE_MS = 200;

export function App({ context }: { context: DesignContext }) {
  const model = context.model;
  const t = model.t.value;
  const route = model.route.value;
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const view = viewShortcut(e);
      if (view) {
        e.preventDefault();
        model.showView(view);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [model]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if ((model.data.listFilter.peek().query ?? "") !== query) model.data.setListFilter(query ? { query } : {});
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [model, query]);

  const views = (
    <>
      <NavItem href={formatRoute({ view: "conversation" })} icon="chat" label={t("view.conversation")} current={route.view === "conversation"} />
      <NavItem href={formatRoute({ view: "monitor" })} icon="monitor" label={t("view.monitor")} current={route.view === "monitor"} />
      <NavItem href={formatRoute({ view: "inbox" })} icon="inbox" label={t("view.inbox")} current={route.view === "inbox"} count={model.pendingCount.value} />
    </>
  );

  const list = model.data.threadList.value;
  const selected = model.selectedId.value;
  const row = model.selectedRow.value;
  const details = model.details.value;
  const ctx = route.view === "conversation" ? model.context.value : undefined;
  const conn = model.connection.value;
  const title = route.view === "conversation" ? (details?.title ?? row?.summary.title) : t(route.view === "monitor" ? "view.monitor" : "view.inbox");
  const folder = route.view === "conversation" ? folderName(details?.cwd ?? row?.summary.cwd) : undefined;

  return (
    <div class="app">
      <div class="shell">
        <button type="button" class={drawer ? "scrim open" : "scrim"} aria-label={t("threads.close")} tabIndex={drawer ? 0 : -1} onClick={() => setDrawer(false)} />
        <aside class={drawer ? "side open" : "side"} aria-label={t("threads.title")}>
          <div class="brand">
            <Icon name="bot" />
            {t("brand")}
          </div>
          <nav class="nav" aria-label={t("nav.views")}>{views}</nav>
          <div class="sidehead">
            <h2>{t("threads.title")}</h2>
            <Button onClick={() => { setDrawer(false); void model.createThread(); }}>
              <Icon name="plus" small />
              {t("threads.new")}
            </Button>
          </div>
          <div class="side-search">
            <Field ariaLabel={t("threads.search")} placeholder={t("threads.search")} leading={<Icon name="search" small />} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          </div>
          <div class="side-list">
            <div class="tree">
              {model.rows.value.map((r) => (
                <ThreadItem
                  key={r.summary.thread_id}
                  href={formatRoute({ view: "conversation", threadId: r.summary.thread_id })}
                  title={r.summary.title}
                  status={r.status}
                  statusLabel={r.status ? statusLabel(t, r.status) : ""}
                  depth={r.depth}
                  current={route.view === "conversation" && r.summary.thread_id === selected}
                  pending={r.pending}
                  onSelect={() => setDrawer(false)}
                />
              ))}
            </div>
            {list.loaded && list.items.length === 0 ? <div class="side-note">{query ? t("threads.noMatch") : t("threads.empty")}</div> : null}
            {list.nextCursor ? <Button disabled={list.loadingMore} onClick={() => void model.data.loadMoreThreads()}>{t("threads.more")}</Button> : null}
          </div>
        </aside>
        <div class="main">
          <header class="top">
            <span class="menu"><Button icon label={t("threads.open")} onClick={() => setDrawer(true)}><Icon name="menu" /></Button></span>
            <div class="crumb">
              {folder ? <>{folder}<span>/</span></> : null}
              <b>{title ?? ""}</b>
            </div>
            <div class="right">
              {ctx ? (
                <ContextBar
                  value={ctx.inputTokens}
                  limit={ctx.autoSummaryAt}
                  text={ctx.autoSummaryAt !== undefined ? t("context.summary", { input: formatTokens(ctx.inputTokens), limit: formatTokens(ctx.autoSummaryAt) }) : formatTokens(ctx.inputTokens)}
                  aria={t("context.aria", { input: ctx.inputTokens, limit: ctx.autoSummaryAt ?? "" })}
                />
              ) : null}
              {route.view === "conversation" && row?.status ? <span class="hide-n"><StatusMark status={row.status} label={statusLabel(t, row.status)} /></span> : null}
              {route.view === "conversation" && details ? <span class="hide-n mono muted">{details.model}</span> : null}
              <Button icon label={settings ? t("settings.close") : t("settings.open")} aria-expanded={settings} onClick={() => setSettings(!settings)}>
                <Icon name="gear" />
              </Button>
            </div>
          </header>
          {settings ? <Settings context={context} /> : null}
          <div class="alerts">
            {conn === "authNeeded" ? <AuthPrompt context={context} /> : null}
            {conn === "ownerDown" ? <Notice tone="wait">{t("banner.ownerDown")}</Notice> : null}
            {model.actionError.value ? <Notice tone="bad">{model.actionError.value}</Notice> : null}
          </div>
          <section class="view" aria-label={title}>
            {route.view === "conversation" ? <Conversation model={model} /> : route.view === "monitor" ? <Monitor model={model} /> : <Inbox model={model} />}
          </section>
          <footer class="status">
            <StatusMark
              status={conn === "connected" ? "completed" : conn === "ownerDown" ? "recovery" : "waiting"}
              label={t(conn === "connected" ? "conn.connected" : conn === "ownerDown" ? "conn.ownerDown" : "conn.connecting")}
            />
            {details?.cwd ? <span class="mono">{details.cwd}</span> : null}
            <div class="right">
              {conn === "connected" ? <span>{t("conn.live")}</span> : null}
            </div>
          </footer>
          <nav class="tabbar" aria-label={t("nav.views")}>{views}</nav>
        </div>
      </div>
    </div>
  );
}
