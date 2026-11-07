// Settings editing: `config.get` and `config.set` (#266). Needs an owner newer than v0.10.0, so it
// sits behind a capability. Only fields the person changed are sent. Nothing the owner hid is ever
// sent back: a value containing the placeholder never becomes a change, here or on the owner.
import { batch, computed, signal, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { Cancel, type OpError, type Operations } from "../../data/src";
import type { ConfigKey } from "./resources";

export const CAPABILITY_CONFIG = "config.edit";
const PLACEHOLDER = "[redacted";

export type ConfigKind = "text" | "int" | "bool" | "choice" | "name";

export interface ConfigFieldSpec {
  kind: ConfigKind;
  options?: readonly string[];
}

/** Keys that aren't per connection: their path is the key. Bounds stay with the owner, which validates. */
export const CONFIG_FIELDS: Partial<Record<ConfigKey, ConfigFieldSpec>> = {
  default_connection: { kind: "choice" },
  default_model: { kind: "text" },
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
  "compaction.auto_at_tokens": { kind: "int" },
  "compaction.segment_chars": { kind: "int" },
  "compaction.reduce_rounds": { kind: "int" },
};

/** The rows of one connection. `labelKey` ends an i18n key under `config.conn.`. */
export const CONNECTION_FIELDS = [
  { key: "base_url", kind: "text" },
  { key: "api_key_env", kind: "name" },
  { key: "api_key_header", kind: "name" },
  { key: "default_effort", kind: "text" },
  { key: "ssl_verify", kind: "bool" },
  { key: "response_header_timeout_ms", kind: "int" },
  { key: "stream_idle_timeout_ms", kind: "int" },
  { key: "request_timeout_ms", kind: "int" },
  { key: "response_max_retries", kind: "int" },
] as const satisfies readonly { key: string; kind: ConfigKind }[];

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
}

export interface ConfigFacts {
  path: string | undefined;
  loaded: ConfigSide;
  file: ConfigSide & { valid: boolean; error: string | undefined };
  credentialSet: Record<string, boolean>;
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
    return { present: r.present === true, contentHash: typeof r.content_hash === "string" ? r.content_hash : "", values: record(r.values), redacted: strings(r.redacted_fields) };
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

export interface Draft {
  field: string;
  path: readonly string[];
  /** What the control holds. */
  raw: string;
  /** Sent to the owner. Undefined removes the key, and the default applies. */
  value: unknown;
  /** Written into a hidden entry, or was one: never shown in the review. */
  sensitive: boolean;
  invalid?: "number" | "json" | "placeholder";
}

export interface ConfigChangeRow {
  field: string;
  before: unknown;
  after: unknown;
  removes: boolean;
  /** Absent in the file before this change. */
  isNew: boolean;
  sensitive: boolean;
}

export interface SavedChange {
  field: string;
  previous?: unknown;
  value?: unknown;
  sensitive: boolean;
  restartRequired: boolean;
}

export type ConfigStage =
  | { kind: "editing" }
  | { kind: "review" }
  | { kind: "saving" }
  | { kind: "saved"; changes: SavedChange[]; restartRequired: boolean; warning: string | undefined }
  /** The file changed under the review. It was read again, so the review shows the new base. */
  | { kind: "conflict" }
  | { kind: "refused"; reason: string | undefined; field: string | undefined; message: string; recoveryFile: string | undefined }
  /** The reply didn't arrive. The file was read again, and whatever landed has left the drafts. */
  | { kind: "unconfirmed"; message: string };

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

export class ConfigEditor {
  readonly read: Signal<ConfigRead> = signal({ loading: false, value: undefined, error: undefined });
  readonly drafts: Signal<ReadonlyMap<string, Draft>> = signal(new Map());
  readonly stage: Signal<ConfigStage> = signal({ kind: "editing" });
  /** Every draft that would change the file, against the file as last read. */
  readonly changes: ReadonlySignal<ConfigChangeRow[]>;
  readonly hasInvalid: ReadonlySignal<boolean>;
  private cancel = new Cancel();
  private shown = false;

  constructor(private readonly ops: Operations) {
    this.changes = computed(() => {
      const values = this.read.value.value?.file.values;
      const rows: ConfigChangeRow[] = [];
      for (const d of this.drafts.value.values()) {
        if (d.invalid) continue;
        const before = valueAt(values, d.path);
        rows.push({ field: d.field, before: d.sensitive ? undefined : before, after: d.sensitive ? undefined : d.value, removes: d.value === undefined, isNew: before === undefined, sensitive: d.sensitive });
      }
      return rows;
    });
    this.hasInvalid = computed(() => [...this.drafts.value.values()].some((d) => d.invalid !== undefined));
  }

  /** Settings opened or changed section: the file may have changed since. */
  ensure(): void {
    this.shown = true;
    void this.refresh();
  }

  /** Nobody is looking: the read stops. Drafts stay, and a write already sent finishes. */
  leave(): void {
    if (!this.shown) return;
    this.shown = false;
    this.cancel.cancel();
    if (this.read.peek().loading) this.read.value = { ...this.read.peek(), loading: false };
  }

  async refresh(): Promise<void> {
    this.cancel.cancel();
    const cancel = (this.cancel = new Cancel());
    this.read.value = { ...this.read.peek(), loading: true };
    const out = await this.ops.configGet({ cancel });
    if (cancel.cancelled) return;
    if (!out.ok) {
      this.read.value = { ...this.read.peek(), loading: false, ...(out.error.kind === "cancelled" ? {} : { error: out.error }) };
      return;
    }
    const facts = readConfigFacts(out.value);
    batch(() => {
      this.read.value = { loading: false, value: facts, error: undefined };
      this.dropSettled(facts);
    });
  }

