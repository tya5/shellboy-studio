import type { ComponentProps } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

type Toggle = NonNullable<ComponentProps<"details">["onToggle"]>;

/** Native disclosure behavior, kept behind the Console system boundary. */
export function Disclosure({ onToggle, ...props }: ComponentProps<"details">) {
  const details = useRef<HTMLDetailsElement>(null);
  const handler = useRef(onToggle);
  useLayoutEffect(() => { handler.current = onToggle; }, [onToggle]);
  const listens = !!onToggle;
  useLayoutEffect(() => {
    const node = details.current;
    if (!node || !listens) return;
    const toggle = (event: Event) => handler.current?.(event as Parameters<Toggle>[0]);
    // A removed details node can still have a queued native toggle. Release
    // the render callback before that detached node can dispatch it.
    node.addEventListener("toggle", toggle);
    return () => {
      node.removeEventListener("toggle", toggle);
      handler.current = undefined;
    };
  }, [listens]);
  return <details {...props} ref={details} />;
}
