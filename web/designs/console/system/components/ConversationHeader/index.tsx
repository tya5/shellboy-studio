import type { ComponentChildren } from "preact";
import type { MenuEntry } from "../Menu";
import { useRowMenu } from "../useRowMenu";

export function ConversationHeader({ folder, title, status, actions, label, entries, children }: {
  folder?: string; title: ComponentChildren; status?: ComponentChildren; actions?: ComponentChildren; label: string; entries: MenuEntry[]; children?: ComponentChildren;
}) {
  const menu = useRowMenu(entries.length ? { label, entries } : undefined);
  return <header class="top conversation-header" data-conversation-header>
    {children}
    <div class="conversation-header-title">{folder ? <span class="conversation-header-folder">{folder} /</span> : null}{title}</div>
    <div class="right">{status}<span class="conversation-header-actions">{actions}</span>{menu.trigger}{menu.menu}</div>
  </header>;
}
