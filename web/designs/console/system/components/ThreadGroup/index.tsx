import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** A heading over rows that belong together, with one checkbox for all of them. */
export function ThreadGroup({ label, mono, count, all, some, selectLabel, onSelect, children }: { label: string; mono?: boolean; count: string; all: boolean; some: boolean; selectLabel: string; onSelect: (on: boolean) => void; children: ComponentChildren }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = some && !all;
  }, [all, some]);
  return (
    <section class="tgroup" aria-label={label}>
      <header>
        <label class="tcheck">
          <input ref={box} type="checkbox" aria-label={selectLabel} checked={all} onChange={(e) => onSelect(e.currentTarget.checked)} />
        </label>
        <span class={mono ? "mono tgroup-name" : "tgroup-name"}>{label}</span>
        <span class="tgroup-count caption muted">{count}</span>
      </header>
      {children}
    </section>
  );
}
