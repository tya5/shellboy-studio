import type { ComponentChildren } from "preact";

export interface Fact {
  label: string;
  /** Absent: the owner has no read for this; `missing` says so in words. */
  value?: ComponentChildren;
  mono?: boolean;
  /** Explains the value, or the documented default when it can't be read. */
  note?: ComponentChildren;
}

export function FactList({ facts, missing }: { facts: Fact[]; missing: string }) {
  return (
    <dl class="facts">
      {facts.map((f) => (
        <div class="fact" key={f.label}>
          <dt>{f.label}</dt>
          <dd>
            {f.value !== undefined ? <span class={f.mono ? "mono" : undefined}>{f.value}</span> : <span class="muted">{missing}</span>}
            {f.note ? <div class="muted caption">{f.note}</div> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
