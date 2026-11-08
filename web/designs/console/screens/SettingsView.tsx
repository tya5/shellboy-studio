import { CAPABILITY_CONFIG, CONFIG_FIELDS, formatRoute, settingsSection, SETTINGS_SECTIONS, valueAt, type ConfigKey, type DesignContext, type SettingsSection } from "../../../ui-core/src";
import { FactList, Notice, Section, SubView, type Fact, type IconName } from "../system/components";
import { AppearanceChoices } from "./Appearance";
import { ConfigConnections, ConfigControl, ConfigPanel, configRowValue } from "./SettingsConfig";

const ICONS: Record<SettingsSection, IconName> = { general: "palette", connections: "plug", compaction: "retry", storage: "file", index: "database" };

export function SettingsView({ context }: { context: DesignContext }) {
  const model = context.model;
  const t = model.t.value;
  const section = settingsSection(model.route.value);
  const canEdit = model.data.capabilities.value.includes(CAPABILITY_CONFIG);
  const facts = model.config.read.value.value;
  const editable = canEdit && !model.config.read.value.error && facts?.file.valid === true;
  const fileFact = (label: string, key: ConfigKey): Fact => {
    const spec = CONFIG_FIELDS[key];
    const path = key.split(".");
    if (spec && editable) return { label, control: <ConfigControl model={model} path={path} label={label} spec={spec} /> };
    const value = spec && facts ? configRowValue(t, facts, path) : undefined;
    return { label, ...(value !== undefined ? { value } : {}) };
  };
  const missing = t("common.notReadable");
  const defaultDraft = model.config.drafts.value.get("default_connection");
  const defaultConnection = defaultDraft ? defaultDraft.value : valueAt(facts?.file.values, ["default_connection"]);
  const effortPath = typeof defaultConnection === "string" ? ["connections", defaultConnection, "default_effort"] : undefined;
  const effortLabel = t("set.models.defaultEffort");
  const effort: Fact = effortPath && editable
    ? { label: effortLabel, control: <ConfigControl model={model} path={effortPath} label={effortLabel} spec={{ kind: "text" }} /> }
    : { label: effortLabel, ...(effortPath && facts ? { value: configRowValue(t, facts, effortPath) } : {}) };

  const body = () => {
    switch (section) {
      case "general":
        return <>
          <Section title={t("set.models.defaults")}><FactList missing={missing} facts={[
            fileFact(t("set.models.defaultConn"), "default_connection"),
            fileFact(t("set.models.defaultModel"), "default_model"),
            effort,
            fileFact(t("settings.language"), "ui.language"),
          ]} /></Section>
          <Section title={t("set.section.appearance")}><AppearanceChoices context={context} showLanguage={false} /></Section>
        </>;
      case "connections":
        return <>
          <Section title={t("setup.open")} sub={t("setup.intro")}><div class="setup-actions"><a class="btn" href={formatRoute({ view: "setup" })} onClick={() => model.setup.beginAdd()}>{t("setup.add")}</a></div></Section>
          {canEdit && facts && !model.config.read.value.error ? <ConfigConnections model={model} /> : null}
          <Section title={t("set.embed.file")}><FactList missing={missing} facts={[
            fileFact(t("set.models.defaultConn"), "embedding.connection"),
            fileFact(t("set.conn.model"), "embedding.model"),
          ]} /></Section>
        </>;
      case "compaction":
        return <Section title={t("set.compact.file")} sub={t("set.threadSettings")}><FactList missing={missing} facts={[
          fileFact(t("set.compact.autoAt"), "compaction.auto_at_tokens"),
          fileFact(t("set.compact.segment"), "compaction.segment_chars"),
          fileFact(t("set.compact.rounds"), "compaction.reduce_rounds"),
          fileFact(t("set.compact.maxChars"), "compaction.summary_max_chars"),
          fileFact(t("set.compact.maxPercent"), "compaction.summary_max_percent"),
          fileFact(t("set.compact.mapRequests"), "compaction.summary_map_max_requests"),
          fileFact(t("set.compact.reduceRequests"), "compaction.summary_reduce_max_requests"),
        ]} /></Section>;
      case "storage":
        return <Section title={t("set.store.file")} sub={t("set.store.see")} actions={<a class="btn" href={formatRoute({ view: "analytics", section: "storage" })}>{t("set.store.open")}</a>}><FactList missing={missing} facts={[
          fileFact(t("set.store.warnBytes"), "limits.data_warning_bytes"),
          fileFact(t("set.store.maxBytes"), "limits.data_max_bytes"),
          fileFact(t("set.store.freeBytes"), "limits.disk_free_min_bytes"),
          fileFact(t("set.limit.attachment_file_bytes"), "limits.attachment_file_bytes"),
          fileFact(t("set.limit.attachment_request_bytes"), "limits.attachment_request_bytes"),
          fileFact(t("set.limit.shell_raw_bytes"), "limits.shell_raw_bytes"),
          fileFact(t("set.limit.tool_excerpt_bytes"), "limits.tool_excerpt_bytes"),
          fileFact(t("set.limit.shell_stdin_bytes"), "limits.shell_stdin_bytes"),
          fileFact(t("set.limit.draft_bytes"), "limits.draft_bytes"),
          fileFact(t("set.store.rawDays"), "retention.tool_raw_days"),
          fileFact(t("set.store.rawBytes"), "retention.tool_raw_bytes"),
          fileFact(t("set.store.clipDays"), "retention.clipboard_days"),
          fileFact(t("set.store.clipBytes"), "retention.clipboard_bytes"),
        ]} /></Section>;
      case "index":
        return <Section title={t("set.section.index")}><Notice tone="wait">{t("set.index.cost")}</Notice><FactList missing={missing} facts={[
          fileFact(t("set.embed.auto"), "indexing.auto_history"),
          fileFact(t("set.index.kinds"), "indexing.auto_kinds"),
        ]} /></Section>;
    }
  };
  return <SubView title={t("set.title")} items={SETTINGS_SECTIONS.map((s) => ({ key: s, href: formatRoute({ view: "settings", section: s }), icon: ICONS[s], label: t(`set.section.${s}`), current: s === section }))}>
    <div class="pagehead"><h1>{t(`set.section.${section}`)}</h1><div class="muted">{t(`set.sub.${section}`)}</div></div>
    <ConfigPanel model={model} />
    {body()}
  </SubView>;
}
