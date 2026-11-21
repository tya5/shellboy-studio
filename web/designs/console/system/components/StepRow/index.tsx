import type { ComponentChildren } from "preact";
import { Icon, type IconRole } from "../Icon";

export function StepRow({ open, command, status, duration, exit, onToggle, children, group, anchorKey, role = "work.execution" }: { open: boolean; command: string; role?: IconRole; group?: boolean; anchorKey?: string; status: ComponentChildren; duration?: string | undefined; exit?: string | undefined; onToggle: (open: boolean) => void; children: ComponentChildren }) {
  return (
    <details data-scroll-key={anchorKey} class={group ? "step step-group" : "step"} open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <Icon role={role} />
        <span class={group ? "tool-group-label" : "cmd"}>{command}</span>
        {status}
        <span class="meta">
          {duration ? <span class="mono">{duration}</span> : null}
          {exit ? <span class="mono">{exit}</span> : null}
        </span>
      </summary>
      {open ? children : null}
    </details>
  );
}
