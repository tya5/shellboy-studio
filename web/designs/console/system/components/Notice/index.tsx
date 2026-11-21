import type { ComponentChildren } from "preact";

export function Notice({ tone, title, children, actions }: { tone?: "bad" | "wait" | undefined; title?: string | undefined; children?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <div class={tone ? `notice ${tone}` : "notice"} role={tone === "bad" ? "alert" : "status"}>
      <div class="text">
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
      {actions}
    </div>
  );
}
