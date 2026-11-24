import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** The trigger supplies its own accessible name; the floating text repeats it visually. */
export function Tooltip({ label, children }: { label: string; children: ComponentChildren }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const hover = useRef(false);
  const focus = useRef(false);
  const dismissed = useRef(false);
  const hide = () => {
    const node = tip.current;
    if (node?.hidePopover && node.matches(":popover-open")) node.hidePopover();
  };
  const update = () => {
    const node = tip.current;
    if (dismissed.current || !(hover.current || focus.current) || !anchor.current || !node?.showPopover) { hide(); return; }
    if (!node.matches(":popover-open")) node.showPopover();
    const rect = anchor.current.getBoundingClientRect();
    const size = node.getBoundingClientRect();
    node.style.left = `${Math.max(0, Math.min(rect.right - size.width, innerWidth - size.width))}px`;
    node.style.top = `${rect.top >= size.height ? rect.top - size.height : rect.bottom}px`;
  };
  useEffect(() => {
    const dismiss = () => { dismissed.current = true; hide(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    const node = anchor.current;
    if (!node) return;
    addEventListener("keydown", escape);
    addEventListener("scroll", dismiss, true);
    addEventListener("resize", dismiss);
    return () => {
      removeEventListener("keydown", escape);
      removeEventListener("scroll", dismiss, true);
      removeEventListener("resize", dismiss);
    };
  }, []);
  useEffect(update, [label]);
  return <span ref={anchor} class="tooltip-anchor" onPointerEnter={event => {
    if (event.pointerType !== "touch") { hover.current = true; dismissed.current = false; update(); }
  }} onPointerLeave={() => { hover.current = false; update(); }} onFocusIn={event => {
    focus.current = event.target instanceof HTMLElement && event.target.matches(":focus-visible");
    dismissed.current = false;
    update();
  }} onFocusOut={() => { focus.current = false; update(); }}>
    {children}<span ref={tip} popover="manual" class="tooltip-bubble" aria-hidden="true">{label}</span>
  </span>;
}
