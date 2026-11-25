import type { ComponentChildren } from "preact";

import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { composerAction } from "../../../../../ui-core/src";
import { Icon } from "../Icon";
import { Button } from "../Button";

export function Composer(props: { label: string; placeholder: string; hint: string; sendLabel: string; canSend: boolean; busy: boolean; draftStatus?: (text: string) => { blocked: boolean; hint: string }; draftScope?: string; start?: ComponentChildren; context?: ComponentChildren; stop?: { label: string; run: () => void }; onSend: (text: string, onReserved?: () => void) => Promise<boolean> }) {
  const [, renderDraft] = useState(0);
  const drafts = useRef(new Map<string | undefined, string>());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const removingFocusedStop = !props.stop && stopButton.current
    && stopButton.current.ownerDocument.activeElement === stopButton.current;
  useLayoutEffect(() => {
    const field = textarea.current;
    if (removingFocusedStop && field && field.ownerDocument.activeElement === field.ownerDocument.body) field.focus();
  });
  const generation = useRef(0);
  const latestScope = useRef(props.draftScope);
  if (latestScope.current !== props.draftScope) latestScope.current = props.draftScope;
  const text = drafts.current.get(props.draftScope) ?? "";
  const updateDraft = (value: string) => {
    const scope = props.draftScope;
    if ((drafts.current.get(scope) ?? "") === value) return;
    drafts.current.delete(scope);
    if (value !== "") drafts.current.set(scope, value);
    if (drafts.current.size > 16) drafts.current.delete(drafts.current.keys().next().value);
    renderDraft(++generation.current);
  };
  const status = props.draftStatus?.(text);
  const hasContent = text.trim() !== "";
  const submitting = useRef(false);
  const submit = async () => {
    const submittedScope = props.draftScope;
    const submittedText = drafts.current.get(submittedScope) ?? "";
    if (submitting.current || !props.canSend || props.draftStatus?.(submittedText).blocked || props.busy || submittedText.trim() === "") return;
    const clearOriginal = () => {
      if (drafts.current.get(submittedScope) !== submittedText) return;
      drafts.current.delete(submittedScope);
      renderDraft(++generation.current);
      if (latestScope.current === submittedScope && textarea.current) textarea.current.value = "";
    };
    submitting.current = true;
    let notifying = true, reserved = false;
    try {
      const result = props.onSend(submittedText, () => {
        if (!notifying || reserved) return;
        reserved = true;
        clearOriginal();
      });
      notifying = false;
      if (await result) clearOriginal();
    }
    finally { notifying = false; submitting.current = false; }
  };
  return (
    <div class="composer-root">
      <textarea
        ref={textarea}
        id="composer"
        aria-label={props.label}
        placeholder={props.placeholder}
        rows={2}
        value={text}
        onInput={(e) => updateDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (composerAction(e) === "send") {
            e.preventDefault();
            if (!props.canSend || props.busy || submitting.current) return;
            void submit();
          }
        }}
      />
      <div class="composer-row">
        {props.start}
        <span class="composer-hint" role="status">{status?.hint ?? props.hint}</span>
        <div class="right">
          {props.context}
          {props.stop ? <Button buttonRef={stopButton} icon label={props.stop.label} title={props.stop.label} variant="stop" onClick={props.stop.run}>
            <Icon role="action.stop" size="small" />
          </Button> : null}
          <Button icon label={props.sendLabel} variant="primary" disabled={!props.canSend || status?.blocked || props.busy || !hasContent} onClick={() => void submit()}>
            <Icon role="composer.send" />
          </Button>
        </div>
      </div>
    </div>
  );
}
