import { useEffect } from "preact/hooks";
import { GuideRegistrationView, guideSearchRows } from "./GuideRegistration";
import { CAPABILITY_CONFIG, CONFIG_FIELDS, fieldOf, formatRoute, settingsSection, SETTINGS_SECTIONS, valueAt, translator, type ConfigKey, type MessageKey, type DesignContext, type SettingsSection } from "../../../ui-core/src";
import { Button, EffortControl, FactList, Notice, PageHeader, PairingQr, Section, SubView, type Fact, type IconRole } from "../system/components";
import { AppearanceChoices, appearanceSearchRows } from "./Appearance";
import { LoginStartup } from "./LoginStartup";
import { SettingsShare } from "./SettingsShare";
import { connectionCards, ConnectionModelRow, ConfigControl, ConfigPanel, SettingFeedback, configRowValue } from "./SettingsConfig";

import { settingSearch, type SettingSearch } from "./setting-search";

const ICONS: Record<SettingsSection, IconRole> = { general: "settings.general", connections: "settings.connections", appearance: "settings.appearance", compaction: "settings.compaction", storage: "settings.storage", index: "settings.index", agent: "settings.agent", studio: "settings.studio" };

export function SettingsView({ context }: { context: DesignContext }) {
  const model = context.model;
  const t = model.t.value;
  const section = settingsSection(model.route.value);
  useEffect(() => { if (section === "studio") void model.loadPairingHosts(); }, [section, model]);
  const canEdit = model.data.capabilities.value.includes(CAPABILITY_CONFIG);
  const facts = model.config.read.value.value;
  const editable = canEdit && !model.config.read.value.error && facts?.file.valid === true;
  const pendingSettingFocus = model.pendingSettingFocus.value;
  useEffect(() => {
    if (!pendingSettingFocus?.startsWith("connections.")) return;
    if (section !== "connections") { model.pendingSettingFocus.value = undefined; return; }
    if (!facts) return;
    const target = [...document.querySelectorAll<HTMLElement>("[data-setting-id]")]
      .find((element) => element.dataset.settingId === pendingSettingFocus);
    const field = target?.querySelector<HTMLInputElement>("input");
    if (!target || !field) { model.pendingSettingFocus.value = undefined; return; }
    target.scrollIntoView({ block: "center" });
    field.focus();
    if (document.activeElement === field) model.pendingSettingFocus.value = undefined;
  }, [model, section, pendingSettingFocus, facts]);
  const rows = new Map<SettingsSection, SettingSearch[]>();
  const body = (section: SettingsSection) => {
    const search = (settingId: string, key: MessageKey, notes: readonly MessageKey[] = [], scope?: string) => {
      const entry = settingSearch(t, settingId, key, notes, scope);
      const list = rows.get(section) ?? [];
      list.push(entry);
      rows.set(section, list);
      return { settingId, label: t(key) };
    };
    const fileFact = (keyLabel: MessageKey, key: ConfigKey, noteKey?: MessageKey): Fact => {
      const props = search(key, keyLabel, noteKey ? [noteKey] : []);
      const { label } = props;
      const note = noteKey ? t(noteKey) : undefined;
      const spec = CONFIG_FIELDS[key];
      const path = key.split(".");
      if (spec && editable) return { ...props, note, control: <ConfigControl model={model} path={path} label={label} spec={spec} /> };
      const value = spec && facts ? configRowValue(t, facts, path) : undefined;
      return { ...props, note, ...(value !== undefined ? { value } : {}) };
    };
    const missing = t("common.notReadable");
    const defaultConnection = valueAt(facts?.file.values, ["default_connection"]);
    const effortPath = typeof defaultConnection === "string" ? ["connections", defaultConnection, "default_effort"] : undefined;
    const effortLabel = t("set.models.defaultEffort");
    const effortValue = effortPath ? valueAt(facts?.file.values, effortPath) : undefined;
    const effortProps = section === "general" ? search("default-effort", "set.models.defaultEffort", ["set.models.effortNote"]) : { label: effortLabel };
    const effort: Fact = effortPath && editable
      ? { ...effortProps, note: t("set.models.effortNote"), control: <div class="stack"><EffortControl revealOther label={effortLabel} value={typeof effortValue === "string" ? effortValue : ""} reset={model.config.fieldError.value?.field === fieldOf(effortPath) ? model.config.fieldError.value : undefined} labels={{ default: t("model.effort.default"), low: "low", medium: "medium", high: "high", other: t("model.effort.other") }} disabled={model.config.fieldSaving.value} onSelect={(value) => void model.config.saveField(effortPath, value, "text")} onCommit={(value) => void model.config.saveField(effortPath, value, "text")} /><SettingFeedback model={model} paths={[effortPath]} /></div> }
      : { ...effortProps, ...(effortPath && facts ? { value: configRowValue(t, facts, effortPath) } : {}) };

    switch (section) {
      case "general":
        return <>
          <Section title={t("set.models.defaults")}><FactList missing={missing} facts={[
            ...(editable ? [{ ...search("default_model", "set.models.defaultModel", ["set.models.modelNote"]), note: t("set.models.modelNote"), control: <ConnectionModelRow model={model} path={["default_connection"]} modelPath={["default_model"]} label={t("set.models.defaultConn")} /> }] : [fileFact("set.models.defaultConn", "default_connection"), fileFact("set.models.defaultModel", "default_model")]),
            effort,
            {
              ...fileFact("set.coreLanguage", "ui.language", "set.coreLanguageNote"),
              note: <>{t("set.coreLanguageNote")} <a class="nav-link" href={formatRoute({ view: "settings", section: "appearance" })}>{t("set.section.appearance")}</a></>,
            },
          ]} /></Section>
        </>;
      case "connections":
        return <>
          <SettingsShare model={model} settingId={search("connections.share", "share.title", ["share.intro"]).settingId} />
          <Section settingId={search("connections.add", "setup.add", ["setup.intro"]).settingId} title={t("setup.open")} sub={t("setup.intro")}><div class="setup-actions"><a class="nav-link" href={formatRoute({ view: "setup" })} onClick={() => model.setup.beginAdd()}>{t("setup.add")}</a></div></Section>
          {canEdit && facts && !model.config.read.value.error ? connectionCards(model, search) : null}
        </>;
      case "compaction":
        return <Section title={t("set.compact.file")} sub={t("set.threadSettings")}><FactList missing={missing} facts={[
          fileFact("set.compact.autoAt", "compaction.auto_at_tokens", "set.compact.autoNote"),
          fileFact("set.compact.maxChars", "compaction.summary_max_chars"),
        ]} /></Section>;
      case "storage":
        return <Section title={t("set.store.file")} sub={t("set.store.see")} actions={<a class="nav-link" href={formatRoute({ view: "analytics", section: "storage" })}>{t("set.store.open")}</a>}><FactList missing={missing} facts={[
          fileFact("set.store.warnBytes", "limits.data_warning_bytes"),
          fileFact("set.store.maxBytes", "limits.data_max_bytes"),
          fileFact("set.store.freeBytes", "limits.disk_free_min_bytes"),
          fileFact("set.limit.attachment_file_bytes", "limits.attachment_file_bytes"),
          fileFact("set.limit.attachment_request_bytes", "limits.attachment_request_bytes"),
          fileFact("set.limit.shell_raw_bytes", "limits.shell_raw_bytes"),
          fileFact("set.limit.tool_excerpt_bytes", "limits.tool_excerpt_bytes"),
          fileFact("set.limit.shell_stdin_bytes", "limits.shell_stdin_bytes"),
          fileFact("set.limit.draft_bytes", "limits.draft_bytes"),
          fileFact("set.store.rawDays", "retention.tool_raw_days"),
          fileFact("set.store.rawBytes", "retention.tool_raw_bytes"),
          fileFact("set.store.clipDays", "retention.clipboard_days"),
          fileFact("set.store.clipBytes", "retention.clipboard_bytes"),
        ]} /></Section>;
      case "agent":
        rows.set(section, guideSearchRows(context));
        return <GuideRegistrationView context={context} />;
      case "appearance":
        rows.set(section, appearanceSearchRows(context));
        return <Section title={t("set.section.appearance")}><AppearanceChoices context={context} searchable /></Section>;
      case "studio":
        search("studio.startup", "studio.startup.open", ["studio.startup.hint"]);
        return <>
          <LoginStartup t={t} />
          <Section settingId={search("studio.pair", "pair.title", ["pair.help"]).settingId} title={t("pair.title")} sub={t("pair.help")}>
            {model.pairing.value.error ? <Notice tone="bad">{t("pair.error")}</Notice> : null}
            {!model.pairing.value.hosts.length ? <p>{t("pair.noHosts")}</p> : model.pairing.value.hosts.map(host => {
              const link = model.pairing.value.links[host];
              return <div key={host}><p><code>{host}</code></p>{link ? <><PairingQr value={link.url} label={t("pair.qr")} url={link.url} /><p>{t("pair.expires", { time: new Date(link.expires).toLocaleTimeString() })}</p><Button variant="ghost" onClick={() => void navigator.clipboard.writeText(link.url)}>{t("pair.copy")}</Button></> : null}<Button variant="ghost" onClick={() => void model.createPairing(host)}>{t(link ? "pair.reissue" : "pair.create")}</Button></div>;
            })}
          </Section>
          <Section settingId={search("studio.remote", "studio.remote", ["studio.remoteGuide"]).settingId} title={t("studio.remote")} sub={t("studio.remoteGuide")}><FactList missing={missing} facts={[{ ...search("studio.fact.listen", "studio.listen"), value: model.data.listen.value, mono: true }]} /><p><code>shellboy-studio guide user</code></p><p><code>shellboy-studio --allow-host HOSTNAME</code></p><p>{t("studio.hostGuide")}</p></Section>
          <Section settingId={search("studio.token", "studio.token", ["studio.tokenGuide"]).settingId} title={t("studio.token")}><p>{t("studio.tokenGuide")}</p></Section>
          <Section settingId={search("studio.info", "studio.info").settingId} title={t("studio.info")}><FactList missing={missing} facts={[{ ...search("studio.fact.apps", "studio.apps"), value: model.data.appsDir.value, mono: true }, { ...search("studio.fact.version", "studio.version"), value: model.data.bridgeVersion.value, mono: true }, { ...search("studio.fact.ownerVersion", "studio.ownerVersion") }]} /></Section>
        </>;
      case "index":
        return <>
        <Notice tone="wait">{t("set.index.cost")}</Notice>
        <Section title={t("set.embed.file")}><FactList missing={missing} facts={[
          ...(editable ? [{ ...search("embedding.model", "set.conn.model", ["set.embed.modelNote"]), note: t("set.embed.modelNote"), control: <ConnectionModelRow model={model} path={["embedding", "connection"]} modelPath={["embedding", "model"]} label={t("set.conn.model")} /> }] : [fileFact("set.models.defaultConn", "embedding.connection"), fileFact("set.conn.model", "embedding.model", "set.embed.modelNote")]),
        ]} /></Section>
        <Section title={t("set.section.index")}><FactList missing={missing} facts={[
          fileFact("set.embed.auto", "indexing.auto_history"),
          fileFact("set.index.kinds", "indexing.auto_kinds"),
        ]} /></Section>
        </>;
    }
  };
  const bodies = new Map(SETTINGS_SECTIONS.map((key) => [key, body(key)]));
  const groupFor = (s: SettingsSection) => s === "general" || s === "connections" ? t("set.group.start") : s === "compaction" || s === "index" || s === "agent" ? t("set.group.agent") : s === "appearance" ? t("set.group.display") : s === "storage" ? t("set.group.data") : t("set.group.app");
  return <SubView title={t("set.title")} close={{ href: formatRoute({ view: "conversation", threadId: model.selectedId.value }), label: t("common.close") }} groupedNav searchLabel={t("set.search")} items={SETTINGS_SECTIONS.map((s) => ({ key: s, href: formatRoute({ view: "settings", section: s }), role: ICONS[s], label: t(`set.section.${s}`), description: t(`set.sub.${s}`), searchTerms: (["en", "ja"] as const).flatMap((lang) => { const translate = translator(lang); return [translate(`set.section.${s}`), translate(`set.sub.${s}`)]; }), searchRows: rows.get(s), group: groupFor(s), current: s === section }))}>
    <PageHeader title={t(`set.section.${section}`)} description={t(`set.sub.${section}`)} />
    {section !== "studio" && section !== "agent" ? <ConfigPanel model={model} /> : null}
    {bodies.get(section)}
  </SubView>;
}
