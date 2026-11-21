import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Menu, type MenuEntry } from "../Menu";

type RowMenuOptions = { label: string; entries: MenuEntry[] };
export function useRowMenu(options: RowMenuOptions | undefined): { open: boolean; rowHandlers: JSX.HTMLAttributes<HTMLDivElement>; trigger: ComponentChildren; menu: ComponentChildren } {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const openMenu = () => { setOpen(true); };
  const rowHandlers: JSX.HTMLAttributes<HTMLDivElement> = options ? {
    onContextMenu: (event) => { event.preventDefault(); openMenu(); },
    onKeyDown: (event) => { if (event.key === "ArrowDown") { event.preventDefault(); openMenu(); } },
  } : {};
  return {
    open,
    rowHandlers,
    trigger: options ? <span class="row-menu-trigger"><Button ref={button} icon label={options.label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Icon name="more" small /></Button></span> : null,
    menu: options ? <Menu open={open} anchor={button.current} entries={options.entries} onClose={() => setOpen(false)} /> : null,
  };
}
