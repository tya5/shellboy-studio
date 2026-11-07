// Formatting of measured values. No estimates: an absent value stays absent for the caller.

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${trim(n / 1000)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${trim(n / 1_000_000)}M`;
}

const trim = (x: number): string => {
  const s = x.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

export function formatDuration(ms: number): string {
  if (ms < 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}m ${total % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Compact age: "45s", "12m", "3h", "2d". */
export function formatAge(iso: string | undefined, nowMs: number): string | undefined {
  const at = parseTime(iso);
  if (at === undefined) return undefined;
  const s = Math.max(0, Math.floor((nowMs - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const parseTime = (iso: string | undefined): number | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local wall-clock time of a saved instant. */
export function formatClock(iso: string | undefined, seconds = false): string | undefined {
  const at = parseTime(iso);
  if (at === undefined) return undefined;
  const d = new Date(at);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return seconds ? `${hm}:${pad(d.getSeconds())}` : hm;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KiB`;
  if (n < 1024 ** 3) return `${trim(n / (1024 * 1024))} MiB`;
  return `${trim(n / 1024 ** 3)} GiB`;
}

/** Last path segment, for the breadcrumb. */
export function folderName(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1];
}

/** One readable line from Markdown text, for previews in lists and cards. */
export function plainExcerpt(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|>\s?)/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
