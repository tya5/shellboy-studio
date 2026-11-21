import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from "../../../ui-core/src/prefs";

export function sidebarWidthStyle(width?: number): { "--size-sidebar": string } | undefined {
  if (typeof width !== "number" || !Number.isFinite(width)) return undefined;
  const clamped = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width));
  return { "--size-sidebar": `${clamped}px` };
}
