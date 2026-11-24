export type DefinitionKind = "schedule" | "service";
export type DefinitionAction = "enable" | "disable" | "remove" | "start" | "stop";

export interface ShellDefinition {
  id: string;
  enabled: boolean;
  cwd: string;
  command: string;
  description?: string;
  next?: string;
  cron?: string;
  at?: string;
  latest?: { state: string; started: string; ended?: string; exit?: number; output: string };
}

const record = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const text = (x: unknown) => typeof x === "string" ? x : undefined;

/** Core admits at most 64 definitions combined per Thread; neither list has a cursor. */
export function decodeDefinitions(raw: unknown, kind: DefinitionKind, thread: string): ReadonlyMap<string, ShellDefinition> | undefined {
  if (!record(raw) || raw.thread_id !== thread || !Array.isArray(raw.items) || raw.items.length > 64) return;
  const rows = new Map<string, ShellDefinition>();
  for (const item of raw.items) {
    if (!record(item)) return;
    const id = text(item[`${kind}_id`]);
    if (!id || rows.has(id) || typeof item.enabled !== "boolean" || typeof item.command !== "string" || typeof item.cwd !== "string") return;
    const e = item.latest;
    let latest: ShellDefinition["latest"];
    if (e !== null) {
      if (!record(e) || typeof e.state !== "string" || typeof e.started_at !== "string" || typeof e.output_tail !== "string") return;
      latest = { state: e.state, started: e.started_at, ended: text(e.ended_at), exit: typeof e.exit_code === "number" ? e.exit_code : undefined, output: e.output_tail };
    }
    rows.set(id, { id, enabled: item.enabled, cwd: item.cwd, command: item.command, description: text(item.description), next: text(item.next_at), cron: text(item.cron), at: text(item.at), latest });
  }
  return rows;
}
