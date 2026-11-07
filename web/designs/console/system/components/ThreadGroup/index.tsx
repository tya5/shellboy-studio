import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "../Button";

/** A heading over rows that belong together, with one checkbox for all of them. */
export function ThreadGroup({ label, mono, count, all, some, selectLabel, onSelect, fold, children }: { label: string; mono?: boolean; count: string; all: boolean; some: boolean; selectLabel: string; onSelect?: ((on: boolean) => void) | undefined; fold?: { open: boolean; show: string; hide: string; showLabel: string; hideLabel: string; onToggle: () => void } | undefined; children?: ComponentChildren }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = some && !all;
  }, [all, some]);
  return (
    <section class="tgroup" aria-label={label}>
      <header>
        {onSelect ? (
          <label class="tcheck">
            <input ref={box} type="checkbox" aria-label={selectLabel} checked={all} onChange={(e) => onSelect(e.currentTarget.checked)} />
          </label>
        ) : (
          <span class="tcheck-gap" />
        )}
        <span class={mono ? "mono tgroup-name" : "tgroup-name"}>{label}</span>
        <span class="tgroup-count caption muted">{count}</span>
        {fold ? (
          <Button variant="link" aria-expanded={fold.open} label={fold.open ? fold.hideLabel : fold.showLabel} onClick={fold.onToggle}>
            {fold.open ? fold.hide : fold.show}
          </Button>
        ) : null}
      </header>
      {children}
    </section>
  );
}
