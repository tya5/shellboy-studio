import { Icon } from "../Icon";

export function SummaryStrip({ label, text }: { label: string; text: string }) {
  return (
    <details class="strip">
      <summary>
        <Icon role="summary.details" />
        {label}
      </summary>
      <div class="body">{text}</div>
    </details>
  );
}
