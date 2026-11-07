// First-run connection setup: pick a service, give a key, test, pick a model, save. The steps
// are the operations of Shellboy #269 (`connection.test`, `credentials.set`, `config.set`), which
// sit behind the `connection.setup` capability. Nothing here is optimistic, and nothing here
// ever shows, stores or logs a key: it lives in this object only from the test until the save,
// and the input is cleared the moment it is sent.
import { batch, computed, signal, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { Cancel, type Dialect, type OpError, type Operations, type TestFacts, type TestFailureClass } from "../../data/src";
import { fieldOf, readConfigFacts, type ConfigFacts } from "./config";
import { presetOf, type ServiceId, type ServicePreset } from "./presets";

export const CAPABILITY_CONNECTION_SETUP = "connection.setup";

/** What the screen knows about the file before it starts. */
export type SetupProbe =
  | { state: "idle" }
  | { state: "reading" }
  | { state: "ready"; connections: string[]; hasDefault: boolean; configPath: string | undefined; known: Record<string, KnownConnection>; embedding: EmbeddingFacts }
  /** The file can't be read or is invalid: setup isn't offered automatically. */
  | { state: "unreadable"; message: string };

/** What the file says about a connection that already exists. Never a key. */
export interface KnownConnection {
  api: string | undefined;
  /** The keys set in its table, so a replacement can remove the ones it no longer writes. */
  keys: string[];
}

/** The `[embedding]` table as the file has it: both set, both unset, or (invalid) one of them. */
export interface EmbeddingFacts {
  connection: string | undefined;
  model: string | undefined;
}

/** Why a typed connection name can't be used. The owner takes any non-empty TOML key; Studio takes the plain ones so a name is never quoted. */
export type NameProblem = "empty" | "chars" | "long" | "credential";
export const NAME_MAX = 64;

/** Mirrors the owner's heuristic for credential-looking names (`looks_like_credential`): such a name is refused by `config.set`. */
const CREDENTIAL_PREFIXES = ["sk-", "sk_", "pk_", "rk_", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "glpat-", "xoxb-", "xoxp-", "xoxa-", "xapp-", "hf_", "ya29.", "eyJ"];
const looksLikeCredential = (v: string): boolean => {
  const hasDigit = /[0-9]/.test(v);
  const lower = v.toLowerCase();
  return (v.length >= 16 && hasDigit && CREDENTIAL_PREFIXES.some((p) => v.startsWith(p))) || (v.length >= 32 && hasDigit && /^[A-Za-z0-9]+$/.test(v)) || lower.startsWith("bearer ") || lower.startsWith("basic ");
};

export function nameProblem(name: string): NameProblem | undefined {
  if (name === "") return "empty";
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return "chars";
  if (name.length > NAME_MAX) return "long";
  if (looksLikeCredential(name)) return "credential";
  return undefined;
}

export type EnvOffer =
  | { kind: "none" }
  | { kind: "checking" }
  | { kind: "offered"; name: string; facts: TestFacts }
  | { kind: "absent" }
  | { kind: "declined" }
  | { kind: "using"; name: string };

export type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; facts: TestFacts }
  | { kind: "failed"; failure: TestFailureClass | "empty"; status: number | undefined; message: string | undefined }
  /** The call itself failed (no reply, not allowed): there are no facts about the provider. */
  | { kind: "error"; message: string };

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "failed"; message: string; keyStored: boolean }
  | { kind: "saved"; connection: string; model: string; madeDefault: boolean; replaced: boolean; keyPath: string | undefined; usesStoredKey: boolean; restart: "required" | "none" | "unreported" };

/** Only a preset's own address is asked about its variable; a key from the environment never goes to a typed address unasked. */
const detects = (s: ServicePreset): boolean => s.envName !== undefined && s.needsKey && !s.askUrl;

const errText = (e: OpError): string => e.message;

const dirOf = (path: string): string => {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : path;
};

