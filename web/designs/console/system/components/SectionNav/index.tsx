import { Icon, type IconRole } from "../Icon";

export interface SectionNavItem {
  key: string;
  href: string;
  role: IconRole;
  label: string;
  current: boolean;
}

export function SectionNav({ title, items }: { title: string; items: SectionNavItem[] }) {
  return (
    <nav class="secnav" aria-label={title}>
      <h2>{title}</h2>
      <div class="secnav-list">
        {items.map((i) => (
          <a key={i.key} class="secnav-item" href={i.href} aria-current={i.current ? "page" : undefined}>
            <Icon role={i.role} />
            {i.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
