import type { StatusKey } from "../../../../../ui-core/src";
import { StatusMark } from "../StatusMark";

export function Chip({ status, label, count, pressed, onClick }: { status: StatusKey; label: string; count: number; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" class="chip" aria-pressed={pressed} onClick={onClick}>
      <StatusMark status={status} label={label} />
      <b>{count}</b>
    </button>
  );
}