export class ConnectionSetup {
  readonly probe: Signal<SetupProbe> = signal({ state: "idle" });
  readonly service: Signal<ServicePreset | undefined> = signal(undefined);
  readonly baseUrl: Signal<string> = signal("");
  readonly api: Signal<Dialect> = signal("chat_completions");
  /** The person opened the address and format of a preset that doesn't ask for them. */
  readonly editing: Signal<boolean> = signal(false);
  /** The key input. Cleared as soon as the key is sent. */
  readonly keyDraft: Signal<string> = signal("");
  /** A key was sent for the test and is held for the save. Its value is never exposed. */
  readonly keyHeld: Signal<boolean> = signal(false);
  readonly env: Signal<EnvOffer> = signal({ kind: "none" });
  readonly test: Signal<TestState> = signal({ kind: "idle" });
  readonly model: Signal<string> = signal("");
  readonly saveState: Signal<SaveState> = signal({ kind: "idle" });
  /** The typed connection name. Undefined: the preset's name, or a free variant of it, is used. */
  readonly nameDraft: Signal<string | undefined> = signal(undefined);
  /** The person agreed that saving replaces the connection that has this name. */
  readonly confirmReplace: Signal<boolean> = signal(false);
  /** Write `default_connection` and `default_model`. On only when the file has no default yet. */
  readonly makeDefault: Signal<boolean> = signal(true);
  /** Setup was shown by itself once: leaving it must not bring it back. */
  private autoShown = false;
  private entered = false;

  /** No connection in the file the owner reads. Only true after a successful read. */
  readonly needed: ReadonlySignal<boolean>;
  readonly models: ReadonlySignal<string[]>;
  readonly connectionName: ReadonlySignal<string>;
  readonly suggestedName: ReadonlySignal<string>;
  readonly nameProblem: ReadonlySignal<NameProblem | undefined>;
  /** The chosen name is a connection that exists: saving would replace its address, format and key. */
  readonly replaces: ReadonlySignal<boolean>;
  readonly hasDefault: ReadonlySignal<boolean>;
  readonly canTest: ReadonlySignal<boolean>;
  readonly canSave: ReadonlySignal<boolean>;

  private key = "";
  private keyStored = false;
  private cancel = new Cancel();
  private seq = 0;

  constructor(private readonly ops: Operations) {
    this.needed = computed(() => {
      const p = this.probe.value;
      return p.state === "ready" && p.connections.length === 0;
    });
    this.models = computed(() => {
      const t = this.test.value;
      return t.kind === "ok" ? t.facts.models : [];
    });
    this.suggestedName = computed(() => {
      const base = this.service.value?.connectionName ?? "";
      const p = this.probe.value;
      const taken = new Set(p.state === "ready" ? p.connections : []);
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
      return name;
    });
    this.connectionName = computed(() => (this.nameDraft.value === undefined ? this.suggestedName.value : this.nameDraft.value.trim()));
    this.nameProblem = computed(() => nameProblem(this.connectionName.value));
    this.replaces = computed(() => {
      const p = this.probe.value;
      return p.state === "ready" && p.connections.includes(this.connectionName.value);
    });
    this.hasDefault = computed(() => {
      const p = this.probe.value;
      return p.state === "ready" && p.hasDefault;
    });
    this.canTest = computed(() => {
      const s = this.service.value;
      if (!s || this.test.value.kind === "testing" || this.env.value.kind === "checking") return false;
      if (this.baseUrl.value.trim() === "") return false;
      if (s.needsKey && this.env.value.kind !== "using" && !this.keyHeld.value && this.keyDraft.value.trim() === "") return false;
      return true;
    });
    this.canSave = computed(() => this.test.value.kind === "ok" && (!this.makeDefault.value || this.model.value.trim() !== "") && this.nameProblem.value === undefined && (!this.replaces.value || this.confirmReplace.value) && this.saveState.value.kind !== "saving" && this.saveState.value.kind !== "saved");
  }

