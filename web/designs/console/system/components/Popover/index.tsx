import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";

type Point = { left: number; top: number; maxHeight: number };

function tokenPixels(name: string): number {
  const parsed = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function Popover({ open, anchor, onClose, children, className = "" }: {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ComponentChildren;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<Point>();
  const opener = useRef<HTMLElement | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  useLayoutEffect(() => {
    if (!open) { opener.current = null; setPoint(undefined); return; }
    if (!opener.current) opener.current = anchor;
    if (!anchor) { setPoint(undefined); return; }
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = tokenPixels("--space-12");
      const viewportWidth = window.innerWidth;
      const panelRect = panel.current?.getBoundingClientRect();
      if (!panelRect) return;
      const width = panelRect.width;
      const height = panelRect.height;
      const viewportHeight = window.innerHeight;
      const right = Math.min(viewportWidth - margin, rect.right);
      const left = Math.max(margin, right - width);
      const below = viewportHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const top = below >= height || below >= above ? rect.bottom : Math.max(margin, rect.top - Math.min(height, above));
      setPoint({ left: Math.min(left, viewportWidth - margin - width), top, maxHeight: Math.max(1, viewportHeight - top - margin) });
    };
    place();
    addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const restore = () => queueMicrotask(() => opener.current?.focus());
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { onClose(); restore(); } else if (event.key === "Tab") onClose(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open, onClose]);

  if (!open) return null;
  const style: JSX.CSSProperties = point ? { left: `${point.left}px`, top: `${point.top}px`, maxHeight: `${point.maxHeight}px` } : { visibility: "hidden" };
  return createPortal(<div ref={panel} class={`popover ${className}`.trim()} style={style}>{children}</div>, document.body);
}
