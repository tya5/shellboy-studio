import { readRightPanelWidth, readSidebarWidth, type Prefs } from "../../../ui-core/src/prefs";

export function layoutWidthStyle({ sidebarWidth, rightPanelWidth }: Pick<Prefs, "sidebarWidth" | "rightPanelWidth">) {
  return {
    ...(Number.isFinite(sidebarWidth) && { "--size-sidebar": `${readSidebarWidth(sidebarWidth)}px` }),
    ...(Number.isFinite(rightPanelWidth) && { "--size-right-panel": `${readRightPanelWidth(rightPanelWidth)}px` }),
  };
}