  /** True once, when the screen should open by itself. */
  takeAutoShow(): boolean {
    if (this.autoShown || !this.needed.peek()) return false;
    this.autoShown = true;
    return true;
  }

  /** Once per visit to the screen: read the file again, so connections added elsewhere or by an earlier visit are known. */
  enter(): void {
    if (this.entered) return;
    this.entered = true;
    if (this.probe.peek().state === "ready") void this.readFile(true);
  }

  /** Read the file to learn which connections exist and where it lives. Quiet: keep what is known if the read fails. */
  async readFile(quiet = false): Promise<ConfigFacts | undefined> {
    this.entered = true;
    if (!quiet) this.probe.value = { state: "reading" };
    const out = await this.ops.configGet();
    if (!out.ok) {
      if (!quiet) this.probe.value = { state: "unreadable", message: errText(out.error) };
      return undefined;
    }
    const facts = readConfigFacts(out.value);
    if (!facts.file.valid && facts.file.present) {
      if (!quiet) this.probe.value = { state: "unreadable", message: facts.file.error ?? "" };
      return facts;
    }
    const side = facts.file.present ? facts.file : facts.loaded;
    const conns = (side.values?.connections ?? {}) as Record<string, unknown>;
    const loadedConns = (facts.loaded.values?.connections ?? {}) as Record<string, unknown>;
    const names = [...new Set([...Object.keys(conns), ...Object.keys(loadedConns)])];
    const known: Record<string, KnownConnection> = {};
    for (const n of names) {
      const table = conns[n] ?? loadedConns[n];
      const t = table && typeof table === "object" && !Array.isArray(table) ? (table as Record<string, unknown>) : {};
      known[n] = { api: typeof t.api === "string" ? t.api : undefined, keys: Object.keys(t) };
    }
    const emb = (side.values?.embedding ?? {}) as Record<string, unknown>;
    const embedding: EmbeddingFacts = { connection: typeof emb.connection === "string" ? emb.connection : undefined, model: typeof emb.model === "string" ? emb.model : undefined };
    this.probe.value = { state: "ready", connections: names, hasDefault: typeof side.values?.default_connection === "string", configPath: facts.path, known, embedding };
    return facts;
  }

  /** Start a fresh connection: nothing of an earlier save or choice stays. */
  beginAdd(): void {
    this.leave();
    this.entered = false;
    this.enter();
  }

  choose(id: ServiceId): void {
    const s = presetOf(id);
    this.cancel.cancel();
    this.cancel = new Cancel();
    this.wipeKey();
    batch(() => {
      this.service.value = s;
      this.baseUrl.value = s.baseUrl;
      this.api.value = s.api;
      this.editing.value = false;
      this.keyDraft.value = "";
      this.test.value = { kind: "idle" };
      this.model.value = "";
      this.saveState.value = { kind: "idle" };
      this.nameDraft.value = undefined;
      this.confirmReplace.value = false;
      this.makeDefault.value = !this.hasDefault.peek();
      this.env.value = detects(s) ? { kind: "checking" } : { kind: "none" };
    });
    if (detects(s)) void this.detectEnv(s, this.cancel);
  }

  /** The dialect or address changed: earlier results are about something else. */
  setBaseUrl(value: string): void {
    this.baseUrl.value = value;
    this.forgetTest();
  }
  setApi(api: Dialect): void {
    this.api.value = api;
    this.forgetTest();
  }
  setName(value: string): void {
    batch(() => {
      this.nameDraft.value = value;
      this.confirmReplace.value = false;
    });
  }
  setConfirmReplace(on: boolean): void {
    this.confirmReplace.value = on;
  }
  setMakeDefault(on: boolean): void {
    this.makeDefault.value = on;
  }
  editConnection(): void {
    this.editing.value = true;
  }
  setKeyDraft(value: string): void {
    this.keyDraft.value = value;
  }
  /** Take a typed key back out: the person wants to enter another. */
  replaceKey(): void {
    this.wipeKey();
    this.forgetTest();
  }

