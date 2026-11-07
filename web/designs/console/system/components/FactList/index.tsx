import type { ComponentChildren } from "preact";

export interface Fact {
  label: string;
  /** Absent: the owner has no read for this; `missing` says so in words. */
  value?: ComponentChildren;
  mono?: boolean;
  /** Explains the value. */
  note?: ComponentChildren;
  /** An edit control, where one exists. It takes the place of the read-only value. */
  control?: ComponentChildren;
}

export function FactList({ facts, missing }: { facts: Fact[]; missing: string }) {
  return (
    <dl class="facts">
      {facts.map((f) => (
        <div class="fact" key={f.label}>
          <dt>{f.label}</dt>
          <dd>
            {f.control ? f.control : f.value !== undefined ? <span class={f.mono ? "mono" : undefined}>{f.value}</span> : <span class="muted">{missing}</span>}
            {f.note ? <div class="muted caption">{f.note}</div> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
