import { BrandLogo } from "../system/components/BrandLogo";
import { threadMenuEntries } from "../system/components/thread-menu";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatRoute, readSidebarWidth, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, statusLabel, viewShortcut, navShortcut, type DesignContext, type ViewName } from "../../../ui-core/src";
import { Button, ContextBar, Field, Icon, MoreMenu, NavItem, Notice, StatusMark, ThreadDeleteDialog, ThreadItem, type IconRole, type ThreadDeleteTarget } from "../system/components";
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
import { LayoutSeparator } from "../system/components";
import { sidebarWidthStyle } from "../system/layout";

const SEARCH_DEBOUNCE_MS = 200;

export function App({ context }: { context: DesignContext }) {
  const model = context.model;
  const [deleteThread, setDeleteThread] = useState<ThreadDeleteTarget>();
  const sidebarListRef = useRef<HTMLDivElement>(null);
  const lastSidebarFocus = useRef<string>();
  const sidebarPositions = useRef(new Map<string, number>());
  const sidebarRows = model.rows.value;
  const sidebarLinks = () => [...(sidebarListRef.current?.querySelectorAll<HTMLAnchorElement>('a[id^="thread-link-sidebar-"]') ?? [])];
  const rememberSidebarPositions = (links: HTMLAnchorElement[]) => {
    links.forEach((link, index) => sidebarPositions.current.set(link.id.replace("thread-link-sidebar-", ""), index));
  };
  const resolveSidebarLink = (threadId: string) => {
    const links = sidebarLinks();
    rememberSidebarPositions(links);
    const direct = links.find((link) => link.id === `thread-link-sidebar-${threadId}`);
    if (direct) return direct;
    const position = sidebarPositions.current.get(threadId);
    return (position !== undefined ? links[position] ?? links[Math.min(position - 1, links.length - 1)] : undefined)
      ?? document.getElementById("sidebar-thread-list-heading");
  };
  useLayoutEffect(() => {
    const links = sidebarLinks();
    rememberSidebarPositions(links);
    const claimed = lastSidebarFocus.current;
    if (!claimed || links.some((link) => link.id === `thread-link-sidebar-${claimed}`)) return;
    lastSidebarFocus.current = undefined;
    resolveSidebarLink(claimed)?.focus();
  });
  const t = model.t.value;
  const route = model.route.value;
  useEffect(() => { model.actionError.value = undefined; }, [model, route]);
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState("");
  const drag = useRef<{ pointerId: number; element: HTMLElement; originX: number; startWidth: number }>();
  const sidebarWidth = readSidebarWidth(context.prefs.value.sidebarWidth);
  const savedSidebarWidth = context.prefs.value.sidebarWidth;
  const finishResize = (pointerId?: number) => {
    const current = drag.current;
    if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) return;
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
    drag.current = undefined;
  };
  const picker = model.modelPicker.value;
  useEffect(() => { if (picker.open && picker.thread !== model.selectedId.value) model.closeModelPicker(); }, [picker.open, picker.thread, model.selectedId.value]);

  useEffect(() => { model.monitorSort.value = context.prefs.value.monitorSort ?? "stable"; }, [model, context.prefs.value.monitorSort]);


  useEffect(() => {
    const cancel = () => finishResize();
    addEventListener("resize", cancel);
    return () => { removeEventListener("resize", cancel); cancel(); };
  }, []);
  useEffect(() => { if (context.prefs.value.navCollapsed) finishResize(); }, [context.prefs.value.navCollapsed]);

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
      const next = route.view === "monitor" ? { archived: "include" as const } : query ? { query } : {};
      const current = model.data.listFilter.peek();
      if (current.query !== ("query" in next ? next.query : undefined) || current.archived !== ("archived" in next ? next.archived : undefined)) model.data.setListFilter(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [model, query, route.view]);

  const nav = (view: ViewName, role: IconRole, label: string, count?: number) => <NavItem key={view} href={formatRoute({ view })} role={role} label={label} current={route.view === view} {...(count !== undefined ? { count } : {})} />;
  const conversationNav = nav("conversation", "nav.conversation", t("view.conversation"));
  const monitorNav = nav("monitor", "nav.monitor", t("view.monitor"));
  const inboxNav = nav("inbox", "nav.inbox", t("view.inbox"), model.pendingCount.value);
  const moreItems = ([["apps", "nav.apps"], ["branches", "nav.branches"], ["threads", "nav.threads"], ["analytics", "nav.analytics"], ["settings", "nav.settings"]] as const).map(([view, role]) => ({ key: view, href: formatRoute({ view }), role, label: t(`view.${view}`), current: route.view === view }));

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
      <div class={context.prefs.value.navCollapsed ? "shell nav-collapsed" : "shell"} style={sidebarWidthStyle(savedSidebarWidth)}>
        <LayoutSeparator aria-label={t("threads.resizeSidebar")} role="separator" aria-orientation="vertical" aria-valuemin={SIDEBAR_WIDTH_MIN} aria-valuemax={SIDEBAR_WIDTH_MAX} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={(event) => { if (context.prefs.value.navCollapsed || drag.current || !event.isPrimary || event.button !== 0) return; event.preventDefault(); const element = event.currentTarget; drag.current = { pointerId: event.pointerId, element, originX: event.clientX, startWidth: sidebarWidth }; element.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { const current = drag.current; if (!current || current.pointerId !== event.pointerId || !event.isPrimary) return; context.setPrefs({ sidebarWidth: readSidebarWidth(current.startWidth + event.clientX - current.originX) }); }} onPointerUp={(event) => finishResize(event.pointerId)} onPointerCancel={(event) => finishResize(event.pointerId)} onLostPointerCapture={(event) => finishResize(event.pointerId)} onKeyDown={(event) => { if (context.prefs.value.navCollapsed) return; const step = event.shiftKey ? 32 : 16; if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") { event.preventDefault(); const next = event.key === "Home" ? SIDEBAR_WIDTH_MIN : event.key === "End" ? SIDEBAR_WIDTH_MAX : sidebarWidth + (event.key === "ArrowRight" ? step : -step); context.setPrefs({ sidebarWidth: readSidebarWidth(next) }); } }} />
        <button type="button" class={drawer ? "scrim open" : "scrim"} aria-label={t("threads.close")} tabIndex={drawer ? 0 : -1} onClick={() => setDrawer(false)} />
        <aside class={drawer ? "side open" : "side"} aria-label={t("threads.title")}>
          <div class="brand">
            <BrandLogo />
            <span class="brand-label">{t("brand")}</span>
          </div>
          <div class="nav-toggle"><Button icon label={context.prefs.value.navCollapsed ? t("nav.expand") : t("nav.collapse")} title={context.prefs.value.navCollapsed ? t("nav.expand") : t("nav.collapse")} aria-expanded={!context.prefs.value.navCollapsed} onClick={() => context.setPrefs({ navCollapsed: !context.prefs.value.navCollapsed })}><Icon role="nav.toggleSidebar" /></Button></div>
          <nav class="nav" aria-label={t("nav.views")}>
            {conversationNav}
            {monitorNav}
            {inboxNav}
            {moreItems.map((i) => <NavItem key={i.key} href={i.href} role={i.role} label={i.label} current={i.current} />)}
          </nav>
          <div class="sidehead">
            <h2 id="sidebar-thread-list-heading" tabIndex={-1}>{t("threads.title")}</h2>
            <Button onClick={() => { setDrawer(false); void model.createThread(); }}>
              <Icon role="thread.create" size="small" />
              {t("threads.new")}
            </Button>
          </div>
          <div class="side-search">
            <Field ariaLabel={t("threads.search")} placeholder={t("threads.search")} leading={<Icon role="thread.search" size="small" />} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          </div>
          <div class="side-list" ref={sidebarListRef} onFocusIn={(event) => {
            const target = event.target as HTMLElement;
            const link = target.closest<HTMLAnchorElement>('a[id^="thread-link-sidebar-"]') ?? target.closest<HTMLElement>(".tree-item")?.querySelector<HTMLAnchorElement>('a[id^="thread-link-sidebar-"]');
            if (!link) return;
            const links = sidebarLinks();
            rememberSidebarPositions(links);
            lastSidebarFocus.current = link.id.replace("thread-link-sidebar-", "");
          }} onFocusOut={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !sidebarListRef.current?.contains(next)) lastSidebarFocus.current = undefined;
          }}>
            <div class="tree">
              {sidebarRows.map((r, index, rows) => (
                <ThreadItem
                  key={r.summary.thread_id}
                  linkId={`thread-link-sidebar-${r.summary.thread_id}`}
                  href={formatRoute({ view: "conversation", threadId: r.summary.thread_id })}
                  title={r.summary.title}
                  status={r.status}
                  statusLabel={r.status ? statusLabel(t, r.status) : ""}
                  depth={r.depth}
                  current={route.view === "conversation" && r.summary.thread_id === selected}
                  pending={r.pending}
                  onSelect={() => setDrawer(false)}
                  menu={{ label: t("thread.rowMenu"), entries: threadMenuEntries(model, r.summary, r.status, (target) => setDeleteThread({ threadId: target.thread_id })) }}
                />
              ))}
            </div>
            {list.loaded && list.items.length === 0 ? <div class="side-note">{query ? t("threads.noMatch") : t("threads.empty")}</div> : null}
            {model.data.canLoadMoreThreads() ? <Button disabled={list.loadingMore} onClick={() => void model.data.loadMoreThreads()}>{t("threads.more")}</Button> : list.nextCursor ? <div class="side-note">{t("threads.capped")}</div> : null}
          </div>
        </aside>
        <div class="main">
          <header class="top">
            <span class="menu"><Button icon label={t("threads.open")} onClick={() => setDrawer(true)}><Icon role="nav.openThreadList" /></Button></span>
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
              {route.view === "conversation" && details ? <div class="model-picker-anchor"><Button aria-expanded={picker.open} aria-haspopup="dialog" onClick={() => picker.open ? model.closeModelPicker() : model.openModelPicker()}>{details.model}</Button>{picker.open ? <div class="model-picker" role="dialog" aria-label={t("model.change")} onKeyDown={(e) => { if (e.key === "Escape") model.closeModelPicker(); }}><p class="caption muted">{t("model.note")}</p><label>{t("model.connection")}<select value={picker.connection} disabled={picker.saving || !model.data.capabilities.value.includes("thread.settings")} onChange={(e) => model.chooseModelConnection(e.currentTarget.value)}>{[...new Set([picker.connection, ...Object.keys((model.config.read.value.value?.loaded.values?.connections as Record<string, unknown> | undefined) ?? {})])].filter(Boolean).map(c => <option value={c}>{c}</option>)}</select></label><Field ariaLabel={t("model.search")} value={picker.model} disabled={picker.saving || !model.data.capabilities.value.includes("thread.settings")} onInput={(e) => { model.modelPicker.value = { ...model.modelPicker.peek(), model: e.currentTarget.value }; }} /><div class="model-picker-list">{picker.loading ? <span>{t("common.loading")}</span> : picker.models.filter(m => (picker.model === details.model || m.toLowerCase().includes(picker.model.toLowerCase()))).length ? picker.models.filter(m => (picker.model === details.model || m.toLowerCase().includes(picker.model.toLowerCase()))).map(m => <Button variant="link" disabled={!model.data.capabilities.value.includes("thread.settings")} onClick={() => { model.modelPicker.value = { ...model.modelPicker.peek(), model: m }; }}>{m}</Button>) : <span>{t("model.empty")}</span>}</div><Field ariaLabel={t("model.effort")} placeholder={t("model.effort")} value={picker.effort} disabled={picker.saving || !model.data.capabilities.value.includes("thread.settings")} onInput={(e) => { model.modelPicker.value = { ...model.modelPicker.peek(), effort: e.currentTarget.value }; }} />{!model.data.capabilities.value.includes("thread.settings") ? <Notice tone="wait">{t("thread.readOnly")}</Notice> : null}<p class="caption muted">{t("thread.inherited")}</p>{([ ["autoCompactAt", "thread.auto"], ["maxTokens", "thread.maxTokens"], ["agents", "thread.agents"] ] as const).map(([key, label]) => <label>{t(label)}<Field ariaLabel={t(label)} value={picker[key]} placeholder={key !== "agents" && model.effectiveThreadSettings.value[key] !== undefined ? t("thread.effective", { value: model.effectiveThreadSettings.value[key]! }) : undefined} disabled={picker.saving || !model.data.capabilities.value.includes("thread.settings")} onInput={(e) => { if (key === "maxTokens") model.editThreadOutputLimit(e.currentTarget.value); else model.modelPicker.value = { ...model.modelPicker.peek(), [key]: e.currentTarget.value }; }} /></label>)}{picker.maxTokensState.kind === "unknown" && !picker.clearMaxTokens ? <><p class="caption muted">{t("thread.outputLimitUnknown")}</p><Button disabled={picker.saving || !model.data.capabilities.value.includes("thread.settings")} onClick={() => model.clearThreadOutputLimit()}>{t("thread.clearOutputLimit")}</Button></> : <p class="caption muted">{t("thread.outputLimitNote")}</p>}<p class="caption muted">{t("thread.agentsTiming")}</p>{picker.error ? <Notice tone="bad">{picker.error}</Notice> : null}<div class="row"><Button disabled={picker.saving} onClick={() => model.closeModelPicker()}>{t("model.close")}</Button><Button variant="primary" disabled={!model.data.capabilities.value.includes("thread.settings") || picker.saving || !picker.model.trim()} onClick={() => void model.saveThreadModel()}>{t("model.save")}</Button></div></div> : null}</div> : null}
              <Button icon label={settings ? t("settings.close") : t("settings.open")} aria-expanded={settings} data-settings-toggle onClick={() => setSettings(!settings)}>
                <Icon role="settings.applicationPanel" />
              </Button>
            </div>
          </header>
          {settings ? <Settings context={context} onClose={() => setSettings(false)} /> : null}
          <div class="alerts">
            {conn === "authNeeded" ? <AuthPrompt context={context} /> : null}
            {conn === "ownerDown" ? <Notice tone="wait">{t("banner.ownerDown")}</Notice> : null}
            {model.actionError.value ? <Notice tone={model.actionError.value.kind === "error" ? "bad" : undefined}>{model.actionError.value.text}</Notice> : null}
          </div>
          {deleteThread ? <ThreadDeleteDialog key={deleteThread.threadId} model={model} target={deleteThread} getReturnFocusTarget={resolveSidebarLink} onClose={() => setDeleteThread(undefined)} /> : null}
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
