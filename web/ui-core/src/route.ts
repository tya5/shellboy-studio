// Location of the UI, as a fragment. `#token=` belongs to the entry point, not to routing.
export type ViewName = "conversation" | "monitor" | "inbox" | "analytics" | "settings" | "branches" | "threads" | "apps" | "setup";
export const SETTINGS_SECTIONS = ["connections", "models", "embeddings", "shell", "storage", "compaction", "appearance"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const ANALYTICS_SECTIONS = ["overview", "tokens", "compaction", "threads", "storage", "memory", "index"] as const;
export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number];
export interface Route {
  view: ViewName;
  threadId?: string;
  /** Branches only: the point chosen on that Thread's path. */
  nodeId?: string;
  /** Apps only: the open tab. Absent shows the list. */
  appName?: string;
  /** Settings and Analytics. Absent means the first section. */
  section?: SettingsSection | AnalyticsSection;
}

/** The open Settings section, or the first. A section of another view isn't valid here. */
export const settingsSection = (route: Route): SettingsSection => SETTINGS_SECTIONS.find((s) => s === route.section) ?? SETTINGS_SECTIONS[0];
export const analyticsSection = (route: Route): AnalyticsSection => ANALYTICS_SECTIONS.find((s) => s === route.section) ?? ANALYTICS_SECTIONS[0];

export const START_ROUTE: Route = { view: "conversation" };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "monitor") return { view: "monitor" };
  if (parts[0] === "inbox") return { view: "inbox" };
  if (parts[0] === "setup") return { view: "setup" };
  if (parts[0] === "threads") return { view: "threads" };
  if (parts[0] === "apps") return parts[1] ? { view: "apps", appName: decodeURIComponent(parts[1]) } : { view: "apps" };
  if (parts[0] === "branches") {
    if (!parts[1]) return { view: "branches" };
    const threadId = decodeURIComponent(parts[1]);
    return parts[2] ? { view: "branches", threadId, nodeId: decodeURIComponent(parts[2]) } : { view: "branches", threadId };
  }
  if (parts[0] === "analytics") {
    const section = ANALYTICS_SECTIONS.find((s) => s === parts[1]);
    return section ? { view: "analytics", section } : { view: "analytics" };
  }
  if (parts[0] === "settings") {
    const section = SETTINGS_SECTIONS.find((s) => s === parts[1]);
    return section ? { view: "settings", section } : { view: "settings" };
  }
  if (parts[0] === "conversation" && parts[1]) return { view: "conversation", threadId: decodeURIComponent(parts[1]) };
  return START_ROUTE;
}

export function formatRoute(route: Route): string {
  if (route.view === "conversation")
    return route.threadId ? `#/conversation/${encodeURIComponent(route.threadId)}` : "#/conversation";
  if (route.view === "apps" && route.appName) return `#/apps/${encodeURIComponent(route.appName)}`;
  if (route.view === "branches" && route.threadId) {
    const thread = `#/branches/${encodeURIComponent(route.threadId)}`;
    return route.nodeId ? `${thread}/${encodeURIComponent(route.nodeId)}` : thread;
  }
  if ((route.view === "settings" || route.view === "analytics") && route.section) return `#/${route.view}/${route.section}`;
  return `#/${route.view}`;
}
