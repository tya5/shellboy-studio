import { Button } from "../Button";

export function Switch({ label, stateLabel, checked, disabled, describedBy, onChange }: {
  label: string; stateLabel: string; checked: boolean; disabled?: boolean; describedBy?: string;
  onChange: (checked: boolean) => void;
}) {
  return <Button class="setting-switch" role="switch" aria-label={label} aria-checked={checked}
    aria-describedby={describedBy} disabled={disabled} onClick={() => onChange(!checked)}>
    <span class="setting-switch-track" aria-hidden="true" />
    <span aria-hidden="true">{stateLabel}</span>
  </Button>;
}
