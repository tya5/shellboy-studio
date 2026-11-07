import type { ComponentChildren } from "preact";

export interface DiffRow {
  key: string;
  /** What changes, as the machine names it. */
  field: string;
  before: ComponentChildren;
  after: ComponentChildren;
  note?: ComponentChildren;
}

/** What a change will do, or did: each thing with its value before and after. */
export function DiffList({ rows, beforeLabel, afterLabel }: { rows: DiffRow[]; beforeLabel: string; afterLabel: string }) {
  return (
    <ul class="diff">
      {rows.map((r) => (
        <li key={r.key}>
          <code>{r.field}</code>
          <div class="diff-values">
            <span class="diff-before"><span class="muted caption">{beforeLabel}</span> {r.before}</span>
            <span class="diff-after"><span class="muted caption">{afterLabel}</span> {r.after}</span>
          </div>
          {r.note ? <div class="muted caption">{r.note}</div> : null}
        </li>
      ))}
    </ul>
  );
}
