import { useState } from "preact/hooks";
import { CAPABILITY_CONFIG, CONNECTION_FIELDS, CONNECTION_SECRETS, fieldOf, isHidden, isHiddenName, showConfigValue, valueAt, type AppModel, type ConfigChangeRow, type ConfigFacts, type ConfigFieldSpec, type Draft } from "../../../ui-core/src";
import { Button, ButtonGroup, DiffList, FactList, Field, Notice, Section, type DiffRow, type Fact } from "../system/components";
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
  const draft = model.config.drafts.value.get(fieldOf(path));
  const [replacing, setReplacing] = useState(draft !== undefined && draft.value !== undefined);
  const head = (
    <div class="band">
      {name ? <code>{name}</code> : null}
      <span>{t("config.hiddenValue")}</span>
      {replacing ? null : <Button variant="link" onClick={() => setReplacing(true)}>{t("config.replace")}</Button>}
      {onRemove ? <Button variant="link" onClick={onRemove}>{t("config.remove")}</Button> : null}
    </div>
  );
  if (!replacing) return head;
  return (
    <div class="stack">
      {head}
      <Field
        ariaLabel={t("config.newValue") + ": " + label}
        type="password"
        autoComplete="new-password"
        placeholder={json ? t("config.enterJson") : t("config.newValue")}
        value={draft?.raw ?? ""}
        onInput={(e) => model.config.edit(path, e.currentTarget.value, json ? "secret-json" : "secret")}
      />
      <div class="band">
        <Button variant="link" onClick={() => { model.config.undo(fieldOf(path)); setReplacing(false); }}>{t("config.undo")}</Button>
      </div>
      <DraftNote model={model} draft={draft?.invalid ? draft : undefined} t={t} />
    </div>
  );
}

/** The typed control for one key of the file. */
export function ConfigControl({ model, path, label, spec }: { model: AppModel; path: readonly string[]; label: string; spec: ConfigFieldSpec }) {
  const t = model.t.value;
  const config = model.config;
  const facts = config.read.value.value;
  const field = fieldOf(path);
  const draft = config.drafts.value.get(field);
  const current = valueAt(facts?.file.values, path);
  if (isHidden(current))
    return (
      <>
        <HiddenControl model={model} path={path} label={label} json={false} t={t} />
        <RunningNote model={model} path={path} t={t} />
      </>
    );
  const held = draft ? draft.value : current;
  const options = spec.kind === "choice" ? (spec.options ?? Object.keys((facts?.file.values?.connections as Record<string, unknown> | undefined) ?? {})) : [];
  let control;
  if (spec.kind === "bool")
    control = (
      <ButtonGroup label={label}>
        <Button aria-pressed={held === true} onClick={() => config.edit(path, "true", "bool")}>{t("config.on")}</Button>
        <Button aria-pressed={held === false} onClick={() => config.edit(path, "false", "bool")}>{t("config.off")}</Button>
      </ButtonGroup>
    );
  else if (spec.kind === "kinds") {
    const kinds = ["user", "summary", "assistant_response", "tool_result", "spill", "event"] as const;
    const selected = Array.isArray(held) ? held.filter((v): v is string => typeof v === "string") : [];
    control = (
      <ButtonGroup label={label}>
        {kinds.map((kind) => <Button key={kind} aria-pressed={selected.includes(kind)} onClick={() => config.edit(path, (selected.includes(kind) ? selected.filter((v) => v !== kind) : [...selected, kind]).join(","), "kinds")}>{t(`set.kind.${kind}`)}</Button>)}
      </ButtonGroup>
    );
  }
  else if (spec.kind === "choice")
    control = (
      <ButtonGroup label={label}>
        {options.map((o) => (
          <Button key={o} aria-pressed={held === o} onClick={() => config.edit(path, o, "choice")}>{o}</Button>
        ))}
      </ButtonGroup>
    );
  else
    control = (
      <Field
        ariaLabel={label}
        class="mono"
        inputMode={spec.kind === "int" ? "numeric" : undefined}
        placeholder={t("config.notSet")}
        value={draft ? draft.raw : current === undefined || current === null ? "" : showConfigValue(current)}
        onInput={(e) => config.edit(path, e.currentTarget.value, spec.kind)}
      />
    );
  return (
    <div class="stack">
      {control}
      <DraftNote model={model} draft={draft} t={t} />
      <RunningNote model={model} path={path} t={t} />
    </div>
  );
}

