// The long-thread reader's scroll area: variable-height rows over every position of the path,
// only those near the viewport drawn, the rest a sized placeholder (docs/design/long-threads.md).
import type { ComponentChildren, VNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { projectConversation, type AppModel, type ConversationRow, type ConversationWindow } from "../../../ui-core/src";
import { Button, EmptyState, LoadingRows, Notice } from "../system/components";

import { HeadingAnchor, ScrollIntent } from "./scrollIntent";

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
  const shells = model.shells.value;
  const el = useRef<HTMLDivElement>(null);
  const visible = win.renderRange();
  const range = visible && heldRange(visible, win.total, (index) => win.itemAt(index) !== undefined);
  const intent = useRef(new ScrollIntent());
  const headingAnchor = useRef(new HeadingAnchor());

  // After each draw: report measured heights (the window corrects the offset for rows above the
  // anchor), apply the scroll it asks for, keep the bottom while following, then report the view.
  useLayoutEffect(() => {
    const box = el.current;
    if (!box) return;
    const changes: [number, number][] = [];
    for (const child of box.querySelectorAll<HTMLElement>("[data-o]"))
      changes.push([Number(child.dataset.o), child.getBoundingClientRect().height]);
    if (changes.length > 0) win.measure(changes);
    const want = win.takeScroll();
    if (win.following.peek() && intent.current.following) intent.current.program(box, box.scrollHeight);
    else if (want !== undefined) intent.current.program(box, want);
    win.view(box.scrollTop, box.clientHeight, win.following.peek() && intent.current.following);
  });

  useLayoutEffect(() => {
    const box = el.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const changes: [number, number][] = [];
      for (const child of box.querySelectorAll<HTMLElement>("[data-o]"))
        changes.push([Number(child.dataset.o), child.getBoundingClientRect().height]);
      if (changes.length) win.measure(changes);
      const want = win.takeScroll();
      const delta = headingAnchor.current.correction();
      if (win.following.peek() && intent.current.following) intent.current.program(box, box.scrollHeight);
      else if (delta !== undefined) { intent.current.program(box, box.scrollTop + delta); win.view(box.scrollTop, box.clientHeight, false); }
      else if (want !== undefined) intent.current.program(box, want);
    });
    box.querySelectorAll("[data-o], .vspace, .live-tail").forEach((row) => observer.observe(row));
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
        parts.push(grouped ? <div key={position} data-o={position} class="vrow">{grouped.map(renderRow)}</div>
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
      onClickCapture={(e) => {
        const heading = (e.target as Element).closest<HTMLElement>(".step summary");
        if (heading && !intent.current.following) headingAnchor.current.capture(heading);
      }}
      onWheel={(e) => { intent.current.wheel(e.deltaY); if (!intent.current.following) win.following.value = false; }}
      onTouchStart={(e) => { if (e.touches[0]) intent.current.touchStart(e.touches[0].clientY); }}
      onTouchMove={(e) => { if (e.touches[0]) intent.current.touchMove(e.touches[0].clientY); if (!intent.current.following) win.following.value = false; }}
      onKeyDown={(e) => { intent.current.key(e.key); if (!intent.current.following) win.following.value = false; }}
      onScroll={(e) => {
        const b = e.currentTarget;
        win.view(b.scrollTop, b.clientHeight, intent.current.scroll(b));
      }}
    >
      {win.pathChanged.value ? <Notice tone="wait">{t("convo.pathChanged")}</Notice> : null}
      {status === "error" ? (
        <Notice tone="bad" actions={<Button onClick={() => win.retry()}>{t("convo.retryLoad")}</Button>}>
          {t("convo.loadError", { message: win.error.value ?? "" })}
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
