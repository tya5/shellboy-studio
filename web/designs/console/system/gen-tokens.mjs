#!/usr/bin/env node
// Generates one token file per theme from tokens.json, the only source of token values.
// Run with `npm run tokens`. A test fails if the generated files drift.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function tokenCss(tokens, themeId, isDefault) {
  const lines = [];
  const add = (name, value) => lines.push(`  --${name}: ${value};`);
  for (const c of tokens.color.tokens) add(c.name, c.value[themeId]);
  const families = tokens.type.families;
  add("font-mono", families.mono);
  add("font-sans", themeId === "terminal" ? "var(--font-mono)" : families.sans);
  for (const group of tokens.type.groups)
    for (const s of group.styles) {
      const family = group.family === "mono" ? "var(--font-mono)" : "var(--font-sans)";
      add(`type-${s.name}`, `${s.fontWeight} ${s.fontSize}/${s.lineHeight} ${family}`);
      add(`size-${s.name}`, s.fontSize);
    }
  for (const s of tokens.spacing.tokens) add(s.name, s.value);
  for (const r of tokens.radius.tokens) add(r.name, tokens.radius[themeId]?.[r.name] ?? r.value);
  for (const m of tokens.motion.tokens) add(m.name, m.value);
  for (const l of tokens.layout.tokens) add(l.name, l.value);
  const scheme = themeId === "light" ? "light" : "dark";
  const selector = isDefault ? `:root, :root[data-ds="${themeId}"]` : `:root[data-ds="${themeId}"]`;
  return `/* Generated from tokens.json by gen-tokens.mjs. Do not edit. */\n${selector} {\n  color-scheme: ${scheme};\n${lines.join("\n")}\n}\n`;
}

export function allTokenFiles(tokens) {
  return tokens.color.themes.map((theme, i) => ({ id: theme.id, css: tokenCss(tokens, theme.id, i === 0) }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tokens = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));
  for (const f of allTokenFiles(tokens)) writeFileSync(join(here, "tokens", `${f.id}.css`), f.css);
}
