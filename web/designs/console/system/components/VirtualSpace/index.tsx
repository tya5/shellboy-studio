import type { ComponentChildren } from "preact";

/** Rows stay in normal flow so a late height change cannot overlap later content. */
export function VirtualSpace({ top, bottom, children }: { top: number; bottom: number; children?: ComponentChildren }) {
  return <div class="vspace"><div aria-hidden="true" style={{ height: `${top}px` }} />{children}<div aria-hidden="true" style={{ height: `${bottom}px` }} /></div>;
}

/** A range of rows not read yet, held at its estimated height. */
export function VirtualGap({ height, children }: { height: number; children?: ComponentChildren }) {
  return <div class="vgap" style={{ height: `${height}px` }}>{children}</div>;
}
