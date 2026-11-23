export function ListDivider(props: { readonly label: string; readonly count?: number }) {
  return <h3 class="group-label panel-list-divider"><span>{props.label}</span>{props.count ? <span class="panel-list-divider-count">{props.count}</span> : null}</h3>;
}
