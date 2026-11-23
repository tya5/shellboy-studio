import type { ComponentChildren } from "preact";
import { Icon, type IconRole } from "../Icon";

/**
 * Says what happened and what to do, with the action in it. `banner` is the full-width application banner above
 * the header: a persistent condition in one sentence with at most one link, `wait` tone unless given.
 */
export function Notice({ tone, title, children, actions, banner, icon }: { tone?: "bad" | "wait" | undefined; title?: string | undefined; children?: ComponentChildren; actions?: ComponentChildren; banner?: boolean; icon?: IconRole }) {
  const shown = banner ? tone ?? "wait" : tone;
  return (
    <div class={["notice", shown ?? "", banner ? "notice-banner" : ""].filter(Boolean).join(" ")} role={shown === "bad" && !banner ? "alert" : "status"}>
      {icon ? <Icon role={icon} size="small" /> : null}
      <div class="notice-text">
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
      {actions}
    </div>
  );
}
