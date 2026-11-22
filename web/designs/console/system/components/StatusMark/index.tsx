import type { StatusKey } from "../../../../../ui-core/src";
import { Icon, type IconRole } from "../Icon";

const CLASS: Record<StatusKey, string> = {
  running: "run",
  awaiting: "wait",
  recovery: "bad",
  completed: "ok",
  failed: "fail",
  waiting: "hold",
  stopped: "halt",
  idle: "idle",
};

/** Shape and colour both carry the state. Without `word` the label is for screen readers only. */
export function StatusMark({ status, label, word = true }: { status: StatusKey; label: string; word?: boolean }) {
  const role: IconRole | undefined = status === "completed" ? "status.complete" : status === "failed" ? "status.failed"
    : status === "running" ? "status.running" : status === "awaiting" ? "status.awaiting" : status === "idle" ? "status.idle" : undefined;
  const mark = role ? <Icon role={role} size="small" /> : <span class="dot" />;
  return (
    <span class={`st ${CLASS[status]}`} {...(word ? {} : { role: "img", "aria-label": label, title: label })} data-status={status}>
      <span class="mark">{mark}</span>
      {word ? label : null}
    </span>
  );
}
