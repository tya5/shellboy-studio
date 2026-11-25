import { RestartAfterSetup } from "./SetupParts";
import { useEffect, useRef, useState } from "preact/hooks";
import { CAPABILITY_CONFIG, formatRoute, showConfigValue, type AppModel, type MessageKey } from "../../../ui-core/src";
import { exportableSettings, settingsPreview, parseSharedSettings, SETTINGS_FILE_LIMIT, type ImportedSettings } from "../../../ui-core/src/settings-share";
import { Button } from "../system/components/Button";
import { Check } from "../system/components/Check";
import { FactList } from "../system/components/FactList";
import { Field } from "../system/components/Field";
import { Notice } from "../system/components/Notice";
import { Section } from "../system/components/Section";
import { SettingRow } from "../system/components/SettingRow";

type ShareProps = { model: AppModel; firstRun?: boolean; settingId?: string };

export function SettingsShare(props: ShareProps) {
  const owner = props.model.data.owner.value;
  return <ShareForm key={owner.state === "connected" ? owner.info.instance_id : owner.state} {...props} />;
}

function ShareForm({ model, firstRun = false, settingId }: ShareProps) {
  const t = model.t.value;
  const read = model.config.read.value;
  const facts = read.value;
  const [file, setFile] = useState<{ name: string; imported: ImportedSettings }>();
  const [error, setError] = useState<MessageKey>();
  const [omitted, setOmitted] = useState<string[]>([]);
  const [ack, setAck] = useState<string>();
  const [hash, setHash] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<readonly string[]>([]);
  const [open, setOpen] = useState(firstRun);
  const active = useRef(true);
  const pending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const supported = model.data.capabilities.value.includes(CAPABILITY_CONFIG);
  const ready = supported && model.connection.value === "connected" && !!facts?.file.valid && !!facts.file.contentHash && !read.error && !read.loading;
  const plan = file && facts ? settingsPreview(file.imported, facts) : undefined;
  const warningIdentity = plan?.warnings.length ? JSON.stringify([plan.hash, plan.changes, plan.warnings]) : undefined;
  const needsConfirmation = !!warningIdentity && ack !== warningIdentity;
  const confirmed = !!hash && ready && facts?.file.contentHash === hash;
  const values = facts?.file.values;
  const defaultConnection = typeof values?.default_connection === "string" ? values.default_connection : undefined;
  const defaultModel = typeof values?.default_model === "string" ? values.default_model : undefined;
  const defaultSource = defaultConnection ? facts?.file.credentialSource?.[defaultConnection] : undefined;
  const keys = file ? [...file.imported.connections.keys()] : [];
  const next = confirmed ? [
    ...keys.filter(name => name === defaultConnection),
    ...keys.filter(name => name !== defaultConnection),
  ].find(name => {
    const source = facts?.file.credentialSource?.[name];
    return source !== "env" && source !== "stored" && !skipped.includes(name);
  }) : undefined;
  const restart = hash && model.config.lastSaved.value?.hash === hash && model.config.lastSaved.value.restartRequired;
  const invalidated = hash && !confirmed && !model.config.fieldSaving.value && !read.loading;
  const locked = busy || model.config.fieldSaving.value;
  const run = async (work: () => Promise<void>, failed: MessageKey = "share.failed") => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(undefined);
    try { await work(); }
    catch { if (active.current) setError(failed); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const reset = () => { setFile(undefined); setHash(undefined); setError(undefined); setSkipped([]); setAck(undefined); };
  const readFile = (picked?: File) => {
    if (!picked || locked || !ready || !open || pending.current) return;
    reset();
    void run(async () => {
      if (picked.size > SETTINGS_FILE_LIMIT) throw new Error();
      const imported = parseSharedSettings(await picked.text());
      if (active.current) setFile({ name: picked.name, imported });
    }, "share.invalid");
  };
  const download = () => {
    if (!ready || !facts) return;
    try {
      setOmitted([]);
      setError(undefined);
      const { text: body, omitted } = exportableSettings(facts);
      if (new Blob([body]).size > SETTINGS_FILE_LIMIT) throw new Error();
      const url = URL.createObjectURL(new Blob([body], { type: "application/toml;charset=utf-8" }));
      try {
        const link = document.createElement("a");
        link.href = url; link.download = "shellboy-settings.toml"; link.click(); setOmitted(omitted);
      } finally { URL.revokeObjectURL(url); }
    } catch { setError("share.failed"); }
  };
  const apply = () => {
    if (!ready || !plan || needsConfirmation || locked || hash) return;
    void run(async () => {
      const saved = plan.changes.length ? await model.config.applyChanges(plan.hash, plan.changes.map(({ field, value }) => value === undefined ? { field } : { field, value })) : plan.hash;
      if (!saved) throw new Error();
      if (active.current) setHash(saved);
    });
  };
  const saveKey = (input: HTMLInputElement | null) => {
    if (!next || !input?.value || locked || !hash || pending.current || model.config.read.peek().value?.file.contentHash !== hash) return;
    const value = input.value;
    input.value = "";
    void run(async () => {
      const result = await model.ops.credentialsSet(next, value);
      if (!result.ok || result.value.stored !== true) throw new Error();
      if (active.current) {
        // Credential writes do not necessarily emit a config hint. Re-read the owner's key sources once.
        model.config.configChanged();
      }
    });
  };
  const pick = <div onDragOver={event => event.preventDefault()} onDrop={event => {
    event.preventDefault();
    if (event.dataTransfer?.files.length === 1) readFile(event.dataTransfer.files[0]);
  }}><Field label={t("share.choose")} help={t("share.drop")} type="file" accept=".toml,application/toml,text/plain" disabled={!ready || locked} onChange={event => {
    const input = event.currentTarget;
    readFile(input.files?.[0]); input.value = "";
  }} /></div>;
  const transitions = (changes: readonly { field: string; before: unknown; value?: unknown }[]) => changes.map(({ field, before, value }) => ({
    label: field, mono: true, value: `${showConfigValue(before) ?? t("share.unset")} → ${showConfigValue(value) ?? t("share.unset")}`,
  }));
  return <Section title={t("share.title")} sub={file && !hash ? t("share.preview", { name: file.name }) : t("share.intro")} {...(settingId ? { settingId } : {})}>
    {!firstRun ? <>
      <SettingRow label={t("share.export")} read={t("share.portable")} control={<Button variant="ghost" disabled={!ready || locked} onClick={download}>{t("share.export")}</Button>} />
      <SettingRow label={t("share.importAction")} read={file?.name ?? t("share.noFile")} control={<Button variant="ghost" aria-expanded={open} disabled={locked} onClick={() => { if (open) reset(); setOpen(!open); }}>{t("threadSettings.change")}</Button>} />
    </> : null}
    {!supported ? <Notice tone="wait">{t("config.readonlyError")}</Notice> : null}
    {error ? <Notice tone="bad">{t(error)}</Notice> : null}
    {omitted.length ? <Notice tone="wait">{t("share.omitted", { names: omitted.join(", ") })}</Notice> : null}
    {open && !file ? pick : null}
    {open && plan && file ? <>
      {!hash ? <>
        <FactList missing={t("share.unset")} facts={[
          ...plan.added.map(name => ({ label: name, value: t("share.added") })),
          ...plan.replaced.map(name => ({ label: name, value: t("share.replaced") })),
          ...transitions(plan.changes),
        ]} />
        {plan.warnings.map(warning => <div class="stack" key={warning.name}>
          <Notice tone="wait">{t(warning.source === "stored" ? "share.savedKeyRoute" : "share.otherKeyRoute", { name: warning.name, url: warning.url })}</Notice>
          <FactList missing={t("share.unset")} facts={transitions(warning.routing.map(row => ({ ...row, field: `${warning.name}.${row.field}` })))} />
        </div>)}
        {warningIdentity ? <Check checked={!needsConfirmation} onChange={checked => setAck(checked ? warningIdentity : undefined)}>{t("share.confirmRouting")}</Check> : null}
        <div class="setup-actions"><Button variant="primary" disabled={!ready || locked || needsConfirmation} onClick={apply}>{t("share.apply")}</Button><Button variant="ghost" disabled={locked} onClick={reset}>{t("share.cancel")}</Button></div>
      </> : null}
      {hash && !confirmed ? invalidated ? <Notice tone="wait">{t("share.changed")}</Notice> : <Notice>{t("share.applying")}</Notice> : null}
      {restart && confirmed && !next ? <RestartAfterSetup model={model} /> : null}
      {next ? <form class="setup-key-step" key={next} onSubmit={event => {
        event.preventDefault();
        saveKey(event.currentTarget.querySelector('input[type="password"]'));
      }}>
        <Field label={t("share.keyLabel", { name: next })} help={t("share.keyNote")} type="password" autoComplete="new-password" required disabled={locked} />
        <div class="setup-actions"><Button type="submit" variant="primary" disabled={locked}>{t("share.saveKey")}</Button><Button variant="ghost" disabled={locked} onClick={() => setSkipped([...skipped, next])}>{t("share.skipKey")}</Button></div>
      </form> : null}
      {confirmed && !next ? <><Notice actions={defaultConnection && skipped.includes(defaultConnection) ? <Button onClick={() => setSkipped(skipped.filter(name => name !== defaultConnection))}>{t("share.enterKey")}</Button> : undefined}>
        {t("share.done")}
        {firstRun ? <div>{t("share.firstDefault", { connection: defaultConnection ?? t("share.unset"), model: defaultModel ?? t("share.unset") })}</div> : null}
        {firstRun && defaultConnection ? <div>{t(defaultSource === "env" || defaultSource === "stored" ? "share.keyAvailable" : skipped.includes(defaultConnection) ? "share.keySkipped" : "share.keyUnconfirmed")}</div> : null}
      </Notice>{firstRun ? <a class="nav-link" href={formatRoute({ view: "conversation" })} onClick={() => model.setup.takeAutoShow()}>{t("share.start")}</a> : null}</> : null}
      {hash && (invalidated || (confirmed && !next)) ? <Button variant="ghost" disabled={locked} onClick={reset}>{t("share.cancel")}</Button> : null}
    </> : null}
  </Section>;
}
