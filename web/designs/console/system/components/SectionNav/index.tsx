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
  searchTerms?: readonly string[];
  searchRows?: readonly { id: string; label: string; terms: readonly string[] }[];
}

export function SectionNav({ title, items, grouped = false, searchLabel, onResult }: { title: string; items: SectionNavItem[]; grouped?: boolean; searchLabel?: string; onResult?: (label: string | undefined) => void }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const matches = items.flatMap<{ item: SectionNavItem; id?: string; label?: string }>((item) => {
    const rows = item.searchRows?.filter((row) => row.terms.some((term) => term.toLocaleLowerCase().includes(normalized))) ?? [];
    if (rows.length) return rows.map(({ id, label }) => ({ item, id, label }));
    return [item.label, item.description, item.group, ...(item.searchTerms ?? [])].some((term) => term?.toLocaleLowerCase().includes(normalized)) ? [{ item }] : [];
  });
  const openResult = (id?: string) => { onResult?.(id); setQuery(""); };
  const groupOrder = [...new Set(items.map((item) => item.group).filter((group): group is string => Boolean(group)))];
  return (
    <nav class="secnav" aria-label={title}>
      <p class="secnav-label">{title}</p>
      {searchLabel ? <div class="secnav-search"><Field leading={<Icon role="thread.search" size="small" />} ariaLabel={searchLabel} placeholder={searchLabel} value={query} onInput={(event) => setQuery(event.currentTarget.value)} onKeyDown={(event) => {
        const first = matches[0];
        if (event.key === "Enter" && normalized && first) { event.preventDefault(); openResult(first.id); window.location.hash = first.item.href.slice(1); }
      }} /></div> : null}
      {grouped && !normalized ? <div class="secnav-mobile-select"><Field as="select" ariaLabel={title} value={items.find((item) => item.current)?.href ?? ""} options={items.map((item) => ({ value: item.href, label: item.label }))} onSelectChange={(href) => { window.location.hash = href.slice(1); }} /></div> : null}
      {normalized ? <div class="secnav-results secnav-list">{matches.map(({ item, id, label }, index) => <a key={`${item.key}/${id ?? ""}`} class="secnav-item" href={item.href} aria-current={index === 0 ? "true" : undefined} onClick={() => openResult(id)}><Icon role={item.role} />{label ? `${item.label} / ${label}` : item.label}</a>)}</div> : grouped ? groupOrder.map((group) => <section class="secnav-group" key={group} aria-label={group}><h3 class="group-label">{group}</h3><div class="secnav-list">{items.filter((item) => item.group === group).map((item) => <a key={item.key} class="secnav-item" href={item.href} aria-current={item.current ? "page" : undefined}><Icon role={item.role} />{item.label}</a>)}</div></section>) : <div class="secnav-list">{items.map((item) => <a key={item.key} class="secnav-item" href={item.href} aria-current={item.current ? "page" : undefined}><Icon role={item.role} />{item.label}</a>)}</div>}
    </nav>
  );
}
