import type { StatusKey } from "../../../../../ui-core/src";
import { StatusMark } from "../StatusMark";

export function ThreadItem(props: { href: string; title: string; status: StatusKey | undefined; statusLabel: string; depth: number; current: boolean; pending: number; onSelect?: () => void }) {
  const indent = props.depth > 0 ? { marginLeft: `${Math.min(props.depth, 3) * 16}px` } : undefined;
  return (
    <a class={props.depth > 0 ? "tree-item child" : "tree-item"} style={indent} href={props.href} aria-current={props.current ? "true" : undefined} onClick={props.onSelect}>
      {props.status ? <StatusMark status={props.status} label={props.statusLabel} word={false} /> : null}
      <span class="name">{props.title}</span>
      {props.pending > 0 ? <span class="count">{props.pending}</span> : null}
    </a>
  );
}
