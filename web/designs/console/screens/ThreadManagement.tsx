import { useEffect, useRef, useState } from "preact/hooks";
import { formatRoute, threadModelChanges, type AppModel, type Route, type ThreadModelDraft } from "../../../ui-core/src";
import { Button, Field, Notice, Section } from "../system/components";
import type { ThreadDetails } from "../../../data/src";

type OwnerIdentity = AppModel["data"]["owner"]["value"];
type Visit = object;
type DetailState = { id: string; route: Route; owner: OwnerIdentity; visit: Visit; loading: boolean; value?: ThreadDetails; error?: string };
type ActionState = { id: string; route: Route; owner: OwnerIdentity; visit: Visit; kind: "idle" | "running" } | { id: string; route: Route; owner: OwnerIdentity; visit: Visit; kind: "done"; archived: boolean; count: number; already: number; notFound: number } | { id: string; route: Route; owner: OwnerIdentity; visit: Visit; kind: "failed"; message: string };
type SettingsState = { id: string; route: Route; owner: OwnerIdentity; visit: Visit; model: string; effort: string; initialEffort: string; saving: boolean; saved: boolean; error?: string };
type DeletePreviewFacts = { threadCount?: number; descendantCount?: number; survivingDescendantCount?: number; liveRunCount?: number; stoppingRunCount?: number };
type DeleteState = { id: string; route: Route; owner: OwnerIdentity; visit: Visit; kind: "previewing" | "confirm" | "deleting" | "failed" | "done"; marker?: { thread_count: number; ids_hash: string }; facts?: DeletePreviewFacts; message?: string };
type ObservationState = { id: string; route: Route; owner: OwnerIdentity; visit: Visit; detailToken?: object; kind: "loading" | "ready" | "unavailable"; runId?: string; turnId?: string; runState?: string; turnState?: string; recoveryReason?: string; error?: string };
type RunActionState = { id: string; route: Route; owner: OwnerIdentity; visit: Visit; detailToken: object; kind: "running" | "refused" | "accepted" | "unknown"; action?: "retry" | "stop"; message?: string; reason?: string; ownerError?: string; operationId?: string };

