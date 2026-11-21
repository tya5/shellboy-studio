import { Icon, type IconRole } from "../Icon";

export interface PanelTabItem {
  readonly id: string;
  readonly label: string;
  readonly icon: IconRole;
  readonly count?: number;
}

export function PanelTabs(props: {
  readonly label: string;
  readonly items: readonly PanelTabItem[];
  readonly selected: string;
  readonly rail?: boolean;
  readonly onSelect: (id: string) => void;
}) {
  return <div class={`panel-tabs${props.rail ? " panel-tabs-rail" : ""}`} role="tablist" aria-label={props.label} aria-orientation={props.rail ? "vertical" : "horizontal"} onKeyDown={event => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); tabs[next]?.focus(); props.onSelect(props.items[next]!.id); }
  }}>
    {props.items.map(item => <button type="button" role="tab" aria-selected={props.selected === item.id} aria-controls={`panel-page-${item.id}`} id={`panel-tab-${item.id}`} title={item.label} aria-label={item.count ? `${item.label} ${item.count}` : item.label} data-panel-tab={item.id} tabIndex={props.selected === item.id ? 0 : -1} key={item.id} onClick={() => props.onSelect(item.id)}>
      <Icon role={item.icon} size="small" /><span class="panel-tab-label">{item.label}</span>{item.count ? <span class="panel-tab-count">{item.count}</span> : null}
    </button>)}
  </div>;
}
