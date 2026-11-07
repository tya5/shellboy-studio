/** A span between two measures on a shared scale: where a value went from and to. */
export function RangeBar({ from, to, max, aria }: { from: number; to: number; max: number; aria: string }) {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const scale = max > 0 ? 100 / max : 0;
  return (
    <span class="range" role="img" aria-label={aria}>
      <i class="range-span" style={{ left: `${low * scale}%`, width: `${(high - low) * scale}%` }} />
      <i class="range-end" style={{ left: `${to * scale}%` }} />
    </span>
  );
}
