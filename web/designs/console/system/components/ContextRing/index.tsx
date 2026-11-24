import { Button } from "../Button";
import type { ContextRingState } from "../../../../../ui-core/src";

export function ContextRing({ fill, state, label, stateLabel, onOpen }: {
  fill: number | undefined; state: ContextRingState; label: string; stateLabel: string; onOpen: () => void;
}) {
  return <Button variant="ghost" icon label={`${label}: ${stateLabel}`} title={`${label}: ${stateLabel}`} onClick={onOpen}>
      <span class="context-ring-motion" data-running={state === "summarizing" ? "" : undefined}>
        <svg class="context-ring" viewBox="0 0 24 24" aria-hidden="true" data-context-state={state}>
          <circle class="context-ring-track" cx="12" cy="12" r="9" />
          {state === "summarizing" ? <circle class="context-ring-activity" cx="12" cy="12" r="9" pathLength="100" />
            : fill === undefined ? null : <circle cx="12" cy="12" r="9" pathLength="100" stroke-dasharray={`${fill} 100`} transform="rotate(-90 12 12)" />}
        </svg>
      </span>
  </Button>;
}
