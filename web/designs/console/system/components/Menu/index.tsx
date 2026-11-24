import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { Popover } from "../Popover";
import { Icon, type IconRole } from "../Icon";

export type MenuItem = { key: string; label: string; icon?: IconRole; /** Present for a toggle item (`menuitemcheckbox`); true shows the check. */ checked?: boolean; onSelect?: (focusReturn: HTMLElement | null, placementAnchor: HTMLElement | null) => void; href?: string; destructive?: boolean; disabled?: boolean; keepOpen?: boolean };
export type MenuEntry = MenuItem | { key: string; separator: true };

export const isMenuOpenKey = (key: string): boolean => key === "ArrowDown" || key === "Enter" || key === " ";

function isSeparator(entry: MenuEntry): entry is { key: string; separator: true } { return "separator" in entry; }

export function Menu({ open, anchor, returnFocusTo, entries, onClose, tabExit, id, labelledBy, openMethod = "pointer", pointerPosition }: { open: boolean; anchor: HTMLElement | null; returnFocusTo?: HTMLElement | null; entries: MenuEntry[]; onClose: () => void; tabExit?: (backward: boolean) => HTMLElement | undefined; id: string; labelledBy: string; openMethod?: "pointer" | "keyboard"; pointerPosition?: { x: number; y: number } | null; children?: ComponentChildren }) {
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
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemcheckbox"]') ?? [])];
  const focused = useRef<{ node: HTMLElement; index: number }>();
  useLayoutEffect(() => {
    if (!open) { focused.current = undefined; return; }
    const claim = focused.current;
    if (claim && !menu.current?.contains(claim.node) && document.activeElement === document.body) {
      const list = items();
      (list[Math.min(claim.index, list.length - 1)] ?? menu.current)?.focus();
    } else if (claim && menu.current?.contains(claim.node)) {
      claim.index = items().indexOf(claim.node);
    }
  });
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
  // One icon column for every item as soon as any item has an icon or a check, so all labels share a left edge.
  const column = available.some((entry) => !isSeparator(entry) && (entry.icon !== undefined || entry.checked !== undefined));
  const lead = (entry: MenuItem) => !column ? null : <span class="menu-item-icon">{entry.checked ? <Icon role="menu.checked" size="menu" /> : entry.checked === undefined && entry.icon ? <Icon role={entry.icon} size="menu" /> : null}</span>;
  return <Popover open={open} anchor={anchor} returnFocusTo={returnFocusTo} onClose={onClose} className="menu-popover" pointerPosition={pointerPosition}>
    <div ref={menu} id={id} role="menu" aria-labelledby={labelledBy} tabIndex={-1} onFocusIn={event => {
      const node = event.target as HTMLElement;
      const index = items().indexOf(node);
      focused.current = index < 0 ? undefined : { node, index };
    }} onKeyDown={(event) => {
      if (event.key === "Tab" && tabExit) {
        const next = tabExit(event.shiftKey);
        if (next) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          next.focus();
        }
      }
      else if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
      else if (event.key === "Home" || event.key === "PageUp") { event.preventDefault(); items()[0]?.focus(); }
      else if (event.key === "End" || event.key === "PageDown") { event.preventDefault(); items().at(-1)?.focus(); }
      else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); (document.activeElement as HTMLElement)?.click(); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) typeTo(event.key);
    }}>
      {available.map((entry) => isSeparator(entry) ? <div key={entry.key} class="menu-separator" role="separator" /> : entry.href ? <a key={entry.key} role="menuitem" tabIndex={-1} class={entry.destructive ? "menu-item menu-item-destructive" : "menu-item"} href={entry.href} onClick={() => { onClose(); document.getElementById(labelledBy)?.focus(); }}>{lead(entry)}<span>{entry.label}</span></a> : <button key={entry.key} type="button" role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={entry.checked} tabIndex={-1} class={entry.destructive ? "menu-item menu-item-destructive" : "menu-item"} onClick={() => { entry.onSelect?.(returnFocusTo ?? anchor, anchor); if (!entry.keepOpen) { onClose(); document.getElementById(labelledBy)?.focus(); } }}>{lead(entry)}<span>{entry.label}</span></button>)}
    </div>
  </Popover>;
}
