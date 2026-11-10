// The token contract and the system's own rules. Every theme must pass the same checks.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTokenFiles } from "../system/gen-tokens.mjs";

const here = join(import.meta.dirname, "..");
const system = join(here, "system");
const tokens = JSON.parse(readFileSync(join(system, "tokens.json"), "utf8"));
const THEMES = ["console", "light", "terminal"] as const;

const REQUIRED_COLOURS = ["bg", "panel", "raised", "inset", "stage", "line", "line-strong", "fg", "muted", "accent", "accent-bg", "on-accent", "ok", "wait", "on-wait", "wait-bg", "bad", "bad-bg", "note-bg", "lead-bg", "need-bg", "err-bg", "scrim", "chart-1", "chart-2", "chart-3"];
const REQUIRED_OTHER = ["font-sans", "font-mono", "type-title", "type-heading", "type-body", "type-label", "type-caption", "type-code", "type-log", "space-4", "space-8", "space-12", "space-16", "space-24", "radius", "radius-s", "motion-spin", "size-sidebar", "size-details", "size-control", "size-touch", "size-icon"];

function parse(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}
const fileFor = (theme: string) => readFileSync(join(system, "tokens", `${theme}.css`), "utf8");

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ...["bg", "panel", "raised", "inset", "accent-bg", "wait-bg", "bad-bg", "note-bg", "lead-bg", "need-bg", "err-bg"].map((s): [string, string] => ["fg", s]),
  ...["bg", "panel", "raised", "inset", "wait-bg", "note-bg", "lead-bg", "need-bg", "err-bg", "bad-bg", "accent-bg"].map((s): [string, string] => ["muted", s]),
  ["on-accent", "accent"],
  ["on-wait", "wait"],
  ["accent", "bg"], ["accent", "panel"], ["accent", "inset"], ["accent", "lead-bg"], ["accent", "raised"],
  ["ok", "bg"], ["ok", "panel"], ["ok", "raised"], ["ok", "lead-bg"],
  ["wait", "bg"], ["wait", "panel"], ["wait", "wait-bg"], ["wait", "need-bg"], ["wait", "bad-bg"],
  ["bad", "bg"], ["bad", "panel"], ["bad", "bad-bg"], ["bad", "err-bg"],
];
const CONTROL_PAIRS: [string, string][] = [["line-strong", "bg"], ["line-strong", "panel"], ["line-strong", "inset"], ["accent", "bg"], ["accent", "panel"], ["chart-1", "panel"], ["chart-2", "panel"], ["chart-3", "panel"], ["muted", "panel"]];

