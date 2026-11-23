import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "../Icon";
import { Button } from "../Button";

/** A heading over rows that belong together, with one checkbox for all of them. */
export function ThreadGroup({ label, mono, verbatim, count, countLoading, all, some, selectLabel, onSelect, fold, children }: { label: string; mono?: boolean; verbatim?: boolean; count: ComponentChildren; countLoading?: boolean; all?: boolean; some?: boolean; selectLabel?: string; onSelect?: ((on: boolean) => void) | undefined; fold?: { open: boolean; show: string; hide: string; showLabel: string; hideLabel: string; onToggle: () => void } | undefined; children?: ComponentChildren }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = !!some && !all;
  }, [all, some]);
  const content = (
    <>
      {!onSelect && !fold ? <span class="tcheck-gap" /> : null}
      <span class={mono ? "mono tgroup-name" : verbatim ? "tgroup-name tgroup-name-verbatim" : "tgroup-name"}>{label}</span>
      <span class="tgroup-count caption muted">{count}</span>
      {fold ? <span class="tgroup-chevron"><Icon role={fold.open ? "group.collapse" : "group.expand"} size="small" /></span> : null}
    </>
  );
  return (
    <section class="tgroup" aria-label={label} data-group-heading={fold ? "section" : undefined}>
      <header>
        {onSelect ? (
          <label class="tcheck">
            <input ref={box} type="checkbox" aria-label={selectLabel} checked={all} onChange={(e) => onSelect(e.currentTarget.checked)} />
          </label>
        ) : null}
        {fold ? (
          <Button class="tgroup-toggle" aria-busy={countLoading || undefined} aria-expanded={fold.open} label={fold.open ? fold.hideLabel : fold.showLabel} onClick={fold.onToggle}>{content}</Button>
        ) : content}
      </header>
      {children}
    </section>
  );
}
