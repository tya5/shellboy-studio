import type { ComponentChildren, JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Menu, type MenuEntry } from "../Menu";

type RowMenuOptions = { label: string; entries: MenuEntry[] };
const listeners = new Map<symbol, (open: boolean) => void>();
let activeRowMenu: symbol | null = null;

function activateRowMenu(owner: symbol | null): void {
  activeRowMenu = owner;
  for (const [key, notify] of listeners) notify(key === owner);
}

export function useRowMenu(options: RowMenuOptions | undefined): { open: boolean; rowHandlers: JSX.HTMLAttributes<HTMLDivElement>; trigger: ComponentChildren; menu: ComponentChildren } {
  const owner = useMemo(() => Symbol("row-menu"), []);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [triggerContainer, setTriggerContainer] = useState<HTMLElement | null>(null);
  const triggerElement = triggerContainer?.firstElementChild as HTMLButtonElement | null;
  useEffect(() => {
    listeners.set(owner, setOpen);
    setOpen(activeRowMenu === owner);
    return () => {
      listeners.delete(owner);
      if (activeRowMenu === owner) activateRowMenu(null);
    };
  }, [owner]);

  const show = (placement: HTMLElement, trigger: HTMLElement | null) => {
    setAnchor(placement);
    setFocusReturnTarget(trigger);
    activateRowMenu(owner);
  };
  const [focusReturnTarget, setFocusReturnTarget] = useState<HTMLElement | null>(null);
  const rowHandlers: JSX.HTMLAttributes<HTMLDivElement> = options ? {
    onContextMenu: (event) => { event.preventDefault(); show(event.currentTarget, triggerElement); },
    onKeyDown: (event) => { if (event.key === "ArrowDown") { event.preventDefault(); show(event.currentTarget, triggerElement); } },
  } : {};
  return {
    open,
    rowHandlers,
    trigger: options ? <span class="row-menu-trigger" ref={setTriggerContainer}><Button variant="quiet" icon label={options.label} aria-haspopup="menu" aria-expanded={open} onClick={(event) => {
      if (activeRowMenu === owner) activateRowMenu(null);
      else show(event.currentTarget, event.currentTarget);
    }}><Icon name="more" small /></Button></span> : null,
    menu: options ? <Menu open={open} anchor={anchor} returnFocusTo={focusReturnTarget} entries={options.entries} onClose={() => activateRowMenu(null)} /> : null,
  };
}
