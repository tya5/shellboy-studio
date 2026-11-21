import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";

export type PanelPlacement = { left: number; top: number; maxHeight: number };

type Rect = { left: number; right: number; top: number; bottom: number };
type Size = { width: number; height: number };
type Viewport = { width: number; height: number };

export function placePointerMenu(point: { x: number; y: number }, panel: Size, viewport: Viewport, gutter: number): PanelPlacement {
  const right = point.x + panel.width;
  const left = right <= viewport.width - gutter ? point.x : Math.max(gutter, point.x - panel.width);
  const top = Math.max(gutter, Math.min(point.y, viewport.height - gutter - panel.height));
  return { left, top, maxHeight: Math.max(1, viewport.height - top - gutter) };
}

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

export function Popover({ open, anchor, returnFocusTo, onClose, children, className = "", pointerPosition = null }: {
  open: boolean;
  anchor: HTMLElement | null;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  children: ComponentChildren;
  className?: string;
  pointerPosition?: { x: number; y: number } | null;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [point, setPoint] = useState<PanelPlacement>();

  useEffect(() => {
    opener.current = open ? (returnFocusTo === undefined ? anchor : returnFocusTo) : null;
  }, [open]);

  useLayoutEffect(() => {
    if (!open) { setPoint(undefined); return; }
    if (!anchor && !pointerPosition) { setPoint(undefined); return; }
    const place = () => {
      if (pointerPosition) {
        const margin = tokenPixels("--space-12");
        const panelRect = panel.current?.getBoundingClientRect();
        if (!panelRect) return;
        setPoint(placePointerMenu(pointerPosition, panelRect, { width: window.innerWidth, height: window.innerHeight }, margin));
        return;
      }
      if (!anchor) return;
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
  }, [open, anchor, pointerPosition?.x, pointerPosition?.y]);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { const target = opener.current; onClose(); target?.focus(); } else if (event.key === "Tab") onClose(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); };
  }, [open, onClose]);

  const consumeOutsidePointerDown = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const consumeOutsideClick = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  if (!open) return null;
  const style: JSX.CSSProperties = point ? { left: `${point.left}px`, top: `${point.top}px`, maxHeight: `${point.maxHeight}px` } : { visibility: "hidden" };
  return createPortal(<>
    <div class="popover-dismiss-layer" aria-hidden="true" onPointerDown={consumeOutsidePointerDown} onClick={consumeOutsideClick} onAuxClick={consumeOutsideClick} onContextMenu={consumeOutsideClick} />
    {open ? <div ref={panel} tabIndex={-1} class={`popover-panel ${className}`.trim()} style={style}>{children}</div> : null}
  </>, document.body);
}
