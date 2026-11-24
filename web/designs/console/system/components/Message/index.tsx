import { characterAssets } from "../../character-assets";
import { h, type ComponentChild, type ComponentChildren } from "preact";
import { memo } from "preact/compat";
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

export function splitStableMarkdown(text: string): { stable: string[]; tail: string } {
  const stable: string[] = [];
  let start = 0;
  let fence: string | undefined;
  const lines = text.match(/.*(?:\n|$)/g) ?? [];
  let offset = 0;
  for (const line of lines) {
    if (!line) continue;
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) fence = fence === undefined ? fenceMatch[1] : (fence[0] === fenceMatch[1]![0] ? undefined : fence);
    const next = offset + line.length;
    if (!fence && /^\s*\n$/.test(line) && next > start) {
      const block = text.slice(start, next).trimEnd();
      if (block) stable.push(block);
      start = next;
    }
    offset = next;
  }
  return { stable, tail: text.slice(start) };
}

function htmlNodes(html: string): ComponentChildren {
  const template = document.createElement("template");
  template.innerHTML = html;
  const convert = (node: Node): ComponentChild => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    const props: Record<string, string> = {};
    for (const attribute of [...node.attributes]) props[attribute.name === "class" ? "className" : attribute.name] = attribute.value;
    return h(node.tagName.toLowerCase() as "div", props, [...node.childNodes].map(convert));
  };
  return [...template.content.childNodes].map(convert);
}

export const MarkdownBlock = memo(function MarkdownBlock({ text, copyLabel, create }: { text: string; copyLabel: string; copiedLabel: string; create: Create }) {
  const children = useMemo(() => htmlNodes(create(copyLabel)(text)), [create, copyLabel, text]);
  return <>{children}</>;
});

export function Markdown({ text, copyLabel, copiedLabel }: { text: string; copyLabel: string; copiedLabel: string }) {
  const [create, setCreate] = useState<Create | undefined>(() => loaded);
  useEffect(() => {
    if (!create) void loadRenderer().then((c) => setCreate(() => c));
  }, [create]);
  const blocks = useMemo(() => splitStableMarkdown(text), [text]);
  if (!create) return <div class="message-markdown message-plain">{text}</div>;
  const occurrences = new Map<string, number>();
  const keyed = (block: string) => { const occurrence = occurrences.get(block) ?? 0; occurrences.set(block, occurrence + 1); return `markdown:${block}:${occurrence}`; };
  return <div class="message-markdown" data-reading-body="" onClick={e => { const target = e.target as HTMLElement; if (target.hasAttribute("data-copy")) copyFrom(target, copiedLabel); }}>{blocks.stable.map(block => <MarkdownBlock key={keyed(block)} text={block} copyLabel={copyLabel} copiedLabel={copiedLabel} create={create} />)}{blocks.tail ? <MarkdownBlock key={keyed(blocks.tail)} text={blocks.tail} copyLabel={copyLabel} copiedLabel={copiedLabel} create={create} /> : null}</div>;
}

export function Message({ bot, who, at, text, copyLabel, copiedLabel, children }: { bot: boolean; who: string | {readonly label:string;readonly href:string;readonly sourceId:string;readonly role:string;readonly fallbackId?:string}; at?: string | undefined; text: string; copyLabel: string; copiedLabel: string; children?: ComponentChildren }) {
  return (
    <div class="msg">
      <div class={bot ? "av message-bot" : "av"}>
        {bot ? <img class="character-avatar" src={characterAssets.neutral} alt="" /> : <Icon role="message.user" />}
      </div>
      <div>
        <div class="message-sender">
          {typeof who === "string" ? who : <a href={who.href} title={who.sourceId} aria-label={`${who.role}: ${who.label} (${who.sourceId})`}>{who.label}{who.fallbackId ? <> <code class="sender-id">{who.fallbackId}</code></> : null}</a>}
          {at ? <small class="mono">{at}</small> : null}
        </div>
        <Markdown text={text} copyLabel={copyLabel} copiedLabel={copiedLabel} />
        {children}
      </div>
    </div>
  );
}
