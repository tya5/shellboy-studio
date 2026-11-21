import { useEffect } from "preact/hooks";
import { GuideRegistrationView } from "./GuideRegistration";
import { CAPABILITY_CONFIG, CONFIG_FIELDS, formatRoute, settingsSection, SETTINGS_SECTIONS, valueAt, type ConfigKey, type DesignContext, type SettingsSection } from "../../../ui-core/src";
import { Button, EffortControl, FactList, Notice, PairingQr, Section, SubView, type Fact, type IconRole } from "../system/components";
import { AppearanceChoices } from "./Appearance";
import { ConfigConnections, ConnectionModelRow, ConfigControl, ConfigPanel, configRowValue } from "./SettingsConfig";

const ICONS: Record<SettingsSection, IconRole> = { general: "settings.general", connections: "settings.connections", appearance: "settings.appearance", compaction: "settings.compaction", storage: "settings.storage", index: "settings.index", agent: "settings.agent", studio: "settings.studio" };

export function SettingsView({ context }: { context: DesignContext }) {
  const model = context.model;
  const t = model.t.value;
  const section = settingsSection(model.route.value);
  useEffect(() => { if (section === "studio") void model.loadPairingHosts(); }, [section, model]);
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
  const effortValue = effortPath ? valueAt(facts?.file.values, effortPath) : undefined;
  const effort: Fact = effortPath && editable
    ? { label: effortLabel, control: <div class="stack"><EffortControl label={effortLabel} value={typeof effortValue === "string" ? effortValue : ""} labels={{ default: t("model.effort.default"), low: "low", medium: "medium", high: "high", other: t("model.effort.other") }} disabled={model.config.fieldSaving.value} onSelect={(value) => void model.config.saveField(effortPath, value, "text")} onCommit={(value) => void model.config.saveField(effortPath, value, "text")} /><div class="muted caption">{model.config.fieldError.value?.field === effortPath.join(".") ? model.config.fieldError.value.reason : model.config.lastSaved.value?.field === effortPath.join(".") ? <>{model.config.lastSaved.value.restartRequired ? t("config.restartOwner") : t("config.applyNow")} <Button variant="link" onClick={() => void model.config.undoLast()}>{t("config.undo")}</Button></> : facts?.restartAll ? t("config.restartOwner") : t("config.applyNow")}</div></div> }
    : { label: effortLabel, ...(effortPath && facts ? { value: configRowValue(t, facts, effortPath) } : {}) };

  const body = () => {
    switch (section) {
      case "general":
        return <>
          <Section title={t("set.models.defaults")}><FactList missing={missing} facts={[
            ...(editable ? [{ label: t("set.models.defaultModel"), control: <ConnectionModelRow model={model} path={["default_connection"]} modelPath={["default_model"]} effortPath={effortPath} label={t("set.models.defaultConn")} /> }] : [fileFact(t("set.models.defaultConn"), "default_connection"), fileFact(t("set.models.defaultModel"), "default_model"), effort]),
            fileFact(t("settings.language"), "ui.language"),
          ]} /></Section>
        </>;
      case "connections":
        return <>
          <Section title={t("setup.open")} sub={t("setup.intro")}><div class="setup-actions"><a class="btn" href={formatRoute({ view: "setup" })} onClick={() => model.setup.beginAdd()}>{t("setup.add")}</a></div></Section>
          {canEdit && facts && !model.config.read.value.error ? <ConfigConnections model={model} /> : null}
        </>;
      case "compaction":
        return <Section title={t("set.compact.file")} sub={t("set.threadSettings")}><FactList missing={missing} facts={[
          fileFact(t("set.compact.autoAt"), "compaction.auto_at_tokens"),
          fileFact(t("set.compact.maxChars"), "compaction.summary_max_chars"),
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
      case "agent":
        return <GuideRegistrationView context={context} />;
      case "appearance":
        return <Section title={t("set.section.appearance")}><AppearanceChoices context={context} /></Section>;
      case "studio":
        return <>
          <Section title={t("pair.title")} sub={t("pair.help")}>
            {model.pairing.value.error ? <Notice tone="bad">{t("pair.error")}</Notice> : null}
            {!model.pairing.value.hosts.length ? <p>{t("pair.noHosts")}</p> : model.pairing.value.hosts.map(host => {
              const link = model.pairing.value.links[host];
              return <div key={host}><p><code>{host}</code></p>{link ? <><PairingQr value={link.url} label={t("pair.qr")} url={link.url} /><p>{t("pair.expires", { time: new Date(link.expires).toLocaleTimeString() })}</p><Button onClick={() => void navigator.clipboard.writeText(link.url)}>{t("pair.copy")}</Button></> : null}<Button onClick={() => void model.createPairing(host)}>{t(link ? "pair.reissue" : "pair.create")}</Button></div>;
            })}
          </Section>
          <Section title={t("studio.remote")} sub={t("studio.remoteGuide")}><FactList missing={missing} facts={[{ label: t("studio.listen"), value: model.data.listen.value, mono: true }]} /><p><code>shellboy-studio guide user</code></p><p><code>shellboy-studio --allow-host HOSTNAME</code></p><p>{t("studio.hostGuide")}</p></Section>
          <Section title={t("studio.token")}><p>{t("studio.tokenGuide")}</p></Section>
          <Section title={t("studio.info")}><FactList missing={missing} facts={[{ label: t("studio.apps"), value: model.data.appsDir.value, mono: true }, { label: t("studio.version"), value: model.data.bridgeVersion.value, mono: true }, { label: t("studio.ownerVersion") }]} /></Section>
        </>;
      case "index":
        return <>
        <Notice tone="wait">{t("set.index.cost")}</Notice>
        <Section title={t("set.embed.file")}><FactList missing={missing} facts={[
          fileFact(t("set.models.defaultConn"), "embedding.connection"),
          { ...fileFact(t("set.conn.model"), "embedding.model"), note: t("set.embed.modelNote") },
        ]} /></Section>
        <Section title={t("set.section.index")}><FactList missing={missing} facts={[
          fileFact(t("set.embed.auto"), "indexing.auto_history"),
          fileFact(t("set.index.kinds"), "indexing.auto_kinds"),
        ]} /></Section>
        </>;
    }
  };
  const groupFor = (s: SettingsSection) => s === "general" || s === "connections" ? t("set.group.start") : s === "compaction" || s === "index" || s === "agent" ? t("set.group.agent") : s === "appearance" ? t("set.group.display") : s === "storage" ? t("set.group.data") : t("set.group.app");
  return <SubView title={t("set.title")} groupedNav searchable items={SETTINGS_SECTIONS.map((s) => ({ key: s, href: formatRoute({ view: "settings", section: s }), role: ICONS[s], label: t(`set.section.${s}`), description: t(`set.sub.${s}`), searchTerms: ({ general: ["General", "全般"], connections: ["Connections", "接続"], compaction: ["Summary", "要約"], storage: ["Storage", "保存", "Capacity", "容量"], index: ["Index", "索引"], agent: ["Agent", "エージェントの案内"], appearance: ["Appearance", "外観"], studio: ["Studio", "このアプリ"] }[s]), group: groupFor(s), groupRole: s === "general" || s === "connections" ? "settings.category.start" : s === "compaction" || s === "index" || s === "agent" ? "settings.category.agent" : s === "appearance" ? "settings.category.display" : s === "storage" ? "settings.category.data" : "settings.category.app", current: s === section }))}>
    <div class="pagehead"><h1>{t(`set.section.${section}`)}</h1><div class="muted">{t(`set.sub.${section}`)}</div></div>
    {section !== "studio" && section !== "agent" ? <ConfigPanel model={model} /> : null}
    {body()}
  </SubView>;
}
