import { describe, expect, it } from "vitest";

const screenSources = import.meta.glob("../screens/**/*.tsx", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const systemSources = {
  ...import.meta.glob("../system/*.{css,html,js,mjs,ts,tsx}", { eager: true, query: "?raw", import: "default" }),
  ...import.meta.glob("../system/**/*.{css,html,js,mjs,ts,tsx}", { eager: true, query: "?raw", import: "default" }),
} as Record<string, string>;
for (const path of Object.keys(systemSources).filter((path) => path.endsWith(".css"))) {
  systemSources[path] = readFileSync(new URL(path, import.meta.url), "utf8");
}
const componentFiles = import.meta.glob("../system/components/**/*");
const componentReadmes = import.meta.glob("../system/components/*/README.md");
const componentSources = import.meta.glob("../system/components/*/index.tsx", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
// Vitest runs in Node; its CSS module transform returns an empty export for ?raw.
// @ts-expect-error Node builtins are intentionally confined to this source test.
import { readFileSync } from "node:fs";
const exportsFile = systemSources["../system/components/index.tsx"] ?? "";
const componentName = (path: string) => path.split("/")[3]!;
const componentDirs = [...new Set(Object.keys(componentFiles).filter((path) => path.split("/").length >= 5).map(componentName))];

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
const classNames = (source: string): Set<string> => {
  const found = new Set<string>();
  const attr = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([\s\S]*?)\})/g;
  for (let match; (match = attr.exec(source));) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    for (const token of value.match(/[A-Za-z_][\w-]*/g) ?? []) found.add(token);
  }
  return found;
};

const SPECIAL_CLASS_OWNERS: Record<string, string[]> = {
  "app-request": ["AppRequest"],
  "character-avatar": ["Message"],
  "character-empty": ["EmptyState"],
  "character-status": ["screen:Conversation"],
  "model-picker": ["screen:App"],
  "model-picker-anchor": ["screen:App"],
  "model-picker-list": ["screen:App"],
  "pairing-url": ["screen:SettingsView"],
  "sender-id": ["Message", "screen:Monitor"],
  "tree-action": ["ThreadItem"],
  "tree-item": ["ThreadItem"],
  "tree-link": ["ThreadItem"],
  "work-inner-content": ["WorkElementRow"],
  "work-inner-line": ["WorkElementRow"],
};
const UNNAMED_SECTION_OWNERS: Record<string, string[]> = {
  "The Console component set. Roles only: every colour, size and font are tokens.": ["global"],
  "Monitor panes share edges and keep the newest activity at the bottom.": ["MonitorTile"],
};

function componentClassOwners(css: string): Map<string, Set<string>> {
  const owner = new Map<string, Set<string>>();
  const componentNames = new Set(componentDirs);
  const sections = /\/\*\s*([^*]+?)\s*\*\/([\s\S]*?)(?=\/\*|$)/g;
  let sectionOwners = ["global"];
  for (let section; (section = sections.exec(css));) {
    const heading = section[1]!.trim();
    const namedOwners = heading.split(/\s+and\s+|\s*\/\s*/).filter((name) => componentNames.has(name));
    if (namedOwners.length) sectionOwners = namedOwners;
    else if (UNNAMED_SECTION_OWNERS[heading]) sectionOwners = UNNAMED_SECTION_OWNERS[heading]!;
    // Descriptive continuation comments inherit the preceding component section;
    // unrecognized comments never erase ownership or grant borrowing permission.
    const body = section[2]!.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of body.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      for (const [, name] of rule[1]!.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
        const actualOwners = SPECIAL_CLASS_OWNERS[name!] ?? sectionOwners;
        const owners = owner.get(name!) ?? new Set<string>();
        for (const component of actualOwners.length ? actualOwners : [`unowned-css:${heading}`]) owners.add(component);
        owner.set(name!, owners);
      }
    }
  }
  return owner;
}

// These selectors express shared visual roles; the named classes below are intentional reuse.
const BORROW_ALLOWLIST: Record<string, { classes: string[]; reason: string }> = {
  icon: { classes: ["i", "s", "st", "mark", "dot"], reason: "Status and data displays compose the same icon and status-mark primitives." },
  controls: { classes: ["btn", "link"], reason: "Anchors and buttons share the same control chrome while retaining native semantics." },
  typography: { classes: ["mono", "muted", "caption"], reason: "These classes are token-backed typography roles intentionally shared by all data components." },
  selection: { classes: ["current", "on"], reason: "Current and selected are state classes used by distinct row/list components." },
  cards: { classes: ["card", "err", "excerpt", "foot", "go", "r"], reason: "AppCard composes the shared card content roles without duplicating card styles." },
  layouts: { classes: ["row", "work-row", "sect"], reason: "These names describe generic row/work/section layout roles shared by screens and components." },
  forms: { classes: ["choices", "choice", "choice-text", "check", "check-text", "stack"], reason: "Setup and settings share the same native choice, check, and narrow-table layout roles." },
  menus: { classes: ["menu-item", "destructive", "menu-separator"], reason: "Popover and Menu divide the shared menu surface and its semantic item styles." },
  charts: { classes: ["t", "bad", "nav-item", "empty-character"], reason: "These existing state and compact display roles are intentionally reused by chart, navigation, and empty-state compositions." },
};
const BORROWED_CLASSES = new Set(Object.values(BORROW_ALLOWLIST).flatMap(({ classes }) => classes));

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

  it("every component directory has a README and a barrel export", () => {
    const readmes = new Set(Object.keys(componentReadmes).map(componentName));
    const missing = componentDirs.filter((name) => !readmes.has(name)
      || !componentSources[`../system/components/${name}/index.tsx`]
      || !new RegExp(`from\\s+["']\\./${name}["']`).test(exportsFile));
    expect(missing).toEqual([]);
  });

  it("component-owned classes are not used by another component without a reasoned exception", () => {
    const owners = componentClassOwners(systemSources["../system/components.css"] ?? "");
    const uses = new Map<string, Set<string>>();
    const usageSources = Object.entries(componentSources).map(([path, source]) => [componentName(path), source] as const);
    for (const [component, source] of usageSources) {
      for (const name of classNames(source)) {
        const users = uses.get(name) ?? new Set<string>();
        users.add(component);
        uses.set(name, users);
      }
    }
    const violations: string[] = [];
    for (const [name, componentOwners] of owners) {
      for (const user of uses.get(name) ?? []) {
        if (!componentOwners.has(user) && !BORROWED_CLASSES.has(name)) violations.push(`.${name}: ${[...componentOwners].join("/")} -> ${user}`);
      }
    }
    expect(violations).toEqual([]);
    expect(Object.values(BORROW_ALLOWLIST).every(({ classes, reason }) => reason.trim().length > 0
      && classes.every((name) => uses.has(name) && owners.has(name)))).toBe(true);
  });
});
