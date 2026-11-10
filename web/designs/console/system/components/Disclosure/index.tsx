import type { ComponentProps } from "preact";

/** Native disclosure behavior, kept behind the Console system boundary. */
export function Disclosure(props: ComponentProps<"details">) {
  return <details {...props} />;
}
