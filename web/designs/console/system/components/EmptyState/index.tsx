import { emptyCharacterAsset } from "../../character-assets";
import type { ComponentChildren } from "preact";
import { Icon, type IconRole } from "../Icon";

export function EmptyState({ role, title, body, children, character }: { role: IconRole; character?: boolean; title: string; body?: string; children?: ComponentChildren }) {
  return (
    <div class={character ? "empty empty-character" : "empty"}>
      {character ? <img class="character-empty" src={emptyCharacterAsset} alt="" /> : <Icon role={role} />}
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {children}
    </div>
  );
}
