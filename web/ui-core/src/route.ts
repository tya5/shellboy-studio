// Location of the UI, as a fragment. `#token=` belongs to the entry point, not to routing.
export type ViewName = "conversation" | "monitor" | "inbox";
export interface Route {
  view: ViewName;
  threadId?: string;
}

export const START_ROUTE: Route = { view: "conversation" };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "monitor") return { view: "monitor" };
  if (parts[0] === "inbox") return { view: "inbox" };
  if (parts[0] === "conversation" && parts[1]) return { view: "conversation", threadId: decodeURIComponent(parts[1]) };
  return START_ROUTE;
}

export function formatRoute(route: Route): string {
  if (route.view === "conversation")
    return route.threadId ? `#/conversation/${encodeURIComponent(route.threadId)}` : "#/conversation";
  return `#/${route.view}`;
}
