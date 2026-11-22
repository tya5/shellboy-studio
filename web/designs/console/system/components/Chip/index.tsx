import type { StatusKey } from "../../../../../ui-core/src";
import { Icon } from "../Icon";
import { StatusMark } from "../StatusMark";

type ChipProps = { label: string; onClick: () => void } & ({ status: StatusKey; count: number; pressed: boolean } | { removeLabel: string });
export function Chip(props: ChipProps) {
  if ("removeLabel" in props) return <button type="button" class="chip" aria-label={props.removeLabel} onClick={props.onClick}>{props.label}<Icon role="action.clearQueryFilter" size="small" /></button>;
  const { status, label, count, pressed, onClick } = props;
  return (
    <button type="button" class="chip" aria-pressed={pressed} onClick={onClick}>
      <StatusMark status={status} label={label} />
      <b>{count}</b>
    </button>
  );
}
