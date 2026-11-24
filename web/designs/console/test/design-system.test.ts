import { describe, expect, it } from "vitest";
// @ts-expect-error Node builtins are intentionally used for source and directory inspection in this Node test.
import { existsSync, readFileSync, readdirSync } from "node:fs";

const screenSources = import.meta.glob("../screens/**/*.tsx", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const productionSources = import.meta.glob("../**/*.{ts,tsx}", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const systemSources = {
  ...import.meta.glob("../system/*.{css,html,js,mjs,ts,tsx}", { eager: true, query: "?raw", import: "default" }),
  ...import.meta.glob("../system/**/*.{css,html,js,mjs,ts,tsx}", { eager: true, query: "?raw", import: "default" }),
} as Record<string, string>;
const componentStyleFiles = import.meta.glob("../system/components/*/style.css", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const sharedStyleFiles = import.meta.glob("../system/shared/*.css", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
for (const path of Object.keys(systemSources).filter((path) => path.endsWith(".css"))) {
  // Vitest's CSS module transform returns an empty export for ?raw.
  systemSources[path] = readFileSync(new URL(path, import.meta.url), "utf8");
}
for (const styles of [componentStyleFiles, sharedStyleFiles]) {
  for (const path of Object.keys(styles)) styles[path] = readFileSync(new URL(path, import.meta.url), "utf8");
}
const componentsUrl = new URL("../system/components/", import.meta.url);
const componentEntries: { name: string; isDirectory: () => boolean }[] = readdirSync(componentsUrl, { withFileTypes: true });
const componentDirs = componentEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const exportsFile = systemSources["../system/components/index.tsx"] ?? "";
const barrelReExports = new Set(
  [...exportsFile.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").matchAll(/^\s*export\b[^;\n]*?\s+from\s+["']\.\/([^"']+)["']\s*;?\s*$/gm)]
    .map((match) => match[1]!),
);

function inlineStyleBodies(source: string): string[] {
  const bodies: string[] = [];
  const attribute = /\bstyle\s*=\s*/g;
  for (let match; (match = attribute.exec(source));) {
    const start = attribute.lastIndex;
    if (source[start] === "{") {
      let depth = 0;
      let quote = "";
      for (let i = start; i < source.length; i++) {
        const c = source[i]!;
        if (quote) {
          if (c === "\\") i++;
          else if (c === quote) quote = "";
        } else if (c === "\"" || c === "'" || c === "`") quote = c;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
          bodies.push(source.slice(start, i + 1));
          break;
        }
      }
    } else if (source[start] === "\"" || source[start] === "'") {
      const quote = source[start]!;
      const end = source.indexOf(quote, start + 1);
      if (end >= 0) bodies.push(source.slice(start + 1, end));
    }
  }
  return bodies;
}

const rawColor = /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/i;
const inlineUnitOrColor = /\b\d+(?:\.\d+)?\s*px\b|\$\{\s*\d+(?:\.\d+)?\s*\}\s*px\b|#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/i;


function containsWholeToken(source: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(source);
}

function declaredClasses(css: string): string[] {
  const classes: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1]!.trim();
    if (selector.startsWith("@")) continue;
    for (const part of selector.split(",")) {
      for (const match of part.matchAll(/\.([_a-zA-Z][\w-]*)/g)) classes.push(match[1]!);
    }
  }
  return classes;
}

describe("design-system source boundaries", () => {
  it("screens have no inline style values containing px or raw colors", () => {
    const violations = Object.entries(screenSources).flatMap(([path, source]) =>
      inlineStyleBodies(source).filter((body) => inlineUnitOrColor.test(body)).map(() => path));
    expect(violations).toEqual([]);
  });

  it("system source outside tokens has no raw colors", () => {
    const violations = Object.entries(systemSources).filter(([path, source]) => {
      const rel = path.replace("../system/", "").split("/");
      return rel[0] !== "tokens" && rel[0] !== "tokens.json" && rawColor.test(source);
    }).map(([path]) => path);
    expect(violations).toEqual([]);
  });

  it("setting rows provide a desktop two-column and narrow-frame stacked layout", () => {
    const css = readFileSync(new URL("../system/components/SettingRow/style.css", import.meta.url), "utf8");
    expect(css).toContain("grid-template-columns:minmax(12rem,1fr) minmax(14rem,1fr)");
    expect(css).toContain("@container (max-width: 40rem)");
    expect(css).toContain("grid-template-columns:minmax(0,1fr)");
  });

  it("documents the colocated stylesheet for every styled component", () => {
    const missing = Object.keys(componentStyleFiles).flatMap((path) => {
      const component = path.match(/\/components\/([^/]+)\/style\.css$/)?.[1];
      if (!component) return [path];
      const readme = new URL(`../system/components/${component}/README.md`, import.meta.url);
      return existsSync(readme) && readFileSync(readme, "utf8").includes("Styles: style.css in this directory") ? [] : [component];
    });
    expect(missing).toEqual([]);
  });

  it("every component directory has a README and a real barrel re-export", () => {
    const missing = componentDirs.filter((name) =>
      !existsSync(new URL(`../system/components/${name}/README.md`, import.meta.url)) || !barrelReExports.has(name));
    expect(missing).toEqual([]);
  });
});

describe("application header sizing", () => {
  it("uses the same fixed tokenized border-box height for sidebar and main headers", () => {
    const layout = readFileSync(new URL("../system/layout.css", import.meta.url), "utf8");
    for (const selector of ["brand", "top"]) {
      const rule = layout.match(new RegExp(`\\.${selector}\\{([^}]*)\\}`))?.[1] ?? "";
      expect(rule).toMatch(/(?:^|;)height:var\(--size-header\)(?:;|$)/);
      expect(rule).toMatch(/box-sizing:border-box/);
      expect(rule).toMatch(/align-items:center/);
    }
    expect(layout).not.toMatch(/min-height:49px/);
  });
});


describe("structural component CSS ownership", () => {
  it("checks whole-file tokens, including comments and classes anywhere in source", () => {
    expect(containsWholeToken('// class from a comment: .button-owner', "button-owner")).toBe(true);
    expect(containsWholeToken('const className = computedClass; class={className}', "computedClass")).toBe(true);
    expect(containsWholeToken('const longer = "select-row-tagged";', "select-row-tag")).toBe(false);
  });

  it("defines each component class in its owner file and only uses it there", () => {
    const legacyEntry = readFileSync(new URL("../system/components.css", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import\s+["'][^"']+["']\s*;/g, "").trim();
    expect(legacyEntry.length).toBe(0);

    const owners = new Map<string, Set<string>>();
    const sharedClasses = new Set<string>();
    for (const [path, css] of Object.entries({ ...componentStyleFiles, ...sharedStyleFiles })) {
      const component = path.match(/\/components\/([^/]+)\/style\.css$/)?.[1];
      for (const name of declaredClasses(css)) {
        if (!component) {
          sharedClasses.add(name);
          continue;
        }
        const definedBy = owners.get(name) ?? new Set<string>();
        definedBy.add(component);
        owners.set(name, definedBy);
      }
    }
    const duplicateOwners = [...owners.entries()].filter(([name, definitions]) => !sharedClasses.has(name) && definitions.size > 1).map(([name]) => name);
    const testDirectory = new URL("./", import.meta.url).pathname;
    const sources = Object.entries(productionSources).filter(([path]) => !new URL(path, import.meta.url).pathname.startsWith(testDirectory));
    const borrowed = [...owners.entries()].flatMap(([name, definitions]) => {
      if (sharedClasses.has(name)) return [];
      return sources.flatMap(([path, source]) => {
        const component = path.match(/\/system\/components\/([^/]+)\//)?.[1];
        if (component && definitions.has(component)) return [];
        return containsWholeToken(source, name) ? [`${[...definitions].join(",")}:${name} -> ${path}`] : [];
      });
    });
    expect(duplicateOwners).toEqual([]);
    expect(borrowed).toEqual([]);
  });
});


describe("shell footer toggles", () => {
  it("keeps edge-aligned icon columns and fixed 36px footer rows", () => {
    const layout = systemSources["../system/layout.css"] ?? "";
    const footer = componentStyleFiles["../system/components/ShellToggle/style.css"] ?? "";
    const rail = componentStyleFiles["../system/components/PanelTabs/style.css"] ?? "";
    expect(layout).toContain("grid-template-columns:var(--size-shell-rail) minmax(0,1fr)");
    expect(layout).toContain(".details.details-collapsed{width:var(--size-shell-rail)");
    const tokenSource = readFileSync(new URL("../system/tokens.json", import.meta.url), "utf8");
    expect(tokenSource).toContain('"name": "size-shell-column"');
    expect(tokenSource).toContain('"value": "50px"');
    expect(tokenSource).toContain('"name": "size-shell-rail"');
    expect(tokenSource).toContain('"value": "51px"');
    const collapsedNavRule = ".nav-collapsed .nav{padding-inline:0}";
    const collapsedItemRule = ".nav-collapsed .nav-item{box-sizing:border-box;width:var(--size-shell-column);justify-content:center;padding-inline:0}";
    expect(layout.match(/\.nav-collapsed \.nav\{/g)).toHaveLength(1);
    expect(layout.match(/\.nav-collapsed \.nav-item\{/g)).toHaveLength(1);
    expect(layout.indexOf(collapsedNavRule)).toBeGreaterThan(layout.indexOf("@container app (min-width:900px){"));
    expect(layout.indexOf(collapsedItemRule)).toBeGreaterThan(layout.indexOf("@container app (min-width:900px){"));
    expect(layout).toContain("margin-inline:calc(-1 * var(--space-16));margin-top:auto}");
    expect(layout).not.toContain("margin-bottom:var(--space-16)}");
    expect(footer).not.toContain("transform-origin");
    expect(layout).toContain(".side-middle{flex:1;min-height:0;overflow:auto");
    expect(footer).toContain("height:var(--size-shell-footer)");
    expect(footer).toContain(".shell-footer-left{justify-content:flex-start}");
    expect(footer).toContain(".shell-footer .shell-toggle{width:var(--size-shell-column);height:var(--size-shell-footer)}");
    const toggle = systemSources["../system/components/ShellToggle/index.tsx"] ?? "";
    expect(toggle).toContain("panel ? \"M20");
    expect(toggle).toContain("panel ? \" right\" : \"\"");
    expect(rail).toContain(".panel-tab-count { display:grid; place-items:center;");
    expect(rail).toContain("border-radius:calc(var(--size-icon-small) / 2); background:var(--wait); color:var(--fg)");
    expect(rail).toContain(".panel-tabs:not(.panel-tabs-rail) .panel-tab-count { position:absolute;");
    expect(rail).toContain(".panel-tabs-rail .panel-tab-count { position:absolute; inset-block-start:var(--space-2); inset-inline-end:var(--space-2); }");
    expect(rail).not.toContain(".panel-tabs-rail .panel-tab-count { background:");
  });
});

describe("approved list section and status rules", () => {
  it("keeps the reusable section band and trailing action column in ThreadGroup", () => {
    const css = componentStyleFiles["../system/components/ThreadGroup/style.css"] ?? "";
    expect(css).toMatch(/\.tgroup\[data-group-heading="section"\]>header\{[^}]*position:sticky;[^}]*background:var\(--inset\)/);
    expect(css).not.toMatch(/\.tgroup\[data-group-heading="section"\]>header\{[^}]*padding/);
    expect(css).not.toMatch(/\.tgroup-chevron[^}]*width:var\(--size-(?:row-action-touch|touch)\)/);
    expect(css).not.toMatch(/margin-inline:|width:calc\(/);
    expect(css).toContain("text-overflow:ellipsis;white-space:nowrap");
    const source = systemSources["../system/components/ThreadGroup/index.tsx"] ?? "";
    expect(source).toContain('data-group-heading={fold ? "section" : undefined}');
    expect(source).toContain('class="tgroup-toggle"');
    expect(source).toContain("onSelect(e.currentTarget.checked)");
    expect(source).not.toContain("labelContent");
    expect(source).toContain("count: ComponentChildren; countLoading?: boolean");
    expect(source).toContain("aria-busy={countLoading || undefined}");
    const select = componentStyleFiles["../system/components/SelectRow/style.css"] ?? "";
    expect(select).toContain(".srow-status{flex:none;display:inline-grid;place-items:center;width:var(--size-icon)}");
    const threads = screenSources["../screens/Threads.tsx"] ?? "";
    expect(threads).not.toContain("labelContent=");
    expect(threads).toContain("LoadingRows label={t(\"common.loading\")}");
    expect(threads).toContain("LoadingCount />");
    expect(threads).toContain('leading={<Icon role="organization.search" size="small" />}');
    expect(threads).toContain("moveAction={canMove ? <button");
    const app = screenSources["../screens/App.tsx"] ?? "";
    expect(app).toContain("pages.loaded ? t(\"org.bandCount\"");
    expect(app).toContain("LoadingRows label={t(\"common.loading\")}");
    expect(app).toContain('leading={<Icon role="thread.search" size="small" />}');
    expect(source).toContain('class="tgroup-chevron"');
  });

  it("keeps full-width rows, urgency chips, and equal-diameter semantic status shapes", () => {
    const row = componentStyleFiles["../system/components/ThreadItem/style.css"] ?? "";
    expect(row).toContain("width:100%");
    expect(row).not.toMatch(/margin-inline:|width:calc\(/);
    expect(row).toContain("padding:0 var(--space-row-inset) 0 var(--space-8)");
    expect(row).toContain("border-radius:0");
    expect(row).toContain("thread-item-depth-3");
    const selectSource = systemSources["../system/components/SelectRow/index.tsx"] ?? "";
    expect(selectSource).toContain("<div class=\"srow-title\"><a id={linkId} href={href}>{title}</a>{moveAction}</div>");
    const select = componentStyleFiles["../system/components/SelectRow/style.css"] ?? "";
    expect(select).toContain("width:100%");
    // The checkbox fills the band's leading column, so a top-level row has no leading inset.
    expect(select).toContain("padding:0 var(--space-row-inset) 0 0");
    expect(select).not.toMatch(/margin-inline:|width:calc\(/);
    const chip = componentStyleFiles["../system/components/ChildrenChip/style.css"] ?? "";
    expect(chip).toContain("height:var(--size-chip-height)");
    expect(chip).toContain("width:var(--size-chip-icon);height:var(--size-chip-icon)");
    expect(chip).toContain("padding-inline:var(--space-chip-inline)");
    expect(chip).toContain("font-size:var(--size-chip-text);font-variant-numeric:tabular-nums");
    expect(chip).toContain("[data-urgency=\"awaiting\"]{background:var(--wait-bg);color:var(--wait)}");
    expect(chip).toContain("[data-urgency=\"running\"]{background:var(--accent-bg);color:var(--accent)}");
    const tokens = JSON.parse(readFileSync(new URL("../system/tokens.json", import.meta.url), "utf8")) as { layout: { tokens: { name: string; value: string }[] } };
    expect(Object.fromEntries(tokens.layout.tokens.map(token => [token.name, token.value]))).toMatchObject({
      "size-chip-height": "20px", "size-chip-icon": "10px", "size-chip-text": "11px", "space-chip-inline": "7px", "size-row-action": "24px",
    });
    const icon = systemSources["../system/components/Icon/index.tsx"] ?? "";
    expect(icon).toContain('"status.idle": "circle"');
    expect(icon).toContain('"status.waiting": "circleWait"');
    expect(icon).toContain('"status.error": "circleAlert"');
    expect(icon).toContain('circle: <circle cx="12" cy="12" r="10" />');
    expect(icon).toContain('circleCheck: <><circle cx="12" cy="12" r="10" />');
    const mark = sharedStyleFiles["../system/shared/status.css"] ?? "";
    expect(mark).not.toMatch(/\.st\.run \.i\{[^}]*transform:scale/);
    expect(mark).toContain(".st.idle .i{width:var(--size-icon-small);height:var(--size-icon-small)}");
    expect(mark).toContain(".st.halt .dot{background:var(--muted);border-radius:2px");
  });
});
