import type { StatusKey } from "../../../../../ui-core/src";
import { StatusMark } from "../StatusMark";
import { ChildrenChip, type ChildrenChipProps } from "../ChildrenChip";
import type { ComponentChildren } from "preact";
import { ListRow } from "../ListRow";
import type { MenuEntry } from "../Menu";

export function ThreadItem(props: { href: string; linkId?: string; title: string; status: StatusKey | undefined; statusLabel: string; depth: number; treePosition?: { setsize: number; posinset: number }; current: boolean; pending: number; pendingExact?: boolean; childrenFold?: ChildrenChipProps; sidebar?: boolean; beforeLink?: ComponentChildren; unread?: boolean; age?: ComponentChildren; onSelect?: () => void; menu?: { label: string; entries: MenuEntry[] } }) {
  const depthClass = props.sidebar && props.depth > 0 ? ` thread-item-depth-${Math.min(props.depth, 3)}` : "";
  return <ListRow rowProps={{ class: `thread-item-root${props.depth > 0 ? " thread-item-child" : ""}${props.current ? " current" : ""}${depthClass}` }} sidebar={props.sidebar} selected={props.current} menu={props.menu}>{props.beforeLink}<a id={props.linkId} class="tree-link" href={props.href} role={props.treePosition ? "treeitem" : undefined}
    aria-level={props.treePosition ? props.depth + 1 : undefined} aria-expanded={props.treePosition ? props.childrenFold?.open : undefined}
    aria-setsize={props.treePosition?.setsize} aria-posinset={props.treePosition?.posinset} aria-current={props.current ? "true" : undefined} onClick={props.onSelect} onKeyDown={event => {
    const fold = props.childrenFold;
    if (!fold?.onToggle || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    if (props.treePosition && ((event.key === "ArrowRight") === fold.open)) return;
    event.preventDefault(); fold.onToggle(event.key === "ArrowRight");
  }}>{props.status ? <StatusMark status={props.status} label={props.statusLabel} word={false} /> : null}{props.sidebar && props.unread ? <strong class="thread-item-name" data-unread>{props.title}</strong> : <span class="thread-item-name">{props.title}</span>}{props.pending > 0 ? <span class="count">{props.pending}{props.pendingExact === false ? "+" : ""}</span> : null}</a>{props.childrenFold ? <ChildrenChip {...props.childrenFold} /> : null}{props.age ? <span class="thread-item-age">{props.age}</span> : null}</ListRow>;
}
