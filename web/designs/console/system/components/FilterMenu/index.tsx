import { useId, useRef, useState } from "preact/hooks";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Menu, type MenuEntry } from "../Menu";

export function FilterMenu({ label, count, entries }: { label: string; count: number; entries: MenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"keyboard" | "pointer">("pointer");
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  return <><Button buttonRef={trigger} id={`${id}-trigger`} aria-expanded={open} aria-haspopup="menu" aria-controls={`${id}-filters`} onClick={e => { setMethod(e.detail === 0 ? "keyboard" : "pointer"); setOpen(!open); }}>
    <Icon role="sidebar.filter" size="small" />{label}{count ? ` (${count})` : null}
  </Button><Menu open={open} anchor={trigger.current} returnFocusTo={trigger.current} openMethod={method} id={`${id}-filters`} labelledBy={`${id}-trigger`} entries={entries} onClose={() => setOpen(false)} /></>;
}
