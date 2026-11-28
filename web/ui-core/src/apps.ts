// Apps: the list, the open tabs, and what an app's page reports. Tabs live here, so an app keeps
// running while other views show. Everything an app sends is treated as text from an untrusted page.
import { batch, signal, type Signal } from "@preact/signals-core";
import { Cancel, type Operations, type OpError } from "../../data/src";
import { RetainedBudget, retainedStringBytes, type RetainedReservation } from "../../data/src/retained-budget";
import { validAppInstance } from "./route";

/** An app is an artifact, so `name` is its artifact ID and `thread` its owner Thread. */
export interface AppInfo {
  name: string;
  title: string;
  thread: string | undefined;
}

export interface AppListState {
  loading: boolean;
  loaded: boolean;
  /** The Thread these apps were read for. */
  thread: string | undefined;
  apps: AppInfo[];
  /** Core's cursor for the next page of this Thread's artifacts; undefined when all were read. */
  next: string | undefined;
  /** A Show more read is in flight. */
  loadingMore: boolean;
  error: OpError | undefined;
}

export interface AppErrorReport {
  kind: string;
  message: string;
  where: string | undefined;
}

export type AppSendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

export interface OpenApp {
  name: string;
  instance?: string;
  title: string;
  url: string;
  thread: string | undefined;
  threadTitle: string | undefined;
  /** The bound Thread: the app stays readable either way. */
  threadState: "unbound" | "ok" | "archived" | "missing";
  errors: AppErrorReport[];
  send: AppSendState;
}

/** Kept per tab. An app in a loop can't grow this. */
export const MAX_APP_ERRORS = 20;
/** API calls one open app can have outstanding. Past this, a call is refused with code `busy`. */
export const MAX_APP_CALLS = 64;
/** These wait on hints and hold no owner connection, so they don't take an ordinary call slot. */
const WAITING_OPS = new Set(["events.wait", "data.wait"]);
const MAX_REPORT_CHARS = 8000;

export const appTabKey = (name: string, instance?: string): string => `${name}\0${instance ?? ""}`;

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

const readApp = (v: unknown): AppInfo | undefined => {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const name = str(o.name);
  if (!name) return undefined;
  return { name, title: str(o.title) ?? name, thread: str(o.thread) };
};

const readApps = (value: Record<string, unknown>): AppInfo[] => (Array.isArray(value.apps) ? value.apps.flatMap((a) => readApp(a) ?? []) : []);

/** A file's address holds the app's file session, which has no place in a message to a Thread. */
const withoutSession = (text: string): string => text.replace(/https?:\/\/[^\s/]+\/a\/[0-9a-f]{32}\//g, "");

/** A message from an app's page. Anything else is ignored. */
export function readAppMessage(data: unknown): { type: "ready" } | { type: "call"; id: number; op: string; args: unknown } | ({ type: "error" } & AppErrorReport) | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const o = data as Record<string, unknown>;
  if (o.shellboy !== true) return undefined;
  if (o.type === "ready") return { type: "ready" };
  if (o.type === "call" && typeof o.id === "number" && typeof o.op === "string") return { type: "call", id: o.id, op: o.op, args: o.args ?? {} };
  if (o.type === "error" && typeof o.message === "string") return { type: "error", kind: str(o.kind)?.slice(0, 40) ?? "script", message: withoutSession(o.message).slice(0, 2000), where: str(o.where) === undefined ? undefined : withoutSession(o.where as string).slice(0, 400) };
  return undefined;
}

export function errorReportText(app: Pick<OpenApp, "name" | "title">, errors: readonly AppErrorReport[]): string {
  const lines = errors.map((e) => `- ${e.kind}: ${e.message}${e.where ? ` (${e.where})` : ""}`);
  const text = `The app ${app.title} (artifact ${app.name}) reported errors. Please look into them:\n${lines.join("\n")}`;
  return text.length > MAX_REPORT_CHARS ? text.slice(0, MAX_REPORT_CHARS) : text;
}

