// One contiguous loaded history run. Unknown edges have indicators, never estimated space.
import type { ComponentChildren, VNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { projectConversation, type AppModel, type ConversationRow, type ConversationWindow } from "../../../ui-core/src";
import { Button, EmptyState, LoadingRows, Notice } from "../system/components";

import { measureSummaryTransition } from "./summaryAnchor";
import { measureAcceptedRows } from "./acceptedRowMeasure";
import type { WindowAcceptedSnapshot, SummaryTransitionId } from "../../../ui-core/src/window";
import { CurrentScrollSync, type ScrollViewPort } from "./scrollTransaction";
import { HeadingAnchor, ReadingAnchor, ScrollIntent, type ReadingContext } from "./scrollIntent";

export function heldRange(visible: { first: number; last: number }, total: number, held: (index: number) => boolean): { first: number; last: number } {
  const range = { ...visible };
  while (range.first > 0 && held(range.first - 1)) range.first--;
  while (range.last + 1 < total && held(range.last + 1)) range.last++;
  return range;
}

export function WindowedScroll({ model, win, renderRow, live, liveBoundary, statusLine, scrollPort, renderAcceptedView }: { model: AppModel; win: ConversationWindow; renderRow: (row: ConversationRow) => VNode; live: ComponentChildren; liveBoundary?: number; statusLine?: ComponentChildren; scrollPort?: ScrollViewPort<object>; renderAcceptedView?: (ref: WindowAcceptedSnapshot) => ComponentChildren }) {
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
  const visible = win.renderRange();
  const range = visible && heldRange(visible, win.total, (index) => win.itemAt(index) !== undefined);
  const intent = useRef(new ScrollIntent());
  const writer = useRef(new CurrentScrollSync());
  useLayoutEffect(() => () => { writer.current.dispose(); headingAnchor.current.clear(); }, []);
  const headingAnchor = useRef(new HeadingAnchor());
  const touchY = useRef<number | undefined>(undefined);
  const readingAnchor = useRef(new ReadingAnchor());

  const sourceRegistration = useRef<{ owner: ConversationWindow; id: SummaryTransitionId; revision: string | number | undefined; node: string; offset: number }>();
  const captureReading = (box: HTMLElement, context?: ReadingContext, snapshot?: WindowAcceptedSnapshot) => {
    readingAnchor.current.capture(box, context);
    if (!snapshot || !context?.isCurrent()) return;
    const source = readingAnchor.current.source(context), handle = model.handle.peek();
    if (!source || !handle) return;
    const old = sourceRegistration.current;
    // Update only a changed reader in the same source revision, not a target transaction.
    if (old?.owner === win && win.peekSummaryTransitionId() === old.id && old.revision === snapshot.revision && (old.node !== source.nodeId || old.offset !== source.offset))
      win.clearSummaryTransition(old.id);
    const id = win.beginSummaryTransition(handle, snapshot, source.nodeId, source.offset);
    if (id) sourceRegistration.current = { owner: win, id, revision: snapshot.revision, node: source.nodeId, offset: source.offset };
  };
  useLayoutEffect(() => () => {
    const owned = sourceRegistration.current;
    if (owned?.owner === win) win.clearSummaryTransition(owned.id);
  }, [win]);
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
          const changes: [number, number][] = [];
          for (const child of box.querySelectorAll<HTMLElement>("[data-o]"))
            changes.push([Number(child.dataset.o), child.getBoundingClientRect().height]);
          const measured = renderAcceptedView ? measureAcceptedRows(box, accepted!.rows) : changes;
          if (measured.length) win.measure(measured);
        },
        plan: (_ref, request) => {
          const snapshot = renderAcceptedView ? win.acceptedView.peek() : undefined;
          const context: ReadingContext | undefined = snapshot ? { revision: snapshot.revision, epoch: snapshot.epoch, capability: win.acceptedView.currentCapability,
            nodes: snapshot.rows.flatMap(row => row.node_id ? [row.node_id] : []),
            isCurrent: () => port.acceptedView.isCurrent(_ref) && win.acceptedView.isCurrent(snapshot) } : undefined;

          const coverage = snapshot && win.peekSummaryCoverage(snapshot);
          const coverageDelta = coverage ? measureSummaryTransition(box, coverage, () => context!.isCurrent()) : undefined;
          const heading = coverage ? undefined : headingAnchor.current.peek();
          const delta = coverage ? coverageDelta : heading?.delta ?? readingAnchor.current.correction(box, context);
          return {
            ownsScrollRequest: !!coverage,
            consume: () => {
              if (coverage) return coverageDelta !== undefined && context!.isCurrent() && win.consumeSummaryCoverage(snapshot!, coverage.transitionId);
              if (heading) headingAnchor.current.consume(heading);
            },
            write: () => {
              const following = intent.current.following && win.following.peek();
              if (coverage && coverageDelta !== undefined) intent.current.program(box, box.scrollTop + coverageDelta);
              else if (following) intent.current.program(box, box.scrollHeight);
              else if (delta !== undefined) intent.current.program(box, box.scrollTop + delta);
              else if (request) intent.current.program(box, request.target + start);
              else if (origin.current !== undefined && start !== origin.current)
                intent.current.program(box, box.scrollTop + start - origin.current);
              origin.current = start;
              win.view(box.scrollTop - start, box.clientHeight, intent.current.following);
            },
            capture: () => captureReading(box, context, snapshot),
          };
        },
    });
  };

  // One frame belongs to this mounted scroll root; RO delivery only invalidates it.
  const resize = useRef<ResizeObserver | undefined>(undefined);
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
    let mounted = true;
    const observer = new ResizeObserver(() => {
      if (!mounted) return;
      if (frame.current !== undefined) return;
      const owner = latest.current.port;
      const ref = owner.acceptedView.peek();
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        if (latest.current.port === owner && owner.acceptedView.isCurrent(ref)) latest.current.sync();
      });
    });
    resize.current = observer;
    return () => {
      mounted = false;
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
      const rows = projectConversation(items, shells);
      const positions = new Map(items.map((entry, index) => [entry.node_id, i + index]));
      const rowAt = new Map<number, typeof rows>();
      for (const row of rows) {
        const position = positions.get(row.id) ?? (row.id.endsWith(":commentary") ? positions.get(row.id.slice(0, -11)) : undefined);
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
        win.view(b.scrollTop - rowOrigin(b), b.clientHeight, intent.current.scroll(b));
        const snapshot = renderAcceptedView ? win.acceptedView.peek() : undefined;
        const context: ReadingContext | undefined = snapshot ? { revision: snapshot.revision, epoch: snapshot.epoch,
          capability: win.acceptedView.currentCapability, nodes: snapshot.rows.flatMap(row => row.node_id ? [row.node_id] : []),
          isCurrent: () => win.acceptedView.isCurrent(snapshot) } : undefined;
        captureReading(b, context, snapshot);
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
      <div class="vspace">{renderAcceptedView ? renderAcceptedView(accepted!) : parts}</div>
      {range && range.last + 1 < win.total ? <LoadingRows label={t("convo.loading")} rows={1} /> : null}
      {statusLine}
      {win.total === 0 && status === "loading" ? <LoadingRows label={t("convo.loading")} rows={5} /> : null}
      {win.total === 0 && status === "ready" ? <EmptyState icon="chat" title={t("convo.empty")} body={t("convo.emptyBody")} /> : null}
    </div>
      {!win.following.value ? (
        <div class="jump-newest">
          <Button variant="primary" onClick={() => { model.senderPageSelected(); intent.current.following = true; win.jumpToEnd(); }}>{t("convo.newer")}</Button>
        </div>
      ) : null}
    </div>
  );
}
