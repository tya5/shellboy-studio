import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "../Icon";
import "./style.css";

// Display adapter inputs, not a substitute for canonical CASE facts.
type DisplayFacts = {
  typeIcon: IconName;
  typeAccessibleLabel: string;
  contentLabel: string;
  state: string | null;
  anchorKey: string;
};

export type WorkElementRowProps = DisplayFacts & (
  | {
      detailPolicy: "none" | "unavailable";
      children?: never;
      open?: never;
      onToggle?: never;
    }
  | {
      detailPolicy: "actual-safe-typed" | "existing-shell-output";
      children: ComponentChildren;
      open: boolean;
      onToggle: (next: boolean) => void;
    }
);

/** Caller owns CASE selection, safe content, identity, and bounded detail lifetime. */
export function WorkElementRow(props: WorkElementRowProps) {
  if (!props.contentLabel.trim()) throw new Error("WorkElementRow requires factual contentLabel");
  const accessibleLabel = [props.typeAccessibleLabel, props.contentLabel, props.state].filter(value => value !== null && value !== "").join(". ");
  const line = (
    <>
      <span class="work-element-row__icon"><Icon name={props.typeIcon} /></span>
      <span class="work-element-row__content">{props.contentLabel}</span>
      {props.state !== null && <span class="work-element-row__state">{props.state}</span>}
    </>
  );
  if (props.detailPolicy === "none" || props.detailPolicy === "unavailable") {
    return (
      <div class="work-element-row" data-work-element-key={props.anchorKey} data-detail-policy={props.detailPolicy}>
        <div class="work-element-row__line" role="group" aria-label={accessibleLabel}>{line}</div>
      </div>
    );
  }
  if (props.children == null || typeof props.children === "boolean" || props.children === "") {
    throw new Error("WorkElementRow disclosure requires actual detail");
  }
  return (
    <details class="work-element-row" data-work-element-key={props.anchorKey} data-detail-policy={props.detailPolicy}
      open={props.open} onToggle={event => {
        const next = event.currentTarget.open;
        // Native toggle also fires after controlled open synchronization.
        if (next !== props.open) props.onToggle(next);
      }}>
      <summary class="work-element-row__line" aria-label={accessibleLabel}>{line}</summary>
      <div class="work-element-row__detail">{props.children}</div>
    </details>
  );
}
