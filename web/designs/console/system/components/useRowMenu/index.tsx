import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Menu, type MenuEntry } from "../Menu";

type RowMenuOptions = { label: string; entries: MenuEntry[] };
export function useRowMenu(options: RowMenuOptions | undefined): { open: boolean; rowHandlers: JSX.HTMLAttributes<HTMLDivElement>; trigger: ComponentChildren; menu: ComponentChildren } {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [returnFocusTo, setReturnFocusTo] = useState<HTMLElement | null>(null);
  const show = (placement: HTMLElement) => {
    setAnchor(placement);
    setReturnFocusTo(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setOpen(true);
  };
  const rowHandlers: JSX.HTMLAttributes<HTMLDivElement> = options ? {
    onContextMenu: (event) => { event.preventDefault(); show(event.currentTarget); },
    onKeyDown: (event) => { if (event.key === "ArrowDown") { event.preventDefault(); show(event.currentTarget); } },
  } : {};
  return {
    open,
    rowHandlers,
    trigger: options ? <span class="row-menu-trigger"><Button variant="quiet" icon label={options.label} aria-haspopup="menu" aria-expanded={open} onClick={(event) => {
      if (open) setOpen(false);
      else show(event.currentTarget);
    }}><Icon name="more" small /></Button></span> : null,
    menu: options ? <Menu open={open} anchor={anchor} returnFocusTo={returnFocusTo} entries={options.entries} onClose={() => setOpen(false)} /> : null,
  };
}
