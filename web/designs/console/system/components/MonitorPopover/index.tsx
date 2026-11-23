import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button } from "../Button";

export function MonitorPopover({ label, children, className = "", preview = false, ghost = false, content, controlled }: { label: string; children: ComponentChildren; className?: string; preview?: boolean; /** Draw the trigger as a ghost button (design system v2). */ ghost?: boolean; /** Trigger content when it is richer than `label`. */ content?: ComponentChildren; controlled?: { open: boolean; toggle: () => void; close: () => void; panelClass: string; panelLabel: string } }) {
  const [localOpen, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const open = controlled?.open ?? localOpen;
  const close = controlled?.close;
  useLayoutEffect(() => {
    if (!open && !hover) return;
    const press = (e: Event) => { if (!root.current?.contains(e.target as Node)) { if (close) close(); else setOpen(false); } };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setHover(false); if (open) { if (close) close(); else setOpen(false); root.current?.querySelector("button")?.focus(); } } };
    document.addEventListener("pointerdown", press); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", press); document.removeEventListener("keydown", key); };
  }, [open, hover, close]);
  return <div class={`monitor-popover ${className}`} ref={root} onMouseEnter={() => { if (preview) setHover(true); }} onMouseLeave={() => setHover(false)} onFocusIn={() => { if (preview) setHover(true); }} onFocusOut={(e) => { if (!root.current?.contains(e.relatedTarget as Node)) setHover(false); }}><Button variant={ghost ? "ghost" : undefined} aria-expanded={open || hover} aria-haspopup={controlled ? "dialog" : undefined} onClick={() => controlled ? controlled.toggle() : setOpen(!open)}>{content ?? <span>{label}</span>}</Button>{open || hover ? <div class={controlled?.panelClass ?? "monitor-popover-panel"} role={controlled ? "dialog" : "group"} aria-label={controlled?.panelLabel ?? label}>{children}</div> : null}</div>;
}
