// The one place that names designs. Adding a design: a folder and an entry here. Removing one:
// its folder and its entry. The selected design is loaded by dynamic import, so only it is fetched.
import type { DesignManifest, DesignModule } from "../ui-core/src";

export interface RegisteredDesign extends DesignManifest {
  load(): Promise<DesignModule>;
}

export const DESIGNS: readonly RegisteredDesign[] = [
  {
    name: "console",
    title: "Console",
    themes: [
      { name: "console", title: "Console" },
      { name: "light", title: "Light" },
      { name: "terminal", title: "Terminal" },
    ],
    load: () => import("./console/index"),
  },
];
