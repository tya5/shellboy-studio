import type { ComponentChildren } from "preact";

/** A bounded monitor pane: the content is clipped from the top, never scrolled. */
export function MonitorTile({ href, title, pin, headingStatus, status, children }: { href: string; title: string; pin: ComponentChildren; headingStatus: ComponentChildren; status: ComponentChildren; children: ComponentChildren }) {
  return <article class="monitor-tile">
    <header class="tile-header"><a href={href}>{title}</a>{headingStatus}{pin}</header>
    <a class="tile-main" href={href} aria-label={title}>
      <div class="tile-content"><div class="tile-lines">{children}</div></div>
      <div class="tile-status" role="status">{status}</div>
    </a>
  </article>;
}
