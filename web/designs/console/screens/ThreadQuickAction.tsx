import { useEffect, useState } from "preact/hooks";
import { type AppModel, type Route } from "../../../ui-core/src";
import { Button, Notice } from "../system/components";
import type { ThreadSummary } from "../../../data/src";

type Target = { id: string; archived: boolean; route: Route; owner: AppModel["data"]["owner"]["value"] };
type ActionState = { kind: "idle" | "running" | "done"; error?: string };

// One owner-scoped admission map makes the singleton action shared by every row surface.
const admissions = new WeakMap<object, Map<string, object>>();
function admit(owner: object, id: string): object | undefined {
  let owned = admissions.get(owner);
  if (!owned) { owned = new Map(); admissions.set(owner, owned); }
  if (owned.has(id)) return undefined;
  const token = {};
  owned.set(id, token);
  return token;
}
function release(owner: object, id: string, token: object): void {
  const owned = admissions.get(owner);
  if (owned?.get(id) === token) owned.delete(id);
}

/** One row-qualified archive action shared by sidebar and the Threads list. */
export function ThreadQuickAction({ model, row, surface }: { model: AppModel; row: ThreadSummary; surface: "sidebar" | "list" }) {
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const target: Target = { id: row.thread_id, archived: row.archived_at !== undefined, route: model.route.value, owner: model.data.owner.value };
  const liveRow = () => [...model.data.threadList.peek().items, ...model.org.shown()].find((item) => item.thread_id === target.id);
  const current = () => {
    const live = liveRow();
    return model.route.peek() === target.route && model.route.peek().view === target.route.view && model.data.owner.peek() === target.owner && live !== undefined && (live.archived_at !== undefined) === target.archived;
  };

  useEffect(() => { setState({ kind: "idle" }); }, [row.thread_id, row.archived_at, target.route, target.owner]);

  const run = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!current()) return;
    const token = admit(target.owner as object, target.id);
    if (!token) return;
    setState({ kind: "running" });
    try {
      const out = target.archived ? await model.ops.threadUnarchive([target.id], { descendants: false }) : await model.ops.threadArchive([target.id], { descendants: false });
      if (!current()) return;
      if (!out.ok) { setState({ kind: "idle", error: out.error.message }); return; }
      const refreshed = await model.ops.threadGet(target.id);
      if (!current()) return;
      if (!refreshed.ok || refreshed.value.thread_id !== target.id || (refreshed.value.archived_at !== undefined) === target.archived) { setState({ kind: "idle", error: model.t.value("thread.quickReadbackFailed") }); return; }
      await model.data.refreshThreadList();
      await model.org.read();
      if (!current()) return;
      setState({ kind: "done" });
    } finally {
      release(target.owner as object, target.id, token);
    }
  };

  const disabled = state.kind === "running" || !current();
  return <span data-thread-quick-action={row.thread_id} data-thread-quick-surface={surface} data-quick-action-state={state.kind}>
    <Button disabled={disabled} aria-busy={state.kind === "running"} onClick={run}>{row.archived_at !== undefined ? model.t.value("org.unarchive") : model.t.value("action.archive")}</Button>
    {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
  </span>;
}
