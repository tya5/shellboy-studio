import { normalizeFilter, type ListFilter } from "../../../data/src/store";
import { sidebarGroups } from "../../../ui-core/src/sidebar";
import { BrandLogo } from "../system/components/BrandLogo";
import { threadMenuEntries } from "../system/components/thread-menu";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { CAPABILITY_TAGS, CAPABILITY_CWDS, formatRoute, readSidebarWidth, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, statusLabel, viewShortcut, navShortcut, panelShortcut, type DesignContext, type ViewName } from "../../../ui-core/src";
import { Button, Field, FilterChips, FilterMenu, Icon, LoadingCount, LoadingRows, MoreMenu, NavItem, Notice, StatusMark, ThreadDeleteDialog, ThreadGroup, ThreadItem, ShellFooter, ShellToggle, type IconRole, type ThreadDeleteTarget, useSidebarThreadSelection } from "../system/components";
import { formatAge, formatCount } from "../../../ui-core/src";
import { ThreadHeader } from "./ThreadHeader";
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
const sidebarLinkId = (key: string) => `thread-link-sidebar-${encodeURIComponent(key)}`;

export function App({ context }: { context: DesignContext }) {
  const model = context.model;
  const appRef = useRef<HTMLDivElement>(null);
  const panelVisible = () => (appRef.current?.clientWidth ?? 0) >= 1180;
  const [phonePanel, setPhonePanel] = useState<string>();
  const togglePanelSheet = () => {
    const thread = model.handle.peek()?.threadId;
    if (thread) setPhonePanel(current => current === thread ? undefined : thread);
  };
  useLayoutEffect(() => model.bindPanelPreference({
    visible: panelVisible,
    collapsed: () => context.prefs.peek().panelCollapsed === true,
    write: panelCollapsed => context.setPrefs({ panelCollapsed }),
  }), [model, context]);
  const threadSelection = useSidebarThreadSelection(model, () => document.getElementById("sidebar-thread-list-heading"));
  const [deleteThread, setDeleteThread] = useState<ThreadDeleteTarget & { rowKey: string }>();
  const sidebarListRef = useRef<HTMLDivElement>(null);
  const lastSidebarFocus = useRef<string>();
  const sidebarPositions = useRef(new Map<string, number>());

  const sidebarLinks = () => [...(sidebarListRef.current?.querySelectorAll<HTMLAnchorElement>('a[id^="thread-link-sidebar-"]') ?? [])];
  const rememberSidebarPositions = (links: HTMLAnchorElement[]) => {
    links.forEach((link, index) => sidebarPositions.current.set(link.id, index));
  };
  const resolveSidebarLink = (linkId: string, threadId?: string) => {
    const links = sidebarLinks();
    rememberSidebarPositions(links);
    const href = threadId === undefined ? undefined : formatRoute({ view: "conversation", threadId });
    const direct = links.find(link => link.id === linkId) ?? (href && links.find(link => link.getAttribute("href") === href));
    if (direct) return direct;
    const position = sidebarPositions.current.get(linkId);
    return (position !== undefined ? links[position] ?? links[Math.min(position - 1, links.length - 1)] : undefined)
      ?? document.getElementById("sidebar-thread-list-heading");
  };
  useLayoutEffect(() => {
    const links = sidebarLinks();
    rememberSidebarPositions(links);
    const claimed = lastSidebarFocus.current;
    if (!claimed || links.some(link => link.id === claimed)) return;
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
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229
        || document.querySelector('dialog:modal, dialog[open][aria-modal="true"], [role="dialog"][aria-modal="true"]:not([hidden])')) return;
      const target = e.target instanceof Element ? e.target : document.activeElement;
      if (target?.closest('input,textarea,select,[role="textbox"]')
        || (target instanceof HTMLElement && target.isContentEditable)) return;
      if (navShortcut(e) && (document.querySelector(".app")?.clientWidth ?? 0) >= 900) {
        e.preventDefault();
        context.setPrefs({ navCollapsed: !context.prefs.value.navCollapsed });
        return;
      }
      if (panelShortcut(e) && model.route.peek().view === "conversation" && model.handle.peek()) {
        e.preventDefault();
        if (!panelVisible() || phonePanel === model.handle.peek()?.threadId) togglePanelSheet();
        else model.togglePanel();
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
  }, [model, context, phonePanel]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next: ListFilter = { ...filters, ...(query.trim() ? { query: query.trim() } : {}) };
      const current = model.data.listFilter.peek();
      if (current.query !== next.query || current.archived !== next.archived || current.awaiting !== next.awaiting || current.cwd !== next.cwd
        || JSON.stringify(current.tags) !== JSON.stringify(next.tags)) model.data.setListFilter(next);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [model, query, filters, route.view]);

  const nav = (view: ViewName, role: IconRole, label: string, count?: number | `${number}+`) => <NavItem key={view} href={formatRoute({ view })} role={role} label={label} current={route.view === view} {...(count !== undefined ? { count } : {})} />;
  const conversationNav = nav("conversation", "nav.conversation", t("view.conversation"));
  const monitorNav = nav("monitor", "nav.monitor", t("view.monitor"));
  const inboxNav = nav("inbox", "nav.inbox", t("view.inbox"), formatCount(model.pendingCount.value));
  const moreItems = ([["apps", "nav.apps"], ["branches", "nav.branches"], ["threads", "nav.threads"], ["analytics", "nav.analytics"], ["settings", "nav.settings"]] as const).map(([view, role]) => ({ key: view, href: formatRoute({ view }), role, label: t(`view.${view}`), current: route.view === view }));

  const list = model.data.threadList.value;
  const sidebarSelected = route.view === "conversation" ? model.selectedId.value : undefined;
  const appliedFilter = list.filter;
  const flat = !!(appliedFilter?.query || appliedFilter?.cwd || appliedFilter?.tags?.length
    || appliedFilter?.awaiting || (appliedFilter?.archived && appliedFilter.archived !== "exclude"));
  const pinned = appliedFilter?.awaiting ? [] : model.data.pinnedThreads.value;
  const pinnedIds = appliedFilter?.awaiting ? [] : model.data.pinnedThreadIds.value;
  // Like Pinned, the Archive band is hidden while Needs-you is on.
  const archive = model.data.archivedList.value;
  const archived = appliedFilter?.awaiting ? [] : archive.items;
  const sidebarRows = useMemo(() => {
    const exact = model.data.threadRows.value;
    const rows = new Map(list.items.map(row => [row.thread_id, exact.get(row.thread_id) ?? row]));
    for (const row of [...archived, ...pinned]) rows.set(row.thread_id, exact.get(row.thread_id) ?? row);
    return [...rows.values()];
  }, [list.items, archived, pinned, model.data.threadRows.value]);
  const groups = useMemo(() => sidebarGroups(sidebarRows, pinnedIds, sidebarSelected, flat, list.items.map(row => model.data.threadRows.value.get(row.thread_id) ?? row), archived),
    [sidebarRows, pinnedIds, sidebarSelected, flat, list.items, archived, model.data.threadRows.value]);
  // Core's continuation facts: more listed pages, or a pinned read stopped at its bound.
  const lowerBound = { pins: model.data.pinnedMore.value, all: list.nextCursor !== undefined, archive: archive.nextCursor !== undefined };
  // Pinned and All start open and remember a close; Archive starts closed and remembers an open.
  const startsClosed = (key: string) => key === "archive";
  const revealGroups = JSON.stringify(groups.filter(group => group.rows.some(row => row.summary.thread_id === sidebarSelected)).map(group => group.key));
  const revealParents = JSON.stringify(groups.flatMap(group => group.rows.filter(row => row.reveal).map(row => row.key)));
  // Selection writes the same preferences as explicit disclosure; subsequent user folds win.
  useLayoutEffect(() => {
    const selectedGroups = JSON.parse(revealGroups) as string[];
    if (!selectedGroups.length) return;
    const prefs = context.prefs.peek();
    const closed = prefs.sidebarClosedGroups ?? [];
    const openGroups = prefs.sidebarOpenGroups ?? [];
    const parents = prefs.sidebarOpenParents ?? [];
    const selectedParents = JSON.parse(revealParents) as string[];
    const nextOpen = [...new Set([...parents, ...selectedParents])].slice(-1000);
    const nextClosed = closed.filter(key => !selectedGroups.includes(key));
    const nextOpenGroups = [...new Set([...openGroups, ...selectedGroups.filter(startsClosed)])];
    if (nextClosed.length !== closed.length || nextOpenGroups.length !== openGroups.length || nextOpen.length !== parents.length || nextOpen.some((id, i) => parents[i] !== id)) {
      context.setPrefs({ sidebarClosedGroups: nextClosed, sidebarOpenGroups: nextOpenGroups, sidebarOpenParents: nextOpen });
    }
  }, [context, sidebarSelected, revealGroups, revealParents]);
  const closedGroups = context.prefs.value.sidebarClosedGroups ?? [];
  const openGroups = context.prefs.value.sidebarOpenGroups ?? [];
  const openParents = context.prefs.value.sidebarOpenParents ?? [];
  const setFold = (field: "sidebarClosedGroups" | "sidebarOpenGroups" | "sidebarOpenParents", id: string, add: boolean) => {
    const keys = (context.prefs.peek()[field] ?? []).filter(key => key !== id);
    context.setPrefs({ [field]: add ? [...keys, id].slice(-1000) : keys });
  };
  const editThreadTags = (id: string, archived: boolean) => {
    model.showView("threads");
    model.org.openTagsFor(id, archived);
    setDrawer(false);
  };
  const canTag = model.data.capabilities.value.includes(CAPABILITY_TAGS);
  const canCwd = model.data.capabilities.value.includes(CAPABILITY_CWDS);
  const changeFilters = (change: ListFilter) => {
    const current = { ...filters, query: query.trim() || undefined };
    const next = normalizeFilter(current, { ...current, ...change });
    setFilters(next);
    setQuery(next.query ?? "");
  };
  const activeFilters = [
    ...(filters.awaiting ? [{ key: "awaiting", label: t("sidebar.needsYou"), remove: () => changeFilters({ awaiting: undefined }) }] : []),
    ...(filters.cwd ? [{ key: "cwd", label: filters.cwd, remove: () => changeFilters({ cwd: undefined }) }] : []),
    ...(filters.tags ?? []).map(tag => ({ key: `tag:${tag}`, label: tag, remove: () => changeFilters({ tags: filters.tags?.length === 1 ? undefined : filters.tags?.filter(value => value !== tag) }) })),
  ];
  const filterEntries = ({ tags, directories, moreTags, moreDirectories }: Parameters<Parameters<typeof FilterMenu>[0]["entries"]>[0]) => [
    { key: "awaiting", label: t("sidebar.needsYou"), onSelect: () => changeFilters({ awaiting: filters.awaiting ? undefined : "human" }) },
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
  const conn = model.connection.value;
  const desktop = model.data.desktop.value;
  const desktopDiagnostic = model.data.desktopDiagnostic.value;
  const title = route.view === "conversation" ? (details?.title ?? row?.summary.title) : t(`view.${route.view}`);

  const statusFooter = <footer class="status">
            <StatusMark feedback
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
            <h2 id="sidebar-thread-list-heading" class="group-label" tabIndex={-1}>{t("threads.title")}</h2>
            {threadSelection.start}
          </div>
          <div class="side-search">
            <div class="side-controls">
              <Field ariaLabel={t("threads.search")} placeholder={t("threads.search")} leading={<Icon role="thread.search" size="small" />} value={query} onInput={(e) => {
                const value = e.currentTarget.value;
                const current = { ...filters, query: query.trim() || undefined };
                setFilters(normalizeFilter(current, { ...current, query: value.trim() || undefined }));
                setQuery(value);
              }} />
              {route.view !== "monitor" ? <FilterMenu key={formatRoute(route)} label={t("sidebar.filters")} count={activeFilters.length} entries={filterEntries} data={model.data} canTag={canTag} canCwd={canCwd} /> : null}
              <Button icon label={t("threads.new")} title={t("threads.new")} onClick={() => { setDrawer(false); void model.createThread(); }}><Icon role="thread.create" size="small" /></Button>
            </div>
            {route.view !== "monitor" ? <>              <FilterChips items={activeFilters.map(item => ({ ...item, removeLabel: t("sidebar.remove", { name: item.label }) }))} clearLabel={t("sidebar.clear")} onClear={() => setFilters({})} /></> : null}
            {threadSelection.bar}
          </div>
          <div class="side-list" ref={sidebarListRef} onFocusIn={(event) => {
            const target = event.target as HTMLElement;
            const link = target.closest<HTMLAnchorElement>('a[id^="thread-link-sidebar-"]') ?? target.closest<HTMLElement>("[data-thread-row]")?.querySelector<HTMLAnchorElement>('a[id^="thread-link-sidebar-"]');
            if (!link) return;
            const links = sidebarLinks();
            rememberSidebarPositions(links);
            lastSidebarFocus.current = link.id;
          }} onFocusOut={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !sidebarListRef.current?.contains(next)) lastSidebarFocus.current = undefined;
          }}>
            {!appliedFilter?.awaiting && model.data.pinnedError.value ? <div class="side-search"><Notice tone="bad">{t("common.readError", { message: model.data.pinnedError.value.message })}</Notice></div> : null}
            <div class="tree">
              {groups.map(group => {
                const label = t(group.key === "pins" ? "sidebar.pinned" : group.key === "archive" ? "sidebar.archive" : "sidebar.all");
                const open = startsClosed(group.key) ? openGroups.includes(group.key) : !closedGroups.includes(group.key);
                const fold = { open, show: t("sidebar.expand"), hide: t("sidebar.collapse"), showLabel: t("sidebar.expandGroup", { name: label }), hideLabel: t("sidebar.collapseGroup", { name: label }),
                  onToggle: () => startsClosed(group.key) ? setFold("sidebarOpenGroups", group.key, !open) : setFold("sidebarClosedGroups", group.key, open) };
                const pages = group.key === "archive" ? archive : list;
                let hiddenBelow: number | undefined;
                return <ThreadGroup key={group.key} label={label} count={pages.loaded ? t("org.bandCount", { n: `${group.count}${lowerBound[group.key] ? "+" : ""}` }) : pages.loading ? <LoadingCount /> : ""} countLoading={!pages.loaded && pages.loading} fold={fold}>
                  {open ? group.rows.map((r, index) => {
                    if (hiddenBelow !== undefined && r.depth > hiddenBelow) return null;
                    const id = r.summary.thread_id;
                    const expanded = openParents.includes(r.key);
                    const unread = model.sidebarUnread(r.summary);
                    hiddenBelow = r.childCount && !expanded ? r.depth : undefined;
                    return <ThreadItem key={r.key} sidebar unread={unread} beforeLink={threadSelection.checkbox(id, r.summary.title)} linkId={sidebarLinkId(r.key)}
                      href={formatRoute({ view: "conversation", threadId: id })} title={r.summary.title}
                      status={r.status} statusLabel={r.status ? statusLabel(t, r.status) : ""}
                      depth={r.depth} current={id === sidebarSelected} pending={r.pending} pendingExact={r.pendingExact} age={formatAge(r.summary.updated_at, model.coarseNow.value)}
                      childrenFold={r.descendants ? { count: r.descendants, awaiting: r.awaiting, running: r.running, open: expanded,
                        label: t("sidebar.children", { n: r.descendants, awaiting: r.awaiting, running: r.running }),
                        awaitingLabel: t("sidebar.needsYou"), runningLabel: statusLabel(t, "running"),
                        onToggle: value => {
                          if (!value) { setFold("sidebarOpenParents", r.key, false); return; }
                          // Open all the gates in this copy's contiguous subtree.
                          const branch = group.rows.slice(index, index + r.descendants + 1);
                          const keys = new Set(branch.filter(row => row.descendants > 0).map(row => row.key));
                          const previous = context.prefs.peek().sidebarOpenParents ?? [];
                          context.setPrefs({ sidebarOpenParents: [...previous.filter(key => !keys.has(key)), ...keys].slice(-1000) });
                        } } : undefined}
                      onSelect={() => setDrawer(false)}
                      menu={{ label: t("thread.rowMenu"), entries: [{ key: "read-state", label: t(unread ? "sidebar.markRead" : "sidebar.markUnread"), disabled: !r.summary.last_end_message?.node_id, onSelect: () => model.markSidebarUnread(id, !unread) }, ...threadMenuEntries(model, r.summary,
                        target => setDeleteThread({ threadId: target.thread_id, rowKey: r.key }), canTag ? { onEditTags: () => editThreadTags(id, r.summary.archived_at !== undefined) } : undefined)] }} />;
                  }) : null}
                  {/* Each paged band ends with its own Show more, so All's does not sit under Archive; `.side-note` gives it the rows' space-8 inset. */}
                  {open && group.key !== "pins" && pages.nextCursor ? <div class="side-note">{(group.key === "archive" ? model.data.canLoadMoreArchived() : model.data.canLoadMoreThreads())
                    ? <Button disabled={pages.loadingMore} onClick={() => void (group.key === "archive" ? model.data.loadMoreArchived() : model.data.loadMoreThreads())}>{t("threads.more")}</Button>
                    : t("threads.capped")}</div> : null}
                </ThreadGroup>;
              })}
            </div>
            {!list.loaded && list.loading ? <LoadingRows label={t("common.loading")} rows={2} /> : null}
            {list.loaded && list.items.length === 0 ? <div class="side-note">{query || activeFilters.length ? t("threads.noMatch") : t("threads.empty")}</div> : null}
          </div>
          </div>
          <ShellFooter side="left"><ShellToggle panel={false} expanded={!context.prefs.value.navCollapsed} label={context.prefs.value.navCollapsed ? t("nav.expand") : t("nav.collapse")} title={`${context.prefs.value.navCollapsed ? t("nav.expand") : t("nav.collapse")} (Cmd/Ctrl+B)`} onClick={() => context.setPrefs({ navCollapsed: !context.prefs.value.navCollapsed })} /></ShellFooter>
        </aside>
        <div class="main">
          {route.view === "conversation" ? <ThreadHeader key={selected} model={model} settings={settings} onSettings={() => setSettings(!settings)} onList={() => setDrawer(true)} onDelete={(threadId) => setDeleteThread({ threadId, rowKey: threadId })} onEditTags={editThreadTags} /> : <header class="top">
            <span class="menu"><Button icon label={t("threads.open")} onClick={() => setDrawer(true)}><Icon role="nav.openThreadList" /></Button></span>
            <div class="crumb"><b>{title ?? ""}</b></div>
            <div class="right"><Button icon label={settings ? t("settings.close") : t("settings.open")} aria-expanded={settings} data-settings-toggle onClick={() => setSettings(!settings)}><Icon role="settings.applicationPanel" /></Button></div>
          </header>}
          {settings ? <Settings context={context} onClose={() => setSettings(false)} /> : null}
          <div class="alerts">
            {conn === "authNeeded" ? <AuthPrompt context={context} /> : null}
            {conn === "ownerDown" ? <Notice tone="wait">{t("banner.ownerDown")}{desktop ? <Button onClick={() => model.data.link.launcherAction("restart")}>{t("launcher.restart")}</Button> : null}</Notice> : null}
            {desktopDiagnostic ? <Notice tone="wait">{desktopDiagnostic}</Notice> : null}
            {model.actionError.value ? <Notice tone={model.actionError.value.kind === "error" ? "bad" : undefined}>{model.actionError.value.text}</Notice> : null}
          </div>
          {threadSelection.dialog(id => sidebarRows.find(row => row.thread_id === id)?.title)}
          {deleteThread ? <ThreadDeleteDialog key={deleteThread.threadId} model={model} target={deleteThread} getReturnFocusTarget={id => resolveSidebarLink(sidebarLinkId(deleteThread.rowKey), id)} onClose={() => setDeleteThread(undefined)} /> : null}
          <section class="view" aria-label={title}>
            <AppsHost context={context} />
            {route.view === "apps" ? null : route.view === "conversation" ? <Conversation model={model} panelCollapsed={context.prefs.value.panelCollapsed} rightPanelWidth={context.prefs.value.rightPanelWidth} onPanelWidth={rightPanelWidth => context.setPrefs({ rightPanelWidth })} phonePanel={!!selected && phonePanel === selected} onTogglePhonePanel={togglePanelSheet} onClosePhonePanel={() => setPhonePanel(undefined)} onOpenPhonePanel={() => setPhonePanel(selected)} /> : route.view === "monitor" ? <Monitor context={context} /> : route.view === "inbox" ? <Inbox model={model} /> : route.view === "analytics" ? <Analytics context={context} /> : route.view === "branches" ? <Branches model={model} /> : route.view === "threads" ? <Threads model={model} /> : route.view === "setup" ? <Setup context={context} /> : <SettingsView context={context} />}
          </section>
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
