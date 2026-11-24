import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { composerAction } from "../../../../../ui-core/src";
import { Icon } from "../Icon";
import { Button } from "../Button";

export function Composer(props: { label: string; placeholder: string; hint: string; sendLabel: string; canSend: boolean; busy: boolean; allowWhitespace?: boolean; above?: ComponentChildren; interrupt?: { label: string; run: () => void }; draftStatus?: (text:string)=>{blocked:boolean;hint:string}; draftScope?: string; start?: ComponentChildren; context?: ComponentChildren; stop?: { label: string; run: () => void }; onSend: (text: string, onReserved?: () => void) => Promise<boolean> }) {
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
  const scopeGeneration = useRef(0);
  if (latestScope.current !== props.draftScope) { latestScope.current = props.draftScope; scopeGeneration.current++; }
  const text = drafts.current.get(props.draftScope) ?? "";
  const updateDraft = (value: string) => {
    const scope = props.draftScope;
    if ((drafts.current.get(scope) ?? "") === value) return;
    drafts.current.delete(scope);
    if (value !== "") drafts.current.set(scope, value);
    if (drafts.current.size > 16) drafts.current.delete(drafts.current.keys().next().value);
    renderDraft(++generation.current);
  };
  const status=props.draftStatus?.(text);
  const hasContent = text.length > 0 && (props.allowWhitespace === true || text.trim() !== "");
  const submitting = useRef(false);
  const submit = async () => {
    const submittedScope = props.draftScope;
    const submittedText = drafts.current.get(submittedScope) ?? "";
    if (submitting.current || !props.canSend || props.draftStatus?.(submittedText).blocked || props.busy || submittedText.length === 0 || (!props.allowWhitespace && submittedText.trim() === "")) return;
    const submittedGeneration = generation.current;
    const submittedScopeGeneration = scopeGeneration.current;
    const clearOriginal = () => {
      if (generation.current !== submittedGeneration || latestScope.current !== submittedScope || scopeGeneration.current !== submittedScopeGeneration) return;
      updateDraft("");
      if (textarea.current) textarea.current.value = "";
    };
    submitting.current = true;
    let notifying = true, reserved = false;
    try {
      const result = props.onSend(submittedText, () => {
        // The owner may transfer this draft only during this submission call.
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
      {props.above ? <div class="composer-above">{props.above}</div> : null}
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
        <span class="composer-hint" role="status">{status?.hint??props.hint}</span>
        <div class="right">
          {props.context}
          {props.interrupt ? <Button icon label={props.interrupt.label} variant="ghost" onClick={props.interrupt.run}><Icon role="action.interruptTurn" size="small" /></Button> : null}
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


export function ComposerRouting(props: { label: string; modelLabel: string; target: string; shells: readonly { id: string; command: string }[]; onTarget: (id: string) => void; eof?: { label: string; run: () => void }; timingLabel: string; timing: "next" | "now"; onTiming: (timing: "next" | "now") => void; timingDisabled?: boolean; nextLabel: string; nowLabel: string }) {
  return <div class="composer-routing">
    <div class="composer-target-chip"><label>{props.label} <select aria-label={props.label} value={props.target} onChange={event => props.onTarget(event.currentTarget.value)}>
      <option value="model">{props.modelLabel}</option>{props.shells.map(shell => <option value={shell.id} key={shell.id}>{shell.command}</option>)}
    </select></label>{props.eof ? <Button variant="ghost" icon label={props.eof.label} onClick={props.eof.run}><Icon role="action.shellEof" size="small" /></Button> : null}</div>
    <label>{props.timingLabel} <select aria-label={props.timingLabel} value={props.timing} disabled={props.timingDisabled} onChange={event => props.onTiming(event.currentTarget.value as "next" | "now")}>
      <option value="next">{props.nextLabel}</option><option value="now">{props.nowLabel}</option>
    </select></label>
  </div>;
}
