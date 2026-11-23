import type { ComponentChildren } from "preact";
import { Icon } from "../Icon";

export function BranchList({ rows, label }: { rows: { key: string; depth: number; title: string; href: string; note: string; current: boolean; excerpt?: ComponentChildren; action?: ComponentChildren }[]; label: string }) {
  return (
    <ul class="blist" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} class="brow" style={{ "--depth": Math.min(r.depth, 4) }}>
          <Icon role="branch.listItem" size="small" />
          <div class="brow-text">
            <a href={r.href} aria-current={r.current ? "true" : undefined}>{r.title}</a>
            <div class="muted caption">{r.note}</div>
            {r.excerpt}
          </div>
          {r.action}
        </li>
      ))}
    </ul>
  );
}
