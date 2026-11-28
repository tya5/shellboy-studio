// Per-browser preferences. The store is injected, so this module has no browser dependency.
import { DEFAULT_WEIGHTS, type Weights } from "./analytics";
import { readUnreadRecords, type UnreadRecord } from "./sidebar-unread";
import type { Lang } from "./i18n";

export interface Prefs {
  design: string;
  /** Token file within the design. */
  theme: string;
  lang: Lang;
  navCollapsed?: boolean;
  panelCollapsed?: boolean;
  sidebarWidth?: number;
  rightPanelWidth?: number;
  /** Sidebar bands that start open and were closed (Pinned, All). */
  sidebarClosedGroups?: string[];
  /** Sidebar bands that start closed and were opened (Archive). */
  sidebarOpenGroups?: string[];
  sidebarOpenParents?: string[];
  sidebarUnread?: UnreadRecord[];
  guideOptOut?: boolean;
  retainedDataBudgetBytes?: number;
  /** Opt in to the rolling Analytics previous-period read. */
  analyticsCompare?: boolean;
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
export const SIDEBAR_WIDTH_MIN = 220;
export const SIDEBAR_WIDTH_MAX = 420;
export const SIDEBAR_WIDTH_DEFAULT = 260;

export function readSidebarWidth(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, v)) : SIDEBAR_WIDTH_DEFAULT;
}

export const RIGHT_PANEL_WIDTH_MIN = 280;
export const RIGHT_PANEL_WIDTH_MAX = 480;
export const RIGHT_PANEL_WIDTH_DEFAULT = 340;

export function readRightPanelWidth(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(RIGHT_PANEL_WIDTH_MAX, Math.max(RIGHT_PANEL_WIDTH_MIN, v)) : RIGHT_PANEL_WIDTH_DEFAULT;
}

const validWeight = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

export function readWeights(v: unknown): Weights {
  const o = typeof v === "object" && v !== null ? (v as Partial<Weights>) : {};
  return { cached: validWeight(o.cached) ? o.cached : DEFAULT_WEIGHTS.cached, output: validWeight(o.output) ? o.output : DEFAULT_WEIGHTS.output };
}

export const RETAINED_MIB = 1024 * 1024;

export function parseRetainedBudgetMiB(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return;
  const bytes = Number(value) * RETAINED_MIB;
  if (validRetainedBytes(bytes)) return bytes;
}

function validRetainedBytes(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= RETAINED_MIB && value % RETAINED_MIB === 0;
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
  const sidebarKeys = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((key): key is string => typeof key === "string" && key.length <= 4096))].slice(0, 1000) : [];
  return { design: design.name, theme: theme.name, lang: saved.lang === "ja" ? "ja" : "en", navCollapsed: saved.navCollapsed === true, panelCollapsed: saved.panelCollapsed === true, ...(typeof saved.sidebarWidth === "number" && Number.isFinite(saved.sidebarWidth) ? { sidebarWidth: readSidebarWidth(saved.sidebarWidth) } : {}), ...(typeof saved.rightPanelWidth === "number" && Number.isFinite(saved.rightPanelWidth) ? { rightPanelWidth: readRightPanelWidth(saved.rightPanelWidth) } : {}), sidebarClosedGroups: sidebarKeys(saved.sidebarClosedGroups), sidebarOpenGroups: sidebarKeys(saved.sidebarOpenGroups), sidebarOpenParents: sidebarKeys(saved.sidebarOpenParents), sidebarUnread: readUnreadRecords(saved.sidebarUnread), guideOptOut: saved.guideOptOut === true, analyticsCompare: saved.analyticsCompare === true, ...(validRetainedBytes(saved.retainedDataBudgetBytes) ? { retainedDataBudgetBytes: saved.retainedDataBudgetBytes } : {}), weights: readWeights(saved.weights) };
}

export function savePrefs(store: PrefStore, prefs: Prefs): void {
  try {
    store.write(JSON.stringify(prefs));
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}
