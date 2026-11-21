import type { ComponentChildren } from "preact";
import type { StatusKey } from "../../../../../ui-core/src";
import { StatusMark } from "../StatusMark";

export function ThreadItem(props: { href: string; title: string; status: StatusKey | undefined; statusLabel: string; depth: number; current: boolean; pending: number; onSelect?: () => void; action?: ComponentChildren }) {
  const indent = props.depth > 0 ? { marginLeft: `${Math.min(props.depth, 3) * 16}px` } : undefined;
  return (
    <div class={`tree-item${props.depth > 0 ? " child" : ""}${props.current ? " current" : ""}`} style={indent} onContextMenu={(event) => { const target = event.currentTarget.querySelector<HTMLElement>(".thread-menu-anchor"); if (target) { event.preventDefault(); target.dispatchEvent(new CustomEvent("thread-menu-open", { bubbles: true, detail: { opener: event.target instanceof HTMLElement ? event.target : undefined } })); } }} onKeyDown={(event) => { if (event.key === "ArrowDown") { const target = event.currentTarget.querySelector<HTMLElement>(".thread-menu-anchor"); if (target) { event.preventDefault(); target.dispatchEvent(new CustomEvent("thread-menu-open", { bubbles: true, detail: { opener: event.target instanceof HTMLElement ? event.target : undefined } })); } } }}>
      <a class="tree-link" href={props.href} aria-current={props.current ? "true" : undefined} onClick={props.onSelect}>
        {props.status ? <StatusMark status={props.status} label={props.statusLabel} word={false} /> : null}
        <span class="name">{props.title}</span>
        {props.pending > 0 ? <span class="count">{props.pending}</span> : null}
      </a>
      {props.action ? <span class="tree-action">{props.action}</span> : null}
    </div>
  );
}
