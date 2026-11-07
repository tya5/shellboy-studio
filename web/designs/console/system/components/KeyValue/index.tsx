import type { ComponentChildren } from "preact";

export function KeyValue({ rows }: { rows: { key: string; value: ComponentChildren; mono?: boolean }[] }) {
  return (
    <dl class="kv">
      {rows.map((r) => (
        <>
          <dt>{r.key}</dt>
          <dd class={r.mono ? "mono" : undefined}>{r.value}</dd>
        </>
      ))}
    </dl>
  );
}
