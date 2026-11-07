import type { ComponentChildren } from "preact";

/** One Thread that can be chosen and opened. Its tree depth is a real parent link. */
export function SelectRow({ title, href, status, depth, checked, checkLabel, onToggle, note, age, action, drag }: { title: string; href: string; status: ComponentChildren; depth: number; checked: boolean; checkLabel: string; onToggle: () => void; note?: string | undefined; age?: string | undefined; action?: ComponentChildren; drag?: { onDragStart: () => void; onDrop: () => void; over: boolean; onOver: (over: boolean) => void } | undefined }) {
  const dnd = drag
    ? {
        draggable: true,
        onDragStart: (e: DragEvent) => {
          e.dataTransfer?.setData("text/plain", title);
          drag.onDragStart();
        },
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          drag.onOver(true);
        },
        onDragLeave: () => drag.onOver(false),
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          drag.onOver(false);
          drag.onDrop();
        },
      }
    : {};
  return (
    <div class={`srow${checked ? " on" : ""}${drag?.over ? " drop" : ""}`} style={depth > 0 ? { paddingLeft: `${Math.min(depth, 4) * 20}px` } : undefined} {...dnd}>
      <label class="tcheck">
        <input type="checkbox" aria-label={checkLabel} checked={checked} onChange={onToggle} />
      </label>
      <span class="srow-status">{status}</span>
      <div class="srow-text">
        <a href={href}>{title}</a>
        {note ? <div class="muted caption">{note}</div> : null}
      </div>
      {action}
      {age ? <span class="mono muted caption">{age}</span> : null}
    </div>
  );
}
