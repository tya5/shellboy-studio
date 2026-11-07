import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "../Icon";

export function EmptyState({ icon, title, body, children }: { icon: IconName; title: string; body?: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <Icon name={icon} />
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {children}
    </div>
  );
}
