import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

const CONTROLS = "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]";

/**
 * The one page title of a view, an optional one-line description, page actions at the end of the title row, and an
 * optional toolbar row below. With `toolbarLabel` the toolbar is a WAI-ARIA toolbar: one Tab stop, arrow keys move
 * between its controls (except inside a text field, which keeps its own arrow keys).
 */
export function PageHeader({ title, description, actions, toolbar, toolbarLabel, count }: { title: string; description?: ComponentChildren; actions?: ComponentChildren; toolbar?: ComponentChildren; toolbarLabel?: string; count?: ComponentChildren }) {
  const bar = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const controls = () => [...(bar.current?.querySelectorAll<HTMLElement>(CONTROLS) ?? [])];
  useLayoutEffect(() => {
    if (!toolbarLabel) return;
    const list = controls();
    current.current = Math.min(current.current, Math.max(0, list.length - 1));
    list.forEach((control, index) => { control.tabIndex = index === current.current ? 0 : -1; });
  });
  const roving: JSX.HTMLAttributes<HTMLDivElement> = toolbarLabel ? {
    role: "toolbar",
    "aria-label": toolbarLabel,
    onFocusIn: (event: JSX.TargetedFocusEvent<HTMLDivElement>) => {
      const list = controls();
      const index = list.indexOf(event.target as HTMLElement);
      if (index < 0) return;
      current.current = index;
      list.forEach((control, i) => { control.tabIndex = i === index ? 0 : -1; });
    },
    onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.matches("input,select,textarea")) return;
      const list = controls();
      const index = list.indexOf(target);
      if (index < 0) return;
      const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? list.length - 1 : undefined;
      if (next === undefined) return;
      event.preventDefault();
      list[Math.max(0, Math.min(list.length - 1, next))]?.focus();
    },
  } : {};
  return (
    <header class="page-header">
      <div class="page-header-top">
        <div class="page-header-copy">
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div class="page-header-actions">{actions}</div> : null}
      </div>
      {toolbar || count ? (
        <div ref={bar} class="page-header-toolbar" {...roving}>
          {toolbar}
          {count ? <span class="page-header-count">{count}</span> : null}
        </div>
      ) : null}
    </header>
  );
}
