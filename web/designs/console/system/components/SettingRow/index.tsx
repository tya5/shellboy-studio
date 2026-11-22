import type { ComponentChildren } from "preact";

/** An editable setting: label and explanation at left, control and feedback at right. */
export function SettingRow({ label, description, control, feedback }: { label: string; description?: ComponentChildren; control: ComponentChildren; feedback?: ComponentChildren }) {
  return <div class="setting-row" data-setting-label={label}><div class="setting-row-copy"><div class="setting-row-label">{label}</div>{description ? <div class="muted caption">{description}</div> : null}{feedback ? <div class="setting-row-feedback muted caption">{feedback}</div> : null}</div><div class="setting-row-control">{control}</div></div>;
}
