// The long-thread reader's scroll area: variable-height rows over every position of the path,
// only those near the viewport drawn, the rest a sized placeholder (docs/design/long-threads.md).
import type { ComponentChildren, VNode } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { projectConversation, type AppModel, type ConversationRow, type ConversationWindow } from "../../../ui-core/src";
import { Button, EmptyState, LoadingRows, Notice, VirtualGap, VirtualSpace } from "../system/components";

import { ScrollIntent } from "./scrollIntent";

export function WindowedScroll({ model, win, renderRow, live }: { model: AppModel; win: ConversationWindow; renderRow: (row: ConversationRow) => VNode; live: ComponentChildren }) {
  const t = model.t.value;
  win.version.value; // redraw on every change the window reports
  const status = win.status.value;
  const shells = model.shells.value;
  const el = useRef<HTMLDivElement>(null);
  const range = win.renderRange();
  const intent = useRef(new ScrollIntent());

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
    if (want !== undefined) intent.current.program(box, want);
    else if (win.following.peek() && intent.current.following) intent.current.program(box, box.scrollHeight);
    win.view(box.scrollTop, box.clientHeight, win.following.peek() && intent.current.following);
  });

  const parts: VNode[] = [];
  if (range) {
    for (let i = range.first; i <= range.last; ) {
      const item = win.itemAt(i);
      if (item === undefined) {
        let end = i;
        while (end + 1 <= range.last && win.itemAt(end + 1) === undefined) end++;
        parts.push(
          <VirtualGap key={`gap${i}`} height={win.offsetOf(end + 1) - win.offsetOf(i)}>
            <LoadingRows label={t("convo.loading")} rows={Math.min(end - i + 1, 6)} />
          </VirtualGap>,
        );
        i = end + 1;
        continue;
      }
      const row = projectConversation([item], shells)[0];
      if (row) parts.push(<div key={item.node_id ?? i} data-o={i} class="vrow">{renderRow(row)}</div>);
      i++;
    }
  }

  return (
    <div class="scroll-frame">
    <div
      class="scroll"
      ref={el}
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
      <VirtualSpace height={win.totalHeight()} top={range ? win.offsetOf(range.first) : 0}>
        {parts}
      </VirtualSpace>
      {live}
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
