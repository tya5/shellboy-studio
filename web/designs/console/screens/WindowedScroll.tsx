// One contiguous loaded history run. Unknown edges have indicators, never estimated space.
import type { ComponentChildren, VNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { projectConversation, type AppModel, type ConversationRow, type ConversationWindow } from "../../../ui-core/src";
import { Button, EmptyState, LoadingRows, Notice } from "../system/components";

import { HeadingAnchor, ReadingAnchor, ScrollIntent } from "./scrollIntent";

export function heldRange(visible: { first: number; last: number }, total: number, held: (index: number) => boolean): { first: number; last: number } {
  const range = { ...visible };
  while (range.first > 0 && held(range.first - 1)) range.first--;
  while (range.last + 1 < total && held(range.last + 1)) range.last++;
  return range;
}

export function WindowedScroll({ model, win, renderRow, live, liveBoundary, statusLine }: { model: AppModel; win: ConversationWindow; renderRow: (row: ConversationRow) => VNode; live: ComponentChildren; liveBoundary?: number; statusLine?: ComponentChildren }) {
  const t = model.t.value;
  win.version.value; // redraw on every change the window reports
  const status = win.status.value;
  const error = win.error.value;
  const shells = model.shells.value;
  const el = useRef<HTMLDivElement>(null);
  const visible = win.renderRange();
  const range = visible && heldRange(visible, win.total, (index) => win.itemAt(index) !== undefined);
  const intent = useRef(new ScrollIntent());
  const headingAnchor = useRef(new HeadingAnchor());
  const touchY = useRef<number | undefined>(undefined);
  const readingAnchor = useRef(new ReadingAnchor());

  const origin = useRef<number | undefined>(undefined);
  const rowOrigin = (box: HTMLElement): number => {
    const rows = box.querySelector<HTMLElement>(".vspace");
    return rows ? rows.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientTop : 0;
  };
  // Model coordinates start at the measured rows, excluding captions and edge indicators.
  const sync = () => {
    const box = el.current;
    if (!box || win.status.peek() === "loading") return;
    const start = rowOrigin(box);
    if (win.pendingNavigation) {
      win.view(box.scrollTop - start, box.clientHeight, intent.current.following);
      return;
    }
    const changes: [number, number][] = [];
    for (const child of box.querySelectorAll<HTMLElement>("[data-o]"))
      changes.push([Number(child.dataset.o), child.getBoundingClientRect().height]);
    if (changes.length) win.measure(changes);
    const want = win.takeScroll();
    const delta = headingAnchor.current.correction() ?? readingAnchor.current.correction(box);
    const following = intent.current.scroll(box) && win.following.peek();
    if (following) intent.current.program(box, box.scrollHeight);
    else if (delta !== undefined) intent.current.program(box, box.scrollTop + delta);
    else if (want !== undefined) intent.current.program(box, want + start);
    else if (origin.current !== undefined && start !== origin.current)
      intent.current.program(box, box.scrollTop + start - origin.current);
    origin.current = start;
    win.view(box.scrollTop - start, box.clientHeight, intent.current.following);
    readingAnchor.current.capture(box);
  };

  useLayoutEffect(sync);
  useLayoutEffect(() => {
    const box = el.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    box.querySelectorAll("[data-o], .vspace, .live-tail").forEach((row) => observer.observe(row));
    observer.observe(box);
    return () => observer.disconnect();
  });

  const parts: VNode[] = [];
  if (range) {
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
        readingAnchor.current.capture(b);
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
      <div class="vspace">{parts}</div>
      {range && range.last + 1 < win.total ? <LoadingRows label={t("convo.loading")} rows={1} /> : null}
      {(liveBoundary === undefined || !range || liveBoundary > range.last) ? <div class="live-tail">{live}</div> : null}
      {statusLine}
      {win.total === 0 && status === "loading" ? <LoadingRows label={t("convo.loading")} rows={5} /> : null}
      {win.total === 0 && status === "ready" ? <EmptyState icon="chat" title={t("convo.empty")} body={t("convo.emptyBody")} /> : null}
    </div>
      {!win.following.value ? (
        <div class="jump-newest">
          <Button variant="primary" onClick={() => { intent.current.following = true; win.jumpToEnd(); }}>{t("convo.newer")}</Button>
        </div>
      ) : null}
    </div>
  );
}
