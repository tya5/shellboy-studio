import { useId } from "preact/hooks";

export interface Choice {
  value: string;
  label: string;
  /** One line that tells the options apart. */
  note?: string | undefined;
}

/** One option chosen from a list, as radio rows. `scroll` caps a long list (such as models) and scrolls it; short fixed lists show every option. */
export function ChoiceList({ label, choices, value, onChange, mono, scroll }: { label: string; choices: readonly Choice[]; value: string | undefined; onChange: (value: string) => void; mono?: boolean; scroll?: boolean }) {
  const groupName = `choice-${useId()}`;
  return (
    <div class={scroll ? "choice-list-root choice-list-scroll" : "choice-list-root"} role="radiogroup" aria-label={label}>
      {choices.map((c) => (
        <label key={c.value} class={c.value === value ? "choice-list-option on" : "choice-list-option"}>
          <input type="radio" name={groupName} checked={c.value === value} onChange={() => onChange(c.value)} />
          <span class="choice-text">
            <span class={mono ? "mono" : undefined}>{c.label}</span>
            {c.note ? <span class="muted caption">{c.note}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}