/** Entries whose values the owner hides: names, "set, hidden", replace, remove, add. */
export function SecretEntries({ model, path, label, json }: { model: AppModel; path: readonly string[]; label: string; json: boolean }) {
  const t = model.t.value;
  const config = model.config;
  const facts = config.read.value.value;
  const drafts = config.drafts.value;
  const held = valueAt(facts?.file.values, path) as Record<string, unknown> | undefined;
  const names = Object.keys(held ?? {});
  const added = [...drafts.values()].filter((d) => d.path.length === path.length + 1 && path.every((p, i) => d.path[i] === p) && !names.includes(d.path[path.length]!));
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  return (
    <div class="stack">
      {names.length === 0 && added.length === 0 ? <span class="muted">{t("config.noEntries")}</span> : null}
      {names.map((n) => {
        const entry = [...path, n];
        const draft = drafts.get(fieldOf(entry));
        if (isHiddenName(n))
          return (
            <div key={n}>
              <code>{n}</code>
              <div class="muted caption">{t("config.hiddenName")}</div>
            </div>
          );
        if (draft && draft.value === undefined)
          return (
            <div class="band" key={n}>
              <code>{n}</code>
              <span class="muted caption">{t("config.willRemove")}</span>
              <Button variant="link" onClick={() => config.undo(draft.field)}>{t("config.undo")}</Button>
            </div>
          );
        return (
          <HiddenControl key={n} model={model} path={entry} label={`${label}: ${n}`} json={json} t={t} name={n} onRemove={() => config.remove(entry, true)} />
        );
      })}
      {added.map((d) => (
        <div class="band" key={d.field}>
          <code>{d.path[path.length]}</code>
          <span class="muted caption">{t("config.newEntry")}</span>
          <Button variant="link" onClick={() => config.undo(d.field)}>{t("config.undo")}</Button>
        </div>
      ))}
      {adding ? (
        <div class="stack">
          <Field ariaLabel={`${label}: ${t("config.addName")}`} placeholder={t("config.addName")} value={name} onInput={(e) => setName(e.currentTarget.value)} />
          {name.trim() ? <HiddenAdd model={model} path={[...path, name.trim()]} label={label} json={json} t={t} /> : null}
          <div class="band">
            <Button variant="link" onClick={() => { setAdding(false); setName(""); }}>{t("common.close")}</Button>
          </div>
        </div>
      ) : (
        <div class="band">
          <Button variant="link" onClick={() => setAdding(true)}>{t("config.add")}</Button>
        </div>
      )}
    </div>
  );
}

