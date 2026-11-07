// The dependency rules that let designs live side by side.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DESIGNS } from "./registry";

const web = resolve(import.meta.dirname, "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const source = (dir: string) => walk(join(web, dir)).filter((f) => /\.(ts|tsx|mjs)$/.test(f));
const imports = (file: string): string[] => {
  const text = readFileSync(file, "utf8");
  const targets = [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)"(\.[^"]+)"/g)].map((m) => m[1]!);
  return targets.map((t) => relative(web, resolve(file, "..", t)).replaceAll("\\", "/"));
};

describe("layering", () => {
  it("nothing below the designs imports them, and data doesn't import ui-core", () => {
    for (const f of source("data")) for (const t of imports(f)) expect(t, f).not.toMatch(/^(ui-core|designs|app)\b/);
    for (const f of source("ui-core")) for (const t of imports(f)) expect(t, f).not.toMatch(/^(designs|app)\b/);
  });
  it("only the registry imports a design, and only dynamically", () => {
    for (const f of source("app")) for (const t of imports(f)) expect(t === "designs/registry" || !t.startsWith("designs/"), f).toBe(true);
    const registry = readFileSync(join(web, "designs/registry.ts"), "utf8");
    for (const d of DESIGNS) expect(registry).toContain(`import("./${d.name}/index")`);
    expect(registry).not.toMatch(/^import .*"\.\/console/m);
  });
  it("designs don't import each other", () => {
    for (const d of DESIGNS)
      for (const f of source(`designs/${d.name}`))
        for (const t of imports(f)) if (t.startsWith("designs/") && t !== "designs/registry") expect(t.startsWith(`designs/${d.name}/`), `${f} -> ${t}`).toBe(true);
  });
  it("ui-core has no DOM, style or browser global", () => {
    for (const f of source("ui-core").filter((x) => x.includes("/src/"))) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\b(document|window|localStorage|navigator|location)\./);
      expect(text, f).not.toMatch(/\.css"/);
    }
  });
  it("test fixtures never reach the production code", () => {
    for (const dir of ["ui-core/src", "designs/console/screens", "designs/console/system", "app"])
      for (const f of source(dir)) for (const t of imports(f)) expect(t, f).not.toMatch(/\/test\//);
  });
  it("every registered design has at least one theme", () => {
    expect(DESIGNS.length).toBeGreaterThan(0);
    for (const d of DESIGNS) expect(d.themes.length).toBeGreaterThan(0);
  });
});
