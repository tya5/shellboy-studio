import { useEffect, useState } from "preact/hooks";
import { formatRoute, statusLabel, viewShortcut, navShortcut, type DesignContext, type ViewName } from "../../../ui-core/src";
import { Button, ContextBar, Field, Icon, MoreMenu, NavItem, Notice, StatusMark, ThreadItem, type IconName } from "../system/components";
import { formatTokens, folderName } from "../../../ui-core/src";
import { Conversation } from "./Conversation";
import { Inbox } from "./Inbox";
import { Monitor } from "./Monitor";
import { Analytics } from "./Analytics";
import { AppsHost } from "./Apps";
import { Branches } from "./Branches";
import { Threads } from "./Threads";
import { Settings } from "./Settings";
import { Setup } from "./Setup";
import { SettingsView } from "./SettingsView";
import { AuthPrompt } from "./AuthPrompt";

const SEARCH_DEBOUNCE_MS = 200;

export function App({ context }: { context: DesignContext }) {
  const model = context.model;
  const t = model.t.value;
  const route = model.route.value;
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => { model.monitorSort.value = context.prefs.value.monitorSort ?? "stable"; }, [model, context.prefs.value.monitorSort]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (navShortcut(e) && (document.querySelector(".app")?.clientWidth ?? 0) >= 900) {
        e.preventDefault();
        context.setPrefs({ navCollapsed: !context.prefs.value.navCollapsed });
        return;
      }
      const view = viewShortcut(e);
      if (view) {
        e.preventDefault();
        model.showView(view);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [model, context]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if ((model.data.listFilter.peek().query ?? "") !== query) model.data.setListFilter(query ? { query } : {});
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [model, query]);

  const nav = (view: ViewName, icon: IconName, label: string, count?: number) => <NavItem key={view} href={formatRoute({ view })} icon={icon} label={label} current={route.view === view} {...(count !== undefined ? { count } : {})} />;
  const conversationNav = nav("conversation", "chat", t("view.conversation"));
  const monitorNav = nav("monitor", "monitor", t("view.monitor"));
  const inboxNav = nav("inbox", "inbox", t("view.inbox"), model.pendingCount.value);
  const moreItems = ([["apps", "apps"], ["branches", "branch"], ["threads", "tree"], ["analytics", "chart"], ["settings", "gear"]] as const).map(([view, icon]) => ({ key: view, href: formatRoute({ view }), icon, label: t(`view.${view}`), current: route.view === view }));

  const list = model.data.threadList.value;
  const selected = model.selectedId.value;
  const row = model.selectedRow.value;
  const details = model.details.value;
  const ctx = route.view === "conversation" ? model.context.value : undefined;
  const conn = model.connection.value;
  const title = route.view === "conversation" ? (details?.title ?? row?.summary.title) : t(`view.${route.view}`);
  const folder = route.view === "conversation" ? folderName(details?.cwd ?? row?.summary.cwd) : undefined;

  return (
    <div class="app">
      <div class={context.prefs.value.navCollapsed ? "shell nav-collapsed" : "shell"}>
        <button type="button" class={drawer ? "scrim open" : "scrim"} aria-label={t("threads.close")} tabIndex={drawer ? 0 : -1} onClick={() => setDrawer(false)} />
        <aside class={drawer ? "side open" : "side"} aria-label={t("threads.title")}>
          <div class="brand">
            <Icon name="bot" />
            <span class="brand-label">{t("brand")}</span>
          </div>
          <div class="nav-toggle"><Button icon label={context.prefs.value.navCollapsed ? t("nav.expand") : t("nav.collapse")} title={context.prefs.value.navCollapsed ? t("nav.expand") : t("nav.collapse")} aria-expanded={!context.prefs.value.navCollapsed} onClick={() => context.setPrefs({ navCollapsed: !context.prefs.value.navCollapsed })}><Icon name="menu" /></Button></div>
          <nav class="nav" aria-label={t("nav.views")}>
            {conversationNav}
            {monitorNav}
            {inboxNav}
            {moreItems.map((i) => <NavItem key={i.key} href={i.href} icon={i.icon} label={i.label} current={i.current} />)}
          </nav>
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
            {model.data.canLoadMoreThreads() ? <Button disabled={list.loadingMore} onClick={() => void model.data.loadMoreThreads()}>{t("threads.more")}</Button> : list.nextCursor ? <div class="side-note">{t("threads.capped")}</div> : null}
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
              <Button icon label={settings ? t("settings.close") : t("settings.open")} aria-expanded={settings} data-settings-toggle onClick={() => setSettings(!settings)}>
                <Icon name="gear" />
              </Button>
            </div>
          </header>
          {settings ? <Settings context={context} onClose={() => setSettings(false)} /> : null}
          <div class="alerts">
            {conn === "authNeeded" ? <AuthPrompt context={context} /> : null}
            {conn === "ownerDown" ? <Notice tone="wait">{t("banner.ownerDown")}</Notice> : null}
            {model.actionError.value ? <Notice tone="bad">{model.actionError.value}</Notice> : null}
          </div>
          <section class="view" aria-label={title}>
            <AppsHost context={context} />
            {route.view === "apps" ? null : route.view === "conversation" ? <Conversation model={model} /> : route.view === "monitor" ? <Monitor context={context} /> : route.view === "inbox" ? <Inbox model={model} /> : route.view === "analytics" ? <Analytics context={context} /> : route.view === "branches" ? <Branches model={model} /> : route.view === "threads" ? <Threads model={model} /> : route.view === "setup" ? <Setup context={context} /> : <SettingsView context={context} />}
          </section>
          <footer class="status">
            <StatusMark
              status={conn === "connected" ? "completed" : conn === "ownerDown" ? "recovery" : "waiting"}
              label={t(conn === "connected" ? "conn.connected" : conn === "ownerDown" ? "conn.ownerDown" : "conn.connecting")}
            />
            {model.data.dataDir.value ? (
              <span class="owner-dir">
                {t("conn.ownerDir")} <span class="mono" title={model.data.dataDir.value}><bdi>{model.data.dataDir.value}</bdi></span>
              </span>
            ) : null}
            {details?.cwd ? <span class="mono cwd">{details.cwd}</span> : null}
            <div class="right">
              {conn === "connected" ? <span>{t("conn.live")}</span> : null}
            </div>
          </footer>
          <nav class="tabbar" aria-label={t("nav.views")}>
            {inboxNav}
            {conversationNav}
            {monitorNav}
            <MoreMenu label={t("nav.more")} items={moreItems} />
          </nav>
        </div>
      </div>
    </div>
  );
}
