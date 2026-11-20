import { useEffect, useRef, useState } from "preact/hooks";
import { type AppModel, type Route } from "../../../ui-core/src";
import { Button } from "../system/components";
import type { ThreadSummary } from "../../../data/src";

type Target = { id: string; archived: boolean; route: Route; owner: AppModel["data"]["owner"]["value"] };
type ActionState = "idle" | "running" | "done" | "failed";

/** One row-qualified archive action shared by sidebar and the Threads list. */
export function ThreadQuickAction({ model, row, surface }: { model: AppModel; row: ThreadSummary; surface: "sidebar" | "list" }) {
  const targetRef = useRef<Target>();
  const tokenRef = useRef<object>();
  const [state, setState] = useState<ActionState>("idle");
  const route = model.route.value;
  const owner = model.data.owner.value;
  const target = targetRef.current;
  const current = target?.id === row.thread_id && target.route === route && target.owner === owner && tokenRef.current === undefined;

  useEffect(() => {
    targetRef.current = { id: row.thread_id, archived: row.archived_at !== undefined, route, owner };
    tokenRef.current = undefined;
    setState("idle");
    return () => { tokenRef.current = undefined; };
  }, [row.thread_id, row.archived_at, route, owner]);

  const run = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = targetRef.current;
    if (!target || tokenRef.current !== undefined || target.route !== model.route.peek() || target.owner !== model.data.owner.peek()) return;
    const token = {};
    tokenRef.current = token;
    setState("running");
    try {
      const out = target.archived ? await model.ops.threadUnarchive([target.id], { descendants: false }) : await model.ops.threadArchive([target.id], { descendants: false });
      if (tokenRef.current !== token || model.route.peek() !== target.route || model.data.owner.peek() !== target.owner) return;
      if (!out.ok) { setState("failed"); return; }
      const refreshed = await model.ops.threadGet(target.id);
      if (tokenRef.current !== token || model.route.peek() !== target.route || model.data.owner.peek() !== target.owner) return;
      if (!refreshed.ok || refreshed.value.thread_id !== target.id || (refreshed.value.archived_at !== undefined) === target.archived) { setState("failed"); return; }
      setState("done");
    } finally {
      if (tokenRef.current === token) tokenRef.current = undefined;
    }
  };

  const disabled = state !== "idle" || !current;
  return <Button data-thread-quick-action={row.thread_id} data-thread-quick-surface={surface} data-quick-action-state={state} disabled={disabled} aria-busy={state === "running"} onClick={run}>{row.archived_at !== undefined ? model.t.value("org.unarchive") : model.t.value("action.archive")}</Button>;
}
