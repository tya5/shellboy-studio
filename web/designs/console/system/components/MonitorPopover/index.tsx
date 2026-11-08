import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button } from "../Button";

export function MonitorPopover({ label, children, className = "", preview = false }: { label: string; children: ComponentChildren; className?: string; preview?: boolean }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const press = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("pointerdown", press); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", press); document.removeEventListener("keydown", key); };
  }, [open]);
  return <div class={`monitor-popover ${className}`} ref={root} onMouseEnter={() => { if (preview) setHover(true); }} onMouseLeave={() => setHover(false)} onFocusIn={() => { if (preview) setHover(true); }} onFocusOut={(e) => { if (!root.current?.contains(e.relatedTarget as Node)) setHover(false); }}><Button aria-expanded={open || hover} onClick={() => setOpen(!open)}>{label}</Button>{open || hover ? <div class="monitor-popover-panel" role="group" aria-label={label}>{children}</div> : null}</div>;
}
