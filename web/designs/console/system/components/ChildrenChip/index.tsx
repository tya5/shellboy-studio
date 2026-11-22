import { Button } from "../Button";
import { Icon } from "../Icon";
import { StatusMark } from "../StatusMark";

export interface ChildrenChipProps { label: string; awaitingLabel: string; runningLabel: string; count: number; awaiting: number; running: number; open: boolean; onToggle: (open: boolean) => void; }
export function ChildrenChip(p: ChildrenChipProps) {
  return <span class="children-chip" data-urgency={p.awaiting ? "awaiting" : p.running ? "running" : undefined}>
    <Button variant="quiet" aria-expanded={p.open} aria-label={p.label} onClick={() => p.onToggle(!p.open)}>
      <Icon role="thread.children" size="small" />{p.count}
      {p.awaiting ? <><StatusMark status="awaiting" label={p.awaitingLabel} word={false} />{p.awaiting}</> : null}
      {p.running ? <><StatusMark status="running" label={p.runningLabel} word={false} />{p.running}</> : null}
    </Button>
  </span>;
}
