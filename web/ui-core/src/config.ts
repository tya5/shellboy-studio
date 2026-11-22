// Settings editing: `config.get` and `config.set` (#266). Needs an owner newer than v0.10.0, so it
// sits behind a capability. Only fields the person changed are sent. Nothing the owner hid is ever
// sent back: a value containing the placeholder never becomes a change, here or on the owner.
import { signal, type Signal } from "@preact/signals-core";
import { Cancel, type OpError, type Operations } from "../../data/src";
import type { ConfigKey } from "./resources";

export const CAPABILITY_CONFIG = "config.edit";
const PLACEHOLDER = "[redacted";

export type ConfigKind = "text" | "int" | "float" | "bool" | "choice" | "name" | "kinds";

export interface ConfigFieldSpec {
  kind: ConfigKind;
  options?: readonly string[];
}

/** Keys that aren't per connection: their path is the key. Bounds stay with the owner, which validates. */
export const CONFIG_FIELDS: Partial<Record<ConfigKey, ConfigFieldSpec>> = {
  default_connection: { kind: "choice" },
  default_model: { kind: "text" },
  "ui.language": { kind: "choice", options: ["en", "ja"] },
  "embedding.connection": { kind: "choice" },
  "embedding.model": { kind: "text" },
  "indexing.auto_history": { kind: "bool" },
  "indexing.auto_kinds": { kind: "kinds" },
  "limits.disk_free_min_bytes": { kind: "int" },
  "limits.attachment_file_bytes": { kind: "int" },
  "limits.attachment_request_bytes": { kind: "int" },
  "limits.shell_raw_bytes": { kind: "int" },
  "limits.tool_excerpt_bytes": { kind: "int" },
  "limits.shell_stdin_bytes": { kind: "int" },
  "limits.draft_bytes": { kind: "int" },
  "embedding.batch_max_inputs": { kind: "int" },
  "embedding.batch_max_chars": { kind: "int" },
  "indexing.split_chars": { kind: "int" },
  "indexing.concurrency": { kind: "int" },
  "shell.kind": { kind: "choice", options: ["bash", "powershell"] },
  "shell.executable": { kind: "text" },
  "limits.data_warning_bytes": { kind: "int" },
  "limits.data_max_bytes": { kind: "int" },
  "retention.tool_raw_days": { kind: "int" },
  "retention.tool_raw_bytes": { kind: "int" },
  "retention.clipboard_days": { kind: "int" },
  "retention.clipboard_bytes": { kind: "int" },
  "compaction.summary_max_chars": { kind: "int" },
  "compaction.auto_at_tokens": { kind: "int" },
};

/** The rows of one connection. `labelKey` ends an i18n key under `config.conn.`. */
export const CONNECTION_FIELDS = [
  { key: "api", kind: "choice", options: ["responses", "chat_completions", "anthropic_messages"] },
  { key: "base_url", kind: "text" },
  { key: "api_key_env", kind: "name" },
  { key: "api_key_header", kind: "name" },
  { key: "default_effort", kind: "text" },
  { key: "max_tokens", kind: "int" },
  { key: "ssl_verify", kind: "bool" },
  { key: "response_header_timeout_ms", kind: "int" },
  { key: "stream_idle_timeout_ms", kind: "int" },
  { key: "request_timeout_ms", kind: "int" },
  { key: "response_max_retries", kind: "int" },
] as const satisfies readonly { key: string; kind: ConfigKind; options?: readonly string[] }[];

/** Entries whose values the owner hides. `extra_body` values are JSON; the others are text. */
export const CONNECTION_SECRETS = [
  { key: "headers", json: false },
  { key: "extra_headers", json: false },
  { key: "extra_body", json: true },
] as const satisfies readonly { key: string; json: boolean }[];

/** An entry whose name itself looked like a credential: it can't be addressed from here. */
export const isHiddenName = (name: string): boolean => name.includes(PLACEHOLDER);