  /** A draft the file now agrees with has nothing left to do. */
  private dropSettled(facts: ConfigFacts): void {
    const next = new Map(this.drafts.peek());
    for (const [field, d] of next) {
      if (d.invalid || d.sensitive) continue;
      if (same(valueAt(facts.file.values, d.path), d.value)) next.delete(field);
    }
    if (next.size !== this.drafts.peek().size) this.drafts.value = next;
  }

  /** The value of a control changed. `kind` says how to read what's in it. */
  edit(path: readonly string[], raw: string, kind: ConfigKind | "secret" | "secret-json"): void {
    const field = fieldOf(path);
    const secret = kind === "secret" || kind === "secret-json";
    let value: unknown = raw;
    let invalid: Draft["invalid"];
    if (raw.includes(PLACEHOLDER)) invalid = "placeholder";
    else if (kind === "int") {
      if (raw.trim() === "") value = undefined;
      else {
        value = parseInt10(raw.trim());
        if (value === undefined) invalid = "number";
      }
    } else if (kind === "bool") value = raw === "true";
    else if (kind === "secret-json") {
      try {
        value = JSON.parse(raw);
        if (JSON.stringify(value).includes(PLACEHOLDER)) invalid = "placeholder";
      } catch {
        invalid = "json";
      }
    } else if (!secret && raw.trim() === "") value = undefined;
    const before = valueAt(this.read.peek().value?.file.values, path);
    const hadHidden = isHidden(before);
    const next = new Map(this.drafts.peek());
    if (!invalid && !secret && !hadHidden && same(before, value)) next.delete(field);
    else if (secret && raw === "") next.delete(field);
    else next.set(field, { field, path, raw, value, sensitive: secret || hadHidden, ...(invalid ? { invalid } : {}) });
    batch(() => {
      this.drafts.value = next;
      if (this.stage.peek().kind !== "saving") this.stage.value = { kind: "editing" };
    });
  }

  /** Take the key out of the file. Works on hidden entries, and needs no value. */
  remove(path: readonly string[], sensitive: boolean): void {
    const field = fieldOf(path);
    const next = new Map(this.drafts.peek());
    next.set(field, { field, path, raw: "", value: undefined, sensitive });
    batch(() => {
      this.drafts.value = next;
      this.stage.value = { kind: "editing" };
    });
  }

  undo(field: string): void {
    const next = new Map(this.drafts.peek());
    next.delete(field);
    this.drafts.value = next;
  }

  discard(): void {
    batch(() => {
      this.drafts.value = new Map();
      this.stage.value = { kind: "editing" };
    });
  }

  review(): void {
    if (!this.hasInvalid.peek() && this.changes.peek().length > 0) this.stage.value = { kind: "review" };
  }

  backToEditing(): void {
    this.stage.value = { kind: "editing" };
  }

  dismissResult(): void {
    this.stage.value = { kind: "editing" };
  }

  async save(): Promise<void> {
    const facts = this.read.peek().value;
    if (!facts || this.stage.peek().kind === "saving") return;
    const drafts = [...this.drafts.peek().values()];
    // The owner refuses this as well. It must not depend on that.
    if (drafts.some((d) => d.invalid !== undefined || d.field.includes(PLACEHOLDER) || isHidden(d.value))) return;
    if (drafts.length === 0) return;
    this.stage.value = { kind: "saving" };
    const changes = drafts.map((d) => (d.value === undefined ? { field: d.field } : { field: d.field, value: d.value }));
    const out = await this.ops.configSet(facts.file.contentHash, changes);
    if (out.ok) {
      batch(() => {
        this.drafts.value = new Map();
        this.stage.value = { kind: "saved", changes: readSaved(out.value), restartRequired: out.value.restart_required === true, warning: typeof out.value.warning === "string" ? out.value.warning : undefined };
      });
      await this.refresh();
      return;
    }
    const error = out.error;
    if (error.kind === "owner" && error.code === "operation_conflict") {
      await this.refresh();
      this.stage.value = { kind: "conflict" };
      return;
    }
    if (error.kind === "unconfirmed" || error.kind === "connection_lost") {
      await this.refresh();
      this.stage.value = { kind: "unconfirmed", message: error.message };
      return;
    }
    const details = error.kind === "owner" ? record(error.details) : undefined;
    const index = typeof details?.change_index === "number" ? details.change_index : undefined;
    this.stage.value = {
      kind: "refused",
      reason: typeof details?.reason === "string" ? details.reason : error.kind === "owner" ? error.code : undefined,
      field: index !== undefined ? drafts[index]?.field : undefined,
      message: error.message,
      recoveryFile: typeof details?.recovery_file === "string" ? details.recovery_file : undefined,
    };
  }
}

function readSaved(result: Record<string, unknown>): SavedChange[] {
  if (!Array.isArray(result.changes)) return [];
  return result.changes.flatMap((c): SavedChange[] => {
    const r = record(c);
    if (!r || typeof r.field !== "string") return [];
    return [{ field: r.field, ...("previous" in r ? { previous: r.previous } : {}), ...("value" in r ? { value: r.value } : {}), sensitive: r.sensitive === true, restartRequired: r.restart_required === true }];
  });
}

/** How a value reads in a row or the review. Hidden values never get here. */
export const showConfigValue = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));
