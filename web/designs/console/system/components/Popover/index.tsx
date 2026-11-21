import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";

type Point = { left: number; top: number; maxHeight: number };

function tokenPixels(name: string, fallback: number): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  useLayoutEffect(() => {
    if (!open || !anchor) { setPoint(undefined); return; }
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const margin = tokenPixels("--space-12", 12);
      const viewportHeight = window.innerHeight;
      const panelHeight = panel.current?.getBoundingClientRect().height ?? 0;
      const below = viewportHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const top = below >= panelHeight || below >= above ? rect.bottom : Math.max(margin, rect.top - Math.min(panelHeight, above));
      const left = Math.max(margin, rect.right - tokenPixels("--size-details", 340));
      setPoint({ left, top, maxHeight: Math.max(1, viewportHeight - top - margin) });
    };
    place();
    addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => { removeEventListener("resize", place); document.removeEventListener("scroll", place, true); };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && event.target !== anchorRef.current) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" || event.key === "Tab") { onClose(); queueMicrotask(() => anchorRef.current?.focus()); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open, onClose]);

  if (!open || !point) return null;
  const style: JSX.CSSProperties = { left: `${point.left}px`, top: `${point.top}px`, maxHeight: `${point.maxHeight}px` };
  return createPortal(<div ref={panel} class={`popover ${className}`.trim()} style={style}>{children}</div>, document.body);
}
