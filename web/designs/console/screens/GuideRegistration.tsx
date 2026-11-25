import { settingSearch } from "./setting-search";
import { useState } from "preact/hooks";
import type { DesignContext } from "../../../ui-core/src";
import { Button } from "../system/components/Button";
import { Field } from "../system/components/Field";
import { GuideCopy } from "../system/components/GuideCopy";
import { Notice } from "../system/components/Notice";
import { Section } from "../system/components/Section";

export function guideSearchRows(context: DesignContext) {
  const t = context.model.t.value;
  const state = context.model.guideRegistration.state.value;
  return [
    ...(!state.supported ? [] : [settingSearch(t, "guide.files", "guide.files", ["guide.filePath", "guide.addFile", "guide.removeFile"]), settingSearch(t, "guide.registration", "guide.registration", ["guide.enable", "guide.disable"])]),
    ...(!state.registered ? [settingSearch(t, "guide.manual", "guide.title", ["guide.note"])] : []),
  ];
}

export function GuideRegistrationView({ context, collapsed = false }: { context: DesignContext; collapsed?: boolean }) {
  const { model, prefs, setPrefs } = context; const t = model.t.value;
  const state = model.guideRegistration.state.value;
  const [files, registration] = state.supported ? guideSearchRows(context) : [];
  const manual = guideSearchRows(context).find((row) => row.id === "guide.manual");
  const [path, setPath] = useState("");
  return <>
    {state.supported ? <Section settingId={files?.id} title={t("guide.files")}>
      <ul class="guide-file-list">{model.guideRegistration.files.value.map((file) => <li key={file}><code class="mono">{file}</code><Button variant="ghost" disabled={state.busy || file.endsWith("/studio/agent-pointer.md")} onClick={() => void model.guideRegistration.edit(file, false)}>{t("guide.removeFile")}</Button></li>)}</ul>
      <div class="guide-file-add"><Field label={t("guide.filePath")} value={path} onInput={(e) => setPath(e.currentTarget.value)} /><Button variant="ghost" disabled={state.busy || !path.trim()} onClick={async () => { if (await model.guideRegistration.edit(path.trim(), true)) setPath(current => current === path ? "" : current); }}>{t("guide.addFile")}</Button></div>
      {state.error || state.unreadable ? <Notice tone="bad">{state.error ?? t("config.readonlyError")}</Notice> : null}
    </Section> : null}
    {state.supported ? <Section settingId={registration?.id} title={t("guide.registration")}>
      <Button variant="ghost" aria-pressed={!prefs.value.guideOptOut} disabled={state.busy} onClick={() => setPrefs({ guideOptOut: !prefs.value.guideOptOut })}>{t(prefs.value.guideOptOut ? "guide.enable" : "guide.disable")}</Button>
      <p class="muted caption">{t(state.registered ? "guide.registered" : "guide.notRegistered")}</p>
      {state.applied && !state.restart ? <p class="muted caption">{t("guide.live")}</p> : state.restart ? <p class="muted caption">{t("guide.restart")}</p> : null}
    </Section> : null}
    {state.registered ? <p class="muted caption">{t("guide.copyUnneeded")}</p> : <div data-setting-id={manual?.id}><GuideCopy collapsed={collapsed} title={t("guide.title")} line={t("guide.line")} note={t("guide.note")} copy={t("code.copy")} copied={t("code.copied")} failed={t("guide.copyFailed")} /></div>}
  </>;
}
