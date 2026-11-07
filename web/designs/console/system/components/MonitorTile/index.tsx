import type { ComponentChildren } from "preact";
export function MonitorTile({ href, title, status, children }: { href: string; title: string; status: ComponentChildren; children: ComponentChildren }) {
  return <a class="monitor-tile" href={href}><div class="tile-status">{status}</div><h2>{title}</h2><div class="tile-content">{children}</div></a>;
}
