import type { ComponentChildren } from "preact";

/** One yes-or-no choice, with the words that say what yes does. */
export function Check({ checked, onChange, children, note }: { checked: boolean; onChange: (on: boolean) => void; children: ComponentChildren; note?: ComponentChildren }) {
  return (
    <label class="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="check-text">
        <span>{children}</span>
        {note ? <span class="muted caption">{note}</span> : null}
      </span>
    </label>
  );
}
