import { Icon, type IconName } from "../Icon";

export interface SectionNavItem {
  key: string;
  href: string;
  icon: IconName;
  label: string;
  current: boolean;
}

export function SectionNav({ title, items, onSelect }: { title: string; items: SectionNavItem[]; onSelect: (key: string) => void }) {
  return (
    <nav class="secnav" aria-label={title}>
      <h2>{title}</h2>
      <div class="secnav-list">
        {items.map((i) => (
          <a key={i.key} class="secnav-item" href={i.href} aria-current={i.current ? "page" : undefined}>
            <Icon name={i.icon} />
            {i.label}
          </a>
        ))}
      </div>
      <label class="secnav-pick">
        <span class="vh">{title}</span>
        <select value={items.find((i) => i.current)?.key} onChange={(e) => onSelect(e.currentTarget.value)}>
          {items.map((i) => (
            <option key={i.key} value={i.key}>{i.label}</option>
          ))}
        </select>
      </label>
    </nav>
  );
}
