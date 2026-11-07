/** Parts on one common scale, with the value at the bar's tip. */
export function BarList({ rows, aria }: { rows: { key: string; label: string; value: number | undefined; text: string }[]; aria: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  return (
    <ul class="barlist" aria-label={aria}>
      {rows.map((r) => (
        <li key={r.key}>
          <span class="bar-name">{r.label}</span>
          <span class="bar-track">
            {r.value !== undefined && r.value > 0 && max > 0 ? <i style={{ width: `${(r.value / max) * 100}%` }} /> : null}
          </span>
          <span class="bar-value mono">{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
