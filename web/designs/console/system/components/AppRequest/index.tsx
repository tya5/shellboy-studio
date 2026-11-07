import { useState } from "preact/hooks";
import { Button } from "../Button";

export function AppRequest({ title, requestLabel, cwdLabel, reviewLabel, previewLabel, sendLabel, prompt, busy, disabled, error, folders, defaultCwd, templates, templatesLabel, filterLabel, listLabel, manualLabel, initialDraft, onSend }: { title: string; requestLabel: string; cwdLabel: string; reviewLabel: string; previewLabel: string; sendLabel: string; prompt: string; busy: boolean; disabled: boolean; error?: string | undefined; folders: readonly string[]; defaultCwd: string; templates: readonly { id: string; title: string; draft: string }[]; templatesLabel: string; filterLabel: string; listLabel: string; manualLabel: string; initialDraft: string; onSend: (text: string, cwd: string) => Promise<boolean> }) {
  const [request, setRequest] = useState(initialDraft);
  const [cwd, setCwd] = useState(defaultCwd);
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState(false);
  const [review, setReview] = useState(false);
  const full = `${prompt}\n\n${request}`;
  return <section class="sect app-request"><h3>{title}</h3>
    <label>{requestLabel}<textarea value={request} onInput={(e) => { setRequest(e.currentTarget.value); setReview(false); }} /></label>
    <div>{templatesLabel}<div class="app-templates">{templates.map((item) => <Button key={item.id} onClick={() => { setRequest(item.draft); setReview(false); }}>{item.title}</Button>)}</div></div>
    <fieldset><legend>{cwdLabel}</legend>
      <label>{filterLabel}<input value={filter} onInput={(e) => setFilter(e.currentTarget.value)} /></label>
      <label>{listLabel}<select value={manual ? "" : cwd} onChange={(e) => { setCwd(e.currentTarget.value); setManual(false); setReview(false); }}><option value="">{listLabel}</option>{[...new Set([...(defaultCwd ? [defaultCwd] : []), ...folders])].filter((folder) => folder.toLowerCase().includes(filter.toLowerCase())).map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select></label>
      <Button onClick={() => { setManual(true); setCwd(""); setReview(false); }}>{manualLabel}</Button>
      {manual ? <label>{cwdLabel}<input value={cwd} onInput={(e) => { setCwd(e.currentTarget.value); setReview(false); }} /></label> : null}
    </fieldset>
    {review ? <><label>{previewLabel}<textarea readOnly value={full} /></label><Button disabled={disabled || busy} onClick={() => void onSend(full, cwd)}>{sendLabel}</Button></> : <Button disabled={disabled || busy || !request.trim() || !cwd.trim()} onClick={() => setReview(true)}>{reviewLabel}</Button>}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
