#!/usr/bin/env node
// Fails on raw pixel values in the system's component, shared and layout CSS (README "Layout contract").
// Allowed: 0, 1px hairlines, the 2px focus ring (outline, outline-offset), and the container-query
// breakpoints that layout.css writes once because container queries can't read custom properties.
// Everything else must be a token. Current offenders are listed in raw-px-allowlist.txt; the check also
// fails when a listed offender is gone, so the list only shrinks.
// Run with `npm run check` (or directly: node designs/console/system/check-raw-px.mjs).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BREAKPOINTS = new Set(["899px", "900px", "1179px", "1180px"]);
const FOCUS_RING = new Set(["outline", "outline-offset"]);

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === "tokens" ? [] : walk(path);
  return name.endsWith(".css") ? [path] : [];
});

/** One entry per raw px value: "<file> <property> <value>", the at-rule prelude counting as property "@". */
export function rawPixels(css, file) {
  const found = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of text.matchAll(/@(?:container|media)[^{]*\{/g)) {
    for (const px of match[0].matchAll(/-?\d*\.?\d+px\b/g)) if (!BREAKPOINTS.has(px[0])) found.push(`${file} @ ${px[0]}`);
  }
  const body = text.replace(/@(?:container|media)[^{]*\{/g, "{");
  for (const block of body.matchAll(/\{([^{}]*)\}/g)) {
    for (const declaration of block[1].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim();
      const value = declaration.slice(colon + 1);
      for (const px of value.matchAll(/-?\d*\.?\d+px\b/g)) {
        const amount = Math.abs(Number.parseFloat(px[0]));
        if (amount === 0 || amount === 1) continue;
        if (amount === 2 && FOCUS_RING.has(property)) continue;
        found.push(`${file} ${property} ${px[0]}`);
      }
    }
  }
  return found;
}

function readAllowlist(path) {
  return readFileSync(path, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/\s+/).join(" "));
}

function count(list) {
  const out = new Map();
  for (const item of list) out.set(item, (out.get(item) ?? 0) + 1);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = walk(here).sort().flatMap((path) => rawPixels(readFileSync(path, "utf8"), relative(here, path).split("\\").join("/")));
  if (process.argv.includes("--list")) { console.log(found.join("\n")); process.exit(0); }
  const allowed = count(readAllowlist(join(here, "raw-px-allowlist.txt")));
  const seen = count(found);
  const added = [...seen].flatMap(([key, n]) => Array(Math.max(0, n - (allowed.get(key) ?? 0))).fill(key));
  const gone = [...allowed].flatMap(([key, n]) => Array(Math.max(0, n - (seen.get(key) ?? 0))).fill(key));
  if (added.length) console.error(`Raw px values outside the token files. Use a token (README "Layout contract"):\n  ${added.join("\n  ")}`);
  if (gone.length) console.error(`Fixed offenders still listed. Remove them from raw-px-allowlist.txt:\n  ${gone.join("\n  ")}`);
  if (added.length || gone.length) process.exit(1);
  console.log(`raw px check: ok (${found.length} allowlisted offenders left)`);
}
