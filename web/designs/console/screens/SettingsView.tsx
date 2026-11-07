import { formatBytes, formatRoute, formatTokens, settingsSection, SETTINGS_SECTIONS, type ConfigKey, type DesignContext, type SettingsSection } from "../../../ui-core/src";
import { Button, FactList, Notice, Section, SubView, type Fact, type IconName } from "../system/components";
import { AppearanceChoices } from "./Appearance";
import { Rich } from "./Rich";

const ICONS: Record<SettingsSection, IconName> = { connections: "plug", models: "cube", embeddings: "database", shell: "term", storage: "file", compaction: "retry", appearance: "palette" };

const num = (n: number): string => n.toLocaleString("en-US");
/**
 * Where editing attaches. `config.get` and `config.set` are planned in core (#266) and their wire isn't
 * known yet, so nothing here assumes it. When they exist, this returns a control for a key the owner can
 * set, and rows from `fileFact` become editable without changing their layout.
 */
const configControl = (_key: ConfigKey): Fact["control"] => undefined;

const fileFact = (label: string, key: ConfigKey, note?: Fact["note"]): Fact => ({ label, control: configControl(key), ...(note !== undefined ? { note } : {}) });

export function SettingsView({ context }: { context: DesignContext }) {
  const model = context.model;
  const t = model.t.value;
  const route = model.route.value;
  const section = settingsSection(route);
  const i = model.insights;
  const selected = model.selectedRow.value;
  const thread = i.thread.value;
  const settings = thread.value;
  const threadSub = selected ? t("set.thread", { title: selected.summary.title }) : t("set.noThread");
  const threadError = thread.error ? <Notice tone="bad">{t("common.readError", { message: thread.error.message })}</Notice> : null;
  const missing = t("common.notReadable");
  const catalog = i.catalog.value;
  const index = i.index.value;
  const storage = i.storage.value;
  const memory = i.memory.value;
  const receipts = i.receipts.value;

  const body = () => {
    switch (section) {
      case "connections":
        return (
          <>
            <Section title={t("set.conn.inUse")} sub={threadSub} source={<>{t("common.source", { source: "" })}<code>thread.get</code></>}>
              {threadError}
              <FactList missing={missing} facts={[
                { label: t("set.conn.name"), value: settings?.connection, mono: true },
                { label: t("set.conn.model"), value: settings?.model, mono: true },
              ]} />
            </Section>
            <Section
              title={t("set.conn.catalog")}
              sub={t("set.conn.catalogSub")}
              actions={<Button disabled={catalog.loading} onClick={() => void i.readCatalog()}>{catalog.loading ? t("common.loading") : t("set.conn.readCatalog")}</Button>}
              source={<>{t("common.source", { source: "" })}<code>model.list</code></>}
            >
              {catalog.error ? <Notice tone="bad">{t("common.readError", { message: catalog.error.message })}</Notice> : null}
              {catalog.value ? (
                <FactList missing={missing} facts={[
                  { label: t("set.conn.name"), value: catalog.value.connection, mono: true },
                  { label: t("set.conn.api"), value: catalog.value.api, mono: true },
                  { label: t("set.conn.models"), value: t("set.conn.modelsCount", { n: catalog.value.models.length }), note: catalog.value.models.slice(0, 40).join(", ") },
                  { label: t("set.conn.unavailable"), value: catalog.value.unavailable_features?.length ? catalog.value.unavailable_features.join(", ") : t("set.conn.unavailableNone"), mono: !!catalog.value.unavailable_features?.length },
                ]} />
              ) : null}
            </Section>
            <Section title={t("set.conn.file")} sub={<Rich text={t("set.conn.fileSub")} />}>
              <FactList missing={missing} facts={[
                fileFact(t("set.conn.url"), "connections.base_url"),
                fileFact(t("set.conn.keyEnv"), "connections.api_key_env", t("set.conn.keyNote")),
                fileFact(t("set.conn.tls"), "connections.ssl_verify"),
                fileFact(t("set.conn.timeouts"), "connections.timeouts"),
              ]} />
            </Section>
          </>
        );
      case "models":
        return (
          <>
            <Section title={t("set.conn.inUse")} sub={threadSub} source={<>{t("common.source", { source: "" })}<code>thread.get</code></>}>
              {threadError}
              <FactList missing={missing} facts={[
                { label: t("set.conn.name"), value: settings?.connection, mono: true },
                { label: t("set.conn.model"), value: settings?.model, mono: true },
                { label: t("set.conn.effort"), value: settings ? (settings.effort ?? t("set.conn.effortUnset")) : undefined, mono: settings?.effort !== undefined },
              ]} />
            </Section>
            <Section title={t("set.models.defaults")} sub={t("set.models.defaultsSub")}>
              <FactList missing={missing} facts={[fileFact(t("set.models.defaultConn"), "default_connection"), fileFact(t("set.models.defaultModel"), "default_model"), fileFact(t("set.models.defaultEffort"), "connections.default_effort")]} />
            </Section>
          </>
        );
      case "embeddings":
        return (
          <>
            <Section title={t("set.embed.state")} source={<>{t("common.source", { source: "" })}<code>index.status</code></>}>
              {index.error ? <Notice tone="bad">{t("common.readError", { message: index.error.message })}</Notice> : null}
              {index.value ? (
                <FactList missing={missing} facts={[
                  { label: t("set.embed.auto"), value: t(index.value.autoHistory ? "set.embed.on" : "set.embed.off") },
                  { label: t("set.embed.state"), value: t(index.value.paused ? "set.embed.paused" : "set.embed.running") },
                  { label: t("set.embed.counts"), value: t("res.indexCounts", { pending: index.value.pending ?? 0, running: index.value.running ?? 0, done: index.value.done ?? 0, failed: index.value.failed ?? 0, held: index.value.held ?? 0 }) },
                  ...(index.value.reason ? [{ label: t("set.embed.reason"), value: index.value.reason }] : []),
                  ...index.value.spaces.map((s) => ({ label: `${t("res.spaces")}: ${s.id.slice(0, 8)}`, value: `${s.connection ?? ""} / ${s.model ?? ""}`, mono: true, note: `${s.dimension ?? ""} ${t("res.space.dimension")}, ${s.segments ?? ""} ${t("res.space.segments")}${s.selected ? `, ${t("res.space.selected")}` : ""}` })),
                ]} />
              ) : null}
            </Section>
            <Section title={t("set.embed.file")} sub={t("set.models.defaultsSub")}>
              <FactList missing={missing} facts={[fileFact(t("set.embed.batchInputs"), "embedding.batch_max_inputs"), fileFact(t("set.embed.batchChars"), "embedding.batch_max_chars"), fileFact(t("set.embed.split"), "indexing.split_chars"), fileFact(t("set.embed.concurrency"), "indexing.concurrency")]} />
            </Section>
          </>
        );
      case "shell":
        return (
          <>
            <Section title={t("set.shell.cwd")} sub={threadSub} source={<>{t("common.source", { source: "" })}<code>thread.get</code></>}>
              {threadError}
              <FactList missing={missing} facts={[
                { label: t("set.shell.cwd"), value: settings?.cwd, mono: true },
                { label: t("set.shell.agents"), value: settings?.agentsPath, mono: true },
              ]} />
            </Section>
            <Section title={t("set.shell.file")} sub={t("set.models.defaultsSub")}>
              <FactList missing={missing} facts={[
                fileFact(t("set.shell.kind"), "shell.kind"),
                fileFact(t("set.shell.exe"), "shell.executable"),
                fileFact(t("set.shell.env"), "shell.env", t("set.shell.envNote")),
              ]} />
            </Section>
          </>
        );
      case "storage":
        return (
          <>
            <Section title={t("set.store.state")} sub={t("set.store.see")} actions={<a class="btn" href={formatRoute({ view: "analytics", section: "storage" })}>{t("set.store.open")}</a>} source={<>{t("common.source", { source: "" })}<code>storage.status</code>, <code>status --memory</code>, <code>status</code></>}>
              {storage.error ? <Notice tone="bad">{t("common.readError", { message: storage.error.message })}</Notice> : null}
              <FactList missing={missing} facts={[
                { label: t("set.store.warning"), ...(storage.value ? { value: t(storage.value.warning ? "set.store.reached" : "set.store.notReached") } : {}) },
                { label: t("set.store.limit"), ...(storage.value ? { value: t(storage.value.limitReached ? "set.store.reached" : "set.store.notReached") } : {}) },
                ...(memory.value?.caches ?? []).map((c) => ({ label: `${t("set.store.budgets")}: ${t(`res.cache.${c.name}` as "res.cache.body")}`, ...(c.limit !== undefined ? { value: formatBytes(c.limit), mono: true } : {}) })),
                { label: t("set.store.receipts"), ...(receipts.value?.limit !== undefined ? { value: formatBytes(receipts.value.limit), mono: true } : {}) },
                { label: t("set.store.retention"), ...(receipts.value?.retentionSeconds !== undefined ? { value: t("set.store.hours", { n: receipts.value.retentionSeconds / 3600 }) } : {}) },
              ]} />
            </Section>
            <Section title={t("set.store.file")} sub={t("set.models.defaultsSub")}>
              <FactList missing={missing} facts={[
                fileFact(t("set.store.warnBytes"), "limits.data_warning_bytes"),
                fileFact(t("set.store.maxBytes"), "limits.data_max_bytes"),
                fileFact(t("set.store.rawDays"), "retention.tool_raw_days"),
                fileFact(t("set.store.rawBytes"), "retention.tool_raw_bytes"),
                fileFact(t("set.store.clipDays"), "retention.clipboard_days"),
                fileFact(t("set.store.clipBytes"), "retention.clipboard_bytes"),
              ]} />
            </Section>
          </>
        );
      case "compaction":
        return (
          <>
            <Section title={t("set.compact.thread")} sub={<>{threadSub} <Rich text={t("set.compact.threadSub")} /></>} source={<>{t("common.source", { source: "" })}<code>thread.get</code></>}>
              {threadError}
              <FactList missing={missing} facts={[
                {
                  label: t("set.compact.autoAt"),
                  ...(settings?.effectiveAutoCompactAt !== undefined ? { value: settings.effectiveAutoCompactAt === 0 ? t("set.compact.autoOff") : t("set.compact.tokens", { n: formatTokens(settings.effectiveAutoCompactAt) }), note: <Rich text={t(settings.autoCompactAt !== undefined ? "set.compact.own" : "set.compact.inherited")} /> } : {}),
                },
                {
                  label: t("set.compact.segment"),
                  ...(settings?.effectiveSegmentChars !== undefined ? { value: num(settings.effectiveSegmentChars), mono: true, note: <Rich text={t(settings.segmentChars !== undefined ? "set.compact.own" : "set.compact.inherited")} /> } : {}),
                },
                {
                  label: t("set.compact.rounds"),
                  ...(settings?.effectiveReduceRounds !== undefined ? { value: num(settings.effectiveReduceRounds), mono: true, note: <Rich text={t(settings.reduceRounds !== undefined ? "set.compact.own" : "set.compact.inherited")} /> } : {}),
                },
              ]} />
            </Section>
            <Section title={t("set.compact.file")} sub={t("set.models.defaultsSub")}>
              <FactList missing={missing} facts={[fileFact(t("set.compact.autoAt"), "compaction.auto_at_tokens"), fileFact(t("set.compact.segment"), "compaction.segment_chars"), fileFact(t("set.compact.rounds"), "compaction.reduce_rounds")]} />
            </Section>
          </>
        );
      case "appearance":
        return (
          <Section title={t("set.section.appearance")} sub={t("set.sub.appearance")}>
            <div class="stack">
              <AppearanceChoices context={context} />
            </div>
          </Section>
        );
    }
  };

  return (
    <SubView
      title={t("set.title")}
      items={SETTINGS_SECTIONS.map((s) => ({ key: s, href: formatRoute({ view: "settings", section: s }), icon: ICONS[s], label: t(`set.section.${s}`), current: s === section }))}
      onSelect={(key) => model.navigate({ view: "settings", section: key as SettingsSection })}
    >
      <div class="pagehead">
        <h1>{t(`set.section.${section}`)}</h1>
        <div class="muted">{t(`set.sub.${section}`)}</div>
      </div>
      {section !== "appearance" ? <Notice><Rich text={t("set.readOnly")} /></Notice> : null}
      {body()}
    </SubView>
  );
}
