import type { RegisterSetting } from "./setting-search";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { CAPABILITY_CONFIG, CONNECTION_FIELDS, CONNECTION_SECRETS, fieldOf, isHidden, isHiddenName, showConfigValue, valueAt, type AppModel, type ConfigFacts, type ConfigFieldSpec } from "../../../ui-core/src";
import { Button, ButtonGroup, FactList, Field, Notice, Section, type Fact } from "../system/components";
import { ConnectionModelList, ModelChooser, modelLabel, useConnectionModels } from "../system/components/ModelPicker/ConnectionModelList";
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

/** What the running owner has, when the file says something else. */
export function SettingFeedback({ model, paths }: { model: AppModel; paths: readonly (readonly string[])[] }) {
  const t = model.t.value;
  const config = model.config;
  const facts = config.read.value.value;
  const field = fieldOf(paths[0]!);
  const saved = config.lastSaved.value?.field === field ? config.lastSaved.value : undefined;
  const error = config.fieldError.value?.field === field ? config.fieldError.value.reason : undefined;
  const differs = facts?.differing?.some((name) => paths.some((path) => fieldOf(path) === name));
  const restart = saved?.restartRequired ?? (differs === true ? true : undefined);
  const errorText = error === "number" ? t("config.badNumber") : error === "json" ? t("config.badJson") : error === "placeholder" ? t("config.badPlaceholder") : error;
  return <div class="muted caption" role="status">
    {config.pendingField.value === field ? t("common.loading") : errorText ?? (config.changedElsewhere.value === field ? t("config.changedElsewhere") : restart === undefined ? null : t(restart ? "config.restartOwner" : "config.applyNow"))}
    {saved?.undo.length && !errorText ? <Button variant="link" disabled={config.fieldSaving.value} onClick={() => void config.undoLast()}>{t("config.undo")}</Button> : null}
  </div>;
}

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

function RejectedTextField({ rejection, ...props }: Parameters<typeof Field>[0] & { rejection?: object }) {
  const [revision, setRevision] = useState(0);
  useEffect(() => { if (rejection) setRevision((previous) => previous + 1); }, [rejection]);
  return <Field key={revision} {...props} />;
}

/** The typed control for one key of the file. */
export function ConfigControl({ model, path, label, spec, describedBy }: { model: AppModel; path: readonly string[]; label: string; spec: ConfigFieldSpec; describedBy?: string }) {
  const t = model.t.value;
  const config = model.config;
  const facts = config.read.value.value;
  const field = fieldOf(path);
  const current = valueAt(facts?.file.values, path);
  const saving = config.fieldSaving.value;
  const error = config.fieldError.value?.field === field ? config.fieldError.value : undefined;
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
    control = <RejectedTextField rejection={error} ariaLabel={label} aria-describedby={describedBy} class="mono" inputMode={spec.kind === "int" ? "numeric" : undefined} placeholder={t("config.notSet")} value={raw} disabled={disabled} onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); }} onBlur={(e) => { if (e.currentTarget.value !== raw) commit(e.currentTarget.value); }} />;
  }
  return <div class="stack">{control}<SettingFeedback model={model} paths={[path]} /></div>;
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

/** The selected pair is always the one in the latest Core read. */
export function ConnectionModelRow({ model, path, modelPath, label }: { model: AppModel; path: readonly string[]; modelPath: readonly string[]; label: string }) {
  const t = model.t.value;
  const config = model.config;
  const facts = config.read.value.value;
  const values = facts?.file.values;
  const connections = values?.connections as Record<string, unknown> | undefined;
  const names = useMemo(() => Object.keys(connections ?? {}).sort(), [connections]);
  const [open, setOpen] = useState(false);
  const choice = { connection: String(valueAt(values, path) ?? ""), model: String(valueAt(values, modelPath) ?? "") };
  const load = useCallback(async (connection: string) => {
    const result = await model.ops.modelList({ connection });
    return result.ok ? { choices: result.value.models } : { choices: [], error: result.error.message };
  }, [model]);
  return <div class="stack">
    <ModelChooser label={label} trigger={choice.connection && choice.model ? modelLabel(choice) : t("model.change")} open={open} disabled={config.fieldSaving.value || !names.length} onToggle={() => setOpen(!open)} onClose={() => setOpen(false)}>
      <ModelCatalog connections={names} load={load} current={choice} t={t} onSelect={(next) => { setOpen(false); void config.saveModelPair(path, modelPath, next.connection, next.model); }} />
      <Button onClick={() => setOpen(false)}>{t("model.close")}</Button>
    </ModelChooser>
    <SettingFeedback model={model} paths={[path, modelPath]} />
  </div>;
}

function ModelCatalog({ connections, load, current, t, onSelect }: {
  connections: readonly string[]; load: Parameters<typeof useConnectionModels>[1]; current: { connection: string; model: string }; t: T;
  onSelect: (choice: { connection: string; model: string }) => void;
}) {
  const catalog = useConnectionModels(connections, load);
  const choices = current.connection && current.model && !catalog.choices.some((choice) => choice.connection === current.connection && choice.model === current.model) ? [current, ...catalog.choices] : catalog.choices;
  return <>
    <ConnectionModelList choices={choices} selected={current} searchLabel={t("model.search")} emptyLabel={catalog.loading ? t("common.loading") : t("model.empty")} onSelect={onSelect} />
    {catalog.errors.map((error, index) => <Notice key={index} tone="bad">{error}</Notice>)}
  </>;
}

/** One section per connection in the file. */
export function connectionCards(model: AppModel, search: RegisterSetting) {
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
          const { settingId, label } = search(fieldOf(path), `config.conn.${key}`, key === "api_key_env" ? ["config.keyNote"] : key === "max_tokens" ? ["config.outputTokensNote"] : [], name);
          const env = key === "api_key_env" ? valueAt(values, path) : undefined;
          const describedBy = key === "max_tokens" ? `connection-output-tokens-${encodeURIComponent(name)}` : undefined;
          const note = key === "api_key_env" ? <>{t("config.keyNote")} {typeof env === "string" && facts.credentialSet[env] !== undefined ? t(facts.credentialSet[env] ? "config.envSet" : "config.envUnset") : null}</> : describedBy ? <span id={describedBy}>{t("config.outputTokensNote")}</span> : undefined;
          const value = configRowValue(t, facts, path);
          return editable ? { settingId, label, control: <ConfigControl model={model} path={path} label={label} describedBy={describedBy} spec={{ kind, ...("options" in field ? { options: field.options } : {}) }} />, ...(note ? { note } : {}) } : { settingId, label, mono: true, ...(value !== undefined ? { value } : {}), ...(note ? { note } : {}) };
        });
        if (editable)
          for (const { key, json } of CONNECTION_SECRETS) {
            const { settingId, label } = search(fieldOf(["connections", name, key]), `config.conn.${key}`, [], name);
            rows.push({ settingId, label, control: <SecretEntries model={model} path={["connections", name, key]} label={label} json={json} /> });
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
