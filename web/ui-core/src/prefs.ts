// Per-browser preferences. The store is injected, so this module has no browser dependency.
import { DEFAULT_WEIGHTS, type Weights } from "./analytics";
import type { Lang } from "./i18n";

export interface Prefs {
  design: string;
  /** Token file within the design. */
  theme: string;
  lang: Lang;
  navCollapsed?: boolean;
  monitorPins?: string[];
  monitorView?: "cards" | "tiles";
  monitorSort?: "stable" | "recent";
  /** Effective-token weights. The reader's own; they are not prices. */
  weights: Weights;
}

export interface PrefStore {
  read(): string | null;
  write(value: string): void;
}

export interface DesignChoice {
  name: string;
  themes: readonly { name: string }[];
}

/** Falls back field by field: a removed design or a damaged value never blocks startup. */
const validWeight = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function readWeights(v: unknown): Weights {
  const o = typeof v === "object" && v !== null ? (v as Partial<Weights>) : {};
  return { cached: validWeight(o.cached) ? o.cached : DEFAULT_WEIGHTS.cached, output: validWeight(o.output) ? o.output : DEFAULT_WEIGHTS.output };
}

export function loadPrefs(store: PrefStore, designs: readonly DesignChoice[]): Prefs {
  let saved: Partial<Prefs> = {};
  try {
    const parsed: unknown = JSON.parse(store.read() ?? "{}");
    if (typeof parsed === "object" && parsed !== null) saved = parsed as Partial<Prefs>;
  } catch {
    // Unreadable preference: use the defaults.
  }
  const design = designs.find((d) => d.name === saved.design) ?? designs[0];
  if (!design) throw new Error("no design registered");
  const theme = design.themes.find((t) => t.name === saved.theme) ?? design.themes[0];
  if (!theme) throw new Error(`design ${design.name} has no theme`);
  return { design: design.name, theme: theme.name, lang: saved.lang === "ja" ? "ja" : "en", navCollapsed: saved.navCollapsed === true, monitorPins: Array.isArray(saved.monitorPins) ? [...new Set(saved.monitorPins.filter((x): x is string => typeof x === "string" && x.length <= 256))].slice(0, 100) : [], monitorView: saved.monitorView === "tiles" ? "tiles" : "cards", monitorSort: saved.monitorSort === "recent" ? "recent" : "stable", weights: readWeights(saved.weights) };
}

export function savePrefs(store: PrefStore, prefs: Prefs): void {
  try {
    store.write(JSON.stringify(prefs));
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}
