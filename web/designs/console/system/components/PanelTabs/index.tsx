import { useState } from "preact/hooks";
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
  const [railFocus, setRailFocus] = useState<string>();
  return <div class={`panel-tabs${props.rail ? " panel-tabs-rail" : ""}`} role="tablist" aria-label={props.label} aria-orientation={props.rail ? "vertical" : "horizontal"} onKeyDown={event => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || tabs.length === 0) return;
    const next = event.key === (props.rail ? "ArrowDown" : "ArrowRight") ? (index + 1) % tabs.length
      : event.key === (props.rail ? "ArrowUp" : "ArrowLeft") ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); tabs[next]?.focus(); if (!props.rail) props.onSelect(props.items[next]!.id); }
  }}>
    {props.items.map(item => <button type="button" role="tab" aria-selected={props.selected === item.id} aria-controls={`panel-page-${item.id}`} id={`panel-tab-${item.id}`} aria-label={item.count ? `${item.label} ${item.count}` : item.label} data-panel-tab={item.id} aria-describedby={props.rail ? `panel-tip-${item.id}` : undefined} onFocus={() => { if (props.rail) setRailFocus(item.id); }} tabIndex={(props.rail ? railFocus ?? props.selected : props.selected) === item.id ? 0 : -1} key={item.id} onClick={() => props.onSelect(item.id)}>
      <Icon role={item.icon} size="small" /><span class="panel-tab-label">{item.label}</span>{item.count ? <span class="panel-tab-count">{item.count}</span> : null}
    {props.rail ? <span id={`panel-tip-${item.id}`} class="panel-tab-tip" role="tooltip">{item.label}</span> : null}
    </button>)}
  </div>;
}
