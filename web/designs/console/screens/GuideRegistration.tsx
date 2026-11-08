import { useState } from "preact/hooks";
import type { DesignContext } from "../../../ui-core/src";
import { Button, Field, GuideCopy, Notice, Section } from "../system/components";

export function GuideRegistrationView({ context, collapsed = false }: { context: DesignContext; collapsed?: boolean }) {
  const { model, prefs, setPrefs } = context; const t = model.t.value;
  const state = model.guideRegistration.state.value;
  const [path, setPath] = useState("");
  return <>
    {state.supported ? <Section title={t("guide.files")}>
      {model.guideRegistration.files.value.map((file) => <div class="work-row" key={file}><code>{file}</code><Button disabled={file.endsWith("/studio/agent-pointer.md")} onClick={() => void model.guideRegistration.edit(file, false)}>{t("guide.removeFile")}</Button></div>)}
      <div class="work-row"><Field ariaLabel={t("guide.filePath")} placeholder={t("guide.filePath")} value={path} onInput={(e) => setPath(e.currentTarget.value)} /><Button disabled={!path.trim()} onClick={() => { void model.guideRegistration.edit(path.trim(), true); setPath(""); }}>{t("guide.addFile")}</Button></div>
    </Section> : null}
    {state.supported ? <Section title={t("guide.registration")}>
      <Button aria-pressed={!prefs.value.guideOptOut} disabled={state.busy} onClick={() => setPrefs({ guideOptOut: !prefs.value.guideOptOut })}>{t(prefs.value.guideOptOut ? "guide.enable" : "guide.disable")}</Button>
      <p class="muted caption">{t(state.registered ? "guide.registered" : "guide.notRegistered")}</p>
      {state.applied && !state.restart ? <p class="muted caption">{t("guide.live")}</p> : state.restart ? <p class="muted caption">{t("guide.restart")}</p> : null}
      {state.error ? <Notice tone="bad">{t("common.readError", { message: state.error })}</Notice> : null}
    </Section> : null}
    {state.registered ? <p class="muted caption">{t("guide.copyUnneeded")}</p> : <GuideCopy collapsed={collapsed} title={t("guide.title")} line={t("guide.line")} note={t("guide.note")} copy={t("code.copy")} copied={t("code.copied")} failed={t("guide.copyFailed")} />}
  </>;
}
