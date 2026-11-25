import type { ComponentChildren } from "preact";

export function ListDivider(props: { readonly label: string; readonly count?: number; readonly action?: ComponentChildren; readonly description?: string }) {
  return <div class="panel-list-divider-group">
    <div class="panel-list-divider-row"><h3 class="group-label panel-list-divider"><span>{props.label}</span>{props.count ? <span class="panel-list-divider-count">{props.count}</span> : null}</h3>{props.action}</div>
    {props.description ? <p class="panel-list-divider-description">{props.description}</p> : null}
  </div>;
}
