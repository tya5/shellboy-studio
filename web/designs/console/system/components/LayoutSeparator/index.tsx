import type { JSX } from "preact";

export function LayoutSeparator(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return <div class="side-resize" {...props}><span aria-hidden="true" /></div>;
}
