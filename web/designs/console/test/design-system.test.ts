import { describe, expect, it } from "vitest";
import * as ts from "typescript";
// @ts-expect-error Node builtins are intentionally used for source and directory inspection in this Node test.
import { existsSync, readFileSync, readdirSync } from "node:fs";

const screenSources = import.meta.glob("../screens/**/*.tsx", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const systemSources = {
  ...import.meta.glob("../system/*.{css,html,js,mjs,ts,tsx}", { eager: true, query: "?raw", import: "default" }),
  ...import.meta.glob("../system/**/*.{css,html,js,mjs,ts,tsx}", { eager: true, query: "?raw", import: "default" }),
} as Record<string, string>;
const componentCode = import.meta.glob("../system/components/**/*.{ts,tsx}", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
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


function classNamesInTsx(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names: string[] = [];
  const collectStrings = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) names.push(...node.text.split(/\s+/).filter(Boolean));
    ts.forEachChild(node, collectStrings);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && (node.name.getText(file) === "class" || node.name.getText(file) === "className") && node.initializer) collectStrings(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

function declaredClasses(css: string): string[] {
  const classes: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1]!.trim();
    if (selector.startsWith("@")) continue;
    for (const part of selector.split(",")) {
      const matches = [...part.matchAll(/\.([_a-zA-Z][\w-]*)/g)];
      const target = matches[0]?.[1];
      if (target) classes.push(target);
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
  it("defines each component class in its owner file and only uses it there", () => {
    const legacyEntry = readFileSync(new URL("../system/components.css", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import\s+["'][^"']+["']\s*;/g, "").trim();
    expect(legacyEntry.length).toBe(0);

    const owners = new Map<string, Set<string>>();
    for (const [path, css] of Object.entries({ ...componentStyleFiles, ...sharedStyleFiles })) {
      const component = path.match(/\/components\/([^/]+)\/style\.css$/)?.[1];
      const owner = component ?? "shared";
      for (const name of declaredClasses(css)) {
        const definedBy = owners.get(name) ?? new Set<string>();
        definedBy.add(owner);
        owners.set(name, definedBy);
      }
    }
    const duplicateOwners = [...owners.entries()].filter(([, definitions]) => definitions.size > 1).map(([name]) => name);
    const sources = { ...screenSources, ...componentCode };
    const sharedOwner = "shared";
    const borrowed = Object.entries(sources).flatMap(([path, source]) => {
      const component = path.match(/\/system\/components\/([^/]+)\//)?.[1];
      return classNamesInTsx(source, path).filter((name) => {
        const definitions = owners.get(name);
        return definitions && !definitions.has("shared") && (!component || !definitions.has(component));
      }).map((name) => `${path}:${name}`);
    });
    expect(duplicateOwners).toEqual([]);
    expect(borrowed).toEqual([]);
  });
});
