export interface Choice {
  value: string;
  label: string;
  /** One line that tells the options apart. */
  note?: string | undefined;
}

/** One option chosen from a short list, as radio rows. The list scrolls when it is long. */
export function ChoiceList({ label, choices, value, onChange, mono }: { label: string; choices: readonly Choice[]; value: string | undefined; onChange: (value: string) => void; mono?: boolean }) {
  return (
    <div class="choices" role="radiogroup" aria-label={label}>
      {choices.map((c) => (
        <label key={c.value} class={c.value === value ? "choice on" : "choice"}>
          <input type="radio" name={label} checked={c.value === value} onChange={() => onChange(c.value)} />
          <span class="choice-text">
            <span class={mono ? "mono" : undefined}>{c.label}</span>
            {c.note ? <span class="muted caption">{c.note}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}
