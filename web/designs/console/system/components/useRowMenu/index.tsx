import type { ComponentChildren, JSX } from "preact";
import { useId, useState } from "preact/hooks";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { tabStops } from "../../focus";
import { Menu, type MenuEntry } from "../Menu";

type RowMenuOptions = { label: string; entries: MenuEntry[] };
export function useRowMenu(options: RowMenuOptions | undefined): { open: boolean; rowHandlers: JSX.HTMLAttributes<HTMLDivElement>; trigger: ComponentChildren; menu: ComponentChildren } {
  const [open, setOpen] = useState(false);
  const [openMethod, setOpenMethod] = useState<"pointer" | "keyboard">("pointer");
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(null);
  const id = useId();
  const triggerId = `row-menu-trigger-${id}`;
  const menuId = `row-menu-${id}`;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [returnFocusTo, setReturnFocusTo] = useState<HTMLElement | null>(null);
  const show = (placement: HTMLElement, returnTo: HTMLElement | null) => {
    setAnchor(placement);
    setReturnFocusTo(returnTo);
    setOpen(true);
  };
  const rowHandlers: JSX.HTMLAttributes<HTMLDivElement> = options ? {
    onContextMenu: (event) => { event.preventDefault(); setOpenMethod("pointer"); setPointerPosition({ x: event.clientX, y: event.clientY }); show(event.currentTarget, document.activeElement as HTMLElement | null); },
    onKeyDown: (event) => { if (event.key === "ArrowDown") { event.preventDefault(); setOpenMethod("keyboard"); setPointerPosition(null); show(event.currentTarget, document.activeElement as HTMLElement | null); } },
  } : {};
  const tabExit = (backward: boolean) => {
    const row = anchor?.closest<HTMLElement>(".list-row");
    if (!row?.isConnected) return;
    const scope = row.closest('dialog[open],[aria-modal="true"]') ?? row.ownerDocument.body;
    const direction = backward ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
    const stops = tabStops(scope).filter(node => !row.contains(node) && !!(row.compareDocumentPosition(node) & direction));
    return backward ? stops.at(-1) : stops[0];
  };
  return {
    open,
    rowHandlers,
    trigger: options ? <span class="row-menu-trigger"><Button variant="ghost" icon label={options.label} id={triggerId} aria-controls={menuId} aria-haspopup="menu" aria-expanded={open} onClick={(event) => {
      if (open) setOpen(false);
      else { setOpenMethod(event.detail === 0 ? "keyboard" : "pointer"); setPointerPosition(null); show(event.currentTarget, event.currentTarget); }
    }}><Icon role="row.menu" size="small" /></Button></span> : null,
    menu: options ? <Menu open={open} anchor={anchor} returnFocusTo={returnFocusTo} entries={options.entries} tabExit={tabExit} onClose={() => setOpen(false)} id={menuId} labelledBy={triggerId} openMethod={openMethod} pointerPosition={pointerPosition} /> : null,
  };
}
