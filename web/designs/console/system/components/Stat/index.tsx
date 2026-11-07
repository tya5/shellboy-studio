import type { ComponentChildren } from "preact";

export function Stat({ label, value, note }: { label: string; value: ComponentChildren; note?: ComponentChildren }) {
  return (
    <div class="stat">
      <div class="stat-label">{label}</div>
      <div class="stat-value">{value}</div>
      {note ? <div class="stat-note">{note}</div> : null}
    </div>
  );
}
