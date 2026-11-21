import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Popover } from "../Popover";

export type MenuItem = { key: string; label: string; onSelect?: () => void; href?: string; destructive?: boolean; disabled?: boolean };
export type MenuEntry = MenuItem | { key: string; separator: true };

function isSeparator(entry: MenuEntry): entry is { key: string; separator: true } { return "separator" in entry; }

export function Menu({ open, anchor, returnFocusTo, entries, onClose, id, labelledBy, openMethod = "pointer", pointerPosition }: { open: boolean; anchor: HTMLElement | null; returnFocusTo?: HTMLElement | null; entries: MenuEntry[]; onClose: () => void; id: string; labelledBy: string; openMethod?: "pointer" | "keyboard"; pointerPosition?: { x: number; y: number } | null; children?: ComponentChildren }) {
  const menu = useRef<HTMLDivElement>(null);
  const typeahead = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => (openMethod === "keyboard" ? items()[0] : menu.current)?.focus());
    return () => { if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current); };
  }, [open, openMethod]);
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const move = (delta: number) => { const list = items(); const index = list.indexOf(document.activeElement as HTMLElement); list[Math.max(0, Math.min(list.length - 1, index + delta))]?.focus(); };
  const typeTo = (key: string) => {
    typeahead.current += key.toLocaleLowerCase();
    if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    typeaheadTimer.current = setTimeout(() => { typeahead.current = ""; }, 500);
    const list = items();
    const start = list.indexOf(document.activeElement as HTMLElement);
    const ordered = [...list.slice(start + 1), ...list.slice(0, start + 1)];
    ordered.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(typeahead.current))?.focus();
  };
  const available = entries.filter((entry) => isSeparator(entry) || !entry.disabled);
  return <Popover open={open} anchor={anchor} returnFocusTo={returnFocusTo} onClose={onClose} className="menu-popover" pointerPosition={pointerPosition}>
    <div ref={menu} id={id} role="menu" aria-labelledby={labelledBy} tabIndex={-1} onKeyDown={(event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
      else if (event.key === "Home" || event.key === "PageUp") { event.preventDefault(); items()[0]?.focus(); }
      else if (event.key === "End" || event.key === "PageDown") { event.preventDefault(); items().at(-1)?.focus(); }
      else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); (document.activeElement as HTMLElement)?.click(); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) typeTo(event.key);
    }}>
      {available.map((entry) => isSeparator(entry) ? <div key={entry.key} class="menu-separator" role="separator" /> : entry.href ? <a key={entry.key} role="menuitem" tabIndex={-1} class={entry.destructive ? "menu-item destructive" : "menu-item"} href={entry.href} onClick={() => { onClose(); document.getElementById(labelledBy)?.focus(); }}>{entry.label}</a> : <button key={entry.key} type="button" role="menuitem" tabIndex={-1} class={entry.destructive ? "menu-item destructive" : "menu-item"} onClick={() => { entry.onSelect?.(); onClose(); document.getElementById(labelledBy)?.focus(); }}>{entry.label}</button>)}
    </div>
  </Popover>;
}
