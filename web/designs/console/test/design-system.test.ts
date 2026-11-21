import { describe, expect, it } from "vitest";

const screenSources = import.meta.glob("../screens/**/*.tsx", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const systemSources = import.meta.glob("../system/**/*.{css,html,js,mjs,ts,tsx}", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const componentReadmes = import.meta.glob("../system/components/*/README.md");
const componentSources = import.meta.glob("../system/components/*/index.tsx", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const componentName = (path: string) => path.split("/").at(-2)!;
const componentDirs = [...new Set([...Object.keys(componentReadmes), ...Object.keys(componentSources)].map(componentName))];

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
const inlineUnitOrColor = /\b\d+(?:\.\d+)?\s*px\b|#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/i;
const classNames = (source: string): Set<string> => {
  const found = new Set<string>();
  const attr = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([\s\S]*?)\})/g;
  for (let match; (match = attr.exec(source));) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    for (const token of value.match(/[A-Za-z_][\w-]*/g) ?? []) found.add(token);
  }
  return found;
};

function componentClassOwners(css: string): Map<string, Set<string>> {
  const owner = new Map<string, Set<string>>();
  const componentNames = new Set(componentDirs);
  const sections = /\/\*\s*([^*]+?)\s*\*\/([\s\S]*?)(?=\/\*|$)/g;
  for (let section; (section = sections.exec(css));) {
    const names = section[1]!.trim().split(/\s+and\s+|\s*\/\s*/).filter((name) => componentNames.has(name));
    if (!names.length) continue;
    const body = section[2]!.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of body.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const [, name] of rule[1]!.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
        const owners = owner.get(name!) ?? new Set<string>();
        names.forEach((component) => owners.add(component));
        owner.set(name!, owners);
      }
    }
  }
  return owner;
}

// Keep this empty until a real shared class contract has a named owner and justification.
const BORROW_ALLOWLIST: Record<string, string> = {};

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

  it("every component directory has a README and an export", () => {
    const readmes = new Set(Object.keys(componentReadmes).map(componentName));
    const missing = componentDirs.filter((name) => {
      const source = componentSources[`../system/components/${name}/index.tsx`];
      return !readmes.has(name) || !source || !/\bexport\s+(?:function|const|class|type|interface|\{)/.test(source);
    });
    expect(missing).toEqual([]);
  });

  it("component-owned classes are not used by another component without a reasoned exception", () => {
    const owners = componentClassOwners(systemSources["../system/components.css"] ?? "");
    const uses = new Map<string, Set<string>>();
    for (const [path, source] of Object.entries(componentSources)) {
      const component = componentName(path);
      for (const name of classNames(source)) {
        const users = uses.get(name) ?? new Set<string>();
        users.add(component);
        uses.set(name, users);
      }
    }
    const violations: string[] = [];
    for (const [name, componentOwners] of owners) {
      if (componentOwners.size !== 1) continue;
      const owner = [...componentOwners][0]!;
      for (const user of uses.get(name) ?? []) {
        if (user !== owner && !BORROW_ALLOWLIST[name]) violations.push(`.${name}: ${owner} -> ${user}`);
      }
    }
    expect(violations).toEqual([]);
    expect(Object.entries(BORROW_ALLOWLIST).every(([name, reason]) => owners.has(name) && reason.trim().length > 0)).toBe(true);
  });
});
