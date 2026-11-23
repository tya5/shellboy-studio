import { useId, useState } from "preact/hooks";
import { Button } from "../Button";
import { Popover } from "../Popover";
import { KeyValue } from "../KeyValue";

import type { ContextRingState } from "../../../../../ui-core/src";

export function ContextRing({ fill, state, label, stateLabel, rows }: {
  fill: number | undefined; state: ContextRingState; label: string; stateLabel: string; rows: { key: string; value: string }[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();
  return <>
    <Button icon label={`${label}: ${stateLabel}`} title={`${label}: ${stateLabel}`} aria-expanded={!!anchor} aria-controls={anchor ? id : undefined} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}>
      <svg class="context-ring" viewBox="0 0 24 24" aria-hidden="true" data-context-state={state}>
        <circle class="context-ring-track" cx="12" cy="12" r="9" />
        {state === "summarizing" ? <circle class="context-ring-activity" cx="12" cy="12" r="9" pathLength="100" />
          : <circle cx="12" cy="12" r="9" pathLength="100" stroke-dasharray={`${fill} 100`} transform="rotate(-90 12 12)" />}
      </svg>
    </Button>
    <Popover open={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} className="context-ring-popover">
      <div id={id}><strong>{label}</strong><KeyValue rows={rows} /></div>
    </Popover>
  </>;
}