type CataloguePage = { apps: AppInfo[]; next: string | undefined; reservation: RetainedReservation; unpin?: () => void };

export class AppsModel {
  readonly list: Signal<AppListState> = signal({ loading: false, loaded: false, thread: undefined, apps: [], next: undefined, loadingMore: false, error: undefined });
  readonly tabs: Signal<readonly OpenApp[]> = signal([]);
  readonly instances: Signal<Readonly<Record<string, readonly string[]>>> = signal({});
  readonly openError: Signal<{ name: string; message: string } | undefined> = signal(undefined);
  /** One bounded page of folders, owned by the new-app panel and cancelled when it closes. */
  readonly folders = signal<{ names: string[]; loading: boolean; truncated?: boolean; error?: string }>({ names: [], loading: false });
  private folderCancel = new Cancel();
  private folderGeneration = 0;
  async loadFolders(): Promise<void> {
    this.leaveFolders();
    const generation = ++this.folderGeneration;
    const cancel = this.folderCancel = new Cancel();
    this.folders.value = { names: [], loading: true };
    const out = await this.ops.threadCwds({ limit: 200 }, { cancel });
    if (generation !== this.folderGeneration) return;
    this.folders.value = out.ok ? { names: out.value.items, loading: false, truncated: out.value.next_cursor !== undefined } : { names: [], loading: false, error: out.error.message };
  }
  leaveFolders(): void { this.folderGeneration++; this.folderCancel.cancel(); }
  private opening = new Set<string>();
  /** Cancels an app's outstanding calls when its tab closes or reloads. */
  private calls = new Map<string, { cancel: Cancel; count: number }>();

  private readonly pages = new Map<string, Map<string | undefined, CataloguePage>>();
  private scope: string | undefined;
  private readGeneration = 0;
  private listCancel = new Cancel();
  constructor(private readonly ops: Operations, private readonly budget = new RetainedBudget()) {}

  leaveCatalogue(): void {
    if (this.scope === undefined) return;
    this.readGeneration++;
    this.listCancel.cancel();
    const pages = this.pages.get(this.scope);
    this.scope = undefined;
    this.list.value = { loading: false, loaded: false, thread: undefined, apps: [], next: undefined, loadingMore: false, error: undefined };
    for (const page of pages?.values() ?? []) {
      const unpin = page.unpin;
      page.unpin = undefined;
      unpin?.();
    }
  }

  clearCatalogue(): void {
    this.leaveCatalogue();
    for (const pages of this.pages.values()) for (const page of pages.values()) page.reservation.release();
    this.pages.clear();
  }

  ensure(thread: string | undefined): void {
    if (this.scope === thread) return;
    this.leaveCatalogue();
    if (thread === undefined) return;
    this.scope = thread;
    const first = this.pages.get(thread)?.get(undefined);
    if (first) this.publishCatalogue(thread);
    else void this.refresh(thread);
  }

  private publishCatalogue(thread: string): void {
    const pages = this.pages.get(thread);
    const seen = new Set<string>();
    const apps: AppInfo[] = [];
    let next: string | undefined;
    const cursors = new Set<string | undefined>();
    while (!cursors.has(next)) {
      cursors.add(next);
      const page = pages?.get(next);
      if (!page) break;
      page.reservation.touch();
      page.unpin ??= page.reservation.pin();
      for (const app of page.apps) if (!seen.has(app.name)) { seen.add(app.name); apps.push(app); }
      next = page.next;
      if (next === undefined) break;
    }
    this.list.value = { loading: false, loaded: true, thread, apps, next, loadingMore: false, error: undefined };
  }

  async refresh(thread: string): Promise<void> {
    if (this.scope !== thread) this.leaveCatalogue();
    this.scope = thread;
    await this.readCatalogue(thread, undefined);
  }

  async more(): Promise<void> {
    const { thread, next, loading, loadingMore } = this.list.peek();
    if (thread === undefined || next === undefined || loading || loadingMore) return;
    if (this.pages.get(thread)?.has(next)) { this.publishCatalogue(thread); return; }
    await this.readCatalogue(thread, next);
  }

