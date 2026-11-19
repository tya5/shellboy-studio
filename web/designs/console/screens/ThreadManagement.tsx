import { useEffect, useRef, useState } from "preact/hooks";
import { formatRoute, type AppModel, type Route } from "../../../ui-core/src";
import { Button, Field, Notice, Section } from "../system/components";
import type { ThreadDetails } from "../../../data/src";

type OwnerIdentity = AppModel["data"]["owner"]["value"];
type Visit = object;
type DetailState = { id: string; route: Route; owner: OwnerIdentity; visit: Visit; loading: boolean; value?: ThreadDetails; error?: string };
type ActionState = { id: string; route: Route; owner: OwnerIdentity; visit: Visit; kind: "idle" | "running" } | { id: string; route: Route; owner: OwnerIdentity; visit: Visit; kind: "done"; archived: boolean; count: number; already: number; notFound: number } | { id: string; route: Route; owner: OwnerIdentity; visit: Visit; kind: "failed"; message: string };
type SettingsState = { id: string; route: Route; owner: OwnerIdentity; visit: Visit; model: string; effort: string; saving: boolean; saved: boolean; error?: string };

/** One-thread management entry; route reads and mutations are independent of bulk selection. */
export function ThreadManagement({ model }: { model: AppModel }) {
  const t = model.t.value;
  const route = model.route.value;
  const id = route.view === "thread-management" ? route.threadId : undefined;
  const owner = model.data.owner.value;
  const visitRef = useRef<Visit>();
  const [detailState, setDetailState] = useState<DetailState>();
  const [actionState, setActionState] = useState<ActionState>();
  const [settingsState, setSettingsState] = useState<SettingsState>();
  const currentDetail = detailState && detailState.id === id && detailState.route === route && detailState.owner === owner && detailState.visit === visitRef.current ? detailState : undefined;
  const currentAction = actionState && actionState.id === id && actionState.route === route && actionState.owner === owner && actionState.visit === visitRef.current ? actionState : undefined;
  const currentSettings = settingsState && settingsState.id === id && settingsState.route === route && settingsState.owner === owner && settingsState.visit === visitRef.current ? settingsState : undefined;

  useEffect(() => {
    let active = true;
    if (!id) return () => { active = false; };
    const readOwner = owner;
    const readRoute = route;
    const readVisit: Visit = {};
    visitRef.current = readVisit;
    const currentTarget = () => active && visitRef.current === readVisit && model.route.peek() === readRoute && model.route.peek().view === "thread-management" && model.data.owner.peek() === readOwner;
    const read = (next: DetailState) => { if (currentTarget()) setDetailState(next); };
    read({ id, route: readRoute, owner: readOwner, visit: readVisit, loading: true });
    setActionState({ id, route: readRoute, owner: readOwner, visit: readVisit, kind: "idle" });
    void model.ops.threadGet(id).then((out) => {
      if (!currentTarget()) return;
      if (out.ok) {
        read({ id, route: readRoute, owner: readOwner, visit: readVisit, loading: false, value: out.value });
        setSettingsState({ id, route: readRoute, owner: readOwner, visit: readVisit, model: out.value.model, effort: out.value.effort ?? "", saving: false, saved: false });
      } else read({ id, route: readRoute, owner: readOwner, visit: readVisit, loading: false, error: out.error.message });
    });
    return () => {
      active = false;
      if (visitRef.current === readVisit) visitRef.current = undefined;
    };
  }, [id, model.ops, owner, route]);

  if (!id) return <Section title={t("view.threads")}><Notice tone="wait">{t("threads.empty")}</Notice></Section>;
  if (!currentDetail || currentDetail.loading) return <Section title={t("view.threads")}><Notice tone="wait">{t("common.loading")}</Notice></Section>;
  if (!currentDetail.value) return <Section title={t("view.threads")}><Notice tone="bad">{currentDetail.error ?? t("threads.empty")}</Notice></Section>;

  const detail = currentDetail.value;
  const archived = detail.archived_at !== undefined;
  const actionable = !currentAction || currentAction.kind === "idle" || currentAction.kind === "done";
  const mutate = async () => {
    const mutationId = id;
    const mutationRoute = route;
    const mutationOwner = owner;
    const mutationVisit = currentDetail.visit;
    const currentMutation = () => visitRef.current === mutationVisit && model.route.peek() === mutationRoute && model.route.peek().view === "thread-management" && model.data.owner.peek() === mutationOwner;
    if (!currentMutation() || currentAction?.kind === "running") return;
    setActionState({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, kind: "running" });
    const out = archived
      ? await model.ops.threadUnarchive([mutationId], { descendants: false })
      : await model.ops.threadArchive([mutationId], { descendants: false });
    if (!currentMutation()) return;
    if (!out.ok) {
      setActionState({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, kind: "failed", message: out.error.message });
      return;
    }
    const refreshed = await model.ops.threadGet(mutationId);
    if (!currentMutation()) return;
    if (!refreshed.ok) {
      setActionState({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, kind: "failed", message: refreshed.error.message });
      return;
    }
    setDetailState({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, loading: false, value: refreshed.value });
    const result = archived ? out.value.unarchived : out.value.archived;
    setActionState({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, kind: "done", archived: !archived, count: result?.length ?? 0, already: out.value.already?.length ?? 0, notFound: out.value.not_found?.length ?? 0 });
  };

  const settings = currentSettings;
  const saveSettings = async () => {
    if (!settings || settings.saving || !model.data.capabilities.peek().includes("thread.settings") || !settings.model.trim()) return;
    const target = { id, route, owner, visit: settings.visit };
    const currentTarget = () => visitRef.current === target.visit && model.route.peek() === target.route && model.route.peek().view === "thread-management" && model.data.owner.peek() === target.owner;
    if (!currentTarget()) return;
    setSettingsState({ ...settings, saving: true, saved: false, error: undefined });
    const out = await model.ops.setThreadModel(target.id, { model: settings.model.trim(), connection: detail.connection, ...(settings.effort.trim() ? { effort: settings.effort.trim() } : {}) });
    if (!currentTarget()) return;
    if (!out.ok) {
      setSettingsState({ ...settings, saving: false, saved: false, error: out.error.message });
      return;
    }
    const refreshed = await model.ops.threadGet(target.id);
    if (!currentTarget()) return;
    if (!refreshed.ok) {
      setSettingsState({ ...settings, saving: false, saved: false, error: refreshed.error.message });
      return;
    }
    setDetailState({ id: target.id, route: target.route, owner: target.owner, visit: target.visit, loading: false, value: refreshed.value });
    setSettingsState({ ...settings, model: refreshed.value.model, effort: refreshed.value.effort ?? "", saving: false, saved: true, error: undefined });
  };

  return <Section title={detail.title} sub={detail.thread_id} actions={<a class="btn" href={formatRoute({ view: "conversation", threadId: id })}>{t("view.conversation")}</a>}>
    <div class="band" data-thread-management="">
      {actionable ? <Button disabled={currentAction?.kind === "running"} onClick={() => void mutate()}>{archived ? t("org.unarchive") : t("action.archive")}</Button> : null}
    </div>
    {settings ? <div class="band" data-thread-settings="">
      <Field ariaLabel={t("model.model")} value={settings.model} disabled={settings.saving} onInput={(e) => setSettingsState({ ...settings, model: e.currentTarget.value, saved: false })} />
      <Field ariaLabel={t("model.effort")} value={settings.effort} disabled={settings.saving} onInput={(e) => setSettingsState({ ...settings, effort: e.currentTarget.value, saved: false })} />
      {model.data.capabilities.value.includes("thread.settings") ? <Button variant="primary" disabled={settings.saving || !settings.model.trim()} onClick={() => void saveSettings()}>{t("model.save")}</Button> : <Notice tone="wait">{t("thread.readOnly")}</Notice>}
      {settings.error ? <Notice tone="bad">{settings.error}</Notice> : null}
      {settings.saved ? <Notice>{t("model.saved")}</Notice> : null}
    </div> : null}
    {currentAction?.kind === "failed" ? <Notice tone="bad">{currentAction.message}</Notice> : null}
    {currentAction?.kind === "done" ? <>
      <Notice>{currentAction.archived ? t("org.archivedResult", { n: currentAction.count, already: currentAction.already }) : t("org.unarchivedResult", { n: currentAction.count, already: currentAction.already })}</Notice>
      {currentAction.notFound > 0 ? <Notice tone="bad">{t("org.notFound", { n: currentAction.notFound })}</Notice> : null}
    </> : null}
  </Section>;
}
