import { useEffect, useRef, useState } from "preact/hooks";
import { CAPABILITY_CONFIG, formatRoute, showConfigValue, type AppModel, type MessageKey } from "../../../ui-core/src";
import { exportableSettings, settingsPreview, parseSharedSettings, SETTINGS_FILE_LIMIT, type ImportedSettings } from "../../../ui-core/src/settings-share";
import { Button, Field, Notice, Section, SettingRow } from "../system/components";

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
  const confirmed = !!hash && ready && facts?.file.contentHash === hash;
  const next = confirmed && file ? [...file.imported.connections.keys()].find(name => {
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
  const reset = () => { setFile(undefined); setHash(undefined); setError(undefined); setSkipped([]); };
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
      const body = exportableSettings(facts);
      if (new Blob([body]).size > SETTINGS_FILE_LIMIT) throw new Error();
      const url = URL.createObjectURL(new Blob([body], { type: "application/toml;charset=utf-8" }));
      try {
        const link = document.createElement("a");
        link.href = url; link.download = "shellboy-settings.toml"; link.click();
      } finally { URL.revokeObjectURL(url); }
    } catch { setError("share.failed"); }
  };
  const apply = () => {
    if (!ready || !plan || plan.blocked.length || locked || hash) return;
    void run(async () => {
      const saved = plan.changes.length ? await model.config.applyChanges(plan.hash, plan.changes) : plan.hash;
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
  return <Section title={t("share.title")} sub={t("share.intro")} {...(settingId ? { settingId } : {})}>
    {!firstRun ? <>
      <SettingRow label={t("share.export")} read={t("share.portable")} control={<Button variant="ghost" disabled={!ready || locked} onClick={download}>{t("share.export")}</Button>} />
      <SettingRow label={t("share.importAction")} read={file?.name ?? t("share.noFile")} control={<Button variant="ghost" aria-expanded={open} disabled={locked} onClick={() => { if (open) reset(); setOpen(!open); }}>{t("threadSettings.change")}</Button>} />
    </> : null}
    {!supported ? <Notice tone="wait">{t("config.readonlyError")}</Notice> : null}
    {error ? <Notice tone="bad">{t(error)}</Notice> : null}
    {open && !file ? pick : null}
    {open && plan && file ? <>
      {!hash ? <>
        <p>{t("share.preview", { name: file.name })}</p>
        <ul>
          {plan.added.map(name => <li key={name}>{t("share.added", { names: name })} — {showConfigValue(file.imported.connections.get(name)?.get("base_url"))}</li>)}
          {plan.replaced.map(name => <li key={name}>{t("share.replaced", { names: name })} — {showConfigValue(file.imported.connections.get(name)?.get("base_url"))}</li>)}
          {plan.defaults.map(({ field, before, value }) => <li key={field}><code>{field}</code>: {showConfigValue(before) ?? "—"} → {showConfigValue(value)}</li>)}
        </ul>
        {plan.blocked.length ? <Notice tone="bad">{t("share.blocked", { names: plan.blocked.join(", ") })}</Notice> : null}
        <div class="setup-actions"><Button variant="primary" disabled={!ready || locked || !!plan.blocked.length} onClick={apply}>{t("share.apply")}</Button><Button variant="ghost" disabled={locked} onClick={reset}>{t("share.cancel")}</Button></div>
      </> : null}
      {hash && !confirmed ? invalidated ? <Notice tone="wait">{t("share.changed")}</Notice> : <Notice>{t("share.applying")}</Notice> : null}
      {restart ? <Notice tone="wait">{t("share.restart")}</Notice> : null}
      {next ? <form key={next} onSubmit={event => { event.preventDefault(); saveKey(event.currentTarget.querySelector('input[type="password"]')); }}>
        <Field label={t("share.keyLabel", { name: next })} help={t("share.keyNote")} type="password" autoComplete="new-password" required disabled={locked} />
        <div class="setup-actions"><Button type="submit" variant="primary" disabled={locked}>{t("share.saveKey")}</Button><Button variant="ghost" disabled={locked} onClick={() => { setSkipped([...skipped, next]); }}>{t("share.skipKey")}</Button></div>
      </form> : null}
      {confirmed && !next ? <><Notice>{t("share.done")}</Notice>{firstRun ? <a class="nav-link" href={formatRoute({ view: "conversation" })} onClick={() => model.setup.takeAutoShow()}>{t("share.start")}</a> : null}</> : null}
      {hash && (invalidated || (confirmed && !next)) ? <Button variant="ghost" disabled={locked} onClick={reset}>{t("share.cancel")}</Button> : null}
    </> : null}
  </Section>;
}
