/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import cli from "../../../src/main.rs?raw";
import debug from "../../debug/index.html?raw";
import { LANGS, MESSAGES, translator } from "../src/i18n";

describe("generic remote access copy", () => {
  it("keeps English/Japanese keys aligned", () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.ja).sort());
  });
  it.each(LANGS)("describes reachable HTTPS hosts without a transport dependency (%s)", lang => {
    const t = translator(lang);
    for (const key of ["pair.noHosts", "studio.remoteGuide", "studio.hostGuide"] as const) {
      expect(t(key)).not.toMatch(/tailscale|tailnet/i);
    }
    expect(t("pair.noHosts")).toContain("HTTPS");
    expect(t("pair.noHosts")).toContain("--allow-host");
    expect(t("pair.noHosts")).toMatch(/User Guide|ユーザーガイド/);
    expect(t("studio.remoteGuide")).toContain("VPN");
    expect(t("studio.remoteGuide")).toMatch(/loopback|ループバック/);
    expect(t("studio.hostGuide")).toContain("HOSTNAME");
    expect(t("studio.hostGuide")).toContain("--no-auth");
    expect(t("studio.hostGuide")).toMatch(/other devices|ほかの端末/);
  });
  it("keeps CLI and debug no-auth warnings generic and prohibits public exposure", () => {
    for (const text of [cli, debug]) {
      expect(text).not.toMatch(/tailnet|tailnet-only/i);
      expect(text).toContain("public");
      expect(text).toContain("Funnel");
    }
    expect(cli).toContain("NEVER expose");
  });
});
