// Optional embeddings step: choose an existing connection and a model, then write
// `embedding.connection` and `embedding.model` together (both or neither, Shellboy configuration
// guide). Enabling starts automatic, possibly paid indexing of new conversation text, so this model
// sends no embeddings request: the only call to the provider is the model-list GET of
// `connection.test`, which is the same one setup already makes. Cost is never estimated.
import { batch, computed, signal, type ReadonlySignal, type Signal } from "@preact/signals-core";
import { Cancel, type OpError, type Operations } from "../../data/src";
import { fieldOf, readConfigFacts } from "./config";
import { dialectHasEmbeddings } from "./presets";
import type { ConnectionSetup, TestState } from "./setup";

export type EmbeddingSave =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "failed"; message: string }
  | { kind: "saved"; change: "on" | "off"; connection: string; model: string; restart: "required" | "none" | "unreported" };

const errText = (e: OpError): string => e.message;

export class EmbeddingSetup {
  readonly connection: Signal<string | undefined> = signal(undefined);
  readonly modelDraft: Signal<string> = signal("");
  readonly list: Signal<TestState> = signal({ kind: "idle" });
  readonly saveState: Signal<EmbeddingSave> = signal({ kind: "idle" });
  /** The person left this step to add a connection and is coming back to it. */
  readonly returning: Signal<boolean> = signal(false);

  /** Connections the file has, in its order. */
  readonly connections: ReadonlySignal<string[]>;
  /** What the file says now. */
  readonly current: ReadonlySignal<{ connection: string; model: string } | undefined>;
  /** The chosen connection's dialect has no Embeddings API: another connection is needed. */
  readonly unsupported: ReadonlySignal<boolean>;
  readonly models: ReadonlySignal<string[]>;
  readonly canSave: ReadonlySignal<boolean>;

  private cancel = new Cancel();
  private seq = 0;

  constructor(
    private readonly ops: Operations,
    private readonly setup: ConnectionSetup,
  ) {
    this.connections = computed(() => {
      const p = this.setup.probe.value;
      return p.state === "ready" ? p.connections : [];
    });
    this.current = computed(() => {
      const p = this.setup.probe.value;
      if (p.state !== "ready") return undefined;
      const { connection, model } = p.embedding;
      return connection !== undefined && model !== undefined ? { connection, model } : undefined;
    });
    this.unsupported = computed(() => {
      const c = this.connection.value;
      const p = this.setup.probe.value;
      return c !== undefined && p.state === "ready" && !dialectHasEmbeddings(p.known[c]?.api);
    });
    this.models = computed(() => {
      const t = this.list.value;
      return t.kind === "ok" ? t.facts.models : [];
    });
    this.canSave = computed(() => {
      const s = this.saveState.value.kind;
      return this.connection.value !== undefined && !this.unsupported.value && this.modelDraft.value.trim() !== "" && s !== "saving" && s !== "saved";
    });
  }

  /** The dialect of a connection, for showing beside its name. */
  apiOf(name: string): string | undefined {
    const p = this.setup.probe.peek();
    return p.state === "ready" ? p.known[name]?.api : undefined;
  }

  /** Choose a connection and ask its owner for the model list. A dialect without embeddings asks nothing. */
  choose(name: string): void {
    this.cancel.cancel();
    this.cancel = new Cancel();
    const cancel = this.cancel;
    const mine = ++this.seq;
    batch(() => {
      this.connection.value = name;
      this.modelDraft.value = "";
      this.saveState.value = { kind: "idle" };
      this.list.value = { kind: "idle" };
    });
    if (this.unsupported.peek()) return;
    this.list.value = { kind: "testing" };
    void (async () => {
      const out = await this.ops.connectionTest({ connection: name }, { cancel });
      if (cancel.cancelled || mine !== this.seq) return;
      if (!out.ok) {
        this.list.value = { kind: "error", message: errText(out.error) };
        return;
      }
      const f = out.value;
      this.list.value = f.failure || f.models.length === 0 ? { kind: "failed", failure: f.failure?.kind ?? "empty", status: f.httpStatus, message: f.failure?.message } : { kind: "ok", facts: f };
    })();
  }

  setModel(value: string): void {
    this.modelDraft.value = value;
    if (this.saveState.peek().kind === "failed") this.saveState.value = { kind: "idle" };
  }

  /** The person goes to add a connection; the one they save is chosen when they come back. */
  startAdd(): void {
    this.returning.value = true;
    this.setup.beginAdd();
  }
  comeBack(saved: string | undefined): void {
    this.returning.value = false;
    if (saved !== undefined) this.choose(saved);
  }

  /** Both fields, in one `config.set`. */
  save(): Promise<void> {
    const connection = this.connection.peek();
    const model = this.modelDraft.peek().trim();
    if (connection === undefined || !this.canSave.peek()) return Promise.resolve();
    return this.write("on", [
      { field: fieldOf(["embedding", "connection"]), value: connection },
      { field: fieldOf(["embedding", "model"]), value: model },
    ], connection, model);
  }

  /** Remove both fields: a change without a value removes the key. Nothing else is touched. */
  turnOff(): Promise<void> {
    const cur = this.current.peek();
    if (!cur || this.saveState.peek().kind === "saving") return Promise.resolve();
    return this.write("off", [{ field: fieldOf(["embedding", "connection"]) }, { field: fieldOf(["embedding", "model"]) }], cur.connection, cur.model);
  }

  private async write(change: "on" | "off", changes: { field: string; value?: unknown }[], connection: string, model: string): Promise<void> {
    this.saveState.value = { kind: "saving" };
    let result: Awaited<ReturnType<Operations["configSet"]>> | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const read = await this.ops.configGet();
      if (!read.ok) {
        this.saveState.value = { kind: "failed", message: errText(read.error) };
        return;
      }
      result = await this.ops.configSet(readConfigFacts(read.value).file.contentHash, changes);
      if (result.ok || result.error.kind !== "owner" || result.error.code !== "operation_conflict") break;
    }
    if (!result || !result.ok) {
      this.saveState.value = { kind: "failed", message: result ? errText(result.error) : "" };
      return;
    }
    const restart = result.value.restart_required;
    this.saveState.value = { kind: "saved", change, connection, model, restart: restart === true ? "required" : restart === false ? "none" : "unreported" };
    const p = this.setup.probe.peek();
    if (p.state === "ready") this.setup.probe.value = { ...p, embedding: change === "on" ? { connection, model } : { connection: undefined, model: undefined } };
  }

  /** Leaving drops the in-flight list and the choices. */
  leave(): void {
    this.cancel.cancel();
    this.cancel = new Cancel();
    this.seq++;
    batch(() => {
      this.connection.value = undefined;
      this.modelDraft.value = "";
      this.list.value = { kind: "idle" };
      this.saveState.value = { kind: "idle" };
      this.returning.value = false;
    });
  }
}
