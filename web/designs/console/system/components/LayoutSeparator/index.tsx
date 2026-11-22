import { useLayoutEffect, useRef } from "preact/hooks";

export function LayoutSeparator({ side, label, controls, width, min, max, disabled, onWidth }: {
  side: "left" | "right";
  label: string;
  controls: string;
  width: number;
  min: number;
  max: number;
  disabled?: boolean;
  onWidth: (width: number) => void;
}) {
  const drag = useRef<{ pointerId: number; element: HTMLDivElement; originX: number; startWidth: number }>();
  const finish = (pointerId?: number) => {
    const current = drag.current;
    if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) return;
    drag.current = undefined;
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  };
  useLayoutEffect(() => {
    if (disabled) return;
    const cancel = () => finish();
    addEventListener("resize", cancel);
    return () => { removeEventListener("resize", cancel); cancel(); };
  }, [disabled]);

  if (disabled) return null;
  const direction = side === "left" ? 1 : -1;
  const update = (next: number) => onWidth(Math.min(max, Math.max(min, next)));
  return <div class="layout-separator" data-edge={side} role="separator" aria-orientation="vertical"
    aria-label={label} aria-controls={controls} aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} tabIndex={0}
    onPointerDown={event => {
      if (drag.current || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      const element = event.currentTarget;
      element.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, element, originX: event.clientX, startWidth: width };
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId || !event.isPrimary) return;
      update(current.startWidth + direction * (event.clientX - current.originX));
    }}
    onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId)}
    onLostPointerCapture={event => finish(event.pointerId)}
    onKeyDown={event => {
      const step = event.shiftKey ? 32 : 16;
      const next = event.key === "Home" ? min : event.key === "End" ? max
        : event.key === "ArrowLeft" ? width - direction * step
        : event.key === "ArrowRight" ? width + direction * step : undefined;
      if (next === undefined) return;
      event.preventDefault();
      update(next);
    }}><span aria-hidden="true" /></div>;
}
