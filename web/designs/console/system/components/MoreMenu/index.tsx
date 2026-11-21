import { useEffect, useId, useRef, useState } from "preact/hooks";
import { Icon, type IconName } from "../Icon";

/** The last phone tab: views that don't earn a tab of their own. */
export function MoreMenu({ label, items }: { label: string; items: { key: string; href: string; icon: IconName; label: string; current: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = `more-menu-${useId()}`;
  useEffect(() => {
    if (!open) return;
    const press = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", press);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div class="more-tab" ref={root} onFocusOut={(event) => { if (!root.current?.contains(event.relatedTarget as Node)) setOpen(false); }}>
      <button ref={trigger} type="button" class="nav-item" aria-controls={panelId} aria-expanded={open} aria-current={items.some((i) => i.current) ? "page" : undefined} onClick={() => setOpen(!open)}>
        <Icon name="menu" />
        {label}
      </button>
      {open ? (
        <div id={panelId} class="more-panel">
          {items.map((i) => (
            <a key={i.key} class="nav-item" href={i.href} aria-current={i.current ? "page" : undefined} onClick={() => setOpen(false)}>
              <Icon name={i.icon} />
              {i.label}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