  private async readCatalogue(thread: string, cursor: string | undefined): Promise<void> {
    this.listCancel.cancel();
    const cancel = this.listCancel = new Cancel();
    const generation = ++this.readGeneration;
    const previous = this.list.peek();
    this.list.value = previous.thread === thread ? { ...previous, loading: cursor === undefined, loadingMore: cursor !== undefined, error: undefined }
      : { loading: true, loaded: false, thread, apps: [], next: undefined, loadingMore: false, error: undefined };
    const out = await this.ops.appsList(thread, cursor, { cancel });
    if (this.scope !== thread || this.readGeneration !== generation) return;
    const fail = (error: OpError) => { this.list.value = { ...this.list.peek(), loading: false, loadingMore: false, error }; };
    if (!out.ok) { fail(out.error); return; }
    const apps = readApps(out.value), next = str(out.value.next_cursor);
    const existing = this.pages.get(thread);
    if (next !== undefined && (next === cursor || (cursor !== undefined && existing?.has(next)))) {
      fail({ kind: "owner", code: "invalid_cursor", message: "Apps continuation did not advance" });
      return;
    }
    const bytes = 96 + retainedStringBytes(thread) + retainedStringBytes(cursor ?? "") + retainedStringBytes(next ?? "")
      + apps.reduce((n, app) => n + 96 + retainedStringBytes(app.name) + retainedStringBytes(app.title) + retainedStringBytes(app.thread ?? ""), 0);
    const pages = cursor === undefined ? new Map<string | undefined, CataloguePage>() : existing ?? new Map();
    const reservation = this.budget.reserve(bytes, () => {
      pages.delete(cursor);
      if (pages.size === 0 && this.pages.get(thread) === pages) this.pages.delete(thread);
    });
    if (!reservation) {
      fail({ kind: "owner", code: "retained_budget", message: "Retained data budget is full" });
      return;
    }
    batch(() => {
      pages.set(cursor, { apps, next, reservation, unpin: reservation.pin() });
      if (cursor === undefined) for (const page of existing?.values() ?? []) page.reservation.release();
      this.pages.set(thread, pages);
      this.publishCatalogue(thread);
    });
  }

  async loadInstances(name: string): Promise<void> {
    const out = await this.ops.appsInstances(name);
    if (out.ok && Array.isArray(out.value.items)) {
      this.instances.value = { ...this.instances.peek(), [name]: out.value.items.filter((x): x is string => typeof x === "string" && validAppInstance(x)).slice(0, 128) };
    }
  }

  async createInstance(name: string, instance: string): Promise<boolean> {
    if (!validAppInstance(instance)) return false;
    const out = await this.ops.appsCreateInstance(name, instance);
    if (!out.ok) { this.openError.value = { name, message: out.error.message }; return false; }
    await this.loadInstances(name);
    return true;
  }

  /** Opening what's already open only shows it: its page isn't reloaded. */
  async open(name: string, instance?: string): Promise<void> {
    if (instance !== undefined && !validAppInstance(instance)) return;
    const key = appTabKey(name, instance);
    if (this.tabs.peek().some((t) => t.name === name && t.instance === instance) || this.opening.has(key)) return;
    this.opening.add(key);
    try {
      if (instance !== undefined && !(await this.createInstance(name, instance))) return;
      const made = await this.mint(name);
      if (made) {
        if (instance !== undefined) made.instance = instance;
        this.tabs.value = [...this.tabs.peek(), made];
        this.openError.value = undefined;
      }
    } finally {
      this.opening.delete(key);
    }
  }

