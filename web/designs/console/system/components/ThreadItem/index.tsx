import type { StatusKey } from "../../../../../ui-core/src";
import { StatusMark } from "../StatusMark";
import { ChildrenChip, type ChildrenChipProps } from "../ChildrenChip";
import { ListRow } from "../ListRow";
import type { MenuEntry } from "../Menu";

export function ThreadItem(props: { href: string; linkId?: string; title: string; status: StatusKey | undefined; statusLabel: string; depth: number; current: boolean; pending: number; childrenFold?: ChildrenChipProps; sidebar?: boolean; unread?: boolean; age?: string; onSelect?: (event: MouseEvent) => void; menu?: { label: string; entries: MenuEntry[] } }) {
  const indent = props.depth > 0 ? { marginLeft: `${Math.min(props.depth, 3) * 16}px` } : undefined;
  return <ListRow rowProps={{ class: `thread-item-root${props.depth > 0 ? " thread-item-child" : ""}${props.current ? " current" : ""}`, style: indent }} sidebar={props.sidebar} selected={props.current} menu={props.menu}><a id={props.linkId} class="tree-link" href={props.href} aria-current={props.current ? "true" : undefined} onClick={props.onSelect} onKeyDown={event => {
    const fold = props.childrenFold;
    if (!fold?.onToggle || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault(); fold.onToggle(event.key === "ArrowRight");
  }}>{props.status ? <StatusMark status={props.status} label={props.statusLabel} word={false} /> : null}{props.sidebar && props.unread ? <strong class="thread-item-name" data-unread>{props.title}</strong> : <span class="thread-item-name">{props.title}</span>}{props.pending > 0 ? <span class="count">{props.pending}</span> : null}</a>{props.childrenFold ? <ChildrenChip {...props.childrenFold} /> : null}{props.age ? <span class="thread-item-age">{props.age}</span> : null}</ListRow>;
}
