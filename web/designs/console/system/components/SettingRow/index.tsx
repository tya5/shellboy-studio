import type { ComponentChildren } from "preact";

/** A setting with either its persistent control or a read view beside explicit edit actions. */
export function SettingRow({ settingId, label, description, control, feedback, read, highlighted }: { settingId?: string; label: string; description?: ComponentChildren; control: ComponentChildren; feedback?: ComponentChildren; read?: ComponentChildren; highlighted?: boolean }) {
  return <div class="setting-row" data-setting-id={settingId} data-highlighted={highlighted || undefined}>
    <div class="setting-row-copy"><div class="setting-row-label">{label}</div>{description ? <div class="muted caption">{description}</div> : null}
      {read === undefined && feedback ? <div class="setting-row-feedback muted caption">{feedback}</div> : null}</div>
    <div class="setting-row-control">{read === undefined ? control : <div class="stack">
      <div class="band setting-read"><div>{read}</div>{control}</div>{feedback}</div>}</div>
  </div>;
}
