import { useState } from "preact/hooks";
import { CAPABILITY_CONFIG, CONNECTION_FIELDS, CONNECTION_SECRETS, fieldOf, isHidden, isHiddenName, showConfigValue, valueAt, type AppModel, type ConfigChangeRow, type ConfigFacts, type ConfigFieldSpec, type Draft } from "../../../ui-core/src";
import { Button, ButtonGroup, FactList, Field, Notice, Section, type Fact } from "../system/components";
import { Rich } from "./Rich";

type T = AppModel["t"]["value"];

/** A row's value when it can't be edited. Hidden values stay words. */
export function configRowValue(t: T, facts: ConfigFacts, path: readonly string[]): string | undefined {
  const values = facts.file.values ?? facts.loaded.values;
  if (!values) return undefined;
  const v = valueAt(values, path);
  if (isHidden(v)) return t("config.hiddenValue");
  if (v === undefined || v === null) return t("config.notSet");
  return showConfigValue(v);
}

function DraftNote({ model, draft, t }: { model: AppModel; draft: Draft | undefined; t: T }) {
  if (!draft) return null;
  if (draft.invalid) return <Notice tone="bad">{t(draft.invalid === "number" ? "config.badNumber" : draft.invalid === "json" ? "config.badJson" : "config.badPlaceholder")}</Notice>;
  return (
    <div class="band">
      <span class="muted caption">{t(draft.value === undefined ? "config.willRemove" : "config.changed")}</span>
      <Button variant="link" onClick={() => model.config.undo(draft.field)}>{t("config.undo")}</Button>
    </div>
  );
}

/** What the running owner has, when the file says something else. */
function RunningNote({ model, path, t }: { model: AppModel; path: readonly string[]; t: T }) {
  const facts = model.config.read.value.value;
  if (!facts?.differing?.includes(fieldOf(path))) return null;
  const loaded = valueAt(facts.loaded.values, path);
  if (isHidden(loaded)) return <div class="muted caption">{t("config.runningHidden")}</div>;
  return <div class="muted caption">{t("config.runningWith", { value: loaded === undefined || loaded === null ? t("config.notSet") : showConfigValue(loaded) })}</div>;
}

