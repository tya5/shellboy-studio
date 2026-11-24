// One contiguous loaded history run. Unknown edges have indicators, never estimated space.
import type { ComponentChildren, VNode } from "preact";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { materializeHistoryPresentation, type AppModel, type ConversationRow, type ConversationWindow } from "../../../ui-core/src";
import { Button, EmptyState, LoadingRows, Notice } from "../system/components";

import { conversationViewport, type MountedViewport } from "./conversationViewport";
import { measureAcceptedRows } from "./acceptedRowMeasure";
import type { WindowAcceptedSnapshot } from "../../../ui-core/src/window";
import { CurrentScrollSync, type ScrollViewPort } from "./scrollTransaction";
import { HeadingAnchor, ReadingAnchor, ScrollIntent, type ReadingContext } from "./scrollIntent";

export function heldRange(visible: { first: number; last: number }, total: number, held: (index: number) => boolean): { first: number; last: number } {
  const range = { ...visible };
  while (range.first > 0 && held(range.first - 1)) range.first--;
  while (range.last + 1 < total && held(range.last + 1)) range.last++;
  return range;
}

export type WindowScrollModel = Pick<AppModel,'t'|'shells'|'handle'|'senderPageSelected'|'bodyState'>;

export function WindowedScroll({ model, win, renderRow, live, liveBoundary, statusLine, scrollPort, renderAcceptedView }: { model: WindowScrollModel; win: ConversationWindow; renderRow: (row: ConversationRow) => VNode; live: ComponentChildren; liveBoundary?: number; statusLine?: ComponentChildren; scrollPort?: ScrollViewPort<object>; renderAcceptedView?: (ref: WindowAcceptedSnapshot) => ComponentChildren }) {
  const port: ScrollViewPort<object> = scrollPort ?? win;
  const t = model.t.value;
  win.version.value; // redraw on every change the window reports
  const status = win.status.value;
  const error = win.error.value;
  const shells = model.shells.value;
  const [, invalidateAccepted] = useState(0);
  useLayoutEffect(() => {
    if (!renderAcceptedView) return;
    return win.acceptedView.subscribe(() => invalidateAccepted(value => value + 1));
  }, [win, !!renderAcceptedView]);
  const accepted = renderAcceptedView ? win.acceptedView.peek() : undefined;
  const el = useRef<HTMLDivElement>(null);
  const visible = renderAcceptedView ? undefined : win.renderRange();
  const range = accepted?.range ?? (visible && heldRange(visible, win.total, (index) => win.itemAt(index) !== undefined));
  const intent = useRef(new ScrollIntent());
  const writer = useRef(new CurrentScrollSync());
  useLayoutEffect(() => () => { writer.current.dispose(); headingAnchor.current.clear(); }, []);
  const headingAnchor = useRef(new HeadingAnchor());
  const touchY = useRef<number | undefined>(undefined);
  const readingAnchor = useRef(new ReadingAnchor());

  const active = useRef<MountedViewport>();
  const lastTop = useRef(0);
  const fallbackProbe = useRef<HTMLDivElement>(null);
  const [viewportState, setViewport] = useState({top: 0, height: 0, following: true, fallback: 0});
  const refreshViewport = (box: HTMLElement, start: number) => {
    const top = Math.max(0, box.scrollTop - start), height = box.clientHeight;
    lastTop.current = top;
    const following = intent.current.following && win.following.peek();
    const fallback = fallbackProbe.current?.getBoundingClientRect().height ?? 0;
    const current = active.current;
    const range = current?.geometry.range(top, height, following);
    setViewport(previous => previous.height === height && previous.following === following && previous.fallback === fallback
      && (previous.top === top || !range || (range[0] === current?.first && range[1] === current?.end)) ? previous : {top, height, following, fallback});
  };
  const mounted = useRef(new Map<Element, string>());
  const byKey = useRef(new Map<string, HTMLElement>());
  const dirty = useRef(new Set<HTMLElement>());
  const resize = useRef<ResizeObserver>();
  const mount = useCallback((key: string, element: HTMLElement | null) => {
    const old = byKey.current.get(key);
    if (old) { resize.current?.unobserve(old); mounted.current.delete(old); dirty.current.delete(old); byKey.current.delete(key); }
    if (element) {
      mounted.current.set(element, key); byKey.current.set(key, element); dirty.current.add(element);
      resize.current?.observe(element);
    }
  }, []);
  const commit = useCallback((viewport: MountedViewport | undefined) => { active.current = viewport; }, []);
  const viewport = useMemo(() => ({ ...viewportState, get top() { return lastTop.current; }, mount, commit }), [viewportState]);
  const tellWindow = (box: HTMLElement, start: number, following: boolean) => {
    const top = box.scrollTop - start;
    const current = active.current;
    const index = current?.geometry.locate(top);
    const ordinal = index === undefined ? undefined : current?.ordinals[index];
    win.view(top, box.clientHeight, following, ordinal === undefined || !current ? undefined : { ordinal, totalHeight: current.geometry.offset(current.geometry.keys.length), range: accepted?.range });
    if (renderAcceptedView) refreshViewport(box, start);
  };
  const readingIndex = useMemo(() => ({
    nodes: new Set(accepted?.rows.flatMap(row => row.node_id ? [row.node_id] : [])),
    assistantAttempts: new Map(accepted?.rows.flatMap(row => row.kind === "assistant_response" && row.node_id && row.provenance?.attempt_id ? [[row.node_id, row.provenance.attempt_id] as const] : [])),
    entries: new Map(accepted?.displayPlan?.entries.map(entry => [entry.item.key, entry])),
    groups: new Map(accepted?.displayPlan?.workGroups.map(group => [group.key, { first: group.firstMemberKey, members: new Set(group.memberKeys) }])),
  }), [accepted?.rows, accepted?.displayPlan?.entries]);
  const readingContext = (snapshot: WindowAcceptedSnapshot, isCurrent: () => boolean): ReadingContext => ({
    revision: snapshot.revision, epoch: snapshot.epoch, capability: win.acceptedView.currentCapability,
    nodes: readingIndex.nodes,
    assistantAttempts: readingIndex.assistantAttempts,
    groupMember: (group, item, node, firstOnly) => {
      const scope = readingIndex.groups.get(group);
      return readingIndex.entries.get(item)?.item.source.nodeId === node && !!scope && (firstOnly ? scope.first === item : scope.members.has(item));
    },
    previewText: (key, attempt) => {
      const tail = snapshot.displayPlan?.localRegion.tailRows.find(row => row.kind === "live" && row.item.key === key);
      return tail?.kind === "live" && tail.item.source.kind === "text" && tail.item.source.attemptId === attempt ? tail.item.source.text : undefined;
    },
    savedText: (key, node) => {
      const entry = readingIndex.entries.get(key);
      if (entry?.item.source.nodeId !== node || entry.item.source.kind !== "text" || entry.body.kind !== "typed-canonical") return;
      // Do not transfer on stale plan text if a full-body result has overridden it.
      const canonical = entry.body.text;
      if ([model.bodyState(node)?.text, model.bodyState(node, entry.item.source.itemIdentity)?.text].some(text => text !== undefined && text !== canonical)) return;
      return canonical;
    },
    isCurrent,
  });

  const origin = useRef<number | undefined>(undefined);
  const rowOrigin = (box: HTMLElement): number => {
    const rows = box.querySelector<HTMLElement>(".vspace");
    return rows ? rows.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientTop : 0;
  };
  // Model coordinates start at the measured rows, excluding captions and edge indicators.
  const sync = () => {
    const box = el.current;
    if (!box || win.status.peek() === "loading" || (renderAcceptedView && !win.acceptedView.isCurrent(accepted!))) return;
    let start = 0;
    writer.current.run(port, {
        measure: (ref) => {
          if (renderAcceptedView && ref !== accepted) return;
          start = rowOrigin(box);
          const current = active.current;
          if (current) {
            for (const node of dirty.current) {
              const key = mounted.current.get(node);
              if (key !== undefined) current.geometry.measure(key, node.getBoundingClientRect().height);
            }
            dirty.current.clear();
            const { geometry, first, end, before, after } = current;
            if (before) before.style.height = `${geometry.offset(first)}px`;
            if (after) after.style.height = `${geometry.offset(geometry.keys.length) - geometry.offset(end)}px`;
          } else {
            const changes: [number, number][] = [];
            if (!renderAcceptedView) for (const child of box.querySelectorAll<HTMLElement>("[data-o]"))
              changes.push([Number(child.dataset.o), child.getBoundingClientRect().height]);
            const measured = renderAcceptedView ? measureAcceptedRows(box, accepted!.rows) : changes;
            if (measured.length) win.measure(measured);
          }
        },
        plan: (_ref, request) => {
          const context = accepted ? readingContext(accepted, () => port.acceptedView.isCurrent(_ref) && win.acceptedView.isCurrent(accepted)) : undefined;

          const heading = headingAnchor.current.peek();
          const delta = heading?.delta ?? readingAnchor.current.correction(box, context);
          return {
            ownsScrollRequest: false,
            consume: () => { if (heading) headingAnchor.current.consume(heading); },
            write: () => {
              const following = intent.current.following && win.following.peek();
              if (following) intent.current.program(box, box.scrollHeight);
              else if (delta !== undefined) intent.current.program(box, box.scrollTop + delta);
              else if (request) intent.current.program(box, request.target + start);
              else if (origin.current !== undefined && start !== origin.current)
                intent.current.program(box, box.scrollTop + start - origin.current);
              origin.current = start;
              tellWindow(box, start, intent.current.following);
            },
            capture: () => readingAnchor.current.capture(box, context),
          };
        },
    });
  };

  // One frame belongs to this mounted scroll root; RO delivery only invalidates it.
  const observed = useRef(new Set<Element>());
  const frame = useRef<number | undefined>(undefined);
  const latest = useRef({ sync, port });
  latest.current = { sync, port };
  const cancelFrame = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
  };
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    let observing = true;
    const observer = new ResizeObserver(entries => {
      if (!observing) return;
      for (const entry of entries) if (mounted.current.has(entry.target)) dirty.current.add(entry.target as HTMLElement);
      if (frame.current !== undefined) return;
      const owner = latest.current.port;
      const ref = owner.acceptedView.peek();
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        if (latest.current.port === owner && owner.acceptedView.isCurrent(ref)) latest.current.sync();
      });
    });
    resize.current = observer;
    for (const node of mounted.current.keys()) observer.observe(node);
    return () => {
      observing = false;
      cancelFrame();
      observer.disconnect();
      observed.current.clear();
      resize.current = undefined;
    };
  }, []);
  useLayoutEffect(() => {
    // A rendered generation already has its own sync; do not drain old RO work.
    cancelFrame();
    sync();
    const box = el.current;
    const observer = resize.current;
    if (!box || !observer) return;
    if (active.current) { if (!observed.current.has(box)) { observer.observe(box); observed.current.add(box); } return; }
    const next = new Set<Element>([box, ...box.querySelectorAll("[data-o], .vspace, .live-tail, .conversation-items > *")]);
    for (const node of observed.current) if (!next.has(node)) observer.unobserve(node);
    for (const node of next) if (!observed.current.has(node)) observer.observe(node);
    observed.current = next;
  });

  const parts: VNode[] = [];
  if (!renderAcceptedView && range) {
    for (let i = range.first; i <= range.last; ) {
      const item = win.itemAt(i);
      if (item === undefined) break;
      // Project a contiguous loaded run together. Unloaded gaps are hard boundaries:
      // once the adjacent window loads, the next render joins the two groups.
      let end = i;
      const items = [item];
      while (end + 1 <= range.last) {
        const next = win.itemAt(end + 1);
        if (next === undefined) break;
        items.push(next);
        end++;
      }
      const { rows, nodeIdByRowId } = materializeHistoryPresentation(items, shells);
      const positions = new Map(items.map((entry, index) => [entry.node_id, i + index]));
      const rowAt = new Map<number, typeof rows>();
      for (const row of rows) {
        const nodeId = nodeIdByRowId.get(row.id);
        const position = nodeId === undefined ? undefined : positions.get(nodeId);
        if (position !== undefined) rowAt.set(position, [...(rowAt.get(position) ?? []), row]);
      }
      for (let position = i; position <= end; position++) {
        if (position === liveBoundary) parts.push(<div class="live-tail" key="live">{live}</div>);
        const grouped = rowAt.get(position);
        parts.push(grouped ? <div key={position} data-o={position} data-node={win.itemAt(position)?.node_id} data-members={JSON.stringify(grouped.flatMap((row) => row.type === "steps" ? row.steps.map((step) => step.executionId) : []))} class="vrow">{grouped.map(renderRow)}</div>
          : <div key={`empty${position}`} data-o={position} />);
      }
      i = end + 1;
    }
  }

  // One parent/list owns the live slot whether its ordinal is inside or past the window.
  if (!renderAcceptedView && !parts.some(part => part.key === "live")) parts.push(<div class="live-tail" key="live">{live}</div>);

  return (
    <div class="scroll-frame">
    <div
      class="scroll"
      ref={el}
      tabIndex={0}
      onClickCapture={(e) => {
        const heading = (e.target as Element).closest<HTMLElement>(".step summary");
        if (heading && !intent.current.following) headingAnchor.current.capture(heading);
      }}
      onWheel={(e) => { if (e.deltaY < 0 && e.currentTarget.scrollHeight <= e.currentTarget.clientHeight) win.requestOlder(); intent.current.wheel(e.deltaY); if (!intent.current.following) win.following.value = false; }}
      onTouchStart={(e) => { if (e.touches[0]) { touchY.current = e.touches[0].clientY; intent.current.touchStart(e.touches[0].clientY); } }}
      onTouchMove={(e) => { if (e.touches[0]) { const y = e.touches[0].clientY; if (touchY.current !== undefined && y > touchY.current && e.currentTarget.scrollHeight <= e.currentTarget.clientHeight) win.requestOlder(); touchY.current = y; intent.current.touchMove(y); } if (!intent.current.following) win.following.value = false; }}
      onKeyDown={(e) => { if (["PageUp", "Home", "ArrowUp"].includes(e.key) && e.currentTarget.scrollHeight <= e.currentTarget.clientHeight) win.requestOlder(); intent.current.key(e.key); if (!intent.current.following) win.following.value = false; }}
      onScroll={(e) => {
        if (win.status.peek() === "loading") return;
        const b = e.currentTarget;
        tellWindow(b, rowOrigin(b), intent.current.scroll(b));
        const context = accepted ? readingContext(accepted, () => win.acceptedView.isCurrent(accepted)) : undefined;
        readingAnchor.current.capture(b, context);
      }}
    >
      {win.pathChanged.value ? <Notice tone="wait">{t("convo.pathChanged")}</Notice> : null}
      {error !== undefined ? (
        <Notice tone="bad" actions={<Button onClick={() => { win.retry(); if (win.pendingNavigation) intent.current.following = true; }}>{t("convo.retryLoad")}</Button>}>
          {t("convo.loadError", { message: error })}
        </Notice>
      ) : null}
      {win.total > 0 ? <div class="muted caption">{t("convo.total", { n: win.total })}</div> : null}
      {range && range.first > 0 ? <LoadingRows label={t("convo.loading")} rows={1} /> : null}
      <div class="vspace">{renderAcceptedView ? <conversationViewport.Provider value={viewport}>{renderAcceptedView(accepted!)}</conversationViewport.Provider> : parts}</div>
      {renderAcceptedView ? <div ref={fallbackProbe} class="conversation-height-token" aria-hidden="true" /> : null}
      {range && range.last + 1 < win.total ? <LoadingRows label={t("convo.loading")} rows={1} /> : null}
      {statusLine}
      {win.total === 0 && status === "loading" ? <LoadingRows label={t("convo.loading")} rows={5} /> : null}
      {win.total === 0 && status === "ready" ? <EmptyState role="empty.conversation" title={t("convo.empty")} body={t("convo.emptyBody")} /> : null}
    </div>
      {!win.following.value ? (
        <div class="jump-newest">
          <Button variant="primary" onClick={() => { model.senderPageSelected(); intent.current.following = true; win.jumpToEnd(); }}>{t("convo.newer")}</Button>
        </div>
      ) : null}
    </div>
  );
}
