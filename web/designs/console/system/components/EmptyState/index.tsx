import { emptyCharacterAsset } from "../../character-assets";
import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "../Icon";

export function EmptyState({ icon, title, body, children, character }: { icon: IconName; character?: boolean; title: string; body?: string; children?: ComponentChildren }) {
  return (
    <div class={character ? "empty empty-character" : "empty"}>
      {character ? <img class="character-empty" src={emptyCharacterAsset} alt="" /> : <Icon name={icon} />}
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {children}
    </div>
  );
}
