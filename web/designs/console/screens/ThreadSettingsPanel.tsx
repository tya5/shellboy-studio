import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ThreadDetails } from "../../../data/src";
import { readThreadSettings, type AppModel, type MessageKey } from "../../../ui-core/src";
import { Button, ButtonGroup, Field, Section, SettingRow } from "../system/components";
import { SettingFeedbackLine } from "./SettingsConfig";

type FieldName = Parameters<AppModel["ops"]["setThreadSetting"]>[1];
const unreadable = Symbol("unreadable override");
type Value = string | number | boolean | typeof unreadable | undefined;
export type SettingsDestination = { thread: string; field: FieldName; consume(): void };
type Row = { field: FieldName; label: MessageKey; own: Value; inherited?: Value; defaultable?: boolean };
const settingId = (field: FieldName) => `thread.${field}`;

function rows(details: ThreadDetails): { section: MessageKey; entries: Row[] }[] {
  const d = readThreadSettings(details);
  return [
    { section: "set.section.general", entries: [
      { field: "title", label: "threadSettings.title", own: details.title },
      { field: "cwd", label: "threadSettings.cwd", own: d.cwd },
      { field: "agents", label: "threadSettings.agents", own: d.agentsPath },
    ] },
    { section: "set.section.connections", entries: [
      { field: "connection", label: "model.connection", own: d.connection },
      { field: "model", label: "details.model", own: d.model },
      { field: "effort", label: "model.effort", own: d.effort },
      { field: "max_tokens", label: "threadSettings.max", own: d.maxTokensState.kind === "unknown" ? unreadable : d.maxTokens, inherited: d.effectiveMaxTokens, defaultable: true },
    ] },
    { section: "set.section.compaction", entries: [
      { field: "auto_compact_at", label: "thread.auto", own: d.autoCompactAt, inherited: d.effectiveAutoCompactAt, defaultable: true },
      { field: "auto_compact_target_percent", label: "threadSettings.percent", own: d.autoCompactTargetPercent, inherited: d.effectiveAutoCompactTargetPercent, defaultable: true },
      { field: "summary_max_chars", label: "threadSettings.chars", own: d.summaryMaxChars, inherited: d.effectiveSummaryMaxChars, defaultable: true },
      { field: "spill", label: "threadSettings.spill", own: d.spill, inherited: d.effectiveSpill, defaultable: true },
    ] },
  ];
}

function wireValue(value: Value) {
  return typeof value === "boolean" ? value ? "on" : "off" : value === unreadable ? "" : String(value ?? "");
}