export interface ConfigSide {
  present: boolean;
  contentHash: string;
  values: Record<string, unknown> | undefined;
  redacted: readonly string[];
  credentialSource?: Record<string, unknown> | undefined;
}

export interface ConfigFacts {
  path: string | undefined;
  loaded: ConfigSide;
  file: ConfigSide & { valid: boolean; error: string | undefined };
  credentialSet: Record<string, boolean>;
  credentialsFile?: { path: string | undefined; present: boolean; valid: boolean; error: string | undefined } | undefined;
  differs: boolean;
  /** Undefined when the file is invalid and the owner can't compare. */
  differing: readonly string[] | undefined;
  restartAll: boolean;
}

const record = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function readConfigFacts(raw: Record<string, unknown>): ConfigFacts {
  const side = (v: unknown): ConfigSide => {
    const r = record(v) ?? {};
    return { present: r.present === true, contentHash: typeof r.content_hash === "string" ? r.content_hash : "", values: record(r.values), redacted: strings(r.redacted_fields), ...(record(r.credential_source) ? { credentialSource: record(r.credential_source) } : {}) };
  };
  const loaded = record(raw.loaded) ?? {};
  const file = record(raw.file) ?? {};
  const set: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(record(loaded.credential_env_set) ?? {})) if (typeof v === "boolean") set[k] = v;
  return {
    path: typeof raw.config_path === "string" ? raw.config_path : undefined,
    loaded: side(loaded),
    file: { ...side(file), valid: file.valid === true, error: typeof file.error === "string" ? file.error : undefined },
    credentialSet: set,
    ...(record(raw.credentials_file) ? { credentialsFile: { path: typeof record(raw.credentials_file)?.path === "string" ? record(raw.credentials_file)!.path as string : undefined, present: record(raw.credentials_file)?.present === true, valid: record(raw.credentials_file)?.valid === true, error: typeof record(raw.credentials_file)?.error === "string" ? record(raw.credentials_file)!.error as string : undefined } } : {}),
    differs: raw.differs === true,
    differing: Array.isArray(raw.differing_fields) ? strings(raw.differing_fields) : undefined,
    restartAll: record(raw.restart)?.all_fields_require_restart === true,
  };
}

/** One part of a TOML dotted key, quoted when it isn't a bare key. */
const part = (p: string): string => (/^[A-Za-z0-9_-]+$/.test(p) ? p : JSON.stringify(p));
export const fieldOf = (path: readonly string[]): string => path.map(part).join(".");

export function valueAt(values: Record<string, unknown> | undefined, path: readonly string[]): unknown {
  let at: unknown = values;
  for (const p of path) {
    const r = record(at);
    if (!r) return undefined;
    at = r[p];
  }
  return at;
}

/** Anything the owner hid, wherever it sits in the value. */
export const isHidden = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  return JSON.stringify(value).includes(PLACEHOLDER);
};

interface SavedSetting {
  hash: string;
  field: string;
  path: readonly string[];
  undo: ConfigWrite[];
  restartRequired: boolean | undefined;
}

interface ConfigRead {
  loading: boolean;
  value: ConfigFacts | undefined;
  error: OpError | undefined;
}

