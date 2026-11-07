import type { ComponentChildren } from "preact";

/** One Thread that can be chosen and opened. Its tree depth is a real parent link. */
export function SelectRow({ title, href, status, depth, checked, checkLabel, onToggle, note, age }: { title: string; href: string; status: ComponentChildren; depth: number; checked: boolean; checkLabel: string; onToggle: () => void; note?: string | undefined; age?: string | undefined }) {
  return (
    <div class={checked ? "srow on" : "srow"} style={depth > 0 ? { paddingLeft: `${Math.min(depth, 4) * 20}px` } : undefined}>
      <label class="tcheck">
        <input type="checkbox" aria-label={checkLabel} checked={checked} onChange={onToggle} />
      </label>
      <span class="srow-status">{status}</span>
      <div class="srow-text">
        <a href={href}>{title}</a>
        {note ? <div class="muted caption">{note}</div> : null}
      </div>
      {age ? <span class="mono muted caption">{age}</span> : null}
    </div>
  );
}
