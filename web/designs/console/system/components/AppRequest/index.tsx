import { useState } from "preact/hooks";
import { Button } from "../Button";

export function AppRequest({ title, requestLabel, cwdLabel, reviewLabel, previewLabel, sendLabel, prompt, busy, disabled, error, onSend }: { title: string; requestLabel: string; cwdLabel: string; reviewLabel: string; previewLabel: string; sendLabel: string; prompt: string; busy: boolean; disabled: boolean; error?: string | undefined; onSend: (text: string, cwd: string) => Promise<boolean> }) {
  const [request, setRequest] = useState("");
  const [cwd, setCwd] = useState("");
  const [review, setReview] = useState(false);
  const full = `${prompt}\n\n${request}`;
  return <section class="sect"><h3>{title}</h3>
    <label>{requestLabel}<textarea value={request} onInput={(e) => { setRequest(e.currentTarget.value); setReview(false); }} /></label>
    <label>{cwdLabel}<input value={cwd} onInput={(e) => { setCwd(e.currentTarget.value); setReview(false); }} /></label>
    {review ? <><label>{previewLabel}<textarea readOnly value={full} /></label><Button disabled={disabled || busy} onClick={() => void onSend(full, cwd)}>{sendLabel}</Button></> : <Button disabled={disabled || busy || !request.trim() || !cwd.trim()} onClick={() => setReview(true)}>{reviewLabel}</Button>}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
