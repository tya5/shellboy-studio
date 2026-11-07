import { describe, expect, it } from "vitest";
import { LANGS, MESSAGES, type MessageKey } from "../src/i18n";
import { DIALECTS, SERVICES } from "../src/presets";

describe("service presets", () => {
  it("describes every service in every language", () => {
    for (const lang of LANGS) {
      for (const service of SERVICES) expect(MESSAGES[lang][`setup.svc.${service.id}` as MessageKey]).toBeTruthy();
    }
  });

  it("uses a known dialect, and an address unless the person supplies it", () => {
    for (const service of SERVICES) {
      expect(DIALECTS).toContain(service.api);
      if (!service.urlEditable) expect(service.baseUrl).toMatch(/^https:\/\//);
    }
  });
});
