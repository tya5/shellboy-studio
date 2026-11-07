import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Button } from "../Button";

export function WorkSheet({ open, title, closeLabel, onClose, children }: { open: boolean; title: string; closeLabel: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} class="work-sheet" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <div class="work-sheet-head"><h2>{title}</h2><Button onClick={onClose}>{closeLabel}</Button></div>
    <div class="work-sheet-body">{children}</div>
  </dialog>;
}
