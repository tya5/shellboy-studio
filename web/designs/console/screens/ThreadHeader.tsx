import { useEffect, useRef, useState } from "preact/hooks";
import { CAPABILITY_REPARENT, CAPABILITY_TAGS, folderName, statusLabel, type AppModel } from "../../../ui-core/src";
import { Button } from "../system/components/Button";
import { ConversationHeader } from "../system/components/ConversationHeader";
import { Field } from "../system/components/Field";
import { Icon } from "../system/components/Icon";
import { Notice } from "../system/components/Notice";
import { StatusMark } from "../system/components/StatusMark";
import { WorkSheet } from "../system/components/WorkSheet";
import type { MenuEntry } from "../system/components/Menu";
import { threadMenuEntries } from "../system/components/thread-menu";

export function ThreadHeader({ model, settings, onSettings, onList, onDelete, onEditTags }: {
  model: AppModel; settings: boolean; onSettings: () => void; onList: () => void; onDelete: (id: string) => void; onEditTags: (id: string, archived: boolean) => void;
}) {
  const t = model.t.value;
  const selected = model.selectedRow.value;
  const row = selected?.summary;
  const details = model.details.value;
  const id = details?.thread_id ?? row?.thread_id;
  const title = details?.title ?? row?.title ?? "";
  const cwd = details?.cwd ?? row?.cwd;
  const status = selected?.status;
  const [editor, setEditor] = useState<"title" | "cwd">();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(() => matchMedia("(max-width: 899px)").matches);
  const titleButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const mq = matchMedia("(max-width: 899px)");
    const update = () => setPhone(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const open = (kind: NonNullable<typeof editor>, from?: HTMLElement | null) => {
    opener.current = from ?? titleButton.current;
    setError(undefined);
    setValue(kind === "title" ? title : "");
    setEditor(kind);
  };
  const entries: MenuEntry[] = id ? [
    { key: "rename", icon: "thread.rename", label: t("header.rename"), onSelect: (focus) => open("title", focus) },
    ...(row ? threadMenuEntries(model, row, target => onDelete(target.thread_id), { ...(model.data.capabilities.value.includes(CAPABILITY_TAGS) ? { onEditTags: () => onEditTags(row.thread_id, row.archived_at !== undefined) } : {}), ...(model.data.capabilities.value.includes(CAPABILITY_REPARENT) ? { onMove: () => model.threadActions.pickParent(row.thread_id) } : {}) }) : []),
  ] : [];
  if (phone) entries.push(
    ...(cwd ? [{ key: "cwd", label: t("header.directory"), onSelect: (focus: HTMLElement | null) => open("cwd", focus) }] : []),
    { key: "settings", icon: "settings.applicationPanel", label: t("settings.open"), onSelect: onSettings },
  );
  const submit = async () => {
    if (!id || busy || !editor || editor === "cwd") return;
    setError(undefined);
    setBusy(true);
    try {
      if (!value.trim()) return;
      const result = await model.ops.threadSetTitle(id, value.trim());
      if (!result.ok) { setError(result.error.message); return; }
      setEditor(undefined);
    } finally { setBusy(false); }
  };
  const editorLabel = t(editor === "cwd" ? "header.directory" : "header.rename");
  return <>
    <ConversationHeader folder={folderName(cwd)} label={t("thread.rowMenu")} entries={entries}
      title={id ? <Button buttonRef={titleButton} variant="ghost" title={t("header.rename")} onClick={() => open("title")}>{title}</Button> : <b>{title}</b>}
      status={status ? <StatusMark status={status} label={statusLabel(t, status)} word={!phone} /> : undefined}
      actions={<Button variant="ghost" icon label={t(settings ? "settings.close" : "settings.open")} aria-expanded={settings} data-settings-toggle onClick={onSettings}><Icon role="settings.applicationPanel" /></Button>}>
      <span class="menu"><Button variant="ghost" icon label={t("threads.open")} onClick={onList}><Icon role="nav.openThreadList" /></Button></span>
    </ConversationHeader>
    {editor ? <WorkSheet open title={editorLabel} closeLabel={t("common.close")} onClose={() => { if (!busy) setEditor(undefined); }} getReturnFocusTarget={() => opener.current?.isConnected ? opener.current : titleButton.current}>
      {editor === "cwd" ? <code>{cwd}</code> : <form class="stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Field ariaLabel={editorLabel} value={value} disabled={busy} onInput={(event) => setValue(event.currentTarget.value)} />
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <Button type="submit" variant="primary" disabled={busy || (editor === "title" && !value.trim())}>{t("model.save")}</Button>
      </form>}
    </WorkSheet> : null}
  </>;
}
