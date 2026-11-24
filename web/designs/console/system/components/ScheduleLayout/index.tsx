// Styles: style.css in this directory
import type { ComponentChildren } from "preact";

export function ScheduleLayout({ children }: { children: ComponentChildren }) {
  return <section class="schedule-section">{children}</section>;
}

export function ScheduleRow({ children, kind }: { children: ComponentChildren; kind: "schedule" | "service" }) {
  return <div class="schedule-row" data-schedule-row={kind}>{children}</div>;
}
export function ScheduleControl({ children, remove }: { children: ComponentChildren; remove?: boolean }) {
  return <span class={remove ? "schedule-remove" : "schedule-control"}>{children}</span>;
}
export function ScheduleDetailLayout({ children }: { children: ComponentChildren }) {
  return <div class="schedule-detail">{children}</div>;
}
export function ScheduleActions({ children }: { children: ComponentChildren }) {
  return <div class="schedule-detail-actions">{children}</div>;
}
