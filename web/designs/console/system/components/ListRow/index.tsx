import type { ComponentChildren } from "preact";
import { useRowMenu } from "../useRowMenu";
import type { MenuEntry } from "../Menu";
import { Icon, type IconRole } from "../Icon";

export function ListRow(props: {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: IconRole;
  readonly selected?: boolean;
  readonly menuLabel?: string;
  readonly actions?: readonly { readonly key: string; readonly label: string; readonly run: () => void; readonly disabled?: boolean }[];
  readonly onSelect: () => void;
  readonly children?: ComponentChildren;
}) {
  const entries: MenuEntry[] | undefined = props.actions?.map(action => ({ key: action.key, label: action.label, disabled: action.disabled, onSelect: action.run }));
  const menu = useRowMenu(entries?.length ? { label: props.menuLabel ?? `Actions for ${props.title}`, entries } : undefined);
  return <div class="panel-list-row" data-panel-row-id={props.id} aria-current={props.selected ? "true" : undefined} {...menu.rowHandlers}>
    <button class="panel-list-main" type="button" title={props.title} onClick={props.onSelect}>{props.icon ? <Icon role={props.icon} size="small" /> : null}<span class="panel-list-title">{props.title}</span>{props.subtitle ? <span class="panel-list-subtitle">{props.subtitle}</span> : null}{props.children}</button>
    {menu.trigger}{menu.menu}
  </div>;
}
