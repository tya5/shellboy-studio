import { characterAssets } from "../../character-assets";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Icon } from "../Icon";

type Create = (copyLabel: string) => (text: string) => string;
let loaded: Create | undefined;
let loading: Promise<Create> | undefined;
const loadRenderer = (): Promise<Create> => (loading ??= import("./markdown").then((m) => (loaded = m.createRenderer)));

function copyFrom(button: HTMLElement, copied: string): void {
  const code = button.parentElement?.querySelector("code")?.textContent ?? "";
  const original = button.textContent;
  void navigator.clipboard?.writeText(code).then(() => {
    button.textContent = copied;
    setTimeout(() => (button.textContent = original), 1500);
  });
}

export function Markdown({ text, copyLabel, copiedLabel }: { text: string; copyLabel: string; copiedLabel: string }) {
  const [create, setCreate] = useState<Create | undefined>(() => loaded);
  useEffect(() => {
    if (!create) void loadRenderer().then((c) => setCreate(() => c));
  }, [create]);
  const html = useMemo(() => (create ? create(copyLabel)(text) : undefined), [create, copyLabel, text]);
  if (html === undefined) return <div class="md plain">{text}</div>;
  return (
    <div
      class="md"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.hasAttribute("data-copy")) copyFrom(target, copiedLabel);
      }}
    />
  );
}

export function Message({ bot, who, at, text, copyLabel, copiedLabel, children }: { bot: boolean; who: string; at?: string | undefined; text: string; copyLabel: string; copiedLabel: string; children?: ComponentChildren }) {
  return (
    <div class="msg">
      <div class={bot ? "av bot" : "av"}>
        {bot ? <img class="character-avatar" src={characterAssets.neutral} alt="" /> : <Icon name="user" />}
      </div>
      <div>
        <div class="who">
          {who}
          {at ? <small class="mono">{at}</small> : null}
        </div>
        <Markdown text={text} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        {children}
      </div>
    </div>
  );
}
