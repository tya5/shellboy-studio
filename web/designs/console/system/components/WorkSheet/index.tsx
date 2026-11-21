import type { ComponentChildren } from "preact";
import { Button } from "../Button";
import { useId, useLayoutEffect, useRef } from "preact/hooks";

export function WorkSheet({ open, title, closeLabel, onClose, children, role = "dialog", dismissOnOutside = true, describedBy, focusCloseOnOpen = false, returnFocusTo, resolveFocusFallback }: { open: boolean; title: string; closeLabel: string; onClose: () => void; children: ComponentChildren; role?: "dialog" | "alertdialog"; dismissOnOutside?: boolean; describedBy?: string; focusCloseOnOpen?: boolean; returnFocusTo: HTMLElement | null; resolveFocusFallback: () => HTMLElement | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = `work-sheet-title-${useId()}`;
  const bodyId = `work-sheet-body-${useId()}`;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const root = document.documentElement;
      const alreadyLocked = root.classList.contains("modal-dialog-open");
      root.classList.add("modal-dialog-open");
      dialog.showModal();
      if (focusCloseOnOpen) closeButton.current?.focus();
      return () => {
        if (dialog.open) dialog.close();
        if (!alreadyLocked) root.classList.remove("modal-dialog-open");
        const target = returnFocusTo?.isConnected ? returnFocusTo : resolveFocusFallback();
        target?.focus();
      };
    }
    if (!open && dialog.open) dialog.close();
  }, [open, returnFocusTo, resolveFocusFallback, focusCloseOnOpen]);
  return <dialog ref={ref} class="work-sheet" role={role} aria-labelledby={titleId} aria-describedby={describedBy ?? bodyId} onClick={(event) => {
    if (dismissOnOutside && event.target === event.currentTarget && event.button === 0 && !event.ctrlKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }
  }} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div class="work-sheet-head"><h2 id={titleId}>{title}</h2><Button buttonRef={closeButton} onClick={onClose}>{closeLabel}</Button></div>
    <div id={bodyId} class="work-sheet-body">{children}</div>
  </dialog>;
}