describe.each(THEMES)("theme %s", (theme) => {
  const values = parse(fileFor(theme));

  it("defines every required token", () => {
    for (const name of [...REQUIRED_COLOURS, ...REQUIRED_OTHER]) expect(values.get(name), name).toBeTruthy();
  });

  it.each(TEXT_PAIRS)("text %s on %s reaches 4.5:1", (fg, bg) => {
    expect(contrast(values.get(fg)!, values.get(bg)!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CONTROL_PAIRS)("control %s on %s reaches 3:1", (fg, bg) => {
    expect(contrast(values.get(fg)!, values.get(bg)!)).toBeGreaterThanOrEqual(3);
  });
});

describe("accent-following approved brand", () => {
  it("references existing generated theme tokens instead of a fixed tile/wink palette", () => {
    expect(tokens.brand.tokens["logo-tile"]).toBe("var(--accent)");
    expect(tokens.brand.tokens["logo-wink"]).toBe("var(--accent)");
  });
  it.each(THEMES)("keeps identifiable details above 3:1 in %s", theme => {
    const v = parse(fileFor(theme));
    expect(contrast(v.get("accent")!, v.get("logo-face")!)).toBeGreaterThanOrEqual(3);
    expect(contrast(v.get("logo-bright")!, v.get("logo-face")!)).toBeGreaterThanOrEqual(3);
    expect(contrast(v.get("accent")!, v.get("panel")!)).toBeGreaterThanOrEqual(3);
  });
});

describe("one source of tokens", () => {
  it("the token files are what tokens.json generates", () => {
    for (const f of allTokenFiles(tokens)) expect(fileFor(f.id)).toBe(f.css);
  });
  it("themes change only values, never the set of names", () => {
    const names = (t: string) => [...parse(fileFor(t)).keys()].sort();
    expect(names("light")).toEqual(names("console"));
    expect(names("terminal")).toEqual(names("console"));
  });
  it("Terminal squares corners and uses the mono face for everything", () => {
    const v = parse(fileFor("terminal"));
    expect(v.get("radius")).toBe("2px");
    expect(v.get("font-sans")).toBe("var(--font-mono)");
  });
});

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

describe("components name roles, never values", () => {
  const css = ["components.css", "layout.css"].map((f) => readFileSync(join(system, f), "utf8")).join("\n");
  const known = new Set(parse(fileFor("console")).keys());

  it("no literal colours, no external fonts", () => {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noComments).not.toMatch(/\b(rgb|hsl)a?\(/);
    expect(css).not.toMatch(/googleapis|gstatic|@import|url\(/);
    expect(noComments).not.toMatch(/font-family:/);
    expect(noComments).not.toMatch(/box-shadow:(?!inset)/);
  });
  it("keeps Field chrome on its wrapper and excludes it from other input chrome", () => {
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const fieldInput = rules.find((m) => m[1]!.trim() === ".field input");
    expect(fieldInput?.[2]).toMatch(/border:0/);
    expect(fieldInput?.[2]).toMatch(/background:transparent/);
    expect(css).toMatch(/\.field:focus-within\{/);
    expect(css).toMatch(/\.field:has\(input:disabled\)/);
    expect(css).toMatch(/\.field:has\(input\[aria-invalid="true"\]\)/);
    for (const rule of rules) {
      if (!/\b(?:border|background)(?:-color)?:/.test(rule[2]!)) continue;
      expect(rule[1]!.trim()).not.toMatch(/\.sect\s+input\b/);
    }
  });
  it("uses role spacing in the shared page layout", () => {
    const layout = readFileSync(join(system, "layout.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of layout.matchAll(/(?:^|[;{])\s*(gap|padding(?:-top|-bottom|-left|-right)?):([^;}]+)/gm)) {
      const value = match[2]!.trim();
      // The pane grid's one-pixel gap is a divider, not whitespace.
      if ((match[1] === "gap" && value === "1px") || value === "env(safe-area-inset-bottom,0px)") continue;
      expect(value, match[0]).not.toMatch(/\d+(?:\.\d+)?(?:px|rem|em)\b/);
      for (const token of value.matchAll(/var\(--space-(\d+)\)/g)) expect(["4", "8", "12", "16", "24"]).toContain(token[1]);
    }
  });
  it("gives compact interactive controls a phone-sized target", () => {
    const mobile = readFileSync(join(system, "components.css"), "utf8");
    expect(mobile).toMatch(/\.btn,\.chip\{min-width:var\(--size-touch\)/);
    expect(mobile).toMatch(/\.tcheck\{width:var\(--size-touch\);height:var\(--size-touch\)/);
    expect(mobile).toMatch(/\.brow-text>a,\.srow-text>a\{[^}]*min-height:var\(--size-touch\)/);
    expect(mobile).toMatch(/\.tile-header>a\{[^}]*min-height:var\(--size-touch\)/);
  });
  it("every custom property used exists", () => {
    for (const m of css.matchAll(/var\(--([\w-]+)/g)) expect(known.has(m[1]!), m[1]).toBe(true);
  });
  it("only the running ring and loading rows move, and both stop under reduced motion", () => {
    expect(css.match(/animation:/g)).toHaveLength(4);
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{\.st\.run \.dot\{animation:none\}/);
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{\.loadrow\{animation:none\}/);
  });
  it("phone width is driven by the container, with a tab bar and 44px controls", () => {
    expect(css).toMatch(/container:app \/ inline-size/);
    expect(css).toMatch(/@container app \(max-width:899px\)/);
    expect(css.replace(/@media\(max-width:768px\)\{\.convo > \.conversation-status\{padding-inline:var\(--space-12\)\}\}/g, "")).not.toMatch(/@media[^{]*width/);
    expect(css).toContain(".convo > .conversation-status{padding-inline:var(--space-24)}");
    const narrow = css.slice(css.lastIndexOf("@container app (max-width:899px)"));
    expect(narrow).toMatch(/\.tabbar\{display:grid\}/);
    expect(css).toMatch(/\.btn,\.chip\{min-height:var\(--size-touch\)\}/);
  });
});

describe("screens use the system only", () => {
  const screens = walk(join(here, "screens")).filter((f) => f.endsWith(".tsx"));
  const components = readdirSync(join(system, "components")).filter((f) => statSync(join(system, "components", f)).isDirectory());

  it("no raw controls or colours in a screen", () => {
    for (const f of screens) {
      const text = readFileSync(f, "utf8");
      // The drawer's scrim is the one bare button: it has no look of its own to reuse.
      const body = text.replace(/<button type="button" class=\{drawer \? "scrim open" : "scrim"\}/g, "").replace(/<button type="button" class="srow-act"/g, "");
      expect(body, f).not.toMatch(/<(button|textarea|input|details|svg)\b/);
      expect(text, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(text, f).not.toMatch(/style=/);
    }
  });
  it("every component has a usage note", () => {
    for (const c of components) expect(statSync(join(system, "components", c, "README.md")).size, c).toBeGreaterThan(0);
    expect(components).toEqual(expect.arrayContaining(["StatusMark", "Button", "NavItem", "ThreadCard", "StepRow", "QuestionCard", "SummaryStrip", "ContextBar", "LogBlock", "Chip", "Field"]));
  });
  it("no money in a screen, and no chart library in the bundle", () => {
    for (const f of screens) expect(readFileSync(f, "utf8"), f).not.toMatch(/USD|JPY|¥|€|£/);
    const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@preact/signals", "@preact/signals-core", "markdown-it", "preact", "qrcode-generator"]);
  });
  it("the status mark differs in shape between states, not only colour", () => {
    const text = readFileSync(join(system, "components.css"), "utf8");
    for (const rule of [/\.st\.run \.dot\{border/, /\.st\.wait \.dot\{background/, /\.st\.bad \.dot\{[^}]*rotate\(45deg\)/, /\.st\.ok \.i\{/, /\.st\.fail \.i\{/, /\.st\.halt \.dot\{[^}]*border-radius:2px/, /\.st\.idle \.dot\{border:2px dashed/, /\.st\.hold \.dot\{/]) expect(text).toMatch(rule);
  });
});

it("compact Work rows use the same DS gutter and gap as tool summaries",()=>{
 const css=readFileSync(join(system,"components.css"),"utf8");
 const summary=css.match(/\.step summary\{([^}]+)\}/)![1]!;
 const row=css.match(/\.work-inner-line\{([^}]+)\}/)![1]!;
 for(const rule of ["gap:var(--space-8)","padding:var(--space-4) var(--space-12)"]){expect(summary).toContain(rule);expect(row).toContain(rule);}
 expect(row).toContain("box-sizing:border-box");
});

it("Work container owns the v0.1 separator while inner tool rows retain the flat treatment", () => {
  const css = readFileSync(join(system, "components.css"), "utf8");
  const selector = "[data-work-group]>.step-group-list>[data-work-item-key]>.step:not(.step-group)";
  const rule = (name: string) => css.split(`${name}{`)[1]?.split("}")[0];
  expect(rule("[data-work-group]>.step-group-list>[data-work-item-key]")).toBe("border-top:1px solid var(--line)");
  expect(rule(selector)).toBe("border:0;border-radius:0;background:transparent");
  expect(rule(`${selector}[open]`)).toBe("border:0");
  expect(rule(".step")).toBe("border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);min-width:0");
  expect(rule(".log.boxed")).toBe("border:1px solid var(--line);border-radius:var(--radius-s)");
});
