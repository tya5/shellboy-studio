import type { ComponentChildren } from "preact";

/** A scroll space of a known height with the drawn rows placed at their offset; the rest stays empty. */
export function VirtualSpace({ height, top, children }: { height: number; top: number; children?: ComponentChildren }) {
  return (
    <div class="vspace" style={{ height: `${height}px` }}>
      <div class="vspace-in" style={{ top: `${top}px` }}>{children}</div>
    </div>
  );
}

/** A range of rows not read yet, held at its estimated height. */
export function VirtualGap({ height, children }: { height: number; children?: ComponentChildren }) {
  return <div class="vgap" style={{ height: `${height}px` }}>{children}</div>;
}
