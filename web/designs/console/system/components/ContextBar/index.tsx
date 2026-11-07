/** One measure against one scale: the track is the threshold. Without a threshold only the number shows. */
export function ContextBar({ value, limit, text, aria }: { value: number; limit: number | undefined; text: string; aria: string }) {
  const share = limit && limit > 0 ? Math.min(value / limit, 1) : undefined;
  return (
    <div class="ctx" title={aria}>
      {share !== undefined ? (
        <span class="bar" role="img" aria-label={aria}>
          <i style={{ width: `${share * 100}%` }} />
        </span>
      ) : null}
      <span class="mono">{text}</span>
    </div>
  );
}