/** A hidden value: words, and a way to replace it without ever seeing or sending it back. */
function HiddenControl({ model, path, label, json, t, name, onRemove }: { model: AppModel; path: readonly string[]; label: string; json: boolean; t: T; name?: string; onRemove?: () => void }) {
  const [replacing, setReplacing] = useState(false);
  const [raw, setRaw] = useState("");
  const field = fieldOf(path);
  const config = model.config;
  const error = config.fieldError.value?.field === field ? config.fieldError.value.reason : undefined;
  const busy = config.fieldSaving.value;
  const save = () => {
    if (!raw || busy) return;
    void config.saveField(path, raw, json ? "secret-json" : "secret");
    setRaw(""); setReplacing(false);
  };
  return <div class="stack"><div class="band">{name ? <code>{name}</code> : null}<span>{t("config.hiddenValue")}</span>{!replacing ? <Button variant="link" onClick={() => setReplacing(true)}>{t("config.replace")}</Button> : null}{onRemove ? <Button variant="link" disabled={busy} onClick={onRemove}>{t("config.remove")}</Button> : null}</div>{replacing ? <Field ariaLabel={t("config.newValue") + ": " + label} type="password" autoComplete="new-password" placeholder={json ? t("config.enterJson") : t("config.newValue")} value={raw} disabled={busy} onInput={(e) => setRaw(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} onBlur={save} /> : null}{error ? <Notice tone="bad">{error}</Notice> : null}</div>;
}

/** The typed control for one key of the file. */
export function ConfigControl({ model, path, label, spec }: { model: AppModel; path: readonly string[]; label: string; spec: ConfigFieldSpec }) {
  const t = model.t.value;
  const config = model.config;
  const facts = config.read.value.value;
  const field = fieldOf(path);
  const current = valueAt(facts?.file.values, path);
  const saving = config.fieldSaving.value;
  const error = config.fieldError.value?.field === field ? config.fieldError.value.reason : undefined;
  const saved = config.lastSaved.value?.field === field ? config.lastSaved.value : undefined;
  const commit = (raw: string) => { if (!saving) void config.saveField(path, raw, spec.kind); };
  const disabled = saving || !facts?.file.valid;
  let control;
  if (spec.kind === "bool") control = <ButtonGroup label={label}><Button disabled={disabled} aria-pressed={current === true} onClick={() => commit("true")}>{t("config.on")}</Button><Button disabled={disabled} aria-pressed={current === false} onClick={() => commit("false")}>{t("config.off")}</Button></ButtonGroup>;
  else if (spec.kind === "choice") {
    const options = spec.options ?? Object.keys((facts?.file.values?.connections as Record<string, unknown> | undefined) ?? {});
    control = <ButtonGroup label={label}>{options.map((option) => <Button key={option} disabled={disabled} aria-pressed={current === option} onClick={() => commit(option)}>{option}</Button>)}</ButtonGroup>;
  } else if (spec.kind === "kinds") {
    const kinds = ["user", "summary", "assistant_response", "tool_result", "spill", "event"] as const;
    const selected = Array.isArray(current) ? current.filter((v): v is string => typeof v === "string") : [];
    control = <ButtonGroup label={label}>{kinds.map((kind) => <Button key={kind} disabled={disabled} aria-pressed={selected.includes(kind)} onClick={() => commit((selected.includes(kind) ? selected.filter((v) => v !== kind) : [...selected, kind]).join(","))}>{t(`set.kind.${kind}`)}</Button>)}</ButtonGroup>;
  } else {
    const raw = current === undefined || current === null ? "" : showConfigValue(current);
    control = <Field ariaLabel={label} class="mono" inputMode={spec.kind === "int" ? "numeric" : undefined} placeholder={t("config.notSet")} value={raw} disabled={disabled} onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); }} onBlur={(e) => { if (e.currentTarget.value !== raw) commit(e.currentTarget.value); }} />;
  }
  const status = error ? <span role="status">{error}</span> : <>{saved ? <>{saved.restartRequired ? t("config.restartOwner") : t("config.applyNow")} <Button variant="link" onClick={() => void config.undoLast()}>{t("config.undo")}</Button></> : facts?.restartAll ? t("config.restartOwner") : t("config.applyNow")}</>;
  return <div class="stack">{control}<div class="muted caption" role={error ? "alert" : undefined}>{status}</div></div>;
}

/** Entries whose values the owner hides: names, "set, hidden", replace, remove, add. */
export function SecretEntries({ model, path, label, json }: { model: AppModel; path: readonly string[]; label: string; json: boolean }) {
  const t = model.t.value;
  const facts = model.config.read.value.value;
  const values = facts?.file.values ?? facts?.loaded.values;
  const held = valueAt(values, path) as Record<string, unknown> | undefined;
  const names = Object.keys(held ?? {});
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  return <div class="stack">{names.length === 0 ? <span class="muted">{t("config.noEntries")}</span> : null}{names.map((entryName) => {
    const entry = [...path, entryName];
    if (isHiddenName(entryName)) return <div key={entryName}><code>{entryName}</code><div class="muted caption">{t("config.hiddenName")}</div></div>;
    return <HiddenControl key={entryName} model={model} path={entry} label={`${label}: ${entryName}`} json={json} t={t} name={entryName} onRemove={() => void model.config.removeField(entry)} />;
  })}{adding ? <div class="stack"><Field ariaLabel={`${label}: ${t("config.addName")}`} placeholder={t("config.addName")} value={name} onInput={(e) => setName(e.currentTarget.value)} />{name.trim() ? <HiddenAdd model={model} path={[...path, name.trim()]} label={label} json={json} t={t} onSaved={() => { setAdding(false); setName(""); }} /> : null}<Button variant="link" onClick={() => { setAdding(false); setName(""); }}>{t("common.close")}</Button></div> : <Button variant="link" onClick={() => setAdding(true)}>{t("config.add")}</Button>}</div>;
}

