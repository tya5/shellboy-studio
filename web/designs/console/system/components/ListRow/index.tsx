import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { useRowMenu } from "../useRowMenu";
import type { MenuEntry } from "../Menu";
import { Icon, type IconRole } from "../Icon";

type PanelRow = {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly command?: string | undefined;
  readonly icon?: IconRole;
  readonly waiting?: boolean;
  readonly menuLabel?: string;
  readonly actions?: readonly { readonly key: string; readonly label: string; readonly run?: () => void; readonly href?: string; readonly disabled?: boolean }[];
  readonly error?: string;
  readonly feedback?: ComponentChildren;
  readonly afterActions?: ComponentChildren;
  readonly onSelect: (opener: HTMLButtonElement) => void;
};
type ThreadRow = {
  readonly sidebar?: boolean;
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
  // A panel row owns focus inside it: when an owner update removes the control that held focus
  // (for example a row action that no longer applies), focus returns to the row's own selection
  // button. Nothing moves when the person had already left the row.
  const rowRef = useRef<HTMLDivElement>(null);
  const focused = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const last = focused.current;
    if (!panel || !last || last.isConnected) return;
    focused.current = null;
    const active = document.activeElement;
    if (active === null || active === document.body) rowRef.current?.querySelector<HTMLButtonElement>(".panel-list-main")?.focus();
  });
  const focusHandlers: JSX.HTMLAttributes<HTMLDivElement> = panel ? {
    onFocusIn: event => { focused.current = event.target as Element; },
    onFocusOut: event => {
      const next = event.relatedTarget as Node | null;
      if (next) { if (!rowRef.current?.contains(next)) focused.current = null; return; }
      // Focus went nowhere: the person left unless the control itself is being removed.
      const target = event.target as Element;
      queueMicrotask(() => { if (target.isConnected && focused.current === target) focused.current = null; });
    },
  } : {};
  return <><div {...root} class={root?.class ? `list-row ${root.class}` : "list-row"} data-row-menu-owner="" data-thread-row={thread ? true : undefined} data-sidebar-row={thread?.sidebar || undefined} data-panel-row-id={panel?.id} data-waiting={panel?.waiting || undefined} data-row-selected={props.selected || undefined} data-menu-open={menu.open || undefined} aria-current={panel && props.selected ? "true" : undefined} {...menu.rowHandlers} {...focusHandlers} ref={rowRef}>
    {panel ? <button class="panel-list-main" type="button" onClick={event => panel.onSelect(event.currentTarget)}>{panel.icon ? <Icon role={panel.icon} size="small" /> : null}{panel.command ? <span class="panel-list-copy"><span class="panel-list-title">{panel.title}</span><span class="panel-list-title mono muted caption">{panel.command}</span></span> : <span class="panel-list-title">{panel.title}</span>}{panel.subtitle ? <span class="panel-list-subtitle">{panel.subtitle}</span> : null}{props.children}</button> : props.children}
    {options ? <span class="list-row-action" data-row-action="">{menu.trigger}</span> : null}
    {props.afterActions}{menu.menu}
  </div>{panel?.error ? <div role="alert">{panel.error}</div> : null}{panel?.feedback ? <div class="list-row-feedback">{panel.feedback}</div> : null}</>;
}
