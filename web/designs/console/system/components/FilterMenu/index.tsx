import { useId, useRef, useState } from "preact/hooks";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Menu, type MenuEntry } from "../Menu";

export function FilterMenu({ label, count, entries, onOpenChange }: { label: string; count: number; entries: MenuEntry[]; onOpenChange: (open: boolean) => void }) {
  const [open, storeOpen] = useState(false);
  const setOpen = (next: boolean) => { storeOpen(next); onOpenChange(next); };
  const [method, setMethod] = useState<"keyboard" | "pointer">("pointer");
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  return <><Button icon label={count ? `${label} (${count})` : label} title={label} buttonRef={trigger} id={`${id}-trigger`} aria-expanded={open} aria-haspopup="menu" aria-controls={`${id}-filters`} onClick={e => { setMethod(e.detail === 0 ? "keyboard" : "pointer"); setOpen(!open); }}>
    <Icon role="sidebar.filter" size="small" />{count || null}
  </Button><Menu open={open} anchor={trigger.current} returnFocusTo={trigger.current} openMethod={method} id={`${id}-filters`} labelledBy={`${id}-trigger`} entries={entries} onClose={() => setOpen(false)} /></>;
}
