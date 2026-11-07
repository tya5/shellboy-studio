import { describe, expect, it } from "vitest";
import { APP_TEMPLATES, recentAppFolders } from "../src";

describe("new app drafts", () => {
  it("has localized prompts, not bundled apps", () => {
    expect(APP_TEMPLATES).toHaveLength(5);
    for (const template of APP_TEMPLATES) for (const lang of ["en", "ja"] as const) {
      expect(template.title[lang]).toBeTruthy();
      expect(template.draft[lang]).toBeTruthy();
    }
  });
  it("orders known folders by the loaded thread list without inventing names", () => {
    expect(recentAppFolders(["/a", "/b", "/c"], ["/b", "/missing", "/b", "/a"])).toEqual(["/b", "/a", "/c"]);
  });
});
