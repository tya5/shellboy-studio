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
  searchRows?: readonly { label: string; terms: readonly string[] }[];
}

export function SectionNav({ title, items, grouped = false, searchable = false, onResult }: { title: string; items: SectionNavItem[]; grouped?: boolean; searchable?: boolean; onResult?: (label: string | undefined) => void }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const visible = normalized ? items.filter((item) => `${item.label} ${item.description ?? ""} ${item.group ?? ""} ${(item.searchTerms ?? []).join(" ")}`.toLocaleLowerCase().includes(normalized)) : items;
  const matches = visible.flatMap<{ item: SectionNavItem; label: string | undefined }>((item) => {
    const rows = item.searchRows?.filter((row) => row.terms.some((term) => term.toLocaleLowerCase().includes(normalized))) ?? [];
    return rows.length ? rows.map((row) => ({ item, label: row.label })) : [{ item, label: undefined }];
  });
  const openResult = (label: string | undefined) => { onResult?.(label); setQuery(""); };
  const groupOrder = [...new Set(items.map((item) => item.group).filter((group): group is string => Boolean(group)))];
  return (
    <nav class="secnav" aria-label={title}>
      <h2>{title}</h2>
      {searchable ? <div class="secnav-search"><Field ariaLabel={title} placeholder={title} value={query} onInput={(event) => setQuery(event.currentTarget.value)} onKeyDown={(event) => {
        const first = matches[0];
        if (event.key === "Enter" && normalized && first) { event.preventDefault(); openResult(first.label); window.location.hash = first.item.href.slice(1); }
      }} /></div> : null}
      {grouped && !normalized ? <div class="secnav-mobile-select"><Field as="select" ariaLabel={title} value={items.find((item) => item.current)?.href ?? ""} options={items.map((item) => ({ value: item.href, label: item.label }))} onSelectChange={(href) => { window.location.hash = href.slice(1); }} /></div> : null}
      {normalized ? <div class="secnav-results secnav-list">{matches.map(({ item, label }, index) => <a key={`${item.key}/${label ?? ""}`} class="secnav-item" href={item.href} aria-current={index === 0 ? "true" : undefined} onClick={() => openResult(label)}><Icon role={item.role} />{label ? `${item.label} / ${label}` : item.label}</a>)}</div> : grouped ? groupOrder.map((group) => <section class="secnav-group" key={group}><h3><Icon role={items.find((item) => item.group === group)?.groupRole ?? "settings.category.start"} />{group}</h3><div class="secnav-list">{items.filter((item) => item.group === group).map((item) => <a key={item.key} class="secnav-item" href={item.href} aria-current={item.current ? "page" : undefined}><Icon role={item.role} />{item.label}</a>)}</div></section>) : <div class="secnav-list">{items.map((item) => <a key={item.key} class="secnav-item" href={item.href} aria-current={item.current ? "page" : undefined}><Icon role={item.role} />{item.label}</a>)}</div>}
    </nav>
  );
}
