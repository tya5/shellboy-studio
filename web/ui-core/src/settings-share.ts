import { parse, stringify, type TomlTable } from "smol-toml";
import { CONFIG_FIELDS, CONNECTION_FIELDS, CONNECTION_SECRETS, fieldOf, isHidden, type ConfigFacts } from "./config";

export const SETTINGS_FILE_LIMIT = 1024 * 1024;
type Table = Record<string, unknown>;
export type SettingsChange = { field: string; value?: unknown };
export interface ImportedSettings { fields: Map<string, unknown>; connections: Map<string, Map<string, unknown>> }
const globals = new Map(Object.entries(CONFIG_FIELDS).filter(([key]) => key !== "shell.executable"));
const connections = new Map<string, { kind: string; options?: readonly string[] }>([
  ...CONNECTION_FIELDS.filter(field => field.key !== "ssl_verify").map(field => [field.key, field] as const),
  ["models.include", { kind: "kinds" }], ["models.exclude", { kind: "kinds" }],
]);
const table = (value: unknown): Table | undefined => value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)) ? value as Table : undefined;
const at = (source: unknown, key: string): unknown => key.split(".").reduce<unknown>((v, k) => {
  const obj = table(v);
  return obj && Object.hasOwn(obj, k) ? obj[k] : undefined;
}, source);
const validName = (value: string) => /^[A-Za-z0-9_-]{1,64}$/.test(value) && !isHidden(value);
const valid = (key: string, value: unknown, spec: { kind: string; options?: readonly string[] }): boolean => {
  if (isHidden(value)) return false;
  if (spec.kind === "bool") return typeof value === "boolean";
  if (spec.kind === "int") return Number.isSafeInteger(value);
  if (spec.kind === "float") return typeof value === "number" && Number.isFinite(value);
  if (spec.kind === "kinds") return Array.isArray(value) && value.every(v => typeof v === "string");
  if (typeof value !== "string" || (spec.options && !spec.options.includes(value))) return false;
  if (key === "api_key_env") return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
  if (key === "api_key_header") return /^[A-Za-z0-9-]+$/.test(value);
  if (key === "base_url") {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }
  return true;
};
const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/** Only the portable allowlist is emitted, never raw file content or redacted fields. */
export function exportableSettings(facts: ConfigFacts): string {
  const source = facts.file.values;
  if (!facts.file.valid || !source) throw new Error();
  const result: TomlTable = Object.create(null);
  const put = (target: TomlTable, key: string, value: unknown) => {
    const parts = key.split(".");
    const leaf = parts.pop()!;
    for (const part of parts) target = (target[part] ??= Object.create(null)) as TomlTable;
    target[leaf] = value as TomlTable[string];
  };
  for (const [key, spec] of globals) {
    const value = at(source, key);
    if (valid(key, value, spec)) put(result, key, value);
  }
  for (const [name, raw] of Object.entries(table(source.connections) ?? {})) {
    if (!validName(name)) continue;
    const row: TomlTable = Object.create(null);
    for (const [key, spec] of connections) {
      const value = at(raw, key);
      if (!facts.file.redacted.includes(fieldOf(["connections", name, ...key.split(".")])) && valid(key, value, spec)) put(row, key, value);
    }
    // A masked or unsupported endpoint cannot produce an incomplete configuration.
    if (!row.base_url || !row.api) throw new Error();
    ((result.connections ??= Object.create(null)) as TomlTable)[name] = row;
  }
  return stringify(result);
}

/** TOML parsing errors and unsupported content are deliberately not echoed to the UI. */
export function parseSharedSettings(text: string): ImportedSettings {
  const parsed: Table = parse(text);
  const take = (obj: Table, schema: ReadonlyMap<string, { kind: string; options?: readonly string[] }>, prefix = "", out = new Map<string, unknown>()) => {
    for (const [name, value] of Object.entries(obj)) {
      const key = prefix + name;
      const spec = schema.get(key);
      if (spec && valid(key, value, spec)) out.set(key, value);
      else if (table(value) && [...schema.keys()].some(k => k.startsWith(`${key}.`))) take(table(value)!, schema, `${key}.`, out);
      else throw new Error();
    }
    return out;
  };
  const { connections: raw, ...root } = parsed;
  const fields = take(root, globals);
  const imported = new Map<string, Map<string, unknown>>();
  if (raw !== undefined && !table(raw)) throw new Error();
  for (const [name, row] of Object.entries(table(raw) ?? {})) {
    if (!validName(name) || !table(row)) throw new Error();
    const fields = take(table(row)!, connections);
    if (!fields.has("api") || !fields.has("base_url")) throw new Error();
    imported.set(name, fields);
  }
  if (!fields.size && !imported.size) throw new Error();
  return { fields, connections: imported };
}

export function settingsPreview(imported: ImportedSettings, facts: ConfigFacts) {
  const current = facts.file.values;
  const existing = table(current?.connections) ?? {};
  const changes: SettingsChange[] = [];
  const defaults: { field: string; before: unknown; value: unknown }[] = [];
  const loaded = table(facts.loaded.values?.connections) ?? {};
  const added: string[] = [], replaced: string[] = [], blocked: string[] = [];
  for (const [field, value] of imported.fields) {
    const before = at(current, field);
    if (same(before, value)) continue;
    changes.push({ field, value });
    defaults.push({ field, before, value });
  }
  for (const [name, connection] of imported.connections) {
    const prior = Object.hasOwn(existing, name) ? table(existing[name]) : undefined;
    (prior ? replaced : added).push(name);
    const repoints = (row: Table) => ["base_url", "api_key_header", "api"].some(field => !same(at(row, field), connection.get(field)));
    const guarded = (row: Table | undefined, source: unknown) => row && repoints(row) && (
      source !== "none" || facts.credentialsFile?.valid === false || CONNECTION_SECRETS.some(field => Object.hasOwn(row, field.key))
    );
    if (guarded(prior, at(facts.file.credentialSource, name)) || guarded(table(at(loaded, name)), at(facts.loaded.credentialSource, name))) blocked.push(name);
    for (const [key, value] of connection) {
      if (!same(at(prior, key), value)) changes.push({ field: fieldOf(["connections", name, ...key.split(".")]), value });
    }
    // Optional omitted overrides return to Core defaults. Do not touch private headers or credentials.
    for (const key of ["api_key_env", "api_key_header", "default_effort", "models.include", "models.exclude"]) {
      const value = at(prior, key);
      if (!connection.has(key) && value !== undefined && value !== null && (!Array.isArray(value) || value.length))
        changes.push({ field: fieldOf(["connections", name, ...key.split(".")]) });
    }
  }
  return { changes, added, replaced, blocked, defaults, hash: facts.file.contentHash };
}
