import { useState } from "preact/hooks";
import { Icon, type IconRole } from "../Icon";
import { Field } from "../Field";

export interface SectionNavItem {
  key: string;
  href: string;
  role: IconRole;
  label: string;
  current: boolean;
  description?: string;
  group?: string;
  groupRole?: IconRole;
  searchTerms?: readonly string[];
}

export function SectionNav({ title, items, grouped = false, searchable = false }: { title: string; items: SectionNavItem[]; grouped?: boolean; searchable?: boolean }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const visible = normalized ? items.filter((item) => `${item.label} ${item.description ?? ""} ${item.group ?? ""} ${(item.searchTerms ?? []).join(" ")}`.toLocaleLowerCase().includes(normalized)) : items;
  const displayed = normalized && visible.length ? visible.map((item, index) => ({ ...item, current: index === 0 })) : visible;
  const groupOrder = [...new Set(items.map((item) => item.group).filter((group): group is string => Boolean(group)))];
  return (
    <nav class="secnav" aria-label={title}>
      <h2>{title}</h2>
      {searchable ? <div class="secnav-search"><Field ariaLabel={title} placeholder={title} value={query} onInput={(event) => setQuery(event.currentTarget.value)} /></div> : null}
      {grouped ? <div class="secnav-mobile-select"><Field as="select" ariaLabel={title} value={items.find((item) => item.current)?.href ?? ""} options={items.map((item) => ({ value: item.href, label: item.label }))} onSelectChange={(href) => { window.location.hash = href.slice(1); }} /></div> : null}
      {grouped && !normalized ? groupOrder.map((group) => <section class="secnav-group" key={group}><h3><Icon role={displayed.find((item) => item.group === group)?.groupRole ?? "settings.category.start"} />{group}</h3><div class="secnav-list">{displayed.filter((item) => item.group === group).map((item) => <a key={item.key} class="secnav-item" href={item.href} aria-current={item.current ? "page" : undefined}><Icon role={item.role} />{item.label}</a>)}</div></section>) : <div class="secnav-list">{displayed.map((item) => <a key={item.key} class="secnav-item" href={item.href} aria-current={item.current ? "page" : undefined}><Icon role={item.role} />{item.label}</a>)}</div>}
    </nav>
  );
}
