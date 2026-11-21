import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Popover } from "../Popover";

type MenuItem = { key: string; label: string; onSelect?: () => void; href?: string; destructive?: boolean; disabled?: boolean };
type MenuEntry = MenuItem | { key: string; separator: true };

function isSeparator(entry: MenuEntry): entry is { key: string; separator: true } { return "separator" in entry; }

export function Menu({ open, anchor, entries, onClose }: { open: boolean; anchor: HTMLElement | null; entries: MenuEntry[]; onClose: () => void; children?: ComponentChildren }) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) queueMicrotask(() => menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()); }, [open]);
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const move = (delta: number) => { const list = items(); const index = list.indexOf(document.activeElement as HTMLElement); list[(index + delta + list.length) % list.length]?.focus(); };
  const available = entries.filter((entry) => isSeparator(entry) || !entry.disabled);
  return <Popover open={open} anchor={anchor} onClose={onClose} className="menu-popover">
    <div ref={menu} role="menu" onKeyDown={(event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
      else if (event.key === "Home") { event.preventDefault(); items()[0]?.focus(); }
      else if (event.key === "End") { event.preventDefault(); items().at(-1)?.focus(); }
      else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); (document.activeElement as HTMLElement)?.click(); }
    }}>
      {available.map((entry) => isSeparator(entry) ? <div key={entry.key} class="menu-separator" role="separator" /> : entry.href ? <a key={entry.key} role="menuitem" tabIndex={-1} class={entry.destructive ? "menu-item destructive" : "menu-item"} href={entry.href} onClick={onClose}>{entry.label}</a> : <button key={entry.key} type="button" role="menuitem" tabIndex={-1} class={entry.destructive ? "menu-item destructive" : "menu-item"} onClick={() => { entry.onSelect?.(); onClose(); }}>{entry.label}</button>)}
    </div>
  </Popover>;
}
