import type { ComponentChildren } from "preact";

/** A neutral, in-conversation provider output-limit status and its explicit actions. */
export function OutputLimitNotice({ children, actions }: { children: ComponentChildren; actions: ComponentChildren }) {
  return <div class="output-limit-notice" role="status"><div class="output-limit-notice-content">{children}</div><div class="output-limit-notice-actions">{actions}</div></div>;
}
