import type { ComponentChildren } from "preact";
import { Icon } from "../Icon";

export function StepRow({ open, command, status, duration, exit, onToggle, children }: { open: boolean; command: string; status: ComponentChildren; duration?: string | undefined; exit?: string | undefined; onToggle: (open: boolean) => void; children: ComponentChildren }) {
  return (
    <details class="step" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <Icon name="term" />
        <span class="cmd">{command}</span>
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
