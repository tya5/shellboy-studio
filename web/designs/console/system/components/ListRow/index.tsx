import type { ComponentChildren, JSX } from "preact";
import { useRowMenu } from "../useRowMenu";
import type { MenuEntry } from "../Menu";
import { Icon, type IconRole } from "../Icon";

type PanelRow = {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: IconRole;
  readonly waiting?: boolean;
  readonly menuLabel?: string;
  readonly actions?: readonly { readonly key: string; readonly label: string; readonly run?: () => void; readonly href?: string; readonly disabled?: boolean }[];
  readonly error?: string;
  readonly onSelect: (opener: HTMLButtonElement) => void;
};
type ThreadRow = {
  readonly rowProps: Pick<JSX.HTMLAttributes<HTMLDivElement>, "class" | "style" | "draggable" | "onDragStart" | "onDragOver" | "onDragLeave" | "onDrop">;
  readonly menu?: { label: string; entries: MenuEntry[] };
  readonly afterActions?: ComponentChildren;
};

export function ListRow(props: (PanelRow | ThreadRow) & { readonly selected?: boolean; readonly children?: ComponentChildren }) {
  const panel = "onSelect" in props ? props : undefined;
  const thread = "rowProps" in props ? props : undefined;
  const entries: MenuEntry[] | undefined = panel?.actions?.map(action => ({ key: action.key, label: action.label, disabled: action.disabled, onSelect: action.run, href: action.href }));
  const options = thread?.menu ?? (panel && entries?.length ? { label: panel.menuLabel ?? `Actions for ${panel.title}`, entries } : undefined);
  const menu = useRowMenu(options);
  const root = thread?.rowProps;
  return <><div {...root} class={root?.class ? `list-row ${root.class}` : "list-row"} data-thread-row={thread ? true : undefined} data-panel-row-id={panel?.id} data-waiting={panel?.waiting || undefined} data-row-selected={props.selected || undefined} data-menu-open={menu.open || undefined} aria-current={panel && props.selected ? "true" : undefined} {...menu.rowHandlers}>
    {panel ? <button class="panel-list-main" type="button" onClick={event => panel.onSelect(event.currentTarget)}>{panel.icon ? <Icon role={panel.icon} size="small" /> : null}<span class="panel-list-title">{panel.title}</span>{panel.subtitle ? <span class="panel-list-subtitle">{panel.subtitle}</span> : null}{props.children}</button> : props.children}
    {options ? <span class="list-row-action" data-row-action="">{menu.trigger}</span> : null}
    {thread?.afterActions}{menu.menu}
  </div>{panel?.error ? <div role="alert">{panel.error}</div> : null}</>;
}
