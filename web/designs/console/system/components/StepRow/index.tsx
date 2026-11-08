import type { ComponentChildren } from "preact";
import { Icon } from "../Icon";

export function StepRow({ open, command, status, duration, exit, onToggle, children, group, anchorKey }: { open: boolean; command: string; group?: boolean; anchorKey?: string; status: ComponentChildren; duration?: string | undefined; exit?: string | undefined; onToggle: (open: boolean) => void; children: ComponentChildren }) {
  return (
    <details data-scroll-key={anchorKey} class={group ? "step step-group" : "step"} open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <Icon name="term" />
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
