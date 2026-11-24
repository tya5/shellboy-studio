import { useEffect, useRef, useState } from "preact/hooks";
import { Cancel } from "../../../data/src/operations";
import type { StartupStage, WorkItem } from "../../../data/src/protocol";
import { formatRoute, type AppModel } from "../../../ui-core/src";
import { Button, GuideCopy, Icon, KeyValue, Notice, PageHeader, Section, StatusMark, WorkSheet } from "../system/components";

const coreHref = formatRoute({ view: "settings", section: "core" });
const knownStages = new Set<StartupStage>(["database", "database_pragmas", "database_migration", "database_validate", "database_foreign_keys", "database_quick_check"]);

export function coreState(model: AppModel) {
  const t = model.t.value;
  const owner = model.data.owner.value;
  const lifecycle = model.data.launcher.value;
  const stage = model.data.startupStage.value;
  const instance = owner.state === "connected" ? owner.info.instance_id ?? undefined : undefined;
  const managed = !!instance && lifecycle?.phase === "running" && lifecycle.instance_id === instance;
  const phase = lifecycle?.phase === "starting" || lifecycle?.phase === "stopping" ? lifecycle.phase
    : owner.state === "connected" ? "running" : owner.state === "unknown" ? "connecting"
    : lifecycle?.phase === "failed" ? "failed" : stage && !lifecycle ? "starting" : "stopped";
  const label = t(`core.${phase}`);
  const stageLabel = phase === "starting" && stage ? `${t(stage === "database_migration" ? "core.migrating" : knownStages.has(stage) ? "core.checking" : "core.stage")} (${stage})` : undefined;
  return { phase, instance, managed, lifecycle, label, stageLabel };
}

export function CoreStatusLink({ model }: { model: AppModel }) {
  const { label, phase, stageLabel } = coreState(model);
  const t = model.t.value;
  return <a class="nav-link" href={coreHref}><StatusMark feedback status={phase === "running" ? "completed" : phase === "failed" || phase === "stopped" ? "recovery" : "waiting"} label={label} />{stageLabel ? `: ${stageLabel}` : ""}{model.config.pendingRestart.value.length ? ` · ${t("core.pendingShort")}` : ""}</a>;
}

export function CoreBanner({ model }: { model: AppModel }) {
  const { phase, label, stageLabel } = coreState(model);
  if (!model.data.coreManagement.value || phase === "running" || phase === "connecting") return null;
  return <Notice banner tone={phase === "failed" ? "bad" : "wait"} actions={<a class="nav-link" href={coreHref}>{model.t.value("core.open")}</a>}>{label}{stageLabel ? `: ${stageLabel}` : ""}</Notice>;
}

type Snapshot = { instance: string; rows: readonly WorkItem[]; complete: boolean; error?: string };
const workKey = (row: WorkItem) => `${row.kind}:${row.id}`;
function sameWork(confirmed: Snapshot, current: Snapshot | undefined): boolean {
  if (!current || current.instance !== confirmed.instance || current.error || current.complete !== confirmed.complete || current.rows.length !== confirmed.rows.length) return false;
  const keys = new Set(current.rows.map(workKey));
  return confirmed.rows.every(row => keys.has(workKey(row)));
}

type Manual = "restart" | "stop";

