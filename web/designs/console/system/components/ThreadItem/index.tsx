import type { StatusKey } from "../../../../../ui-core/src";
import { StatusMark } from "../StatusMark";
import { useRowMenu } from "../useRowMenu";
import type { MenuEntry } from "../Menu";

export function ThreadItem(props: { href: string; linkId?: string; title: string; status: StatusKey | undefined; statusLabel: string; depth: number; current: boolean; pending: number; onSelect?: () => void; menu?: { label: string; entries: MenuEntry[] } }) {
  const rowMenu = useRowMenu(props.menu);
  const indent = props.depth > 0 ? { marginLeft: `${Math.min(props.depth, 3) * 16}px` } : undefined;
  return <div class={`tree-item${props.depth > 0 ? " child" : ""}${props.current ? " current" : ""}${rowMenu.open ? " menu-open" : ""}`} style={indent} {...rowMenu.rowHandlers}><a id={props.linkId} class="tree-link" href={props.href} aria-current={props.current ? "true" : undefined} onClick={props.onSelect}>{props.status ? <StatusMark status={props.status} label={props.statusLabel} word={false} /> : null}<span class="name">{props.title}</span>{props.pending > 0 ? <span class="count">{props.pending}</span> : null}</a>{props.menu ? <span class="tree-action">{rowMenu.trigger}</span> : null}{rowMenu.menu}</div>;
}
