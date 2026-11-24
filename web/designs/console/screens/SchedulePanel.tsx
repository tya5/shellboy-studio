import { useRef, useState } from "preact/hooks";
import type { DefinitionAction, DefinitionKind, ShellDefinition } from "../../../data/src/schedules";
import type { AppModel } from "../../../ui-core/src/model";
import { activityStatusLabel } from "../../../ui-core/src";
import { Button, Icon, KeyValue, ListDivider, ListRow, LogBlock, StatusMark, Switch, WorkSheet, ScheduleLayout, ScheduleRow, ScheduleControl, ScheduleDetailLayout, ScheduleActions } from "../system/components";


const nameOf = (row: ShellDefinition) => row.description?.trim() || row.command;
const shellStatus = (row: ShellDefinition) => {
  switch (row.latest?.state) {
    case "starting": case "running": case "stopping": return "running";
    case "exited": return row.latest.exit === 0 ? "completed" : "failed";
    case "failed": case "stopped": return row.latest.state;
    default: return undefined;
  }
};

export function SchedulePanel({ model, kind, open, detailId }: {
  model: AppModel; kind: DefinitionKind; open?: (id: string, opener: HTMLButtonElement) => void; detailId?: string;
}) {
  const t = model.t.value;
  const handle = model.handle.value;
  const resource = handle?.definitions[kind].value;
  const [confirm, setConfirm] = useState<{ id: string; opener: HTMLButtonElement }>();
  const [feedback, setNotice] = useState<{ id: string; key: "schedule.unconfirmed" | "schedule.failed" }>();
  const busy = useRef<string>();
  const [pending, setPending] = useState<string>();
  if (!handle || !resource) return null;
  const current = (id: string) => {
    const facts = handle.definitions[kind].peek();
    return model.handle.peek() === handle && model.data.owner.peek().state === "connected" && !facts.stale && !facts.loading && !facts.error ? facts.value?.get(id) : undefined;
  };
  const act = async (row: ShellDefinition, action: DefinitionAction) => {
    if (busy.current || current(row.id) !== row) return;
    busy.current = row.id;
    setPending(row.id);
    setNotice(undefined);
    const out = action === "start" || action === "stop" ? await model.ops.serviceAction(action, row.id) : await model.ops.scheduleAction(action, row.id);
    busy.current = undefined;
    setPending(undefined);
    if (!out.ok) setNotice({ id: row.id, key: out.error.kind === "unconfirmed" ? "schedule.unconfirmed" : "schedule.failed" });
  };
  const status = (row: ShellDefinition, word: boolean) => {
    const value = shellStatus(row);
    return value ? <StatusMark shell status={value} label={activityStatusLabel(t, value)} word={word} /> : null;
  };
  const time = (value?: string, compact = false) => value ? new Date(value).toLocaleString(model.lang.value, { dateStyle: compact ? "short" : "medium", timeStyle: "short" }) : t("schedule.none");
  const state = (row: ShellDefinition) => shellStatus(row) === "running" ? t("work.running") : row.enabled ? t("schedule.waiting") : t("schedule.stopped");
  const controls = (row: ShellDefinition, compact: boolean) => {
    const disabled = !current(row.id) || pending !== undefined;
    return <>
      <ScheduleControl>{kind === "service"
        ? <Button variant="ghost" disabled={disabled} aria-label={t(row.enabled ? "service.stopNamed" : "service.startNamed", { name: nameOf(row) })} onClick={() => void act(row, row.enabled ? "stop" : "start")}>{t(row.enabled ? "service.stop" : "service.start")}</Button>
        : <Switch label={t("schedule.enabledNamed", { name: nameOf(row) })} stateLabel={compact ? "" : t(row.enabled ? "schedule.on" : "schedule.off")} checked={row.enabled} disabled={disabled} onChange={checked => void act(row, checked ? "enable" : "disable")} />}</ScheduleControl>
      {kind === "schedule" ? <ScheduleControl remove><Button variant="ghost" icon={compact} label={t("schedule.removeNamed", { name: nameOf(row) })} disabled={disabled} onClick={event => setConfirm({ id: row.id, opener: event.currentTarget })}><Icon role="action.delete" size="small" />{compact ? null : t("schedule.remove")}</Button></ScheduleControl> : null}
    </>;
  };
  const detail = detailId ? resource.value?.get(detailId) : undefined;
  const target = confirm ? resource.value?.get(confirm.id) : undefined;
  const title = t(kind === "schedule" ? "schedule.heading" : "service.heading");
  const load = resource.loading ? t("common.loading") : resource.stale ? t("schedule.stale") : undefined;
  return <ScheduleLayout>
    {open ? <ListDivider label={title} count={resource.value?.size} /> : null}
    {load ? <p class="caption muted" role="status">{load}</p> : null}
    {feedback ? <p role="alert">{t(feedback.key)}</p> : null}
    {open ? [...resource.value?.values() ?? []].map(row => <ScheduleRow key={row.id} kind={kind}>
      <ListRow id={row.id} title={nameOf(row)} subtitle={kind === "schedule" ? time(row.next, true) : state(row)} onSelect={opener => open(row.id, opener)}>{status(row, false)}</ListRow>
      {controls(row, true)}
    </ScheduleRow>) : detail ? <ScheduleDetailLayout>
      <h3>{nameOf(detail)}</h3>
      <KeyValue rows={[
        { key: t("schedule.kind"), value: t(kind === "service" ? "service.heading" : detail.cron ? "schedule.cron" : "schedule.once") },
        ...(kind === "schedule" ? [{ key: t("schedule.when"), value: detail.cron ? <code>{detail.cron} · {t("schedule.zone")}</code> : time(detail.at) }] : []),
        { key: t("schedule.next"), value: kind === "service" ? t("schedule.serviceNoNext") : time(detail.next) },
        { key: t("schedule.result"), value: detail.latest ? <>{status(detail, true)} {time(detail.latest.ended ?? detail.latest.started)} {detail.latest.exit === undefined ? null : t("schedule.exit", { code: detail.latest.exit })}</> : t("schedule.none") },
        { key: t("schedule.cwd"), value: <code>{detail.cwd}</code> },
        { key: t("schedule.command"), value: <code>{detail.command}</code> },
      ]} />
      {detail.latest?.output ? <><h4>{t("schedule.output")}</h4><LogBlock text={detail.latest.output} boxed /></> : null}
      <ScheduleActions>{controls(detail, false)}</ScheduleActions>
    </ScheduleDetailLayout> : !load ? <p class="muted caption">{t("schedule.gone")}</p> : null}
    {open && resource.value?.size === 0 && !load ? <p class="caption muted">{t("schedule.none")}</p> : null}
    {open && kind === "schedule" && resource.value?.size ? <p class="caption muted">{t("schedule.onceNote")}</p> : null}
    {confirm ? <WorkSheet open role="alertdialog" dismissOnOutside={false} focusCloseOnOpen title={t("schedule.confirm")} closeLabel={t("threadSettings.cancel")} getReturnFocusTarget={() => confirm.opener.isConnected ? confirm.opener : null} onClose={() => setConfirm(undefined)}>
      <p>{target ? t("schedule.removeCopy", { name: nameOf(target) }) : t("schedule.none")}</p>
      <Button variant="warn" disabled={!target || !current(target.id) || pending !== undefined} onClick={() => { if (target && current(target.id) === target) { setConfirm(undefined); void act(target, "remove"); } }}>{t("schedule.remove")}</Button>
    </WorkSheet> : null}
  </ScheduleLayout>;
}