export function ThreadSettingsPanel({ model, details, destination }: { model: AppModel; details: ThreadDetails; destination?: SettingsDestination | undefined }) {
  const t = model.t.value;
  const root = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<FieldName>();
  useLayoutEffect(() => {
    if (!destination) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-setting-id="${settingId(destination.field)}"]`);
    if (!row) return;
    setHighlight(destination.field);
    row.scrollIntoView?.({ block: "nearest" });
    row.querySelector("button")?.focus({ preventScroll: true });
    destination.consume();
  }, [destination]);
  const enabled = model.data.capabilities.value.includes("thread.settings") && model.data.owner.value.state === "connected";
  return <div class="stack" ref={root}>
    {rows(details).map(({ section, entries }) => <Section key={section} title={t(section)}>
      {entries.map(row => <ThreadSetting key={row.field} model={model} row={row} details={details} enabled={enabled} highlighted={highlight === row.field} />)}
    </Section>)}
  </div>;
}

function ThreadSetting({ model, row, details, enabled, highlighted }: { model: AppModel; row: Row; details: ThreadDetails; enabled: boolean; highlighted: boolean }) {
  const thread = details.thread_id;
  const t = model.t.value;
  const label = t(row.label);
  const [edit, setEdit] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [settle, setSettle] = useState<{ expected: Value; previous: Value; before: ThreadDetails }>();
  const [undo, setUndo] = useState<{ expected: Value; previous: Value }>();
  const lifetime = useRef<object>();
  const change = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => { const scope = {}; lifetime.current = scope; return () => { lifetime.current = undefined; }; }, []);
  const editing = edit !== undefined;
  useLayoutEffect(() => {
    if (editing) editor.current?.querySelector<HTMLElement>("input,select")?.focus();
    else if (returnFocus.current) { returnFocus.current = false; change.current?.focus(); }
  }, [editing]);
  useEffect(() => {
    if (!settle || details === settle.before) return;
    if (!Object.is(row.own, settle.expected)) {
      if (!Object.is(row.own, settle.previous)) { setSettle(undefined); setError(t("config.changedElsewhere")); }
      return;
    }
    setSettle(undefined);
    setUndo(settle);
  }, [settle, details, row.own]);
  useEffect(() => {
    if (undo && !Object.is(undo.expected, row.own)) setUndo(undefined);
  }, [undo, row.own]);
  const busy = saving || settle !== undefined;
  const close = () => { returnFocus.current = true; setEdit(undefined); };
  const save = async (value: string) => {
    if (!enabled || busy) return;
    if (row.field !== "title" && row.own !== unreadable && value === wireValue(row.own)) { close(); return; }
    const scope = lifetime.current;
    const handle = model.handle.peek();
    const owner = model.data.owner.peek();
    if (!scope || !handle || handle.threadId !== thread || owner.state !== "connected") return;
    setSaving(true); setError(undefined); setUndo(undefined);
    const out = await model.ops.setThreadSetting(thread, row.field, value);
    if (lifetime.current !== scope || model.handle.peek() !== handle || model.data.owner.peek() !== owner) return;
    setSaving(false);
    if (!out.ok) { setError(out.error.message); return; }
    if (out.value.thread_id !== thread) { setError(t("common.notReadable")); return; }
    const result = rows(out.value).flatMap(section => section.entries).find(r => r.field === row.field);
    setSettle({ expected: result?.own, previous: row.own, before: details });
    close();
  };
  const inherited = row.defaultable && row.own === undefined;
  const value = inherited ? row.inherited : row.own;
  const displayed = value === unreadable ? t("common.notReadable") : typeof value === "boolean" ? t(value ? "config.on" : "config.off")
    : value === undefined || value === "" ? t(row.field === "title" ? "threadSettings.automatic" : "config.notSet") : String(value);
  const saved = undo && Object.is(undo.expected, row.own) ? undo : undefined;
  const undoValue = row.field !== "title" && saved && saved.previous !== unreadable && !Object.is(saved.expected, saved.previous) ? saved : undefined;
  const feedback = busy || error || saved ? <SettingFeedbackLine text={busy ? t("common.loading") : error ?? t("config.applyNow")}
    undoLabel={t("config.undo")} busy={!enabled || busy} onUndo={undoValue && !error ? () => void save(wireValue(undoValue.previous)) : undefined} /> : null;
  return <SettingRow settingId={settingId(row.field)} label={label} highlighted={highlighted} feedback={feedback}
    read={editing ? undefined : <><span class={typeof value === "number" || row.field === "cwd" || row.field === "agents" || row.field === "model" ? "mono" : undefined}>{displayed}</span>{row.defaultable ? <div class="muted caption">{t(inherited ? "threadSettings.default" : "threadSettings.overridden")}</div> : null}</>}
    control={editing ? <div class="stack" ref={editor} onKeyDown={event => {
      if (event.isComposing || busy) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Enter" && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); void save(edit); }
    }}>
      {row.field === "spill" ? <Field ariaLabel={label} as="select" value={edit} disabled={busy} options={[{ value: "on", label: t("config.on") }, { value: "off", label: t("config.off") }]} onSelectChange={setEdit} />
        : <Field ariaLabel={label} value={edit} disabled={busy} onInput={event => setEdit(event.currentTarget.value)} />}
      <div class="band end"><Button disabled={busy} onClick={close}>{t("threadSettings.cancel")}</Button>
      <Button variant="primary" disabled={busy || !enabled} onClick={() => void save(edit)}>{t("threadSettings.save")}</Button></div>
    </div> : <ButtonGroup label={label}>
      <Button variant="link" buttonRef={change} disabled={!enabled} aria-disabled={busy || undefined} onClick={() => { if (busy) return; setError(undefined); setEdit(wireValue(value)); }}>{t("threadSettings.change")}</Button>
      {row.defaultable && !inherited ? <Button variant="link" disabled={!enabled || busy} onClick={() => void save("")}>{t("threadSettings.reset")}</Button> : null}
    </ButtonGroup>} />;
}