  /** A fresh ticket, for when the session ended. */
  async reload(name: string, instance?: string): Promise<void> {
    const key = appTabKey(name, instance);
    if (this.opening.has(key) || !this.tabs.peek().some((tab) => tab.name === name && tab.instance === instance)) return;
    this.opening.add(key);
    try {
      this.cancelCalls(key);
      const made = await this.mint(name);
      if (made && this.tabs.peek().some((tab) => tab.name === name && tab.instance === instance)) {
        if (instance !== undefined) made.instance = instance;
        this.tabs.value = this.tabs.peek().map((t) => (t.name === name && t.instance === instance ? made : t));
        this.openError.value = undefined;
      }
    } finally {
      this.opening.delete(key);
    }
  }

  private async mint(name: string): Promise<OpenApp | undefined> {
    const out = await this.ops.appsOpen(name);
    if (!out.ok) {
      this.openError.value = { name, message: out.error.message };
      return undefined;
    }
    const url = str(out.value.url);
    if (!url) {
      this.openError.value = { name, message: "the gateway gave no address" };
      return undefined;
    }
    const thread = str(out.value.thread);
    const made: OpenApp = { name, title: str(out.value.title) ?? name, url, thread, threadTitle: undefined, threadState: thread ? "ok" : "unbound", errors: [], send: { kind: "idle" } };
    if (thread) {
      const got = await this.ops.threadGet(thread);
      if (got.ok) {
        made.threadTitle = got.value.title;
        if (got.value.archived_at) made.threadState = "archived";
      } else if (got.error.kind === "owner") made.threadState = "missing";
    }
    return made;
  }

  /**
   * One API call from an app's page. The caller matched the message to this tab by its frame, so the page
   * can't speak for another app. The reply is the gateway's `{ok, result}` or `{ok, error}`.
   */
  async call(name: string, op: string, args: unknown, instance?: string): Promise<{ ok: boolean; result?: unknown; error?: unknown }> {
    const key = appTabKey(name, instance);
    let state = this.calls.get(key);
    if (!state) {
      state = { cancel: new Cancel(), count: 0 };
      this.calls.set(key, state);
    }
    if (state.count >= MAX_APP_CALLS) return { ok: false, error: { code: "busy", message: "Too many calls are waiting" } };
    state.count++;
    const out = await this.ops.appsCall(name, op, args, { cancel: state.cancel, waits: WAITING_OPS.has(op) }, instance);
    state.count--;
    if (out.ok) return out.value as { ok: boolean };
    return { ok: false, error: { code: out.error.kind === "owner" ? out.error.code : out.error.kind, message: out.error.message } };
  }

  private cancelCalls(name: string): void {
    this.calls.get(name)?.cancel.cancel();
    this.calls.delete(name);
  }

  close(name: string, instance?: string): void {
    this.cancelCalls(appTabKey(name, instance));
    this.tabs.value = this.tabs.peek().filter((t) => t.name !== name || t.instance !== instance);
  }

  private patch(name: string, change: (t: OpenApp) => OpenApp, instance?: string): void {
    this.tabs.value = this.tabs.peek().map((t) => (t.name === name && t.instance === instance ? change(t) : t));
  }

  report(name: string, error: AppErrorReport, instance?: string): void {
    this.patch(name, (t) => ({ ...t, errors: [...t.errors, error].slice(-MAX_APP_ERRORS), send: { kind: "idle" } }), instance);
  }

  dismissErrors(name: string, instance?: string): void {
    this.patch(name, (t) => ({ ...t, errors: [], send: { kind: "idle" } }), instance);
  }

  /** On a person's press, so it's recorded as from them. */
  async sendErrors(name: string, instance?: string): Promise<void> {
    const tab = this.tabs.peek().find((t) => t.name === name && t.instance === instance);
    if (!tab?.thread || tab.errors.length === 0) return;
    this.patch(name, (t) => ({ ...t, send: { kind: "sending" } }), instance);
    const out = await this.ops.messageSend({ thread_id: tab.thread, text: errorReportText(tab, tab.errors) });
    this.patch(name, (t) => ({ ...t, ...(out.ok ? { errors: [], send: { kind: "sent" } as const } : { send: { kind: "failed", message: out.error.message } as const }) }), instance);
  }
}
