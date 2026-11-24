import type { ComponentChildren } from "preact";
import { Button, IconButton } from "../Button";
import { useId, useLayoutEffect, useRef } from "preact/hooks";

export function WorkSheet({ open, title, closeLabel, onClose, children, role = "dialog", dismissOnOutside = true, describedBy, focusCloseOnOpen = false, getReturnFocusTarget }: { open: boolean; title: string; closeLabel: string; onClose: () => void; children: ComponentChildren; role?: "dialog" | "alertdialog"; dismissOnOutside?: boolean; describedBy?: string; focusCloseOnOpen?: boolean; getReturnFocusTarget: () => HTMLElement | null }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnTarget = useRef(getReturnFocusTarget);
  returnTarget.current = getReturnFocusTarget;
  const titleId = `work-sheet-title-${useId()}`;
  const bodyId = `work-sheet-body-${useId()}`;
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      if (focusCloseOnOpen) closeButton.current?.focus();
      return () => {
        if (dialog.open) {
          dialog.close();
          returnTarget.current()?.focus();
        }
      };
    }
    if (dialog.open) {
      dialog.close();
      returnTarget.current()?.focus();
    }
  }, [open]);
  return <dialog ref={ref} class="work-sheet" role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy ?? bodyId} onClick={(event) => {
    if (dismissOnOutside && event.target === event.currentTarget && event.button === 0 && !event.ctrlKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }
  }} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div class="work-sheet-head"><h2 id={titleId}>{title}</h2>{role === "alertdialog" ? <Button buttonRef={closeButton} onClick={onClose}>{closeLabel}</Button> : <IconButton glyph="settings.close" buttonRef={closeButton} label={closeLabel} onClick={onClose} />}</div>
    <div id={bodyId} class="work-sheet-body">{children}</div>
  </dialog>;
}
