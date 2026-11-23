import { useEffect, useRef } from "preact/hooks";
import type { AppModel } from "../../../../../ui-core/src";
import { Button, Field, MonitorPopover, Notice } from "..";
import { ConnectionModelList, modelLabel } from "./ConnectionModelList";
import { EffortControl } from "./EffortControl";

type Details = NonNullable<AppModel["details"]["value"]>;

/** The Conversation header's model and run-setting picker. */
export function ModelPicker({ model, details }: { model: AppModel; details: Details }) {
  const t = model.t.value;
  const picker = model.modelPicker.value;
  const canEdit = model.data.capabilities.value.includes("thread.settings");
  const disabled = picker.saving || !canEdit;
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = model.pendingSettingFocus.value;
  useEffect(() => {
    if (pendingFocus !== "thread.maxTokens") return;
    if (!picker.open) { model.pendingSettingFocus.value = undefined; return; }
    const field = root.current?.querySelector<HTMLInputElement>('[data-thread-setting="maxTokens"]');
    if (!field) { model.pendingSettingFocus.value = undefined; return; }
    field.focus();
    if (document.activeElement === field) model.pendingSettingFocus.value = undefined;
  }, [model, picker.open, pendingFocus]);
  const choices = picker.models.some(row => row.connection === details.connection && row.model === details.model)
    ? picker.models : [details, ...picker.models];
  return <div ref={root}><MonitorPopover className="model-picker-anchor" label={`${modelLabel(details)} · ${details.effort || t("model.effort.default")}`}
    controlled={{ open: picker.open, toggle: () => picker.open ? model.closeModelPicker() : model.openModelPicker(), close: () => model.closeModelPicker(), panelClass: "model-picker", panelLabel: t("model.change") }}>
      <p class="caption muted">{t("model.note")}</p>
      <ConnectionModelList choices={choices} selected={details} searchLabel={t("model.search")} emptyLabel={picker.loading ? t("common.loading") : t("model.empty")} disabled={disabled} onSelect={choice => void model.selectPickerModel(choice)} onCommitId={(id, connection) => void model.commitPickerModelId(id, connection)} />
      {picker.catalogErrors.map((error, index) => <Notice key={index} tone="bad">{error}</Notice>)}
      <EffortControl label={t("model.effort")} value={details.effort ?? ""} labels={{ default: t("model.effort.default"), low: "low", medium: "medium", high: "high", other: t("model.effort.other") }} disabled={disabled} explicitCommit onSelect={effort => void model.selectPickerEffort(effort)} onCommit={effort => void model.selectPickerEffort(effort)} />
      {!canEdit ? <Notice tone="wait">{t("thread.readOnly")}</Notice> : null}
      <p class="caption muted">{t("thread.inherited")}</p>
      {([["autoCompactAt", "thread.auto"], ["maxTokens", "config.conn.max_tokens"], ["agents", "thread.agents"]] as const).map(([key, label]) => <label>{t(label)}<Field ariaLabel={t(label)} data-thread-setting={key === "maxTokens" ? "maxTokens" : undefined} value={picker[key]} placeholder={key !== "agents" && model.effectiveThreadSettings.value[key] !== undefined ? t("thread.effective", { value: model.effectiveThreadSettings.value[key]! }) : undefined} disabled={picker.saving || !canEdit} onInput={(event) => { if (key === "maxTokens") model.editThreadOutputLimit(event.currentTarget.value); else model.modelPicker.value = { ...model.modelPicker.peek(), [key]: event.currentTarget.value }; }} /></label>)}
      {picker.maxTokensState.kind === "unknown" && !picker.clearMaxTokens ? <><p class="caption muted">{t("thread.outputLimitUnknown")}</p><Button disabled={picker.saving || !canEdit} onClick={() => model.clearThreadOutputLimit()}>{t("thread.clearOutputLimit")}</Button></> : <p class="caption muted">{t("thread.outputLimitNote")}</p>}
      <p class="caption muted">{t("thread.agentsTiming")}</p>
      {picker.error ? <Notice tone="bad">{picker.error}</Notice> : null}
      <div class="model-picker-actions"><Button disabled={picker.saving} onClick={() => model.closeModelPicker()}>{t("model.close")}</Button><Button variant="primary" disabled={!canEdit || picker.saving} onClick={() => void model.saveThreadModel()}>{t("model.saveAdvanced")}</Button></div>
  </MonitorPopover></div>;
}
