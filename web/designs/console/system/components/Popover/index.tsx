import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";

export type PanelPlacement = { left: number; top: number; maxHeight: number };

type Rect = { left: number; right: number; top: number; bottom: number };
type Size = { width: number; height: number };
type Viewport = { width: number; height: number };

export function placePanel(anchor: Rect, panel: Size, viewport: Viewport, gutter: number): PanelPlacement {
  const left = Math.max(gutter, Math.min(anchor.right - panel.width, viewport.width - gutter - panel.width));
  const below = viewport.height - anchor.bottom - gutter;
  const above = anchor.top - gutter;
  const top = below >= panel.height || below >= above ? anchor.bottom : Math.max(gutter, anchor.top - Math.min(panel.height, above));
  return { left, top, maxHeight: Math.max(1, viewport.height - top - gutter) };
}

function tokenPixels(name: string): number {
  const parsed = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function Popover({ open, anchor, returnFocusTo, onClose, children, className = "" }: {
  open: boolean;
  anchor: HTMLElement | null;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  children: ComponentChildren;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<PanelPlacement>();

  useLayoutEffect(() => {
    if (!open) { setPoint(undefined); return; }
    if (!anchor) { setPoint(undefined); return; }
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = tokenPixels("--space-12");
      const panelRect = panel.current?.getBoundingClientRect();
      if (!panelRect) return;
      setPoint(placePanel(rect, panelRect, { width: window.innerWidth, height: window.innerHeight }, margin));
    };
    place();
    addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose(); };
    const focusTarget = returnFocusTo === undefined ? anchor : returnFocusTo;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { onClose(); focusTarget?.focus(); } else if (event.key === "Tab") onClose(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open, onClose, anchor, returnFocusTo]);

  if (!open) return null;
  const style: JSX.CSSProperties = point ? { left: `${point.left}px`, top: `${point.top}px`, maxHeight: `${point.maxHeight}px` } : { visibility: "hidden" };
  return createPortal(<div ref={panel} class={`popover ${className}`.trim()} style={style}>{children}</div>, document.body);
}
