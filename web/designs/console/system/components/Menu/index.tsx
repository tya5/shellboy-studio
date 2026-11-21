import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Popover } from "../Popover";
import { Icon, type IconRole } from "../Icon";

export type MenuItem = { key: string; label: string; icon?: IconRole; onSelect?: (focusReturn: HTMLElement | null, placementAnchor: HTMLElement | null) => void; href?: string; destructive?: boolean; disabled?: boolean };
export type MenuEntry = MenuItem | { key: string; separator: true };

function isSeparator(entry: MenuEntry): entry is { key: string; separator: true } { return "separator" in entry; }

export function Menu({ open, anchor, returnFocusTo, entries, onClose, id, labelledBy, openMethod = "pointer", pointerPosition }: { open: boolean; anchor: HTMLElement | null; returnFocusTo?: HTMLElement | null; entries: MenuEntry[]; onClose: () => void; id: string; labelledBy: string; openMethod?: "pointer" | "keyboard"; pointerPosition?: { x: number; y: number } | null; children?: ComponentChildren }) {
  const menu = useRef<HTMLDivElement>(null);
  const typeahead = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!open) { typeahead.current = ""; return; }
    queueMicrotask(() => (openMethod === "keyboard" ? items()[0] : menu.current)?.focus());
    return () => {
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = undefined;
      typeahead.current = "";
    };
  }, [open, openMethod]);
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const move = (delta: number) => { const list = items(); const index = list.indexOf(document.activeElement as HTMLElement); const target = index < 0 ? (delta < 0 ? list.length - 1 : 0) : Math.max(0, Math.min(list.length - 1, index + delta)); list[target]?.focus(); };
  const typeTo = (key: string) => {
    const character = key.toLocaleLowerCase();
    const repeatedInitial = typeahead.current.length > 0 && [...typeahead.current].every((value) => value === character);
    typeahead.current = repeatedInitial ? character : typeahead.current + character;
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
      {available.map((entry) => isSeparator(entry) ? <div key={entry.key} class="menu-separator" role="separator" /> : entry.href ? <a key={entry.key} role="menuitem" tabIndex={-1} class={entry.destructive ? "menu-item menu-item-destructive" : "menu-item"} href={entry.href} onClick={() => { onClose(); document.getElementById(labelledBy)?.focus(); }}>{entry.icon ? <span class="menu-item-icon"><Icon role={entry.icon} size="menu" /></span> : null}<span>{entry.label}</span></a> : <button key={entry.key} type="button" role="menuitem" tabIndex={-1} class={entry.destructive ? "menu-item menu-item-destructive" : "menu-item"} onClick={() => { entry.onSelect?.(returnFocusTo ?? anchor, anchor); onClose(); document.getElementById(labelledBy)?.focus(); }}>{entry.icon ? <span class="menu-item-icon"><Icon role={entry.icon} size="menu" /></span> : null}<span>{entry.label}</span></button>)}
    </div>
  </Popover>;
}
