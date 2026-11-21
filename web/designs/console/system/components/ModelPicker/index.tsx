import type { AppModel } from "../../../../../ui-core/src";
import { Button, Field, Notice } from "..";
import { EffortControl } from "./EffortControl";

type Details = NonNullable<AppModel["details"]["value"]>;

/** The Conversation header's model and run-setting picker. */
export function ModelPicker({ model, details }: { model: AppModel; details: Details }) {
  const t = model.t.value;
  const picker = model.modelPicker.value;
  const canEdit = model.data.capabilities.value.includes("thread.settings");
  return <div class="model-picker-anchor">
    <Button aria-expanded={picker.open} aria-haspopup="dialog" onClick={() => picker.open ? model.closeModelPicker() : model.openModelPicker()}>{details.model}</Button>
    {picker.open ? <div class="model-picker" role="dialog" aria-label={t("model.change")} onKeyDown={(event) => { if (event.key === "Escape") model.closeModelPicker(); }}>
      <p class="caption muted">{t("model.note")}</p>
      <label>{t("model.connection")}<select value={picker.connection} disabled={picker.saving || !canEdit} onChange={(event) => model.chooseModelConnection(event.currentTarget.value)}>{[...new Set([picker.connection, ...Object.keys((model.config.read.value.value?.loaded.values?.connections as Record<string, unknown> | undefined) ?? {})])].filter(Boolean).map((connection) => <option value={connection}>{connection}</option>)}</select></label>
      <Field ariaLabel={t("model.search")} value={picker.model} disabled={picker.saving || !canEdit} onInput={(event) => { model.modelPicker.value = { ...model.modelPicker.peek(), model: event.currentTarget.value }; }} />
      <div class="model-picker-list">{picker.loading ? <span>{t("common.loading")}</span> : picker.models.filter((item) => (picker.model === details.model || item.toLowerCase().includes(picker.model.toLowerCase()))).length ? picker.models.filter((item) => (picker.model === details.model || item.toLowerCase().includes(picker.model.toLowerCase()))).map((item) => <Button variant="link" disabled={!canEdit} onClick={() => { model.modelPicker.value = { ...model.modelPicker.peek(), model: item }; }}>{item}</Button>) : <span>{t("model.empty")}</span>}</div>
      <EffortControl label={t("model.effort")} value={picker.effort} labels={{ default: t("model.effort.default"), low: "low", medium: "medium", high: "high", other: t("model.effort.other") }} disabled={picker.saving || !canEdit} onSelect={(effort) => { model.modelPicker.value = { ...model.modelPicker.peek(), effort }; }} onInput={(effort) => { model.modelPicker.value = { ...model.modelPicker.peek(), effort }; }} onCommit={(effort) => { model.modelPicker.value = { ...model.modelPicker.peek(), effort }; }} />
      {!canEdit ? <Notice tone="wait">{t("thread.readOnly")}</Notice> : null}
      <p class="caption muted">{t("thread.inherited")}</p>
      {([["autoCompactAt", "thread.auto"], ["maxTokens", "thread.maxTokens"], ["agents", "thread.agents"]] as const).map(([key, label]) => <label>{t(label)}<Field ariaLabel={t(label)} value={picker[key]} placeholder={key !== "agents" && model.effectiveThreadSettings.value[key] !== undefined ? t("thread.effective", { value: model.effectiveThreadSettings.value[key]! }) : undefined} disabled={picker.saving || !canEdit} onInput={(event) => { if (key === "maxTokens") model.editThreadOutputLimit(event.currentTarget.value); else model.modelPicker.value = { ...model.modelPicker.peek(), [key]: event.currentTarget.value }; }} /></label>)}
      {picker.maxTokensState.kind === "unknown" && !picker.clearMaxTokens ? <><p class="caption muted">{t("thread.outputLimitUnknown")}</p><Button disabled={picker.saving || !canEdit} onClick={() => model.clearThreadOutputLimit()}>{t("thread.clearOutputLimit")}</Button></> : <p class="caption muted">{t("thread.outputLimitNote")}</p>}
      <p class="caption muted">{t("thread.agentsTiming")}</p>
      {picker.error ? <Notice tone="bad">{picker.error}</Notice> : null}
      <div class="model-picker-actions"><Button disabled={picker.saving} onClick={() => model.closeModelPicker()}>{t("model.close")}</Button><Button variant="primary" disabled={!canEdit || picker.saving || !picker.model.trim()} onClick={() => void model.saveThreadModel()}>{t("model.save")}</Button></div>
    </div> : null}
  </div>;
}
