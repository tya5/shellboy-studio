// Location of the UI, as a fragment. `#token=` belongs to the entry point, not to routing.
export type ViewName = "conversation" | "monitor" | "inbox" | "analytics" | "settings";
export const SETTINGS_SECTIONS = ["connections", "models", "embeddings", "shell", "storage", "compaction", "appearance"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export interface Route {
  view: ViewName;
  threadId?: string;
  /** Settings only. Absent means the first section. */
  section?: SettingsSection;
}

export const START_ROUTE: Route = { view: "conversation" };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "monitor") return { view: "monitor" };
  if (parts[0] === "inbox") return { view: "inbox" };
  if (parts[0] === "analytics") return { view: "analytics" };
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
  if (route.view === "settings" && route.section) return `#/settings/${route.section}`;
  return `#/${route.view}`;
}
