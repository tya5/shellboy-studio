import type { ComponentChildren } from "preact";

/** What is chosen, and what can be done with it. Shown only while something is chosen. */
export function SelectionBar({ text, option, children }: { text: string; option?: { label: string; checked: boolean; onChange: (on: boolean) => void }; children: ComponentChildren }) {
  return (
    <div class="selbar" role="group" aria-label={text}>
      <span class="selbar-text">{text}</span>
      <div class="selbar-acts">
        {option ? (
          <label class="caption">
            <input type="checkbox" checked={option.checked} onChange={(e) => option.onChange(e.currentTarget.checked)} />
            {option.label}
          </label>
        ) : null}
        {children}
      </div>
    </div>
  );
}