export function CoreSettings({ model }: { model: AppModel }) {
  const t = model.t.value;
  const { instance, managed, lifecycle, phase, label, stageLabel } = coreState(model);
  const allowed = model.data.coreManagement.value;
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [confirm, setConfirm] = useState<{ action: Manual; snapshot: Snapshot }>();
  const [feedback, setFeedback] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const hint = model.data.coreStatusHint.value;
  const refused = instance && instance === model.coreShutdownRefusal.value?.instance ? model.coreShutdownRefusal.value : undefined;
  const pending = model.config.pendingRestart.value;
  const current = snapshot && snapshot.instance === instance ? snapshot : undefined;
  const rows = current?.rows ?? [];
  const available = current !== undefined && (current.complete || current.rows.length > 0);
  const confirmationChanged = !!confirm && !sameWork(confirm.snapshot, current);
  const canStart = allowed && model.data.owner.value.state === "unreachable" && !!lifecycle && ["stopped", "exited", "failed", "external"].includes(lifecycle.phase);
  const canStop = allowed && !refused && (phase === "starting" ? lifecycle?.phase === "starting" && !instance : phase === "running" && !!instance && (!lifecycle || managed || ["external", "exited", "stopped", "failed"].includes(lifecycle.phase)));

  useEffect(() => {
    if (!instance || !allowed) return;
    const handle = model.data.watchCoreStatus();
    return () => handle.close();
  }, [model, instance, allowed]);
  useEffect(() => {
    if (!instance || !allowed) return;
    const cancel = new Cancel();
    const load = async () => {
      const rows: WorkItem[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        const out = await model.ops.coreStatus(instance, cursor, { cancel });
        if (cancel.cancelled) return;
        if (!out.ok) {
          setSnapshot({ instance, rows, complete: false, error: out.error.message });
          return;
        }
        for (const row of out.value.items) {
          const key = workKey(row);
          if ((row.kind === "run" || row.kind === "shell") && !seen.has(key)) { rows.push(row); seen.add(key); }
        }
        const next = out.value.next_cursor;
        if (!next) { setSnapshot({ instance, rows, complete: true }); return; }
        if (next === cursor) break;
        cursor = next;
      }
      setSnapshot({ instance, rows, complete: false });
    };
    void load();
    return () => cancel.cancel();
  }, [model, instance, allowed, hint, retry]);

  const execute = async (action: Manual) => {
    setFeedback(undefined);
    if (managed || phase === "starting") {
      if (!model.data.link.launcherAction(action, instance)) setFeedback(t("core.notSent"));
    } else if (instance && action === "stop") {
      setBusy(true);
      const out = await model.ops.ownerShutdown(instance);
      if (!out.ok) {
        if (out.error.kind === "owner" && out.error.code === "invalid_state" && out.error.message === "shutdown is only available for serve owners") model.coreShutdownRefusal.value = { instance, message: `invalid_state: ${out.error.message}` };
        else setFeedback(out.error.message);
      }
      setBusy(false);
    }
  };
  const request = (action: Manual, button: HTMLButtonElement) => {
    if (phase === "starting") { void execute(action); return; }
    if (!available || !current) return;
    if (!current.rows.length && current.complete) { void execute(action); return; }
    opener.current = button;
    setConfirm({ action, snapshot: current });
  };
  const title = (action: Manual) => t(action === "stop" ? "core.stop" : "launcher.restart");
  const buttons = <>{canStart ? <Button variant="primary" onClick={() => { if (!model.data.link.launcherAction("start")) setFeedback(t("core.notSent")); }}><Icon role="core.start" size="small" /> {t("core.start")}</Button> : null}
    {managed ? <Button variant="primary" disabled={!available || busy} onClick={event => request("restart", event.currentTarget)}><Icon role="action.retry" size="small" /> {title("restart")}</Button> : null}
    {canStop ? <Button variant="warn" disabled={busy || (phase !== "starting" && !available)} onClick={event => request("stop", event.currentTarget)}>{title("stop")}</Button> : null}</>;
  const work = (items: readonly WorkItem[], links: boolean) => <ul class="steps-list">{items.map(row => {
    const href = formatRoute({ view: "conversation", threadId: row.thread_id });
    const text = `${row.thread_title || row.thread_id} · ${t(row.kind === "shell" ? "core.shell" : "core.run")}`;
    return <li key={workKey(row)}>{links ? <a class="nav-link" href={href} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (row.kind === "shell") model.coreActivityThread.value = row.thread_id;
      model.navigate({ view: "conversation", threadId: row.thread_id });
    }}>{text}</a> : text}</li>;
  })}</ul>;
  const dataDir = model.data.dataDir.value;
  const command = dataDir ? `shellboy serve --data-dir '${dataDir.replaceAll("'", "'\\''")}'` : undefined;

  return <>
    <PageHeader title={t("set.section.core")} description={t("set.sub.core")} actions={buttons} />
    <Section title={label} sub={stageLabel}>
      {instance ? <KeyValue rows={[{ key: t("core.instance"), value: instance, mono: true }, { key: t("core.source"), value: t(managed ? "core.managed" : "core.external") }, ...(managed && lifecycle?.ready_at_ms ? [{ key: t("core.readyAt"), value: new Date(lifecycle.ready_at_ms).toLocaleString(model.lang.value) }] : [])]} /> : null}
      {lifecycle?.failure ? <Notice tone="bad">{lifecycle.failure}</Notice> : lifecycle?.restarted_after ? <Notice tone="wait">{t("core.restarted", { reason: lifecycle.restarted_after })}</Notice> : null}
      {refused ? <Notice tone="wait" title={t("core.refused")}>{refused.message}</Notice> : null}
      {feedback ? <Notice tone="bad">{feedback}</Notice> : null}
      <div>{t("core.rule")}</div>
      {allowed && !managed && (!lifecycle || lifecycle.phase === "external" || !!instance) && command ? <GuideCopy title={t("core.manualStart")} line={command} note={t("core.external")} copy={t("code.copy")} copied={t("code.copied")} failed={t("guide.copyFailed")} /> : null}
    </Section>
    {pending.length ? <Section title={t("core.pendingShort")} sub={t("core.pendingScope")}><ul class="steps-list">{pending.map(field => <li key={field}><code>{field}</code></li>)}</ul>{!managed ? <div>{t("setup.restartExternal")}</div> : null}</Section> : null}
    {allowed && instance ? <Section title={t("core.work")}>
      {current?.error ? <Notice tone="bad" actions={<Button onClick={() => { setSnapshot(undefined); setRetry(value => value + 1); }}>{t("common.refresh")}</Button>}>{current.error}</Notice> : null}
      {rows.length ? work(rows, true) : current?.complete ? <div>{t("core.empty")}</div> : !current ? <div>{t("core.reading")}</div> : null}
      {current && !current.complete && !current.error ? <div>{t("core.partial")}</div> : null}
    </Section> : null}
    {confirm ? <WorkSheet open role="alertdialog" dismissOnOutside={false} focusCloseOnOpen title={title(confirm.action)} closeLabel={t("core.cancel")} onClose={() => setConfirm(undefined)} getReturnFocusTarget={() => opener.current}>
      <div>{t("core.interrupted")}</div><div>{t("core.rule")}</div>{work(confirm.snapshot.rows, false)}
      {!confirm.snapshot.complete ? <div>{t("core.partial")}</div> : null}
      {confirmationChanged ? <div>{t("core.changed")}</div> : null}
      <Button variant={confirm.action === "stop" ? "warn" : "primary"} disabled={confirmationChanged || !canStop || busy || (confirm.action === "restart" && !managed)} onClick={() => { const action = confirm.action; setConfirm(undefined); void execute(action); }}>{title(confirm.action)}</Button>
    </WorkSheet> : null}
  </>;
}