/** One-thread management entry; route reads and mutations are independent of bulk selection. */
export function ThreadManagement({ model }: { model: AppModel }) {
  const t = model.t.value;
  const route = model.route.value;
  const id = route.view === "thread-management" ? route.threadId : undefined;
  const owner = model.data.owner.value;
  const visitRef = useRef<Visit>();
  const detailIdentityRef = useRef<{ id: string; runId: string; turnId: string; visit: Visit; token: object }>();
  const [detailState, setDetailState] = useState<DetailState>();
  const [actionState, setActionState] = useState<ActionState>();
  const [settingsState, setSettingsState] = useState<SettingsState>();
  const [deleteState, setDeleteState] = useState<DeleteState>();
  const [observationState, setObservationState] = useState<ObservationState>();
  const [runActionState, setRunActionState] = useState<RunActionState>();
  const ownerInstanceId = owner.state === "connected" ? owner.info.instance_id : undefined;
  const unresolvedKey = `${ownerInstanceId ?? "unknown"}:${id ?? ""}:retry`;
  const unresolvedStopKey = `${ownerInstanceId ?? "unknown"}:${id ?? ""}:stop`;
  const durableUnresolvedRetry = id ? model.managementUnconfirmedRetry.value.get(unresolvedKey)?.action === "retry" ? model.managementUnconfirmedRetry.value.get(unresolvedKey) : undefined : undefined;
  const durableUnresolvedStop = id && model.managementUnconfirmedRetry.value.get(unresolvedStopKey)?.action === "stop" ? model.managementUnconfirmedRetry.value.get(unresolvedStopKey) : undefined;
  const unresolvedStop = durableUnresolvedStop !== undefined;
  const retryReservation = id ? model.managementRetryReservations.value.get(unresolvedKey) : undefined;
  const unresolvedRetry = durableUnresolvedRetry !== undefined && route.view === "thread-management";
  const deleteProofRef = useRef<{ id: string; visit: Visit; marker: { thread_count: number; ids_hash: string }; used: boolean }>();
  const mutationRef = useRef<object>();
  const [busyVersion, setBusyVersion] = useState(0);
  const currentDetail = detailState && detailState.id === id && detailState.route === route && detailState.owner === owner && detailState.visit === visitRef.current ? detailState : undefined;
  const currentAction = actionState && actionState.id === id && actionState.route === route && actionState.owner === owner && actionState.visit === visitRef.current ? actionState : undefined;
  const currentSettings = settingsState && settingsState.id === id && settingsState.route === route && settingsState.owner === owner && settingsState.visit === visitRef.current ? settingsState : undefined;
  const currentObservation = observationState && observationState.id === id && observationState.route === route && observationState.owner === owner && observationState.visit === visitRef.current && observationState.detailToken === detailIdentityRef.current?.token ? observationState : undefined;
  const currentRunAction = unresolvedRetry ? { id, route, owner, visit: visitRef.current!, detailToken: detailIdentityRef.current?.token ?? {}, kind: "unknown" as const, message: t("action.retryUnknown", { id: durableUnresolvedRetry?.operationId ?? "" }), reason: durableUnresolvedRetry?.recoveryReason, operationId: durableUnresolvedRetry?.operationId } : runActionState && ((runActionState.kind === "unknown" && unresolvedRetry) || (runActionState.id === id && runActionState.route === route && runActionState.owner === owner && runActionState.visit === visitRef.current && runActionState.detailToken === detailIdentityRef.current?.token)) ? runActionState : undefined;
  const surfaceBusy = busyVersion >= 0 && mutationRef.current !== undefined;
  const admit = (visit: Visit): object | undefined => {
    if (mutationRef.current !== undefined || visitRef.current !== visit) return undefined;
    const token = {};
    mutationRef.current = token;
    setBusyVersion((n) => n + 1);
    return token;
  };
  const release = (token: object) => {
    if (mutationRef.current !== token) return;
    mutationRef.current = undefined;
    setBusyVersion((n) => n + 1);
  };

  const publishDetail = (next: DetailState): object => {
    const token = {};
    const value = next.value;
    if (value && typeof value.run_id === "string" && value.run_id !== "" && typeof value.turn_id === "string" && value.turn_id !== "") {
      detailIdentityRef.current = { id: next.id, runId: value.run_id, turnId: value.turn_id, visit: next.visit, token };
    } else detailIdentityRef.current = undefined;
    setObservationState({ id: next.id, route: next.route, owner: next.owner, visit: next.visit, detailToken: token, kind: "unavailable", error: "Thread detail changed; observation requires a fresh exact read" });
    setDetailState(next);
    return token;
  };

  useEffect(() => {
    let active = true;
    if (!id) return () => { active = false; };
    const readOwner = owner;
    const readRoute = route;
    const readVisit: Visit = {};
    visitRef.current = readVisit;
    detailIdentityRef.current = undefined;
    const currentTargetWithoutDetail = () => active && visitRef.current === readVisit && model.route.peek() === readRoute && model.route.peek().view === "thread-management" && model.data.owner.peek() === readOwner;
    const currentTarget = (detailToken: object) => currentTargetWithoutDetail() && detailIdentityRef.current?.visit === readVisit && detailIdentityRef.current?.token === detailToken;
    const read = (next: DetailState) => { if (currentTargetWithoutDetail()) setDetailState(next); };
    read({ id, route: readRoute, owner: readOwner, visit: readVisit, loading: true });
    setActionState({ id, route: readRoute, owner: readOwner, visit: readVisit, kind: "idle" });
    void (async () => {
      const out = await model.ops.threadGet(id);
      if (!currentTargetWithoutDetail()) return;
      if (out.ok && out.value.thread_id === id) {
        const detailToken = publishDetail({ id, route: readRoute, owner: readOwner, visit: readVisit, loading: false, value: out.value });
        setSettingsState({ id, route: readRoute, owner: readOwner, visit: readVisit, model: out.value.model, effort: out.value.effort ?? "", initialEffort: out.value.effort ?? "", saving: false, saved: false });
        const projectedStatus = model.rowById.value.get(id)?.status;
        setObservationState({ id, route: readRoute, owner: readOwner, visit: readVisit, detailToken, kind: projectedStatus ? "ready" : "unavailable", runId: out.value.run_id, turnId: out.value.turn_id, runState: projectedStatus === "running" || projectedStatus === "recovery" ? "live" : undefined, turnState: projectedStatus === "running" ? "running" : projectedStatus === "recovery" ? "recovery_wait" : undefined });
      } else read({ id, route: readRoute, owner: readOwner, visit: readVisit, loading: false, error: out.ok ? t("thread.detailMismatch") : out.error.message });
    })();
    return () => {
      active = false;
      if (deleteProofRef.current?.visit === readVisit) deleteProofRef.current = undefined;
      if (visitRef.current === readVisit) { detailIdentityRef.current = undefined; visitRef.current = undefined; }
    };
  }, [id, model.ops, owner, route]);

  if (!id) return <Section title={t("view.threads")}><Notice tone="wait">{t("threads.empty")}</Notice></Section>;
  if (!currentDetail || currentDetail.loading) return <Section title={t("view.threads")}><Notice tone="wait">{t("common.loading")}</Notice></Section>;
  if (!currentDetail.value) return <Section title={t("view.threads")}><Notice tone="bad">{currentDetail.error ?? t("threads.empty")}</Notice></Section>;

  const detail = currentDetail.value;
  const rowStatus = model.rowById.value.get(id)?.status;
  const archived = detail.archived_at !== undefined;
  const actionable = !currentAction || currentAction.kind === "idle" || currentAction.kind === "done";
  const mutate = async () => {
    const mutationId = id;
    const mutationRoute = route;
    const mutationOwner = owner;
    const mutationVisit = currentDetail.visit;
    const currentMutation = () => visitRef.current === mutationVisit && model.route.peek() === mutationRoute && model.route.peek().view === "thread-management" && model.data.owner.peek() === mutationOwner;
    if (!currentMutation() || currentAction?.kind === "running" || currentSettings?.saving) return;
    const token = admit(mutationVisit);
    if (!token) return;
    try {
      setActionState({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, kind: "running" });
    const out = archived
      ? await model.ops.threadUnarchive([mutationId], { descendants: false })
      : await model.ops.threadArchive([mutationId], { descendants: false });
    if (!currentMutation()) { return; }
    if (!out.ok) {
      setActionState({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, kind: "failed", message: out.error.message });
      return;
    }
    const refreshed = await model.ops.threadGet(mutationId);
    if (!currentMutation()) { return; }
    if (!refreshed.ok) {
      publishDetail({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, loading: false, error: refreshed.error.message });
      setActionState({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, kind: "failed", message: refreshed.error.message });
      return;
    }
    if (refreshed.value.thread_id !== mutationId) {
      const message = t("thread.detailMismatch");
      publishDetail({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, loading: false, error: message });
      setActionState({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, kind: "failed", message });
      return;
    }
    publishDetail({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, loading: false, value: refreshed.value });
    const result = archived ? out.value.unarchived : out.value.archived;
    setActionState({ id: mutationId, route: mutationRoute, owner: mutationOwner, visit: mutationVisit, kind: "done", archived: !archived, count: result?.length ?? 0, already: out.value.already?.length ?? 0, notFound: out.value.not_found?.length ?? 0 });
    } finally { release(token); }
  };

  const settings = currentSettings;
  const retry = async () => {
    if (rowStatus !== "recovery" || surfaceBusy || currentRunAction?.kind === "running") return;
    const token = admit(visitRef.current!);
    if (!token) return;
    setRunActionState({ id, route, owner, visit: visitRef.current!, detailToken: detailIdentityRef.current?.token ?? {}, kind: "running", action: "retry" });
    try { await model.retry(id); }
    finally { release(token); if (visitRef.current === token) setRunActionState(undefined); }
  };
  const stop = async () => {
    if (rowStatus !== "running" || surfaceBusy || currentRunAction?.kind === "running" || !detail.run_id) return;
    const token = admit(visitRef.current!);
    if (!token) return;
    setRunActionState({ id, route, owner, visit: visitRef.current!, detailToken: detailIdentityRef.current?.token ?? {}, kind: "running", action: "stop" });
    try {
      const out = await model.ops.runStop(detail.run_id);
      if (out.ok && visitRef.current === visitRef.current) setRunActionState({ id, route, owner, visit: visitRef.current!, detailToken: detailIdentityRef.current?.token ?? {}, kind: "accepted", action: "stop" });
      else if (!out.ok) setRunActionState({ id, route, owner, visit: visitRef.current!, detailToken: detailIdentityRef.current?.token ?? {}, kind: "refused", message: out.error.message });
    } finally { release(token); }
  };

  const saveSettings = async () => {
    if (!settings || settings.saving || currentAction?.kind === "running" || surfaceBusy || !model.data.capabilities.peek().includes("thread.settings") || !settings.model.trim()) return;
    const target = { id, route, owner, visit: settings.visit };
    const currentTarget = () => visitRef.current === target.visit && model.route.peek() === target.route && model.route.peek().view === "thread-management" && model.data.owner.peek() === target.owner;
    if (!currentTarget()) return;
    const token = admit(target.visit);
    if (!token) return;
    try {
      setSettingsState({ ...settings, saving: true, saved: false, error: undefined });
    const draft: ThreadModelDraft = { model: settings.model, connection: detail.connection, effort: settings.effort, agents: "", autoCompactAt: "", maxTokens: "", clearMaxTokens: false };
    const initial: ThreadModelDraft = { model: detail.model, connection: detail.connection, effort: settings.initialEffort, agents: "", autoCompactAt: "", maxTokens: "", clearMaxTokens: false };
    const changes = threadModelChanges(draft, initial);
    const out = await model.ops.setThreadModel(target.id, changes);
    if (!currentTarget()) { return; }
    if (!out.ok) {
      setSettingsState({ ...settings, saving: false, saved: false, error: out.error.message });
      return;
    }
    if (out.value.thread_id !== target.id) {
      publishDetail({ id: target.id, route: target.route, owner: target.owner, visit: target.visit, loading: false, error: t("thread.detailMismatch") });
      setSettingsState({ ...settings, saving: false, saved: false, error: t("thread.settingsMismatch") });
      return;
    }
    const refreshed = await model.ops.threadGet(target.id);
    if (!currentTarget()) { return; }
    if (!refreshed.ok) {
      publishDetail({ id: target.id, route: target.route, owner: target.owner, visit: target.visit, loading: false, error: refreshed.error.message });
      setSettingsState({ ...settings, saving: false, saved: false, error: refreshed.error.message });
      return;
    }
    if (refreshed.value.thread_id !== target.id) {
      const message = t("thread.detailMismatch");
      publishDetail({ id: target.id, route: target.route, owner: target.owner, visit: target.visit, loading: false, error: message });
      setSettingsState({ ...settings, saving: false, saved: false, error: message });
      return;
    }
    const expectedEffort = changes.effort === undefined ? (detail.effort ?? "") : changes.effort;
    const readbackMismatch = refreshed.value.model !== changes.model || refreshed.value.connection !== changes.connection || (refreshed.value.effort ?? "") !== expectedEffort;
    publishDetail({ id: target.id, route: target.route, owner: target.owner, visit: target.visit, loading: false, value: refreshed.value });
    if (readbackMismatch) {
      setSettingsState({ ...settings, model: refreshed.value.model, effort: refreshed.value.effort ?? "", initialEffort: refreshed.value.effort ?? "", saving: false, saved: false, error: t("thread.settingsMismatch") });
      return;
    }
    setSettingsState({ ...settings, model: refreshed.value.model, effort: refreshed.value.effort ?? "", initialEffort: refreshed.value.effort ?? "", saving: false, saved: true, error: undefined });
    } finally { release(token); }
  };

  const deletion = deleteState && deleteState.id === id && deleteState.route === route && deleteState.owner === owner && deleteState.visit === visitRef.current ? deleteState : undefined;
  const deleteTargetCurrent = (target: DeleteState) => visitRef.current === target.visit && model.route.peek() === target.route && model.route.peek().view === "thread-management" && model.data.owner.peek() === target.owner;
  const previewDelete = async () => {
    if (!id || surfaceBusy || !currentDetail?.value || !visitRef.current || !model.data.capabilities.peek()) return;
    const target: DeleteState = { id, route, owner, visit: visitRef.current, kind: "previewing" };
    const token = admit(target.visit);
    if (!token) return;
    setDeleteState(target);
    try {
      const out = await model.ops.threadDeletePreview(id);
      if (!deleteTargetCurrent(target)) return;
      if (!out.ok || out.value.thread_id !== id || out.value.descendants !== false) {
        setDeleteState({ ...target, kind: "failed", message: out.ok ? t("thread.deleteBlocked") : out.error.message });
        return;
      }
      const selection = out.value.selection && typeof out.value.selection === "object" ? out.value.selection as Record<string, unknown> : undefined;
      const blockers = out.value.blockers && typeof out.value.blockers === "object" ? out.value.blockers as Record<string, unknown> : undefined;
      const facts: DeletePreviewFacts = {
        threadCount: typeof selection?.thread_count === "number" ? selection.thread_count : undefined,
        descendantCount: typeof selection?.descendant_thread_count === "number" ? selection.descendant_thread_count : undefined,
        survivingDescendantCount: typeof selection?.surviving_descendant_thread_count === "number" ? selection.surviving_descendant_thread_count : undefined,
        liveRunCount: typeof blockers?.live_run_count === "number" ? blockers.live_run_count : undefined,
        stoppingRunCount: typeof blockers?.stopping_run_count === "number" ? blockers.stopping_run_count : undefined,
      };
      const marker = out.value.preview_marker;
      const markerValue = marker && typeof marker === "object" ? marker as Record<string, unknown> : undefined;
      if (!markerValue || typeof markerValue.thread_count !== "number" || markerValue.thread_count !== 1 || typeof markerValue.ids_hash !== "string" || !/^[0-9a-f]{64}$/.test(markerValue.ids_hash)) {
        setDeleteState({ ...target, kind: "failed", facts, message: t("thread.deleteBlocked") });
        return;
      }
      const proof = { thread_count: markerValue.thread_count as number, ids_hash: markerValue.ids_hash as string };
      if (out.value.deletable_now !== true) {
        setDeleteState({ ...target, kind: "failed", facts, message: t("thread.deleteBlocked") });
        return;
      }
      deleteProofRef.current = { id, visit: target.visit, marker: proof, used: false };
      setDeleteState({ ...target, kind: "confirm", marker: proof, facts });
    } catch (error) { if (deleteTargetCurrent(target)) setDeleteState({ ...target, kind: "failed", message: error instanceof Error ? error.message : t("thread.deleteBlocked") }); }
    finally { release(token); }
  };
  const cancelDelete = () => { if (deletion && deleteProofRef.current?.marker === deletion.marker && deleteTargetCurrent(deletion)) { deleteProofRef.current = undefined; setDeleteState(undefined); } };
  const confirmDelete = async () => {
    const proof = deleteProofRef.current;
    if (!deletion || deletion.kind !== "confirm" || !proof || proof.used || proof.id !== deletion.id || proof.visit !== deletion.visit || proof.marker !== deletion.marker || !deleteTargetCurrent(deletion) || surfaceBusy) return;
    proof.used = true;
    deleteProofRef.current = proof;
    const token = admit(deletion.visit);
    if (!token) return;
    setDeleteState({ ...deletion, kind: "deleting" });
    try {
      const out = await model.ops.threadDelete(deletion.id, proof.marker);
      if (!deleteTargetCurrent(deletion)) return;
      if (!out.ok || out.value.accepted !== true) { setDeleteState({ ...deletion, kind: "failed", message: out.ok ? t("thread.deleteBlocked") : out.error.message }); return; }
      setDeleteState({ ...deletion, kind: "done" });
      try {
        await model.data.refreshThreadList();
        if (!deleteTargetCurrent(deletion)) return;
        if (model.data.threadList.value.error) throw new Error(model.data.threadList.value.error.message);
      } catch (error) { if (deleteTargetCurrent(deletion)) setDeleteState({ ...deletion, kind: "done", message: error instanceof Error ? error.message : t("thread.deleteRefreshFailed") }); }
    } catch (error) { if (deleteTargetCurrent(deletion)) setDeleteState({ ...deletion, kind: "failed", message: error instanceof Error ? error.message : t("thread.deleteBlocked") }); }
    finally { deleteProofRef.current = undefined; release(token); }
  };

  if (deletion?.kind === "done") return <Section title={detail.title}><Notice>{t("thread.deleteDone")}</Notice>{deletion.message ? <Notice tone="bad">{deletion.message}</Notice> : null}<a class="btn" href={formatRoute({ view: "threads" })}>{t("view.threads")}</a></Section>;

  return <Section title={detail.title} sub={detail.thread_id} actions={<a class="btn" href={formatRoute({ view: "conversation", threadId: id })}>{t("view.conversation")}</a>}>
    <span data-management-observation={currentObservation?.kind ?? "unavailable"} aria-hidden="true" />
    <div class="band" data-thread-management="">
      {actionable ? <Button disabled={surfaceBusy || currentAction?.kind === "running"} onClick={() => void mutate()}>{archived ? t("org.unarchive") : t("action.archive")}</Button> : null}
    </div>
    {(((currentObservation?.kind === "ready" && currentObservation.runState === "live" && ((currentObservation.turnState === "running") || (currentObservation.turnState === "recovery_wait" && currentObservation.recoveryReason)) && detail.run_id && detail.turn_id)) || unresolvedRetry || retryReservation || durableUnresolvedStop) ? <div class="band" data-run-actions="">
      {!unresolvedStop && !unresolvedRetry && !retryReservation && currentObservation?.turnState === "running" ? <Button variant="stop" disabled={surfaceBusy || currentRunAction?.kind === "running"} onClick={() => void stop()}>{t("action.stop")}</Button> : null}
      {!unresolvedRetry && !retryReservation && currentObservation?.turnState === "recovery_wait" && currentObservation.recoveryReason ? <Button variant="primary" disabled={surfaceBusy || currentRunAction?.kind === "running"} onClick={() => void retry()}>{t("action.retry")}</Button> : null}
      {durableUnresolvedStop ? <Notice tone="wait">{t("action.stopUnknown")}<div>{durableUnresolvedStop.operationId}</div></Notice> : null}
      {currentRunAction?.kind === "unknown" ? <Notice tone="wait">{currentRunAction.message}{currentRunAction.operationId ? <div>{currentRunAction.operationId}</div> : null}{currentRunAction.reason ? <div>{currentRunAction.reason}</div> : null}</Notice> : null}
      {currentRunAction?.kind === "refused" ? <>
        <Notice tone="bad">{currentRunAction.message}{currentRunAction.reason ? <div>{currentRunAction.reason}</div> : null}</Notice>
        {currentRunAction.ownerError ? <Notice tone="bad">{currentRunAction.ownerError}</Notice> : null}
      </> : null}
      {currentRunAction?.kind === "accepted" ? <Notice>{currentRunAction.action === "stop" ? t("action.stopAccepted") : t("action.retryAccepted")}</Notice> : null}
    </div> : null}
    {settings ? <div class="band" data-thread-settings="">
      <Field ariaLabel={t("model.change")} value={settings.model} disabled={surfaceBusy || settings.saving} onInput={(e) => setSettingsState((prev) => prev && prev.id === id && prev.route === route && prev.owner === owner && prev.visit === visitRef.current ? { ...prev, model: e.currentTarget.value, saved: false, error: undefined } : prev)} />
      <Field ariaLabel={t("model.effort")} value={settings.effort} disabled={surfaceBusy || settings.saving} onInput={(e) => setSettingsState((prev) => prev && prev.id === id && prev.route === route && prev.owner === owner && prev.visit === visitRef.current ? { ...prev, effort: e.currentTarget.value, saved: false, error: undefined } : prev)} />
      {model.data.capabilities.value.includes("thread.settings") ? <Button variant="primary" disabled={surfaceBusy || settings.saving || !settings.model.trim()} onClick={() => void saveSettings()}>{t("model.save")}</Button> : <Notice tone="wait">{t("thread.readOnly")}</Notice>}
      {settings.error ? <Notice tone="bad">{settings.error}</Notice> : null}
      {settings.saved ? <Notice>{t("thread.settingsSaved")}</Notice> : null}
    </div> : null}
    {!deletion || deletion.kind === "failed" ? <Button data-thread-delete-preview="" variant="warn" disabled={surfaceBusy} onClick={() => void previewDelete()}>{t("thread.deletePreview")}</Button> : null}
    {deletion?.kind === "confirm" ? <Notice actions={<><Button variant="link" onClick={cancelDelete}>{t("thread.deleteCancel")}</Button><Button variant="warn" disabled={surfaceBusy} onClick={() => void confirmDelete()}>{t("thread.deleteConfirm")}</Button></>}>{t("thread.deleteConfirmBody", { n: deletion.marker!.thread_count })}<div>{t("thread.deleteScope", { n: deletion.facts?.survivingDescendantCount ?? "?" })}</div></Notice> : null}
    {deletion?.kind === "previewing" || deletion?.kind === "deleting" ? <Notice tone="wait">{t("common.loading")}</Notice> : null}
    {deletion?.kind === "failed" ? <Notice tone="bad">{deletion.message ?? t("thread.deleteBlocked")}<div>{t("thread.deleteBlockerCounts", { live: deletion.facts?.liveRunCount ?? "?", stopping: deletion.facts?.stoppingRunCount ?? "?" })}</div><div>{t("thread.deleteSurviving", { n: deletion.facts?.survivingDescendantCount ?? "?" })}</div></Notice> : null}
    {currentAction?.kind === "failed" ? <Notice tone="bad">{currentAction.message}</Notice> : null}
    {currentAction?.kind === "done" ? <>
      <Notice>{currentAction.archived ? t("org.archivedResult", { n: currentAction.count, already: currentAction.already }) : t("org.unarchivedResult", { n: currentAction.count, already: currentAction.already })}</Notice>
      {currentAction.notFound > 0 ? <Notice tone="bad">{t("org.notFound", { n: currentAction.notFound })}</Notice> : null}
    </> : null}
  </Section>;
}
