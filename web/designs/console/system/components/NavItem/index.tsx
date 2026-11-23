import { Icon, type IconRole } from "../Icon";

export function NavItem({ href, role, label, current, count }: { href: string; role: IconRole; label: string; current: boolean; count?: number | `${number}+` }) {
  return (
    <a class="nav-item" href={href} aria-current={current ? "page" : undefined} aria-label={label} title={label}>
      <Icon role={role} />
      <span class="nav-label">{label}</span>
      {count ? <span class="count">{count}</span> : null}
    </a>
  );
}
