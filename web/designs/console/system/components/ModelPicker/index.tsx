import type { AppModel } from "../../../../../ui-core/src";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { MonitorPopover } from "../MonitorPopover";
import { Notice } from "../Notice";
import { ConnectionModelList, modelLabel } from "./ConnectionModelList";
import { EffortControl } from "./EffortControl";

type Details = NonNullable<AppModel["details"]["value"]>;

/** The Conversation header's model and run-setting picker. */
export function ModelPicker({ model, details, onThreadSettings }: { model: AppModel; details: Details; onThreadSettings: () => void }) {
  const t = model.t.value;
  const picker = model.modelPicker.value;
  const canEdit = model.data.capabilities.value.includes("thread.settings");
  const disabled = picker.saving || !canEdit;
  const choices = picker.models.some(row => row.connection === details.connection && row.model === details.model)
    ? picker.models : [details, ...picker.models];
  const effortText = details.effort || t("model.effort.default");
  return <MonitorPopover className="model-picker-anchor" ghost label={`${modelLabel(details)} · ${effortText}`}
    content={<><span class="model-picker-name">{modelLabel(details)}</span><span class="model-picker-effort">{effortText}</span><Icon role="composer.modelMenu" size="small" /></>}
    controlled={{ open: picker.open, toggle: () => picker.open ? model.closeModelPicker() : model.openModelPicker(), close: () => model.closeModelPicker(), panelClass: "model-picker", panelLabel: t("model.change"), focusSearch: true }}>
      <p class="caption muted">{t("model.note")}</p>
      <ConnectionModelList choices={choices} selected={details} searchLabel={t("model.search")} emptyLabel={picker.loading ? t("common.loading") : t("model.empty")} disabled={disabled} onSelect={choice => void model.selectPickerModel(choice)} onCommitId={(id, connection) => void model.commitPickerModelId(id, connection)} />
      {picker.catalogErrors.map((error, index) => <Notice key={index} tone="bad">{error}</Notice>)}
      <EffortControl label={t("model.effort")} value={details.effort ?? ""} labels={{ default: t("model.effort.default"), low: "low", medium: "medium", high: "high", other: t("model.effort.other") }} disabled={disabled} explicitCommit onSelect={effort => void model.selectPickerEffort(effort)} onCommit={effort => void model.selectPickerEffort(effort)} />
      {!canEdit ? <Notice tone="wait">{t("thread.readOnly")}</Notice> : null}
      <Button variant="ghost" onClick={() => { model.closeModelPicker(); onThreadSettings(); }}>{t("threadSettings.link")}</Button>
      {picker.error ? <Notice tone="bad">{picker.error}</Notice> : null}
  </MonitorPopover>;
}
