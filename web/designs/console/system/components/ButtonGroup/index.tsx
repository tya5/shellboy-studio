import type { ComponentChildren } from "preact";

export function ButtonGroup({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="btn-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}