function HiddenAdd({ model, path, label, json, t, onSaved }: { model: AppModel; path: readonly string[]; label: string; json: boolean; t: T; onSaved: () => void }) {
  const [raw, setRaw] = useState("");
  const field = fieldOf(path);
  const error = model.config.fieldError.value?.field === field ? model.config.fieldError.value.reason : undefined;
  const save = () => { if (!raw) return; void model.config.saveField(path, raw, json ? "secret-json" : "secret"); onSaved(); };
  return <><Field ariaLabel={`${label}: ${t("config.newValue")}`} type="password" autoComplete="new-password" placeholder={json ? t("config.enterJson") : t("config.newValue")} value={raw} onInput={(e) => setRaw(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} onBlur={save} />{error ? <Notice tone="bad">{error}</Notice> : null}</>;
}

/** One connection/model choice; catalog requests happen only after the user asks. */
export function ConnectionModelRow({ model, path, modelPath = ["default_model"], label }: { model: AppModel; path: readonly string[]; modelPath?: readonly string[]; label: string }) {
  const t = model.t.value;
  const facts = model.config.read.value.value;
  const values = facts?.file.values;
  const connections = values?.connections as Record<string, Record<string, unknown>> | undefined;
  const choices = Object.keys(connections ?? {});
  const connectionPath = path;
  const [connection, setConnection] = useState(String(valueAt(values, connectionPath) ?? choices[0] ?? ""));
  const [modelName, setModelName] = useState(String(valueAt(values, modelPath) ?? ""));
  const [catalog, setCatalog] = useState<string[]>([]);
  const [catalogError, setCatalogError] = useState<string | undefined>();
  const [catalogBusy, setCatalogBusy] = useState(false);
  const field = fieldOf(connectionPath);
  const error = model.config.fieldError.value?.field === field || model.config.fieldError.value?.field === fieldOf(modelPath) ? model.config.fieldError.value.reason : undefined;
  const changed = connection !== String(valueAt(values, connectionPath) ?? "") || modelName !== String(valueAt(values, modelPath) ?? "");
  const fetchModels = async () => {
    setCatalogBusy(true);
    const out = await model.ops.modelList({ connection });
    setCatalogBusy(false);
    if (out.ok) { setCatalog(out.value.models); setCatalogError(undefined); }
    else setCatalogError(out.error.message);
  };
  const save = async () => {
    if (!connection || !modelName || model.config.fieldSaving.peek()) return;
    await model.config.saveField(connectionPath, connection, "text");
    if (!model.config.fieldError.peek()) {
      void model.config.saveField(modelPath, modelName, "text");
    }
  };
  const selectConnection = (next: string) => { setConnection(next); setCatalog([]); setCatalogError(undefined); };
  return <div class="stack"><div class="fieldrow"><Field as="select" ariaLabel={t("set.models.defaultConn")} value={connection} options={choices.map((item) => ({ value: item, label: item }))} onSelectChange={selectConnection} /><Button disabled={!connection || catalogBusy} onClick={() => void fetchModels()}>{catalogBusy ? t("common.loading") : t("set.conn.catalog")}</Button></div><div class="fieldrow"><Field ariaLabel={t("set.models.defaultModel")} placeholder={t("set.models.defaultModel")} value={modelName} onInput={(event) => setModelName(event.currentTarget.value)} /><Button disabled={!changed || model.config.fieldSaving.value || !modelName} onClick={() => void save()}>{t("config.applyNow")}</Button></div>{catalog.length ? <Field as="select" ariaLabel={t("set.conn.catalog")} value={modelName} options={catalog.map((item) => ({ value: item, label: item }))} onSelectChange={setModelName} /> : null}{catalogError ? <Notice tone="bad">{catalogError}</Notice> : null}{error ? <Notice tone="bad">{error}</Notice> : null}<div class="muted caption">{error ?? (facts?.restartAll ? t("config.restartOwner") : t("config.applyNow"))} {model.config.lastSaved.value?.field === fieldOf(modelPath) ? <Button variant="link" onClick={() => void model.config.undoLast()}>{t("config.undo")}</Button> : null}</div></div>;
}

/** One section per connection in the file. */
export function ConfigConnections({ model }: { model: AppModel }) {
  const t = model.t.value;
  const facts = model.config.read.value.value;
  if (!facts) return null;
  const values = facts.file.values ?? facts.loaded.values;
  const names = Object.keys((values?.connections as Record<string, unknown> | undefined) ?? {});
  if (names.length === 0) return <Notice>{t("config.noConnections")}</Notice>;
  const editable = facts.file.valid;
  return (
    <>
      {names.map((name) => {
        const rows: Fact[] = CONNECTION_FIELDS.map((field) => {
          const { key, kind } = field;
          const path = ["connections", name, key];
          const label = t(`config.conn.${key}`);
          const env = key === "api_key_env" ? valueAt(values, path) : undefined;
          const note = key === "api_key_env" ? <>{t("config.keyNote")} {typeof env === "string" && facts.credentialSet[env] !== undefined ? t(facts.credentialSet[env] ? "config.envSet" : "config.envUnset") : null}</> : key === "max_tokens" ? t("config.outputTokensNote") : undefined;
          const value = configRowValue(t, facts, path);
          return editable ? { label, control: <ConfigControl model={model} path={path} label={label} spec={{ kind, ...("options" in field ? { options: field.options } : {}) }} />, ...(note ? { note } : {}) } : { label, mono: true, ...(value !== undefined ? { value } : {}), ...(note ? { note } : {}) };
        });
        if (editable)
          for (const { key, json } of CONNECTION_SECRETS) {
            const label = t(`config.conn.${key}`);
            rows.push({ label, control: <SecretEntries model={model} path={["connections", name, key]} label={label} json={json} /> });
          }
        return (
          <Section key={name} title={t("config.connection", { name })}>
            <ConnectionActions model={model} name={name} />
            <FactList missing={t("common.notReadable")} facts={rows} />
          </Section>
        );
      })}
    </>
  );
}

function ConnectionActions({ model, name }: { model: AppModel; name: string }) {
  const t = model.t.value;
  const [confirm, setConfirm] = useState(false);
  const action = model.config.connectionAction.value;
  const busy = action?.state === "testing" || action?.state === "clearing";
  const source = model.config.read.value.value?.loaded.credentialSource?.[name];
  const state = source === "env" || source === "stored" || source === "none" ? source : undefined;
  return <>
    <div class="band">
      <span>{t("config.keyState")}: {state ?? t("config.notSet")}</span>
      <Button disabled={busy} onClick={() => void model.config.testConnection(name)}>{t("config.testConnection")}</Button>
      {confirm ? <>
        <Button disabled={busy} onClick={() => { setConfirm(false); void model.config.clearCredential(name); }}>{t("config.confirmClear")}</Button>
        <Button disabled={busy} onClick={() => setConfirm(false)}>{t("common.close")}</Button>
      </> : <Button disabled={busy} onClick={() => setConfirm(true)}>{t("config.clearKey")}</Button>}
    </div>
    {confirm ? <Notice tone="wait">{t("config.clearKeyWarning")}</Notice> : null}
    {action?.name === name ? <Notice>{t(`config.action.${action.state}`)}</Notice> : null}
  </>;
}

/** Non-row configuration read errors; field controls save directly. */
export function ConfigPanel({ model }: { model: AppModel }) {
  const t = model.t.value;
  if (!model.data.capabilities.value.includes(CAPABILITY_CONFIG)) return <Notice><Rich text={t("config.unavailable")} /></Notice>;
  const read = model.config.read.value;
  const facts = read.value;
  return <>{read.error ? <Notice tone="bad">{t("config.readonlyError")}</Notice> : null}{facts && !facts.file.valid ? <Notice tone="bad">{t("config.invalid", { error: facts.file.error ?? "" })}</Notice> : null}</>;
}
