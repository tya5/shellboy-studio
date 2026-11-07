// Apps: the list, the open tabs, and what an app's page reports. Tabs live here, so an app keeps
// running while other views show. Everything an app sends is treated as text from an untrusted page.
import { signal, type Signal } from "@preact/signals-core";
import { Cancel, type Operations, type OpError } from "../../data/src";

export interface AppInfo {
  name: string;
  title: string;
  entry: string;
  thread: string | undefined;
  problem: string | undefined;
}

export interface AppListState {
  loading: boolean;
  loaded: boolean;
  apps: AppInfo[];
  dir: string | undefined;
  guide: string | undefined;
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

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

const readApp = (v: unknown): AppInfo | undefined => {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const name = str(o.name);
  if (!name) return undefined;
  return { name, title: str(o.title) ?? name, entry: str(o.entry) ?? "index.html", thread: str(o.thread), problem: str(o.problem) };
};

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
  const text = `The app ${app.title} (folder apps/${app.name}) reported errors. Please look into them:\n${lines.join("\n")}`;
  return text.length > MAX_REPORT_CHARS ? text.slice(0, MAX_REPORT_CHARS) : text;
}

export class AppsModel {
  readonly list: Signal<AppListState> = signal({ loading: false, loaded: false, apps: [], dir: undefined, guide: undefined, error: undefined });
  readonly tabs: Signal<readonly OpenApp[]> = signal([]);
  readonly openError: Signal<{ name: string; message: string } | undefined> = signal(undefined);
  private opening = new Set<string>();
  /** Cancels an app's outstanding calls when its tab closes or reloads. */
  private calls = new Map<string, { cancel: Cancel; count: number }>();

  constructor(private readonly ops: Operations) {}

  ensure(): void {
    const s = this.list.peek();
    if (!s.loaded && !s.loading && (s.error === undefined || s.error.kind === "not_connected" || s.error.kind === "connection_lost")) void this.refresh();
  }

  /** Reads the folder through the gateway, so a new app shows without a restart. */
  async refresh(): Promise<void> {
    this.list.value = { ...this.list.peek(), loading: true };
    const out = await this.ops.appsList();
    if (!out.ok) {
      this.list.value = { ...this.list.peek(), loading: false, error: out.error };
      return;
    }
    const apps = Array.isArray(out.value.apps) ? out.value.apps.flatMap((a) => readApp(a) ?? []) : [];
    this.list.value = { loading: false, loaded: true, apps, dir: str(out.value.dir), guide: str(out.value.guide), error: undefined };
  }

  /** Opening what's already open only shows it: its page isn't reloaded. */
  async open(name: string): Promise<void> {
    if (this.tabs.peek().some((t) => t.name === name) || this.opening.has(name)) return;
    this.opening.add(name);
    try {
      const made = await this.mint(name);
      if (made) {
        this.tabs.value = [...this.tabs.peek(), made];
        this.openError.value = undefined;
      }
    } finally {
      this.opening.delete(name);
    }
  }

  /** A fresh ticket, for when the session ended. */
  async reload(name: string): Promise<void> {
    this.cancelCalls(name);
    const made = await this.mint(name);
    if (made) this.tabs.value = this.tabs.peek().map((t) => (t.name === name ? made : t));
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
  async call(name: string, op: string, args: unknown): Promise<{ ok: boolean; result?: unknown; error?: unknown }> {
    let state = this.calls.get(name);
    if (!state) {
      state = { cancel: new Cancel(), count: 0 };
      this.calls.set(name, state);
    }
    if (state.count >= MAX_APP_CALLS) return { ok: false, error: { code: "busy", message: "Too many calls are waiting" } };
    state.count++;
    const out = await this.ops.appsCall(name, op, args, { cancel: state.cancel, waits: WAITING_OPS.has(op) });
    state.count--;
    if (out.ok) return out.value as { ok: boolean };
    return { ok: false, error: { code: out.error.kind === "owner" ? out.error.code : out.error.kind, message: out.error.message } };
  }

  private cancelCalls(name: string): void {
    this.calls.get(name)?.cancel.cancel();
    this.calls.delete(name);
  }

  close(name: string): void {
    this.cancelCalls(name);
    this.tabs.value = this.tabs.peek().filter((t) => t.name !== name);
  }

  private patch(name: string, change: (t: OpenApp) => OpenApp): void {
    this.tabs.value = this.tabs.peek().map((t) => (t.name === name ? change(t) : t));
  }

  report(name: string, error: AppErrorReport): void {
    this.patch(name, (t) => ({ ...t, errors: [...t.errors, error].slice(-MAX_APP_ERRORS), send: { kind: "idle" } }));
  }

  dismissErrors(name: string): void {
    this.patch(name, (t) => ({ ...t, errors: [], send: { kind: "idle" } }));
  }

  /** On a person's press, so it's recorded as from them. */
  async sendErrors(name: string): Promise<void> {
    const tab = this.tabs.peek().find((t) => t.name === name);
    if (!tab?.thread || tab.errors.length === 0) return;
    this.patch(name, (t) => ({ ...t, send: { kind: "sending" } }));
    const out = await this.ops.messageSend({ thread_id: tab.thread, text: errorReportText(tab, tab.errors) });
    this.patch(name, (t) => ({ ...t, ...(out.ok ? { errors: [], send: { kind: "sent" } as const } : { send: { kind: "failed", message: out.error.message } as const }) }));
  }
}
