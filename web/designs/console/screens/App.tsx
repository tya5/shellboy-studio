import type { ListFilter } from "../../../data/src";
import { sidebarGroups, SIDEBAR_PIN_TAG } from "../../../ui-core/src/sidebar";
import { BrandLogo } from "../system/components/BrandLogo";
import { threadMenuEntries } from "../system/components/thread-menu";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { CAPABILITY_TAGS, CAPABILITY_CWDS, formatRoute, readSidebarWidth, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, statusLabel, viewShortcut, navShortcut, panelShortcut, type DesignContext, type ViewName } from "../../../ui-core/src";
import { Button, ContextBar, Field, FilterChips, FilterMenu, Icon, ModelPicker, MoreMenu, NavItem, Notice, StatusMark, ThreadDeleteDialog, ThreadGroup, ThreadItem, ShellFooter, ShellToggle, type IconRole, type ThreadDeleteTarget } from "../system/components";
import { formatAge, formatTokens, folderName } from "../../../ui-core/src";
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
import { layoutWidthStyle } from "../system/layout";

const SEARCH_DEBOUNCE_MS = 200;

export function App({ context }: { context: DesignContext }) {
  const model = context.model;
  const appRef = useRef<HTMLDivElement>(null);
  const panelVisible = () => (appRef.current?.clientWidth ?? 0) >= 1180;
  useLayoutEffect(() => model.bindPanelPreference({
    visible: panelVisible,
    collapsed: () => context.prefs.peek().panelCollapsed === true,
    write: panelCollapsed => context.setPrefs({ panelCollapsed }),
  }), [model, context]);
  const [deleteThread, setDeleteThread] = useState<ThreadDeleteTarget>();
  const sidebarListRef = useRef<HTMLDivElement>(null);
  const lastSidebarFocus = useRef<string>();
  const sidebarPositions = useRef(new Map<string, number>());

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
  const [filters, setFilters] = useState<ListFilter>({});
  const picker = model.modelPicker.value;
  useEffect(() => { if (picker.open && picker.thread !== model.selectedId.value) model.closeModelPicker(); }, [picker.open, picker.thread, model.selectedId.value]);

  useEffect(() => { model.monitorSort.value = context.prefs.value.monitorSort ?? "stable"; }, [model, context.prefs.value.monitorSort]);


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (navShortcut(e) && (document.querySelector(".app")?.clientWidth ?? 0) >= 900) {
        e.preventDefault();
        context.setPrefs({ navCollapsed: !context.prefs.value.navCollapsed });
        return;
      }
      if (panelShortcut(e) && model.route.peek().view === "conversation" && panelVisible()) {
        e.preventDefault();
        model.togglePanel();
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
      const next: ListFilter = route.view === "monitor" ? { archived: "include" } : { ...filters, ...(query.trim() ? { query: query.trim() } : {}) };
      const current = model.data.listFilter.peek();
      if (current.query !== next.query || current.archived !== next.archived || current.awaiting !== next.awaiting || current.cwd !== next.cwd
        || JSON.stringify(current.tags) !== JSON.stringify(next.tags)) model.data.setListFilter(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [model, query, filters, route.view]);

  const nav = (view: ViewName, role: IconRole, label: string, count?: number) => <NavItem key={view} href={formatRoute({ view })} role={role} label={label} current={route.view === view} {...(count !== undefined ? { count } : {})} />;
  const conversationNav = nav("conversation", "nav.conversation", t("view.conversation"));
  const monitorNav = nav("monitor", "nav.monitor", t("view.monitor"));
  const inboxNav = nav("inbox", "nav.inbox", t("view.inbox"), model.pendingCount.value);
  const moreItems = ([["apps", "nav.apps"], ["branches", "nav.branches"], ["threads", "nav.threads"], ["analytics", "nav.analytics"], ["settings", "nav.settings"]] as const).map(([view, role]) => ({ key: view, href: formatRoute({ view }), role, label: t(`view.${view}`), current: route.view === view }));

  const list = model.data.threadList.value;
  const sidebarSelected = route.view === "conversation" ? model.selectedId.value : undefined;
  const groups = useMemo(() => sidebarGroups(list.items, sidebarSelected), [list.items, sidebarSelected]);
  const revealGroup = groups.find(group => group.rows.some(row => row.summary.thread_id === sidebarSelected));
  const revealParents = JSON.stringify(revealGroup?.rows.filter(row => row.reveal).map(row => row.summary.thread_id) ?? []);
  const revealKey = revealGroup?.key;
  // Selection writes the same preferences as explicit disclosure; subsequent user folds win.
  useLayoutEffect(() => {
    if (revealKey === undefined) return;
    const prefs = context.prefs.peek();
    const closed = prefs.sidebarClosedGroups ?? [];
    const parents = prefs.sidebarOpenParents ?? [];
    const selectedParents = JSON.parse(revealParents) as string[];
    const nextOpen = [...new Set([...parents, ...selectedParents])].slice(-1000);
    if (closed.includes(revealKey) || nextOpen.length !== parents.length || nextOpen.some((id, i) => parents[i] !== id)) {
      context.setPrefs({ sidebarClosedGroups: closed.filter(key => key !== revealKey), sidebarOpenParents: nextOpen });
    }
  }, [context, sidebarSelected, revealKey, revealParents]);
  const closedGroups = context.prefs.value.sidebarClosedGroups ?? [];
  const openParents = context.prefs.value.sidebarOpenParents ?? [];
  const setFold = (field: "sidebarClosedGroups" | "sidebarOpenParents", id: string, add: boolean) => {
    const keys = (context.prefs.peek()[field] ?? []).filter(key => key !== id);
    context.setPrefs({ [field]: add ? [...keys, id].slice(-1000) : keys });
  };
  const canTag = model.data.capabilities.value.includes(CAPABILITY_TAGS);
  const canCwd = model.data.capabilities.value.includes(CAPABILITY_CWDS);
  const changeFilters = (change: ListFilter) => setFilters(value => ({ ...value, ...change }));
  const activeFilters = [
    ...(filters.awaiting ? [{ key: "awaiting", label: t("sidebar.needsYou"), remove: () => changeFilters({ awaiting: undefined }) }] : []),
    ...(filters.archived ? [{ key: "archived", label: t("sidebar.archived"), remove: () => changeFilters({ archived: undefined }) }] : []),
    ...(filters.cwd ? [{ key: "cwd", label: filters.cwd, remove: () => changeFilters({ cwd: undefined }) }] : []),
    ...(filters.tags ?? []).map(tag => ({ key: `tag:${tag}`, label: tag, remove: () => changeFilters({ tags: filters.tags?.length === 1 ? undefined : filters.tags?.filter(value => value !== tag) }) })),
  ];
  const filterEntries = ({ tags, directories, moreTags, moreDirectories }: Parameters<Parameters<typeof FilterMenu>[0]["entries"]>[0]) => [
    { key: "awaiting", label: t("sidebar.needsYou"), onSelect: () => changeFilters({ awaiting: filters.awaiting ? undefined : "human" }) },
    { key: "archived", label: t("sidebar.archived"), onSelect: () => changeFilters({ archived: filters.archived ? undefined : "include" }) },
    ...(canCwd ? directories.map(cwd => ({ key: `cwd:${cwd}`, label: t("sidebar.directory", { name: cwd }), onSelect: () => changeFilters({ cwd }) })) : []),
    ...(canTag ? tags.map(tag => ({ key: `tag:${tag}`, label: t("sidebar.tag", { name: tag }), onSelect: () => {
      const tags = filters.tags ?? [];
      if (!tags.includes(tag) && tags.length < 64) changeFilters({ tags: [...tags, tag] });
    } })) : []),
    ...(moreTags ? [{ key: "more-tags", label: t("org.moreTags"), keepOpen: true, onSelect: moreTags }] : []),
    ...(moreDirectories ? [{ key: "more-cwds", label: t("org.moreDirs"), keepOpen: true, onSelect: moreDirectories }] : []),
  ];

  const selected = model.selectedId.value;
  const row = model.selectedRow.value;
  const details = model.details.value;
  const ctx = route.view === "conversation" ? model.context.value : undefined;
  const conn = model.connection.value;
  const desktop = model.data.desktop.value;
  const desktopDiagnostic = model.data.desktopDiagnostic.value;
  const title = route.view === "conversation" ? (details?.title ?? row?.summary.title) : t(`view.${route.view}`);
  const folder = route.view === "conversation" ? folderName(details?.cwd ?? row?.summary.cwd) : undefined;

  const statusFooter = <footer class="status">
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
          </footer>;
  if (route.view === "settings") return <div class="app"><SettingsView context={context} />{statusFooter}</div>;

  return (
    <div class="app" ref={appRef}>
      <div class={context.prefs.value.navCollapsed ? "shell nav-collapsed" : "shell"} style={layoutWidthStyle(context.prefs.value)}>
        <LayoutSeparator side="left" label={t("threads.resizeSidebar")} controls="thread-sidebar"
          width={readSidebarWidth(context.prefs.value.sidebarWidth)} min={SIDEBAR_WIDTH_MIN} max={SIDEBAR_WIDTH_MAX}
          disabled={context.prefs.value.navCollapsed} onWidth={sidebarWidth => context.setPrefs({ sidebarWidth })} />
        <button type="button" class={drawer ? "scrim open" : "scrim"} aria-label={t("threads.close")} tabIndex={drawer ? 0 : -1} onClick={() => setDrawer(false)} />
        <aside id="thread-sidebar" class={drawer ? "side open" : "side"} aria-label={t("threads.title")}>
          <div class="side-header">
            <div class="brand">
              <BrandLogo />
              <span class="brand-label">{t("brand")}</span>
            </div>
          </div>
          <div class="side-middle">
            <nav class="nav" aria-label={t("nav.views")}>
              {conversationNav}
              {monitorNav}
              {inboxNav}
              {moreItems.map((i) => <NavItem key={i.key} href={i.href} role={i.role} label={i.label} current={i.current} />)}
            </nav>
            <div class="sidehead">
            <h2 id="sidebar-thread-list-heading" tabIndex={-1}>{t("threads.title")}</h2>
          </div>
          <div class="side-search">
            <div class="side-controls">
              <Field ariaLabel={t("threads.search")} placeholder={t("threads.search")} leading={<Icon role="thread.search" size="small" />} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
              {route.view !== "monitor" ? <FilterMenu key={formatRoute(route)} label={t("sidebar.filters")} count={activeFilters.length} entries={filterEntries} data={model.data} canTag={canTag} canCwd={canCwd} /> : null}
              <Button icon label={t("threads.new")} title={t("threads.new")} onClick={() => { setDrawer(false); void model.createThread(); }}><Icon role="thread.create" size="small" /></Button>
            </div>
            {route.view !== "monitor" ? <>              <FilterChips items={activeFilters.map(item => ({ ...item, removeLabel: t("sidebar.remove", { name: item.label }) }))} clearLabel={t("sidebar.clear")} onClear={() => setFilters({})} /></> : null}
          </div>
          <div class="side-list" ref={sidebarListRef} onFocusIn={(event) => {
            const target = event.target as HTMLElement;
            const link = target.closest<HTMLAnchorElement>('a[id^="thread-link-sidebar-"]') ?? target.closest<HTMLElement>("[data-thread-row]")?.querySelector<HTMLAnchorElement>('a[id^="thread-link-sidebar-"]');
            if (!link) return;
            const links = sidebarLinks();
            rememberSidebarPositions(links);
            lastSidebarFocus.current = link.id.replace("thread-link-sidebar-", "");
          }} onFocusOut={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !sidebarListRef.current?.contains(next)) lastSidebarFocus.current = undefined;
          }}>
            <div class="tree">
              {groups.map(group => {
                const label = group.directory === undefined ? t("sidebar.pinned") : folderName(group.directory) ?? group.directory;
                const open = !closedGroups.includes(group.key);
                const fold = { open, show: t("sidebar.expand"), hide: t("sidebar.collapse"), showLabel: t("sidebar.expandGroup", { name: label }), hideLabel: t("sidebar.collapseGroup", { name: label }), onToggle: () => setFold("sidebarClosedGroups", group.key, open) };
                return <ThreadGroup key={group.key} label={label} count={String(group.rows.length)} leading={group.directory === undefined ? "thread.pinned" : "group.directory"} fold={fold}>
                  {open ? group.rows.map(r => {
                    if (r.ancestors.some(id => !openParents.includes(id))) return null;
                    const id = r.summary.thread_id;
                    const expanded = openParents.includes(id);
                    const unread = model.sidebarUnread(r.summary);
                    return <ThreadItem key={id} sidebar unread={unread} linkId={`thread-link-sidebar-${id}`}
                      href={formatRoute({ view: "conversation", threadId: id })} title={r.summary.title}
                      status={r.status} statusLabel={r.status ? statusLabel(t, r.status) : ""}
                      depth={r.depth} current={id === sidebarSelected} pending={r.pending} age={formatAge(r.summary.updated_at, model.coarseNow.value)}
                      childrenFold={r.descendants ? { count: r.descendants, awaiting: r.awaiting, running: r.running, open: expanded,
                        label: t("sidebar.children", { n: r.descendants, awaiting: r.awaiting, running: r.running }),
                        awaitingLabel: t("sidebar.needsYou"), runningLabel: statusLabel(t, "running"),
                        onToggle: r.childCount ? value => setFold("sidebarOpenParents", id, value) : undefined } : undefined}
                      onSelect={() => setDrawer(false)}
                      menu={{ label: t("thread.rowMenu"), entries: [{ key: "read-state", label: t(unread ? "sidebar.markRead" : "sidebar.markUnread"), disabled: !r.summary.last_end_message?.node_id, onSelect: () => model.markSidebarUnread(id, !unread) }, ...threadMenuEntries(model, r.summary, r.status,
                        target => setDeleteThread({ threadId: target.thread_id }), canTag ? { onEditTags: () => {
                          model.showView("threads");
                          model.org.openTagsFor(id, r.summary.archived_at !== undefined); setDrawer(false);
                        } } : undefined)] }} />;
                  }) : null}
                </ThreadGroup>;
              })}
            </div>
            {list.loaded && list.items.length === 0 ? <div class="side-note">{query || activeFilters.length ? t("threads.noMatch") : t("threads.empty")}</div> : null}
            {model.data.canLoadMoreThreads() ? <Button disabled={list.loadingMore} onClick={() => void model.data.loadMoreThreads()}>{t("threads.more")}</Button> : list.nextCursor ? <div class="side-note">{t("threads.capped")}</div> : null}
          </div>
          </div>
          <ShellFooter side="left"><ShellToggle panel={false} expanded={!context.prefs.value.navCollapsed} label={context.prefs.value.navCollapsed ? t("nav.expand") : t("nav.collapse")} title={`${context.prefs.value.navCollapsed ? t("nav.expand") : t("nav.collapse")} (Cmd/Ctrl+B)`} onClick={() => context.setPrefs({ navCollapsed: !context.prefs.value.navCollapsed })} /></ShellFooter>
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
              {route.view === "conversation" && details ? <ModelPicker model={model} details={details} /> : null}
              <Button icon label={settings ? t("settings.close") : t("settings.open")} aria-expanded={settings} data-settings-toggle onClick={() => setSettings(!settings)}>
                <Icon role="settings.applicationPanel" />
              </Button>
            </div>
          </header>
          {settings ? <Settings context={context} onClose={() => setSettings(false)} /> : null}
          <div class="alerts">
            {conn === "authNeeded" ? <AuthPrompt context={context} /> : null}
            {conn === "ownerDown" ? <Notice tone="wait">{t("banner.ownerDown")}{desktop ? <Button onClick={() => model.data.link.launcherAction("restart")}>{t("launcher.restart")}</Button> : null}</Notice> : null}
            {desktopDiagnostic ? <Notice tone="wait">{desktopDiagnostic}</Notice> : null}
            {model.actionError.value ? <Notice tone={model.actionError.value.kind === "error" ? "bad" : undefined}>{model.actionError.value.text}</Notice> : null}
          </div>
          {deleteThread ? <ThreadDeleteDialog key={deleteThread.threadId} model={model} target={deleteThread} getReturnFocusTarget={resolveSidebarLink} onClose={() => setDeleteThread(undefined)} /> : null}
          <section class="view" aria-label={title}>
            <AppsHost context={context} />
            {route.view === "apps" ? null : route.view === "conversation" ? <Conversation model={model} panelCollapsed={context.prefs.value.panelCollapsed} rightPanelWidth={context.prefs.value.rightPanelWidth} onPanelWidth={rightPanelWidth => context.setPrefs({ rightPanelWidth })} /> : route.view === "monitor" ? <Monitor context={context} /> : route.view === "inbox" ? <Inbox model={model} /> : route.view === "analytics" ? <Analytics context={context} /> : route.view === "branches" ? <Branches model={model} /> : route.view === "threads" ? <Threads model={model} /> : route.view === "setup" ? <Setup context={context} /> : <SettingsView context={context} />}
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
              {desktop ? <Button onClick={() => model.data.link.launcherAction("exit")}>{t("launcher.exit")}</Button> : null}
            </div>
          </footer>
          {statusFooter}
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
