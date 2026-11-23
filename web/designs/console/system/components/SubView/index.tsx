import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../Icon";
import type { ComponentChildren } from "preact";
import { SectionNav, type SectionNavItem } from "../SectionNav";

/**
 * A view with a second-level menu: section list beside one pane. The pane is keyed by section,
 * so switching starts it at the top; state that must survive a switch belongs in ui-core.
 */
export function SubView({ title, items, children, groupedNav, searchable, close, className }: { title: string; items: SectionNavItem[]; children: ComponentChildren; groupedNav?: boolean; searchable?: boolean; className?: string; close?: { href: string; label: string } }) {
  const pane = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ id: string }>();
  const section = items.find((item) => item.current)?.key;
  useEffect(() => {
    if (!result) return;
    const label = [...(pane.current?.querySelectorAll("[data-setting-id]") ?? [])].find((node) => node.getAttribute("data-setting-id") === result.id);
    if (!label) return;
    label.setAttribute("data-highlighted", "");
    label.scrollIntoView?.({ block: "nearest" });
    const clear = () => label.removeAttribute("data-highlighted");
    const timeout = setTimeout(clear, 2000);
    return () => { clearTimeout(timeout); clear(); };
  }, [result, section]);
  useEffect(() => {
    if (!close) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) window.location.hash = close.href.slice(1); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [close?.href]);
  return (
    <div class={`subview${close ? " subview-closable" : ""}${className ? ` ${className}` : ""}`}>
      {close ? <header class="subview-heading"><span>{title} / {items.find((item) => item.current)?.label}</span><a class="btn link" href={close.href} aria-label={close.label}><Icon role="settings.close" /></a></header> : null}
      <div class="subview-nav">
        <SectionNav title={title} items={items} grouped={groupedNav} searchable={searchable} onResult={(id) => setResult(id ? { id } : undefined)} />
      </div>
      <div class="subview-main" key={section} ref={pane}>
        {children}
      </div>
    </div>
  );
}