  private forgetTest(): void {
    this.cancel.cancel();
    this.cancel = new Cancel();
    batch(() => {
      this.test.value = { kind: "idle" };
      this.model.value = "";
      // What was learned about the variable was about the old address; a key is only sent from here on request.
      const env = this.env.value.kind;
      if (env === "using" || env === "offered" || env === "checking") this.env.value = { kind: "declined" };
    });
  }

  private wipeKey(): void {
    this.key = "";
    this.keyStored = false;
    this.keyHeld.value = false;
  }

  private candidate(s: ServicePreset, useEnv: boolean) {
    return {
      baseUrl: this.baseUrl.value.trim(),
      api: this.api.value,
      ...(s.apiKeyHeader !== undefined && { apiKeyHeader: s.apiKeyHeader }),
      ...(useEnv && s.envName !== undefined && { apiKeyEnv: s.envName }),
      ...(!useEnv && this.key !== "" && { apiKey: this.key }),
    };
  }

  /** Ask the owner whether the preset's variable has a value. The same call also fetches the list. */
  private async detectEnv(s: ServicePreset, cancel: Cancel): Promise<void> {
    const out = await this.ops.connectionTest({ candidate: this.candidate(s, true) }, { cancel });
    if (cancel.cancelled) return;
    if (!out.ok) {
      this.env.value = { kind: "absent" };
      return;
    }
    const f = out.value;
    this.env.value = f.env?.set === true && s.envName ? { kind: "offered", name: s.envName, facts: f } : { kind: "absent" };
  }

  /** The person accepts the variable the owner already has. Its test result is the one shown. */
  useEnv(): void {
    const e = this.env.value;
    if (e.kind !== "offered") return;
    this.wipeKey();
    batch(() => {
      this.env.value = { kind: "using", name: e.name };
      this.keyDraft.value = "";
      this.applyFacts(e.facts);
    });
  }

  declineEnv(): void {
    if (this.env.value.kind === "offered") this.env.value = { kind: "declined" };
  }

  private applyFacts(f: TestFacts): void {
    if (f.failure || f.models.length === 0) {
      this.test.value = { kind: "failed", failure: f.failure?.kind ?? "empty", status: f.httpStatus, message: f.failure?.message };
    } else this.test.value = { kind: "ok", facts: f };
  }

  async runTest(): Promise<void> {
    const s = this.service.peek();
    if (!s || !this.canTest.peek()) return;
    const useEnv = this.env.peek().kind === "using";
    // The key is sent now and the field is emptied at once. It is held for the save only.
    if (!useEnv && this.keyDraft.peek().trim() !== "") {
      this.key = this.keyDraft.peek().trim();
      this.keyStored = false;
      batch(() => {
        this.keyDraft.value = "";
        this.keyHeld.value = true;
      });
    }
    const mine = ++this.seq;
    this.cancel.cancel();
    const cancel = (this.cancel = new Cancel());
    this.test.value = { kind: "testing" };
    const out = await this.ops.connectionTest({ candidate: this.candidate(s, useEnv) }, { cancel });
    if (cancel.cancelled || mine !== this.seq) return;
    if (!out.ok) {
      this.test.value = { kind: "error", message: errText(out.error) };
      return;
    }
    batch(() => {
      this.applyFacts(out.value);
      // A rejected key is of no use: the person enters another.
      if (this.test.peek().kind === "failed" && out.value.failure?.kind === "auth") this.wipeKey();
    });
  }

  setModel(value: string): void {
    this.model.value = value;
    if (this.saveState.peek().kind === "failed") this.saveState.value = { kind: "idle" };
  }

