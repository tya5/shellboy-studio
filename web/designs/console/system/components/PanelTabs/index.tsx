import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Icon, type IconRole } from "../Icon";

export interface PanelTabItem {
  readonly id: string;
  readonly label: string;
  readonly icon: IconRole;
  readonly count?: number | `${number}+`;
}

export function PanelTabs(props: {
  readonly label: string;
  readonly items: readonly PanelTabItem[];
  readonly selected: string;
  readonly rail?: boolean;
  readonly placement?: "dock" | "sheet";
  readonly onSheetActiveLabel?: (label: string | undefined) => void;
  readonly onSelect: (id: string) => void;
}) {

  const [railFocus, setRailFocus] = useState<string>();
  const availableWidth = useRef<HTMLDivElement>(null);
  const fullRow = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"all" | "active" | "icons">("all");
  useLayoutEffect(() => {
    const widthSource = availableWidth.current;
    const full = fullRow.current;
    const active = activeRow.current;
    if (props.rail || !widthSource || !full || !active) return;
    const fit = () => {
      const width = widthSource.getBoundingClientRect().width;
      setMode(full.getBoundingClientRect().width <= width ? "all" : active.getBoundingClientRect().width <= width ? "active" : "icons");
    };
    fit();
    const observer = new ResizeObserver(fit);
    for (const element of [widthSource, full, active]) observer.observe(element);
    return () => observer.disconnect();
  }, [props.rail]);
  const activeLabel = mode === "icons" ? props.items.find(item => item.id === props.selected)?.label : undefined;
  useLayoutEffect(() => { props.onSheetActiveLabel?.(activeLabel); }, [props.onSheetActiveLabel, activeLabel]);
  const parts = (item: PanelTabItem) => <>
    <Icon role={item.icon} size="small" />
    <span class="panel-tab-label">{item.label}</span>
    {item.count ? <span class="panel-tab-count">{item.count}</span> : null}
  </>;
  const measureItems = () => props.items.map(item => <span key={item.id} class="panel-tab" data-selected={props.selected === item.id}>{parts(item)}</span>);
  return <div class="panel-tabs-control" data-tab-placement={props.placement ?? "dock"}>
    {!props.rail ? <div ref={availableWidth} class="panel-tabs-measure" aria-hidden="true">
      <div ref={fullRow} class="panel-tabs-row">{measureItems()}</div>
      <div ref={activeRow} class="panel-tabs-row" data-labels="active">{measureItems()}</div>
    </div> : null}
    {!props.rail && props.placement !== "sheet" && activeLabel ? <h2 class="panel-tabs-heading">{props.label} · {activeLabel}</h2> : null}
    <div class={`panel-tabs${props.rail ? " panel-tabs-rail" : " panel-tabs-row"}`} data-labels={props.rail ? undefined : mode} role="tablist" aria-label={props.label} aria-orientation={props.rail ? "vertical" : "horizontal"} onKeyDown={event => {
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || tabs.length === 0) return;
    const next = event.key === (props.rail ? "ArrowDown" : "ArrowRight") ? (index + 1) % tabs.length
      : event.key === (props.rail ? "ArrowUp" : "ArrowLeft") ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); tabs[next]?.focus(); if (!props.rail) props.onSelect(props.items[next]!.id); }
  }}>
    {props.items.map(item => <button type="button" class="panel-tab" role="tab" aria-selected={props.selected === item.id} aria-controls={`panel-page-${item.id}`} id={`panel-tab-${item.id}`} aria-label={item.count ? `${item.label} ${item.count}` : item.label} data-panel-tab={item.id} aria-describedby={props.rail ? `panel-tip-${item.id}` : undefined} onFocus={() => { if (props.rail) setRailFocus(item.id); }} tabIndex={(props.rail ? railFocus ?? props.selected : props.selected) === item.id ? 0 : -1} key={item.id} onClick={() => props.onSelect(item.id)}>
      {parts(item)}
      {props.rail && <span id={`panel-tip-${item.id}`} class="panel-tab-tip" role="tooltip">{item.label}</span>}
    </button>)}
    </div>
  </div>;
}
