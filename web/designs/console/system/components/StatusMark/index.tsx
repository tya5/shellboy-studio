import type { ShellStatusKey, StatusKey } from "../../../../../ui-core/src";
import { Icon, type IconRole } from "../Icon";

type FeedbackStatus = "completed" | "recovery" | "waiting";
const MARK: Record<StatusKey | ShellStatusKey | FeedbackStatus, [string, IconRole | undefined]> = {
  running: ["run", "status.running"], awaiting: ["wait", "status.awaiting"], error: ["bad", "status.error"],
  waiting: ["hold", "status.waiting"], idle: ["idle", "status.idle"],
  recovery: ["bad", undefined], completed: ["ok", "status.complete"], failed: ["fail", "status.failed"], stopped: ["halt", undefined],
};

type Props = { label: string; word?: boolean } & ({ status: StatusKey; shell?: false; feedback?: false } | { status: ShellStatusKey; shell: true; feedback?: false } | { status: FeedbackStatus; feedback: true; shell?: false });

/** Shape and colour both carry the state. Without `word` the label is for screen readers only. */
export function StatusMark({ status, label, word = true }: Props) {
  const [tone, role] = MARK[status];
  const arc = status === "running";
  return (
    <span class={`st ${tone}`} {...(word ? {} : { role: "img", "aria-label": label, title: label })} data-status={status}>
      <span class="mark status-shape" data-running-arc={arc || undefined}>{role ? <Icon role={role} size="small" /> : <span class="dot" />}</span>
      {word ? label : null}
    </span>
  );
}
