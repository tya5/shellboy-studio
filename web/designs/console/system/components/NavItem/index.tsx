import { Icon, type IconName } from "../Icon";

export function NavItem({ href, icon, label, current, count }: { href: string; icon: IconName; label: string; current: boolean; count?: number }) {
  return (
    <a class="nav-item" href={href} aria-current={current ? "page" : undefined} aria-label={label} title={label}>
      <Icon name={icon} />
      <span class="nav-label">{label}</span>
      {count ? <span class="count">{count}</span> : null}
    </a>
  );
}