function HiddenAdd({ model, path, label, json, t }: { model: AppModel; path: readonly string[]; label: string; json: boolean; t: T }) {
  const draft = model.config.drafts.value.get(fieldOf(path));
  return (
    <>
      <Field
        ariaLabel={`${label}: ${t("config.newValue")}`}
        type="password"
        autoComplete="new-password"
        placeholder={json ? t("config.enterJson") : t("config.newValue")}
        value={draft?.raw ?? ""}
        onInput={(e) => model.config.edit(path, e.currentTarget.value, json ? "secret-json" : "secret")}
      />
      <DraftNote model={model} draft={draft?.invalid ? draft : undefined} t={t} />
    </>
  );
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

function reviewRow(t: T, c: ConfigChangeRow): DiffRow {
  const shown = (v: unknown) => (v === undefined || v === null ? t("config.unsetValue") : showConfigValue(v));
  if (c.sensitive) return { key: c.field, field: c.field, before: t(c.isNew ? "config.unsetValue" : "config.hiddenValue"), after: t(c.removes ? "config.removedEntry" : "config.newHidden") };
  return { key: c.field, field: c.field, before: shown(c.before), after: c.removes ? t("config.removed") : shown(c.after) };
}

/** Top of every Settings section: where things stand with the file, and the way to write changes. */
export function ConfigPanel({ model }: { model: AppModel }) {
  const t = model.t.value;
  const config = model.config;
  if (!model.data.capabilities.value.includes(CAPABILITY_CONFIG)) return <Notice><Rich text={t("config.unavailable")} /></Notice>;
  const read = config.read.value;
  const facts = read.value;
  const stage = config.stage.value;
  const changes = config.changes.value;
  const pending = config.drafts.value.size;
  const reviewing = stage.kind === "review" || stage.kind === "saving" || stage.kind === "conflict" || stage.kind === "refused" || stage.kind === "unconfirmed";
  return (
    <>
      {read.error ? <Notice tone="bad">{t("config.readonlyError")}</Notice> : null}
      {facts && !facts.file.valid ? <Notice tone="bad">{t("config.invalid", { error: facts.file.error ?? "" })}</Notice> : null}
      {facts?.differs ? (
        <Notice tone="wait" title={t("config.differs")}>
          {facts.differing?.length ? <div>{t("config.differsValues")}</div> : null}
        </Notice>
      ) : null}
      {stage.kind === "saved" ? (
        <Section title={t(stage.changes.length ? "config.saved" : "config.savedNone")} actions={<Button variant="link" onClick={() => config.dismissResult()}>{t("common.close")}</Button>}>
          {stage.restartRequired ? <Notice tone="wait">{t("config.restartRequired")}</Notice> : null}
          {stage.changes.some((c) => c.appliedToRunningOwner) ? <Notice>{t("config.appliedNext")}</Notice> : null}
          {stage.warning ? <Notice tone="wait">{stage.warning}</Notice> : null}
          <DiffList
            beforeLabel={t("config.previous")}
            afterLabel={t("config.applied")}
            rows={stage.changes.map((c) => ({
              key: c.field,
              field: c.field,
              // The owner reports that a hidden entry changed and nothing else, not even how.
              before: c.sensitive ? t("config.hiddenWord") : "previous" in c && c.previous !== null ? showConfigValue(c.previous) : t("config.unsetValue"),
              after: c.sensitive ? t("config.changedHidden") : "value" in c && c.value !== null ? showConfigValue(c.value) : t("config.unsetValue"),
            }))}
          />
        </Section>
      ) : null}
      {reviewing && pending > 0 ? (
        <Section title={t("config.reviewTitle")} sub={t("config.reviewSub")}>
          {stage.kind === "conflict" ? <Notice tone="bad">{t("config.conflict")}</Notice> : null}
          {stage.kind === "unconfirmed" ? <Notice tone="bad">{t("config.unconfirmed", { message: stage.message })}</Notice> : null}
          {stage.kind === "refused" ? (
            <Notice tone="bad">
              <Rich text={stage.field ? t("config.refusedField", { field: stage.field, message: stage.message }) : t("config.refused", { message: stage.message })} />
              {stage.recoveryFile ? <div><Rich text={t("config.recovery", { path: stage.recoveryFile })} /></div> : null}
            </Notice>
          ) : null}
          <DiffList beforeLabel={t("config.before")} afterLabel={t("config.after")} rows={changes.map((c) => reviewRow(t, c))} />
          <div class="band">
            <Button variant="warn" disabled={stage.kind === "saving" || read.loading || changes.length === 0} onClick={() => void config.save()}>{t(stage.kind === "saving" ? "config.writing" : "config.write")}</Button>
            <Button disabled={stage.kind === "saving"} onClick={() => config.backToEditing()}>{t("config.back")}</Button>
          </div>
        </Section>
      ) : null}
      {!reviewing && pending > 0 ? (
        <Notice
          actions={
            <div class="band">
              <Button variant="primary" disabled={config.hasInvalid.value || changes.length === 0} onClick={() => config.review()}>{t("config.review")}</Button>
              <Button onClick={() => config.discard()}>{t("config.discard")}</Button>
            </div>
          }
        >
          {t("config.pending", { n: pending })}
        </Notice>
      ) : null}
    </>
  );
}