const parseInt10 = (raw: string): number | undefined => {
  if (!/^-?\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

type ConfigWrite = { field: string; value?: unknown };
const configWrite = (field: string, value: unknown): ConfigWrite => value === undefined ? { field } : { field, value };

export class ConfigEditor {
  readonly read: Signal<ConfigRead> = signal({ loading: false, value: undefined, error: undefined });
  readonly connectionAction: Signal<{ name: string; state: "testing" | "ok" | "failed" | "clearing" | "cleared" | "unconfirmed" } | undefined> = signal(undefined);
  readonly lastSaved: Signal<SavedSetting | undefined> = signal(undefined);
  readonly fieldError: Signal<{ field: string; reason: string } | undefined> = signal(undefined);
  readonly fieldSaving: Signal<boolean> = signal(false);
  private inFlight?: Cancel;
  private readAgain = false;
  readonly pendingField: Signal<string | undefined> = signal(undefined);
  private shown = false;
  private session = 0;
  readonly changedElsewhere = signal<string | undefined>(undefined);
  private confirmation?: { field: string; expected: string; observed?: string; saved?: SavedSetting };

  /** A config mark or resync invalidates the current Settings snapshot. */
  configChanged(): void {
    if (this.shown) void this.refresh();
  }

  private confirmWrite(): void {
    const pending = this.confirmation;
    if (!pending?.saved || pending.observed === undefined) return;
    this.confirmation = undefined;
    if (pending.observed === pending.saved.hash && this.read.peek().value?.file.contentHash === pending.saved.hash) {
      this.lastSaved.value = pending.saved;
    } else this.changedElsewhere.value = pending.field;
    this.pendingField.value = undefined;
    this.fieldSaving.value = false;
  }

  constructor(private readonly ops: Operations) {}

  async testConnection(name: string): Promise<void> {
    if (["testing", "clearing"].includes(this.connectionAction.peek()?.state ?? "")) return;
    this.connectionAction.value = { name, state: "testing" };
    const result = await this.ops.connectionTest({ connection: name });
    this.connectionAction.value = { name, state: result.ok && result.value.ok === true ? "ok" : "failed" };
  }

  async clearCredential(name: string): Promise<void> {
    if (["testing", "clearing"].includes(this.connectionAction.peek()?.state ?? "")) return;
    this.connectionAction.value = { name, state: "clearing" };
    const result = await this.ops.credentialsClear(name);
    const uncertain = !result.ok && (result.error.kind === "unconfirmed" || result.error.kind === "connection_lost");
    this.connectionAction.value = { name, state: result.ok ? "cleared" : uncertain ? "unconfirmed" : "failed" };
  }

  /** All Settings sections share one snapshot and one read lifetime. */
  ensure(): void {
    if (this.shown) return;
    this.shown = true;
    void this.refresh();
  }

  /** Nobody is looking: the read stops. A write already sent finishes. */
  leave(): void {
    if (!this.shown) return;
    this.shown = false;
    this.session++;
    if (this.confirmation) this.fieldSaving.value = false;
    this.confirmation = undefined;
    this.pendingField.value = undefined;
    this.lastSaved.value = undefined;
    this.fieldError.value = undefined;
    this.changedElsewhere.value = undefined;
    this.inFlight?.cancel();
    this.inFlight = undefined;
    this.readAgain = false;
    if (this.read.peek().loading) this.read.value = { ...this.read.peek(), loading: false };
  }

  private async refresh(): Promise<void> {
    if (this.inFlight) {
      this.readAgain = true;
      return;
    }
    const cancel = (this.inFlight = new Cancel());
    do {
      this.readAgain = false;
      this.read.value = { ...this.read.peek(), loading: true };
      const out = await this.ops.configGet({ cancel });
      if (cancel.cancelled) return;
      if (out.ok) {
        const value = readConfigFacts(out.value);
        const hash = value.file.contentHash;
        this.read.value = { loading: false, value, error: undefined };
        const saved = this.lastSaved.peek();
        if (saved && hash !== saved.hash) this.lastSaved.value = undefined;
        const pending = this.confirmation;
        if (pending && hash !== pending.expected) {
          pending.observed = hash;
          this.confirmWrite();
        }
      } else {
        this.read.value = { ...this.read.peek(), loading: false, error: out.error };
      }
    } while (!cancel.cancelled && this.readAgain);
    if (this.inFlight === cancel) this.inFlight = undefined;
  }

  /** Save a single setting using the same write/read path as a model pair. */
  async saveField(path: readonly string[], raw: string, kind: ConfigKind | "secret" | "secret-json"): Promise<void> {
    if (this.fieldSaving.peek()) return;
    const field = fieldOf(path);
    const sensitive = kind === "secret" || kind === "secret-json";
    if (sensitive && !raw) return;
    const before = valueAt(this.read.peek().value?.file.values, path);
    let value: unknown = raw;
    let error: string | undefined;
    if (raw.includes(PLACEHOLDER)) error = "placeholder";
    else if (kind === "int" || kind === "float") {
      value = !raw.trim() ? undefined : kind === "int" ? parseInt10(raw.trim()) : Number(raw);
      if (raw.trim() && (typeof value !== "number" || !Number.isFinite(value))) error = "number";
    } else if (kind === "bool") value = raw === "true";
    else if (kind === "kinds") value = raw ? raw.split(",").filter(Boolean) : [];
    else if (kind === "secret-json") {
      try { value = JSON.parse(raw); } catch { error = "json"; }
      if (isHidden(value)) error = "placeholder";
    } else if (!sensitive && !raw.trim()) value = undefined;
    if (error) { this.fieldError.value = { field, reason: error }; return; }
    if (!sensitive && same(before, value)) return;
    await this.writeSetting(path, [configWrite(field, value)], !sensitive && !isHidden(before));
  }

  async saveModelPair(connectionPath: readonly string[], modelPath: readonly string[], connection: string, model: string): Promise<void> {
    const values = this.read.peek().value?.file.values;
    if (valueAt(values, connectionPath) === connection && valueAt(values, modelPath) === model) return;
    await this.writeSetting(connectionPath, [configWrite(fieldOf(connectionPath), connection), configWrite(fieldOf(modelPath), model)], true, [connectionPath, modelPath]);
  }

  async removeField(path: readonly string[]): Promise<void> {
    await this.writeSetting(path, [{ field: fieldOf(path) }], false);
  }

  async undoLast(): Promise<void> {
    const saved = this.lastSaved.peek();
    if (saved?.undo.length) await this.writeSetting(saved.path, saved.undo, false);
  }

  private async writeSetting(path: readonly string[], changes: ConfigWrite[], undoable: boolean, paths = [path]): Promise<void> {
    const read = this.read.peek();
    if (this.fieldSaving.peek() || read.error || !read.value?.file.valid) return;
    const field = fieldOf(path);
    const file = read.value.file;
    const previous = paths.map((key) => configWrite(fieldOf(key), valueAt(file.values, key)));
    if (changes.some((change) => isHidden(change.value))) return;
    const undo = undoable && previous.every((change) => !isHidden(change.value)) ? previous : [];
    const session = this.session;
    const pending: NonNullable<ConfigEditor["confirmation"]> = { field, expected: file.contentHash };
    this.confirmation = pending;
    this.fieldSaving.value = true;
    this.pendingField.value = field;
    this.lastSaved.value = undefined;
    this.fieldError.value = undefined;
    this.changedElsewhere.value = undefined;
    try {
      const out = await this.ops.configSet(file.contentHash, changes);
      if (!this.shown || session !== this.session) return;
      if (!out.ok) {
        this.fieldError.value = { field, reason: out.error.message };
        return;
      }
      if (out.value.written === false) return;
      const hash = out.value.content_hash;
      if (typeof hash !== "string" || !hash) return;
      const changed = Array.isArray(out.value.changes) ? out.value.changes.map(record).filter((change) => changes.some(({ field }) => change?.field === field)) : [];
      const exact = changed.map((change) => change?.restart_required).filter((value): value is boolean => typeof value === "boolean");
      const restartRequired = exact.length ? exact.some(Boolean) : typeof out.value.restart_required === "boolean" ? out.value.restart_required : undefined;
      pending.saved = { hash, field, path, restartRequired, undo: changed.some((change) => change?.sensitive === true) ? [] : undo };
      this.confirmWrite();
    } finally {
      if (this.confirmation === pending && !pending.saved) {
        this.confirmation = undefined;
        this.pendingField.value = undefined;
        this.fieldSaving.value = false;
      }
    }
  }
}

/** How a value reads in a row. Hidden values never get here. */
export const showConfigValue = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));