  /** Store the key if one was typed, then write the connection and make it the default. */
  async save(): Promise<void> {
    const s = this.service.peek();
    const p = this.probe.peek();
    if (!s || p.state !== "ready" || !this.canSave.peek()) return;
    const name = this.connectionName.peek();
    const model = this.model.peek().trim();
    const replaced = this.replaces.peek();
    const asDefault = this.makeDefault.peek();
    const useEnv = this.env.peek().kind === "using";
    this.saveState.value = { kind: "saving" };
    let keyPath: string | undefined;
    if (!useEnv && this.key !== "" && !this.keyStored) {
      const stored = await this.ops.credentialsSet(name, this.key);
      if (!stored.ok) {
        this.saveState.value = { kind: "failed", message: errText(stored.error), keyStored: false };
        return;
      }
      this.keyStored = true;
      keyPath = stored.value.path;
    }
    const changes: { field: string; value?: unknown }[] = [
      { field: fieldOf(["connections", name, "base_url"]), value: this.baseUrl.peek().trim() },
      { field: fieldOf(["connections", name, "api"]), value: this.api.peek() },
      // Only when chosen: the variable would win over a stored key at every request.
      ...(useEnv && s.envName !== undefined ? [{ field: fieldOf(["connections", name, "api_key_env"]), value: s.envName }] : []),
      ...(s.apiKeyHeader !== undefined ? [{ field: fieldOf(["connections", name, "api_key_header"]), value: s.apiKeyHeader }] : []),
      ...(asDefault ? [{ field: "default_connection", value: name }, { field: "default_model", value: model }] : []),
    ];
    // A replacement must not keep the old variable or header: the variable would win over the key just stored.
    if (replaced) {
      const written = new Set(changes.map((c) => c.field));
      for (const k of p.known[name]?.keys ?? [])
        if ((k === "api_key_env" || k === "api_key_header") && !written.has(fieldOf(["connections", name, k]))) changes.push({ field: fieldOf(["connections", name, k]) });
    }
    // Read the hash just before writing, so another program's edit isn't overwritten.
    let result: Awaited<ReturnType<Operations["configSet"]>> | undefined;
    let path = p.configPath;
    for (let attempt = 0; attempt < 2; attempt++) {
      const read = await this.ops.configGet();
      if (!read.ok) {
        this.saveState.value = { kind: "failed", message: errText(read.error), keyStored: this.keyStored };
        return;
      }
      const facts = readConfigFacts(read.value);
      path = facts.path ?? path;
      result = await this.ops.configSet(facts.file.contentHash, changes);
      if (result.ok || result.error.kind !== "owner" || result.error.code !== "operation_conflict") break;
    }
    if (!result || !result.ok) {
      this.saveState.value = { kind: "failed", message: result ? errText(result.error) : "", keyStored: this.keyStored };
      return;
    }
    const restart = result.value.restart_required;
    const usesStoredKey = this.keyStored;
    // The key has done its work: nothing holds it any more.
    this.wipeKey();
    batch(() => {
      this.saveState.value = {
        kind: "saved",
        connection: name,
        model,
        madeDefault: asDefault,
        replaced,
        keyPath: usesStoredKey ? (keyPath ?? (path ? `${dirOf(path)}/credentials.toml` : undefined)) : undefined,
        usesStoredKey,
        restart: restart === true ? "required" : restart === false ? "none" : "unreported",
      };
      const nowKnown: KnownConnection = { api: this.api.peek(), keys: ["base_url", "api"] };
      this.probe.value = { ...p, connections: p.connections.includes(name) ? p.connections : [...p.connections, name], hasDefault: p.hasDefault || asDefault, known: { ...p.known, [name]: nowKnown } };
    });
  }

  /** Leaving the screen drops every in-flight read and every held key. */
  leave(): void {
    this.cancel.cancel();
    this.cancel = new Cancel();
    this.seq++;
    this.wipeKey();
    batch(() => {
      this.service.value = undefined;
      this.keyDraft.value = "";
      this.test.value = { kind: "idle" };
      this.env.value = { kind: "none" };
      this.model.value = "";
      this.saveState.value = { kind: "idle" };
      this.nameDraft.value = undefined;
      this.confirmReplace.value = false;
    });
    this.entered = false;
  }
}
