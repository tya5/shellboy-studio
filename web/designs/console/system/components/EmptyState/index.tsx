import { emptyCharacterAsset } from "../../character-assets";
import type { ComponentChildren } from "preact";
import { Icon, type IconRole } from "../Icon";

/**
 * What an empty region shows. The view variant fills a whole view; `compact` sits inside a panel,
 * card or chart. `title` says what belongs here and `body` how it fills up.
 */
export function EmptyState({ role, title, body, children, character, compact }: { role: IconRole; character?: boolean; compact?: boolean; title: string; body?: string; children?: ComponentChildren }) {
  if (compact) return (
    <div class="empty-state-root empty-compact">
      <Icon role={role} size="small" />
      <div class="empty-compact-copy">
        <p class="empty-compact-what">{title}</p>
        {body ? <p class="empty-compact-how">{body}</p> : null}
        {children}
      </div>
    </div>
  );
  return (
    <div class={character ? "empty-state-root empty-character" : "empty-state-root"}>
      {character ? <img class="character-empty" src={emptyCharacterAsset} alt="" /> : <Icon role={role} />}
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {children}
    </div>
  );
}
