import type { ComponentChildren } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";

export function WorkSheet({ open, title, closeLabel, onClose, children, role = "dialog", dismissOnOutside = true, describedBy, focusCloseOnOpen = false }: { open: boolean; title: string; closeLabel: string; onClose: () => void; children: ComponentChildren; role?: "dialog" | "alertdialog"; dismissOnOutside?: boolean; describedBy?: string; focusCloseOnOpen?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const nearby = useRef<HTMLElement[]>([]);
  const titleId = `work-sheet-title-${useId()}`;
  const bodyId = `work-sheet-body-${useId()}`;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const group = opener.current?.closest<HTMLElement>(".tree-item, .srow") ?? opener.current?.parentElement;
      nearby.current = [group?.nextElementSibling, group?.previousElementSibling]
        .filter((element): element is HTMLElement => element instanceof HTMLElement);
      const priorOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      dialog.showModal();
      if (focusCloseOnOpen) closeRef.current?.focus();
      return () => {
        if (dialog.open) dialog.close();
        document.body.style.overflow = priorOverflow;
        const target = opener.current;
        opener.current = null;
        if (target?.isConnected) target.focus();
        else {
          const fallback = nearby.current.map((element) => element.querySelector<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')).find((element) => element?.isConnected);
          fallback?.focus();
        }
        nearby.current = [];
      };
    }
    if (!open && dialog.open) dialog.close();
  }, [open, focusCloseOnOpen]);
  return <dialog ref={ref} class="work-sheet" role={role} aria-labelledby={titleId} aria-describedby={describedBy ?? bodyId} onClick={(event) => {
    if (dismissOnOutside && event.target === event.currentTarget && event.button === 0) onClose();
  }} onCancel={(event) => { event.preventDefault(); if (dismissOnOutside) onClose(); }}>
    <div class="work-sheet-head"><h2 id={titleId}>{title}</h2><button ref={closeRef} type="button" class="btn" onClick={onClose}>{closeLabel}</button></div>
    <div id={bodyId} class="work-sheet-body">{children}</div>
  </dialog>;
}
