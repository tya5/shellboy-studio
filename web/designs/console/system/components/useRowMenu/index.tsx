import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Menu, type MenuEntry } from "../Menu";

type RowMenuOptions = { label: string; entries: MenuEntry[] };
export function useRowMenu(options: RowMenuOptions | undefined): { open: boolean; rowHandlers: JSX.HTMLAttributes<HTMLDivElement>; trigger: ComponentChildren; menu: ComponentChildren } {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const show = (opener: HTMLElement) => { setAnchor(opener); setOpen(true); };
  const rowHandlers: JSX.HTMLAttributes<HTMLDivElement> = options ? {
    onContextMenu: (event) => { event.preventDefault(); show(event.currentTarget); },
    onKeyDown: (event) => { if (event.key === "ArrowDown") { event.preventDefault(); show(event.currentTarget); } },
  } : {};
  return {
    open,
    rowHandlers,
    trigger: options ? <span class="row-menu-trigger"><Button variant="quiet" icon label={options.label} aria-haspopup="menu" aria-expanded={open} onClick={(event) => { setAnchor(event.currentTarget); setOpen((value) => !value); }}><Icon name="more" small /></Button></span> : null,
    menu: options ? <Menu open={open} anchor={anchor} entries={options.entries} onClose={() => setOpen(false)} /> : null,
  };
}
