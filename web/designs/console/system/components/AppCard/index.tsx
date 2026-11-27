import type { ComponentChildren } from "preact";
import { Icon } from "../Icon";

/** An app in the list. */
export function AppCard({ title, name, note, href, openLabel, children }: { title: string; name: string; note: ComponentChildren; href: string; openLabel: string; children?: ComponentChildren }) {
  return (
    <div class="card">
      <h2>{title}</h2>
      <div class="mono muted">{name}</div>
      <p class="excerpt">{note}</p>
      {children}
      <div class="foot">
        <a class="nav-link go" href={href}>
          {openLabel}
          <Icon role="app.open" size="small" />
        </a>
      </div>
    </div>
  );
}
