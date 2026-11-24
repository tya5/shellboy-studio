import { characterAssets } from "../../character-assets";
import { h, type ComponentChild, type ComponentChildren } from "preact";
import { memo } from "preact/compat";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Icon } from "../Icon";
import { CopyButton } from "../CopyButton";

type Create = () => (text: string) => string;
let loaded: Create | undefined;
let loading: Promise<Create> | undefined;
const loadRenderer = (): Promise<Create> => (loading ??= import("./markdown").then((m) => (loaded = m.createRenderer)));

export function splitStableMarkdown(text: string): { stable: string[]; tail: string } {
  const stable: string[] = [];
  const lines = text.split("\n");
  let start = 0;
  let fence: string | undefined;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!;
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) fence = fence === undefined ? fenceMatch[1] : (fence[0] === fenceMatch[1]![0] ? undefined : fence);
    if (fence || line.trim() !== "" || i === start || lines[i - 1]!.trim() === "") continue;
    const block = lines.slice(start, i).join("\n").trimEnd();
    const next = lines.slice(i + 1).find(value => value.trim() !== "");
    const unsafe = /^(?: {4}|\t|\s*(?:[-+*]\s|\d+[.)]\s)|\s*\[[^\]]+\]:)/m.test(block)
      || /\[[^\]]+\](?:\[[^\]]*\])?/.test(block)
      || (next !== undefined && /^(?: {4}|\t|\s*(?:[-+*]\s|\d+[.)]\s)|\s*\[[^\]]+\]:)/.test(next));
    if (block && !unsafe) { stable.push(block); start = i + 1; }
  }
  return { stable, tail: lines.slice(start).join("\n") };
}

function htmlNodes(html: string, copyLabel: string, copiedLabel: string, copyFailedLabel?: string): ComponentChildren {
  const template = document.createElement("template");
  template.innerHTML = html;
  const convert = (node: Node): ComponentChild => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    const props: Record<string, string> = {};
    for (const attribute of [...node.attributes]) props[attribute.name === "class" ? "className" : attribute.name] = attribute.value;
    const children = [...node.childNodes].map(convert);
    if (node.matches("div.message-code[data-copy]")) {
      const code = node.querySelector("pre > code");
      if (code) children.unshift(<span class="message-code-copy"><CopyButton text={code.textContent ?? ""} label={copyLabel} copiedLabel={copiedLabel} failedLabel={copyFailedLabel} /></span>);
    }
    return h(node.tagName.toLowerCase() as "div", props, children);
  };
  return [...template.content.childNodes].map(convert);
}

export const MarkdownBlock = memo(function MarkdownBlock({ text, copyLabel, copiedLabel, copyFailedLabel, create }: { text: string; copyLabel: string; copiedLabel: string; copyFailedLabel?: string; create: Create }) {
  const children = useMemo(() => htmlNodes(create()(text), copyLabel, copiedLabel, copyFailedLabel), [create, copyLabel, copiedLabel, copyFailedLabel, text]);
  return <>{children}</>;
});

export function Markdown({ text, copyLabel, copiedLabel, copyFailedLabel, live = false, renderer }: { text: string; copyLabel: string; copiedLabel: string; copyFailedLabel?: string; live?: boolean; renderer?: Create }) {
  const [create, setCreate] = useState<Create | undefined>(() => renderer ?? loaded);
  useEffect(() => {
    if (!create) void loadRenderer().then((c) => setCreate(() => c));
  }, [create]);
  const blocks = useMemo(() => live ? splitStableMarkdown(text) : { stable: [], tail: text }, [live, text]);
  if (!create) return <div class="message-markdown message-plain">{text}</div>;
  const occurrences = new Map<string, number>();
  const keyed = (block: string) => { const occurrence = occurrences.get(block) ?? 0; occurrences.set(block, occurrence + 1); return `markdown:${block}:${occurrence}`; };
  return <div class="message-markdown" data-reading-body="">{blocks.stable.map(block => <MarkdownBlock key={keyed(block)} text={block} copyLabel={copyLabel} copiedLabel={copiedLabel} copyFailedLabel={copyFailedLabel} create={create} />)}{blocks.tail ? <MarkdownBlock key={keyed(blocks.tail)} text={blocks.tail} copyLabel={copyLabel} copiedLabel={copiedLabel} copyFailedLabel={copyFailedLabel} create={create} /> : null}</div>;
}

export function Message({ bot, who, at, text, copyLabel, copiedLabel, copyFailedLabel, live = false, children }: { bot: boolean; who: string | {readonly label:string;readonly href:string;readonly sourceId:string;readonly role:string;readonly fallbackId?:string}; at?: string | undefined; text: string; copyLabel: string; copiedLabel: string; copyFailedLabel?: string; live?: boolean; children?: ComponentChildren }) {
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
        <Markdown text={text} copyLabel={copyLabel} copiedLabel={copiedLabel} copyFailedLabel={copyFailedLabel} live={live} />
        {children}
      </div>
    </div>
  );
}
