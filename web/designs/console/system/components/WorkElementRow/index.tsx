import type { ComponentChildren } from "preact";
import { Icon, type IconName } from "../Icon";
import type { WorkElementDisplay } from "../../../../../ui-core/src/work-element-display";
import "./style.css";

export interface FormattedWorkElementDisplay {
  readonly source: WorkElementDisplay;
  readonly context: WorkElementDisplay["contentLabel"]["context"];
  readonly typeIcon: IconName;
  readonly typeAccessibleLabel: string;
  readonly contentLabel: string;
  readonly state: string | null;
  readonly stateSourceLabel: "CLIENT" | null;
  readonly detailPolicy: WorkElementDisplay["detailPolicy"];
}

/** Formatting only: retain issued facts and provenance without joins or classification. */
export function formatWorkElementDisplay(source: WorkElementDisplay): FormattedWorkElementDisplay {
  const typeIcon: IconName = source.typeIcon;
  return {
    source, context: source.contentLabel.context, typeIcon,
    typeAccessibleLabel: source.typeAccessibleLabel,
    contentLabel: source.contentLabel.text,
    state: source.state === null ? null : source.state.value,
    stateSourceLabel: source.state?.source === "client" ? "CLIENT" : null,
    detailPolicy: source.detailPolicy,
  };
}

// Callers pass the formatted bundle unchanged; control and lifetime stay caller-owned.
type DisplayFacts = {
  display: FormattedWorkElementDisplay;
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
  const { display } = props;
  if (display.detailPolicy !== props.detailPolicy) throw new Error("WorkElementRow detail policy mismatch");
  if (!display.contentLabel.trim()) throw new Error("WorkElementRow requires factual contentLabel");
  const accessibleLabel = [display.typeAccessibleLabel, display.contentLabel, display.stateSourceLabel, display.state].filter(value => value !== null && value !== "").join(". ");
  const line = (
    <>
      <span class="work-element-row__icon"><Icon name={display.typeIcon} /></span>
      <span class="work-element-row__content">{display.contentLabel}</span>
      {display.state !== null && <span class="work-element-row__state">{display.stateSourceLabel !== null && <span>{display.stateSourceLabel}{" "}</span>}{display.state}</span>}
    </>
  );
  if (props.detailPolicy === "none" || props.detailPolicy === "unavailable") {
    return (
      <div class="work-element-row" data-work-element-key={props.anchorKey} data-state-source={display.source.state?.source} data-state-value={display.source.state?.value} data-exit-code={display.source.state?.exitCode ?? undefined} data-detail-policy={props.detailPolicy}>
        <div class="work-element-row__line" role="group" aria-label={accessibleLabel} title={display.typeAccessibleLabel}>{line}</div>
      </div>
    );
  }
  if (props.children == null || typeof props.children === "boolean" || props.children === "") {
    throw new Error("WorkElementRow disclosure requires actual detail");
  }
  return (
    <details class="work-element-row" data-work-element-key={props.anchorKey} data-state-source={display.source.state?.source} data-state-value={display.source.state?.value} data-exit-code={display.source.state?.exitCode ?? undefined} data-detail-policy={props.detailPolicy}
      open={props.open} onToggle={event => {
        const next = event.currentTarget.open;
        // Native toggle also fires after controlled open synchronization.
        if (next !== props.open) props.onToggle(next);
      }}>
      <summary class="work-element-row__line" aria-label={accessibleLabel} title={display.typeAccessibleLabel}>{line}</summary>
      <div class="work-element-row__detail">{props.children}</div>
    </details>
  );
}
