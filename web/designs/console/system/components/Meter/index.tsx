/** One amount against its real limit. Without a limit there is no meter: show the number instead. */
export function Meter({ label, value, limit, text, aria, tone, prose }: { label: string; value: number | undefined; limit: number | undefined; text: string; aria: string; tone?: "wait" | "bad" | undefined; /** `text` is a sentence, not a measure. */ prose?: boolean }) {
  const share = value !== undefined && limit !== undefined && limit > 0 ? Math.min(value / limit, 1) : undefined;
  return (
    <div class="meter">
      <div class="meter-text">
        <span>{label}</span>
        <span class={prose ? "muted caption" : "mono muted"}>{text}</span>
      </div>
      {share !== undefined ? (
        <span class={tone ? `meter-track ${tone}` : "meter-track"} role="meter" aria-label={aria} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={value}>
          <i style={{ width: `${share * 100}%` }} />
        </span>
      ) : null}
    </div>
  );
}
